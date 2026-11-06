// grimoire graph · the project's Markdown notes, for the page's Docs tab and the editing server.
// Notes are read from disk at render time, never indexed: every .md / .markdown file of each
// repository (git's view, .gitignore honoured, the graph's skips and excludes applied), plus the
// project root itself when no repository sits there (a hub's AGENTS.md, memory/ and docs/). The
// root's scan leaves out the repositories under it: each note is listed once, under its repository.
//
// Reading and writing share one rule (noteRule), applied to the path asked for AND to the real file
// behind it: a note is a .md / .markdown file inside its root, outside every skipped or excluded
// folder (compared without case: macOS and Windows file systems ignore it), and not in another
// repository of a hub. So a tracked symlink can neither carry a file into the page (a secret outside
// the repository, .git/config or .env inside it) nor take a write to one, and a note symlinked to
// another note is saved through to its real file, so the link stays. The server (serve.mjs) writes
// through resolveDoc, and through resolveDelta for the one other file it writes: a design delta's
// acknowledgements (docs/specs/<name>.delta.json, below).
import { readFileSync, readdirSync, statSync, lstatSync, realpathSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { listPaths, skipped, SKIP_DIRS } from './project.mjs'

const DOC = /\.(md|markdown)$/i
const MAX_TOTAL = 12 * 1024 * 1024 // the page embeds every note: past this, the rest are listed without their text

export const docHash = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
const SKIP_LOWER = new Set([...SKIP_DIRS].map((d) => d.toLowerCase()))

// [{ name, rel (project-relative root, '.' for the root), abs }]
export function docRoots(project) {
  const roots = (project.repos || []).map((r) => ({ name: r.name, rel: r.path === '.' ? '.' : path.relative(project.root, r.abs) || '.', abs: r.abs }))
  if (project.root && !roots.some((r) => r.abs === path.resolve(project.root))) {
    const base = path.basename(project.root)
    roots.unshift({ name: roots.some((r) => r.name === base) ? '(project)' : base, rel: '.', abs: path.resolve(project.root), hub: true })
  }
  return roots
}

// What counts as a note in one root: why(rel) for a path relative to it, whyReal(real) for the real
// file behind one; each answers null for a note, else the reason it is not.
function noteRule(project, roots, r) {
  let realRoot
  try { realRoot = realpathSync(r.abs) } catch { return null }
  const real = (p) => { try { return realpathSync(p) } catch { return null } }
  const others = r.hub ? roots.filter((o) => o !== r).map((o) => real(o.abs)).filter(Boolean).map((p) => path.relative(realRoot, p).split(path.sep).join('/').toLowerCase()).filter((p) => p && !p.startsWith('..')) : []
  const exclude = (project.exclude || []).map((re) => new RegExp(re.source, 'i'))
  const why = (rel) => {
    if (!DOC.test(rel)) return 'only .md and .markdown notes can be written'
    if (skipped(rel, project) || exclude.some((re) => re.test(rel)) || rel.split('/').slice(0, -1).some((s) => SKIP_LOWER.has(s.toLowerCase()))) return 'that folder is skipped (dependencies, build output, caches, .git) or excluded'
    if (others.some((o) => (rel.toLowerCase() + '/').startsWith(o + '/'))) return 'that note belongs to another repository'
    return null
  }
  const whyReal = (p) => (p === realRoot || p.startsWith(realRoot + path.sep) ? why(path.relative(realRoot, p).split(path.sep).join('/')) : 'the note resolves outside its repository')
  return { realRoot, why, whyReal }
}

// → [{ repo, root, path, text, hash, size, mtime, big? }], sorted by repo then path
export function scanDocs(project) {
  const roots = docRoots(project)
  const out = []
  let total = 0
  for (const r of roots) {
    const rule = noteRule(project, roots, r)
    if (!rule) continue
    for (const rel of listPaths(r.abs).sort()) {
      if (rule.why(rel)) continue
      let st, real
      try { real = realpathSync(path.join(r.abs, rel)); st = statSync(real) } catch { continue }
      if (!st.isFile() || rule.whyReal(real)) continue // a symlink to anything but a note of this root is never read
      const big = st.size > project.maxBytes || total + st.size > MAX_TOTAL
      const text = big ? '' : readFileSync(real, 'utf8')
      total += text.length
      out.push({ repo: r.name, root: r.rel, path: rel, text, hash: big ? '' : docHash(text), size: st.size, mtime: Math.floor(st.mtimeMs), ...(big ? { big: true } : {}) })
    }
  }
  return out
}

// A note the server may read or write: { repo, path } → { abs (the real file), root, created? } or
// { error }. `create` allows a file that does not exist yet; missing folders are made (mkdir),
// provided the nearest folder that exists is inside the root.
export function resolveDoc(project, repo, rel, { create = false } = {}) {
  const roots = docRoots(project)
  const root = roots.find((r) => r.name === repo)
  if (!root) return { error: `unknown repository ${JSON.stringify(repo)}` }
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) return { error: 'not a relative path' }
  const norm = path.posix.normalize(rel)
  if (norm !== rel || norm.startsWith('../') || norm === '..' || norm.split('/').some((s) => s === '' || s === '.' || s === '..')) return { error: 'not a plain relative path' }
  const rule = noteRule(project, roots, root)
  if (!rule) return { error: 'the repository folder is missing' }
  const no = rule.why(norm)
  if (no) return { error: no }
  const abs = path.join(root.abs, norm)
  if (existsSync(abs)) {
    const real = realpathSync(abs)
    const bad = rule.whyReal(real)
    if (bad) return { error: bad === 'the note resolves outside its repository' ? bad : `it is a link to something that is not a note here (${bad})` }
    if (!statSync(real).isFile()) return { error: 'not a file' }
    return { abs: real, root }
  }
  let link = null
  try { link = lstatSync(abs) } catch {}
  if (link) return { error: 'a symlink that points nowhere' }
  if (!create) return { error: 'no such note' }
  let dir = path.dirname(abs)
  while (!existsSync(dir)) dir = path.dirname(dir)
  const realDir = realpathSync(dir)
  if (!(realDir === rule.realRoot || realDir.startsWith(rule.realRoot + path.sep)) || !statSync(dir).isDirectory()) return { error: 'the folder resolves outside its repository' }
  const target = path.join(realDir, path.relative(dir, abs)) // where the new note really lands
  const bad = rule.whyReal(target)
  if (bad) return { error: `its folder links to somewhere notes are not written (${bad})` }
  return { abs: target, root, created: true }
}

