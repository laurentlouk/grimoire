// ════════════════════════════════════════════════════════════════════════════
//  Gate tests for the build orchestrator — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/workflow-gates.test.mjs
//
//  These scripts normally only run inside the Workflow runtime, where every step
//  costs real agents — so the review/gate logic would be unverifiable without a
//  full paid run. This harness reimplements the runtime's contract
//  (agent / parallel / log / phase / args / budget) with scripted stubs, so the
//  control flow executes end-to-end in milliseconds and asserts the actual
//  dispatches: which agents ran, in what order, and with which prompt.
//
//  The repos are FIXTURES, not product facts: `api` (backend tag, gate command),
//  `mobile` (mobile tag, gate conditional on touched paths), `infra` (no gate).
//  Everything stack-specific reaches the script through args.repos.
//
//  What it locks down:
//    • the SEVERITY GATE — blocker/major sends a task back, minor/nit never does
//      (a rework round costs a full opus dispatch)
//    • a FAIL with no findings is unverifiable, so it still gates
//    • the REVIEW RANGE is handed to reviewers, and advances after each fix
//    • non-SHA `commits` (e.g. commit messages) degrade to self-discovery rather
//      than producing a bogus `git diff` range
//    • the post-fix GUARD — PASS skips the panel re-run, RE_REVIEW loops back
//      into a full round on the ADVANCED range; single-reviewer stages skip the
//      guard (it would cost exactly what it saves)
//    • the REVIEW SCOPE SPLIT — per task only the build-safety core runs
//      (adversarial QA, + data-integrity on backend/infra-tagged repos); the
//      polish/compliance lenses run ONCE per repo as the TERMINAL sweep when the
//      whole project drains, before the gate/PR — and a failed sweep is
//      TERMINAL_REVIEW_FAILED, held, replanned, gate not paid
//    • PERSONA SELECTION IS BY TAG, never by repo name
//    • the repo gate command runs ONCE, LAST, after review — and never inside the
//      implementer or the fix rung
//    • a repo configured with `gate: null` opens no gate dispatch at all
//    • `gate.when.pathsMatching` fires from what the RUN touched (a gate hook's
//      unit is the whole branch), including files revealed only by an earlier
//      task, by `filesChanged`, or by a review fix — and is skipped when nothing
//      the run touched matches
//    • a failed gate is reported as GATE_FAILED, never as done — and is HELD
//      (not re-dispatched on the same tree) while the failure goes to the replanner
//    • the workflow still fails SAFE to preview without {execute:true} — a
//      preview dispatches exactly ONE agent (the slice index), never an implementer
//    • the REQUIRED-HOOK gate — configured + execute mode probes the session; any
//      failed check refuses (required_hook_missing, nothing dispatched). With
//      {requireHook:null} (the default) nothing is ever probed; previews never
//      probe; {skipHookCheck:true} runs anyway, loudly
//
//  Adding a case: call run(name, tasks, responder, {src, execute}) — tasks feed
//  the parse/hydrate stubs; the responder receives every OTHER dispatch's label
//  and returns whatever that agent should have returned.
import { readFileSync, existsSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
// The runtime wraps the script in an async fn (hence top-level `return`); `export` must go.
const load = (f) => readFileSync(`${DIR}/${f}`, 'utf8').replace(/^export const meta/m, 'const meta')
const body = load('orchestrate-loop.js')

let PASS = 0, FAIL = 0
// Post-gate LEARNING dispatches: the harness-context loader runs right after the index, the
// ledger writer + crystallize run after every gate/PR. They are not build steps — order
// assertions about "the gate ran last" mean last among BUILD dispatches.
const LEARNING = new Set(['harness-context', 'ledger', 'crystallize'])
const buildOnly = (order) => order.filter((l) => !LEARNING.has(l))
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

// ── the fixture stack: three repos, three gate shapes ──
const NATIVE_PATHS = ['native/', 'modules/native-bridge/']
const REPOS = [
  {
    name: 'api',
    agent: 'backend-engineer',
    tags: ['backend'],
    // an unconditional, expensive gate that takes a machine-global lock
    gate: { kind: 'command', run: 'make e2e', stamp: 'tests/e2e/.e2e-green' },
    timeoutMin: 60,
  },
  {
    name: 'mobile',
    agent: 'app-engineer',
    tags: ['mobile'],
    // a CONDITIONAL gate: only run it when the branch touched a native path
    gate: {
      kind: 'command',
      run: 'npm run smoke',
      stamp: 'modules/native-bridge/.smoke-green',
      note: 'rebuild the vendored native artifacts and commit them first',
      when: { pathsMatching: NATIVE_PATHS },
    },
  },
  { name: 'infra', agent: 'infra-engineer', tags: ['infra'], gate: null },
]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-600', repos: REPOS }

// The slice index the 'parse-index' agent would return for a scenario's tasks.
const indexOf = (tasks) => ({
  slices: [...new Set(tasks.map((t) => t.slice ?? 1))].sort((a, b) => a - b).map((s) => ({
    slice: s,
    sliceLabel: 'v',
    issues: tasks
      .filter((t) => (t.slice ?? 1) === s)
      .map((t) => ({ id: t.id, title: t.title || 't', repo: t.repo, state: 'todo', dependsOn: t.dependsOn || [] })),
  })),
})

async function run(scenario, tasks, responder, { src = body, execute = true, indexExtra = {}, extraArgs = {} } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    // The two parse phases are answered from the scenario's task list; everything
    // else (implementers, reviewers, guard, gates, replanner) goes to the responder.
    if (label === 'parse-index') return { ...indexOf(tasks), ...indexExtra }
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)) }
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const pipeline = async () => { throw new Error('pipeline not used') }
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', src)
  const logs = []
  const result = await fn(agent, parallel, pipeline, (m) => logs.push(m), () => {}, { ...INPUTS, execute, ...extraArgs },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  return { result, calls, logs }
}

// Ids are TRACKER ids — that is what the index carries and what the scheduler keys on.
const APP_TASK = {
  id: 'PROJ-900', ticket: 'PROJ-900', repo: 'mobile', agent: 'app-engineer', slice: 1, sliceLabel: 'v',
  order: 1, taskText: 'Build the thing', deferred: false, branch: 'feat/x',
}
const BE_TASK = { ...APP_TASK, id: 'PROJ-901', ticket: 'PROJ-901', repo: 'api', agent: 'backend-engineer' }

const IMPL_OK = { status: 'DONE', summary: 's', commits: ['aaaaaaa', 'bbbbbbb'], baseSha: '0000000', headSha: 'bbbbbbb' }
const FIX_OK = { status: 'DONE', summary: 'fixed', commits: ['ccccccc'], headSha: 'ccccccc' }
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const GATE_OK = { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/1' }

// ══════════════ A · a nit-only FAIL must NOT buy a rework round (terminal stage) ══════════════
{
  const { result, calls } = await run('A · nit-only FAIL in the terminal sweep → PASS, no rework', [APP_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('spec-hawk')) return V('PASS')
      if (label.startsWith('app-store')) return V('FAIL', [{ severity: 'nit', file: 'a.ts', line: 3, issue: 'naming' }])
      return V('PASS')
    })
  ok(!calls.some((c) => c.label.startsWith('fix:')), 'no fix dispatch was made for a nit-only FAIL')
  ok(result.done.length === 1 && result.done[0].status === 'DONE', 'task landed DONE')
  ok(result.advisoryNotes.length === 1 && result.advisoryNotes[0].severity === 'nit', 'the terminal nit is reported in advisoryNotes')
  ok(result.advisoryNotes[0].issue === 'naming' && result.advisoryNotes[0].where === 'a.ts:3', 'advisory note carries persona/where/issue')
  ok(calls.filter((c) => c.label.startsWith('app-store')).length === 1, 'the sweep ran exactly once (no re-review round)')
  ok(result.prs.length === 1, 'the nit did not hold the PR')
}

