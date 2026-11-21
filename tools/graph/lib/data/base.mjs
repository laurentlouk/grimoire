// grimoire graph · data · the model at a base ref (spec D6, branch against base): the model-bearing
// files of a commit, read through git without checking anything out, run through the same discovery
// and extractors as the index (registry.mjs extractAll), reconciled as graph_data does.
//
//   resolveBase(project, { explicit, repo }) → the base to compare against, first found:
//     1. `explicit` (graph_changes `base`, graph.mjs --base);
//     2. baseBranch in grimoire.config.json;
//     3. the base the index's freshness resolves (lib/freshness.mjs baseCandidates: the branch's
//        upstream, origin/HEAD, main, master), each as a local branch, then on origin;
//     4. main.
//     A ref is compared at its merge base with each repository's HEAD (as `git diff base...HEAD` and
//     a pull request do), so commits the base gained since the branch left it are not the branch's
//     changes. A repository where the ref names no commit (or that is not in git) is skipped, and
//     its stores are left out of both sides.
//     → { ref, from, repos: [{ name, abs, commit, head, at }], skipped: [{ name, why }] } | { error }
//   modelAt(project, base) → { model: { stores }, failed: [{ repo, extractor, key, error }], rows: the facts reconciled }
//     Each repository's files at its `at` commit (git ls-tree), the candidates read as blobs through
//     one `git cat-file --batch` (git show <commit>:<path>, without a process per file; binary-safe,
//     each capped as the index caps it). Memoised per (repository, commit, extractor versions, the
//     config that steers discovery): in this process, and on disk beside the index (<graph dir>/base/,
//     one JSON file per key, the facts graph.db would hold for those files: names and shapes, never a
//     value; the MEMO_MAX most recent kept), so graph_diff and the page read a base once per commit.
//     A key that differs in any of its parts is a new entry; nothing is written to graph.db. A file
//     whose text at the base is the text the index read (the same hash) is not read again: its level
//     is the index's, and a job all of whose inputs are such files takes the index's facts (the same
//     extractor at the same version, on the same text), except one that parses code and is not read
//     aside, which answers nothing at a base (data/extractors: `{ declarations: [] }`). So a base costs
//     what its diff changed. Its
//     YAML that declares a table is parsed in a process of its own (readers/yaml-aside.mjs), with the
//     indexer's flags, never in this one, and so is its source code the item binding and the
//     table-builder schemas read (readers/code-aside.mjs).
//   treeAt(dir, commit), blobs(dir, list): those two git reads, shared with the architecture change
//     view (arch-change.mjs), which reads the saved diagrams at the base the same way.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, renameSync, utimesSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { EXTRACTORS, ASIDE, asideOf, MAX_BYTES, candidates, idOf, keeps, inspect, plan, run } from './registry.mjs'
import { COMPOSE } from './extractors/redis-infra.mjs'
import { docRoots } from '../docs.mjs'
import { reconcile } from './reconcile.mjs'
import { parseAside } from './readers/yaml-aside.mjs'
import { extractAside } from './readers/code-aside.mjs'
import { tableLevel } from './readers/dynamodb.mjs'
import { stripBom } from './readers/documents.mjs'
import { baseCandidates } from '../freshness.mjs'
import { driver, openStore } from '../store.mjs'
import { existsSync } from 'node:fs'

const git = (dir, args, opts = {}) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts })
const out = (dir, args) => { const r = git(dir, args); return r.status === 0 ? r.stdout.trim() : null }
const commitOf = (dir, ref) => out(dir, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])

