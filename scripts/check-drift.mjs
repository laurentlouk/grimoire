#!/usr/bin/env node
// grimoire · drift check. Exits 1, listing every problem, when the repo's own sources disagree.
//
//   Run:  node scripts/check-drift.mjs     (or: npm run check)
//
// Checks, one group each:
//   1 agents     every agents/*.md has frontmatter `name` == filename, a `description`, and a
//                `model` (if set) in haiku|sonnet|opus; every agent has a row in an AGENTS.md
//                table, and every agent named in the first column of an AGENTS.md table exists
//                (placeholders such as `<repo>-engineer` are skipped).
//   2 memory     an agent that can write (its `tools` line includes Write or Edit, or it has no
//                `tools` line, i.e. inherits them all) needs memory/agents/<name>.md; so does
//                `reviewer`, whose memory the loop pastes into every review.
//   3 skills     every skills/*/SKILL.md has frontmatter `name` == directory and a
//                `description`; skills/<name>/evals/evals.json is a JSON array of >= 3 cases
//                with at least one should_trigger true and one false.
//   4 briefs     workflows/briefs/README.md has a row per brief file and a file per row; where a
//                brief('<name>') prompt builder is passed straight to agentT(builder(…), {…}) in
//                orchestrate-loop.js, the options' model must match the table's Model column
//                (`cheap` = haiku or sonnet), and every brief(<name>) call has a file. Builders not
//                dispatched that way are not model-checked.
//   5 personas   every REVIEW_PANEL id in orchestrate-loop.js has workflows/personas/<id>.md and
//                every persona file is in the panel.
//   6 versions   .claude-plugin/plugin.json version == the marketplace entry's version (when the
//                entry has one); the README skills badge count == the number of skills.
//   7 config     grimoire.config.example.json parses; every top-level key and repos[] key is
//                documented as `key` in workflows/README.md; gate.timeoutMin is flagged (the
//                engine reads timeoutMin at repo level).
// Plain Node, no dependencies.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const rel = (...p) => path.join(ROOT, ...p)
const read = (...p) => { try { return readFileSync(rel(...p), 'utf8') } catch { return null } }
const ls = (...p) => { try { return readdirSync(rel(...p)) } catch { return [] } }
const isDir = (...p) => { try { return statSync(rel(...p)).isDirectory() } catch { return false } }

