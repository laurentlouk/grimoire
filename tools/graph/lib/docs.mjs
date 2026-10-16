// grimoire graph · the project's Markdown notes, for the page's Docs tab and the editing server.
// Notes are read from disk at render time, never indexed: every .md / .markdown file of each
// repository (git's view, .gitignore honoured, the graph's skips and excludes applied), plus the
// project root itself when no repository sits there (a hub's AGENTS.md, memory/ and docs/). The
// root's scan leaves out the repositories under it: each note is listed once, under its repository.
//
// Writing is resolveDoc's job: a path is accepted only when it names a .md file inside one of these
// roots, outside every skipped directory, and its real location (symlinks resolved) stays inside the
// root. The server (serve.mjs) writes nothing else.
import { readFileSync, statSync, realpathSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { listPaths, skipped } from './project.mjs'

const DOC = /\.(md|markdown)$/i
const MAX_TOTAL = 12 * 1024 * 1024 // the page embeds every note: past this, the rest are listed without their text

export const docHash = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)

// [{ name, rel (project-relative root, '.' for the root), abs }]
export function docRoots(project) {
  const roots = (project.repos || []).map((r) => ({ name: r.name, rel: r.path === '.' ? '.' : path.relative(project.root, r.abs) || '.', abs: r.abs }))
  if (project.root && !roots.some((r) => r.abs === path.resolve(project.root))) {
    const base = path.basename(project.root)
    roots.unshift({ name: roots.some((r) => r.name === base) ? '(project)' : base, rel: '.', abs: path.resolve(project.root), hub: true })
  }
  return roots
}

// → [{ repo, root, path, text, hash, size, mtime, big? }], sorted by repo then path
export function scanDocs(project) {
  const roots = docRoots(project)
  const out = []
  let total = 0
  for (const r of roots) {
    const inner = r.hub ? roots.filter((o) => o !== r).map((o) => path.relative(r.abs, o.abs)).filter((p) => p && !p.startsWith('..')) : []
    for (const rel of listPaths(r.abs).sort()) {
      if (!DOC.test(rel) || skipped(rel, project) || inner.some((p) => rel === p || rel.startsWith(p + '/'))) continue
      let st
      try { st = statSync(path.join(r.abs, rel)) } catch { continue }
      if (!st.isFile()) continue
      const big = st.size > project.maxBytes || total + st.size > MAX_TOTAL
      const text = big ? '' : readFileSync(path.join(r.abs, rel), 'utf8')
      total += text.length
      out.push({ repo: r.name, root: r.rel, path: rel, text, hash: big ? '' : docHash(text), size: st.size, mtime: Math.floor(st.mtimeMs), ...(big ? { big: true } : {}) })
    }
  }
  return out
}

// A note the server may read or write: { repo, path } → { abs, root } or { error }.
// `create` allows a file that does not exist yet; missing folders are made (mkdir), provided the
// nearest folder that exists is inside the root.
export function resolveDoc(project, repo, rel, { create = false } = {}) {
  const root = docRoots(project).find((r) => r.name === repo)
  if (!root) return { error: `unknown repository ${JSON.stringify(repo)}` }
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) return { error: 'not a relative path' }
  const norm = path.posix.normalize(rel)
  if (norm !== rel || norm.startsWith('../') || norm === '..' || norm.split('/').some((s) => s === '' || s === '.' || s === '..')) return { error: 'not a plain relative path' }
  if (!DOC.test(norm)) return { error: 'only .md and .markdown notes can be written' }
  if (skipped(norm, project)) return { error: 'that folder is skipped (dependencies, build output, caches, .git)' }
  if (root.hub && docRoots(project).some((o) => o !== root && (norm + '/').startsWith(path.relative(root.abs, o.abs) + '/'))) return { error: 'that note belongs to another repository' }
  const abs = path.join(root.abs, norm)
  const realRoot = realpathSync(root.abs)
  const inside = (p) => p === realRoot || p.startsWith(realRoot + path.sep)
  if (existsSync(abs)) {
    if (!inside(realpathSync(abs))) return { error: 'the note resolves outside its repository' }
    if (!statSync(abs).isFile()) return { error: 'not a file' }
    return { abs, root }
  }
  if (!create) return { error: 'no such note' }
  let dir = path.dirname(abs)
  while (!existsSync(dir)) dir = path.dirname(dir)
  if (!inside(realpathSync(dir)) || !statSync(dir).isDirectory()) return { error: 'the folder resolves outside its repository' }
  return { abs, root, created: true }
}
