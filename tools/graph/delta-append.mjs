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
// The only writer of the file while it runs: the delta's lock (lib/data/delta-lock.mjs, the one `serve`
// takes to write an acknowledgement), so neither the ships of two repositories nor an acknowledgement
// interleave a read and a write with it; the file is replaced through a temporary file renamed over
// it. Exit 0 whatever it printed (the ship reads the line), 2 on a usage error.
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { appendChanges } from './lib/data/delta.mjs'
import { withDeltaLock } from './lib/data/delta-lock.mjs'
const [file, changesFile] = process.argv.slice(2)
if (!file || !changesFile) { console.error('usage: node tools/graph/delta-append.mjs <delta file> <changes file>'); process.exit(2) }
const one = (s) => String(s).replace(/\s+/g, ' ').slice(0, 300)
const say = (line) => console.log(line)

if (!existsSync(file)) { say('DELTA none'); process.exit(0) }
let entries
try { entries = JSON.parse(readFileSync(changesFile, 'utf8')) } catch (e) { say(`DELTA bad the changes cannot be read: ${one(e.message)}`); process.exit(0) }
if (!Array.isArray(entries)) { say('DELTA bad the changes are not a JSON array'); process.exit(0) }

// read, append, write, under the lock: the lines to print
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
try {
  const done = await withDeltaLock(file, write)
  lines = done.busy ? [`DELTA bad its lock ${file}.lock stayed busy`] : done.value
} catch (e) { lines = [`DELTA bad ${one(e.message)}`] }
for (const l of lines) say(l)