function frontmatter(text) {
  const m = text && /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const groups = []
function group(title, fn) {
  const problems = []
  try { fn((p) => problems.push(p)) } catch (e) { problems.push(`check crashed: ${e.message}`) }
  groups.push({ title, problems })
}

// ─────────────────────────── 1 · agents ───────────────────────────
const agentFiles = ls('agents').filter((f) => f.endsWith('.md'))
const agents = agentFiles.map((f) => ({ file: f, name: f.replace(/\.md$/, ''), fm: frontmatter(read('agents', f)) }))
const agentsMd = read('AGENTS.md') || ''

group('agents · frontmatter and AGENTS.md roster', (bad) => {
  if (!agentsMd) bad('AGENTS.md is missing')
  for (const a of agents) {
    if (!a.fm) { bad(`agents/${a.file}: no frontmatter`); continue }
    if (a.fm.name !== a.name) bad(`agents/${a.file}: frontmatter name "${a.fm.name ?? ''}" != filename "${a.name}"`)
    if (!a.fm.description) bad(`agents/${a.file}: no description`)
    if (a.fm.model && !['haiku', 'sonnet', 'opus'].includes(a.fm.model)) bad(`agents/${a.file}: model "${a.fm.model}" is not haiku|sonnet|opus`)
  }
  const tableNames = new Set()
  for (const line of agentsMd.split('\n')) {
    if (!/^\s*\|/.test(line)) continue
    const first = line.split('|')[1] || ''
    for (const m of first.matchAll(/`([^`]+)`/g)) tableNames.add(m[1])
  }
  for (const a of agents) if (!tableNames.has(a.name)) bad(`AGENTS.md: no table row for agent \`${a.name}\` (agents/${a.file})`)
  for (const n of tableNames) {
    if (/[<>]/.test(n)) continue // placeholder, e.g. <repo>-engineer
    if (!agents.some((a) => a.name === n)) bad(`AGENTS.md: table names \`${n}\` but agents/${n}.md does not exist`)
  }
})

// ─────────────────────────── 2 · memory ───────────────────────────
group('memory · a store for every writing agent and the reviewer', (bad) => {
  for (const a of agents) {
    if (!a.fm) continue
    const tools = a.fm.tools
    const writes = tools === undefined || /\b(Write|Edit|MultiEdit|NotebookEdit)\b/.test(tools)
    if ((writes || a.name === 'reviewer') && !existsSync(rel('memory', 'agents', `${a.name}.md`))) {
      bad(`memory/agents/${a.name}.md is missing (${a.name === 'reviewer' ? 'the reviewer' : tools === undefined ? 'no tools line: inherits Write/Edit' : `tools: ${tools}`})`)
    }
  }
})

// ─────────────────────────── 3 · skills ───────────────────────────
const skillDirs = ls('skills').filter((d) => isDir('skills', d) && existsSync(rel('skills', d, 'SKILL.md')))
group('skills · frontmatter and evals', (bad) => {
  for (const d of ls('skills').filter((x) => isDir('skills', x))) if (!skillDirs.includes(d)) bad(`skills/${d}/: no SKILL.md`)
  for (const d of skillDirs) {
    const fm = frontmatter(read('skills', d, 'SKILL.md'))
    if (!fm) { bad(`skills/${d}/SKILL.md: no frontmatter`); continue }
    if (fm.name !== d) bad(`skills/${d}/SKILL.md: frontmatter name "${fm.name ?? ''}" != directory "${d}"`)
    if (!fm.description) bad(`skills/${d}/SKILL.md: no description`)
    const raw = read('skills', d, 'evals', 'evals.json')
    if (raw === null) { bad(`skills/${d}/evals/evals.json is missing`); continue }
    let evals
    try { evals = JSON.parse(raw) } catch (e) { bad(`skills/${d}/evals/evals.json: invalid JSON (${e.message})`); continue }
    if (!Array.isArray(evals)) { bad(`skills/${d}/evals/evals.json: not a JSON array`); continue }
    if (evals.length < 3) bad(`skills/${d}/evals/evals.json: ${evals.length} case(s), need at least 3`)
    if (!evals.some((c) => c && c.should_trigger === true)) bad(`skills/${d}/evals/evals.json: no case with should_trigger: true`)
    if (!evals.some((c) => c && c.should_trigger === false)) bad(`skills/${d}/evals/evals.json: no case with should_trigger: false`)
  }
})

// ─────────────────────────── 4 · briefs ───────────────────────────
const loop = read('workflows', 'orchestrate-loop.js') || ''

// Given the index just past an opening paren, return the index of its matching close paren.
// Skips string and template literals (with ${…} nesting) and comments; good enough for our own JS.
function matchParen(src, i) {
  let depth = 1
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) return -1; continue }
    if (c === "'" || c === '"') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue }
    if (c === '`') { i = skipTemplate(src, i + 1); if (i < 0) return -1; continue }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') { if (--depth === 0) return i }
  }
  return -1
  function skipTemplate(s, j) { // j just past the opening backtick; returns index of the closing one
    for (; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue }
      if (s[j] === '`') return j
      if (s[j] === '$' && s[j + 1] === '{') { const e = matchParen(s, j + 2); if (e < 0) return -1; j = e }
    }
    return -1
  }
}

