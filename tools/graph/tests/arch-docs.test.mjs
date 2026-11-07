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
//  4. the server (serve.mjs): host, origin and token checks, reading, saving, conflicts, creating;
//     acknowledging a design delta's changes (the one other file it writes)
//  5. the page: both tabs rendered by the page's own script in a stub DOM
//  6. the architecture change view (arch-change.mjs): the delta's architecture targets and their
//     validation, acknowledgements and appended changes in their list, the diagram diff, the check's
//     findings on two indexes, the states of the delta's architecture changes and the unplanned
//  7. the Architecture tab draws it: a worktree branch against its base checkout (two hand-built
//     indexes), the Changes and Delta overlays in a stub DOM, acknowledging through the server,
//     the undrawn link kept, appended, then drawn (built), and no base index (diagram files only)
//
//  Needs no parser runtime: indexes here are built by hand (sections 2) or empty (4, 5).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync, readdirSync, lstatSync, chmodSync, rmdirSync, utimesSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'

const { mdToHtml, mdFront, mdSlug } = await import('../lib/md.mjs')
const A = await import('../lib/arch.mjs')
const { scanDocs, resolveDoc, docRoots, docHash } = await import('../lib/docs.mjs')
const { loadProject } = await import('../lib/project.mjs')

let PASS = 0, FAIL = 0
const eq2 = (got, want, m) => ok(JSON.stringify(got) === JSON.stringify(want), `${m}${JSON.stringify(got) === JSON.stringify(want) ? '' : ` (got ${JSON.stringify(got)})`}`)
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

  // acknowledging a design delta's changes: PUT /api/delta, the one other file the server writes
  const { changeHash } = await import('../lib/data/delta.mjs')
  const DH = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-delta-srv-')))
  const w = (p, t) => { mkdirSync(path.dirname(path.join(DH, p)), { recursive: true }); writeFileSync(path.join(DH, p), t) }
  const at = (p) => path.join(DH, p)
  w('grimoire.config.json', JSON.stringify({ repos: [{ name: 'api', path: 'repos/api' }] }))
  const DELTA = { schema: 1, spec: 'docs/specs/2026-11-06-loans-design.md', data: [
    { id: 'one', op: 'add', target: 'api:db/books.isbn', after: { type: 'TEXT', nullable: true }, why: 'search by isbn', origin: 'planned' },
    { id: 'two', op: 'remove', target: 'api:db/legacy', why: 'nothing reads it', slice: 2, origin: 'planned', ack: { by: 'Old Hand', at: '2026-01-01T00:00:00.000Z', hash: '0000000000000000' } },
    { id: 'three', op: 'add', target: 'api:db/loans/index:loans_due_idx', after: { columns: ['due_on'] }, why: 'list what is due', origin: 'planned' },
  ], architecture: [] }
  const TEXT = JSON.stringify(DELTA, null, 2) + '\n', REL = 'docs/specs/2026-11-06-loans.delta.json'
  w(`repos/api/${REL}`, TEXT); w(REL, TEXT); w('repos/api/package.json', '{}\n'); w('outside/stolen.delta.json', TEXT)
  w('repos/api/docs/specs/notes.json', '{}'); w('repos/api/docs/specs/notes.md', '# n\n'); w(`repos/api/docs/plans/2026-11-06-loans.delta.json`, TEXT); w('repos/api/docs/specs/broken.delta.json', '{ "schema": 1, "spec": "s", "data": [{ "id": "x" }], "architecture": [] }\n')
  symlinkSync(at('outside/stolen.delta.json'), at('repos/api/docs/specs/out.delta.json'))
  symlinkSync('../../package.json', at('repos/api/docs/specs/pkg.delta.json'))
  const gitOk = spawnSync('git', ['init', '-q'], { cwd: at('repos/api') }).status === 0 && spawnSync('git', ['config', 'user.name', 'Delta Tester'], { cwd: at('repos/api') }).status === 0
  const dproj = loadProject(DH)
  ;(await openStore(dproj.dbPath)).close()
  const s2 = await serve(dproj, { refresh: false })
  const dput = (o, headers = {}, method = 'PUT') => fetch(`http://127.0.0.1:${s2.port}/api/delta`, { method, headers: { 'x-grimoire-token': s2.token, 'content-type': 'application/json', ...headers }, body: method === 'PUT' ? JSON.stringify(o) : undefined }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }))
  const disk = (p = `repos/api/${REL}`) => readFileSync(at(p), 'utf8')
  const ackBlock = /,\n {6}"ack": \{\n {8}"by": "[^"\n]*",\n {8}"at": "[^"\n]*",\n {8}"hash": "[0-9a-f]{16}"\n {6}\}/g
  try {
    const t0 = Date.now()
    let r = await dput({ repo: 'api', path: REL, base: docHash(TEXT), ids: ['one'], ack: true, by: 'Mallory', at: '1999-01-01T00:00:00.000Z', hash: 'ffffffffffffffff' })
    const after = JSON.parse(disk()), a1 = after.data[0].ack
    const expectBy = gitOk ? 'Delta Tester' : null
    ok(r.status === 200 && a1 && (!expectBy || a1.by === expectBy) && a1.hash === changeHash(DELTA.data[0]) && Date.parse(a1.at) >= t0 - 1000 && Date.parse(a1.at) <= Date.now() + 1000 && r.j.hash === docHash(disk()) && JSON.stringify(r.j.changes) === JSON.stringify([{ id: 'one', ack: a1 }]),
      `acknowledging writes ack into the delta: by the repository's git user.name, at now, the change's hash, all set by the server whatever the request says (${JSON.stringify(a1)})`)
    const oldAck = TEXT.slice(TEXT.indexOf(',\n      "ack": {\n        "by": "Old Hand"'), TEXT.indexOf('}', TEXT.indexOf('"by": "Old Hand"')) + 1)
    ok(disk().replace(ackBlock, '') === TEXT.replace(ackBlock, '') && disk().includes(oldAck) && disk().split('\n').length === TEXT.split('\n').length + 5 && disk().endsWith('\n') && /\n {2}"schema": 1,\n/.test(disk()), '… in the file\'s 2-space style with its final newline; every other change and every other line untouched')
    r = await dput({ repo: 'api', path: REL, base: r.j.hash, ids: ['two'], ack: false })
    const two = JSON.parse(disk()).data[1]
    ok(r.status === 200 && two.ack === undefined && JSON.stringify(r.j.changes) === JSON.stringify([{ id: 'two', ack: null }]) && disk().replace(ackBlock, '') === TEXT.replace(ackBlock, ''), 'unacknowledging removes ack, and nothing else')
    const before = disk()
    r = await dput({ repo: 'api', path: REL, base: docHash(TEXT), ids: ['three'], ack: true })
    ok(r.status === 409 && r.j.text === before && r.j.hash === docHash(before) && disk() === before, 'a write against a delta that changed since it was loaded is refused, with the disk text, and nothing is written')
    r = await dput({ repo: 'api', path: REL, base: docHash(before), ids: ['three', 'nope'], ack: true })
    ok(r.status === 400 && r.j.error === 'no change with the id "nope"' && disk() === before, 'an id the delta does not hold: refused, nothing written (not even the ids it does hold)')
    r = await dput({ repo: 'api', path: 'docs/specs/broken.delta.json', base: docHash(disk('repos/api/docs/specs/broken.delta.json')), ids: ['x'], ack: true })
    ok(r.status === 422 && r.j.error.startsWith('the delta does not validate: data[0] (x): op undefined') && disk('repos/api/docs/specs/broken.delta.json').includes('"id": "x" }'), 'a delta that does not validate is never written: its problems say why')
    const refused = [['api', '../docs/specs/x.delta.json'], ['api', 'docs/specs/../specs/2026-11-06-loans.delta.json'], ['api', `${at('repos/api')}/${REL}`], ['api', 'docs/specs/notes.json'], ['api', 'docs/specs/notes.md'], ['api', 'docs/plans/2026-11-06-loans.delta.json'], ['api', 'docs/specs/out.delta.json'], ['api', 'docs/specs/pkg.delta.json'], ['api', 'docs/specs/none.delta.json'], [path.basename(DH), `repos/api/${REL}`], ['nope', REL], ['api', 'docs/specs/%2e%2e/%2e%2e/package.json'], ['api', 'docs/specs/%2e%2e%2f%2e%2e%2fpackage.delta.json'], ['api', REL.replace('.delta.json', '.DELTA.JSON')]]
    const got = []
    for (const [repo, p] of refused) got.push((await dput({ repo, path: p, base: 'x', ids: ['one'], ack: true })).status)
    ok(got.every((x) => x === 400) && disk('outside/stolen.delta.json') === TEXT && disk('repos/api/package.json') === '{}\n' && disk(`repos/api/docs/plans/2026-11-06-loans.delta.json`) === TEXT,
      `only docs/specs/<name>.delta.json in a root is written: refused a parent path, a path not plain, an absolute path, another extension, another folder, a symlink out, a symlink to a file that is not a delta, a missing delta, another repository's delta from the hub, an unknown repository, %2e%2e (never decoded), an extension in another case (${got.join(' ')})`)
    const hubBy = (spawnSync('git', ['-C', DH, 'config', 'user.name'], { encoding: 'utf8' }).stdout || '').trim() || userInfo().username
    r = await dput({ repo: path.basename(DH), path: REL, base: docHash(disk(REL)), ids: ['three'], ack: true })
    ok(r.status === 200 && JSON.parse(disk(REL)).data[2].ack.by === hubBy, `a delta beside the hub's own specs is written too, by the git user.name its folder sees, else the system user (${hubBy})`)
    ok((await dput({ repo: 'api', path: REL, base: 'x', ids: ['one'], ack: true }, { 'x-grimoire-token': 'wrong' })).status === 403 && (await dput({ repo: 'api', path: REL, base: 'x', ids: ['one'], ack: true }, { origin: 'http://evil.example' })).status === 403 && (await dput({ repo: 'api', path: REL, base: 'x', ids: ['one'], ack: true }, { 'content-type': 'text/plain' })).status === 415,
      'the notes\' rules hold: the token, no cross-origin write, JSON only')
    const rawHost = await new Promise(async (resolve) => { const q = (await import('node:http')).request({ host: '127.0.0.1', port: s2.port, path: '/api/delta', method: 'PUT', headers: { host: 'evil.example', 'x-grimoire-token': s2.token, 'content-type': 'application/json' } }, (x) => { x.resume(); resolve(x.statusCode) }); q.end('{}') })
    ok(rawHost === 403 && (await dput(null, {}, 'GET')).status === 405, 'a request naming another host is refused; only PUT is answered')
    for (const bad of [{ repo: 'api', path: REL, ids: ['one'], ack: true }, { repo: 'api', path: REL, base: 'x', ids: [], ack: true }, { repo: 'api', path: REL, base: 'x', ids: ['one'] }]) ok((await dput(bad)).status === 400, `a request must name the hash it loaded, the ids, and ack true or false (${JSON.stringify(Object.keys(bad))})`)
    if (!(process.getuid && process.getuid() === 0)) {
      chmodSync(at(`repos/api/${REL}`), 0o444)
      ok((await dput({ repo: 'api', path: REL, base: docHash(disk()), ids: ['three'], ack: true })).status === 403, 'a read-only delta is refused')
      chmodSync(at(`repos/api/${REL}`), 0o644)
    }
    if (gitOk) {
      const logged = []
      const s3 = await serve(dproj, { refresh: false, log: (m) => logged.push(m) })
      try {
        spawnSync('git', ['config', 'user.name', `Line one\nLine\ttwo ${'x'.repeat(500)}`], { cwd: at('repos/api') })
        const r3 = await fetch(`http://127.0.0.1:${s3.port}/api/delta`, { method: 'PUT', headers: { 'x-grimoire-token': s3.token, 'content-type': 'application/json' }, body: JSON.stringify({ repo: 'api', path: REL, base: docHash(disk()), ids: ['three'], ack: true }) })
        const by = JSON.parse(disk()).data[2].ack.by
        ok(r3.status === 200 && by.length <= 120 && !/[\u0000-\u001f\u007f]/.test(by) && by.startsWith('Line one Line two xxx'), `a git user.name is written capped and on one line (${JSON.stringify(by.slice(0, 30))}…, ${by.length} chars)`)
        writeFileSync(at(`repos/api/${REL}`), JSON.stringify({ ...DELTA, data: [...DELTA.data, { id: 'four\u001b[2Jfive', op: 'remove', target: 'api:db/old', why: 'w', origin: 'planned' }] }, null, 2) + '\n')
        await fetch(`http://127.0.0.1:${s3.port}/api/delta`, { method: 'PUT', headers: { 'x-grimoire-token': s3.token, 'content-type': 'application/json' }, body: JSON.stringify({ repo: 'api', path: REL, base: docHash(disk()), ids: ['four\u001b[2Jfive'], ack: true }) })
        ok(logged.length === 2 && logged.every((m) => !/[\u0000-\u001f\u007f]/.test(m)) && logged[1].includes('"four\\u001b[2Jfive"'), `the server's log never prints a control character from a request (${JSON.stringify(logged[1])})`)
      } finally { spawnSync('git', ['config', 'user.name', 'Delta Tester'], { cwd: at('repos/api') }); await s3.close() }
    }
    // the delta's lock, shared with the loop's ship step (tools/graph/delta-append.mjs, lib/data/delta-lock.mjs):
    // one read → check → write at a time, so an acknowledgement and an appended change never undo each other
    const LOCK = `${at(`repos/api/${REL}`)}.lock`
    const s4 = await serve(dproj, { refresh: false, deltaLock: { waitMs: 1200, staleMs: 5000 } })
    const put4 = (o) => fetch(`http://127.0.0.1:${s4.port}/api/delta`, { method: 'PUT', headers: { 'x-grimoire-token': s4.token, 'content-type': 'application/json' }, body: JSON.stringify(o) }).then(async (x) => ({ status: x.status, j: await x.json().catch(() => ({})) }))
    try {
      mkdirSync(LOCK)
      const t0 = Date.now()
      const pending = put4({ repo: 'api', path: REL, base: docHash(disk()), ids: ['one'], ack: true })
      await new Promise((res) => setTimeout(res, 400))
      const waited = disk()
      rmdirSync(LOCK)
      let r4 = await pending
      ok(r4.status === 200 && Date.now() - t0 >= 400 && !JSON.parse(waited).data[0].ack && JSON.parse(disk()).data[0].ack && !existsSync(LOCK), 'a lock held by another writer: the acknowledgement waits (nothing written meanwhile), then goes through once it is released, and releases its own')
      mkdirSync(LOCK)
      const held = disk()
      r4 = await put4({ repo: 'api', path: REL, base: docHash(held), ids: ['one'], ack: true })
      ok(r4.status === 503 && /busy/.test(r4.j.error) && disk() === held && existsSync(LOCK), `held past the wait: 503, busy, try again (the page says it beside the control); nothing written, the other writer's lock left alone (${r4.status} ${r4.j.error})`)
      const old = new Date(Date.now() - 60_000)
      utimesSync(LOCK, old, old)
      r4 = await put4({ repo: 'api', path: REL, base: docHash(disk()), ids: ['one'], ack: true })
      ok(r4.status === 200 && JSON.parse(disk()).data[0].ack && !existsSync(LOCK), 'a stale lock (a writer that died holding it) is broken, and the acknowledgement written')
      const lockOf = (p) => existsSync(`${at(p)}.lock`)
      const paths = [
        [409, await put4({ repo: 'api', path: REL, base: 'stale-hash', ids: ['one'], ack: true }), `repos/api/${REL}`],
        [400, await put4({ repo: 'api', path: REL, base: docHash(disk()), ids: ['nope'], ack: true }), `repos/api/${REL}`],
        [422, await put4({ repo: 'api', path: 'docs/specs/broken.delta.json', base: docHash(disk('repos/api/docs/specs/broken.delta.json')), ids: ['x'], ack: true }), 'repos/api/docs/specs/broken.delta.json'],
      ]
      if (!(process.getuid && process.getuid() === 0)) {
        chmodSync(at(`repos/api/${REL}`), 0o200) // writable, not readable: the read inside the lock throws
        paths.push([500, await put4({ repo: 'api', path: REL, base: 'x', ids: ['one'], ack: true }), `repos/api/${REL}`])
        chmodSync(at(`repos/api/${REL}`), 0o644)
      }
      ok(paths.every(([want, got, p]) => got.status === want && !lockOf(p)), `the lock is released on every path: ${paths.map(([want, got]) => `${want}→${got.status}`).join(', ')}`)
    } finally { if (existsSync(LOCK)) rmdirSync(LOCK); await s4.close() }

    // an architecture change is acknowledged the same way, by its id, in the same request as a data one
    const AREL = 'docs/specs/2026-11-07-search.delta.json'
    const ARCH = { schema: 1, spec: 'docs/specs/2026-11-07-search-design.md', data: [{ id: 'col', op: 'add', target: 'api:db/books.isbn', after: { type: 'TEXT', nullable: true }, why: 'w', origin: 'planned' }],
      architecture: [{ id: 'search', op: 'add', target: 'component:search', after: { label: `Search ${'"'}><img src=x>`, type: 'backend' }, why: 'find books', slice: 2, origin: 'planned' }, { id: 'line', op: 'add', target: 'connection:web->search', why: 'the page asks it', origin: 'planned' }] }
    const ATEXT = JSON.stringify(ARCH, null, 2) + '\n'
    w(`repos/api/${AREL}`, ATEXT)
    r = await dput({ repo: 'api', path: AREL, base: docHash(ATEXT), ids: ['search', 'col'], ack: true })
    const ad = JSON.parse(disk(`repos/api/${AREL}`))
    ok(r.status === 200 && ad.architecture[0].ack.hash === changeHash(ARCH.architecture[0]) && ad.data[0].ack.hash === changeHash(ARCH.data[0]) && !ad.architecture[1].ack && r.j.changes.map((c) => c.id).join() === 'search,col' && disk(`repos/api/${AREL}`).split('\n').length === ATEXT.split('\n').length + 10,
      'PUT /api/delta acknowledges an architecture change by its id, beside a data one in the same request: each ack edited in place in its own list, with its own hash')
    const before2 = disk(`repos/api/${AREL}`)
    eq2([(await dput({ repo: 'api', path: AREL, base: docHash(ATEXT), ids: ['line'], ack: true })).status, (await dput({ repo: 'api', path: AREL, base: docHash(before2), ids: ['line', 'nope'], ack: true })).status, disk(`repos/api/${AREL}`) === before2], [409, 400, true], 'the same refusals: a stale base (409), an id it does not hold (400), nothing written')
    r = await dput({ repo: 'api', path: AREL, base: docHash(before2), ids: ['search'], ack: false })
    ok(r.status === 200 && !JSON.parse(disk(`repos/api/${AREL}`)).architecture[0].ack && JSON.parse(disk(`repos/api/${AREL}`)).data[0].ack, 'unacknowledging an architecture change removes its ack, and only its')
    ok(readdirTmp(DH).length === 0, 'no temporary file is left behind')
    const pageD = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec((await fetch(`http://127.0.0.1:${s2.port}/?t=${s2.token}`).then((x) => x.text())))[1].replace(/\\u003c/g, '<')).data
    ok(pageD.deltas.map((d) => `${d.repo}:${d.path}:${d.ackable}:${d.hash === docHash(disk(d.repo === 'api' ? `repos/api/${d.path}` : d.path))}`).sort().join(' ') === `api:${REL}:true:true api:${AREL}:true:true api:docs/specs/broken.delta.json:true:true ${path.basename(DH)}:${REL}:true:true`,
      'the served page carries every delta beside the specs, with the hash each was loaded with and where it may be written (symlinks out and links to other files are not listed)')
  } finally { await s2.close() }
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
  ok(['mdToHtml', 'mdFront', 'mdSlug', 'archClient', 'docsClient', 'stageClient'].every((n) => script.includes(`function ${n}(`)), 'the page carries the Markdown helpers, both tabs and the stages\' navigation')
  const vm = await import('node:vm')
  const blob = /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(page)[1]
  const listeners = {}
  const { ctlQuery } = await import('./stage-kit.mjs')
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.on = {}; this.dataset = {}; this.html = ''; this.value = ''; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} } }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = String(v) }
    append(...c) { this.kids.push(...c) }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f) }
    set innerHTML(v) { this.html = v; this.firstChild = new El('svg') }
    get innerHTML() { return this.html }
    querySelectorAll() { return [] }
    focus(o) { this.focusedWith = o || {} } setSelectionRange() {}
    get offsetHeight() { return 0 }
  }
  const doc = { createElement: (t) => new El(t), getElementById: (id) => (id === 'graph-data' ? { textContent: blob } : null), body: { replaceChildren(...c) { this.kids = c } }, documentElement: { style: { setProperty() {} } }, activeElement: null }
  doc.querySelector = ctlQuery(() => ({ kids: doc.body.kids || [] }))
  const loc = { hash: '#architecture' }
  vm.runInNewContext(script, { document: doc, window: { addEventListener: (t, f) => { const prev = listeners[t]; listeners[t] = prev ? (e) => { prev(e); f(e) } : f }, innerWidth: 1400, scrollTo() {} }, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }) })
  const dump = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : `${n.html || ''} ${Object.values(n.attrs || {}).join(' ')} ${(n.kids || []).map(dump).join(' ')}`)
  const text = () => (doc.body.kids || []).map(dump).join(' ')
  const go = (h) => { loc.hash = h; listeners.hashchange() }
  ok(loc.hash === '#arch-0' && /does not pass its check/.test(text()) && /boundaries: must be a list/.test(text()), 'the Architecture tab opens on the first diagram; a broken one says why it is not drawn')
  go('#arch-1')
  ok(/does not parse/.test(text()), 'a diagram that does not parse says so')
  go('#arch-2')
  ok(/data-comp="users"/.test(text()) && /HTTPS/.test(text()) && /The hub\./.test(text()) && /acard c-rose/.test(text()), 'a diagram: its components, labelled lines, summary and cards')
  ok(D.arch.length === 3, 'an index with no production code offers no drafted diagram')
  // the zoom controls and the full-size button sit inside the diagram's own box, in and out of full size
  const findIn = (n, pred) => { if (!n || typeof n !== 'object') return null; if (pred(n)) return n; for (const k of n.kids || []) { const f = findIn(k, pred); if (f) return f } return null }
  const body = () => ({ kids: doc.body.kids || [] })
  const byCtl = (n, c) => findIn(n, (x) => x.attrs && x.attrs['data-ctl'] === c)
  const stageA = () => findIn(body(), (x) => x.attrs && x.attrs['data-stage'] === 'arch')
  const ARCH_CTL = ['arch-fit', 'arch-out', 'arch-100', 'arch-in', 'arch-full']
  ok(stageA() && ARCH_CTL.every((c) => byCtl(stageA(), c)) && !byCtl(findIn(body(), (x) => x.attrs && /\btoolbar\b/.test(x.attrs.class || '')), 'arch-fit'),
    'Fit, −, 100%, + and full size sit inside the diagram, not in the toolbar above it')
  const press = (c) => (byCtl(body(), c).on.click || []).forEach((f) => f({}))
  press('arch-full')
  ok(/\bstage full\b/.test(stageA().attrs.class) && byCtl(body(), 'arch-full').attrs['aria-pressed'] === 'true' && ARCH_CTL.every((c) => byCtl(stageA(), c)),
    'full size: the diagram fills the window and keeps its zoom controls')
  press('arch-in')
  ok(/\bstage full\b/.test(stageA().attrs.class), 'a zoom inside full size stays full size (the page re-renders)')
  listeners.keydown({ key: 'Escape' })
  ok(!/\bfull\b/.test(stageA().attrs.class) && byCtl(body(), 'arch-full').attrs['aria-pressed'] === 'false', 'Escape leaves full size')
  // the stage: a drag never selects the page and follows the pointer past the box; the keys pan and zoom
  {
    const { scrollStageCases, inside } = await import('./stage-kit.mjs')
    const labels = ['API', 'Users']
    scrollStageCases(ok, {
      name: 'Architecture', page, active: (el) => { doc.activeElement = el },
      box: () => findIn(body(), (x) => x.attrs && x.attrs.id === 'arch-box'), zoom0: 1.15, // + was pressed above
      items: [inside('[data-comp]', { comp: 'api' }), inside('[data-comp]', { comp: 'users' })],
      opened: (i) => !!findIn(body(), (x) => x.tagName === 'H3' && x.kids.includes(labels[i])),
      fitted: () => byCtl(body(), 'arch-fit').attrs['aria-pressed'] === 'true', search: byCtl(body(), 'search'),
      win: (t, e) => listeners[t] && listeners[t](e), full: () => press('arch-full'), isFull: () => /\bstage full\b/.test(stageA().attrs.class),
    })
  }
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

