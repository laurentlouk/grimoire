#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  build-evals — generate the `claude plugin eval` suite from the skill evals
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/build-evals.mjs            → (re)writes <plugin root>/evals/
//  node scripts/build-evals.mjs --check    → regenerates in memory; exit 1 and list
//                                            every stale, missing or extra file
//
//  Source of truth: skills/<skill>/evals/evals.json (the skill-creator format:
//  [{ id, query, should_trigger, expected_output, expectations: [{ text }] }]).
//  Output: evals/<skill>-<id>/prompt.md + graders/*.md, the runner's layout
//  (https://code.claude.com/docs/en/plugin-evals). evals/ is GENERATED: edit the
//  skill's evals.json, then rerun this script. Anything under a results/ dir
//  (written by the runner) is never touched or compared.
//
//  Case kind (used as a tag): should_trigger false → negative; the lowest-id
//  should_trigger true case of a skill → positive; every later one → edge.
//
//  Plain Node ≥ 20, no dependencies, deterministic (sorted, no timestamps).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills')
const OUT = join(ROOT, 'evals')
const PLUGIN = 'grimoire'
const MAX_TURNS = 40
const TIMEOUT_SECONDS = 900
const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Skill', 'Agent', 'TodoWrite']
const NL = '\n'

// YAML scalar: a JSON string is a valid YAML double-quoted scalar.
const q = (s) => JSON.stringify(String(s))
const list = (xs) => '[' + xs.map((x) => (/^[A-Za-z0-9_-]+$/.test(x) ? x : q(x))).join(', ') + ']'
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function fail(msg) {
  console.error('build-evals: ' + msg)
  process.exit(1)
}

function loadSuites() {
  const skills = readdirSync(SKILLS)
    .filter((d) => statSync(join(SKILLS, d)).isDirectory())
    .sort()
  const suites = []
  for (const skill of skills) {
    const file = join(SKILLS, skill, 'evals', 'evals.json')
    if (!existsSync(file)) continue
    let cases
    try {
      cases = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      fail(`${relative(ROOT, file)}: invalid JSON (${e.message})`)
    }
    if (!Array.isArray(cases) || cases.length === 0) fail(`${relative(ROOT, file)}: expected a non-empty array`)
    const seen = new Set()
    for (const c of cases) {
      const where = `${relative(ROOT, file)} case ${JSON.stringify(c && c.id)}`
      if (!Number.isInteger(c.id) || c.id < 1) fail(`${where}: id must be a positive integer`)
      if (seen.has(c.id)) fail(`${where}: duplicate id`)
      seen.add(c.id)
      if (typeof c.query !== 'string' || !c.query.trim()) fail(`${where}: query must be a non-empty string`)
      if (typeof c.should_trigger !== 'boolean') fail(`${where}: should_trigger must be a boolean`)
      if (typeof c.expected_output !== 'string') fail(`${where}: expected_output must be a string`)
      if (!Array.isArray(c.expectations) || c.expectations.length === 0) fail(`${where}: expectations must be a non-empty array`)
      for (const x of c.expectations) if (!x || typeof x.text !== 'string' || !x.text.trim()) fail(`${where}: every expectation needs a text`)
    }
    suites.push({ skill, cases: [...cases].sort((a, b) => a.id - b.id) })
  }
  return suites
}

function kindOf(c, cases) {
  if (!c.should_trigger) return 'negative'
  const first = cases.find((k) => k.should_trigger)
  return first.id === c.id ? 'positive' : 'edge'
}

function promptMd(skill, c, kind) {
  return [
    '---',
    `# GENERATED from skills/${skill}/evals/evals.json (id ${c.id}) by scripts/build-evals.mjs. Do not edit.`,
    `description: ${q(`${skill} #${c.id} (${kind})`)}`,
    `tags: ${list([skill, kind])}`,
    'plugins: ["../.."]',
    `max_turns: ${MAX_TURNS}`,
    `timeout_seconds: ${TIMEOUT_SECONDS}`,
    `allowed_tools: ${list(ALLOWED_TOOLS)}`,
    `expected_outcome: ${q(c.expected_output)}`,
    '---',
    '',
    c.query.trim(),
    '',
  ].join(NL)
}

function triggerGrader(skill, shouldTrigger) {
  const match = `"skill"\\s*:\\s*"(?:${PLUGIN}:)?${esc(skill)}"`
  const lines = ['---', 'type: tool_used', 'tool: Skill', `input_match: '${match}'`]
  if (!shouldTrigger) lines.push('min: 0', 'max: 0', 'arm: both')
  lines.push('---', '')
  return lines.join(NL)
}

