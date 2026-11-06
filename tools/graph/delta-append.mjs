#!/usr/bin/env node
// grimoire graph · the loop's ship step appends to a design's delta the unplanned changes its
// implementers kept (spec D4: unplanned changes never block; the map is updated, the user is told).
//   node tools/graph/delta-append.mjs <delta file> <changes file>
// <changes file>: a JSON array of changes { id, op, target, before?, after?, why, slice?, origin:
// 'unplanned' } (data/delta.mjs appendChanges). Prints one line, then one line per refused change:
//   DELTA ok added=<n> already=<n> refused=<n>   (already: ids the file holds: a ship sent again)
//   DELTA none                                   the run has no delta there: nothing written
//   DELTA bad <why>                              the delta does not validate, or cannot be read or
//                                                written: nothing written
//   DELTA refused <id>: <problems>               that change would not validate: left out
// The only writer of the file while it runs: a lock directory beside it (<file>.lock, waited for at
// most LOCK_WAIT_MS, broken once older than LOCK_STALE_MS), so the ships of two repositories never
// interleave a read and a write; the file is replaced through a temporary file renamed over it. Exit
// 0 whatever it printed (the ship reads the line), 2 on a usage error.
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, statSync, unlinkSync, existsSync } from 'node:fs'
import { appendChanges } from './lib/data/delta.mjs'

const LOCK_WAIT_MS = 30_000
const LOCK_STALE_MS = 60_000
const [file, changesFile] = process.argv.slice(2)
if (!file || !changesFile) { console.error('usage: node tools/graph/delta-append.mjs <delta file> <changes file>'); process.exit(2) }
const one = (s) => String(s).replace(/\s+/g, ' ').slice(0, 300)
const say = (line) => console.log(line)

if (!existsSync(file)) { say('DELTA none'); process.exit(0) }
let entries
try { entries = JSON.parse(readFileSync(changesFile, 'utf8')) } catch (e) { say(`DELTA bad the changes cannot be read: ${one(e.message)}`); process.exit(0) }
if (!Array.isArray(entries)) { say('DELTA bad the changes are not a JSON array'); process.exit(0) }

const lock = `${file}.lock`
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
let held = false
for (const t0 = Date.now(); !held;) {
  try { mkdirSync(lock); held = true; break } catch (e) { if (e.code !== 'EEXIST') { say(`DELTA bad its lock cannot be made: ${one(e.message)}`); process.exit(0) } }
  try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmdirSync(lock); continue } } catch {}
  if (Date.now() - t0 > LOCK_WAIT_MS) { say(`DELTA bad its lock ${lock} stayed busy`); process.exit(0) }
  nap(100)
}
// read, append, write: the lines to print, the lock released first
const write = () => {
  let text
  try { text = readFileSync(file, 'utf8') } catch (e) { return [e.code === 'ENOENT' ? 'DELTA none' : `DELTA bad it cannot be read: ${one(e.message)}`] }
  const r = appendChanges(text, entries)
  if (r.errors.length) return [`DELTA bad the delta does not validate: ${one(r.errors.join('; '))}`]
  if (r.added.length) {
    const tmp = `${file}.${process.pid}.tmp`
    try { writeFileSync(tmp, r.text); renameSync(tmp, file) } catch (e) { try { unlinkSync(tmp) } catch {} return [`DELTA bad it cannot be written: ${one(e.message)}`] }
  }
  return [`DELTA ok added=${r.added.length} already=${r.already.length} refused=${r.refused.length}`, ...r.refused.map((x) => `DELTA refused ${x.id ?? '?'}: ${one(x.errors.join('; '))}`)]
}
let lines
try { lines = write() } catch (e) { lines = [`DELTA bad ${one(e.message)}`] }
try { rmdirSync(lock) } catch {}
for (const l of lines) say(l)
