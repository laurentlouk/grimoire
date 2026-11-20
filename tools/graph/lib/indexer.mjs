// grimoire graph · incremental indexing. A file is re-parsed only when its size or mtime moved AND
// its content hash changed; deleted files leave the graph. Edges of a repository are re-resolved
// whenever any of its files changed, since a new definition can capture names anywhere.
//
// Runs in its own process (worker.mjs) with V8's Liftoff-only wasm tier: some grammars crash the
// optimizing wasm compiler of current Node, and a crash must never take the MCP server with it.
//
// After a repository's code, its data model (lib/data): the files data extractors read are tracked
// the same way (data_inputs), and each extraction job (one file, or one folder) runs again only when
// the hash of one of its inputs, or its extractor's version, changed (data_facts).
import { readFileSync, statSync, lstatSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { loadRuntime } from './deps.mjs'
import { extract } from './extract.mjs'
import { TEST_PATH, LANGS, familyOf } from './langs.mjs'
import { scanRepo, gitHead, listPaths } from './project.mjs'
import { parseContract, contractHints } from './contracts.mjs'
import { configOfCode, configOfDecl, declKind, configDeclPaths, DECL_MAX, linkConfig } from './config.mjs'
import { openStore, tx, driver } from './store.mjs'
import { candidates, inspect, plan, run, idOf, readsYaml, readsCode, keeps, MAX_BYTES } from './data/registry.mjs'
import { CODE_LANGS } from './data/readers/code-aside.mjs'
import { ACCESS_LANGS } from './data/extractors/dynamo-access.mjs'
import { readYaml } from './data/readers/yaml.mjs'
import { resolveRepo } from './resolve.mjs'
import { cochange } from './cochange.mjs'
import { extractRoutes } from './routes.mjs'
import { writeRoutes, removeRoutes, resolveRoutes, linkRoutes } from './route-graph.mjs'

export async function indexProject(project, { full = false, only = null, log = () => {} } = {}) {
  const db = await openStore(project.dbPath)
  const summary = { repos: [], ms: 0 }
  const t0 = Date.now()
  let rt = null
  const runtime = async () => (rt ||= await loadRuntime({ log }))

  const known = new Set(project.repos.map((r) => r.name))
  let relink = false // routes link across repositories: once any of them changed, after them all
  for (const { name } of db.prepare('SELECT name FROM repos').all()) if (!known.has(name)) { dropRepo(db, name); relink = true } // left the config

  for (const repo of project.repos) {
    if (only && repo.name !== only) continue
    const rs = { repo: repo.name, files: 0, parsed: 0, removed: 0, failed: [], resolved: false }
    const rootRel = path.relative(project.root, repo.abs) || '.'
    if (full) dropRepo(db, repo.name)
    const prev = new Map(db.prepare('SELECT id, path, size, mtime, hash FROM files WHERE repo = ?').all(repo.name).map((f) => [f.path, f]))
    const rels = listPaths(repo.abs)
    const scanned = scanRepo(repo, project, rels)
    rs.files = scanned.length
    const todo = []
    for (const f of scanned) {
      const p = prev.get(f.path)
      prev.delete(f.path)
      if (p && p.size === f.size && p.mtime === f.mtime) continue
      todo.push({ ...f, prevId: p ? p.id : null, prevHash: p ? p.hash : null })
    }
    const parsedFiles = []
    for (const f of todo) {
      let src
      try { src = readFileSync(path.join(repo.abs, f.path), 'utf8') } catch { continue }
      const hash = createHash('sha1').update(src).digest('hex')
      if (hash === f.prevHash) { db.prepare('UPDATE files SET size = ?, mtime = ? WHERE id = ?').run(f.size, f.mtime, f.prevId); continue }
      let result = { symbols: [], refs: [], imports: [] }
      if (LANGS[f.lang]?.hand) { // an API contract, read by hand (contracts.mjs)
        try { result = parseContract(f.lang, src, TEST_PATH.test(f.path)) } catch (e) { rs.failed.push(`${f.path}: ${e.message.slice(0, 80)}`) }
      } else if (f.lang !== 'other') {
        const parser = await (await runtime()).parserFor(f.lang)
        if (parser) {
          try {
            const tree = parser.parse(src)
            try {
              result = extract(tree, f.lang, TEST_PATH.test(f.path), f.path)
              try { result.routes = extractRoutes(tree, f.lang, f.path, result) } catch (e) { rs.failed.push(`${f.path}: routes: ${e.message.slice(0, 80)}`) }
            } finally { tree.delete() }
          } catch (e) { rs.failed.push(`${f.path}: ${e.message.slice(0, 80)}`) }
        }
      }
      // what no syntax tree here shows: the code that implements an API contract, and the
      // configuration keys the file reads (lexical scans, names only)
      if (!LANGS[f.lang]?.hand && f.lang !== 'other') {
        const fam = familyOf(f.lang)
        try { result.refs.push(...contractHints(f.lang, fam, src, result.symbols, result.refs)) } catch (e) { rs.failed.push(`${f.path}: contract hints: ${e.message.slice(0, 60)}`) }
        try { result.config = configOfCode(f.lang, fam, f.path, src, result.symbols) } catch (e) { rs.failed.push(`${f.path}: configuration keys: ${e.message.slice(0, 60)}`) }
      }
      parsedFiles.push({ ...f, hash, result })
    }
    tx(db, () => {
      for (const [, gone] of prev) { removeFile(db, gone.id); rs.removed++ }
      for (const f of parsedFiles) { writeFile(db, repo.name, f); rs.parsed++ }
      const r = db.prepare('SELECT head FROM repos WHERE name = ?').get(repo.name)
      const needsResolve = full || rs.parsed || rs.removed || !r
      if (needsResolve) {
        resolveRepo(db, repo.name, repo.abs, rels)
        // the routes' composition is a lead like the rest: a failure loses the routes, never the index
        try { resolveRoutes(db, repo.name, repo.abs) } catch (e) { rs.failed.push(`routes: ${e.message.slice(0, 120)}`) }
        try { linkConfig(db, repo.name) } catch (e) { rs.failed.push(`configuration keys: ${e.message.slice(0, 120)}`) }
        rs.resolved = true; relink = true
      }
      const head = gitHead(repo)
      db.prepare('INSERT INTO repos(name, root, head, indexed_at) VALUES(?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET root = excluded.root, head = excluded.head, indexed_at = excluded.indexed_at')
        .run(repo.name, rootRel, head, new Date().toISOString())
      const cc = db.prepare('SELECT cochange_head FROM repos WHERE name = ?').get(repo.name)
      if (head && (cc.cochange_head !== head || needsResolve)) { cochange(db, repo); db.prepare('UPDATE repos SET cochange_head = ? WHERE name = ?').run(head, repo.name) }
    })
    rs.config = indexConfigDecls(db, project, repo, rels)
    rs.data = await indexData(db, project, repo, rels, runtime)
    log(`${repo.name}: ${rs.files} files, ${rs.parsed} parsed, ${rs.removed} removed${rs.data.extracted ? `, ${rs.data.extracted} data job(s) run` : ''}`)
    summary.repos.push(rs)
  }
  if (relink || !db.prepare('SELECT 1 FROM meta WHERE key = ?').get('routes:linked')) {
    try { tx(db, () => { linkRoutes(db); db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('routes:linked', ?)").run(new Date().toISOString()) }) } catch (e) { log(`routes: their callers were not linked (${e.message.slice(0, 120)})`) }
  }
  summary.ms = Date.now() - t0
  db.close()
  return summary
}

// A repository's data model: hash the inputs that moved, then run the jobs whose inputs changed. A
// job that reads YAML gets the pinned YAML grammar (loaded once, the first time one runs). A data
// input that is a symbolic link to a file out of the repository is never followed (an outside file's
// values would land in the model as the repository's): it is kept as found, not read, an error row
// of its own (`data-inputs`), so graph_data and graph_status say so.
export const OUTSIDE_LINK = 'a symbolic link to a file out of the repository: not read'
async function indexData(db, project, repo, rels, runtime) {
  const out = { extracted: 0, failed: [] }
  let root = null
  try { root = realpathSync(repo.abs) } catch {}
  const refused = []
  const prev = new Map(db.prepare('SELECT path, size, mtime, hash, ddl FROM data_inputs WHERE repo = ?').all(repo.name).map((r) => [r.path, r]))
  const info = new Map() // path → { size, hash, ddl }
  const texts = new Map()
  const read = (p) => {
    if (!texts.has(p)) {
      if (info.get(p)?.size > MAX_BYTES) throw new Error(`${p} is larger than ${MAX_BYTES >> 20} MB: not read`)
      texts.set(p, readFileSync(path.join(repo.abs, p), 'utf8'))
    }
    return texts.get(p)
  }
  const upsert = db.prepare('INSERT INTO data_inputs(repo, path, size, mtime, hash, ddl) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(repo, path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, hash = excluded.hash, ddl = excluded.ddl')
  tx(db, () => {
    for (const p of candidates(rels, project)) {
      let st
      try { st = lstatSync(path.join(repo.abs, p)) } catch { continue }
      if (st.isSymbolicLink()) {
        let real = null
        try { real = realpathSync(path.join(repo.abs, p)) } catch {}
        if (!real || !root || (real !== root && !real.startsWith(root + path.sep))) { refused.push(p); continue }
        try { st = statSync(path.join(repo.abs, p)) } catch { continue }
      }
      if (!st.isFile()) continue
      const r = prev.get(p), mtime = Math.floor(st.mtimeMs)
      prev.delete(p)
      if (r && r.size === st.size && r.mtime === mtime) { info.set(p, r); continue }
      let hash = null, ddl = null
      if (st.size <= MAX_BYTES) {
        try {
          const text = readFileSync(path.join(repo.abs, p), 'utf8')
          hash = createHash('sha1').update(text).digest('hex'); ddl = inspect(p, text)
          if (keeps(p, text)) texts.set(p, text) // a JSON or YAML file that declares no table is not kept
        } catch { continue }
      }
      info.set(p, { size: st.size, hash, ddl })
      upsert.run(repo.name, p, st.size, mtime, hash, ddl)
    }
    for (const p of prev.keys()) db.prepare('DELETE FROM data_inputs WHERE repo = ? AND path = ?').run(repo.name, p)
  })
  const done = new Map(db.prepare('SELECT extractor, key, sig FROM data_facts WHERE repo = ?').all(repo.name).map((r) => [`${r.extractor}|${r.key}`, r]))
  const keep = new Set()
  const ctx = { DatabaseSync: (await driver()).DatabaseSync }
  const results = []
  for (const job of plan(info, { overrides: project.dataMigrations.filter((o) => !o.repo || o.repo === repo.name) })) {
    const id = idOf(job.extractor)
    const sig = createHash('sha1').update([id, job.salt || '', ...job.inputs.map((p) => `${p} ${info.get(p)?.hash}`)].join('\n')).digest('hex')
    keep.add(`${id}|${job.key}`)
    if (done.get(`${id}|${job.key}`)?.sig === sig) continue
    if (readsYaml(job) && !('yaml' in ctx)) {
      let parser = null
      try { parser = await (await runtime()).parserFor('yaml') } catch {}
      ctx.yaml = parser ? (text) => readYaml(parser, text) : null
    }
    if (readsCode(job) && !('tree' in ctx)) {
      // the grammars the code index parsed with: a code extractor parses its file again (the code
      // index keeps no tree), only when the file changed
      const parsers = {}
      for (const lang of new Set([...CODE_LANGS, ...ACCESS_LANGS])) { try { parsers[lang] = await (await runtime()).parserFor(lang) } catch { parsers[lang] = null } }
      ctx.tree = (lang, text) => { if (!parsers[lang]) throw new Error(`the pinned ${lang} grammar did not load`); return parsers[lang].parse(text) }
    }
    const r = run(job, read, ctx)
    results.push([job.extractor.scope, job.key, id, sig, r])
    if (r.error) out.failed.push(`${job.key} (${id}): ${r.error}`)
  }
  tx(db, () => {
    const put = db.prepare('INSERT OR REPLACE INTO data_facts(repo, scope, key, extractor, sig, facts, error) VALUES(?, ?, ?, ?, ?, ?, ?)')
    for (const [scope, key, id, sig, r] of results) put.run(repo.name, scope, key, id, sig, r.facts ? JSON.stringify(r.facts) : null, r.error || null)
    for (const p of refused) { put.run(repo.name, 'file', p, 'data-inputs', 'refused', null, OUTSIDE_LINK); keep.add(`data-inputs|${p}`) }
    for (const [k, r] of done) if (!keep.has(k)) db.prepare('DELETE FROM data_facts WHERE repo = ? AND extractor = ? AND key = ?').run(repo.name, r.extractor, r.key)
  })
  for (const p of refused) out.failed.push(`${p}: ${OUTSIDE_LINK}`)
  out.extracted = results.length
  return out
}

// A repository's configuration declaration files (config.mjs declKind: env templates, compose files,
// CI workflows, app.json, Spring files), re-read when their size or mtime moved and their hash
// changed. Names only: a line is matched for its key, its value never kept. A symbolic link is never
// followed (an outside file's names would read as the repository's).
function indexConfigDecls(db, project, repo, rels) {
  const out = { read: 0 }
  const prev = new Map(db.prepare('SELECT path, size, mtime, hash FROM config_inputs WHERE repo = ?').all(repo.name).map((r) => [r.path, r]))
  const put = db.prepare('INSERT INTO config_inputs(repo, path, size, mtime, hash) VALUES(?, ?, ?, ?, ?) ON CONFLICT(repo, path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, hash = excluded.hash')
  const drop = db.prepare('DELETE FROM config WHERE repo = ? AND path = ? AND file_id IS NULL')
  const ins = db.prepare('INSERT INTO config(repo, path, file_id, node_id, key, kind, role, src_key, via, line) VALUES(?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)')
  tx(db, () => {
    for (const p of configDeclPaths(rels, project)) {
      let st
      try { st = lstatSync(path.join(repo.abs, p)) } catch { continue }
      const r = prev.get(p), mtime = Math.floor(st.mtimeMs)
      prev.delete(p)
      if (r && r.size === st.size && r.mtime === mtime) continue
      // a symbolic link, a directory, a huge file: tracked (so a query does not count it as changed), not read
      if (!st.isFile() || st.size > DECL_MAX) { put.run(repo.name, p, st.size, mtime, null); drop.run(repo.name, p); continue }
      let text
      try { text = readFileSync(path.join(repo.abs, p), 'utf8') } catch { continue }
      const hash = createHash('sha1').update(text).digest('hex')
      put.run(repo.name, p, st.size, mtime, hash)
      if (r && r.hash === hash) continue
      drop.run(repo.name, p)
      for (const c of configOfDecl(declKind(p), text)) ins.run(repo.name, p, c.key, c.kind, c.role, c.srcKey, c.via, c.line)
      text = null
      out.read++
    }
    for (const p of prev.keys()) { db.prepare('DELETE FROM config_inputs WHERE repo = ? AND path = ?').run(repo.name, p); drop.run(repo.name, p) }
  })
  return out
}

function writeFile(db, repo, f) {
  if (f.prevId) removeFile(db, f.prevId)
  const isTest = TEST_PATH.test(f.path) ? 1 : 0
  const fileId = Number(db.prepare('INSERT INTO files(repo, path, lang, size, mtime, hash, is_test) VALUES(?, ?, ?, ?, ?, ?, ?)').run(repo, f.path, f.lang, f.size, f.mtime, f.hash, isTest).lastInsertRowid)
  const insNode = db.prepare('INSERT INTO nodes(file_id, kind, name, qualname, parent_id, container, line, end_line, signature, is_test, via) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const fileNode = Number(insNode.run(fileId, 'file', path.basename(f.path), f.path, null, null, 1, 1, null, isTest, null).lastInsertRowid)
  db.prepare('UPDATE files SET node_id = ? WHERE id = ?').run(fileNode, fileId)
  const ids = []
  for (const s of f.result.symbols) {
    ids.push(Number(insNode.run(fileId, s.kind, s.name, s.qualname, s.parent >= 0 ? ids[s.parent] : null, s.container, s.line, s.endLine, s.signature, s.isTest ? 1 : 0, s.via || null).lastInsertRowid))
  }
  writeRoutes(db, fileId, fileNode, ids, f.result.routes || null)
  const insRef = db.prepare('INSERT INTO refs(file_id, src_id, kind, name, qual, qtype, from_type, line) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
  for (const r of f.result.refs) insRef.run(fileId, r.src >= 0 ? ids[r.src] : fileNode, r.kind, r.name, r.qual || '', r.qtype || null, r.fromType || null, r.line)
  const insImp = db.prepare('INSERT INTO imports(file_id, source, names, alias, flags, line) VALUES(?, ?, ?, ?, ?, ?)')
  for (const i of f.result.imports) {
    const { source, names, alias, line, ...flags } = i
    insImp.run(fileId, source, JSON.stringify(names || []), alias || null, JSON.stringify(flags), line)
  }
  const insCfg = db.prepare('INSERT INTO config(repo, path, file_id, node_id, key, kind, role, src_key, via, line) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const c of f.result.config || []) insCfg.run(repo, f.path, fileId, c.src >= 0 ? ids[c.src] : fileNode, c.key, c.kind, c.role, c.srcKey || null, c.via, c.line)
}

function removeFile(db, fileId) {
  db.prepare('DELETE FROM edges WHERE src IN (SELECT id FROM nodes WHERE file_id = ?) OR dst IN (SELECT id FROM nodes WHERE file_id = ?)').run(fileId, fileId)
  for (const t of ['refs', 'imports', 'nodes', 'config']) db.prepare(`DELETE FROM ${t} WHERE file_id = ?`).run(fileId)
  removeRoutes(db, fileId)
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId)
}

function dropRepo(db, repo) {
  tx(db, () => {
    for (const { id } of db.prepare('SELECT id FROM files WHERE repo = ?').all(repo)) removeFile(db, id)
    db.prepare('DELETE FROM cochange WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM churn WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM data_inputs WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM data_facts WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM config WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM config_inputs WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM repos WHERE name = ?').run(repo)
  })
}
