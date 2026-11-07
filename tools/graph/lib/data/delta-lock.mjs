// grimoire graph · data · the lock every writer of a design's delta takes: the loop's ship step
// appending the unplanned changes its implementers kept (delta-append.mjs) and `serve` writing an
// acknowledgement (serve.mjs). Each reads the file, checks it, and replaces it through a temporary
// file renamed over it; under the lock those read → check → write runs never interleave, so one
// never writes over what the other just wrote (an acknowledgement, an appended change).
//
// The lock is a directory beside the file, `<file>.lock`, made with mkdir (atomic: one maker wins).
// A writer that finds it waits, NAP_MS at a time, at most `waitMs`; one older than `staleMs` (by its
// mtime) belongs to a writer that died holding it and is broken. Every writer holds it for a read
// and a write of a file of a few kB: milliseconds. Two waiters that judge the same stale lock at
// once could both break it; at `staleMs` (a dead writer, a minute old) that is a case the ship lock
// (one writer per repository) and the rarity of acknowledgements leave open, knowingly.
//
//   withDeltaLock(file, fn, { waitMs, staleMs }) → { busy: true } when the lock stayed held past
//   waitMs (fn not run), else { busy: false, value: await fn() }; the lock is released whatever fn
//   does (it may throw: the error goes on, the lock is gone). An mkdir that fails for another reason
//   (a folder that cannot be written) throws.
import { mkdirSync, rmdirSync, statSync } from 'node:fs'

export const DELTA_LOCK = { waitMs: 30_000, staleMs: 60_000 }
const NAP_MS = 100

export async function withDeltaLock(file, fn, opts = {}) {
  const { waitMs, staleMs } = { ...DELTA_LOCK, ...opts }
  const lock = `${file}.lock`
  for (const t0 = Date.now(); ;) {
    try {
      mkdirSync(lock)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    let age = null
    try { age = Date.now() - statSync(lock).mtimeMs } catch { continue } // released meanwhile: try again at once
    if (age > staleMs) {
      try { rmdirSync(lock) } catch {}
      continue
    }
    if (Date.now() - t0 >= waitMs) return { busy: true }
    await new Promise((res) => setTimeout(res, NAP_MS))
  }
  try {
    return { busy: false, value: await fn() }
  } finally {
    try { rmdirSync(lock) } catch {}
  }
}
