// grimoire graph · keeping the index current across checkouts and concurrent writers.
//
//   seed(project)      a linked git worktree with no index starts from a snapshot of the main
//                      checkout's index (VACUUM INTO: consistent even while it is being written).
//                      Repo roots are stored project-relative, so the copy is valid as is; the next
//                      incremental index re-hashes and re-parses only what differs on this branch.
//   withLock(dir, fn)  one indexer per index. A second caller does not wait: it marks the index
//                      pending and returns { busy: true }; the holder re-runs until nothing is
//                      pending, so no change is lost. The lock is created atomically (temp file +
//                      link); one whose pid is dead, or older than any index run can last, is taken
//                      over by one process at a time (a reap lock, re-checked before removal).
//                      SQLite's busy timeout (store.mjs) is the second line if two ever meet.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, linkSync, statSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { openStore } from './store.mjs'

// The main checkout of the git repository `root` belongs to, or null when root is not a linked
// worktree (it is the main checkout itself, or not in git).
export function mainCheckout(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const common = r.stdout.trim()
  if (path.basename(common) !== '.git') return null
  const main = path.dirname(common)
  return path.resolve(main) === path.resolve(root) ? null : main
}

export async function seed(project) {
  if (existsSync(project.dbPath)) return false
  const main = mainCheckout(project.root)
  if (!main) return false
  const rel = path.relative(project.root, project.dbPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false // graph.dir outside the project: shared already
  const src = path.join(main, rel)
  if (!existsSync(src)) return false
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