// ══════════════ B · a blocker DOES gate; guard RE_REVIEW re-runs the panel on the ADVANCED range ══════════════
// Backend-tagged task: its quality core is 2 reviewers (break-it + data-integrity), so the guard applies.
{
  let round = 0
  const { result, calls } = await run('B · blocker → fix → guard RE_REVIEW → panel re-run → PASS', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('fix:')) return FIX_OK
      if (label.startsWith('guard:')) return { decision: 'RE_REVIEW', reason: 'the fix touched the session layer' }
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('spec-hawk')) return V('PASS')
      if (label.startsWith('data-integrity')) { round++; return round === 1 ? V('FAIL', [{ severity: 'blocker', file: 'p.rs', line: 9, issue: 'double-count' }]) : V('PASS') }
      return V('PASS')
    })
  const fixes = calls.filter((c) => c.label.startsWith('fix:'))
  ok(fixes.length === 1, 'exactly one fix dispatch')
  ok(/\[blocker · Eventing & Data-Integrity Engineer\] p\.rs:9 — double-count/.test(fixes[0].prompt), 'the fix brief carries the blocking finding')
  ok(result.done.length === 1, 'task landed after the fix')
  const rounds = calls.filter((c) => c.label.startsWith('data-integrity'))
  ok(rounds.length === 2, 'the panel re-ran after the guard said RE_REVIEW')
  ok(/diff aaaaaaa\^\.\.bbbbbbb/.test(rounds[0].prompt), 'round 1 reviewers got the original range')
  ok(/diff aaaaaaa\^\.\.ccccccc/.test(rounds[1].prompt), 'round 2 reviewers got the range ADVANCED to the fix head')
  ok(result.guardChecks.checked === 1 && result.guardChecks.reReviewed === 1, 'the guard ran and its RE_REVIEW is counted')
}

// ══════════════ B2 · guard PASS verifies the fix WITHOUT a panel re-run ══════════════
{
  let round = 0
  const { result, calls } = await run('B2 · blocker → fix → guard PASS, panel NOT re-run', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('fix:')) return FIX_OK
      if (label.startsWith('guard:')) return { decision: 'PASS', reason: 'both findings addressed, contained' }
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('spec-hawk')) return V('PASS')
      if (label.startsWith('data-integrity')) { round++; return round === 1 ? V('FAIL', [{ severity: 'blocker', file: 'p.rs', line: 9, issue: 'double-count' }]) : V('PASS') }
      return V('PASS')
    })
  ok(calls.filter((c) => c.label.startsWith('data-integrity')).length === 1, 'the quality panel ran exactly once — the guard absorbed the re-review')
  ok(result.done.length === 1 && result.done[0].status === 'DONE', 'task landed via the guard-verified fix')
  ok(result.guardChecks.checked === 1 && result.guardChecks.passed === 1, 'the saving is counted in guardChecks')
  const guard = calls.find((c) => c.label.startsWith('guard:'))
  ok(/diff bbbbbbb\.\.ccccccc/.test(guard.prompt), 'the guard is handed the FIX\'s own diff (pre-fix head → new head)')
}

// ══════════════ B3 · a single-reviewer quality core skips the guard ══════════════
// Mobile-tagged task: its quality core is ONE reviewer (break-it) — a guard would cost exactly
// what it saves, so the re-review is the single reviewer again, guard never dispatched.
{
  let round = 0
  const { result, calls } = await run('B3 · 1-reviewer core: blocker → fix → re-review, NO guard', [APP_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('fix:')) return FIX_OK
      if (label.startsWith('guard:')) throw new Error('guard must not run for a single-reviewer stage')
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('spec-hawk')) return V('PASS')
      if (label.startsWith('break-it')) { round++; return round === 1 ? V('FAIL', [{ severity: 'blocker', file: 'x.ts', line: 1, issue: 'race' }]) : V('PASS') }
      return V('PASS')
    })
  ok(!calls.some((c) => c.label.startsWith('guard:')), 'no guard dispatch for a 1-reviewer stage')
  ok(calls.filter((c) => c.label.startsWith('break-it')).length === 2, 'the single reviewer re-checked the fix itself')
  ok(result.done.length === 1 && result.guardChecks.checked === 0, 'landed, and no guard check was counted')
}

// ══════════════ C · a FAIL with no findings is unverifiable → gates ══════════════
{
  let round = 0
  const { calls } = await run('C · findings-less FAIL still gates', [APP_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('fix:')) return FIX_OK
      if (label.startsWith('guard:')) return { decision: 'PASS', reason: 'addressed' }
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('spec-hawk')) return V('PASS')
      if (label.startsWith('break-it')) { round++; return round === 1 ? { verdict: 'FAIL', summary: 'it feels wrong' } : V('PASS') }
      return V('PASS')
    })
  const fixes = calls.filter((c) => c.label.startsWith('fix:'))
  ok(fixes.length === 1, 'a FAIL with no findings was NOT waved through')
  ok(/without any finding — unverifiable/.test(fixes[0].prompt), 'it was synthesized into a blocking finding with the summary')
}

// ══════════════ D · gated repo: reviews first, then ONE gate dispatch ══════════════
{
  const { result, calls } = await run('D · the repo gate command runs once, after review', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  const order = buildOnly(calls.map((c) => c.label.replace(/:.*/, '')))
  ok(order.filter((l) => l === 'gate').length === 1, 'exactly one gate dispatch')
  ok(order[order.length - 1] === 'gate', 'the gate ran LAST — after every review')
  const impl = calls.find((c) => c.label.startsWith('impl:'))
  ok(/do NOT run the repo gate \(`make e2e`\)/.test(impl.prompt), 'the implementer is told NOT to run the repo gate, by name')
  const gate = calls.find((c) => c.label.startsWith('gate:'))
  ok(/Gate command: \*\*APPLIES\*\*/.test(gate.prompt), 'an unconditional gate always applies')
  ok(/make e2e/.test(gate.prompt) && /tests\/e2e\/\.e2e-green/.test(gate.prompt), 'the gate dispatch gets the command and its stamp file')
  // agentT deliberately STRIPS timeoutMin before agent() sees it — the runtime's opts schema
  // is closed, so leaking the key would be a validation error on every gate dispatch.
  ok(!('timeoutMin' in gate.opts), 'timeoutMin is stripped before reaching agent() (closed opts schema)')
  ok(!('timeoutMin' in impl.opts), 'the repo\'s longer implementer floor is stripped too')
  ok(result.prs.length === 1 && result.prs[0].pr.endsWith('/pull/1'), 'the PR URL comes back from the gate')
  ok(calls.filter((c) => c.label.startsWith('reliability-sre')).length === 1, 'the SRE lens ran exactly once — in the terminal sweep, not per task')
  ok(order.indexOf('reliability-sre') > order.indexOf('break-it'), 'the terminal sweep ran after the per-task quality core')
  ok(order.indexOf('gate') > order.indexOf('reliability-sre'), 'and the gate only after the sweep')
  ok(!order.includes('hig') && !order.includes('app-store'), 'mobile-tag personas did not run on a backend-tagged repo')
}

// ══════════════ E · a failed gate must not read as success — and is HELD, not re-dispatched ══════════════
{
  const { result, calls } = await run('E · gate failure → GATE_FAILED, held, replanned', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return { status: 'BLOCKED', summary: '13-stream.test.ts failed' }
      if (label.startsWith('replan')) return { decision: 'HALT', reason: 'gate regression', learnings: ['x'] }
      return V('PASS')
    })
  const replan = calls.find((c) => c.label === 'replan#1')
  ok(/the repo gate \/ PR failed AFTER the review panel passed/.test(replan.prompt), 'the replan brief explains the gate failure correctly')
  ok(result.done.length === 1 && result.done[0].id === 'PROJ-901', 'the reviewed task itself still counts as landed')
  ok(result.needsAttention.length === 1 && result.needsAttention[0].status === 'GATE_FAILED', 'the gate is reported as GATE_FAILED, never done')
  ok(result.prs.length === 0, 'no PR is reported from a failed gate')
  ok(calls.filter((c) => c.label.startsWith('gate:')).length === 1, 'the failing gate was dispatched ONCE — held, not retried on the same tree')
  ok(calls.some((c) => c.label === 'replan#1'), 'the failure went to the replanner instead')
  ok(result.halt && /gate regression/.test(result.halt.reason), 'the planner\'s HALT ended the run')
}

