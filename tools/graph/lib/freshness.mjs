// grimoire graph · keeping the index current across checkouts and concurrent writers.
//
//   baseOf(project)    the checkout this one's index is based on: the first of these branches that
//                      another checkout of the repository has checked out, with an index —
//                        1. baseBranch in grimoire.config.json (origin/dev → dev)
//                        2. the branch's upstream, when it names another branch
//                           (git worktree add -b feat ../feat origin/dev)
//                        3. origin/HEAD, the remote's default branch
//                        4. main, then master
//                      else the main checkout, whatever it holds. So a branch stacked on dev starts
//                      from dev's index, and one on top of main from main's.
//   seed(project)      a checkout with no index starts from a snapshot of its base's index
//                      (VACUUM INTO: consistent even while it is being written). Repo roots are
//                      stored project-relative, so the copy is valid as is; the next incremental
//                      index re-hashes and re-parses only what differs on this branch.
//   rebase(project)    run by every index run, under its lock, before indexing: when this checkout's
//                      HEAD moved since its last index (a pull, a rebase, a merge of the base), the
//                      index is re-based onto the base's when that leaves clearly fewer files to
//                      re-parse (files that differ between the base's indexed commit and HEAD, vs
//                      between this index's commit and HEAD). So once work is merged into main and
//                      main's index has it, a worktree that picks it up copies main's instead of
//                      parsing it again. Re-basing never changes what the index answers, only how
//                      much parsing it takes: the incremental index after it makes the result match
//                      the working tree either way. The base is recorded in meta('base').
//   withLock(dir, fn)  one indexer per index. A second caller does not wait: it marks the index
//                      pending and returns { busy: true }; the holder re-runs until nothing is
//                      pending, so no change is lost. The lock is created atomically (temp file +
//                      link); one whose pid is dead, or older than any index run can last, is taken
//                      over by one process at a time (a reap lock, re-checked before removal).
//                      SQLite's busy timeout (store.mjs) is the second line if two ever meet.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, linkSync, statSync, renameSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { openStore, tx, TABLES, SCHEMA_VERSION } from './store.mjs'
import { gitHead } from './project.mjs'
import { mainCheckout } from '../../../scripts/project-config.mjs'

// The main checkout of a linked worktree, or null (project-config.mjs: files only, no git process).
export { mainCheckout }

// Re-base only when it saves at least this many files to re-parse: a copy is not free either.
const REBASE_MIN = Number(process.env.GRIMOIRE_GRAPH_REBASE_MIN ?? 20)

const git = (dir, args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}
const real = (p) => { try { return realpathSync(p) } catch { return path.resolve(p) } }

// Every checkout of the repository root belongs to: [{ path, branch }], branch null when detached.
function checkouts(root) {
  const out = git(root, ['worktree', 'list', '--porcelain'])
  if (!out) return []
  return out.split('\n\n').map((block) => ({
    path: (/^worktree (.+)$/m.exec(block) || [])[1],
    branch: (/^branch refs\/heads\/(.+)$/m.exec(block) || [])[1] || null,
  })).filter((c) => c.path)
}

// A branch name without its remote: origin/dev → dev. A name that is a local branch stays whole
// (release/1.2), so does one without a slash.
function localName(root, ref) {
  if (!ref) return null
  const name = ref.replace(/^refs\/(heads|remotes)\//, '')
  if (!name.includes('/') || git(root, ['rev-parse', '--verify', '-q', `refs/heads/${name}`])) return name
  return name.slice(name.indexOf('/') + 1)
}

// The branches this checkout's index may be based on, in order, never its own branch.
export function baseCandidates(project, branch) {
  const root = project.root
  const out = []
  const add = (b) => { if (b && b !== branch && !out.includes(b)) out.push(b) }
  add(localName(root, project.baseBranch))
  add(localName(root, git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])))
  add(localName(root, git(root, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])))
  add('main'); add('master')
  return out
}

// The checkout this one's index is based on: { root, branch, dbPath }, or null (no other checkout
// has an index at the same place, or graph.dir lies outside the project and is shared already).
export function baseOf(project) {
  const rel = path.relative(project.root, project.dbPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const self = real(project.root)
  const branch = git(project.root, ['symbolic-ref', '-q', '--short', 'HEAD'])
  const others = checkouts(project.root).filter((c) => real(c.path) !== self && existsSync(path.join(c.path, rel)))
  for (const b of baseCandidates(project, branch)) {
    const c = others.find((x) => x.branch === b)
    if (c) return { root: c.path, branch: b, dbPath: path.join(c.path, rel) }
  }
  const main = mainCheckout(project.root)
  const m = main && others.find((x) => real(x.path) === real(main))
  return m ? { root: m.path, branch: m.branch, dbPath: path.join(m.path, rel) } : null
}

export async function seed(project) {
  if (existsSync(project.dbPath)) return false
  const base = baseOf(project)
  if (!base) return false
  const src = base.dbPath
  mkdirSync(path.dirname(project.dbPath), { recursive: true })
  // Snapshot into a private file, then link it into place: a reader never opens a half-written
  // copy, and when two processes seed at once the second one simply finds it done.
  const tmp = `${project.dbPath}.seed.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  const db = await openStore(src, { readOnly: true })
  try { db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`) } finally { db.close() }
  try {
    try { linkSync(tmp, project.dbPath) } catch (e) {
      if (!NO_LINK.has(e.code)) throw e
      // No hard links: a rename is still atomic (never a half-copied file); losing a race to
      // another seeder at worst replaces one complete snapshot with another.
      if (existsSync(project.dbPath)) return false
      renameSync(tmp, project.dbPath)
    }
    return true
  } catch (e) { if (e.code === 'EEXIST') return false; throw e } finally { rmSync(tmp, { force: true }) }
}

