// grimoire graph · parser runtime. The plugin ships no node_modules, so the tree-sitter runtime and
// its prebuilt grammars (pinned in ../package.json + lockfile) are found, in order, in:
//   1. tools/graph/node_modules            (CI, development: `npm ci --prefix tools/graph`)
//   2. $GRIMOIRE_GRAPH_DEPS/node_modules   (an explicit cache)
//   3. <user cache>/grimoire/graph-deps/<lockfile hash>/node_modules
// and installed into 3 with `npm ci` (integrity-checked against the lockfile) when none has them.
// Querying never needs this: only indexing parses.
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LANGS } from './langs.mjs'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = path.join(HERE, 'package-lock.json')
const lockHash = () => createHash('sha256').update(readFileSync(LOCK)).digest('hex').slice(0, 12)
const has = (dir) => existsSync(path.join(dir, 'web-tree-sitter', 'package.json')) && existsSync(path.join(dir, 'tree-sitter-wasms', 'out'))

export function cacheDir() {
  if (process.env.GRIMOIRE_GRAPH_DEPS) return process.env.GRIMOIRE_GRAPH_DEPS
  const base = process.env.XDG_CACHE_HOME || (process.platform === 'darwin' ? path.join(homedir(), 'Library', 'Caches') : path.join(homedir(), '.cache'))
  return path.join(base, 'grimoire', 'graph-deps', lockHash())
}

export function findDeps() {
  for (const d of [path.join(HERE, 'node_modules'), path.join(cacheDir(), 'node_modules')]) if (has(d)) return d
  return null
}

export function installDeps(log = () => {}) {
  const dir = cacheDir()
  mkdirSync(dir, { recursive: true })
  copyFileSync(path.join(HERE, 'package.json'), path.join(dir, 'package.json'))
  copyFileSync(LOCK, path.join(dir, 'package-lock.json'))
  log(`installing the parser runtime (web-tree-sitter + grammars, ~50 MB) into ${dir}`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const r = spawnSync(npm, ['ci', '--no-audit', '--no-fund', '--ignore-scripts', '--prefix', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const nm = path.join(dir, 'node_modules')
  if (r.status !== 0 || !has(nm)) throw new Error(`could not install the parser runtime (npm ci in ${dir} exited ${r.status}): ${(r.stderr || r.error?.message || '').trim().slice(-400)}\nInstall it by hand: npm ci --prefix "${dir}"`)
  return nm
}

let runtime = null
// { parserFor(lang) → Parser | null } — grammars load lazily, once each.
export async function loadRuntime({ install = true, log } = {}) {
  if (runtime) return runtime
  const nm = findDeps() || (install ? installDeps(log) : null)
  if (!nm) throw new Error('parser runtime not installed; run the index once (it installs it) or `npm ci --prefix tools/graph`')
  const TS = await import(pathToFileURL(path.join(nm, 'web-tree-sitter', 'tree-sitter.js')).href)
  await TS.Parser.init()
  const parsers = new Map()
  runtime = {
    async parserFor(lang) {
      if (parsers.has(lang)) return parsers.get(lang)
      let p = null
      const wasm = LANGS[lang] && path.join(nm, 'tree-sitter-wasms', 'out', `tree-sitter-${LANGS[lang].wasm}.wasm`)
      if (wasm && existsSync(wasm)) {
        try { p = new TS.Parser(); p.setLanguage(await TS.Language.load(wasm)) } catch { p = null }
      }
      parsers.set(lang, p)
      return p
    },
  }
  return runtime
}
