// grimoire graph · the page's Docs tab: the project's Markdown notes, read and edited the way an
// Obsidian vault is. Runs in the browser only: render.mjs injects this function's source next to
// the Markdown helpers (md.mjs) and calls it with the page's context.
//   explorer  every note in a folder tree, per repository; the header search filters by path and
//             by text, with the matching line
//   note      reading view (rendered), source (edit) or both side by side; front matter shown as
//             properties; Ctrl/⌘-E switches reading and editing, Ctrl/⌘-S saves
//   rail      outline, backlinks (notes linking here, with the line), the code it mentions (inline
//             code and links that name an indexed file open its neighbourhood), unresolved links
// Links resolve like a vault: [[name]] by file name (same repository, then same folder, then the
// shortest path), [[folder/name#Heading|alias]], relative Markdown links, `path/to/file.ts:12`.
// Saving needs the local server (graph.mjs serve): a static page is a read-only snapshot. The
// server refuses a save when the file changed on disk since it was loaded, and the page offers to
// load the disk version or overwrite it.
export function docsClient(ctx) {
  const { D, h, st, files, render, plural, jumpFile } = ctx
  const SERVE = D.serve || null
  const RICH_MAX = 200000 // a longer note shows as plain text and is left out of the links
  const MAC = /Mac|iPhone|iPad/.test((typeof navigator !== 'undefined' && navigator.platform) || '')
  const docs = (D.docs || []).map(([repo, root, path, text, hash, big], i) => {
    const shown = root && root !== '.' ? `${root}/${path}` : path
    const base = path.split('/').pop()
    // a textarea hands back LF only: a CRLF note is saved back with CRLF
    return { i, repo, root, path, text, hash, big: !!big, eol: text.includes('\r\n') ? '\r\n' : '\n', shown, name: base.replace(/\.(md|markdown)$/i, ''), dir: shown.includes('/') ? shown.slice(0, shown.lastIndexOf('/')) : '' }
  })
  const multi = new Set(docs.map((d) => d.repo)).size > 1
  const drafts = new Map() // doc index → unsaved text
  const lower = (s) => s.toLowerCase()
  const byName = new Map(), byPath = new Map()
  const indexDoc = (d) => {
    (byName.get(lower(d.name)) || byName.set(lower(d.name), []).get(lower(d.name))).push(d)
    byPath.set(lower(d.shown), d); byPath.set(lower(d.shown.replace(/\.(md|markdown)$/i, '')), d)
  }
  docs.forEach(indexDoc)
  const fileByShown = new Map([...files.values()].map((f) => [f.shown, f]))
  const tail = new Map() // last path segment → [{ doc } | { file }]
  for (const f of files.values()) { const k = lower(f.shown.split('/').pop()); (tail.get(k) || tail.set(k, []).get(k)).push({ file: f, shown: f.shown }) }
  for (const d of docs) { const k = lower(d.shown.split('/').pop()); (tail.get(k) || tail.set(k, []).get(k)).push({ doc: d, shown: d.shown }) }

  const norm = (p) => { const out = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s) } return out.join('/') }
  function pick(cands, from) {
    if (!cands || !cands.length) return null
    const score = (d) => (d.repo === from.repo ? 0 : 2) + (d.dir === from.dir ? 0 : 1)
    return cands.slice().sort((a, b) => score(a) - score(b) || a.shown.length - b.shown.length)[0]
  }
  function resolve(ref, from) {
    const t = ref.target
    if (ref.kind === 'url') return /^(https?:|mailto:)/i.test(t) ? { url: t } : null
    if (ref.kind === 'wiki' || ref.kind === 'embed') {
      const [name, heading] = t.split('#')
      const anchor = heading ? mdSlug(heading) : undefined
      if (!name.trim()) return anchor ? { anchor } : null
      const n = lower(name.trim().replace(/\.(md|markdown)$/i, ''))
      // a path is read from the note's own repository first, then the project, then as a suffix
      const d = n.includes('/') ? byPath.get(lower(norm(`${from.root !== '.' ? from.root + '/' : ''}${n}`))) || byPath.get(n) || pick(docs.filter((x) => lower(x.shown.replace(/\.(md|markdown)$/i, '')).endsWith('/' + n)), from) : pick(byName.get(n), from)
      if (d) return { doc: d.i, anchor }
      return /\.[a-z0-9]{1,8}$/i.test(name.trim()) && !/\.(md|markdown)$/i.test(name.trim()) ? null : { missing: name.trim() } // an image or a file is no missing note
    }
    if (ref.kind === 'md') {
      let [p, frag] = t.split('#')
      try { p = decodeURIComponent(p) } catch {}
      try { frag = frag && decodeURIComponent(frag) } catch {}
      const anchor = frag ? mdSlug(frag) || frag.toLowerCase() : undefined
      if (!p) return anchor ? { anchor } : null
      const rootPre = from.root && from.root !== '.' ? from.root + '/' : ''
      const full = norm(p.startsWith('/') ? rootPre + p.slice(1) : `${from.dir ? from.dir + '/' : ''}${p}`)
      const d = byPath.get(lower(full)) || byPath.get(lower(`${full}/readme.md`)) // a folder opens its README
      if (d) return { doc: d.i, anchor }
      const f = fileByShown.get(full)
      return f ? { file: f.id } : null
    }
    if (ref.kind === 'code') {
      const m = /^(.+?)(?::(\d+)(?:-\d+)?)?$/.exec(t)
      const p = m[1].replace(/^\.\//, '')
      const rel = norm(`${from.dir ? from.dir + '/' : ''}${p}`), inRepo = norm(`${from.root !== '.' ? from.root + '/' : ''}${p}`)
      for (const k of [inRepo, rel, p]) { const d = byPath.get(lower(k)); if (d) return { doc: d.i }; const f = fileByShown.get(k); if (f) return { file: f.id, line: m[2] } }
      if (!/\.[a-z0-9]{1,8}$/i.test(p)) return null
      const cands = (tail.get(lower(p.split('/').pop())) || []).filter((c) => lower(c.shown) === lower(p) || lower(c.shown).endsWith('/' + lower(p)))
      if (cands.length !== 1) return null
      return cands[0].doc ? { doc: cands[0].doc.i } : { file: cands[0].file.id, line: m[2] }
    }
    return null
  }

  // ── links between notes, and from notes to code: computed once, refreshed per saved note ──
  let linked = null
  const refsOf = new Map()
  function analyzeDoc(d) {
    const out = {}
    if (d.text.length <= RICH_MAX) try { mdToHtml(d.text, (r) => resolve(r, d), out) } catch { out.refs = []; out.headings = [] }
    refsOf.set(d.i, { refs: out.refs || [], headings: out.headings || [] })
  }
  function links() {
    if (linked) return linked
    for (const d of docs) analyzeDoc(d)
    linked = rebuild()
    return linked
  }
  function rebuild() {
    const back = new Map(), mentions = new Map(), missing = new Map()
    for (const d of docs) for (const r of (refsOf.get(d.i) || { refs: [] }).refs) {
      const to = r.to
      if (!to) continue
      if (to.doc !== undefined && to.doc !== d.i) (back.get(to.doc) || back.set(to.doc, new Map()).get(to.doc)).set(d.i, r)
      if (to.file !== undefined) (mentions.get(to.file) || mentions.set(to.file, new Set()).get(to.file)).add(d.i)
      if (to.missing !== undefined) (missing.get(d.i) || missing.set(d.i, new Set()).get(d.i)).add(to.missing)
    }
    return { back, mentions, missing }
  }
  const textOf = (d) => (drafts.has(d.i) ? drafts.get(d.i) : d.text)
  const lineWith = (text, needle) => { const l = text.split('\n').find((x) => x.includes(needle)); return l ? l.trim().slice(0, 160) : '' }

  // ── explorer ──
  let opened = null
  function explorer(cur) {
    const q = st.q.trim().toLowerCase()
    const head = h('div', { class: 'xhead' }, h('b', null, 'Notes'), h('span', { class: 'muted' }, ` ${docs.length.toLocaleString()}`),
      SERVE ? h('button', { class: 'linkbtn', 'data-ctl': 'doc-new', onclick: () => newNote(cur ? `${cur.path.includes('/') ? cur.path.slice(0, cur.path.lastIndexOf('/') + 1) : ''}Untitled.md` : 'Untitled.md', cur ? cur.repo : docs[0] && docs[0].repo) }, '+ New note') : null)
    if (q) {
      const hits = []
      for (const d of docs) {
        const inPath = lower(d.shown).includes(q), t = textOf(d), at = lower(t).indexOf(q)
        if (inPath || at >= 0) hits.push([d, inPath ? '' : t.slice(Math.max(0, t.lastIndexOf('\n', at) + 1), at + q.length + 80).split('\n')[0].trim()])
        if (hits.length >= 200) break
      }
      return h('nav', { class: 'explorer', 'aria-label': 'Notes' }, head, h('p', { class: 'note' }, `${hits.length >= 200 ? 'First 200' : plural(hits.length, 'note')} matching “${st.q.trim()}”`),
        h('ul', { class: 'tree flat' }, hits.map(([d, snip]) => h('li', null, h('a', { class: `xfile${cur === d ? ' on' : ''}`, href: `#doc-${d.i}` }, d.name, drafts.has(d.i) ? h('span', { class: 'dirty', title: 'unsaved' }, ' ●') : null, h('span', { class: 'xpath muted' }, d.dir || (multi ? d.repo : '')), snip ? h('span', { class: 'snip' }, snip) : null)))))
    }
    // a tree per repository: the folders on the way to a note open when it is opened (and can be
    // closed again), the others when clicked
    const open = st.docOpen
    if (cur && opened !== cur) { opened = cur; const parts = cur.shown.split('/'); for (let k = 1; k < parts.length; k++) open.add(`${cur.repo}:${parts.slice(0, k).join('/')}`) }
    const tree = (repo, list) => {
      const root = { dirs: new Map(), files: [] }
      for (const d of list) { let node = root; const parts = d.shown.split('/'); for (const p of parts.slice(0, -1)) node = node.dirs.get(p) || node.dirs.set(p, { dirs: new Map(), files: [] }).get(p); node.files.push(d) }
      const draw = (node, prefix) => h('ul', { class: 'tree' },
        [...node.dirs].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, sub]) => {
          const key = `${repo}:${prefix}${name}`, isOpen = open.has(key)
          return h('li', null, h('button', { class: 'xdir', 'aria-expanded': String(isOpen), onclick: () => { if (open.has(key)) open.delete(key); else open.add(key); render() } }, h('span', { class: 'caret' }, isOpen ? '▾' : '▸'), name), isOpen ? draw(sub, `${prefix}${name}/`) : null)
        }),
        node.files.sort((a, b) => (a.name < b.name ? -1 : 1)).map((d) => h('li', null, h('a', { class: `xfile${cur === d ? ' on' : ''}`, href: `#doc-${d.i}`, 'aria-current': cur === d ? 'page' : null }, d.name, drafts.has(d.i) ? h('span', { class: 'dirty', title: 'unsaved' }, ' ●') : null))))
      return draw(root, '')
    }
    const repos = [...new Set(docs.map((d) => d.repo))]
    return h('nav', { class: 'explorer', 'aria-label': 'Notes' }, head,
      SERVE ? null : h('p', { class: 'note' }, 'Read-only snapshot. To edit, serve the page: ', h('code', null, 'graph.mjs serve')),
      repos.length > 1 ? repos.map((r) => h('div', null, h('div', { class: 'xrepo' }, r), tree(r, docs.filter((d) => d.repo === r)))) : tree(repos[0], docs))
  }

  // ── the note ──
  let status = ''
  const setStatus = (s) => { status = s; const el = document.getElementById('doc-status'); if (el) el.textContent = s }
  function body(d, text) {
    const art = h('article', { class: 'md', id: 'doc-body' })
    if (text.length > RICH_MAX) { art.append(h('p', { class: 'note' }, 'A long note: shown as plain text.'), h('pre', null, text)); return art }
    art.innerHTML = mdToHtml(text, (r) => resolve(r, d))
    art.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a')
      if (!a) return
      if (a.dataset.new !== undefined) { e.preventDefault(); if (SERVE) newNote(`${d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/') + 1) : ''}${a.dataset.new.replace(/\.(md|markdown)$/i, '')}.md`, d.repo); return }
      if (a.dataset.anchor && (a.dataset.doc === undefined || Number(a.dataset.doc) === d.i)) { e.preventDefault(); scrollTo(a.dataset.anchor); return }
      if (a.dataset.doc !== undefined && a.dataset.anchor) { e.preventDefault(); st.docAnchor = a.dataset.anchor; location.hash = `#doc-${a.dataset.doc}` }
    })
    return art
  }
  function scrollTo(anchor) {
    const el = document.getElementById(`h-${anchor}`) || document.getElementById(`h-${mdSlug(anchor)}`)
    if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200) }
  }
  function props(text) {
    const { props } = mdFront(text)
    if (!props.length) return null
    return h('table', { class: 'props' }, props.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v))))
  }
  function note(d) {
    const mode = SERVE ? st.docMode : 'read'
    const text = textOf(d)
    const seg = h('div', { class: 'seg' }, [['read', 'Read'], ['edit', 'Edit'], ['split', 'Split']].map(([m, label]) =>
      h('button', { 'data-ctl': `doc-${m}`, 'aria-pressed': String(mode === m), disabled: !SERVE && m !== 'read' ? 'disabled' : null, title: !SERVE && m !== 'read' ? 'Serve the page to edit: graph.mjs serve' : m === 'read' ? 'Reading view (Ctrl/⌘-E)' : m === 'edit' ? 'Source (Ctrl/⌘-E)' : 'Source and reading view side by side', onclick: () => { st.docMode = m; st.focusEditor = m !== 'read'; render() } }, label)))
    const crumbs = h('div', { class: 'crumbs mono', 'data-focus': '', tabindex: '-1' }, multi ? h('span', { class: 'muted' }, `${d.repo} / `) : null, d.dir ? h('span', { class: 'muted' }, `${d.dir} / `) : null, h('b', null, d.shown.split('/').pop()))
    const saveBtn = SERVE ? h('button', { class: 'primary', 'data-ctl': 'doc-save', disabled: drafts.has(d.i) ? null : 'disabled', onclick: () => save(d) }, 'Save') : null
    const head = h('div', { class: 'notehead' }, crumbs, h('span', { class: 'grow' }), h('span', { id: 'doc-status', class: 'muted', role: 'status' }, status || (drafts.has(d.i) ? 'unsaved changes' : '')), saveBtn, seg)
    const conflict = d.conflict ? h('div', { class: 'callout callout-danger' }, h('div', { class: 'callout-title' }, 'This note changed on disk since you opened it'),
      h('p', null, 'Your edits are kept here. Load the disk version (your edits are dropped), or overwrite the file with yours.'),
      h('div', { class: 'seg' }, h('button', { onclick: () => { d.text = d.conflict.text; d.hash = d.conflict.hash; d.conflict = null; drafts.delete(d.i); refresh(d); status = 'Loaded the disk version'; render() } }, 'Load disk version'),
        h('button', { onclick: () => { d.hash = d.conflict.hash; d.conflict = null; save(d) } }, 'Overwrite with mine'))) : null
    if (d.big) return h('div', { class: 'note-pane' }, head, h('p', { class: 'muted' }, 'This note is too large to embed in the page; open it in your editor.'))
    let preview = null
    const editor = () => {
      const ta = h('textarea', { class: 'editor', id: 'doc-editor', spellcheck: 'false', 'aria-label': `Source of ${d.shown}` })
      ta.value = text
      ta.addEventListener('input', () => {
        if (ta.value === d.text.replace(/\r\n/g, '\n')) drafts.delete(d.i); else drafts.set(d.i, ta.value)
        setStatus(drafts.has(d.i) ? 'unsaved changes' : '')
        const sb = document.querySelector('[data-ctl="doc-save"]'); if (sb) sb.disabled = !drafts.has(d.i)
        if (preview) { clearTimeout(preview.t); preview.t = setTimeout(() => { const nb = body(d, ta.value); preview.el.replaceWith(nb); preview.el = nb }, 120) }
      })
      return ta
    }
    let main
    if (mode === 'edit') main = editor()
    else if (mode === 'split') { const b = body(d, text); preview = { el: b, t: null }; main = h('div', { class: 'splitedit' }, editor(), h('div', { class: 'pv' }, b)) }
    else main = h('div', null, props(text), body(d, text))
    return h('div', { class: 'note-pane' }, head, conflict, main)
  }
  function rail(d) {
    const L = links(), r = refsOf.get(d.i) || { refs: [], headings: [] }
    const heads = r.headings.filter((x) => x.level <= 4)
    const back = [...(L.back.get(d.i) || new Map())].map(([from, ref]) => [docs[from], ref])
    const code = new Map()
    for (const ref of r.refs) if (ref.to && ref.to.file !== undefined && files.get(ref.to.file)) code.set(ref.to.file, files.get(ref.to.file))
    const miss = [...(L.missing.get(d.i) || [])]
    return h('aside', { class: 'rail', 'aria-label': 'About this note' },
      heads.length ? h('div', null, h('h4', null, 'Outline'), h('ul', { class: 'outline' }, heads.map((x) => h('li', { style: `padding-left:${(x.level - 1) * 10}px` }, h('button', { class: 'linkbtn', onclick: () => scrollTo(x.slug) }, x.text))))) : null,
      h('h4', null, `Backlinks (${back.length})`),
      back.length ? h('ul', { class: 'links' }, back.map(([b, ref]) => h('li', null, h('a', { class: 'jump', href: `#doc-${b.i}` }, b.name), h('div', { class: 'snip' }, lineWith(b.text, ref.kind === 'wiki' || ref.kind === 'embed' ? `[[${ref.target.split('#')[0]}` : ref.target) || ref.text)))) : h('div', { class: 'muted' }, 'No note links here.'),
      h('h4', null, `Code it mentions (${code.size})`),
      code.size ? h('ul', { class: 'links' }, [...code.values()].map((f) => h('li', null, jumpFile(f)))) : h('div', { class: 'muted' }, 'No indexed file named in this note.'),
      miss.length ? h('div', null, h('h4', null, `Unresolved links (${miss.length})`), h('ul', { class: 'links' }, miss.map((m) => h('li', { class: 'muted' }, `[[${m}]]`)))) : null)
  }
  function home() {
    const L = links()
    const top = docs.filter((d) => !d.dir).slice(0, 30)
    const most = [...L.back].map(([i, m]) => [docs[i], m.size]).sort((a, b) => b[1] - a[1]).slice(0, 12)
    const unresolved = [...L.missing.values()].reduce((a, s) => a + s.size, 0)
    return h('div', { class: 'note-pane' },
      h('div', { class: 'cards' }, [[docs.length, 'notes'], [[...L.back.values()].reduce((a, m) => a + m.size, 0), 'links between notes'], [L.mentions.size, 'indexed files mentioned'], [unresolved, 'unresolved links']].map(([v, l]) => h('div', { class: 'card' }, h('b', null, v.toLocaleString()), h('span', null, l)))),
      h('h2', { 'data-focus': '', tabindex: '-1' }, 'At the top'), h('ul', { class: 'links' }, top.map((d) => h('li', null, h('a', { class: 'jump', href: `#doc-${d.i}` }, d.shown)))),
      most.length ? h('div', null, h('h2', null, 'Most linked'), h('ul', { class: 'links' }, most.map(([d, n]) => h('li', null, h('a', { class: 'jump', href: `#doc-${d.i}` }, d.shown), h('span', { class: 'pill' }, n))))) : null,
      h('p', { class: 'note' }, SERVE ? 'Pick a note, or search. Ctrl/⌘-E switches reading and editing; Ctrl/⌘-S saves.' : 'Pick a note, or search. This page is a read-only snapshot: graph.mjs serve opens it with editing.'))
  }
  let shownDoc = null
  function view() {
    if (!docs.length) return h('section', null, h('p', { class: 'muted' }, 'No Markdown notes in the indexed repositories.'))
    const d = st.doc !== null && docs[st.doc] ? docs[st.doc] : null
    if (d !== shownDoc) { shownDoc = d; status = '' } // a status belongs to the note it was about
    const sec = h('section', { class: `docs${d ? '' : ' nodoc'}` }, explorer(d), d ? note(d) : home(), d ? rail(d) : null)
    if (d && st.docAnchor) { const a = st.docAnchor; st.docAnchor = null; requestAnimationFrame(() => scrollTo(a)) }
    if (d && (st.focusEditor || st.editorCaret)) {
      const focus = st.focusEditor, caret = st.editorCaret
      st.focusEditor = false; st.editorCaret = null
      requestAnimationFrame(() => {
        const ta = document.getElementById('doc-editor')
        if (!ta) return
        if (caret) { ta.setSelectionRange(caret[0], caret[1]); ta.scrollTop = caret[2] }
        if (focus) ta.focus({ preventScroll: true })
      })
    }
    return sec
  }

  // ── saving (served pages only) ──
  const api = (method, body, query) => fetch(`/api/doc${query || ''}`, { method, headers: { 'content-type': 'application/json', 'x-grimoire-token': SERVE.token }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }))
  function refresh(d) { if (linked) { analyzeDoc(d); linked = rebuild() } }
  // re-render, keeping the editor's caret and scroll when it is open
  function rerender() {
    const ta = document.getElementById('doc-editor')
    if (ta) { st.editorCaret = [ta.selectionStart, ta.selectionEnd, ta.scrollTop]; st.focusEditor = document.activeElement === ta }
    render()
  }
  async function save(d) {
    if (!SERVE) { setStatus('Read-only snapshot: serve the page to save'); return }
    if (!drafts.has(d.i) || d.saving) return
    const draft = drafts.get(d.i), text = d.eol === '\r\n' ? draft.replace(/\r?\n/g, '\r\n') : draft
    setStatus('Saving…')
    d.saving = true // a focus recheck waits for the save, or it would read our own write as a conflict
    try {
      const r = await api('PUT', { repo: d.repo, path: d.path, text, base: d.hash })
      if (r.ok) {
        d.hash = r.j.hash; d.text = text; d.conflict = null
        if (drafts.get(d.i) === draft) drafts.delete(d.i) // typing during the save keeps the newer text unsaved
        refresh(d); status = `Saved ${new Date().toLocaleTimeString()}`; rerender()
      } else if (r.status === 409 && r.j.text !== undefined) { d.conflict = { text: r.j.text, hash: r.j.hash }; status = 'Not saved: changed on disk'; rerender() }
      else setStatus(`Not saved: ${r.j.error || `HTTP ${r.status}`}`)
    } catch (e) { setStatus(`Not saved: the server is not answering (${e.message})`) } finally { d.saving = false }
  }
  async function newNote(suggest, repo) {
    const p = window.prompt(`New note in ${repo}, path from the repository root:`, suggest)
    if (!p) return
    const path = p.trim().replace(/^\/+/, '')
    const full = /\.(md|markdown)$/i.test(path) ? path : `${path}.md`
    const exists = docs.find((x) => x.repo === repo && x.path === full)
    if (exists) { location.hash = `#doc-${exists.i}`; return }
    const title = full.split('/').pop().replace(/\.(md|markdown)$/i, '')
    const r = await api('PUT', { repo, path: full, text: `# ${title}\n\n`, create: true })
    if (!r.ok) { window.alert(`Could not create ${full}: ${r.j.error || `HTTP ${r.status}`}`); return }
    const root = (docs.find((x) => x.repo === repo) || {}).root || '.'
    const shown = root !== '.' ? `${root}/${full}` : full
    const d = { i: docs.length, repo, root, path: full, text: `# ${title}\n\n`, hash: r.j.hash, big: false, shown, name: title, dir: shown.includes('/') ? shown.slice(0, shown.lastIndexOf('/')) : '' }
    docs.push(d); indexDoc(d)
    const k = lower(full.split('/').pop()); (tail.get(k) || tail.set(k, []).get(k)).push({ doc: d, shown })
    if (linked) { for (const x of docs) analyzeDoc(x); linked = rebuild() }
    st.docMode = 'edit'; st.focusEditor = true
    location.hash = `#doc-${d.i}`
  }
  // a served page picks up edits made on disk (an agent, another editor) when it gets focus back
  async function recheck() {
    if (!SERVE || st.tab !== 'docs' || st.doc === null || !docs[st.doc]) return
    const d = docs[st.doc]
    if (d.saving || d.big) return
    try {
      const r = await api('GET', null, `?repo=${encodeURIComponent(d.repo)}&path=${encodeURIComponent(d.path)}`)
      if (!r.ok || r.j.hash === d.hash || d.saving) return
      if (drafts.has(d.i)) { d.conflict = { text: r.j.text, hash: r.j.hash }; rerender() } else { d.text = r.j.text; d.hash = r.j.hash; refresh(d); status = 'Reloaded: changed on disk'; rerender() }
    } catch {}
  }
  window.addEventListener('focus', recheck)
  window.addEventListener('keydown', (e) => {
    if (st.tab !== 'docs' || !(e.metaKey || e.ctrlKey) || e.altKey) return
    const k = e.key.toLowerCase(), d = st.doc !== null ? docs[st.doc] : null
    if (k === 's' && d) { e.preventDefault(); save(d) }
    if (k === 'e' && d && SERVE && (MAC ? e.metaKey : e.ctrlKey)) { // on a Mac, Ctrl-E stays end-of-line
      e.preventDefault(); st.docMode = st.docMode === 'read' ? 'edit' : 'read'; st.focusEditor = st.docMode !== 'read'; render()
    }
  })
  window.addEventListener('beforeunload', (e) => { if (drafts.size) { e.preventDefault(); e.returnValue = '' } })

  return {
    view,
    has: (i) => !!docs[i],
    // notes that mention a file, for the Files tab
    mentionsOf: (f) => [...(links().mentions.get(f.id) || [])].map((i) => docs[i]),
  }
}
