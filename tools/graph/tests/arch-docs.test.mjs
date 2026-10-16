// ════════════════════════════════════════════════════════════════════════════
//  Tests — the graph page's Architecture and Docs tabs (tools/graph)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/arch-docs.test.mjs
//
//  1. Markdown (md.mjs): blocks, inline, links through the resolver, what it refuses to pass through
//  2. architecture (arch.mjs): the schema check, globs, imports, binding to an index, the layout,
//     the draft, and the check's warnings
//  3. notes (docs.mjs): what is listed, and which paths the server may write
//  4. the server (serve.mjs): host, origin and token checks, reading, saving, conflicts, creating
//  5. the page: both tabs rendered by the page's own script in a stub DOM
//
//  Needs no parser runtime: indexes here are built by hand (sections 2) or empty (4, 5).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync, readdirSync, lstatSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { mdToHtml, mdFront, mdSlug } = await import('../lib/md.mjs')
const A = await import('../lib/arch.mjs')
const { scanDocs, resolveDoc, docRoots, docHash } = await import('../lib/docs.mjs')
const { loadProject } = await import('../lib/project.mjs')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

// ── 1 · Markdown ──
console.log('\n1 · Markdown')
{
  const link = (r) => r.kind === 'wiki' && r.target === 'Known' ? { doc: 4 } : r.kind === 'wiki' ? { missing: r.target } : r.kind === 'code' && r.target === 'src/app.ts:12' ? { file: 9, line: '12' } : r.kind === 'md' && r.target === 'other.md#part' ? { doc: 2, anchor: 'part' } : r.kind === 'url' ? { url: r.target } : null
  const out = {}
  const html = mdToHtml(`---
title: A note
tags:
  - one
  - two
---
# Title *one*

Intro with **bold**, _em_, ~~gone~~, ==lit== and \`src/app.ts:12\`, [[Known]], [[Nope|alias]], [x](other.md#part), <https://a.example/x>, https://b.example/y. and #tag.

## Title one

- a
  - nested
- [x] done
- [ ] todo

1. first
2. second

> [!warning]- Careful
> folded

| k | v |
|:--|--:|
| a | 1 |

\`\`\`js
if (a < b) {}
\`\`\`

    indented code

Setext
------
`, link, out)
  ok(/<h1 id="h-title-one">Title <em>one<\/em><\/h1>/.test(html) && /<h2 id="h-title-one-1">/.test(html) && /<h2 id="h-setext">Setext<\/h2>/.test(html), 'headings: ATX and setext, GitHub anchors, duplicates numbered')
  ok(out.headings.map((x) => `${x.level}:${x.slug}`).join(' ') === '1:title-one 2:title-one-1 2:setext', `the outline is collected (${out.headings.map((x) => x.slug)})`)
  ok(/<strong>bold<\/strong>/.test(html) && /<em>em<\/em>/.test(html) && /<del>gone<\/del>/.test(html) && /<mark>lit<\/mark>/.test(html) && /<span class="tag">#tag<\/span>/.test(html), 'inline: strong, em, strikethrough, highlight, tags')
  ok(html.includes('<a class="internal code-link" href="#file-9" title="src/app.ts:12"><code>src/app.ts:12</code></a>'), 'inline code naming an indexed file links to its neighbourhood')
  ok(html.includes('<a class="internal" href="#doc-4" data-doc="4" title="Known">Known</a>') && html.includes('data-new="Nope"') && />alias<\/a>/.test(html), 'wikilinks: a known note, and a missing one offered for creation under its alias')
  ok(html.includes('href="#doc-2" data-doc="2" data-anchor="part"'), 'a relative Markdown link opens the note at its heading')
  ok(html.includes('href="https://a.example/x" target="_blank" rel="noopener noreferrer"') && html.includes('href="https://b.example/y"') && !html.includes('y.</a>'), 'autolinks and bare URLs open outside, trailing punctuation left out')
  ok(/<ul><li>a\n<ul><li>nested<\/li><\/ul><\/li><li class="task"><input type="checkbox" disabled checked> done<\/li><li class="task"><input type="checkbox" disabled> todo<\/li><\/ul>/.test(html) && /<ol><li>first<\/li><li>second<\/li><\/ol>/.test(html), 'lists: nested, task items, ordered')
  ok(/<details class="callout callout-warning"><summary class="callout-title">Careful<\/summary><p>folded<\/p><\/details>/.test(html), 'callouts, foldable with -')
  ok(html.includes('<th style="text-align:left">k</th><th style="text-align:right">v</th>') && html.includes('<td style="text-align:right">1</td>'), 'tables keep their alignment')
  ok(html.includes('<pre><code class="lang-js">if (a &lt; b) {}</code></pre>') && html.includes('<pre><code>indented code</code></pre>'), 'fenced and indented code, escaped')
  ok(!html.includes('title: A note') && JSON.stringify(mdFront('---\ntitle: A note\ntags:\n  - one\n  - two\n---\nbody').props) === '[["title","A note"],["tags","one, two"]]', 'front matter becomes properties, not text')
  ok(out.refs.filter((r) => r.kind === 'wiki').length === 2 && out.refs.some((r) => r.kind === 'code' && r.to && r.to.file === 9), 'every reference is collected with what it resolved to')

  const evil = mdToHtml('<img src=x onerror=alert(1)> <script>alert(1)</script> <details open><summary onclick="x()">More</summary></details> [a](javascript:alert(1)) [b](data:text/html,x) ![i](javascript:x) <a href="javascript:y">z</a>', () => null)
  ok(!/<script|<img|<a href="(?!#)|\bon\w+=|(href|src)="(javascript|data):/i.test(evil) && evil.includes('<details><summary>More</summary></details>') && evil.includes('alert(1)'),
    `raw HTML: allowed tags rebuilt without attributes, the rest dropped (text kept), no script or javascript: URL (${evil})`)
  ok(mdSlug('🔮 grimoire') === '-grimoire' && mdSlug('What is in the box?') === 'what-is-in-the-box' && mdSlug('a_b-c') === 'a_b-c', 'slugs match GitHub\'s anchors')
  const big = 'word '.repeat(60000) + 'https://x.example ' + '`code` '.repeat(5000)
  const t0 = Date.now(); mdToHtml(big, () => null)
  ok(Date.now() - t0 < 1500, `a 330 KB paragraph renders in linear time (${Date.now() - t0} ms)`)
  ok(mdToHtml('a\nb  \nc\\\nd', () => null) === '<p>a\nb<br>c<br>d</p>', 'soft breaks stay spaces; two spaces or a backslash break the line')

  // what the review found
  const p = (x) => mdToHtml(x, () => null)
  ok(p('---\n\nIntro paragraph\n\n---\nBody') === '<hr>\n<p>Intro paragraph</p>\n<hr>\n<p>Body</p>' && p('---\n---\nBody') === '<p>Body</p>', 'front matter: only YAML is taken, an opening rule keeps the text after it, an empty block is empty')
  ok(p('```\n[docs]: https://x.example\n[ERROR]: failed\n```') === '<pre><code>[docs]: https://x.example\n[ERROR]: failed</code></pre>', 'a line shaped like a link definition stays inside a code block')
  ok(p('a &amp; b &lt; c &nbsp;d &#124; e & f `&amp;`') === '<p>a &amp; b &lt; c &nbsp;d &#124; e &amp; f <code>&amp;amp;</code></p>', 'entities in text are kept; in code they are text')
  const badge = p('[![b](https://i.example/b.svg)](https://l.example)')
  ok((badge.match(/<a /g) || []).length === 1 && badge.includes('<span class="img"'), `a badge is one link, its image inside as text (${badge})`)
  const o2 = {}; mdToHtml('## A [link](https://x.example) here', () => null, o2)
  ok(o2.headings[0].slug === 'a-link-here' && o2.headings[0].text === 'A link here', "a heading's anchor and outline text come from its rendered text")
  ok(p('<!' + '-- a\n\nstill hidden -->\nshown') === '<p>shown</p>', 'an HTML comment hides its text, blank lines and all')
  ok(p('<!' + '-- note --> visible text here') === '<p>visible text here</p>' && p('<!' + '-- c --><b>bold</b> rest') === '<b>bold</b> rest', 'what follows a comment on its line stays')
  ok(JSON.stringify(mdFront('---\ntítulo: x\n"title": y\ntime: 10:30\n---\nBody')) === '{"props":[["título","x"],["title","y"],["time","10:30"]],"body":"Body"}', 'front matter keys in any language, or quoted')
  let deep = true
  try { p('>'.repeat(5000) + ' x') } catch { deep = false }
  ok(deep, 'a note nested thousands deep renders instead of overflowing the stack')
  for (const [name, x] of [['a run of spaces', 'a' + ' '.repeat(160000) + 'b'], ['unclosed strong', '**a '.repeat(20000)], ['unclosed images', '![a]('.repeat(10000)], ['unclosed code', '`a'.repeat(50000)], ['unclosed comments', ('<!' + '--a').repeat(30000)], ['unclosed wikilinks', '[[a'.repeat(30000)]]) {
    const t1 = Date.now(); p(x)
    ok(Date.now() - t1 < 1500, `hostile input renders in linear time: ${name} (${Date.now() - t1} ms)`)
  }
}

// ── 2 · architecture ──
console.log('\n2 · architecture')
{
  const v = A.validate({ schema: 1, title: 'x', components: [{ id: 'a', label: 'A', type: 'backend', col: 0, row: 0 }, { id: 'a', label: 'B', type: 'nope', col: 0, row: 0 }, { id: 'Bad Id', label: '', type: 'database', col: 1 }],
    connections: [{ from: 'a', to: 'zz' }, { from: 'a', to: 'a', variant: 'loud' }], boundaries: [{ label: 'b', wraps: ['ghost'] }], cards: [{ title: 't', items: [1] }] })
  const want = ['duplicate id', 'type must be one of', 'shares cell', 'id must match', 'label required', 'give col and row together', 'to names no component', 'does not connect to itself', 'variant must be one of', 'wraps "ghost"', 'cards[0]']
  ok(want.every((w) => v.errors.some((e) => e.includes(w))), `validate names every problem and where (${want.filter((w) => !v.errors.some((e) => e.includes(w))).join(', ') || 'all found'})`)
  ok(A.validate({ schema: 1, title: 't', components: [{ id: 'a', label: 'A', type: 'cli' }] }).errors.length === 0, 'a minimal diagram passes')
  const g = (p, x) => A.globRe(p).test(x)
  ok(g('src', 'src/a.ts') && !g('src', 'srcx/a.ts') && g('src/*', 'src/a.ts') && !g('src/*', 'src/b/a.ts') && g('*', 'a.ts') && !g('*', 'b/a.ts') && g('src/**/*.sql', 'src/x/y.sql') && g('src/', 'src/x'), 'path globs: a folder and below; * within a segment; ** across')
  ok(A.importMatches('pg', 'pg') && A.importMatches('pg/lib/client', 'pg') && A.importMatches('github.com/redis/go-redis/v9', 'github.com/redis/go-redis') && A.importMatches('sqlalchemy.orm', 'sqlalchemy') && !A.importMatches('pgx', 'pg') && !A.importMatches('github.com/x', 'github'), 'import prefixes: package, subpath, module path; never a longer name')
  ok(A.guessType('src/routes', ['typescript'], ['express']) === 'backend' && A.guessType('web/components', ['tsx'], ['react']) === 'frontend' && A.guessType('db/migrations', ['python'], []) === 'database' && A.guessType('lib/util', ['go'], []) === 'library' && A.guessType('infra', ['hcl'], []) === 'cloud' && A.guessType('app', ['tsx'], []) === 'frontend', 'types: frameworks first, then folders, then languages')

  // a hand-made index: web → api → db (by syntax), web → db by a name guess only, api imports pg
  const files = [['web', 'src/page.tsx'], ['web', 'src/form.tsx'], ['api', 'routes/user.ts'], ['api', 'db/user.ts'], ['api', 'routes/user.test.ts', 1], ['api', 'scripts/seed.ts']]
    .map(([repo, p, t], i) => ({ id: i + 1, repo, path: p, lang: p.endsWith('tsx') ? 'tsx' : 'typescript', is_test: t ? 1 : 0, node_id: 100 + i + 1 }))
  const nodes = files.map((f) => ({ id: 200 + f.id, file_id: f.id }))
  const e = (a, b, confidence = 'import') => ({ src: 200 + a, dst: 200 + b, kind: 'CALLS', confidence })
  const idx = { repos: ['api', 'web'], files, nodes, edges: [e(1, 3), e(2, 3), e(3, 4), e(1, 4, 'ambiguous'), e(5, 3), e(6, 4)], imports: [{ file_id: 4, source: 'pg' }, { file_id: 3, source: 'express' }, { file_id: 5, source: 'pg' }] }
  const doc = { schema: 1, title: 'Shop', components: [
    { id: 'web', label: 'Web', type: 'frontend', repo: 'web', paths: ['src'] },
    { id: 'api', label: 'API', type: 'backend', paths: ['api:routes'] },
    { id: 'store', label: 'Store', type: 'database', paths: ['api:db'] },
    { id: 'pg', label: 'Postgres', type: 'database', imports: ['pg'] },
    { id: 'users', label: 'Users', type: 'external' },
    { id: 'gone', label: 'Gone', type: 'library', paths: ['api:nothing/here'] },
  ], connections: [{ from: 'users', to: 'web' }, { from: 'web', to: 'api', label: 'HTTP' }, { from: 'store', to: 'api' }, { from: 'store', to: 'pg', label: 'SQL' }, { from: 'web', to: 'store' }, { from: 'api', to: 'pg', via: 'pool' }],
    boundaries: [{ label: 'backend', kind: 'deploy', wraps: ['api', 'store'] }] }
  const code = A.bindCode(doc, idx)
  ok(JSON.stringify(code.members) === '[[1,2],[3],[4],[],[],[]]' && JSON.stringify(code.unmatched[5]) === '["api:nothing/here"]', `components bind to production files by their globs; test files never (${JSON.stringify(code.members)})`)
  ok(JSON.stringify(code.evidence) === '[0,2,0,1,0,0]' && code.reverse[2] === 1, `evidence: file pairs linked by syntax, and imports for a component reached through them (${code.evidence}; reverse ${code.reverse})`)
  ok(JSON.stringify(code.ghosts) === '[]' && code.coverage.covered === 4 && code.coverage.total === 5 && code.coverage.uncovered[0][0] === 'api:scripts', `coverage counts production files in no component (${JSON.stringify(code.coverage)})`)
  const r = A.analyze(doc, idx, null)
  ok(r.errors.some((x) => x.includes('gone: paths "api:nothing/here" matches no indexed production file')), 'a glob matching nothing is an error')
  ok(r.warnings.some((w) => w.startsWith('store → api: the code links the other way')) && r.warnings.some((w) => w.startsWith('web → store: no link in the graph')) && !r.warnings.some((w) => w.startsWith('api → pg')) && !r.warnings.some((w) => w.startsWith('users → web')),
    `warnings: a reversed line, a line the code does not show; none for "via" or a component with no code (${r.warnings.join(' | ')})`)
  const doc2 = { ...doc, components: doc.components.filter((c) => c.id !== 'gone'), connections: doc.connections.filter((c) => !(c.from === 'web' && c.to === 'api')) }
  const r2 = A.analyze(doc2, idx, null)
  ok(r2.warnings.some((w) => w === 'web uses api (2 file pairs in the graph), but no line is drawn between them') && r2.errors.length === 0, 'a code link no line draws is reported')
  ok(r2.checked === '1 of 3 connections between code components seen in the graph', `the summary counts the lines the graph could confirm, not one that says it runs elsewhere (${r2.checked})`)

  // layout
  const L = r2.layout
  const at = (id) => L.boxes[doc2.components.findIndex((c) => c.id === id)]
  const overlap = L.boxes.some((b, i) => L.boxes.some((o, j) => i < j && b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y))
  ok(!overlap && at('users').col === 0 && at('web').col === 1 && at('pg').col > at('store').col, `layout: no two boxes overlap, columns follow the lines (${L.boxes.map((b) => `${b.col},${b.row}`).join(' ')})`)
  const bd = L.bounds[0], inside = (b) => b.x >= bd.x && b.y >= bd.y && b.x + b.w <= bd.x + bd.w && b.y + b.h <= bd.y + bd.h
  ok(inside(at('api')) && inside(at('store')) && !inside(at('web')) && !inside(at('pg')) && L.problems.length === 0, 'a boundary wraps its components and nothing else')
  ok(L.routes.every((x) => x && /^M[\d.]+,[\d.]+ C/.test(x.d)) && L.W > 0 && L.H > 0 && JSON.stringify(A.layoutArch(doc2)) === JSON.stringify(L), 'every line is routed, and the layout is deterministic')
  const fixed = A.layoutArch({ components: [{ id: 'a', label: 'A', type: 'cli', col: 3, row: 1 }, { id: 'b', label: 'B', type: 'cli' }], connections: [{ from: 'a', to: 'b' }], boundaries: [{ label: 'x', wraps: ['b'] }] })
  ok(fixed.boxes[0].col === 3 && fixed.boxes[0].row === 1 && fixed.boxes[1].row === 0, 'col and row given are kept; the rest fill free cells')
  const clash = A.layoutArch({ components: [{ id: 'a', label: 'A', type: 'cli', col: 0, row: 0 }, { id: 'b', label: 'B', type: 'cli', col: 1, row: 0 }, { id: 'c', label: 'C', type: 'cli', col: 2, row: 0 }], boundaries: [{ label: 'ends', wraps: ['a', 'c'] }] })
  ok(clash.problems.some((p) => p.includes('b sits inside the boundary "ends"')), 'a component inside a boundary that does not wrap it is reported')

  // the draft
  const d = A.draftArch(idx, { title: 'Draft', now: new Date('2026-01-02T00:00:00Z') })
  const ids = d.components.map((c) => `${c.id}:${c.type}`).join(' ')
  ok(d.draft === true && A.validate(d).errors.length === 0 && ids === 'api-routes:backend api-scripts:cli api-db:database web-src:frontend postgres:database', `the draft: modules typed, the external service its imports name, valid (${ids})`)
  ok(JSON.stringify(d.connections.map((c) => `${c.from}>${c.to}`)) === '["api-routes>api-db","api-scripts>api-db","web-src>api-routes","api-db>postgres"]' && d.boundaries.length === 2, `the draft links modules by syntax only and boxes each repository (${d.connections.map((c) => `${c.from}>${c.to}`)})`)
  ok(A.analyze(d, idx, null).warnings.length === 0, 'a fresh draft passes its own check without warnings')

  // what the review found: lists that are not lists, one importing file in two components, odd graphs
  const nl = A.validate({ schema: 1, title: 't', components: [{ id: 'a', label: 'A', type: 'cli' }], boundaries: 'x', cards: {}, summary: 3 })
  ok(['boundaries: must be a list', 'cards: must be a list', 'summary: must be a string'].every((x) => nl.errors.includes(x)), `boundaries and cards must be lists (${nl.errors})`)
  const both = { schema: 1, title: 't', components: [{ id: 'x', label: 'X', type: 'backend', paths: ['api:db'] }, { id: 'y', label: 'Y', type: 'backend', paths: ['api:db/user.ts'] }, { id: 'pg', label: 'PG', type: 'database', imports: ['pg'] }], connections: [{ from: 'x', to: 'pg' }, { from: 'y', to: 'pg' }] }
  ok(JSON.stringify(A.bindCode(both, idx).evidence) === '[1,1]', `a file in two components is evidence for each (${A.bindCode(both, idx).evidence})`)
  for (const [name, dg] of [['a cycle', { components: [{ id: 'a', label: 'A', type: 'cli' }, { id: 'b', label: 'B', type: 'cli' }, { id: 'c', label: 'C', type: 'cli' }], connections: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }] }],
    ['one component', { components: [{ id: 'a', label: 'A', type: 'cli' }] }], ['no lines', { components: [{ id: 'a', label: 'A', type: 'cli' }, { id: 'b', label: 'B', type: 'cli' }] }]]) {
    const L2 = A.layoutArch(dg)
    ok(L2.boxes.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)) && L2.W > 0 && !L2.boxes.some((b, i) => L2.boxes.some((o, j) => i < j && b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)), `layout of ${name}: every box placed, none overlapping`)
  }
  ok(JSON.stringify(A.parseSource('api:src/a.ts:3-9', ['api'])) === '{"repo":"api","path":"src/a.ts","start":3,"end":9}' && JSON.stringify(A.parseSource('README.md', ['api'])) === '{"path":"README.md"}' && A.parseSource('x:y.ts:4', ['api']).path === 'x:y.ts'
    && JSON.stringify(A.parseSource('.claude-plugin/plugin.json:1-25', ['api'])) === '{"path":".claude-plugin/plugin.json","start":1,"end":25}' && A.parseSource('src/a.ts:7', ['api']).start === 7, 'sources: repo:path:lines, a bare path with lines, a colon that names no repository')
}

