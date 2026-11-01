#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  policy-counterfactual — the execution-policy benchmark's first stage
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/policy-counterfactual.mjs [--root <project>]... [--json]
//
//  Re-routes the tasks of recorded runs through the engine's OWN router (the `policy:begin` …
//  `policy:end` block of workflows/orchestrate-loop.js, evaluated as is) and sets the pick next to
//  what each task actually went through. It answers, before FAST runs live
//  (docs/specs/2026-10-31-execution-policies-design.md §8, spike S2):
//    • the policy mix `auto` would have chosen;
//    • the dispatches FAST would have skipped (an upper bound on its saving);
//    • the misroute check: on a task routed FAST, every recorded signal FAST handles worse than
//      today — a round-0 FAIL (FAST still reviews round 0, but fixes once), two or more fix rounds
//      (FAST escalates), a data-integrity verdict that gated (FAST does not draw it per task), and
//      a terminal-sweep FAIL in the task's repo. Zero is the bar for turning FAST on.
//
//  Each --root is a project (default: the current directory): its grimoire.config.json gives the
//  repos' tags, the specialists and {policies}; its telemetry.dir (default .grimoire/runs) the runs.
//  What a recorded run cannot tell: dependsOn (no cross-repo floor, no fan-out raise) and the
//  declared files of a task that never landed (treated as undeclared: raised). A landed task's files
//  are its declared files plus those it changed, so file counts read high: the mix leans BALANCED,
//  which errs toward fewer FAST tasks, never more.
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig } from './project-config.mjs'
import { loadRuns } from './render-logs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE = join(HERE, '..', 'workflows', 'orchestrate-loop.js')

