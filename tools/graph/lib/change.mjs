// grimoire graph · the impact of a change (graph_diff): what the working tree changed against a base,
// definition by definition, and everything that change can break that the diff itself does not show.
//
//   1. The diff: `git diff -U0 <merge base>` per repository (staged, unstaged; renames followed) and
//      the untracked files, as added and removed line ranges per file.
//   2. Definitions: the index's (the working tree) against the same files at the base, parsed in a
//      process of their own (symbols-aside.mjs). A definition is added, removed, moved (removed here,
//      added there under the same qualified name), or modified (its lines changed), and its signature
//      changed or not. Matched by kind and qualified name; a rename reads as removed + added.
//   3. Contract changes (removed, moved, signature changed): who still names them, from the edges,
//      the call sites resolution left unlinked, and every other mention (reach.mjs). A removed name
//      still called is the classic break a diff hides.
//   4. Impact: what reaches the changed definitions (calls, inheritance, imports, dispatch through
//      supertypes), split into the files this diff touches and the ones it does not.
//   5. Tests: the tests reaching each changed definition (tests to run) and the changed code no test
//      reaches; tests the diff edits.
//   6. Co-change gaps: files that usually change with a changed file (git history) and are not in
//      this diff.
//   7. A risk line, with its reasons. Everything is a lead: open path:line before relying on it.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { langOf, familyOf } from './langs.mjs'
import { skipped } from './project.mjs'
import { treeAt, blobs } from './data/base.mjs'
import { symbolsAside } from './symbols-aside.mjs'
import { unresolved, mentions, kindOfPath, USE_KINDS } from './reach.mjs'