// ── 3 · notes ──
console.log('\n3 · notes')
const HUB = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-docs-')))
{
  const w = (p, t) => { mkdirSync(path.dirname(path.join(HUB, p)), { recursive: true }); writeFileSync(path.join(HUB, p), t) }
  w('grimoire.config.json', JSON.stringify({ repos: [{ name: 'api', path: 'repos/api' }], graph: { exclude: ['private'] } }))
  w('AGENTS.md', '# Agents\n\nSee [[guide]].\n'); w('docs/guide.md', '# Guide\n'); w('repos/api/README.md', '# API\n'); w('repos/api/src/x.ts', 'x'); w('repos/api/node_modules/p/README.md', 'no')
  w('private/secret.md', 'no'); w('repos/api/docs/a.markdown', 'a')
  mkdirSync(path.join(HUB, 'outside'), { recursive: true })
  symlinkSync(path.join(HUB, 'outside'), path.join(HUB, 'repos/api/escape'))
  const project = loadProject(HUB)
  const docs = scanDocs(project)
  ok(docs.map((d) => `${d.repo}:${d.root}:${d.path}`).join(' ') === `${path.basename(HUB)}:.:AGENTS.md ${path.basename(HUB)}:.:docs/guide.md api:repos/api:README.md api:repos/api:docs/a.markdown`,
    `notes: the hub's own and each repository's, once each, dependencies and excludes skipped (${docs.map((d) => `${d.repo}:${d.path}`).join(' ')})`)
  ok(docs[0].hash === docHash('# Agents\n\nSee [[guide]].\n') && docRoots(project)[0].hub === true, 'each note carries the hash of its text')
  const R = (repo, p, o) => { const x = resolveDoc(project, repo, p, o); return x.error ? `error: ${x.error}` : path.relative(HUB, x.abs) }
  const hub = path.basename(HUB)
  ok(R(hub, 'AGENTS.md') === 'AGENTS.md' && R('api', 'README.md') === 'repos/api/README.md' && R(hub, 'docs/new/deeper.md', { create: true }) === 'docs/new/deeper.md', 'a note in a repository resolves; a new one may make its folders')
  const refused = [[hub, '../x.md'], [hub, '/etc/x.md'], [hub, 'docs/../AGENTS.md'], [hub, 'a.js'], ['api', 'node_modules/p/README.md'], [hub, 'repos/api/README.md'], ['api', 'escape/n.md', { create: true }], ['nope', 'a.md'], [hub, 'missing.md'], [hub, 'x\\y.md']]
  const bad = refused.filter(([r, p, o]) => !R(r, p, o).startsWith('error'))
  ok(!bad.length, `refused: parent paths, absolute, non-Markdown, skipped folders, another repository's note from the hub, a symlink out, unknown repos, missing notes (${JSON.stringify(bad)})`)

  // what the review found: symlinks and letter case
  symlinkSync('AGENTS.md', path.join(HUB, 'CLAUDE.md'))
  symlinkSync(path.join(HUB, 'nowhere.md'), path.join(HUB, 'dangling.md'))
  ok(R(hub, 'CLAUDE.md') === 'AGENTS.md', 'a symlinked note resolves to its real file, so a save keeps the link')
  ok(R(hub, 'dangling.md', { create: true }).startsWith('error') && [['api', 'Node_Modules/x.md'], ['api', '.GIT/x.md'], [hub, 'Repos/Api/x.md']].every(([r, p2]) => R(r, p2, { create: true }).startsWith('error')),
    'refused too: a dangling symlink, and a skipped folder or another repository spelled in another case')
  const G = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-git-')))
  const secret = `${G}-secret.txt`
  writeFileSync(path.join(G, 'README.md'), '# r\n'); writeFileSync(secret, 'TOP-SECRET')
  writeFileSync(path.join(G, 'grimoire.config.json'), JSON.stringify({ graph: { exclude: ['private'] } }))
  writeFileSync(path.join(G, 'deploy.sh'), 'echo deploy\n'); mkdirSync(path.join(G, 'private')); writeFileSync(path.join(G, 'private/p.md'), 'private')
  symlinkSync(secret, path.join(G, 'leak.md')); symlinkSync('README.md', path.join(G, 'CLAUDE.md'))
  if (spawnSync('git', ['init', '-q'], { cwd: G }).status !== 0) console.log('   - skipped: git is not available')
  else {
    symlinkSync('.git/config', path.join(G, 'gitcfg.md')); symlinkSync('deploy.sh', path.join(G, 'script.md')); symlinkSync('private/p.md', path.join(G, 'viapriv.md')); symlinkSync('.git', path.join(G, 'gitdir'))
    const gp = loadProject(G), gname = path.basename(G)
    const gd = scanDocs(gp).map((d) => `${d.path}:${/SECRET|\[core\]|deploy|private/.test(d.text)}`).join(' ')
    ok(gd === 'CLAUDE.md:false README.md:false', `a listed symlink is read only when its real file is a note of the repository: not a file outside it, .git/config, a script or an excluded note (${gd})`)
    const gr = (p2, o) => resolveDoc(gp, gname, p2, o)
    ok(['leak.md', 'gitcfg.md', 'script.md', 'viapriv.md'].every((p2) => gr(p2).error) && gr('gitdir/x.md', { create: true }).error && gr('CLAUDE.md').abs === path.join(G, 'README.md'),
      'and none of them is served or written, nor a note created through a folder linked into .git; a note linked to a note is')
  }
}