export function resolveBase(project, { explicit = null, repo = null } = {}) {
  const repos = (project.repos || []).filter((r) => !repo || r.name === repo)
  if (!repos.length) return { error: repo ? `no repository named "${repo}" in this project` : 'no repository to compare' }
  const inGit = repos.filter((r) => out(r.abs, ['rev-parse', '--git-dir']) !== null)
  if (!inGit.length) return { error: `${names(repos)} ${repos.length === 1 ? 'is' : 'are'} not in a git repository: there is no base to compare against` }
  const tried = []
  const attempt = (ref, from) => {
    tried.push(ref)
    const hits = inGit.map((r) => ({ r, commit: commitOf(r.abs, ref) }))
    if (!hits.some((h) => h.commit)) return null
    const found = hits.filter((h) => h.commit).map(({ r, commit }) => {
      const head = commitOf(r.abs, 'HEAD')
      return { name: r.name, abs: r.abs, commit, head, at: (head && out(r.abs, ['merge-base', commit, head])) || commit }
    })
    const skipped = [...repos.filter((r) => !inGit.includes(r)).map((r) => ({ name: r.name, why: 'not in a git repository' })), ...hits.filter((h) => !h.commit).map((h) => ({ name: h.r.name, why: `${ref} is not a commit there` }))]
    return { ref, from, repos: found, skipped }
  }
  if (explicit) return attempt(String(explicit), 'given') || { error: `the base "${explicit}" does not resolve to a commit in ${names(inGit)} (give a branch, a tag or a commit)` }
  if (project.baseBranch) { const b = attempt(project.baseBranch, 'baseBranch in grimoire.config.json'); if (b) return b }
  const branch = project.root ? out(project.root, ['symbolic-ref', '-q', '--short', 'HEAD']) : null
  for (const c of project.root ? baseCandidates(project, branch) : []) {
    const b = attempt(c, "the index's base branch") || (c.startsWith('origin/') ? null : attempt(`origin/${c}`, "the index's base branch"))
    if (b) return b
  }
  return attempt('main', 'the default') || { error: `no base branch found in ${names(inGit)} (tried ${[...new Set(tried)].join(', ')}): name one with --base, or set baseBranch in grimoire.config.json` }
}
const names = (rs) => rs.map((r) => r.name).join(', ')

const memo = new Map()
const MEMO_MAX = 16
const DISK_FORMAT = 1 // bumped when the shape of what a cache file holds changes

// The base's facts of one repository, from disk (<graph dir>/base/<hash of the key>.json) or computed
// and saved there. A file that does not parse, or holds another key, is computed again.
function diskMemo(project, key, compute) {
  const dir = project.dbPath ? path.join(path.dirname(project.dbPath), 'base') : null
  if (!dir) return compute()
  const file = path.join(dir, `${createHash('sha1').update(`${DISK_FORMAT}\0${key}`).digest('hex')}.json`)
  try {
    const got = JSON.parse(readFileSync(file, 'utf8'))
    if (got && got.key === key && Array.isArray(got.facts)) { try { const now = new Date(); utimesSync(file, now, now) } catch {} return got.facts }
  } catch {}
  const facts = compute()
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ key, facts }))
    renameSync(tmp, file)
    // the most recent MEMO_MAX entries are kept
    const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return [f, statSync(path.join(dir, f)).mtimeMs] } catch { return [f, 0] } }).sort((a, b) => b[1] - a[1])
    for (const [f] of all.slice(MEMO_MAX)) rmSync(path.join(dir, f), { force: true })
  } catch {} // a read-only checkout: the answer stands, uncached
  return facts
}

// opts.equivalences: a refine file's (data/check.mjs), so the base is grouped as the branch is
export async function modelAt(project, base, opts = {}) {
  const ctx = { DatabaseSync: (await driver()).DatabaseSync }
  const rows = [], failed = []
  // the index, when there is one: what it read of the files the base holds unchanged
  let db = null
  try { if (project.dbPath && existsSync(project.dbPath)) db = await openStore(project.dbPath, { readOnly: true }) } catch { db = null }
  try {
  for (const r of base.repos) {
    const overrides = (project.dataMigrations || []).filter((o) => !o.repo || o.repo === r.name)
    const key = [r.abs, r.at, EXTRACTORS.map(idOf).join(','), JSON.stringify(overrides), (project.exclude || []).map(String).join(','), project.maxBytes ?? ''].join('\0')
    if (!memo.has(key)) {
      if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value)
      memo.set(key, diskMemo(project, key, () => extractAt(r.abs, r.at, project, overrides, ctx, db ? indexed(db, r.name) : null)))
    }
    for (const x of memo.get(key)) {
      if (x.facts) rows.push({ repo: r.name, extractor: x.extractor, facts: x.facts })
      else failed.push({ repo: r.name, extractor: x.extractor, key: x.key, error: x.error })
    }
  }
  } finally { try { db?.close() } catch {} }
  return { model: reconcile(rows, { ...opts, roots: opts.roots || (project.root ? docRoots(project) : []) }), failed, rows }
}

