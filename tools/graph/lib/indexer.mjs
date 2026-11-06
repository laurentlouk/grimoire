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
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { loadRuntime } from './deps.mjs'
import { extract } from './extract.mjs'
import { TEST_PATH } from './langs.mjs'
import { scanRepo, gitHead, listPaths } from './project.mjs'
import { openStore, tx, driver } from './store.mjs'
import { candidates, inspect, plan, run, idOf, MAX_BYTES } from './data/registry.mjs'
import { resolveRepo } from './resolve.mjs'
import { cochange } from './cochange.mjs'

export async function indexProject(project, { full = false, only = null, log = () => {} } = {}) {
  const db = await openStore(project.dbPath)
  const summary = { repos: [], ms: 0 }
  const t0 = Date.now()
  let rt = null
  const runtime = async () => (rt ||= await loadRuntime({ log }))

  const known = new Set(project.repos.map((r) => r.name))
  for (const { name } of db.prepare('SELECT name FROM repos').all()) if (!known.has(name)) dropRepo(db, name) // left the config

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
      if (f.lang !== 'other') {
        const parser = await (await runtime()).parserFor(f.lang)
        if (parser) {
          try { const tree = parser.parse(src); try { result = extract(tree, f.lang, TEST_PATH.test(f.path)) } finally { tree.delete() } } catch (e) { rs.failed.push(`${f.path}: ${e.message.slice(0, 80)}`) }
        }
      }
      parsedFiles.push({ ...f, hash, result })
    }
    tx(db, () => {
      for (const [, gone] of prev) { removeFile(db, gone.id); rs.removed++ }
      for (const f of parsedFiles) { writeFile(db, repo.name, f); rs.parsed++ }
      const r = db.prepare('SELECT head FROM repos WHERE name = ?').get(repo.name)
      const needsResolve = full || rs.parsed || rs.removed || !r
      if (needsResolve) { resolveRepo(db, repo.name, repo.abs); rs.resolved = true }
      const head = gitHead(repo)
      db.prepare('INSERT INTO repos(name, root, head, indexed_at) VALUES(?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET root = excluded.root, head = excluded.head, indexed_at = excluded.indexed_at')
        .run(repo.name, rootRel, head, new Date().toISOString())
      const cc = db.prepare('SELECT cochange_head FROM repos WHERE name = ?').get(repo.name)
      if (head && (cc.cochange_head !== head || needsResolve)) { cochange(db, repo); db.prepare('UPDATE repos SET cochange_head = ? WHERE name = ?').run(head, repo.name) }
    })
    rs.data = await indexData(db, project, repo, rels)
    log(`${repo.name}: ${rs.files} files, ${rs.parsed} parsed, ${rs.removed} removed${rs.data.extracted ? `, ${rs.data.extracted} data job(s) run` : ''}`)
    summary.repos.push(rs)
  }
  summary.ms = Date.now() - t0
  db.close()
  return summary
}

// A repository's data model: hash the inputs that moved, then run the jobs whose inputs changed.
async function indexData(db, project, repo, rels) {
  const out = { extracted: 0, failed: [] }
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
      try { st = statSync(path.join(repo.abs, p)) } catch { continue }
      if (!st.isFile()) continue
      const r = prev.get(p), mtime = Math.floor(st.mtimeMs)
      prev.delete(p)
      if (r && r.size === st.size && r.mtime === mtime) { info.set(p, r); continue }
      let hash = null, ddl = null
      if (st.size <= MAX_BYTES) { try { const text = read(p); hash = createHash('sha1').update(text).digest('hex'); ddl = inspect(p, text) } catch { continue } }
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
    const r = run(job, read, ctx)
    results.push([job.extractor.scope, job.key, id, sig, r])
    if (r.error) out.failed.push(`${job.key} (${id}): ${r.error}`)
  }
  tx(db, () => {
    const put = db.prepare('INSERT OR REPLACE INTO data_facts(repo, scope, key, extractor, sig, facts, error) VALUES(?, ?, ?, ?, ?, ?, ?)')
    for (const [scope, key, id, sig, r] of results) put.run(repo.name, scope, key, id, sig, r.facts ? JSON.stringify(r.facts) : null, r.error || null)
    for (const [k, r] of done) if (!keep.has(k)) db.prepare('DELETE FROM data_facts WHERE repo = ? AND extractor = ? AND key = ?').run(repo.name, r.extractor, r.key)
  })
  out.extracted = results.length
  return out
}

function writeFile(db, repo, f) {
  if (f.prevId) removeFile(db, f.prevId)
  const isTest = TEST_PATH.test(f.path) ? 1 : 0
  const fileId = Number(db.prepare('INSERT INTO files(repo, path, lang, size, mtime, hash, is_test) VALUES(?, ?, ?, ?, ?, ?, ?)').run(repo, f.path, f.lang, f.size, f.mtime, f.hash, isTest).lastInsertRowid)
  const insNode = db.prepare('INSERT INTO nodes(file_id, kind, name, qualname, parent_id, container, line, end_line, signature, is_test) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const fileNode = Number(insNode.run(fileId, 'file', path.basename(f.path), f.path, null, null, 1, 1, null, isTest).lastInsertRowid)
  db.prepare('UPDATE files SET node_id = ? WHERE id = ?').run(fileNode, fileId)
  const ids = []
  for (const s of f.result.symbols) {
    ids.push(Number(insNode.run(fileId, s.kind, s.name, s.qualname, s.parent >= 0 ? ids[s.parent] : null, s.container, s.line, s.endLine, s.signature, s.isTest ? 1 : 0).lastInsertRowid))
  }
  const insRef = db.prepare('INSERT INTO refs(file_id, src_id, kind, name, qual, qtype, from_type, line) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
  for (const r of f.result.refs) insRef.run(fileId, r.src >= 0 ? ids[r.src] : fileNode, r.kind, r.name, r.qual || '', r.qtype || null, r.fromType || null, r.line)
  const insImp = db.prepare('INSERT INTO imports(file_id, source, names, alias, flags, line) VALUES(?, ?, ?, ?, ?, ?)')
  for (const i of f.result.imports) {
    const { source, names, alias, line, ...flags } = i
    insImp.run(fileId, source, JSON.stringify(names || []), alias || null, JSON.stringify(flags), line)
  }
}

function removeFile(db, fileId) {
  db.prepare('DELETE FROM edges WHERE src IN (SELECT id FROM nodes WHERE file_id = ?) OR dst IN (SELECT id FROM nodes WHERE file_id = ?)').run(fileId, fileId)
  for (const t of ['refs', 'imports', 'nodes']) db.prepare(`DELETE FROM ${t} WHERE file_id = ?`).run(fileId)
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId)
}

function dropRepo(db, repo) {
  tx(db, () => {
    for (const { id } of db.prepare('SELECT id FROM files WHERE repo = ?').all(repo)) removeFile(db, id)
    db.prepare('DELETE FROM cochange WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM churn WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM data_inputs WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM data_facts WHERE repo = ?').run(repo)
    db.prepare('DELETE FROM repos WHERE name = ?').run(repo)
  })
}