// ══════════════ E2 · a held gate retries once the replan lands NEW repo work ══════════════
{
  let gateCalls = 0
  const REPAIR = { ...BE_TASK, id: 'PROJ-902', ticket: 'PROJ-902', taskText: 'Repair the regression' }
  const { result, calls } = await run('E2 · gate hold releases when a repair task lands', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) { gateCalls++; return gateCalls === 1 ? { status: 'BLOCKED', summary: 'regression' } : GATE_OK }
      if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'queue a repair task', learnings: ['x'], tasks: [REPAIR] }
      return V('PASS')
    })
  ok(calls.some((c) => c.label === 'impl:PROJ-902'), 'the replanned repair task ran')
  ok(gateCalls === 2, 'the gate re-dispatched only AFTER the repair landed')
  ok(result.prs.length === 1, 'the retried gate shipped the PR')
  ok(!result.halt, 'the run finished without halting')
  ok(result.replans === 1, 'the landed gate CLEARED its standing failure — no further replans against a resolved problem')
}

// ══════════════ F · missing SHAs degrade, never hand over a bogus range ══════════════
{
  const { calls } = await run('F · no usable SHAs → reviewer discovers the diff', [APP_TASK],
    (label) => {
      if (label.startsWith('impl:')) return { status: 'DONE', summary: 's', commits: ['feat: add the thing'] }
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  const rev = calls.find((c) => c.label.startsWith('spec-hawk'))
  ok(/did not report usable commit SHAs/.test(rev.prompt), 'commit MESSAGES are rejected as SHAs and it falls back')
  ok(!/diff feat/.test(rev.prompt), 'no bogus git range was constructed')
}

// ══════════════ G · preview still fails safe ══════════════
{
  const { result, calls } = await run('G · preview dispatches only the index', [APP_TASK, BE_TASK],
    (label) => { throw new Error(`should not dispatch beyond the index: ${label}`) }, { execute: false })
  ok(result.preview === true, 'no execute flag → preview only')
  ok(calls.length === 1 && calls[0].label === 'parse-index', 'exactly ONE dispatch: the slice index (no hydration, no implementers)')
  ok(result.plan.length === 1 && result.plan[0].issues.length === 2, 'the slice DAG still parses into the plan view')
  ok(result.plan[0].issues.every((i) => i.startable === true), 'independent issues are marked startable')
  ok(result.reviewPanels['mobile'].terminal.includes('App Store Reviewer') && !result.reviewPanels['api'].terminal.includes('App Store Reviewer'),
    'the preview shows each repo its own terminal panel')
  ok(result.reviewPanels['mobile'].quality.includes('Adversarial QA & Integrity') && !result.reviewPanels['mobile'].quality.includes('App Store Reviewer'),
    'the per-task quality core excludes the terminal lenses')
  ok(result.repos.api.gate === 'make e2e' && result.repos.api.prBy === 'gate' && result.repos.infra.gate === null && result.repos.infra.prBy === 'implementer',
    'the preview echoes the resolved repo config (path, agent, tags, gate, prBy)')
  ok(result.repos.mobile.path === 'repositories/mobile', 'a repo with no explicit path defaults to repositories/<name>')
}

// ══════════════ TAG · persona selection is by TAG, not by repo name ══════════════
{
  const WEB = { name: 'site', agent: 'web-engineer', tags: ['web'], gate: null }
  const UNTAGGED = { name: 'docs', agent: 'docs-engineer', tags: [], gate: null }
  const T1 = { ...APP_TASK, id: 'PROJ-950', ticket: 'PROJ-950', repo: 'site', agent: 'web-engineer' }
  const T2 = { ...APP_TASK, id: 'PROJ-951', ticket: 'PROJ-951', repo: 'docs', agent: 'docs-engineer' }
  const { result } = await run('TAG · web tag draws HIG/a11y but not store review; an untagged repo draws only the "*" lenses',
    [T1, T2], (label) => { throw new Error(`no dispatch expected: ${label}`) },
    { execute: false, extraArgs: { repos: [...REPOS, WEB, UNTAGGED] } })
  const site = result.reviewPanels.site
  const docs = result.reviewPanels.docs
  ok(site.terminal.includes('Human Interface Reviewer') && site.terminal.includes('Accessibility Lead'), 'the web tag draws the interface + accessibility lenses')
  ok(!site.terminal.includes('App Store Reviewer'), 'but NOT the store reviewer (mobile only)')
  ok(!site.quality.includes('Eventing & Data-Integrity Engineer'), 'and not the data-integrity lens (backend/infra only)')
  ok(JSON.stringify(docs.terminal) === JSON.stringify(['Reliability & Release SRE', 'Privacy Engineer']), 'an untagged repo gets exactly the two "*" terminal lenses')
  ok(JSON.stringify(docs.quality) === JSON.stringify(['Adversarial QA & Integrity']), 'and exactly the one "*" quality lens')
  ok(JSON.stringify(docs.spec) === JSON.stringify(['Spec Hawk']), 'spec review is universal')
}

// ══════════════ W · a repo with gate:null — no gate dispatch, PR from the implementer ══════════════
{
  const INFRA_TASK = { ...APP_TASK, id: 'PROJ-905', ticket: 'PROJ-905', repo: 'infra', agent: 'infra-engineer' }
  const { result, calls } = await run('W · gate:null → no gate dispatch, PR from the implementer', [INFRA_TASK],
    (label) => {
      if (label.startsWith('impl:')) return { ...IMPL_OK, prUrl: 'https://github.com/x/infra/pull/3' }
      return V('PASS')
    })
  ok(!calls.some((c) => c.label.startsWith('gate:')), 'no gate dispatch for a repo configured with gate: null')
  const impl = calls.find((c) => c.label.startsWith('impl:'))
  ok(!/do NOT run `gh pr create`/i.test(impl.prompt), 'the implementer is not told to withhold the PR')
  ok(result.prs.length === 1 && result.prs[0].pr.endsWith('/pull/3'), 'the PR comes back from the implementer')
  ok(calls.filter((c) => c.label.startsWith('reliability-sre')).length === 1, 'no gate ≠ no sweep: the repo still gets the terminal quality sweep')
  ok(calls.filter((c) => c.label.startsWith('data-integrity')).length === 1, 'and its infra tag puts the data-integrity lens in its per-task core')
}

// ══════════════ W2 · a repo with gate:null but prBy:'gate' still opens its PR from the slot ══════════════
{
  const repos = REPOS.map((r) => (r.name === 'infra' ? { ...r, prBy: 'gate' } : r))
  const INFRA_TASK = { ...APP_TASK, id: 'PROJ-906', ticket: 'PROJ-906', repo: 'infra', agent: 'infra-engineer' }
  const { result, calls } = await run('W2 · prBy:gate with no gate command → PR-only gate dispatch', [INFRA_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return { status: 'DONE', summary: 'pr', prUrl: 'https://github.com/x/infra/pull/9' }
      return V('PASS')
    }, { extraArgs: { repos } })
  const gate = calls.find((c) => c.label === 'gate:infra')
  ok(!!gate, 'the gate dispatch ran for the PR alone')
  ok(/Gate command: \*\*does NOT apply\*\*/.test(gate.prompt) && /There is no gate command for this repo/.test(gate.prompt),
    'the dispatch is told there is no command, only a PR to open')
  ok(/gh pr create/.test(gate.prompt), 'it still opens the PR')
  ok(result.prs.length === 1 && result.prs[0].pr.endsWith('/pull/9'), 'and the PR URL comes back from it')
}

// ══════════════ T1 · the scope split itself: core per task, sweep once per repo ══════════════
{
  const { result, calls } = await run('T1 · per-task core vs terminal sweep', [APP_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  const labels = calls.map((c) => c.label)
  ok(calls.filter((c) => c.label.startsWith('break-it')).length === 1, 'the mobile quality core is adversarial QA, once per task')
  ok(!calls.some((c) => c.label.startsWith('data-integrity')), 'the data-integrity lens does not run on a mobile-tagged task')
  for (const lens of ['reliability-sre', 'hig', 'accessibility', 'privacy', 'app-store'])
    ok(calls.filter((c) => c.label.startsWith(lens)).length === 1, `terminal lens ${lens} ran exactly once, for the whole repo`)
  const gateIdx = labels.findIndex((l) => l.startsWith('gate:'))
  ok(labels.findIndex((l) => l.startsWith('hig')) > labels.indexOf('impl:PROJ-900'), 'the sweep ran after the work landed')
  ok(gateIdx > labels.findIndex((l) => l.startsWith('hig')), 'and the gate only after the sweep')
  const sweep = calls.find((c) => c.label.startsWith('hig'))
  ok(/diff origin\/main\.\.\.feat\/x/.test(sweep.prompt), 'sweep reviewers are pointed at the ENTIRE integrated run branch')
  ok(result.done.length === 1 && result.prs.length === 1, 'task landed and the PR shipped')
}

// ══════════════ T2 · terminal findings → fix on the run branch → guard PASS → gate ships ══════════════
{
  let round = 0
  const { result, calls } = await run('T2 · terminal blocker → fix → guard PASS → gate', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('fix:')) return FIX_OK
      if (label.startsWith('guard:')) return { decision: 'PASS', reason: 'addressed, contained' }
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('reliability-sre')) { round++; return round === 1 ? V('FAIL', [{ severity: 'major', file: 'api.proto', line: 4, issue: 'breaks old clients' }]) : V('PASS') }
      return V('PASS')
    })
  const fix = calls.find((c) => c.label.startsWith('fix:api:final'))
  ok(!!fix, 'the sweep routed its finding to a fix dispatch on the repo, not to a task')
  ok(/breaks old clients/.test(fix.prompt) && /do not run gate commands or open\/update any PR/i.test(fix.prompt), 'the fix brief carries the finding and withholds the gate/PR')
  ok(calls.filter((c) => c.label.startsWith('reliability-sre')).length === 1, 'guard PASS — the sweep panel was not re-run')
  ok(result.guardChecks.passed === 1, 'the guard saving is counted')
  const labels = calls.map((c) => c.label)
  ok(labels.findIndex((l) => l.startsWith('gate:')) > labels.indexOf(fix.label), 'the gate ran AFTER the sweep fix (stamp on the fixed tree)')
  ok(result.prs.length === 1, 'the PR shipped')
}

// ══════════════ T3 · a failed sweep is TERMINAL_REVIEW_FAILED — held, replanned, gate not paid ══════════════
{
  const { result, calls } = await run('T3 · sweep failure blocks the gate and reaches the replanner', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('fix:')) return { status: 'BLOCKED', summary: 'cannot fix without a product call' }
      if (label.startsWith('replan')) return { decision: 'HALT', reason: 'privacy exposure needs a human', learnings: [] }
      if (label.startsWith('privacy')) return V('FAIL', [{ severity: 'blocker', file: 'q.rs', line: 2, issue: 'address exposed' }])
      return V('PASS')
    })
  ok(!calls.some((c) => c.label.startsWith('gate:')), 'the gate command was NOT paid after a failed sweep')
  ok(result.needsAttention.some((r) => r.status === 'TERMINAL_REVIEW_FAILED'), 'reported TERMINAL_REVIEW_FAILED, never done')
  ok(result.done.length === 1, 'the per-task work itself still counts as landed')
  ok(result.prs.length === 0, 'no PR from a failed sweep')
  const replan = calls.find((c) => c.label === 'replan#1')
  ok(/TERMINAL quality sweep/.test(replan.prompt) && /q\.rs:2 — address exposed/.test(replan.prompt), 'the replan brief carries the sweep failure and its findings')
  ok(calls.filter((c) => c.label.startsWith('privacy')).length === 1, 'the failing sweep was dispatched once — held, not retried on the same tree')
}