// ── 4 · the server ──
console.log('\n4 · the server')
const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 5)) console.log('   - skipped: needs node:sqlite (Node ≥ 22.5)')
else {
  const { openStore } = await import('../lib/store.mjs')
  const { serve } = await import('../lib/serve.mjs')
  const project = loadProject(HUB)
  ;(await openStore(project.dbPath)).close() // an empty index: the page renders without the parser runtime
  const s = await serve(project, { refresh: false })
  const hub = path.basename(HUB)
  const base = `http://127.0.0.1:${s.port}`
  const req = (p, { method = 'GET', headers = {}, body } = {}) => fetch(base + p, { method, headers: { 'x-grimoire-token': s.token, ...headers }, body }).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }))
  const put = (o, headers = {}) => req('/api/doc', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(o) })
  try {
    const page = await req(`/?t=${s.token}`)
    ok(page.status === 200 && page.text.includes("connect-src 'self'") && page.text.includes(s.token) && page.headers.get('referrer-policy') === 'no-referrer', 'the page, served: saving allowed by its CSP, the token in its data, no referrer')
    ok((await req('/')).status === 403 && (await req('/?t=wrong')).status === 403, 'the page needs the token')
    const http = await import('node:http')
    const rawHost = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: s.port, path: `/?t=${s.token}`, headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode) }))
    ok(rawHost === 403, 'a request naming another host is refused (DNS rebinding)')
    ok((await put({ repo: hub, path: 'AGENTS.md', text: 'x' }, { origin: 'http://evil.example' })).status === 403, 'a cross-origin write is refused')
    ok((await req('/api/doc', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-grimoire-token': 'nope' }, body: '{}' })).status === 403, 'a write without the token is refused')
    ok((await req('/api/doc', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{}' })).status === 415, 'a write must be JSON (no simple cross-site form post)')
    const got = JSON.parse((await req(`/api/doc?repo=${hub}&path=AGENTS.md`)).text)
    ok(got.text === '# Agents\n\nSee [[guide]].\n' && got.hash === docHash(got.text), 'a note is read from disk with its hash')
    let w = await put({ repo: hub, path: 'AGENTS.md', text: '# Agents v2\n', base: got.hash })
    ok(w.status === 200 && readFileSync(path.join(HUB, 'AGENTS.md'), 'utf8') === '# Agents v2\n' && JSON.parse(w.text).hash === docHash('# Agents v2\n'), 'a save writes the note and answers its new hash')
    w = await put({ repo: hub, path: 'AGENTS.md', text: 'stale edit', base: got.hash })
    const c = JSON.parse(w.text)
    ok(w.status === 409 && c.text === '# Agents v2\n' && readFileSync(path.join(HUB, 'AGENTS.md'), 'utf8') === '# Agents v2\n', 'a save from a stale version is refused, with the disk text, and nothing is written')
    w = await put({ repo: 'api', path: 'docs/adr/0001-start.md', text: '# Start\n', create: true })
    ok(w.status === 201 && readFileSync(path.join(HUB, 'repos/api/docs/adr/0001-start.md'), 'utf8') === '# Start\n', 'a new note is created, with its folder')
    ok((await put({ repo: 'api', path: 'docs/adr/0001-start.md', text: 'again', create: true })).status === 409, 'creating never overwrites')
    w = await put({ repo: hub, path: '../outside/x.md', text: 'x', create: true })
    ok(w.status === 400 && !existsSync(path.join(HUB, '../outside/x.md')), 'a path out of the repository is refused')
    ok((await put({ repo: 'api', path: 'escape/x.md', text: 'x', create: true })).status === 400 && !existsSync(path.join(HUB, 'outside/x.md')), 'a symlinked folder out of the repository is refused')
    // what the review found
    ok((await put({ repo: hub, path: 'AGENTS.md', text: 'no base' })).status === 400 && readFileSync(path.join(HUB, 'AGENTS.md'), 'utf8') === '# Agents v2\n', 'a save must name the version it edits')
    const cl = JSON.parse((await req(`/api/doc?repo=${hub}&path=CLAUDE.md`)).text)
    w = await put({ repo: hub, path: 'CLAUDE.md', text: '# Agents v3\n', base: cl.hash })
    ok(w.status === 200 && lstatSync(path.join(HUB, 'CLAUDE.md')).isSymbolicLink() && readFileSync(path.join(HUB, 'AGENTS.md'), 'utf8') === '# Agents v3\n', 'a save through a symlinked note writes its real file and keeps the link')
    if (!(process.getuid && process.getuid() === 0)) { // root writes through any mode
      writeFileSync(path.join(HUB, 'docs/locked.md'), '# Locked\n'); chmodSync(path.join(HUB, 'docs/locked.md'), 0o444)
      const lk = JSON.parse((await req(`/api/doc?repo=${hub}&path=docs/locked.md`)).text)
      ok((await put({ repo: hub, path: 'docs/locked.md', text: 'x', base: lk.hash })).status === 403 && readFileSync(path.join(HUB, 'docs/locked.md'), 'utf8') === '# Locked\n', 'a read-only note is refused')
    }
    symlinkSync('../grimoire.config.json', path.join(HUB, 'docs/cfg.md'))
    const cfgBefore = readFileSync(path.join(HUB, 'grimoire.config.json'), 'utf8')
    ok((await req(`/api/doc?repo=${hub}&path=docs/cfg.md`)).status === 404 && (await put({ repo: hub, path: 'docs/cfg.md', text: 'PWNED', base: docHash(cfgBefore) })).status === 400 && readFileSync(path.join(HUB, 'grimoire.config.json'), 'utf8') === cfgBefore,
      'a .md symlink to a file that is not a note is neither served nor written')
    writeFileSync(path.join(HUB, 'docs/huge.md'), 'x'.repeat(600 * 1024))
    ok((await req(`/api/doc?repo=${hub}&path=docs/huge.md`)).status === 413, 'a note past the size limit is not served for editing')
    ok(readdirTmp(HUB).length === 0, 'no temporary file is left behind')
  } finally { await s.close() }
}
function readdirTmp(dir) { const out = []; const walk = (d) => { for (const e of readdirSyncSafe(d)) { const p = path.join(d, e.name); if (e.isDirectory() && e.name !== 'outside') walk(p); else if (/\.tmp$/.test(e.name)) out.push(p) } }; walk(dir); return out }
function readdirSyncSafe(d) { try { return readdirSync(d, { withFileTypes: true }) } catch { return [] } }

// ── 5 · the page: both tabs, by the page's own script ──
console.log('\n5 · the page')
if (maj < 22 || (maj === 22 && min < 5)) console.log('   - skipped: needs node:sqlite (Node ≥ 22.5)')
else {
  const { renderGraph } = await import('../lib/render.mjs')
  const project = loadProject(HUB)
  mkdirSync(project.architectureDir, { recursive: true })
  writeFileSync(path.join(project.architectureDir, 'hub.architecture.json'), JSON.stringify({ schema: 1, title: 'Hub', summary: 'The hub.', components: [{ id: 'users', label: 'Users', type: 'external' }, { id: 'api', label: 'API', type: 'backend', sources: ['api:README.md:1'] }], connections: [{ from: 'users', to: 'api', label: 'HTTPS' }], cards: [{ title: 'Note', color: 'rose', items: ['one'] }] }))
  writeFileSync(path.join(project.architectureDir, 'broken.architecture.json'), '{ nope')
  writeFileSync(path.join(project.architectureDir, 'badtypes.architecture.json'), JSON.stringify({ schema: 1, title: 'Bad', components: [{ id: 'a', label: 'A', type: 'cli' }], boundaries: 'x', cards: 'abc' }))
  writeFileSync(path.join(HUB, 'docs/links.md'), 'See [[guide]], ![[pic.png]], [[Node.js]], [steps](guide.md#Setup%20Steps) and `repos/api/README.md`.\n')
  writeFileSync(path.join(HUB, 'docs/Node.js.md'), '# Node\n')
  writeFileSync(path.join(HUB, 'repos/api/docs/guide.md'), '# API guide\n')
  writeFileSync(path.join(HUB, 'repos/api/docs/a.markdown'), 'Read [[docs/guide]].\n')
  const page = await renderGraph(project)
  const D = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(page)[1].replace(/\\u003c/g, '<'))
  ok(D.arch.map((a) => `${a.file}:${a.errors && !a.comps ? 'error' : a.comps.length}`).join(' ') === 'docs/architecture/badtypes.architecture.json:error docs/architecture/broken.architecture.json:error docs/architecture/hub.architecture.json:2' && D.arch[0].errors.includes('boundaries: must be a list'),
    `saved diagrams are listed; one that does not parse or check carries its errors and takes nothing else down (${D.arch.map((a) => a.file)})`)
  ok(!page.includes('connect-src') && D.serve === undefined && D.docs.length === scanDocs(project).length && page.includes("base-uri 'none'; form-action 'none'"), 'a rendered (not served) page cannot save, carries every note, and allows no base or form target')
  const script = (/<script>([\s\S]*)<\/script>\s*<\/body>/.exec(page) || [])[1] || ''
  ok(!/<!--|<script/i.test(script), 'the page script never opens an HTML comment or a script element')
  ok(['mdToHtml', 'mdFront', 'mdSlug', 'archClient', 'docsClient'].every((n) => script.includes(`function ${n}(`)), 'the page carries the Markdown helpers and both tabs')
  const vm = await import('node:vm')
  const blob = /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(page)[1]
  const listeners = {}
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.on = {}; this.dataset = {}; this.html = ''; this.value = ''; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} } }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = String(v) }
    append(...c) { this.kids.push(...c) }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f) }
    set innerHTML(v) { this.html = v; this.firstChild = new El('svg') }
    get innerHTML() { return this.html }
    querySelectorAll() { return [] }
    focus() {} setSelectionRange() {}
    get offsetHeight() { return 0 }
  }
  const doc = { createElement: (t) => new El(t), getElementById: (id) => (id === 'graph-data' ? { textContent: blob } : null), body: { replaceChildren(...c) { this.kids = c } }, documentElement: { style: { setProperty() {} } }, activeElement: null, querySelector: () => null }
  const loc = { hash: '#architecture' }
  vm.runInNewContext(script, { document: doc, window: { addEventListener: (t, f) => { listeners[t] = f }, innerWidth: 1400, scrollTo() {} }, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }) })
  const dump = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : `${n.html || ''} ${Object.values(n.attrs || {}).join(' ')} ${(n.kids || []).map(dump).join(' ')}`)
  const text = () => (doc.body.kids || []).map(dump).join(' ')
  const go = (h) => { loc.hash = h; listeners.hashchange() }
  ok(loc.hash === '#arch-0' && /does not pass its check/.test(text()) && /boundaries: must be a list/.test(text()), 'the Architecture tab opens on the first diagram; a broken one says why it is not drawn')
  go('#arch-1')
  ok(/does not parse/.test(text()), 'a diagram that does not parse says so')
  go('#arch-2')
  ok(/data-comp="users"/.test(text()) && /HTTPS/.test(text()) && /The hub\./.test(text()) && /acard c-rose/.test(text()), 'a diagram: its components, labelled lines, summary and cards')
  ok(D.arch.length === 3, 'an index with no production code offers no drafted diagram')
  const at = (repo, p2) => D.docs.findIndex((d) => d[0] === repo && d[2] === p2)
  const hubName = path.basename(HUB), guide = at(hubName, 'docs/guide.md'), agents = at(hubName, 'AGENTS.md'), apiGuide = at('api', 'docs/guide.md'), apiReadme = at('api', 'README.md')
  go(`#doc-${agents}`)
  ok(/<h1 id="h-agents-v3">Agents v3<\/h1>/.test(text()) && /Read-only snapshot/.test(text()) && /disabled/.test(text()), `a note renders read-only on a page that is not served (${loc.hash})`)
  go(`#doc-${guide}`)
  ok(/Backlinks \(1\)/.test(text()) && /links/.test(text()), 'a note lists the note that links to it')
  go(`#doc-${at(hubName, 'docs/links.md')}`)
  const links = text()
  ok(links.includes(`data-doc="${guide}" data-anchor="setup-steps"`) && links.includes(`data-doc="${apiReadme}"`) && links.includes(`data-doc="${at(hubName, 'docs/Node.js.md')}"`) && !links.includes('data-new="pic.png"') && /Unresolved links/.test(links) === false,
    'links: a percent-encoded heading, a path naming a note, a note with a dot in its name, and an image embed that is no missing note')
  go(`#doc-${at('api', 'docs/a.markdown')}`)
  ok(text().includes(`data-doc="${apiGuide}"`), "a wikilink path resolves in the note's own repository first")
  go(`#doc-${apiGuide}`)
  ok(/Backlinks \(1\)/.test(text()), "and the repository's note counts the backlink")
  go('#docs')
  ok(/notes/.test(text()) && /At the top/.test(text()), 'the Docs home: counts and the top-level notes')
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
