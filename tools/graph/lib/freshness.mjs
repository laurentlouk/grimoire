// grimoire graph · keeping the index current across checkouts and concurrent writers.
//
//   seed(project)      a linked git worktree with no index starts from a snapshot of the main
//                      checkout's index (VACUUM INTO: consistent even while it is being written).
//                      Repo roots are stored project-relative, so the copy is valid as is; the next
//                      incremental index re-hashes and re-parses only what differs on this branch.
//   withLock(dir, fn)  one indexer per index. A second caller does not wait: it marks the index
//                      pending and returns { busy: true }; the holder re-runs until nothing is
//                      pending, so no change is lost. A lock whose pid is dead is taken over.
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const db = await openStore(src, { readOnly: true })
  try { db.exec(`VACUUM INTO '${project.dbPath.replace(/'/g, "''")}'`) } finally { db.close() }
  return true
}

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

export async function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true })
  const lock = path.join(dir, 'index.lock')
  const pending = path.join(dir, 'index.pending')
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(lock, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const pid = Number(readFileSync(lock, 'utf8'))
      if (attempt === 0 && !(pid > 0 && alive(pid))) { rmSync(lock, { force: true }); continue }
      writeFileSync(pending, String(Date.now()))
      return { busy: true }
    }
  }
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
