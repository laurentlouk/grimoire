#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  build-journal-writer — the journal writer's file, from the engine
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/build-journal-writer.mjs           → (re)writes workflows/scripts/journal-writer.sh
//  node scripts/build-journal-writer.mjs --check   → exit 1 when the file is not the engine's text
//
//  Source of truth: JOURNAL_WRITER in workflows/orchestrate-loop.js, between its "journal WRITER:
//  begin" and "end" markers. Every flush checks the file's cksum against that text and sources it;
//  a file that differs makes the run carry the writer inline (it still works, at a cost). Edit the
//  engine, then rerun this script. Plain Node ≥ 20, no dependencies.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const WRITER_FILE = join(ROOT, 'workflows', 'scripts', 'journal-writer.sh')

// The text the engine holds: its writer region evaluated with the two constants it reads.
export function writerText() {
  const engine = readFileSync(join(ROOT, 'workflows', 'orchestrate-loop.js'), 'utf8')
  const from = engine.indexOf('// ── the journal WRITER: begin')
  const to = engine.indexOf('// ── the journal WRITER: end ──')
  const decode = /const DECODE_FN = `[\s\S]*?`\n/.exec(engine)
  const stale = /const LOCK_STALE_SEC = (\d+)/.exec(engine)
  if (from < 0 || to < from || !decode || !stale) throw new Error('the engine has no journal WRITER region (or no DECODE_FN / LOCK_STALE_SEC)')
  return new Function(`const LOCK_STALE_SEC = ${stale[1]}\n${decode[0]}${engine.slice(from, to)}\nreturn JOURNAL_WRITER`)()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = writerText()
  let current = null
  try { current = readFileSync(WRITER_FILE, 'utf8') } catch {}
  if (process.argv.includes('--check')) {
    if (current === text) console.log('build-journal-writer --check: workflows/scripts/journal-writer.sh is the engine\'s writer')
    else { console.error('build-journal-writer --check: workflows/scripts/journal-writer.sh differs from the engine\'s JOURNAL_WRITER — run node scripts/build-journal-writer.mjs'); process.exit(1) }
  } else {
    mkdirSync(dirname(WRITER_FILE), { recursive: true })
    writeFileSync(WRITER_FILE, text)
    console.log(`build-journal-writer: wrote workflows/scripts/journal-writer.sh (${Buffer.byteLength(text)} bytes)`)
  }
}