// ══════════════ M–S · the CONDITIONAL gate (gate.when.pathsMatching) ══════════════
// A gate hook typically diffs origin/main...HEAD (the WHOLE branch) and every task of a repo
// lands on one branch — so the trigger is what the RUN touched, not any single task's files.
const NATIVE = 'modules/native-bridge/src/index.ts — wire the new event'
const UI = 'app/(tabs)/profile.tsx — add the row'
const appTask = (o) => ({ ...APP_TASK, ...o })

{
  const { calls } = await run('M · conditional gate + a matching path → gate runs, then the PR, last, once',
    [appTask({ files: [NATIVE] })],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/7' }
      return V('PASS')
    })
  const order = buildOnly(calls.map((c) => c.label.replace(/:.*/, '')))
  ok(order.filter((l) => l === 'gate').length === 1 && order[order.length - 1] === 'gate', 'one gate dispatch, running last')
  const gate = calls.find((c) => c.label.startsWith('gate:'))
  ok(/Gate command: \*\*APPLIES\*\*/.test(gate.prompt) && /npm run smoke/.test(gate.prompt), 'the gate applies and carries its command')
  ok(/modules\/native-bridge/.test(gate.prompt), 'it names the path that triggered it')
  ok(/rebuild the vendored native artifacts/.test(gate.prompt), 'the gate note is carried into the dispatch')
  ok(!('timeoutMin' in gate.opts), 'a repo without a longer floor uses the default timeout')
  const impl = calls.find((c) => c.label.startsWith('impl:'))
  ok(/do NOT run `gh pr create`/i.test(impl.prompt), 'the implementer is told not to create the PR')
  ok(/do NOT run the repo gate \(`npm run smoke`\)/i.test(impl.prompt), 'the implementer is told not to run the gate itself')
}
{
  const { calls } = await run('N · conditional gate, no matching path → PR only, gate skipped',
    [appTask({ files: [UI] })],
    (label) => {
      if (label.startsWith('impl:')) return { ...IMPL_OK, filesChanged: ['app/(tabs)/profile.tsx'] }
      if (label.startsWith('gate:')) return { status: 'DONE', summary: 'pr', prUrl: 'https://github.com/x/y/pull/8' }
      return V('PASS')
    })
  const gate = calls.find((c) => c.label.startsWith('gate:'))
  ok(!!gate, 'PR creation still goes through the gate dispatch')
  ok(/Gate command: \*\*does NOT apply\*\*/.test(gate.prompt), 'the gate command does not apply')
  ok(!/Run it ONCE, in the FOREGROUND/.test(gate.prompt), 'it is NOT instructed to run the gate command')
  ok(/Do \*\*NOT\*\* run it\./.test(gate.prompt), 'it is explicitly told not to run it')
  ok(/touches NO path matching `native\/`, `modules\/native-bridge\/`/.test(gate.prompt), 'the dispatch is told why the gate does not apply')
  ok(/gh pr create/.test(gate.prompt), 'it still opens the PR')
}
{
  // The last task is pure UI; an EARLIER task in the run touched a matching path. Deciding from
  // any single task's own files would miss this and the repo's hook would block the PR.
  const { calls } = await run('O · a matching path touched by an EARLIER task still triggers the gate',
    [appTask({ id: 'PROJ-910', ticket: 'PROJ-910', order: 1, files: [NATIVE] }),
     appTask({ id: 'PROJ-911', ticket: 'PROJ-911', order: 2, files: [UI], dependsOn: ['PROJ-910'] })],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'p' }
      return V('PASS')
    })
  const gate = calls.find((c) => c.label.startsWith('gate:'))
  ok(/Gate command: \*\*APPLIES\*\*/.test(gate.prompt), 'the run-level accumulation caught the earlier task')
  ok(calls.filter((c) => c.label.startsWith('gate:')).length === 1, 'the gate fires once, only when the whole project has drained')
  const gateIdx = calls.findIndex((c) => c.label.startsWith('gate:'))
  const lastImplIdx = calls.map((c) => c.label).lastIndexOf('impl:PROJ-911')
  ok(gateIdx > lastImplIdx, 'the gate ran after the LAST task, not between tasks')
}
{
  // Planned files say UI; the implementer actually wrote a matching file. filesChanged is
  // ground truth and must win over the plan.
  const { calls } = await run('P · a matching path revealed only by filesChanged triggers the gate',
    [appTask({ files: [UI] })],
    (label) => {
      if (label.startsWith('impl:')) return { ...IMPL_OK, filesChanged: ['app/x.tsx', 'native/src/lib.rs'] }
      if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'p' }
      return V('PASS')
    })
  const gate = calls.find((c) => c.label.startsWith('gate:'))
  ok(/Gate command: \*\*APPLIES\*\*/.test(gate.prompt), 'filesChanged overrode the plan-time guess')
  ok(/`native\/src\/lib\.rs`/.test(gate.prompt), 'and the matching path is named in the dispatch')
}
{
  // A review fix pulls in a matching file the task never planned.
  let n = 0
  const { calls } = await run('Q · a matching path introduced by a review FIX triggers the gate',
    [appTask({ files: [UI] })],
    (label) => {
      if (label.startsWith('impl:')) return { ...IMPL_OK, filesChanged: ['app/x.tsx'] }
      if (label.startsWith('fix:')) return { ...FIX_OK, filesChanged: ['modules/native-bridge/src/index.ts'] }
      if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'p' }
      if (label.startsWith('break-it')) { n++; return n === 1 ? V('FAIL', [{ severity: 'blocker', file: 'a', line: 1, issue: 'go through the native client' }]) : V('PASS') }
      return V('PASS')
    })
  const gate = calls.find((c) => c.label.startsWith('gate:'))
  ok(/Gate command: \*\*APPLIES\*\*/.test(gate.prompt), "the fix's filesChanged fed the gate decision")
}
{
  const { result, calls } = await run('S · a failed conditional gate is not reported done',
    [appTask({ files: [NATIVE] })],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return { status: 'BLOCKED', summary: 'no simulator available' }
      if (label.startsWith('replan')) return { decision: 'HALT', reason: 'no simulator', learnings: [] }
      return V('PASS')
    })
  ok(result.needsAttention.length === 1 && result.needsAttention[0].status === 'GATE_FAILED', 'reported GATE_FAILED')
  ok(result.prs.length === 0, 'no PR reported')
  ok(calls.filter((c) => c.label.startsWith('gate:')).length === 1, 'the failing gate was not re-dispatched on the same tree')
}

