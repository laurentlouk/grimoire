// grimoire graph · the project being indexed: its root, its repositories, where the index lives,
// and which files count. Everything comes from grimoire.config.json when there is one:
//   repos[]        { name, path }: each is indexed as its own repository (a hub of several repos
//                  gets one graph with a `repo` column); no repos → the root is one repository
//   graph.enabled  false turns every tool into a pointer back to grep/read
//   graph.repos    names from repos[] to index (default: all of them)
//   graph.dir      index location (default .grimoire/graph, next to the loop's telemetry)
//   graph.exclude  extra path globs to skip; graph.maxFileKB (default 512)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { langOf } from './langs.mjs'

export function projectRoot(explicit) {
  return path.resolve(explicit || process.env.GRIMOIRE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd())
}

export function loadProject(rootArg) {
  const root = projectRoot(rootArg)
  let config = {}
  const cfgPath = path.join(root, 'grimoire.config.json')
  if (existsSync(cfgPath)) {
    try { config = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch (e) { throw new Error(`grimoire.config.json does not parse: ${e.message}`) }
  }
  const g = config.graph || {}
  let repos = (config.repos || []).filter((r) => r && r.name && r.path).map((r) => ({ name: r.name, path: r.path }))
  if (Array.isArray(g.repos) && g.repos.length) repos = repos.filter((r) => g.repos.includes(r.name))
  if (!repos.length) repos = [{ name: path.basename(root), path: '.' }]
  repos = repos.map((r) => ({ ...r, abs: path.resolve(root, r.path) })).filter((r) => existsSync(r.abs))
  return {
    root,
    enabled: g.enabled !== false,
    repos,
    dbPath: path.join(root, g.dir || '.grimoire/graph', 'graph.db'),
    exclude: compileGlobs(g.exclude || []),
    maxBytes: (Number(g.maxFileKB) || 512) * 1024,
  }
}

// Directories never worth indexing: dependencies, build output, caches, generated trees.
const SKIP_DIRS = new Set(['node_modules', '.git', '.grimoire', '.worktrees', 'vendor', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit', '.turbo', 'coverage', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', 'Pods', 'DerivedData', '.gradle', '.idea', 'bower_components', 'third_party'])
const SKIP_FILE = /\.(min|bundle|generated|pb)\.[^/]+$|\.d\.ts$|(^|\/)(package-lock|yarn\.lock|pnpm-lock)/

// Minimal globs: `*` within a segment, `**` across segments, a bare name matches any segment.
function compileGlobs(globs) {
  return globs.map((g) => {
    if (!/[*/]/.test(g)) return new RegExp(`(^|/)${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}(/|$)`)
    const re = g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
    return new RegExp(`^${re}$|^${re}/`)
  })
}

const skipped = (rel, project) => rel.split('/').some((s) => SKIP_DIRS.has(s)) || SKIP_FILE.test(rel) || project.exclude.some((re) => re.test(rel))

// Every indexable file of a repository: git's view (tracked + untracked, .gitignore honoured)
// when it is a git work tree, a directory walk otherwise.
export function scanRepo(repo, project) {
  let rels = null
  const git = spawnSync('git', ['-C', repo.abs, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (git.status === 0) rels = git.stdout.split('\0').filter(Boolean)
  else {
    rels = []
    const walk = (dir, rel) => {
      let ents = []
      try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), r) }
        else if (e.isFile()) rels.push(r)
      }
    }
    walk(repo.abs, '')
  }
  const out = []
  for (const rel of rels) {
    const lang = langOf(rel)
    if (!lang || skipped(rel, project)) continue
    let st
    try { st = statSync(path.join(repo.abs, rel)) } catch { continue }
    if (!st.isFile() || st.size > project.maxBytes) continue
    out.push({ path: rel, lang, size: st.size, mtime: Math.floor(st.mtimeMs) })
  }
  return out
}

export function gitHead(repo) {
  const r = spawnSync('git', ['-C', repo.abs, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}