// ── 6 · the architecture change view ──
console.log('\n6 · the architecture change view: the delta\'s architecture targets, the diagram diff, the findings on two indexes, the states')
{
  const { parseDelta, parseArchTarget, archTargetOf, changeHash, setAcks, appendChanges } = await import('../lib/data/delta.mjs')
  const AC = await import('../lib/arch-change.mjs')
  const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }
  // the target grammar
  eq([parseArchTarget('component:search'), parseArchTarget('connection:web-app->api.v2'), parseArchTarget('connection:a-->b'), parseArchTarget('connection:web->api#HTTPS # json'), parseArchTarget('boundary:Backend / deploy')],
    [{ kind: 'component', id: 'search' }, { kind: 'connection', from: 'web-app', to: 'api.v2', label: null }, { kind: 'connection', from: 'a-', to: 'b', label: null }, { kind: 'connection', from: 'web', to: 'api', label: 'HTTPS # json' }, { kind: 'boundary', label: 'Backend / deploy' }],
    'targets: a component by its id, a line by its two ends (an id may hold - and end with it: the one > splits them), one of several lines by #<label>, a boundary by its label')
  const bad = ['component:Search', 'component:', 'connection:web>api', 'connection:web->', 'connection:web->web', 'connection:web->api#', 'boundary:', 'module:x', 'api:db/books']
  ok(bad.every((t) => parseArchTarget(t).error), `refused: an id in upper case, no id, a line without ->, an end missing, a loop, an empty #label, no label, another kind, a data target (${bad.filter((t) => !parseArchTarget(t).error)})`)
  eq([archTargetOf('component', { id: 'x' }), archTargetOf('connection', { from: 'a', to: 'b' }), archTargetOf('connection', { from: 'a', to: 'b' }, 'SQL'), archTargetOf('boundary', { label: 'Edge' })], ['component:x', 'connection:a->b', 'connection:a->b#SQL', 'boundary:Edge'], 'the target of a drawn element, the inverse')
  // validation: the architecture list is checked now, change by change
  const ch = (id, op, target, extra = {}) => ({ id, op, target, why: `because ${id}`, origin: 'planned', ...extra })
  const errs = (architecture, data = []) => parseDelta(JSON.stringify({ schema: 1, spec: 's', data, architecture })).errors
  eq(errs([ch('c1', 'add', 'component:search', { after: { label: 'Search', type: 'backend', paths: ['src/search'] } }), ch('c2', 'add', 'connection:web->search'), ch('c3', 'change', 'connection:web->api', { after: { via: 'HTTP' } }),
    ch('c4', 'add', 'boundary:Edge', { after: { kind: 'trust', wraps: ['web'] } }), ch('c5', 'rename', 'component:api', { after: { id: 'orders' } }), ch('c6', 'rename', 'boundary:Edge', { after: { label: 'Public edge' } }), ch('c7', 'remove', 'component:legacy')]), [],
    'a component added with its label and type, a line added with no after, a line changed, a boundary added, a component renamed by id, a boundary by label, a removal: valid')
  eq(errs([ch('a1', 'add', 'component:x', { after: { label: 'X' } }), ch('a2', 'add', 'component:y', { after: { label: 'Y', type: 'server', col: 1 } }), ch('a3', 'rename', 'connection:a->b', { after: { label: 'z' } }),
    ch('a4', 'rename', 'component:x', { after: { id: 'Bad Id' } }), ch('a5', 'add', 'boundary:B', { after: { kind: 'zone', wraps: [] } }), ch('a6', 'change', 'connection:a->b', { after: {} }), ch('a7', 'remove', 'boundary:B', { after: { wraps: ['x'] } }), ch('a8', 'add', 'nope:x'), ch('a1', 'remove', 'component:z')], [ch('a7', 'remove', 'api:db/t')]),
  ['architecture[0] (a1): after: a component needs its type', 'architecture[1] (a2): after: a component\'s type "server" is not valid', 'architecture[1] (a2): after: "col" is not an attribute of a component (label, sublabel, type, paths, imports, sources, note, tag, repo)',
    'architecture[2] (a3): a connection has no name to rename: remove it and add the new one', 'architecture[3] (a4): after: { id }, the new id', 'architecture[4] (a5): after: a boundary\'s kind "zone" is not valid', 'architecture[4] (a5): after: a boundary\'s wraps [] is not valid',
    'architecture[5] (a6): after: what changes (label, variant, via, note)', 'architecture[6] (a7): a removal has no after', 'architecture[6] (a7): the id "a7" is data[0]\'s too: ids are unique', 'architecture[7] (a8): target: "nope:x" is no architecture target: component:<id>, connection:<from>-><to> or boundary:<label>', 'architecture[8] (a1): the id "a1" is architecture[0]\'s too: ids are unique'],
    'every problem named: a component without its type, an unknown type, a layout attribute, a line renamed, a bad id, a boundary kind and an empty wraps, a change that states nothing, a removal with after, another kind of target, an id used twice across both lists')
  // acknowledgements and appended changes find their list
  const FILE = JSON.stringify({ schema: 1, spec: 's', data: [ch('d1', 'remove', 'api:db/t')], architecture: [ch('a1', 'add', 'component:search', { after: { label: 'Search', type: 'backend' } })] }, null, 2) + '\n'
  const ACK = { by: 'Ann', at: '2026-11-07T08:00:00.000Z', hash: changeHash(JSON.parse(FILE).architecture[0]) }
  const acked = setAcks(FILE, new Map([[0, ACK]]), 'architecture')
  eq([JSON.parse(acked).architecture[0].ack, JSON.parse(acked).data[0].ack, acked.replace(/,\n {6}"ack": \{\n[^}]*\}/, '') === FILE], [ACK, undefined, true], 'setAcks edits an architecture change\'s ack in place, and nothing else')
  const unpl = (id, target, after) => ({ id, op: 'add', target, ...(after ? { after } : {}), why: 'the export needs it', slice: 1, origin: 'unplanned' })
  const ap = appendChanges(FILE, [unpl('u1', 'connection:web->store'), unpl('u2', 'api:db/t.x', { type: 'TEXT', nullable: true }), unpl('u3', 'component:Bad'), unpl('a1', 'component:dup', { label: 'D', type: 'cli' })])
  const after = JSON.parse(ap.text)
  eq([after.architecture.map((c) => c.id), after.data.map((c) => c.id), ap.refused.map((r) => r.id), ap.already, parseDelta(ap.text).errors], [['a1', 'u1'], ['d1', 'u2'], ['u3'], ['a1'], []],
    'appendChanges routes an architecture target to `architecture` and a data one to `data`; a bad target is refused; an id held in either list is already there')

  // the diagram diff, base → branch
  const base = { schema: 1, title: 'Shop', components: [{ id: 'web', label: 'Web', type: 'frontend', paths: ['src/web'] }, { id: 'api', label: 'API', type: 'backend', paths: ['src/api'] }, { id: 'store', label: 'Store', type: 'database', paths: ['src/store'] }, { id: 'old', label: 'Old', type: 'cli' }],
    connections: [{ from: 'web', to: 'api', label: 'HTTP' }, { from: 'api', to: 'store', label: 'SQL' }, { from: 'api', to: 'store', label: 'cache' }], boundaries: [{ label: 'Backend', kind: 'deploy', wraps: ['api', 'store'] }] }
  const branch = { ...base, components: [base.components[0], { ...base.components[1], label: 'Order API' }, base.components[2], { id: 'search', label: 'Search', type: 'backend', paths: ['src/search'] }],
    connections: [base.connections[0], base.connections[1], { from: 'web', to: 'store', label: 'reads' }], boundaries: [{ label: 'Backend', kind: 'deploy', wraps: ['api', 'store', 'search'] }] }
  const dd = AC.diffDiagrams([{ file: 'docs/architecture/shop.architecture.json', doc: base }, { file: 'docs/architecture/gone.architecture.json', doc: { schema: 1, title: 'Gone', components: [{ id: 'g', label: 'G', type: 'cli' }] } }, { file: 'docs/architecture/broken.architecture.json', error: 'does not parse: x' }],
    [{ file: 'docs/architecture/shop.architecture.json', doc: branch }, { file: 'docs/architecture/broken.architecture.json', doc: base }])
  eq(dd.files.map((f) => [f.file, f.change, f.changes.map((c) => `${c.change} ${c.target}${c.attrs.length ? ` ${c.attrs.map((a) => `${a.attr}: ${AC.shown(a.before)} → ${AC.shown(a.after)}`).join('; ')}` : ''}`)]), [
    ['docs/architecture/gone.architecture.json', 'removed', ['removed component:g']],
    ['docs/architecture/shop.architecture.json', 'modified', ['modified component:api label: API → Order API', 'removed component:old', 'added component:search', 'removed connection:api->store#cache', 'added connection:web->store', 'modified boundary:Backend wraps: api, store → api, search, store']],
  ], 'the diff: a component relabelled, removed and added; one of two lines on a pair removed, named by its label; a new line; a boundary that wraps one more; a diagram gone lists what it held')
  eq([dd.skipped, dd.counts], [[{ file: 'docs/architecture/broken.architecture.json', why: 'at the base, it does not parse: x' }], { files: 2, added: 2, removed: 3, modified: 2 }], 'a diagram that does not parse on a side is not compared, and said; the counts')

  // the findings on two indexes: the same diagram, the base checkout's index and the branch's
  const F = (files, edges, imports) => {
    const fs = files.map(([p], i) => ({ id: i + 1, repo: 'shop', path: p, lang: 'javascript', is_test: 0, node_id: 100 + i + 1 }))
    return { repos: ['shop'], files: fs, nodes: fs.map((f) => ({ id: 200 + f.id, file_id: f.id })), edges: edges.map(([a, b]) => ({ src: 200 + a, dst: 200 + b, kind: 'IMPORTS', confidence: 'import' })), imports: imports.map(([f, s]) => ({ file_id: f, source: s })) }
  }
  const shop = { schema: 1, title: 'Shop', components: [{ id: 'web', label: 'Web', type: 'frontend', paths: ['src/web'] }, { id: 'api', label: 'API', type: 'backend', paths: ['src/api'] }, { id: 'store', label: 'Store', type: 'database', paths: ['src/store'] }],
    connections: [{ from: 'web', to: 'api', label: 'HTTP' }, { from: 'api', to: 'store', label: 'SQL' }] }
  const BASE_FILES = [['src/web/page.js'], ['src/api/orders.js'], ['src/store/db.js'], ['src/api/cart.js']]
  const baseIdx = F(BASE_FILES, [[1, 2], [2, 3], [4, 3]], [])
  const brIdx = F([...BASE_FILES, ['src/jobs/mail.js']], [[1, 2], [1, 3], [4, 3]], [[3, 'redis'], [5, 'nodemailer']])
  const nf = A.newFindings(shop, brIdx, baseIdx)
  eq(nf.map((f) => `${f.kind} ${f.target} | ${f.text}`), [
    'undrawn connection:web->store | web uses store (1 file pair in the graph), but no line is drawn between them',
    'uncovered null | src/jobs (1 production file) is in no component',
    'service component:redis | the code imports Redis (redis), and no component reaches it',
  ], 'the findings new on the branch\'s index: a link no line draws, a module no component covers, an external service by import (a file in no component does not count)')
  const gone = A.newFindings(shop, F(BASE_FILES, [[1, 2], [4, 3]], []), baseIdx)
  eq(gone.map((f) => `${f.kind} ${f.target}`), [], 'api → store still seen through another file pair: nothing new')
  eq(A.newFindings(shop, F(BASE_FILES, [[1, 2]], []), baseIdx).map((f) => `${f.kind} ${f.target} | ${f.text}`), ['unseen connection:api->store | api → store is drawn, and the code does not show it'], 'a drawn line the code no longer shows')
  ok(A.analyze(shop, brIdx, null).warnings.includes('the code imports Redis (redis), and no component reaches it: draw it with "imports", or name the package in the "imports" of the component that stands for it'), 'the check warns of a service the code imports and no component reaches')

  // the states of the delta's architecture changes, against the diagrams and the branch's impact
  const cur = [{ file: 'docs/architecture/shop.architecture.json', doc: { ...shop, components: [...shop.components, { id: 'search', label: 'Search', type: 'worker', paths: ['src/search'] }], connections: [...shop.connections, { from: 'web', to: 'search' }] } }]
  const was = [{ file: 'docs/architecture/shop.architecture.json', doc: shop }]
  const impact = { diagrams: AC.diffDiagrams(was, cur), findings: nf.map((f) => ({ file: cur[0].file, ...f })), why: null, current: cur, before: was }
  const ack = (c, edit = {}) => ({ ...c, ...edit, ack: { by: 'Ann', at: '2026-11-07T08:00:00.000Z', hash: changeHash(c) } })
  const DELTA = [
    ack(ch('search', 'add', 'component:search', { after: { label: 'Search', type: 'backend' }, slice: 2 })),
    ch('to-search', 'add', 'connection:web->search'),
    ack(ch('cache', 'add', 'component:cache', { after: { label: 'Cache', type: 'database', imports: ['redis'] } }), { why: 'edited after the acknowledgement' }),
    ch('via', 'change', 'connection:web->api', { after: { via: 'HTTPS' } }),
    ch('legacy', 'remove', 'component:legacy'),
    ch('jobs', 'add', 'component:jobs', { after: { label: 'Jobs', type: 'worker', paths: ['src/jobs'] } }),
  ]
  const s = AC.archDeltaStates(DELTA, cur, { base: was, impact })
  eq(s.changes.map((r) => `${r.id} ${r.state}${r.ack ? ` ${r.ack}` : ''}${r.diffs.length ? ` [${r.diffs.map((x) => x.text).join('; ')}]` : ''}${r.proposed.length ? ` (${r.proposed.map((x) => x.text).join('; ')})` : ''}${r.warn ? ` ⚠ ${r.warn}` : ''}`), [
    'search built-differently acked [type: backend → worker]',
    'to-search planned-built',
    'cache pending stale',
    'via pending (via: none → HTTPS)',
    'legacy planned-built ⚠ not in the diagrams, nor at the base: check the target',
    'jobs pending',
  ], 'each state: drawn in another shape (planned → built), drawn as planned, not drawn yet (its acknowledgement stale once edited), a change with what it proposes, a removal gone (and never there: a warning)')
  eq(s.unplanned.map((u) => `${u.source} ${u.target}`), ['code connection:web->store'], 'unplanned: what the branch did that no change covers (the diagram\'s new component and line are planned; the service is covered by the planned cache\'s imports, the uncovered module by the planned jobs\' paths)')
  eq([s.counts.changes, s.counts['planned-built'], s.counts.pending, s.counts['built-differently'], s.counts.acked, s.counts.stale, s.counts.unplanned], [6, 2, 3, 1, 1, 1, 1], 'the counts')
  const renamed = AC.archDeltaStates([ch('ren', 'rename', 'component:api', { after: { id: 'orders' } })], [{ file: 'f', doc: { ...shop, components: shop.components.map((c) => (c.id === 'api' ? { ...c, id: 'orders' } : c)), connections: [{ from: 'web', to: 'orders' }, { from: 'orders', to: 'store' }] } }], { base: [{ file: 'f', doc: shop }], impact: { diagrams: AC.diffDiagrams([{ file: 'f', doc: shop }], [{ file: 'f', doc: { ...shop, components: shop.components.map((c) => (c.id === 'api' ? { ...c, id: 'orders' } : c)), connections: [{ from: 'web', to: 'orders' }, { from: 'orders', to: 'store' }] } }]), findings: [] } })
  eq([renamed.changes[0].state, renamed.unplanned.map((u) => u.target)], ['planned-built', []], 'a rename built covers the old and the new component and the lines that meet them')
}