// ══════════════ Y · CONTINUOUS DISPATCH — no wave barrier ══════════════
// A wave barrier would mean nothing in wave N+1 starts until everything in wave N returns, so
// a slow task in one repo idles ready dependents everywhere else. Now a task dispatches the
// moment its own dependsOn have landed. This scenario would DEADLOCK under a barrier (B1 only
// resolves once A2's implementer has been dispatched), so a watchdog turns a regression into a
// FAIL instead of a hang.
{
  const A1 = appTask({ id: 'PROJ-940', ticket: 'PROJ-940', files: ['app/a.tsx — x'] })
  const A2 = appTask({ id: 'PROJ-941', ticket: 'PROJ-941', files: ['app/b.tsx — y'], dependsOn: ['PROJ-940'] })
  const B1 = { ...BE_TASK, id: 'PROJ-942', ticket: 'PROJ-942' }
  let releaseB1 = null
  let b1Done = false
  let a2WhileB1InFlight = false
  const watchdog = setTimeout(() => {
    console.log('   ✗ FAIL: Y1 deadlocked — the scheduler is barrier-waiting on B1 instead of dispatching the unblocked A2')
    process.exit(1)
  }, 5000)
  const { result, calls } = await run('Y1 · an unblocked task starts while another repo is still mid-flight',
    [A1, A2, B1],
    (label) => {
      if (label === 'impl:PROJ-942') return new Promise((res) => { releaseB1 = () => { b1Done = true; res(IMPL_OK) } })
      if (label === 'impl:PROJ-941') {
        a2WhileB1InFlight = !b1Done // the whole point: A2 starts BEFORE B1 has returned
        if (releaseB1) releaseB1()
        return IMPL_OK
      }
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  clearTimeout(watchdog)
  ok(a2WhileB1InFlight, 'A2 (unblocked by A1) was dispatched while B1 was still in flight — no wave barrier')
  const labels = calls.map((c) => c.label)
  ok(labels.indexOf('impl:PROJ-941') > labels.indexOf('impl:PROJ-940'), 'A2 still waited for its OWN dependency A1')
  ok(result.done.length === 3 && result.prs.length === 2 && !result.halt, 'everything landed and both repos gated at the end')
}

// ══════════════ Z · terminal slots fire only at PROJECT END ══════════════
{
  const BE1 = { ...BE_TASK, id: 'PROJ-930', ticket: 'PROJ-930' }
  const BE2 = { ...BE_TASK, id: 'PROJ-931', ticket: 'PROJ-931', slice: 2, dependsOn: ['PROJ-930'] }
  const { result, calls, logs } = await run('Z1 · one repo drains early, its gate still waits for the whole project',
    [APP_TASK, BE1, BE2],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  const labels = calls.map((c) => c.label)
  const lastImpl = labels.lastIndexOf('impl:PROJ-931')
  ok(lastImpl >= 0, 'the dependent backend task ran (cycle 2)')
  ok(labels.findIndex((l) => l === 'gate:mobile') > lastImpl, 'the mobile gate waited for the LAST task of the whole project, not just its own queue')
  ok(labels.findIndex((l) => l.includes(':mobile:final')) > lastImpl, 'the mobile terminal sweep also waited for the full drain')
  ok(labels.filter((l) => l === 'gate:mobile').length === 1 && labels.filter((l) => l === 'gate:api').length === 1,
    'exactly ONE gate per repo — each gate command paid once')
  ok(logs.some((l) => /terminal sweep → gate\+PR: /.test(l) && l.includes('mobile') && l.includes('api')),
    'both repos took the terminal wave TOGETHER (sweeps + gates in parallel)')
  ok(result.done.length === 3 && result.prs.length === 2 && result.ungatedRepos.length === 0, 'all landed, both PRs shipped, nothing ungated')
}
{
  // A repo fails and its dependent stays blocked → replan → HALT. The project never drained,
  // so NO gate is paid on a tree a resumed run would immediately staleness — the landed-but-
  // unshipped work is reported in ungatedRepos instead.
  const BE1 = { ...BE_TASK, id: 'PROJ-930', ticket: 'PROJ-930' }
  const BE2 = { ...BE_TASK, id: 'PROJ-931', ticket: 'PROJ-931', slice: 2, dependsOn: ['PROJ-930'] }
  const { result, calls } = await run('Z2 · a halt before the drain skips the gates, reports ungatedRepos',
    [APP_TASK, BE1, BE2],
    (label) => {
      if (label === 'impl:PROJ-930') return { status: 'BLOCKED', summary: 'schema migration needs a human' }
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('replan')) return { decision: 'HALT', reason: 'migration needs a human', learnings: [] }
      return V('PASS')
    })
  ok(!calls.some((c) => c.label.startsWith('gate:')), 'no gate was paid — the project never drained')
  ok(!calls.some((c) => c.label.includes(':final')), 'no terminal sweep ran either')
  ok(result.done.length === 1 && result.done[0].id === 'PROJ-900', 'the mobile work itself still landed (reviewed, on the run branch)')
  ok(result.ungatedRepos.length === 1 && result.ungatedRepos[0] === 'mobile', 'the landed-but-ungated repo is reported in ungatedRepos')
  ok(result.prs.length === 0, 'no PR from an ungated repo')
  ok(result.halt && /migration needs a human/.test(result.halt.reason), 'the halt reason is carried through')
}

// ══════════════ X · within-repo parallel LANES (disjoint-file scheduling) ══════════════
// dependsOn decides what is READY; declared files decide what may run TOGETHER in one
// repo. Disjoint → worktree lanes + serialized integration into the run branch; overlap
// or an undeclared footprint → held to the next cycle (strict serialization, no lanes).
const laneTask = (id, files) => appTask({ id, ticket: id, files })

{
  const { result, calls } = await run('X1 · disjoint files → one cycle, worktree lanes, serialized integration',
    [laneTask('PROJ-920', ['app/a.tsx — add row']), laneTask('PROJ-921', ['app/b.tsx — add banner'])],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('integrate:')) return { status: 'MERGED', headSha: 'ddddddd' }
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  const labels = calls.map((c) => c.label)
  ok(labels.indexOf('impl:PROJ-921') >= 0 && labels.indexOf('impl:PROJ-921') < labels.findIndex((l) => l.startsWith('spec-hawk')),
    'both implementers dispatched in the SAME cycle (the second before any reviewer of the first)')
  ok(calls.filter((c) => c.label.startsWith('hydrate:')).length === 1, 'one hydration covered the whole lane cycle')
  ok(calls.filter((c) => c.label.startsWith('integrate:')).length === 2, 'each lane got its own integrate dispatch')
  const impl = calls.find((c) => c.label === 'impl:PROJ-920')
  ok(/PARALLEL LANE/.test(impl.prompt), 'lane implementers are briefed for worktree isolation')
  ok(/\.worktrees\/mobile--proj-920/.test(impl.prompt), 'the brief names the lane worktree path')
  ok(/-b feat\/x--proj-920/.test(impl.prompt), 'the lane branch derives from the run branch')
  const integ = calls.find((c) => c.label === 'integrate:PROJ-920')
  ok(/merge --no-ff feat\/x--proj-920/.test(integ.prompt) && /checkout feat\/x\b/.test(integ.prompt), 'integration merges the lane into the run branch')
  const gate = calls.find((c) => c.label.startsWith('gate:'))
  ok(/branch feat\/x /.test(gate.prompt), 'the gate is briefed on the RUN branch, not a lane')
  ok(result.done.length === 2 && result.prs.length === 1, 'both landed; still ONE PR per repo')
}
{
  const { calls, logs } = await run('X2 · overlapping file → held to the next cycle, no lanes',
    [laneTask('PROJ-920', ['app/a.tsx — add row']), laneTask('PROJ-921', ['app/a.tsx — restyle row'])],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  const labels = calls.map((c) => c.label)
  ok(labels.indexOf('impl:PROJ-921') > labels.findIndex((l) => l.startsWith('spec-hawk:PROJ-920')),
    'the overlapping task waited for the first to land')
  ok(!calls.some((c) => c.label.startsWith('integrate:')), 'serialized tasks stay in direct mode — no integration step')
  ok(!/PARALLEL LANE/.test(calls.find((c) => c.label === 'impl:PROJ-921').prompt), 'no worktree brief in direct mode')
  ok(logs.some((l) => /held — file overlap/.test(l)), 'the hold is logged with its reason')
}
{
  const { calls } = await run('X3 · an undeclared footprint never shares a cycle',
    [laneTask('PROJ-920', ['app/a.tsx — add row']), laneTask('PROJ-921', [])],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      return V('PASS')
    })
  const labels = calls.map((c) => c.label)
  ok(labels.indexOf('impl:PROJ-921') > labels.findIndex((l) => l.startsWith('spec-hawk:PROJ-920')),
    'a task with no declared files is held — unknown footprint cannot prove disjointness')
  ok(!calls.some((c) => c.label.startsWith('integrate:')), 'and both run in direct mode')
}
{
  const { result, calls } = await run('X4 · integration CONFLICT fails the task and reaches the replanner',
    [laneTask('PROJ-920', ['app/a.tsx — add row']), laneTask('PROJ-921', ['app/b.tsx — add banner'])],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label === 'integrate:PROJ-920') return { status: 'MERGED', headSha: 'ddddddd' }
      if (label === 'integrate:PROJ-921') return { status: 'CONFLICT', detail: 'app/shared/theme.ts' }
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('replan')) return { decision: 'HALT', reason: 'conflicted lane needs a human', learnings: [] }
      return V('PASS')
    })
  ok(result.done.length === 1 && result.done[0].id === 'PROJ-920', 'the merged lane landed')
  ok(result.needsAttention.some((r) => r.id === 'PROJ-921' && r.status === 'MERGE_CONFLICT'), 'the conflicted lane is MERGE_CONFLICT, never done')
  const replan = calls.find((c) => c.label === 'replan#1')
  ok(/did NOT merge into the repo run branch/.test(replan.prompt) && /app\/shared\/theme\.ts/.test(replan.prompt),
    'the replan brief carries the conflict and its paths')
}

