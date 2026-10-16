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
// through resolveDoc only.
import { readFileSync, statSync, lstatSync, realpathSync, existsSync } from 'node:fs'
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