// Files that differ between two commits of a repo; Infinity when it cannot tell (no commit, one
// git no longer has).
function differing(repo, from, to) {
  if (!from || !to) return Infinity
  if (from === to) return 0
  const out = git(repo.abs, ['diff', '--name-only', '--no-renames', from, to])
  return out === null ? Infinity : out ? out.split('\n').length : 0
}

const rowsOf = (db) => new Map(db.prepare('SELECT name, head FROM repos').all().map((r) => [r.name, r.head]))
const metaOf = (db, key) => { try { return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null } catch { return null } }

// Re-base the index onto its base's when that saves parsing. Call it holding the index's lock.
// Returns { rebased, base } or null when there is nothing to compare against.
export async function rebase(project, { log = () => {}, min = REBASE_MIN } = {}) {
  if (!existsSync(project.dbPath)) return null
  const heads = new Map(project.repos.map((r) => [r.name, gitHead(r)]))
  const db = await openStore(project.dbPath)
  try {
    const mine = rowsOf(db)
    let keep = 0
    for (const repo of project.repos) keep += differing(repo, mine.get(repo.name), heads.get(repo.name))
    const recorded = metaOf(db, 'base')
    // HEAD has not moved since the last index and the base is known: nothing to weigh.
    if (keep === 0 && recorded) return null
    const base = baseOf(project)
    if (!base) return null
    let theirs
    const src = await openStore(base.dbPath, { readOnly: true })
    try { theirs = metaOf(src, 'schema') === SCHEMA_VERSION ? rowsOf(src) : null } finally { src.close() }
    if (!theirs) return null
    let move = 0
    for (const repo of project.repos) move += theirs.has(repo.name) ? differing(repo, theirs.get(repo.name), heads.get(repo.name)) : Infinity
    const rebased = move + min < keep
    if (rebased) {
      // Copied in one transaction over the same file: WAL-safe, and a reader sees the old index or
      // the new one, never a mix.
      db.exec(`ATTACH DATABASE '${base.dbPath.replace(/'/g, "''")}' AS base`)
      try {
        tx(db, () => { for (const t of TABLES) { db.exec(`DELETE FROM main.${t}`); db.exec(`INSERT INTO main.${t} SELECT * FROM base.${t}`) } })
      } finally { db.exec('DETACH DATABASE base') }
      log(`re-based on ${base.branch || 'the main checkout'} (${base.root}): ${move} file(s) to re-parse instead of ${keep === Infinity ? 'all' : keep}`)
    }
    const prev = (() => { try { return JSON.parse(recorded) } catch { return null } })()
    const info = { branch: base.branch, checkout: base.root, rebasedAt: rebased ? new Date().toISOString() : prev?.rebasedAt ?? null }
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('base', ?)").run(JSON.stringify(info))
    return { rebased, base: info }
  } finally { db.close() }
}

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
// No index run outlives run.mjs's 20 min timeout: an older lock is stale even when its pid was
// reused by an unrelated live process.
const STALE_MS = 25 * 60_000

// Create `lock` holding our pid in ONE step: write a private temp file, then hard-link it into
// place (link fails with EEXIST if the lock exists), so the lock is never visible empty. On a
// filesystem without hard links, an exclusive create is the fallback (a lock seen empty there is
// treated as live until it is old, see stale()).
const NO_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EMLINK'])
function tryCreate(lock) {
  const tmp = `${lock}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(tmp, String(process.pid))
  try { linkSync(tmp, lock); return true } catch (e) {
    if (e.code === 'EEXIST') return false
    if (!NO_LINK.has(e.code)) throw e
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); return true } catch (e2) { if (e2.code === 'EEXIST') return false; throw e2 }
  } finally { rmSync(tmp, { force: true }) }
}

// Is the existing lock stale? null when it vanished meanwhile (the holder just finished).
function stale(lock) {
  let pid, age
  try { pid = Number(readFileSync(lock, 'utf8')); age = Date.now() - statSync(lock).mtimeMs } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  if (age > STALE_MS) return true
  if (!(pid > 0)) return age > 10_000 // unreadable pid: being written right now, unless it stays that way
  return !alive(pid)
}

// Temp files a crashed process left behind (they are uniquely named, so only litter).
function sweep(dir) {
  try { for (const f of readdirSync(dir)) if (/\.tmp$/.test(f) && Date.now() - statSync(path.join(dir, f)).mtimeMs > 3_600_000) rmSync(path.join(dir, f), { force: true }) } catch {}
}

export async function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true })
  const lock = path.join(dir, 'index.lock')
  const pending = path.join(dir, 'index.pending')
  const reap = path.join(dir, 'index.reap')
  sweep(dir)
  let got = false
  for (let attempt = 0; attempt < 5 && !got; attempt++) {
    if (tryCreate(lock)) { got = true; break }
    const s = stale(lock)
    if (s === null) continue // released between our create and our read: try again
    if (!s) break // held by a live indexer
    // A dead holder. Taking over is itself exclusive: only the holder of the short-lived reap
    // lock may remove it, after checking again that it is still the stale one, so a contender
    // can never delete a lock someone else has just created.
    if (!tryCreate(reap)) {
      if (stale(reap) !== false) rmSync(reap, { force: true }) // a reaper that died mid-reap
      continue
    }
    try { if (stale(lock) === true) rmSync(lock, { force: true }) } finally { rmSync(reap, { force: true }) }
  }
  if (!got) { writeFileSync(pending, String(Date.now())); return { busy: true } }
  try {
    let result
    do {
      rmSync(pending, { force: true })
      result = await fn()
    } while (existsSync(pending))
    return result
  } finally {
    rmSync(lock, { force: true })
  }
}