group('briefs · README table, files, dispatch models', (bad) => {
  const readme = read('workflows', 'briefs', 'README.md')
  if (readme === null) { bad('workflows/briefs/README.md is missing'); return }
  const files = ls('workflows', 'briefs').filter((f) => f.endsWith('.md') && f !== 'README.md')
  const rows = new Map() // brief file → model column
  for (const line of readme.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    const m = cells.length >= 3 && /^`([\w.-]+\.md)`$/.exec(cells[0])
    if (m) rows.set(m[1], cells[2].toLowerCase())
  }
  for (const f of files) if (!rows.has(f)) bad(`workflows/briefs/README.md: no row for ${f}`)
  for (const f of rows.keys()) if (!files.includes(f)) bad(`workflows/briefs/README.md: row for ${f}, but the file does not exist`)
  if (!loop) { bad('workflows/orchestrate-loop.js is missing: model column not checked'); return }
  for (const n of new Set([...loop.matchAll(/\bbrief\('([\w-]+)'\)/g)].map((x) => x[1]))) {
    if (!files.includes(`${n}.md`)) bad(`orchestrate-loop.js calls brief('${n}') but workflows/briefs/${n}.md does not exist`)
  }
  // builder function → brief name, for every function whose body calls brief('<name>')
  const builders = new Map()
  for (const m of loop.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const end = matchParen(loop, m.index + m[0].length)
    const body = loop.slice(m.index, end < 0 ? undefined : end)
    const b = [...body.matchAll(/\bbrief\('([\w-]+)'\)/g)].map((x) => x[1])
    if (b.length === 1) builders.set(m[1], b[0])
  }
  const allowed = (col) => (col === 'cheap' ? ['haiku', 'sonnet'] : [col])
  for (const m of loop.matchAll(/\bagentT\(\s*(\w+)\(/g)) {
    const name = builders.get(m[1])
    if (!name) continue
    const builderEnd = matchParen(loop, m.index + m[0].length) // close of builder(…)
    const callEnd = matchParen(loop, loop.indexOf('(', m.index) + 1) // close of agentT(…)
    if (builderEnd < 0 || callEnd < 0) continue
    const options = loop.slice(builderEnd + 1, callEnd) // the options object, after the prompt
    const mm = /\bmodel:\s*(?:[\w.]+\s*\|\|\s*)?'(\w+)'/.exec(options)
    const col = rows.get(`${name}.md`)
    if (!mm || !col) continue
    const line = loop.slice(0, m.index).split('\n').length
    if (!allowed(col).includes(mm[1])) bad(`briefs/${name}.md: README says model "${col}", but orchestrate-loop.js:${line} dispatches ${m[1]}() with model '${mm[1]}'`)
  }
})

// ─────────────────────────── 5 · personas ───────────────────────────
group('personas · REVIEW_PANEL and workflows/personas/', (bad) => {
  const at = loop.indexOf('const REVIEW_PANEL')
  if (at < 0) { bad('orchestrate-loop.js: REVIEW_PANEL not found'); return }
  const start = loop.indexOf('[', at)
  const end = matchParen(loop, start + 1)
  const ids = [...loop.slice(start, end).matchAll(/\{\s*id:\s*'([\w-]+)'/g)].map((m) => m[1])
  if (!ids.length) bad('orchestrate-loop.js: REVIEW_PANEL has no { id: … } entries')
  const files = ls('workflows', 'personas').filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.replace(/\.md$/, ''))
  for (const id of ids) if (!files.includes(id)) bad(`REVIEW_PANEL id "${id}" has no workflows/personas/${id}.md`)
  for (const f of files) if (!ids.includes(f)) bad(`workflows/personas/${f}.md is not in REVIEW_PANEL`)
})

// ─────────────────────────── 6 · versions ───────────────────────────
group('versions · plugin, marketplace, README badge', (bad) => {
  let plugin = null, market = null
  try { plugin = JSON.parse(read('.claude-plugin', 'plugin.json')) } catch (e) { bad(`.claude-plugin/plugin.json: ${e.message}`) }
  try { market = JSON.parse(read('.claude-plugin', 'marketplace.json')) } catch (e) { bad(`.claude-plugin/marketplace.json: ${e.message}`) }
  if (plugin && market) {
    const entry = (market.plugins || []).find((p) => p && p.name === plugin.name)
    if (!entry) bad(`.claude-plugin/marketplace.json: no plugin entry named "${plugin.name}"`)
    else if (entry.version !== undefined && entry.version !== plugin.version) bad(`version drift: plugin.json ${plugin.version} vs marketplace.json ${entry.version}`)
  }
  const readme = read('README.md') || ''
  const badge = /img\.shields\.io\/badge\/[^)\s]*?skills-(\d+)-/i.exec(readme)
  if (badge && Number(badge[1]) !== skillDirs.length) bad(`README.md: skills badge says ${badge[1]}, skills/ has ${skillDirs.length}`)
})

// ─────────────────────────── 7 · config ───────────────────────────
group('config · grimoire.config.example.json documented in workflows/README.md', (bad) => {
  const raw = read('grimoire.config.example.json')
  if (raw === null) { bad('grimoire.config.example.json is missing'); return }
  let cfg
  try { cfg = JSON.parse(raw) } catch (e) { bad(`grimoire.config.example.json: invalid JSON (${e.message})`); return }
  const doc = read('workflows', 'README.md') || ''
  const documented = (k) => doc.includes('`' + k + '`')
  for (const k of Object.keys(cfg)) if (!k.startsWith('$') && !documented(k)) bad(`top-level key \`${k}\` is not documented in workflows/README.md`)
  const repoKeys = new Set()
  for (const r of Array.isArray(cfg.repos) ? cfg.repos : []) {
    if (!r || typeof r !== 'object') continue
    Object.keys(r).forEach((k) => repoKeys.add(k))
    if (r.gate && typeof r.gate === 'object' && 'timeoutMin' in r.gate) bad(`repos[${r.name ?? '?'}].gate.timeoutMin: the engine reads timeoutMin at repo level (repos[].timeoutMin), this one is ignored`)
  }
  for (const k of repoKeys) if (!documented(k)) bad(`repos[] key \`${k}\` is not documented in workflows/README.md`)
})

// ─────────────────────────── report ───────────────────────────
let failed = 0
for (const g of groups) {
  console.log(`${g.problems.length ? '✗' : '✓'} ${g.title}`)
  for (const p of g.problems) console.log(`   - ${p}`)
  failed += g.problems.length
}
console.log(`\n${failed ? `${failed} problem(s)` : 'no drift'}`)
process.exit(failed ? 1 : 0)