// ── the design deltas (data/delta.mjs) beside the specs ──
// The one other file the server writes: a design's delta, docs/specs/<name>.delta.json in a root,
// and only to set or remove an acknowledgement. The path asked for and the real file behind it must
// both be one: a plain relative path (no `..`, no absolute path), a file that exists (never created
// here), and, when it is a symlink, one to another delta beside the specs of the same root.
export const DELTA_PATH = /^docs\/specs\/[^/]+\.delta\.json$/
export function resolveDelta(project, repo, rel) {
  const root = docRoots(project).find((r) => r.name === repo)
  if (!root) return { error: `unknown repository ${JSON.stringify(repo)}` }
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) return { error: 'not a relative path' }
  if (path.posix.normalize(rel) !== rel || rel.split('/').some((s) => s === '' || s === '.' || s === '..')) return { error: 'not a plain relative path' }
  if (!DELTA_PATH.test(rel)) return { error: 'only a design delta is written here: docs/specs/<name>.delta.json' }
  let realRoot, real
  try { realRoot = realpathSync(root.abs) } catch { return { error: 'the repository folder is missing' } }
  const abs = path.join(root.abs, rel)
  try { real = realpathSync(abs) } catch { let link = null; try { link = lstatSync(abs) } catch {} return { error: link ? 'a symlink that points nowhere' : 'no such delta' } }
  if (!real.startsWith(realRoot + path.sep)) return { error: 'the delta resolves outside its repository' }
  if (!DELTA_PATH.test(path.relative(realRoot, real).split(path.sep).join('/'))) return { error: 'it is a link to something that is not a design delta' }
  if (!statSync(real).isFile()) return { error: 'not a file' }
  return { abs: real, root }
}
// Every delta beside the specs of each root, newest first (by name: specs start with their date):
// [{ repo, path, shown, abs, text, hash }]. One past the size limit is left out.
export function scanDeltas(project) {
  const out = []
  for (const r of docRoots(project)) {
    let names = []
    try { names = readdirSync(path.join(r.abs, 'docs', 'specs')).filter((n) => n.endsWith('.delta.json')) } catch { continue }
    for (const n of names) {
      const rel = `docs/specs/${n}`, x = resolveDelta(project, r.name, rel)
      if (x.error || statSync(x.abs).size > project.maxBytes) continue
      const text = readFileSync(x.abs, 'utf8')
      out.push({ repo: r.name, path: rel, shown: r.rel === '.' ? rel : `${r.rel}/${rel}`, abs: x.abs, text, hash: docHash(text) })
    }
  }
  return out.sort((a, b) => (path.basename(a.path) < path.basename(b.path) ? 1 : path.basename(a.path) > path.basename(b.path) ? -1 : a.shown < b.shown ? -1 : 1))
}
// The delta graph_changes reads (an MCP tool: its path is whatever the model asks for). Only a
// delta beside the specs of a root, as the server writes them (resolveDelta: the real file, symlinks
// resolved, is docs/specs/<name>.delta.json inside that root), named by a plain path relative to the
// project root (`docs/specs/x.delta.json` in the hub or a repository at the root, `<repo
// folder>/docs/specs/x.delta.json` in a repository). Anything else, a file that is missing, outside,
// another file, too large or unreadable, gets one refusal that says nothing about it: the path is
// never a way to read a file, nor to learn whether one exists.
export const DELTA_REFUSED = 'delta: give a docs/specs/<name>.delta.json path inside the project, relative to its root'
export function confinedDelta(project, file) {
  const plain = typeof file === 'string' && file && file.length <= 1024 && !file.includes('\0') && !file.includes('\\') && !path.isAbsolute(file) && path.posix.normalize(file) === file && !file.split('/').some((s) => s === '' || s === '.' || s === '..')
  for (const r of plain ? docRoots(project) : []) {
    const rel = r.rel === '.' ? file : file.startsWith(`${r.rel}/`) ? file.slice(r.rel.length + 1) : null
    if (!rel || !DELTA_PATH.test(rel) || resolveDelta(project, r.name, rel).error) continue
    const { abs } = resolveDelta(project, r.name, rel)
    try {
      if (statSync(abs).size > project.maxBytes) continue
      const text = readFileSync(abs, 'utf8')
      return { repo: r.name, path: rel, shown: file, abs, text, hash: docHash(text) }
    } catch { continue }
  }
  throw new Error(DELTA_REFUSED)
}
// One delta the user names on the command line (graph.mjs render and serve --delta): a path
// relative to the project root, or absolute, read wherever it is (the user's own shell could read it
// too); `repo` and `path` say where the server may write its acknowledgements, when it is beside the
// specs of a root. Throws when it cannot be read.
export function readDelta(project, file) {
  const abs = path.resolve(project.root, file)
  let text
  try { if (statSync(abs).size > project.maxBytes) throw new Error('too large'); text = readFileSync(abs, 'utf8') } catch (e) { throw new Error(`the delta ${file} cannot be read (${e.code || e.message})`) }
  const rel = path.relative(project.root, abs).split(path.sep).join('/')
  const at = docRoots(project).map((r) => ({ r, rel: path.relative(r.abs, abs).split(path.sep).join('/') })).find((x) => DELTA_PATH.test(x.rel) && !resolveDelta(project, x.r.name, x.rel).error)
  return { repo: at ? at.r.name : null, path: at ? at.rel : null, shown: rel && !rel.startsWith('..') ? rel : abs, abs, text, hash: docHash(text) }
}