const git = (dir, args) => spawnSync('git', ['-c', 'core.quotepath=off', '-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
const CALLABLE = new Set(['function', 'method', 'constructor', 'macro'])
const LISTED = 40, TEST_DEPTH = 6, GAP_MIN = 2, GAP_RATIO = 0.3

// `git diff -U0` → [{ path, oldPath, status A|M|D|R, added: [[from, to]], removed: [[from, to]], cuts: [line] }]
// (cuts: a pure deletion, after that line of the new side). C-quoted paths are unquoted.
export function parsePatch(text) {
  const files = []
  let cur = null
  const unq = (p) => { if (!p.startsWith('"')) return p; try { return JSON.parse(p) } catch { return p.slice(1, -1) } }
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) { cur = { path: null, oldPath: null, status: 'M', added: [], removed: [], cuts: [] }; files.push(cur); continue }
    if (!cur) continue
    if (line.startsWith('new file mode')) cur.status = 'A'
    else if (line.startsWith('deleted file mode')) cur.status = 'D'
    else if (line.startsWith('rename from ')) { cur.oldPath = unq(line.slice(12)); cur.status = 'R' }
    else if (line.startsWith('rename to ')) cur.path = unq(line.slice(10))
    else if (line.startsWith('--- ')) { const p = line.slice(4); if (p !== '/dev/null') cur.oldPath = unq(p).replace(/^a\//, '') }
    else if (line.startsWith('+++ ')) { const p = line.slice(4); if (p !== '/dev/null') cur.path = unq(p).replace(/^b\//, '') }
    else if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (!m) continue
      const os = Number(m[1]), ol = m[2] === undefined ? 1 : Number(m[2]), ns = Number(m[3]), nl = m[4] === undefined ? 1 : Number(m[4])
      if (ol) cur.removed.push([os, os + ol - 1])
      if (nl) cur.added.push([ns, ns + nl - 1])
      else cur.cuts.push(ns)
    }
  }
  for (const f of files) {
    if (f.status === 'D') f.path = null
    if (f.status === 'A') f.oldPath = null
    else if (!f.oldPath) f.oldPath = f.path
  }
  return files.filter((f) => f.path || f.oldPath)
}

// The innermost definitions holding any of the lines (ranges) or straddling a cut. defs: [{ line, endLine|end_line }]
export function touched(defs, ranges, cuts = []) {
  const end = (d) => d.endLine ?? d.end_line
  const hit = new Set()
  const innermost = (pred) => { let best = null; for (const d of defs) if (pred(d) && (!best || end(d) - d.line < end(best) - best.line)) best = d; return best }
  for (const [a, b] of ranges) {
    const top = Math.min(b, Math.max(0, ...defs.map(end)))
    for (let l = a; l <= top; l++) { const d = innermost((x) => x.line <= l && end(x) >= l); if (d) hit.add(d) }
  }
  for (const c of cuts) { const d = innermost((x) => x.line <= c && end(x) > c); if (d) hit.add(d) }
  return hit
}

// Match two lists of definitions by kind + qualified name (the nth of a name with the nth).
const keyed = (defs) => {
  const m = new Map(), n = new Map()
  for (const d of [...defs].sort((a, b) => a.line - b.line)) { const k = `${d.kind} ${d.qualname}`; const i = n.get(k) || 0; n.set(k, i + 1); m.set(i ? `${k}#${i}` : k, d) }
  return m
}

export function readDiff(base, project, repo = null) {
  const files = []
  for (const r of base.repos) {
    if (repo && r.name !== repo) continue
    const d = git(r.abs, ['diff', '-U0', '--no-color', '--no-ext-diff', '-M', '--relative', r.at, '--', '.'])
    if (d.status !== 0) throw new Error(`git diff failed in ${r.name}: ${(d.stderr || '').trim().split('\n')[0]}`)
    for (const f of parsePatch(d.stdout)) files.push({ repo: r.name, abs: r.abs, commit: r.at, ...f })
    const u = git(r.abs, ['ls-files', '--others', '--exclude-standard', '-z'])
    for (const p of (u.status === 0 ? u.stdout.split('\0') : []).filter(Boolean)) files.push({ repo: r.name, abs: r.abs, commit: r.at, path: p, oldPath: null, status: 'A', added: [[1, Number.MAX_SAFE_INTEGER]], removed: [], cuts: [] })
  }
  return files.filter((f) => !skipped(f.path || f.oldPath, project))
}

// The definitions of the diff's code files at the base: Map(`repo|oldPath` → defs | Error)
function baseDefs(files, project) {
  const out = new Map(), items = []
  const byRepo = new Map()
  for (const f of files) if (f.oldPath && f.status !== 'A') (byRepo.get(f.repo) || byRepo.set(f.repo, []).get(f.repo)).push(f)
  for (const list of byRepo.values()) {
    const { abs, commit } = list[0]
    let tree
    try { tree = treeAt(abs, commit, list.map((f) => f.oldPath)) } catch (e) { for (const f of list) out.set(`${f.repo}|${f.oldPath}`, e); continue }
    const want = list.map((f) => ({ f, entry: tree.get(f.oldPath) })).filter((x) => x.entry && x.entry.size <= project.maxBytes)
    const got = blobs(abs, want.map((x) => x.entry))
    for (const { f, entry } of want) {
      const buf = got.get(entry.oid)
      if (!buf) continue
      items.push({ key: `${f.repo}|${f.oldPath}`, path: f.oldPath, lang: langOf(f.oldPath), text: buf.toString('utf8') })
    }
  }
  const parsed = symbolsAside(items.map((x) => ({ path: x.key, lang: x.lang, text: x.text })))
  for (const [k, v] of parsed) out.set(k, v)
  return out
}

export function changeImpact(g, project, base, { repo = null, depth = 2, text = true } = {}) {
  const files = readDiff(base, project, repo)
  const isCode = (p) => { const l = p && langOf(p); return !!l && l !== 'other' }
  const code = files.filter((f) => isCode(f.path || f.oldPath))
  const others = files.filter((f) => !isCode(f.path || f.oldPath))
  const inDiff = new Set(files.flatMap((f) => [f.path && `${f.repo}|${f.path}`, f.oldPath && `${f.repo}|${f.oldPath}`].filter(Boolean)))
  const head = `Changes against ${base.text}`
  if (!files.length) return `${head}: none (the working tree matches it).`

  const based = baseDefs(code, project)
  const fileRow = g.db.prepare('SELECT * FROM files WHERE repo = ? AND path = ?')
  const defsOf = g.db.prepare("SELECT n.*, f.repo, f.path, f.lang FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.file_id = ? AND n.kind != 'file'")
  const changes = [] // { op: + - ~ >, node?, was?, file, sig?: { was, now } }
  const notes = []
  for (const f of code) {
    const row = f.path ? fileRow.get(f.repo, f.path) : null
    if (f.path && !row) { notes.push(`${g.loc({ repo: f.repo, path: f.path, kind: 'file' })}: not in the index (too large, excluded or not parsed): its definitions are not compared`); continue }
    const now = row ? defsOf.all(row.id) : []
    const was = f.oldPath && f.status !== 'A' ? based.get(`${f.repo}|${f.oldPath}`) : []
    if (was instanceof Error) notes.push(`${g.loc({ repo: f.repo, path: f.oldPath, kind: 'file' })}: the base version could not be parsed (${was.message}): its changed definitions are listed as modified, none as removed`)
    if (f.status === 'A') { for (const n of now) changes.push({ op: '+', node: n, file: f }); continue }
    if (!was || was instanceof Error) { for (const n of touched(now, f.added, f.cuts)) changes.push({ op: '~', node: n, file: f }); continue }
    const A = keyed(now), B = keyed(was)
    const nowHit = touched(now, f.added, f.cuts), wasHit = touched(was, f.removed)
    for (const [k, n] of A) {
      const w = B.get(k)
      if (!w) { changes.push({ op: '+', node: n, file: f }); continue }
      if (nowHit.has(n) || wasHit.has(w) || f.status === 'R') {
        const sig = (w.signature || '') !== (n.signature || '') ? { was: w.signature, now: n.signature } : null
        if (nowHit.has(n) || wasHit.has(w) || sig) changes.push({ op: '~', node: n, was: w, file: f, sig })
      }
    }
    for (const [k, w] of B) if (!A.has(k)) changes.push({ op: '-', was: w, file: f })
  }
  // removed here and added there under the same name: moved
  const added = changes.filter((c) => c.op === '+')
  for (const c of changes.filter((x) => x.op === '-')) {
    const to = added.find((a) => a.node.kind === c.was.kind && a.node.qualname === c.was.qualname && a.file !== c.file)
    if (to) { c.op = '>'; c.node = to.node; to.op = null; if ((c.was.signature || '') !== (to.node.signature || '')) c.sig = { was: c.was.signature, now: to.node.signature } }
  }
  const live = changes.filter((c) => c.op)
  const count = (op) => live.filter((c) => c.op === op).length
  const sigs = live.filter((c) => c.sig).length
  const out = [`${head}: ${files.length} file(s) (${code.length} code, ${others.length} other), ${live.length} definition(s): ${count('~')} modified${sigs ? ` (${sigs} with a new signature)` : ''}, ${count('+')} added, ${count('-')} removed, ${count('>')} moved`]
  for (const n of notes) out.push(`  note: ${n}`)

  // ── the definitions ──
  const wasLoc = (c) => g.loc({ repo: c.file.repo, path: c.file.oldPath, kind: 'x', line: c.was.line })
  const shown = live.filter((c) => !(c.op === '+' && c.node.parent_id && live.some((p) => p.op === '+' && p.node.id === c.node.parent_id))) // an added type stands for its members
  const order = { '-': 0, '>': 1, '~': 2, '+': 3 }
  shown.sort((a, b) => order[a.op] - order[b.op] || (b.sig ? 1 : 0) - (a.sig ? 1 : 0))
  // test code the diff adds is counted, not listed
  const addedTests = shown.filter((c) => c.op === '+' && c.node.is_test)
  const listed = shown.filter((c) => !addedTests.includes(c))
  out.push('Definitions:')
  for (const c of listed.slice(0, LISTED)) {
    if (c.op === '-') out.push(`  - ${c.was.qualname}  ${c.was.kind}  (was ${wasLoc(c)})`)
    else if (c.op === '>') out.push(`  > ${c.node.qualname}  ${c.node.kind}  moved: ${wasLoc(c)} → ${g.loc(c.node)}`)
    else out.push(`  ${c.op} ${g.row(c.node)}${c.op === '~' ? (c.sig ? '  signature changed' : '  body') : ''}`)
    if (c.sig) out.push(`      was: ${c.sig.was || '(none)'}`, `      now: ${c.sig.now || '(none)'}`)
  }
  if (listed.length > LISTED) out.push(`  … ${listed.length - LISTED} more`)
  if (addedTests.length) out.push(`  + ${addedTests.length} test definition(s) in ${new Set(addedTests.map((c) => c.node.path)).size} test file(s)`)
  if (others.length) {
    const tag = (f) => `${g.loc({ repo: f.repo, path: f.path || f.oldPath, kind: 'file' })} (${f.status === 'A' ? 'added ' : f.status === 'D' ? 'removed ' : ''}${kindOfPath(f.path || f.oldPath)})`
    out.push(`Other files changed: ${others.slice(0, 20).map(tag).join(', ')}${others.length > 20 ? `, … ${others.length - 20} more` : ''}`)
  }

  // ── contract changes: who still names them ──
  const contract = live.filter((c) => c.op === '-' || c.op === '>' || c.sig)
  const risk = []
  if (contract.length) {
    const pseudo = (c) => ({ id: -1, name: c.was.name, qualname: c.was.qualname, kind: c.was.kind, lang: langOf(c.file.oldPath), repo: c.file.repo, path: c.file.oldPath, line: -1, parent_id: null })
    const subjects = contract.map((c) => ({ c, t: c.op === '-' ? pseudo(c) : c.node }))
    const terms = new Map()
    for (const s of subjects) if (!['constructor'].includes(s.t.kind)) { if (!terms.has(s.t.name)) terms.set(s.t.name, []); terms.get(s.t.name).push(s.t) }
    const ment = project && text ? mentions(g, project, [...terms].map(([term, targets]) => ({ term, targets }))) : null
    out.push('Contract changes (removed, moved, new signature): who still names them')
    for (const { c, t } of subjects.slice(0, 20)) {
      const what = c.op === '-' ? `removed ${c.was.qualname}` : c.op === '>' ? `moved ${c.node.qualname}` : `new signature of ${c.node.qualname}`
      const callers = t.id > 0 ? g.q("SELECT DISTINCT s.id FROM edges e JOIN nodes s ON s.id = e.src WHERE e.dst = ? AND e.kind IN ('CALLS','EXTENDS','IMPLEMENTS')", t.id).map((r) => g.node(r.id)) : []
      const sites = unresolved(g, [t])
      const hits = ment ? ment.hits.filter((h) => h.term === t.name && (c.op !== '>' || USE_KINDS.has(h.kind))) : []
      const outside = callers.filter((n) => !inDiff.has(`${n.repo}|${n.path}`))
      const loose = [...sites.filter((s) => !inDiff.has(`${s.ref.repo}|${s.ref.path}`)), ...hits.filter((h) => USE_KINDS.has(h.kind) && !inDiff.has(`${h.repo}|${h.path}`))]
      out.push(`  ${what}: ${callers.length} linked caller(s)${callers.length ? ` (${outside.length} outside this diff)` : ''}, ${sites.length} unlinked call site(s), ${hits.length} other mention(s)`)
      for (const n of callers.slice(0, 10)) out.push(`    caller  ${g.row(n)}${inDiff.has(`${n.repo}|${n.path}`) ? '  (in this diff)' : ''}`)
      for (const s of sites.slice(0, 10)) out.push(`    call    ${g.loc({ repo: s.ref.repo, path: s.ref.path, kind: 'x', line: s.ref.line })}  ${s.src && s.src.kind !== 'file' ? `in ${s.src.qualname}` : 'at file level'}  ${s.ref.qual ? `${s.ref.qual}.` : ''}${s.ref.name}${inDiff.has(`${s.ref.repo}|${s.ref.path}`) ? '  (in this diff)' : ''}`)
      const uses = hits.filter((h) => USE_KINDS.has(h.kind))
      if (hits.length > uses.length) out.push(`    (${hits.length - uses.length} more in text, docs and comments: graph_impact lists them)`)
      for (const h of uses.slice(0, 10)) out.push(`    ${h.kind.padEnd(7)} ${g.loc({ repo: h.repo, path: h.path, kind: 'x', line: h.line })}${h.where ? `  in ${h.where}` : ''}${inDiff.has(`${h.repo}|${h.path}`) ? '  (in this diff)' : ''}`)
      if (outside.length || loose.length) risk.push(`${what} is still named outside this diff (${outside.length + loose.length} place(s))`)
    }
    if (subjects.length > 20) out.push(`  … ${subjects.length - 20} more`)
    for (const cm of ment ? ment.common : []) out.push(`  "${cm.term}" appears on ${cm.n} lines of ${cm.repo}: too common to sort`)
  }

  // ── files renamed or removed: imports still pointing at the old path ──
  // An import the resolver could not link whose last segment is the old file's name (`../auth/session`,
  // `app.auth.session`, `crate::auth::session`), in the same language family: it was this file's.
  const gone = code.filter((f) => f.oldPath && (f.status === 'D' || f.status === 'R'))
  if (gone.length) {
    const stale = g.db.prepare('SELECT i.line, i.source, f.repo, f.path, f.lang FROM imports i JOIN files f ON f.id = i.file_id WHERE i.resolved = 0 AND f.repo = ?')
    const famOf = (p) => familyOf(langOf(p))
    const stem = (p) => path.posix.basename(p).replace(/\.[^.]+$/, '')
    const lines = []
    for (const f of gone) {
      const st = stem(f.oldPath)
      if (/^(index|__init__|mod|main|lib)$/.test(st)) continue // a folder's entry: named by its folder, too common to match
      const hits = stale.all(f.repo).filter((i) => famOf(i.path) === famOf(f.oldPath) && i.source.split(/[/.:\\]+/).filter(Boolean).pop() === st)
      const outside = hits.filter((i) => !inDiff.has(`${i.repo}|${i.path}`))
      lines.push(`  ${f.status === 'D' ? 'removed' : 'renamed'} ${g.loc({ repo: f.repo, path: f.oldPath, kind: 'file' })}${f.status === 'R' ? ` → ${f.path}` : ''}: ${hits.length} unresolved import(s) still name it${hits.length ? ` (${outside.length} outside this diff)` : ''}`)
      for (const i of hits.slice(0, 10)) lines.push(`    import  ${g.loc({ repo: i.repo, path: i.path, kind: 'x', line: i.line })}${inDiff.has(`${i.repo}|${i.path}`) ? '  (in this diff)' : ''}`)
      if (outside.length) risk.push(`${f.status === 'D' ? 'removed' : 'renamed'} file ${f.oldPath} is still imported outside this diff (${outside.length})`)
    }
    if (lines.length) out.push('Files renamed or removed: imports the resolver can no longer follow', ...lines)
  }

  // ── impact: what reaches the changed definitions ──
  const nodes = live.filter((c) => c.node && c.op !== '+').map((c) => c.node)
  const r = nodes.length ? g.reachData(nodes, { depth, project: null, text: false, members: false }) : { byFile: new Map(), dispatch: [] }
  const outsideFiles = [...r.byFile.entries()].filter(([k]) => !inDiff.has(k))
  const insideN = r.byFile.size - outsideFiles.length
  out.push(`Impact (depth ${depth}): ${r.byFile.size} file(s) reach the changed definitions, ${outsideFiles.length} of them outside this diff${insideN ? ` (${insideN} in it)` : ''}`)
  outsideFiles.sort((a, b) => Math.min(...a[1].map(([, i]) => i.depth)) - Math.min(...b[1].map(([, i]) => i.depth)))
  for (const [, list] of outsideFiles.slice(0, 30)) {
    const f = list[0][0]
    const syms = list.filter(([n]) => n.kind !== 'file').sort((a, b) => a[1].depth - b[1].depth)
    out.push(`  ${g.loc({ ...f, kind: 'file' })}  (distance ${Math.min(...list.map(([, i]) => i.depth))})${syms.length ? `  ${syms.slice(0, 5).map(([n, i]) => `${n.qualname}:${n.line} d${i.depth}`).join(', ')}${syms.length > 5 ? `, … ${syms.length - 5} more` : ''}` : ''}`)
  }
  if (outsideFiles.length > 30) out.push(`  … ${outsideFiles.length - 30} more file(s)`)
  for (const d of r.dispatch) {
    for (const u of d.up) out.push(`  dispatch: ${d.target.qualname} is declared on ${u.type.kind} ${u.type.qualname} (${g.loc(u.node)}): calls typed to it may land here`)
    for (const x of d.down) if (!inDiff.has(`${x.node.repo}|${x.node.path}`) || !live.some((c) => c.node && c.node.id === x.node.id)) out.push(`  ${['interface', 'trait', 'protocol'].includes(d.owner.kind) ? 'implementation' : 'override'} not changed here: ${g.row(x.node)}`)
  }

  // ── tests ──
  const testsOf = new Map()
  const reachTests = new Map()
  for (const c of live) {
    if (!c.node || c.node.is_test) continue
    const ts = [...g.walk([c.node.id], ['CALLS', 'IMPORTS'], 'in', TEST_DEPTH).entries()].filter(([id, i]) => i.depth > 0 && g.node(id).is_test).map(([id, i]) => [g.node(id), i])
    testsOf.set(c, ts)
    for (const [n, i] of ts) { const k = `${n.repo}|${n.path}`; if (!reachTests.has(k) || reachTests.get(k).d > i.depth) reachTests.set(k, { n, d: i.depth }) }
  }
  const changedTests = files.filter((f) => f.path && fileRow.get(f.repo, f.path)?.is_test)
  out.push(`Tests to run: ${reachTests.size} test file(s) reach the changed definitions${changedTests.length ? `; ${changedTests.length} test file(s) changed in this diff` : ''}`)
  for (const { n, d } of [...reachTests.values()].sort((a, b) => a.d - b.d).slice(0, 25)) out.push(`  ${g.loc({ ...n, kind: 'file' })}  (distance ${d})${inDiff.has(`${n.repo}|${n.path}`) ? '  (in this diff)' : ''}`)
  // a function nested in another is tested through it: only the outermost callable counts
  const nested = (n) => { const p = n.parent_id && g.node(n.parent_id); return !!p && CALLABLE.has(p.kind) }
  const untested = live.filter((c) => c.node && !c.node.is_test && CALLABLE.has(c.node.kind) && !nested(c.node) && !(testsOf.get(c) || []).length)
  if (untested.length) {
    out.push(`Changed code no test reaches (${untested.length}; the graph misses tests that reach code dynamically: check before writing one):`)
    for (const c of untested.slice(0, 20)) out.push(`  ${c.op} ${g.row(c.node)}`)
    if (untested.length > 20) out.push(`  … ${untested.length - 20} more`)
    // with callers: a CALLS edge into it, or into a declaration it implements (dispatch)
    const callersIn = g.db.prepare("SELECT 1 FROM edges WHERE dst = ? AND kind = 'CALLS' LIMIT 1")
    const used = untested.filter((c) => c.op !== '+' && [c.node, ...(r.dispatch.find((d) => d.target.id === c.node.id)?.up || []).map((u) => u.node)].some((n) => callersIn.get(n.id)))
    if (used.length) risk.push(`${used.length} changed definition(s) with callers and no test reaching them`)
  }

  // ── co-change gaps ──
  const churn = g.db.prepare('SELECT n FROM churn WHERE repo = ? AND path = ?')
  const gaps = new Map()
  for (const f of files) {
    if (!f.path) continue
    const total = churn.get(f.repo, f.path)?.n || 0
    if (!total) continue
    for (const c of g.q('SELECT b, n FROM cochange WHERE repo = ? AND a = ? ORDER BY n DESC', f.repo, f.path)) {
      const k = `${f.repo}|${c.b}`
      if (inDiff.has(k) || c.n < GAP_MIN || c.n / total < GAP_RATIO) continue
      const ratio = c.n / total
      if (!gaps.has(k) || gaps.get(k).ratio < ratio) gaps.set(k, { repo: f.repo, path: c.b, from: f.path, n: c.n, total, ratio })
    }
  }
  if (gaps.size) {
    const list = [...gaps.values()].sort((a, b) => b.ratio - a.ratio || b.n - a.n)
    out.push(`Usually changes with these files, not in this diff (git history: shared commits / commits of the changed file):`)
    for (const x of list.slice(0, 12)) out.push(`  ${g.loc({ repo: x.repo, path: x.path, kind: 'file' })}  with ${x.from}: ${x.n}/${x.total}`)
    const strong = list.filter((x) => x.ratio >= 0.5)
    if (strong.length) risk.push(`${strong.length} file(s) that change with these at least half the time are not in this diff`)
  }

  out.push(`Risk: ${risk.length ? (risk.some((x) => x.includes('still named') || x.includes('still imported')) ? 'high' : 'medium') : 'low'}${risk.length ? `: ${risk.join('; ')}` : ' (no contract change still named outside the diff, changed code with callers is tested, no usual partner missing)'}`)
  return out.join('\n')
}
