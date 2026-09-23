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
//                      over. SQLite's busy timeout (store.mjs) is the second line if two ever meet.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, linkSync, statSync } from 'node:fs'
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
  const tmp = `${project.dbPath}.seed.${process.pid}.${Math.random().toString(36).slice(2)}`
  const db = await openStore(src, { readOnly: true })
  try { db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`) } finally { db.close() }
  try { linkSync(tmp, project.dbPath); return true } catch (e) { if (e.code === 'EEXIST') return false; throw e } finally { rmSync(tmp, { force: true }) }
}

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
// No index run outlives run.mjs's 20 min timeout: an older lock is stale even when its pid was
// reused by an unrelated live process.
const STALE_MS = 25 * 60_000

// Create `lock` holding our pid in ONE step: write a private temp file, then hard-link it into
// place (link fails with EEXIST if the lock exists). The lock is never visible empty.
function tryCreate(lock) {
  const tmp = `${lock}.${process.pid}.${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, String(process.pid))
  try { linkSync(tmp, lock); return true } catch (e) { if (e.code === 'EEXIST') return false; throw e } finally { rmSync(tmp, { force: true }) }
}

// Is the existing lock stale? null when it vanished meanwhile (the holder just finished).
function stale(lock) {
  let pid, age
  try { pid = Number(readFileSync(lock, 'utf8')); age = Date.now() - statSync(lock).mtimeMs } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  return age > STALE_MS || !(pid > 0 && alive(pid))
}

export async function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true })
  const lock = path.join(dir, 'index.lock')
  const pending = path.join(dir, 'index.pending')
  let got = false
  for (let attempt = 0; attempt < 5 && !got; attempt++) {
    if (tryCreate(lock)) { got = true; break }
    const s = stale(lock)
    if (s === null) continue // released between our create and our read: try again
    if (!s) break // held by a live indexer
    rmSync(lock, { force: true }) // dead holder: take over on the next attempt
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