// ══════════════ RP · required inputs ══════════════
{
  const { result, calls } = await run('RP1 · no repos config → refused, nothing dispatched', [APP_TASK],
    (label) => { throw new Error(`should not dispatch: ${label}`) }, { extraArgs: { repos: undefined } })
  ok(result.error === 'missing_pipeline_inputs', 'refused with missing_pipeline_inputs')
  ok(result.missing.some((m) => m.startsWith('repos')), 'and it names repos as the missing input')
  ok(calls.length === 0, 'not a single agent ran')
}
{
  const { result, calls } = await run('RP2 · no specPath → refused before the index', [APP_TASK],
    (label) => { throw new Error(`should not dispatch: ${label}`) }, { extraArgs: { specPath: undefined } })
  ok(result.error === 'missing_pipeline_inputs' && result.missing.some((m) => m.startsWith('specPath')), 'the design artifacts stay required')
  ok(calls.length === 0, 'nothing dispatched')
}

// ══════════════ HK · the required-hook gate ══════════════
// OFF by default. When configured, the index agent probes the session every dispatched agent
// will inherit, and a failed check must stop an EXECUTE run cold.
{
  const HOOK = { name: 'rtk hook claude', check: 'command -v rtk && rtk hook check "git status"', fix: 'brew install rtk-ai/tap/rtk && rtk init -g, then restart the session' }
  const PROBLEMS = ['rtk: not installed — brew install rtk-ai/tap/rtk && rtk init -g', 'rtk: PreToolUse hook not registered — run `rtk init -g` and restart the session']
  const implOrReview = (label) => {
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('gate:')) return GATE_OK
    return V('PASS')
  }
  const PROBE_RE = /## Also VERIFY the required hook/
  {
    const { result, calls, logs } = await run('HK1 · execute + configured hook + problems → REFUSED, nothing dispatched', [APP_TASK],
      implOrReview, { indexExtra: { hookProblems: PROBLEMS }, extraArgs: { requireHook: HOOK } })
    ok(result.error === 'required_hook_missing', 'refused with required_hook_missing')
    ok(JSON.stringify(result.problems) === JSON.stringify(PROBLEMS), 'the problems list is returned verbatim, in order')
    ok(calls.length === 1 && calls[0].label === 'parse-index', 'exactly one agent ran (the index) — no implementer, reviewer, or gate')
    ok(PROBE_RE.test(calls[0].prompt) && /rtk hook check/.test(calls[0].prompt) && /rtk hook claude/.test(calls[0].prompt),
      'the execute-mode index prompt asked for both probes (installed · hook registered), using the configured strings')
    ok(/restart the session/.test(result.note) && /skipHookCheck/.test(result.note), 'the note tells the operator how to fix and names the escape hatch')
    ok(logs.some((l) => l.startsWith('⛔ not started — required hook missing')), 'the refusal is logged')
  }
  {
    const { result, calls, logs } = await run('HK2 · no requireHook (the default) → never probes, never refuses', [APP_TASK],
      implOrReview, { indexExtra: { hookProblems: PROBLEMS } })
    ok(result.error === undefined && result.done.length === 1, 'an unconfigured hook gate never refuses, even if the indexer reported problems')
    ok(!PROBE_RE.test(calls[0].prompt) && /this run does not probe for a required hook/.test(calls[0].prompt),
      'the index prompt does not ask for any probe')
    ok(!logs.some((l) => /required hook/.test(l)), 'and nothing about a hook is logged')
  }
  {
    const { result, calls, logs } = await run('HK3 · preview → never probes, never refuses', [APP_TASK],
      implOrReview, { execute: false, indexExtra: { hookProblems: PROBLEMS }, extraArgs: { requireHook: HOOK } })
    ok(result.preview === true && result.error === undefined, 'a preview is never refused on the hook gate')
    ok(calls.length === 1 && !PROBE_RE.test(calls[0].prompt), 'the preview index prompt does not pay for a check it cannot act on')
    ok(!logs.some((l) => /required hook/.test(l)), 'and nothing about a hook is logged')
  }
  {
    const { result, calls, logs } = await run('HK4 · execute + {skipHookCheck:true} → no probe, runs, loudly', [APP_TASK],
      implOrReview, { indexExtra: { hookProblems: PROBLEMS }, extraArgs: { requireHook: HOOK, skipHookCheck: true } })
    ok(result.error === undefined && result.done.length === 1 && result.done[0].status === 'DONE', 'the escape hatch lets the run proceed and land')
    ok(!PROBE_RE.test(calls[0].prompt), 'the override skips the probe entirely')
    ok(calls.some((c) => c.label === 'impl:PROJ-900'), 'the implementer was dispatched')
    ok(logs.some((l) => l === '⚠ skipHookCheck=true — rtk hook claude NOT verified, running unverified on purpose'), 'and the override is logged loudly')
  }
  {
    const { result, logs } = await run('HK5 · execute + empty hookProblems → runs normally', [APP_TASK],
      implOrReview, { indexExtra: { hookProblems: [] }, extraArgs: { requireHook: HOOK } })
    ok(result.error === undefined && result.done.length === 1, 'an all-green probe does not gate')
    ok(logs.some((l) => l === '✓ required hook verified — rtk hook claude installed and registered'), 'the green state is logged')
  }
  {
    const { result } = await run('HK6 · an indexer that omits the field is treated as green', [APP_TASK], implOrReview,
      { extraArgs: { requireHook: HOOK } })
    ok(result.error === undefined && result.done.length === 1, 'missing hookProblems does not refuse — only named failures do')
  }
}