function expectationGrader(skill, c, x) {
  return [
    '---',
    'type: llm',
    'focus: trace',
    '---',
    '',
    `You are grading one run of the "${skill}" skill of a plugin, from its transcript.`,
    '',
    `The user's request was: ${q(c.query.trim())}`,
    '',
    `Expectation to check: ${x.text.trim()}`,
    '',
    `PASS if the transcript clearly shows the assistant meeting this expectation.`,
    `FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.`,
    'Judge only this one expectation; ignore formatting and anything else the run did or did not do.',
    '',
    `For context only (not a separate requirement), the intended behaviour overall: ${c.expected_output.trim()}`,
    '',
  ].join(NL)
}

function readmeMd(suites) {
  const rows = suites.map(({ skill, cases }) => {
    const k = { positive: 0, negative: 0, edge: 0 }
    for (const c of cases) k[kindOf(c, cases)]++
    return `| ${skill} | ${cases.length} | ${k.positive} | ${k.negative} | ${k.edge} |`
  })
  return [
    '# evals/ (GENERATED)',
    '',
    'This directory is **generated** from `skills/*/evals/evals.json` by `scripts/build-evals.mjs`. Do not edit it by hand:',
    'edit the skill\'s `evals.json`, then run `node scripts/build-evals.mjs`. CI runs `node scripts/build-evals.mjs --check`,',
    'which fails when this tree is stale.',
    '',
    'Layout (the `claude plugin eval` format): one case per `<skill>-<id>/`, with `prompt.md` (frontmatter: tags',
    '`[<skill>, positive|negative|edge]`, turn and time limits; body: the query) and `graders/`:',
    '',
    '- `trigger.md`: `tool_used` on `Skill` for the skill (bare or `grimoire:`-namespaced). For a negative case it is',
    '  `min: 0`, `max: 0`, `arm: both`: the skill must not fire.',
    '- `expect-NN.md`: one `llm` grader per expectation, a PASS/FAIL rubric over the transcript.',
    '',
    'Run: `claude plugin eval .` from the plugin root (filter with `--tag <skill>` or `--case \'<skill>-*\'`).',
    'Each run writes `evals/results/<timestamp>/`, which is git-ignored.',
    '',
    '| Skill | Cases | Positive | Negative | Edge |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join(NL)
}

function build() {
  const suites = loadSuites()
  const files = new Map()
  files.set('README.md', readmeMd(suites))
  files.set('.gitignore', '# GENERATED by scripts/build-evals.mjs\n# written by `claude plugin eval` (default --output-dir <eval dir>/results/<timestamp>/)\nresults/\n')
  for (const { skill, cases } of suites) {
    for (const c of cases) {
      const dir = `${skill}-${c.id}`
      const kind = kindOf(c, cases)
      files.set(`${dir}/prompt.md`, promptMd(skill, c, kind))
      files.set(`${dir}/graders/trigger.md`, triggerGrader(skill, c.should_trigger))
      c.expectations.forEach((x, i) => {
        files.set(`${dir}/graders/expect-${String(i + 1).padStart(2, '0')}.md`, expectationGrader(skill, c, x))
      })
    }
  }
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

// Every file currently under evals/, as posix paths, skipping any results/ dir.
function existing(dir = OUT, base = OUT, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'results') continue
      existing(p, base, acc)
    } else if (name !== '.DS_Store') {
      acc.push(relative(base, p).split(sep).join('/'))
    }
  }
  return acc
}

function pruneEmptyDirs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory() && name !== 'results') {
      pruneEmptyDirs(p)
      if (readdirSync(p).length === 0) rmdirSync(p)
    }
  }
}

const want = build()
const have = existing()
const extra = have.filter((f) => !want.has(f))

if (process.argv.includes('--check')) {
  const problems = []
  for (const [f, body] of want) {
    const p = join(OUT, f)
    if (!existsSync(p)) problems.push(`missing: evals/${f}`)
    else if (readFileSync(p, 'utf8') !== body) problems.push(`stale:   evals/${f}`)
  }
  for (const f of extra) problems.push(`extra:   evals/${f}`)
  if (problems.length) {
    console.error(problems.join(NL))
    console.error(`build-evals --check: ${problems.length} file(s) out of date; run \`node scripts/build-evals.mjs\``)
    process.exit(1)
  }
  console.log(`build-evals --check: evals/ is up to date (${want.size} files)`)
} else {
  let written = 0
  for (const [f, body] of want) {
    const p = join(OUT, f)
    if (existsSync(p) && readFileSync(p, 'utf8') === body) continue
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
    written++
  }
  for (const f of extra) rmSync(join(OUT, f), { force: true })
  if (existsSync(OUT)) pruneEmptyDirs(OUT)
  const cases = [...want.keys()].filter((f) => f.endsWith('/prompt.md')).length
  console.log(`build-evals: ${cases} cases, ${want.size} files (${written} written, ${extra.length} removed) in evals/`)
}
