// grimoire graph · the project being indexed: its root, its repositories, where the index lives,
// and which files count. Everything comes from grimoire.config.json when there is one (in a linked
// worktree without its own, the main checkout's: scripts/project-config.mjs):
//   repos[]        { name, path }: each is indexed as its own repository (a hub of several repos
//                  gets one graph with a `repo` column); no repos → the root is one repository
//   graph.enabled  false turns every tool into a pointer back to grep/read
//   graph.repos    names from repos[] to index (default: all of them)
//   graph.dir      index location (default .grimoire/graph, next to the loop's telemetry)
//   graph.exclude  extra path globs to skip; graph.maxFileKB (default 512); graph.maxContractKB, the
//                  cap for API contract files: GraphQL, protobuf, OpenAPI, Swagger (default 4096)
//   graph.architectureDir  where the architecture diagrams live (default docs/architecture)
//   graph.data.migrations  [{ path, dialect }]: a migration folder's dialect, stated (path is
//                  repo-relative, `repo:path` to name one repository of several)
//   baseBranch     the branch a worktree's index is based on first (freshness.mjs)
import { readdirSync, statSync, existsSync, realpathSync, openSync, fstatSync, readSync, closeSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { langOf, isContract } from './langs.mjs'
import { loadConfig, mainCheckout } from '../../../scripts/project-config.mjs'

export function projectRoot(explicit) {
  return path.resolve(explicit || process.env.GRIMOIRE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd())
}

export function loadProject(rootArg) {
  const root = projectRoot(rootArg)
  // A linked worktree with no config of its own reads the main checkout's, layered (project-config.mjs).
  const loaded = loadConfig(root)
  if (loaded.error) throw new Error(loaded.error)
  const config = loaded.config
  const g = config.graph || {}
  let repos = (config.repos || []).filter((r) => r && r.name && r.path).map((r) => ({ name: r.name, path: r.path }))
  if (Array.isArray(g.repos) && g.repos.length) repos = repos.filter((r) => g.repos.includes(r.name))
  // No repos[]: the root is one repository, named after the main checkout in every linked worktree,
  // so a worktree's rows match the index it was seeded from (a name per folder re-parsed it all).
  if (!repos.length) repos = [{ name: path.basename(mainCheckout(root) || root), path: '.' }]
  repos = repos.map((r) => ({ ...r, abs: path.resolve(root, r.path) })).filter((r) => existsSync(r.abs))
  const names = new Set(repos.map((r) => r.name))
  return {
    root,
    enabled: g.enabled !== false,
    configured: !!config.graph, // a `graph` block: refresh may build the first index
    baseBranch: typeof config.baseBranch === 'string' && config.baseBranch.trim() ? config.baseBranch.trim() : null,
    repos,
    dbPath: path.join(root, g.dir || '.grimoire/graph', 'graph.db'),
    exclude: compileGlobs(g.exclude || []),
    maxBytes: (Number(g.maxFileKB) || 512) * 1024,
    maxContractBytes: (Number(g.maxContractKB) || 4096) * 1024,
    architectureDir: path.resolve(root, g.architectureDir || 'docs/architecture'),
    dataMigrations: (Array.isArray(g.data?.migrations) ? g.data.migrations : [])
      .filter((m) => m && typeof m.path === 'string' && m.path.trim() && typeof m.dialect === 'string')
      .map((m) => {
        const i = m.path.indexOf(':')
        const repo = i > 0 && names.has(m.path.slice(0, i)) ? m.path.slice(0, i) : null
        const rel = path.posix.normalize((repo ? m.path.slice(i + 1) : m.path).trim().replace(/^\.\//, '')).replace(/\/+$/, '') || '.'
        return { repo, path: rel, dialect: m.dialect }
      }),
  }
}

// Files that may hold credentials: never searched (excluded from git grep, skipped before a read by
// the walk: reach.mjs), never opened by a reader of the repository's own configuration (readRepoText),
// never named. SECRET_GLOBS and SECRETISH say the same thing, for git and for the walk.
export const SECRET_GLOBS = ['.env*', '*.env', '.envrc', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore', '*.crt', '*.cer', '*.der', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*', 'credentials*', '.npmrc*', '.pypirc*', '.netrc', '.git-credentials', '.pgpass', '.htpasswd', '*.tfstate', '*.tfstate.*', '.docker/config.json']
export const SECRETISH = /(^|\/)(\.env[^/]*|[^/]*\.env|\.envrc|id_(rsa|dsa|ecdsa|ed25519)[^/]*|credentials[^/]*|\.npmrc[^/]*|\.pypirc[^/]*|\.netrc|\.git-credentials|\.pgpass|\.htpasswd|[^/]*\.tfstate(\.[^/]*)?|\.docker\/config\.json)$|\.(pem|key|p12|pfx|jks|keystore|crt|cer|der)$/i

// A repository file read as text by what follows a path the repository states (a tsconfig's
// `extends`, a workspace's package.json, a go.mod, a Cargo.toml), guarded as the data extractors'
// inputs are (indexer.mjs): never a path SECRETISH matches; its real path (every symbolic link
// followed, a folder's too) inside the repository's, or it is not read; a regular file only (never a
// device, a FIFO or a folder: `/dev/zero` is never read); at most `max` bytes (1 MB by default), a
// larger file not read at all. null when it is not read. root: the repository's real path, when the
// caller has it (else found once per call).
export const MAX_REPO_TEXT = 1 << 20
export function readRepoText(abs, rel, { max = MAX_REPO_TEXT, root = null } = {}) {
  if (typeof rel !== 'string' || !rel || SECRETISH.test(rel)) return null
  let rootReal = root, real
  try { rootReal ||= realpathSync(abs); real = realpathSync(path.join(abs, rel)) } catch { return null }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null
  if (SECRETISH.test(path.relative(rootReal, real).split(path.sep).join('/'))) return null
  let fd = null
  try {
    const pre = statSync(real) // before the open: a FIFO's open would wait for a writer
    if (!pre.isFile() || pre.size > max) return null
    fd = openSync(real, 'r')
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > max) return null
    const buf = Buffer.alloc(st.size)
    let n = 0
    while (n < st.size) { const k = readSync(fd, buf, n, st.size - n, n); if (k <= 0) break; n += k }
    return buf.toString('utf8', 0, n)
  } catch { return null } finally { if (fd !== null) try { closeSync(fd) } catch {} }
}

// Directories never worth indexing: dependencies, build output, caches, generated trees.
export const SKIP_DIRS = new Set(['node_modules', '.git', '.grimoire', '.worktrees', 'vendor', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit', '.turbo', 'coverage', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', 'Pods', 'DerivedData', '.gradle', '.idea', 'bower_components', 'third_party', '.terraform', '.terragrunt-cache'])
const SKIP_FILE = /\.(min|bundle|generated|pb)\.[^/]+$|\.d\.ts$|(^|\/)(package-lock|yarn\.lock|pnpm-lock)|\.terraform\.lock\.hcl$/

// Minimal globs: `*` within a segment, `**` across segments, a bare name matches any segment.
export function compileGlobs(globs) {
  return globs.map((g) => {
    if (!/[*/]/.test(g)) return new RegExp(`(^|/)${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}(/|$)`)
    const re = g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
    return new RegExp(`^${re}$|^${re}/`)
  })
}

// The size cap of a file: a contract file's is the larger of the two caps.
export const maxBytesOf = (project, rel) => (isContract(rel) ? Math.max(project.maxBytes, project.maxContractBytes || 0) : project.maxBytes)

export const skipped = (rel, project) => rel.split('/').some((s) => SKIP_DIRS.has(s)) || SKIP_FILE.test(rel) || project.exclude.some((re) => re.test(rel))

// Every file of a directory, relative to it: git's view (tracked + untracked, .gitignore
// honoured) when it is a git work tree, a directory walk otherwise.
export function listPaths(abs) {
  const git = spawnSync('git', ['-C', abs, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (git.status === 0) return git.stdout.split('\0').filter(Boolean)
  const rels = []
  const walk = (dir, rel) => {
    let ents = []
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), r) }
      else if (e.isFile()) rels.push(r)
    }
  }
  walk(abs, '')
  return rels
}

// Every indexable file of a repository (rels: its file list, when the caller has it already).
export function scanRepo(repo, project, rels = listPaths(repo.abs)) {
  const out = []
  for (const rel of rels) {
    const lang = langOf(rel)
    if (!lang || skipped(rel, project)) continue
    let st
    try { st = statSync(path.join(repo.abs, rel)) } catch { continue }
    if (!st.isFile() || st.size > maxBytesOf(project, rel)) continue
    out.push({ path: rel, lang, size: st.size, mtime: Math.floor(st.mtimeMs) })
  }
  return out
}

export function gitHead(repo) {
  const r = spawnSync('git', ['-C', repo.abs, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}