// ── 7 · the Architecture tab draws the change view, on a worktree branch against its base checkout ──
console.log('\n7 · the Architecture tab: a branch against its base checkout, and a delta, drawn and acknowledged')
if (maj < 22 || (maj === 22 && min < 5)) console.log('   - skipped: needs node:sqlite (Node ≥ 22.5)')
else {
  const { openStore } = await import('../lib/store.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const { changeHash, appendChanges } = await import('../lib/data/delta.mjs')
  const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }
  const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
  const BAD = '"><img src=x onerror=alert(1)></title><script>x</script><!--'
  const escd = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const ROOT7 = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-arch-change-')))
  const MAIN = path.join(ROOT7, 'main'), FEAT = path.join(ROOT7, 'feat')
  const put = (dir, rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text) }
  const DIAGRAM = 'docs/architecture/shop.architecture.json'
  const shop = { schema: 1, title: 'Shop', summary: 'A shop.', components: [{ id: 'web', label: 'Web', type: 'frontend', paths: ['src/web'] }, { id: 'api', label: 'API', type: 'backend', paths: ['src/api'] }, { id: 'store', label: 'Store', type: 'database', paths: ['src/store'] }],
    connections: [{ from: 'web', to: 'api', label: 'HTTP' }, { from: 'api', to: 'store', label: 'SQL' }], boundaries: [{ label: 'Backend', kind: 'deploy', wraps: ['api', 'store'] }] }
  // an index built by hand, as the code would give it: one function per file, the links between files
  // (it records the checkout's HEAD, as an index run does: the base's is compared with the fork point)
  const handIndex = async (dir, files, links) => {
    rmSync(path.join(dir, '.grimoire'), { recursive: true, force: true })
    const db = await openStore(path.join(dir, '.grimoire/graph/graph.db'))
    db.prepare('INSERT INTO repos(name, root, head, indexed_at) VALUES (?, ?, ?, ?)').run('shop', '.', git(dir, 'rev-parse', 'HEAD').stdout.trim(), '')
    files.forEach((p, i) => {
      db.prepare('INSERT INTO files(id, repo, path, lang, size, mtime, hash, is_test, node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(i + 1, 'shop', p, 'javascript', 10, 0, '', 0, 100 + i + 1)
      db.prepare("INSERT INTO nodes(id, file_id, kind, name, qualname, line, is_test) VALUES (?, ?, 'file', ?, ?, 1, 0)").run(100 + i + 1, i + 1, p, p)
      db.prepare("INSERT INTO nodes(id, file_id, kind, name, qualname, line, is_test) VALUES (?, ?, 'function', ?, ?, 1, 0)").run(200 + i + 1, i + 1, `f${i}`, `f${i}`)
    })
    for (const [a, b] of links) db.prepare("INSERT INTO edges(src, dst, kind, confidence, line) VALUES (?, ?, 'CALLS', 'import', 1)").run(200 + files.indexOf(a) + 1, 200 + files.indexOf(b) + 1)
    db.close()
  }
  const CODE = ['src/web/page.js', 'src/api/orders.js', 'src/store/db.js']
  try {
    put(MAIN, 'grimoire.config.json', JSON.stringify({ repos: [{ name: 'shop', path: '.' }] }))
    put(MAIN, '.gitignore', '.grimoire/\n')
    for (const p of CODE) put(MAIN, p, 'export const x = 1\n')
    put(MAIN, DIAGRAM, JSON.stringify(shop, null, 2) + '\n')
    git(MAIN, 'init', '-q', '-b', 'main'); git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base')
    git(MAIN, 'worktree', 'add', '-q', '-b', 'feat', FEAT)
    await handIndex(MAIN, CODE, [['src/web/page.js', 'src/api/orders.js'], ['src/api/orders.js', 'src/store/db.js']])
    // the branch: the web page now imports the store directly (no line draws it), a search service is
    // drawn in the diagram, and a design's delta proposes a cache
    put(FEAT, 'src/search/index.js', 'export const y = 2\n')
    const BR_CODE = [...CODE, 'src/search/index.js']
    await handIndex(FEAT, BR_CODE, [['src/web/page.js', 'src/api/orders.js'], ['src/api/orders.js', 'src/store/db.js'], ['src/web/page.js', 'src/store/db.js']])
    const drawn = (extra = {}) => ({ ...shop, components: [...shop.components, { id: 'search', label: 'Search', type: 'backend', paths: ['src/search'] }], boundaries: [{ label: 'Backend', kind: 'deploy', wraps: ['api', 'store', 'search'] }], ...extra })
    put(FEAT, DIAGRAM, JSON.stringify(drawn(), null, 2) + '\n')
    const ch = (id, op, target, extra = {}) => ({ id, op, target, why: `because ${id}`, origin: 'planned', ...extra })
    const acked = (c, edit = {}) => ({ ...c, ...edit, ack: { by: 'Ann', at: '2026-11-07T08:00:00.000Z', hash: changeHash(c) } })
    const DREL = 'docs/specs/2026-11-07-search.delta.json'
    const DELTA = { schema: 1, spec: 'docs/specs/2026-11-07-search-design.md', data: [], architecture: [
      acked(ch('search', 'add', 'component:search', { after: { label: 'Search', type: 'backend' }, slice: 1 })),
      ch('cache', 'add', 'component:cache', { after: { label: `Cache${BAD}`, type: 'database' }, slice: 2 }),
      ch('cache-line', 'add', 'connection:api->cache', { after: { label: 'reads' }, slice: 2 }),
      acked(ch('relabel', 'change', 'component:api', { after: { label: 'Order API' } }), { why: `named for what it does, reworded${BAD}` }),
    ] }
    put(FEAT, DREL, JSON.stringify(DELTA, null, 2) + '\n')
    const project = loadProject(FEAT)
    const page = await renderGraph(project)
    const D = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(page)[1].replace(/\\u003c/g, '<'))
    eq([D.archCh.base.ref, D.archCh.codeWhy, D.arch[0].file, D.arch[0].ch.list.map((x) => `${x.change} ${x.target}`), D.arch[0].ch.findings.map((x) => `${x.kind} ${x.target}`), D.arch[0].ch.links.map((l) => l.slice(0, 2).join('>'))],
      ['main', null, DIAGRAM, ['added component:search', 'modified boundary:Backend'], ['undrawn connection:web->store'], ['web>store']],
      'the Changes overlay is packed in Node: the diagram against main (a component added, a boundary that wraps it), and the link the branch\'s code adds that the base checkout\'s index does not have')
    const da = D.data.deltas[0].arch
    eq([da.changes.map((c) => `${c.id} ${c.state}${c.ack ? ` ${c.ack}` : ''} on ${c.drawn.join(',')}`), da.unplanned.map((u) => `${u.source} ${u.target} ${u.built}`), da.outside],
      [['search planned-built acked on 0', 'cache pending on 0', 'cache-line pending on 0', 'relabel pending stale on 0'], ['code connection:web->store false'], []],
      'the delta\'s architecture changes, each in its state on the diagram it is drawn on; the undrawn link is not in the plan')
    const ov = da.diagrams[0]
    const comp = (id) => ov.comps.find((c) => c.id === id)
    eq([comp('cache').dl.s, ov.conns.find((e) => e.from === 'api' && e.to === 'cache').dl.s, comp('search').dl.s, comp('api').dl.s, ov.links.map((l) => l.slice(0, 2).join('>')), ov.layout.boxes.length === ov.comps.length, ov.members.length === ov.comps.length, ov.evidence.length === ov.conns.length],
      ['prop', 'prop', 'built', 'pend', ['web>store'], true, true, true],
      'the delta overlay: the proposed cache as a ghost component placed by the layout with its proposed line, the search drawn as planned, the relabel proposed; members and evidence stay aligned')

    // the page's own script, in a stub DOM
    const stubPage = async (pg, hash, globals = {}) => {
      const vm = await import('node:vm')
      const blob = /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(pg)[1], listeners = {}
      class El {
        constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.on = {}; this.dataset = {}; this.html = ''; this.value = ''; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} } }
        setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = String(v) }
        getAttribute(k) { return this.attrs[k] ?? null }
        append(...c) { this.kids.push(...c) }
        addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f) }
        set innerHTML(v) { this.html = v; this.firstChild = new El('svg') }
        get innerHTML() { return this.html }
        querySelectorAll() { return [] }
        focus(o) { this.focusedWith = o || {} } setSelectionRange() {}
        get offsetHeight() { return 0 }
      }
      const { ctlQuery } = await import('./stage-kit.mjs')
      const doc = { createElement: (t) => new El(t), getElementById: (id) => (id === 'graph-data' ? { textContent: blob } : null), body: { replaceChildren(...c) { this.kids = c } }, documentElement: { style: { setProperty() {} } }, activeElement: null }
      doc.querySelector = ctlQuery(() => ({ kids: doc.body.kids || [] }))
      const loc = { hash, reload: () => { loc.reloads = (loc.reloads || 0) + 1 } }
      vm.runInNewContext((/<script>([\s\S]*)<\/script>\s*<\/body>/.exec(pg) || [])[1], { document: doc, window: { addEventListener: (t, f) => { const prev = listeners[t]; listeners[t] = prev ? (e) => { prev(e); f(e) } : f }, innerWidth: 1400, scrollTo() {} }, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), ...globals })
      const find = (n, pred) => { if (!n || typeof n !== 'object') return null; if (pred(n)) return n; for (const k of n.kids || []) { const f = find(k, pred); if (f) return f } return null }
      const all = (n, pred, out = []) => { if (n && typeof n === 'object') { if (pred(n)) out.push(n); for (const k of n.kids || []) all(k, pred, out) } return out }
      const body = () => ({ kids: doc.body.kids || [] })
      const flat = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : (n.kids || []).map(flat).join(''))
      const dump = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : `${n.html || ''} ${Object.values(n.attrs || {}).join(' ')} ${(n.kids || []).map(dump).join(' ')}`)
      const P = {
        text: () => dump(body()), lines: (tag) => all(body(), (n) => n.tagName === tag).map(flat), reloads: () => loc.reloads || 0, textOf: flat, all: (pred) => all(body(), pred),
        find: (pred) => find(body(), pred), ctl: (c) => find(body(), (n) => n.attrs && n.attrs['data-ctl'] === c),
        press: (c) => (P.ctl(c).on.click || []).forEach((f) => f({})), pressed: (c) => Promise.all((P.ctl(c).on.click || []).map((f) => f({}))),
        ctls: (re) => P.all((n) => n.attrs && re.test(n.attrs['data-ctl'] || '')).map((n) => n.attrs['data-ctl']),
        svg: () => (find(body(), (n) => n.attrs && n.attrs.id === 'arch-box') || {}).html || '',
        click: (id) => find(body(), (n) => n.attrs && n.attrs.id === 'arch-box').firstChild.on.click[0]({ target: { closest: (sel) => (/data-comp/.test(sel) ? { dataset: { comp: id } } : null) } }),
      }
      return P
    }
    const pg = await stubPage(page, '#arch-0')
    ok(pg.ctl('arch-changes').attrs['aria-pressed'] === 'false' && pg.ctl('arch-delta').attrs['aria-pressed'] === 'false' && !/ (d|ch)-(prop|built|add|unpl)\b/.test(pg.svg()), 'two switches above the diagram, Changes vs main and Delta, both off by default: the diagram as saved')
    pg.press('arch-changes')
    let svg = pg.svg()
    ok(/<g class="comp t-backend ch-add" data-comp="search"/.test(svg) && /<g class="bound k-deploy ch-mod">/.test(svg) && /<path class="newlink ch-add" d="M[^"]+"><title>web uses store \(1 file pair in the graph\), but no line is drawn between them\nnew since main: in the code, not drawn yet<\/title>/.test(svg),
      'Changes: the component added green, the boundary that wraps it amber, the new code link dotted')
    ok(['Changes since main:', 'added', 'modified: before → after', 'in the code, not drawn: a new link (dotted)'].every((w) => pg.text().includes(w)) && pg.lines('LI').some((l) => l.startsWith('component:searchadded since maincomponent search  "Search" (backend)')) && pg.lines('LI').some((l) => l.startsWith('connection:web->storenew in the code: in the code, not drawn')),
      '… with its legend and its list: what the diagram changed, what the code did')
    pg.press('arch-delta')
    svg = pg.svg()
    ok(pg.ctl('arch-changes').attrs['aria-pressed'] === 'false' && /<g class="comp t-database d-prop" data-comp="cache"/.test(svg) && /<path class="conn v-default d-prop" data-k="\d+" d="M[^"]+" marker-end="url\(#ar-arrow\)"><title>api → cache: reads/.test(svg) && /<g class="comp t-backend d-built" data-comp="search"/.test(svg) && /<g class="comp t-backend d-pend stale" data-comp="api"/.test(svg) && /<g class="stalemk">/.test(svg) && /<path class="newlink d-unpl"/.test(svg),
      'Delta (one overlay at a time): the proposed cache a dashed ghost with its proposed line, the search planned and built, the api\'s proposed relabel badged stale, the undrawn link not in the plan')
    ok(['Delta:', 'proposed (dashed)', 'proposed removal', 'proposed change: now → planned', 'planned and built', 'built differently: planned → built', 'not in the plan (dotted: a link in the code no line draws)', 'acknowledgement stale'].every((w) => pg.text().includes(w)), 'a legend for each state')
    const ps = pg.lines('P'), lis = pg.lines('LI')
    ok(ps.includes('For docs/specs/2026-11-07-search-design.md: 4 architecture changes · 1 planned and built · 3 pending · 0 built differently · 1 not in the plan · 1 acknowledged · 1 stale') && ps.includes('Read-only snapshot. To acknowledge changes, serve the page: graph.mjs serve')
      && lis.some((l) => l.startsWith('add component:searchplanned and builtas: label Search, type backenddrawn in: docs/architecture/shop.architecture.jsonwhy: because searchslice 1 · acknowledged by Ann at 2026-11-07T08:00:00.000Z'))
      && lis.some((l) => l.startsWith('change component:apipendingstale') && l.includes('proposed: label: API → Order API') && l.includes('stale: acknowledged by Ann at 2026-11-07T08:00:00.000Z, edited since'))
      && lis.some((l) => l.startsWith('connection:web->storenot in the planin the code, not drawn')),
      'the delta named with its design and counts, each change with its state, shape, where it is drawn, why, slice and acknowledgement; what is not in the plan; a static page says it is read-only')
    eq(pg.ctls(/^arch-ack-/), [], 'the static page offers no acknowledgement')
    pg.click('api')
    ok(pg.lines('LI').some((l) => l.startsWith('change component:apipending')) && pg.text().includes('Delta: 2 changes'), "a component's passport lists the delta's changes that concern it (it, and the proposed line that meets it)")
    ok(!/<img|<script|<!--/i.test(svg) && svg.includes(escd(`Cache${BAD}`).slice(0, 30)) && !pg.all((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT').length && pg.lines('LI').some((l) => l.includes(`named for what it does, reworded${BAD}`)), 'hostile strings in a label and a why are escaped in the drawing and carried as text in the lists')

    // served: each change acknowledged through PUT /api/delta, the same as the Data tab's
    const calls = []
    let answer = (b) => ({ status: 200, j: { hash: 'h2', changes: b.ids.map((id) => ({ id, ack: { by: 'Cy', at: '2026-11-08T08:00:00.000Z', hash: 'x' } })) } })
    const fetch = async (url, o) => { calls.push({ url, method: o.method, headers: o.headers, body: JSON.parse(o.body) }); const a = answer(JSON.parse(o.body)); return { ok: a.status < 300, status: a.status, json: async () => a.j } }
    const served = await renderGraph(project, { serve: { token: 'page-token' } })
    const sp = await stubPage(served, '#arch-0', { fetch })
    sp.press('arch-delta')
    ok(sp.ctls(/^arch-ack-l/).join(' ') === 'arch-ack-l0 arch-ack-l1 arch-ack-l2 arch-ack-l3' && sp.ctl('arch-ack-l3').kids[0] === 'Acknowledge again' && sp.ctl('arch-ack-l0').kids[0] === 'Unacknowledge' && sp.ctl('arch-ack-dall').kids[0] === 'Acknowledge all 3 changes not acknowledged on this diagram',
      'served: each change has its control (Acknowledge, Acknowledge again when stale, Unacknowledge), and the diagram one for all not acknowledged')
    await sp.pressed('arch-ack-l1')
    eq(calls.map((c) => [c.url, c.method, c.headers['x-grimoire-token'], c.body]), [['/api/delta', 'PUT', 'page-token', { repo: 'shop', path: DREL, base: D.data.deltas[0].hash, ids: ['cache'], ack: true }]], 'the proposed component is acknowledged by its id, with the hash the delta was loaded with')
    ok(sp.lines('LI').some((l) => l.startsWith('add component:cache') && l.includes('acknowledged by Cy at 2026-11-08T08:00:00.000Z')) && sp.text().includes('Acknowledged: 1 change, written to docs/specs/2026-11-07-search.delta.json'), '… and the page shows what the server wrote')
    answer = () => ({ status: 409, j: { error: 'changed on disk since it was loaded', text: '{}', hash: 'h3' } })
    const store = new Map(), session = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
    const sr = await stubPage(served, '#arch-0', { fetch, sessionStorage: session })
    sr.press('arch-delta')
    await sr.pressed('arch-ack-l3')
    const said = sr.find((n) => n.attrs && n.attrs['data-status-for'] === 'arch-ack-l3')
    sr.press('arch-delta-reload')
    ok(!!said && sr.textOf(said).startsWith('Not saved: the delta changed on disk since this page was loaded') && sr.reloads() === 1 && JSON.parse(store.get('grimoire-arch-delta')).archDelta === true, 'a refused write is said beside the control, with a Reload that keeps the overlay and the delta for the page it reloads')
    const again = await stubPage(served, '#arch-0', { fetch, sessionStorage: session })
    ok(again.ctl('arch-delta').attrs['aria-pressed'] === 'true' && !store.has('grimoire-arch-delta'), '… and the reloaded page opens with the Delta overlay on, once')
    calls.length = 0; answer = () => ({ status: 503, j: { error: 'busy: another writer has the delta (the loop recording a change); try again in a moment' } })
    await again.pressed('arch-ack-l2')
    ok(again.textOf(again.find((n) => n.attrs && n.attrs['data-status-for'] === 'arch-ack-l2')).startsWith('Not saved: busy'), 'a busy delta (503) is said beside the control too')

    // the Done-when: the undrawn link kept by the implementer reaches the delta (the ship appends it,
    // origin unplanned): pending; the diagram updated in the branch draws it: planned and built
    const kept = appendChanges(readFileSync(path.join(FEAT, DREL), 'utf8'), [{ id: 'unplanned-PROJ-1-web-store', op: 'add', target: 'connection:web->store', why: 'the page reads the stock directly', slice: 1, origin: 'unplanned' }])
    writeFileSync(path.join(FEAT, DREL), kept.text)
    const state = async () => { const x = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(await renderGraph(project))[1].replace(/\\u003c/g, '<')); const a = x.data.deltas[0].arch; return [a.changes.find((c) => c.id === 'unplanned-PROJ-1-web-store').state, a.unplanned.map((u) => u.target), x.arch[0].ch.findings.map((f) => f.target)] }
    eq(await state(), ['pending', [], ['connection:web->store']], 'kept and appended to the delta, the undrawn link is planned now: pending until the diagram draws it')
    put(FEAT, DIAGRAM, JSON.stringify(drawn({ connections: [...shop.connections, { from: 'web', to: 'store', label: 'stock' }] }), null, 2) + '\n')
    eq(await state(), ['planned-built', [], []], 'the diagram updated in the branch draws it: planned and built, and the check finds nothing new in the code')
    // a drawn line the code no longer shows is said as such, never "in the code, not drawn"
    await handIndex(FEAT, BR_CODE, [['src/web/page.js', 'src/api/orders.js'], ['src/web/page.js', 'src/store/db.js']])
    const unseenPage = await renderGraph(project)
    const up = await stubPage(unseenPage, '#arch-0')
    up.press('arch-delta')
    const unseenLine = up.lines('LI').find((l) => l.startsWith('connection:api->storenot in the plan')) || ''
    ok(unseenLine.startsWith('connection:api->storenot in the plandrawn, the code no longer shows itapi → store is drawn, and the code does not show it') && !unseenLine.includes('in the code, not drawn'), `an unseen line: "drawn, the code no longer shows it" (${unseenLine})`)
    up.press('arch-changes')
    ok(up.lines('LI').some((l) => l.startsWith('connection:api->storenew in the code: drawn, the code no longer shows it')), '… in the Changes list too')
    const pageOf = (html) => JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'))
    // the base checkout's index not at the fork point: main gains a commit (its index not refreshed),
    // the branch merges main and changes nothing more: no code finding, the reason said, no path
    const staleHead = git(MAIN, 'rev-parse', 'HEAD').stdout.trim()
    put(MAIN, 'src/extra/z.js', 'export const z = 3\n')
    git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'more on main')
    const fork = git(MAIN, 'rev-parse', 'HEAD').stdout.trim()
    const merged = git(FEAT, '-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--ff-only', 'main')
    await handIndex(FEAT, [...BR_CODE, 'src/extra/z.js'], [['src/web/page.js', 'src/api/orders.js'], ['src/web/page.js', 'src/store/db.js']])
    const stale = await renderGraph(project), S = pageOf(stale)
    const sp2 = await stubPage(stale, '#arch-0')
    sp2.press('arch-changes')
    const reason = `the base checkout's index is at ${staleHead.slice(0, 7)}, the branch forked from ${fork.slice(0, 7)}: refresh it (\`graph.mjs index\` in that checkout) to compare what the code did`
    eq([merged.status, S.archCh.codeWhy, S.archCh.codePart, S.arch[0].ch.findings, S.data.deltas[0].arch.unplanned.filter((u) => u.source === 'code'), S.data.deltas[0].arch.codeWhy],
      [0, reason, false, [], [], reason], 'a base index not at the fork point: no code finding at all (not the base\'s new module, not the unseen line), the reason said')
    ok(sp2.text().includes(`Only the diagram files were compared: the code was not (${reason}).`) && !stale.includes(MAIN) && !stale.includes(ROOT7), 'the page says why, and names no path of the base checkout')
    // an index built by another grimoire version: the reason, no path
    await handIndex(MAIN, [...CODE, 'src/extra/z.js'], [['src/web/page.js', 'src/api/orders.js'], ['src/api/orders.js', 'src/store/db.js']])
    const { driver } = await import('../lib/store.mjs')
    const raw = new (await driver()).DatabaseSync(path.join(MAIN, '.grimoire/graph/graph.db'))
    raw.prepare("UPDATE meta SET value = '0' WHERE key = 'schema'").run(); raw.close()
    const old = await renderGraph(project), O = pageOf(old)
    eq([O.archCh.codeWhy, O.arch[0].ch.findings], ['the base checkout\'s index was built by another grimoire version: index it there first', []], 'a base index from another grimoire version: no code finding, the reason said')
    ok(!old.includes(MAIN) && !old.includes(ROOT7), '… and the page names no path of the base checkout')
    // without a base index: only the diagram files are compared, and the view says so
    rmSync(path.join(MAIN, '.grimoire'), { recursive: true, force: true })
    const bare = await renderGraph(project)
    const B = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(bare)[1].replace(/\\u003c/g, '<'))
    const bp = await stubPage(bare, '#arch-0')
    bp.press('arch-changes')
    ok(/has an index/.test(B.archCh.codeWhy) && B.arch[0].ch.findings.length === 0 && B.arch[0].ch.list.length === 3 && bp.text().includes('Only the diagram files were compared: the code was not (no other checkout of the repository has an index') && bp.text().includes('the code not compared'),
      `with no index of the base checkout, only the diagram files are compared, and the view says so (${B.archCh.codeWhy})`)
  } catch (e) { ok(false, `the architecture change view renders (${e.stack})`) } finally { rmSync(ROOT7, { recursive: true, force: true }) }
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