// ══════════════ L · the harness LEARNS across runs ══════════════
{
  const CTX = {
    harnessMemory: 'Harness fact one.',
    agentMemory: { 'app-engineer': 'App engineers always run the linter before DONE (2026-09-01).', reviewer: 'Reviewers re-check prior Fixed dispositions at HEAD.' },
    priorLearnings: ['Scheduled sweeps were replaced by per-row TTL; never add a sweeper task.'],
    priorLedgers: ['runs/2026-09-10-PROJ-600.json'],
  }
  const LEDGER = { path: 'runs/2026-09-17-PROJ-600.json', branch: 'harness/run-2026-09-17-PROJ-600' }
  const CRY = { reports: ['docs/crystallize/2026-09-17-mobile-pr1.md'], skillsCreated: [], skillsPatched: ['styling'], memoryEntriesAdded: 1, docsSynced: [], prUrl: 'https://github.com/x/orchestrator/pull/99', summary: 'patched styling from a reviewer finding' }
  const learner = (label) => {
    if (label === 'harness-context') return CTX
    if (label === 'ledger') return LEDGER
    if (label === 'crystallize') return CRY
    if (label.startsWith('impl:')) return IMPL_OK
    if (label.startsWith('gate:')) return GATE_OK
    return V('PASS')
  }
  {
    const { result, calls } = await run('L1 · execute run loads harness context once, right after the index, and pastes agent memory into briefs', [APP_TASK], learner)
    const labels = calls.map((c) => c.label)
    ok(labels.filter((l) => l === 'harness-context').length === 1, 'exactly one harness-context loader dispatch')
    ok(labels.indexOf('harness-context') === 1 && labels[0] === 'parse-index', 'the loader runs right after the slice index, before any hydration/implementer')
    const loader = calls.find((c) => c.label === 'harness-context')
    ok(loader.opts.model === 'haiku' && /\.claude\/memory\/harness\.md/.test(loader.prompt) && /runs\/\*\.json/.test(loader.prompt), 'the loader is cheap and reads the memory stores + the run ledgers')
    ok(/backend-engineer, app-engineer, infra-engineer, reviewer/.test(loader.prompt), 'the agent list is derived from the configured repos, plus the reviewer')
    const impl = calls.find((c) => c.label === 'impl:PROJ-900')
    ok(impl.prompt.startsWith('## Your memory') && impl.prompt.includes('App engineers always run the linter before DONE (2026-09-01).'), "the implementer brief opens with ITS agent's memory entries, verbatim")
    ok(!impl.prompt.includes('Reviewers re-check prior Fixed dispositions'), "the implementer does not get the reviewer's memory")
    const review = calls.find((c) => c.opts.agentType === 'reviewer')
    ok(review && review.prompt.includes('Reviewers re-check prior Fixed dispositions at HEAD.'), 'reviewer briefs carry the reviewer memory')
    const gate = calls.find((c) => c.label.startsWith('gate:'))
    ok(gate && /## Your memory/.test(gate.prompt), 'the gate brief carries a memory block too')
    const hyd = calls.find((c) => c.label.startsWith('hydrate:'))
    ok(hyd && hyd.prompt.includes('Scheduled sweeps were replaced by per-row TTL; never add a sweeper task.'), 'prior-run learnings from the ledgers reach hydration')
    ok(hyd.prompt.startsWith('## Harness memory') && hyd.prompt.includes('Harness fact one.'), 'hydration opens with the HARNESS memory (orchestrator-level facts)')
    ok(!impl.prompt.includes('Harness fact one.'), 'repo agents get their own store, not the harness store')
    ok(result.harness && result.harness.ledger.path === LEDGER.path && result.harness.crystallize.prUrl === CRY.prUrl, 'the summary reports the ledger and the crystallize PR')
  }
  {
    const { calls } = await run('L2 · after the PR, the ledger is written and crystallize runs — the last two dispatches', [APP_TASK], learner)
    const labels = calls.map((c) => c.label)
    ok(labels[labels.length - 2] === 'ledger' && labels[labels.length - 1] === 'crystallize', 'ledger then crystallize, after the gate/PR')
    const ledger = calls.find((c) => c.label === 'ledger')
    ok(ledger.opts.model === 'haiku' && /"project": "PROJ-600"/.test(ledger.prompt) && /"prs"/.test(ledger.prompt) && /harness\/run-/.test(ledger.prompt), 'the ledger writer gets the full JSON payload and the harness branch name')
    ok(!/"harnessMemory"/.test(ledger.prompt), 'the ledger does not re-embed the memory stores')
    const cry = calls.find((c) => c.label === 'crystallize')
    ok(cry.opts.model === 'opus' && cry.prompt.includes(GATE_OK.prUrl) && cry.prompt.includes(LEDGER.path) && cry.prompt.includes(LEDGER.branch), 'crystallize is briefed with the PR, the ledger path and its branch')
    ok(/Read `workflows\/briefs\/crystallize\.md`/.test(cry.prompt), 'crystallize is pointed at its brief')
    const cryBrief = readFileSync(`${DIR}/briefs/crystallize.md`, 'utf8')
    ok(/Invoke the `crystallize` skill/.test(cryBrief) && /NEVER touch hook scripts, settings files/.test(cryBrief), 'the crystallize brief invokes the skill and forbids hooks/settings/invariants')
  }
  {
    const { result, calls } = await run('L3 · no PR this run (gate BLOCKED) → ledger still written, crystallize skipped', [BE_TASK],
      (label) => {
        if (label === 'harness-context') return CTX
        if (label === 'ledger') return LEDGER
        if (label.startsWith('impl:')) return IMPL_OK
        if (label.startsWith('gate:')) return { status: 'BLOCKED', summary: 'gate red' }
        return V('PASS')
      })
    const labels = calls.map((c) => c.label)
    ok(labels.includes('ledger'), 'a run without a PR still leaves a ledger (the halted run is the informative one)')
    ok(!labels.includes('crystallize'), 'crystallize needs PR review threads — not dispatched without a PR')
    ok(result.harness && result.harness.ledger.path === LEDGER.path && result.harness.crystallize === null, 'the summary says ledger-only')
  }
  {
    const { result, calls } = await run('L4 · loader/ledger/crystallize deaths degrade, never fail the run', [APP_TASK],
      (label) => {
        if (label === 'harness-context' || label === 'ledger' || label === 'crystallize') return null
        if (label.startsWith('impl:')) return IMPL_OK
        if (label.startsWith('gate:')) return GATE_OK
        return V('PASS')
      })
    const impl = calls.find((c) => c.label === 'impl:PROJ-900')
    ok(impl.prompt.startsWith('## Your memory') && impl.prompt.includes('(no entries yet)'), 'a dead loader → empty memory block, the brief still tells the agent where its memory lives')
    ok(result.done.length === 1 && result.harness === null, 'the build result is intact; harness is null when no ledger was written')
    ok(!calls.some((c) => c.label === 'crystallize'), 'no ledger → no crystallize (it needs the ledger branch)')
  }
  {
    const { calls } = await run('L5 · preview dispatches none of the learning agents', [APP_TASK], learner, { execute: false })
    ok(!calls.some((c) => LEARNING.has(c.label)), 'preview: no loader, no ledger, no crystallize')
  }
  {
    const { calls } = await run('L6 · the memory/runs/brief directories are configurable', [APP_TASK], learner,
      { extraArgs: { memoryDir: '.claude/skills/orchestrate-loop/memory', runsDir: 'var/runs', briefsDir: '.claude/skills/orchestrate-loop/briefs', personasDir: '.claude/skills/orchestrate-loop/personas' } })
    const loader = calls.find((c) => c.label === 'harness-context')
    ok(/\.claude\/skills\/orchestrate-loop\/memory\/harness\.md/.test(loader.prompt) && /var\/runs\/\*\.json/.test(loader.prompt), 'the loader reads the overridden memory and runs directories')
    const impl = calls.find((c) => c.label === 'impl:PROJ-900')
    ok(/Read `\.claude\/skills\/orchestrate-loop\/briefs\/implement\.md`/.test(impl.prompt), 'dispatches point at the overridden briefs directory')
    const review = calls.find((c) => c.label.startsWith('break-it'))
    ok(/\.claude\/skills\/orchestrate-loop\/personas\/break-it\.md/.test(review.prompt), 'and reviewers at the overridden personas directory')
  }
}

// ══════════════ MD · prose lives in Markdown — every brief/persona a dispatch points at exists ══════════════
{
  const { calls } = await run('MD · briefs and personas referenced by dispatches exist on disk', [APP_TASK, BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      if (label.startsWith('spec-hawk')) return V('FAIL', [{ severity: 'major', file: 'a.ts', line: 1, issue: 'x' }])
      if (label.startsWith('fix:')) return FIX_OK
      return V('PASS')
    })
  const refs = new Set()
  for (const c of calls) for (const m of c.prompt.matchAll(/`workflows\/(briefs|personas)\/([a-z0-9-]+)\.md`/g)) refs.add(`${m[1]}/${m[2]}`)
  ok(refs.size >= 6, `dispatches reference Markdown briefs/personas (${refs.size} distinct)`)
  const missing = [...refs].filter((r) => !existsSync(`${DIR}/${r}.md`))
  ok(missing.length === 0, `every referenced file exists${missing.length ? ' — MISSING: ' + missing.join(', ') : ''}`)
  const withBrief = calls.filter((c) => !['parse-index', 'harness-context', 'ledger', 'crystallize', 'contract-check'].includes(c.label) && !c.label.startsWith('hydrate:'))
  ok(withBrief.every((c) => /## Brief\nYour FIRST action: Read `workflows\/briefs\//.test(c.prompt)), 'every implementer/reviewer/guard/gate/fix dispatch opens with its brief pointer')
  const src = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8')
  const personaIds = [...src.matchAll(/\{ id: '([a-z-]+)', name: '/g)].map((m) => m[1])
  ok(personaIds.length === 8 && personaIds.every((id) => existsSync(`${DIR}/personas/${id}.md`)), 'every REVIEW_PANEL persona has its lens file')
  const panelBlock = src.split('const REVIEW_PANEL')[1].split('// ═══')[0]
  ok(!/focus:/.test(panelBlock) && !/lens/i.test(panelBlock), 'the panel table carries structure only — no lens prose in the JS')
  ok(/^export const meta = \{\n {2}name: 'orchestrate-loop',/m.test(readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8')), "the meta literal still names the workflow 'orchestrate-loop'")
}

// ══════════════ AG · nothing product-specific survived the port ══════════════
{
  const files = ['orchestrate-loop.js', 'README.md', 'briefs/README.md', 'briefs/index.md', 'briefs/hydrate.md', 'briefs/implement.md',
    'briefs/resolve.md', 'briefs/review.md', 'briefs/guard.md', 'briefs/integrate.md', 'briefs/gate.md', 'briefs/replan.md',
    'briefs/ledger.md', 'briefs/crystallize.md', 'personas/README.md', 'personas/spec-hawk.md', 'personas/break-it.md',
    'personas/data-integrity.md', 'personas/reliability-sre.md', 'personas/hig.md', 'personas/accessibility.md',
    'personas/privacy.md', 'personas/app-store.md']
  // Product, vendor and stack names that must not reappear when someone edits the prose.
  const BANNED = /\b(odyyy|linear mcp|claude\.md|redpanda|dynamodb|redisearch|drizzle|expo|nativewind|terragrunt|sentry|codex|laurent|e2e-green|smoke:android|smoke:ios)\b/i
  const offenders = files.filter((f) => BANNED.test(readFileSync(`${DIR}/${f}`, 'utf8')))
  ok(offenders.length === 0, `no product/vendor names in the shipped prose${offenders.length ? ' — found in: ' + offenders.join(', ') : ''}`)
  const engine = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8')
  ok(!/AGENT_FOR_REPO|GATED_REPOS|APP_NATIVE_PATHS|BACKEND_GATE_TIMEOUT/.test(engine), 'the hard-coded repo/agent/gate tables are gone')
}


// ══════════════ BB · baseBranch is configuration ══════════════
{
  const { calls } = await run('BB · a custom baseBranch reaches the lane, the range and the ledger', [BE_TASK],
    (label) => {
      if (label.startsWith('impl:')) return IMPL_OK
      if (label.startsWith('gate:')) return GATE_OK
      if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
      return V('PASS')
    }, { extraArgs: { baseBranch: 'origin/trunk' } })
  const impl = calls.find((c) => c.label.startsWith('impl:'))
  ok(impl && /origin\/trunk/.test(impl.prompt) && !/origin\/main/.test(impl.prompt), 'the implementer is told the configured base branch, never a hard-coded main')
  const ledger = calls.find((c) => c.label === 'ledger')
  ok(ledger && /Base branch: `origin\/trunk`/.test(ledger.prompt), 'the ledger writer is told which base branch to start from')
  const { calls: dflt } = await run('BB2 · default baseBranch is origin/main', [BE_TASK],
    (label) => (label.startsWith('impl:') ? IMPL_OK : label.startsWith('gate:') ? GATE_OK : V('PASS')))
  const impl2 = dflt.find((c) => c.label.startsWith('impl:'))
  ok(impl2 && /origin\/main/.test(impl2.prompt), 'without the arg, origin/main is the default')
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