// What the index read of one repository: each data input's hash and level, each job's facts.
function indexed(db, repo) {
  try {
    const inputs = new Map(db.prepare('SELECT path, hash, ddl FROM data_inputs WHERE repo = ?').all(repo).map((x) => [x.path, x]))
    const facts = new Map(db.prepare('SELECT extractor, key, sig, facts, error FROM data_facts WHERE repo = ?').all(repo).map((x) => [`${x.extractor}\0${x.key}`, x]))
    return { inputs, facts }
  } catch { return null } // an index without the tables
}

function extractAt(abs, commit, project, overrides, ctx, index = null) {
  const files = treeAt(abs, commit)
  const paths = [...files.keys()]
  const want = candidates(paths, { exclude: [], ...project }).filter((p) => files.get(p).size <= MAX_BYTES)
  // read in batches of at most BATCH bytes, keeping only what an extractor may read (registry.mjs
  // keeps): every JSON and YAML file is a candidate, most declare nothing (an empty text inspects so)
  const text = new Map()
  const same = new Map() // path → the index's level: the text the index read
  for (let i = 0, n = 0, from = 0; i <= want.length; i++) {
    if (i < want.length && (n === 0 || n + files.get(want[i]).size <= BATCH)) { n += files.get(want[i]).size; continue }
    const batch = want.slice(from, i), got = blobs(abs, batch.map((p) => files.get(p)))
    for (const p of batch) {
      const b = got.get(files.get(p).oid)
      if (!b) continue
      const t = b.toString('utf8'), was = index?.inputs.get(p)
      if (was && was.hash && was.hash === createHash('sha1').update(t).digest('hex')) same.set(p, was.ddl)
      text.set(p, keeps(p, t) ? t : '')
    }
    from = i; n = i < want.length ? files.get(want[i]).size : 0
  }
  const read = (p) => { if (!text.has(p)) throw new Error(`${p} could not be read at ${commit.slice(0, 10)}`); return text.get(p) }
  // the jobs (registry.mjs extractAll's, with the index's level for a text it read): one whose inputs
  // are all such texts takes the index's facts (its signature the same); the others run. The source
  // files a code extractor of those parses are read in a process of their own (readers/code-aside.mjs),
  // once per extractor reading them (a TypeScript schema is item shapes and tables both); the access
  // patterns are not read at a base (graph_changes does not compare them): a file kept only for them
  // is not parsed
  const info = new Map()
  for (const p of candidates(paths, { exclude: [], ...project })) {
    const size = files.get(p).size
    let ddl = null
    if (size <= MAX_BYTES) { if (same.has(p)) ddl = same.get(p); else { try { ddl = inspect(p, read(p)) } catch { continue } } }
    info.set(p, { size, ddl })
  }
  const jobs = plan(info, { overrides })
  // the index's job on the same inputs: its signature, as the indexer computes it, from the same texts.
  // An extractor that parses code and is not read aside answers nothing at a base (the SQL code sends,
  // the access patterns): it runs, at once, and reads nothing aside.
  const blind = (ex) => ex.tree && !ASIDE.includes(ex)
  const reused = (job) => {
    if (blind(job.extractor) || !job.inputs.length || !job.inputs.every((p) => same.has(p))) return null
    const id = idOf(job.extractor), row = index.facts.get(`${id}\0${job.key}`)
    const sig = createHash('sha1').update([id, job.salt || '', ...job.inputs.map((p) => `${p} ${index.inputs.get(p).hash}`)].join('\n')).digest('hex')
    return row && row.sig === sig ? row : null
  }
  const todo = jobs.filter((job) => !reused(job))
  const need = new Set(todo.filter((job) => !blind(job.extractor)).flatMap((job) => job.inputs))
  // the YAML a table extractor will read, parsed in a process of its own (readers/yaml-aside.mjs)
  // (and a Compose file, which redis-infra.mjs reads whatever its level)
  const yaml = parseAside([...new Set(want.filter((p) => need.has(p) && YAML.test(p) && text.has(p)).filter((p) => COMPOSE.test(p) || tableLevel(stripBom(read(p)))).map((p) => stripBom(read(p))))])
  const yamlOf = (t) => { const v = yaml.get(t); if (v instanceof Error) throw v; if (!v) throw new Error('no YAML reader: the text was not parsed'); return v }
  const code = want.filter((p) => need.has(p)).flatMap((p) => { const t = text.get(p); return t ? asideOf(p, t).map((ex) => ({ id: ex.id, path: p, text: t, key: `${ex.id}\0${p}` })) : [] })
  const facts = code.length ? extractAside(code) : new Map()
  const aside = (id, p) => { const v = facts.get(`${id}\0${p}`); if (v instanceof Error) throw v; if (!v) throw new Error('no code reader: the file was not read'); return v }
  const readCapped = (p) => { if (info.get(p)?.size > MAX_BYTES) throw new Error(`${p} is larger than ${MAX_BYTES >> 20} MB: not read`); return read(p) }
  const jctx = { ...ctx, yaml: yamlOf, aside }
  return jobs.map((job) => {
    const was = reused(job)
    const head = { extractor: idOf(job.extractor), scope: job.extractor.scope, key: job.key }
    if (was) return was.facts !== null ? { ...head, facts: JSON.parse(was.facts) } : { ...head, error: was.error }
    return { ...head, ...run(job, readCapped, jctx) }
  })
}
const YAML = /\.(?:ya?ml|template)$/i
const BATCH = 32 << 20

