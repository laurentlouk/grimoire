#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  project-config — grimoire.config.json as every checkout of the project sees it
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/project-config.mjs [--root <dir>] [--sources]
//      → prints the resolved config as JSON (2-space, trailing newline); `{}` when there is
//        none. --sources prints instead the files it was read from, one per line, the winning
//        layer first. Exit 1 when a layer does not parse or is not a JSON object.
//
//  A linked git worktree reads through to its main checkout, so a config that is untracked or
//  gitignored (and so never reaches the worktree) still applies there, and an edit on the main
//  checkout shows up in every worktree at once, with nothing copied that could go stale:
//    1. <root>/grimoire.config.json            the worktree's own file, when it has one
//    2. <main checkout>/grimoire.config.json   the main checkout's
//  The worktree's file is layered over the main checkout's: objects merge key by key, and any
//  other value the worktree sets (a scalar, an array such as repos[]) replaces the main one
//  whole, so a worktree can narrow a list as well as extend it. A key set to null in the
//  worktree is null there. The main checkout itself, a plain clone and a directory outside git
//  read their own file only.
//
//  The main checkout is found from files only (the worktree's .git file names its git dir, whose
//  commondir names the shared .git): no git process, so the PreToolUse guard can call it on every
//  tool call within its time budget.
import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONFIG_FILE = 'grimoire.config.json'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }

// The main checkout of the linked worktree at dir; null for a main checkout, a plain clone, a
// submodule (its git dir has no commondir) or no git.
export function mainCheckout(dir) {
  try {
    const dotgit = join(dir, '.git')
    if (!statSync(dotgit).isFile()) return null
    const m = /^gitdir: *(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'))
    if (!m) return null
    const gitdir = resolve(dir, m[1])
    const common = resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim())
    if (basename(common) !== '.git') return null
    const main = dirname(common)
    return resolve(main) === resolve(dir) ? null : main
  } catch { return null }
}

// The config files that apply at root, the winning layer first; only those that exist.
export function configLayers(root) {
  const dir = resolve(root)
  const main = mainCheckout(dir)
  return [join(dir, CONFIG_FILE), main && join(main, CONFIG_FILE)].filter((f) => f && isFile(f))
}

// over layered on base: objects merge key by key, anything else from over replaces base.
export function mergeConfig(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? mergeConfig(base[k], v) : v
  return out
}

// { config, files, error }: config is the merged object ({} when no layer exists), files the
// layers read (winning first). A layer that does not parse, or is not an object, is an error
// naming it; config is then null, so a caller never acts on half a config.
export function loadConfig(root) {
  const files = configLayers(root)
  let config = {}
  for (const file of [...files].reverse()) {
    let value
    try { value = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { config: null, files, error: `${file} does not parse: ${e.message}` } }
    if (!isObj(value)) return { config: null, files, error: `${file}: the top level must be a JSON object` }
    config = mergeConfig(config, value)
  }
  return { config, files, error: null }
}

// The config at root, or {} when there is none or it is broken: for callers that fail open.
export function readConfig(root) {
  return loadConfig(root).config || {}
}

function main(argv) {
  const at = argv.indexOf('--root')
  const root = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : process.cwd())
  const r = loadConfig(root)
  if (r.error) { console.error(`project-config: ${r.error}`); return 1 }
  process.stdout.write(argv.includes('--sources') ? r.files.map((f) => `${f}\n`).join('') : `${JSON.stringify(r.config, null, 2)}\n`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