// The engine's router: the block between `// policy:begin` and `// policy:end`, which holds no
// engine state. Returns { POLICIES, DEFAULT_POLICY_RULES, classifyPolicy, labelPolicy }.
export function loadRouter(enginePath = ENGINE) {
  const src = readFileSync(enginePath, 'utf8')
  const m = /\n\/\/ policy:begin\n([\s\S]*?)\n\/\/ policy:end\n/.exec(src)
  if (!m) throw new Error(`${enginePath}: no "// policy:begin" … "// policy:end" block`)
  return new Function(`${m[1]}\nreturn { POLICIES, DEFAULT_POLICY_RULES, classifyPolicy, labelPolicy }`)()
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// {policies} over the defaults, key by key (the engine logs a malformed key; here it keeps the default)
export function rulesOf(router, policies) {
  const d = router.DEFAULT_POLICY_RULES
  const p = isObj(policies) ? policies : {}
  const pick = (k, ok) => (k in p && ok(p[k]) ? p[k] : d[k])
  const globs = (v) => Array.isArray(v) && v.every((g) => typeof g === 'string')
  return {
    ...d,
    strictPaths: pick('strictPaths', globs), strictTags: pick('strictTags', globs), docsPaths: pick('docsPaths', globs),
    fastMaxFiles: pick('fastMaxFiles', Number.isInteger), fanOut: pick('fanOut', Number.isInteger),
    promote: { ...d.promote, ...(isObj(p.promote) ? Object.fromEntries(Object.entries(p.promote).filter(([, v]) => globs(v))) : {}) },
  }
}

function landedFiles(runDir) {
  const out = new Map()
  let text = ''
  try { text = readFileSync(join(runDir, 'landed.jsonl'), 'utf8') } catch { return out }
  for (const line of text.split('\n')) {
    let d
    try { d = JSON.parse(line) } catch { continue }
    if (isObj(d) && typeof d.id === 'string' && Array.isArray(d.files)) out.set(d.id, [...new Set([...(out.get(d.id) || []), ...d.files.map(String)])])
  }
  return out
}

// One run: each routed task's pick and what it went through.
export function counterfactualRun(run, runDir, { router, rules, tagsOf, migrationAgents }) {
  const ev = run.events
  const files = landedFiles(runDir)
  const route = new Map()
  for (const e of ev) if (e.type === 'route' && e.task != null) route.set(String(e.task), e)
  const tasks = []
  for (const [id, r] of route) {
    const replannedAfterCode = /replanned after a code failure/.test(String(r.reason || ''))
    const selectorModel = (/selector chose (haiku|sonnet|opus)/.exec(String(r.reason || '')) || [])[1] || r.model
    const c = router.classifyPolicy(
      { files: files.get(id) || [], tags: tagsOf(r.repo), migration: migrationAgents.some((a) => String(r.agent || '').endsWith(a)), crossRepo: [], downstream: 0, model: selectorModel, replannedAfterCode, history: [] },
      rules,
    )
    const reviews = ev.filter((e) => e.type === 'review' && String(e.task) === id && e.discarded !== true && e.stage !== 'terminal')
    const round0Fail = reviews.filter((e) => (e.round ?? 0) === 0 && e.verdict === 'FAIL').map((e) => `${e.stage}:${e.persona}`)
    const fixes = ev.filter((e) => e.type === 'fix' && String(e.task) === id).length
    const diGated = reviews.some((e) => /data-integrity/i.test(String(e.persona)) && (e.gating ?? 0) > 0)
    const settle = [...ev].reverse().find((e) => e.type === 'settle' && String(e.task) === id)
    // what FAST would not have dispatched: re-review rounds (the guard replaces them), fixes past the
    // first, and data-integrity (not drawn per task) — counted on what was recorded
    const skipped = reviews.filter((e) => (e.round ?? 0) > 0).length + Math.max(0, fixes - 1) + reviews.filter((e) => /data-integrity/i.test(String(e.persona))).length
    tasks.push({ id, repo: r.repo, model: selectorModel, auto: c.auto, signals: c.floor.concat(c.raise).slice(0, 4), round0Fail, fixes, diGated, status: settle ? settle.status : null, skippedIfFast: skipped })
  }
  const terminalFail = new Set(ev.filter((e) => (e.type === 'terminal' && e.verdict === 'FAIL') || (e.type === 'review' && e.stage === 'terminal' && e.verdict === 'FAIL' && e.discarded !== true))
    .map((e) => e.repo ?? (/^(.+):final$/.exec(String(e.task ?? '')) || [])[1]).filter(Boolean))
  for (const t of tasks) t.terminalFailInRepo = terminalFail.has(t.repo)
  return tasks
}

export function report(rows) {
  const mix = {}
  for (const t of rows) mix[t.auto] = (mix[t.auto] || 0) + 1
  const fast = rows.filter((t) => t.auto === 'fast')
  const misroutes = fast.filter((t) => t.round0Fail.length || t.fixes >= 2 || t.diGated || t.terminalFailInRepo)
    .map((t) => ({ run: t.run, id: t.id, repo: t.repo, why: [...(t.round0Fail.length ? [`round-0 FAIL (${t.round0Fail.join(', ')})`] : []), ...(t.fixes >= 2 ? [`${t.fixes} fix rounds`] : []), ...(t.diGated ? ['data-integrity gated'] : []), ...(t.terminalFailInRepo ? ['terminal sweep failed in its repo'] : [])] }))
  return {
    tasks: rows.length,
    mix,
    fastSkippableDispatches: fast.reduce((a, t) => a + t.skippedIfFast, 0),
    misroutes,
    verdict: !rows.length ? 'no recorded tasks' : misroutes.length ? `${misroutes.length} task(s) routed FAST carry a signal FAST handles worse: fix the routing before FAST runs live` : 'no task routed FAST carries a recorded failure signal',
  }
}

function subdirs(dir) {
  try { return readdirSync(dir).filter((n) => { try { return lstatSync(join(dir, n)).isDirectory() } catch { return false } }) } catch { return [] }
}

function main(argv) {
  const roots = []
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) roots.push(resolve(argv[++i]))
    else if (argv[i] === '--json') json = true
    else { console.error(`unknown argument ${argv[i]}\nusage: node scripts/policy-counterfactual.mjs [--root <project>]... [--json]`); return 2 }
  }
  if (!roots.length) roots.push(process.cwd())
  const router = loadRouter()
  const rows = []
  for (const root of roots) {
    const cfg = readConfig(root)
    const repos = Array.isArray(cfg.repos) ? cfg.repos : []
    const tagsOf = (name) => (repos.find((r) => r && r.name === name) || {}).tags || []
    const migrationAgents = (Array.isArray(cfg.specialists) ? cfg.specialists : []).map((s) => s && s.agent).filter((a) => /migration/.test(String(a || '')))
    const runsDir = resolve(root, isObj(cfg.telemetry) && typeof cfg.telemetry.dir === 'string' ? cfg.telemetry.dir : '.grimoire/runs')
    if (!existsSync(runsDir)) continue
    const byDir = new Map(subdirs(runsDir).map((n) => [n, join(runsDir, n)]))
    for (const run of loadRuns(runsDir))
      for (const t of counterfactualRun(run, byDir.get(run.dirName), { router, rules: rulesOf(router, cfg.policies), tagsOf, migrationAgents: migrationAgents.length ? migrationAgents : ['migration-engineer'] }))
        rows.push({ run: run.runId, project: root, ...t })
  }
  const out = report(rows)
  if (json) console.log(JSON.stringify({ ...out, rows }, null, 2))
  else {
    console.log(`${out.tasks} recorded task(s) · auto would pick: ${Object.entries(out.mix).map(([p, n]) => `${p} ${n}`).join(' · ') || '—'}`)
    console.log(`dispatches FAST would have skipped (upper bound): ${out.fastSkippableDispatches}`)
    for (const m of out.misroutes) console.log(`  ⚠ ${m.run} ${m.id} (${m.repo}): ${m.why.join('; ')}`)
    console.log(out.verdict)
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
