#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  build-ship-lock — the ship lock's file, from the engine
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/build-ship-lock.mjs           → (re)writes workflows/scripts/ship-lock.sh
//  node scripts/build-ship-lock.mjs --check   → exit 1 when the file is not the engine's text
//
//  Source of truth: SHIP_LOCK in workflows/orchestrate-loop.js, between its "the ship LOCK: begin" and
//  "end" markers. Every ship, seal and gate lock script checks the file's cksum against that text and
//  sources it; a file that differs makes the run carry the lock inline (it still works, at a cost).
//  Edit the engine, then rerun this script. Plain Node ≥ 20, no dependencies.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const LOCK_FILE = join(ROOT, 'workflows', 'scripts', 'ship-lock.sh')

// The text the engine holds: its lock region evaluated with the constants it reads.
export function lockText() {
  const engine = readFileSync(join(ROOT, 'workflows', 'orchestrate-loop.js'), 'utf8')
  const from = engine.indexOf('// ── the ship LOCK: begin')
  const to = engine.indexOf('// ── the ship LOCK: end ──')
  const consts = ['SHIP_LOCK_BRK_CAP_SEC', 'SHIP_LOCK_STALE_SEC', 'GATE_LOCK_STALE_SEC'].map((k) => new RegExp(`const ${k} = \\d+`).exec(engine))
  if (from < 0 || to < from || consts.some((m) => !m)) throw new Error('the engine has no ship LOCK region (or no SHIP_LOCK_BRK_CAP_SEC / SHIP_LOCK_STALE_SEC / GATE_LOCK_STALE_SEC)')
  return new Function(`${consts.map((m) => m[0]).join('\n')}\n${engine.slice(from, to)}\nreturn SHIP_LOCK`)()
}

// run as a script (its real path: a checkout under a symlinked directory, such as macOS's /var, is one too)
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const text = lockText()
  let current = null
  try { current = readFileSync(LOCK_FILE, 'utf8') } catch {}
  if (process.argv.includes('--check')) {
    if (current === text) console.log('build-ship-lock --check: workflows/scripts/ship-lock.sh is the engine\'s lock')
    else { console.error('build-ship-lock --check: workflows/scripts/ship-lock.sh differs from the engine\'s SHIP_LOCK — run node scripts/build-ship-lock.mjs'); process.exit(1) }
  } else {
    mkdirSync(dirname(LOCK_FILE), { recursive: true })
    writeFileSync(LOCK_FILE, text)
    console.log(`build-ship-lock: wrote workflows/scripts/ship-lock.sh (${Buffer.byteLength(text)} bytes)`)
  }
}