// A commit's files under a directory, relative to it (git lists them so when run from inside it):
// Map(path → { oid, size }). Symbolic links are left out: their blob is a target path, not a text.
// `paths`: only those folders (relative to it), listed alone (the architecture's diagrams folder).
export function treeAt(abs, commit, paths = null) {
  const r = git(abs, ['--literal-pathspecs', 'ls-tree', '-r', '-l', '-z', commit, ...(paths && paths.length ? ['--', ...paths] : [])]) // a path is a path, never pathspec magic (`:x`)
  if (r.status !== 0) throw new Error(`git ls-tree ${commit.slice(0, 10)} failed in ${abs}: ${(r.stderr || '').trim().split('\n')[0]}`)
  const files = new Map()
  for (const entry of r.stdout.split('\0')) {
    const tab = entry.indexOf('\t')
    if (tab < 0) continue
    const [mode, type, oid, size] = entry.slice(0, tab).trim().split(/\s+/)
    if (type === 'blob' && mode !== '120000') files.set(entry.slice(tab + 1), { oid, size: Number(size) })
  }
  return files
}

// Blobs ([{ oid, size }]) by object id, as bytes, from one `git cat-file --batch`: each answer is
// "<oid> blob <size>\n<content>\n", or "<oid> missing\n".
export function blobs(abs, list) {
  const got = new Map()
  if (!list.length) return got
  const r = spawnSync('git', ['-C', abs, 'cat-file', '--batch'], { input: `${list.map((x) => x.oid).join('\n')}\n`, maxBuffer: list.reduce((a, x) => a + x.size + 128, 4096) })
  if (r.status !== 0) throw new Error(`git cat-file failed in ${abs}: ${String(r.stderr || '').trim().split('\n')[0]}`)
  const buf = r.stdout
  for (let i = 0; i < buf.length;) {
    const nl = buf.indexOf(10, i)
    if (nl < 0) break
    const [oid, type, size] = buf.subarray(i, nl).toString('latin1').split(' ')
    if (type === 'missing' || size === undefined) { i = nl + 1; continue }
    const n = Number(size)
    got.set(oid, buf.subarray(nl + 1, nl + 1 + n))
    i = nl + 1 + n + 1
  }
  return got
}
