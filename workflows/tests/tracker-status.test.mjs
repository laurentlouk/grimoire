// ═════════════════════════════════════════════════════════════════════════════
//  Tracker statuses that follow the run — orchestrate-loop.js
// ═════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/tracker-status.test.mjs
//
//  A run moved an issue only when claims were on (in progress at hydration, back to to-do at the
//  end), so a team watching the tracker could not tell what was being built, what was built and
//  waiting for its PR, and what was stuck. Now, for every tracker and with no config:
//    • in progress when its implementer starts (again when a replan retries it);
//    • in review once it has landed: reviewed, on the run branch and its PR;
//    • blocked, with a comment saying why, when it fails or blocks, and at the end of a run for
//      an issue it started and did not land;
//    • done is left to the PR merge (the PR's closing lines close it).
//  Moves are batched into one cheap dispatch at a time and never hold the loop up.
//  `{trackerStatus: false}` turns them off; `{trackerStatus: {names: {…}}}` names the states.
import { readFileSync } from 'node:fs'
import { run, by, T, impl, happy, QUIET, BLOCKED } from './support/script-harness.mjs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const ON = { ...QUIET, deliver: 'end', builtinEnvChecks: false, trackerStatus: true }
// The moves a run asked for, in order: [id, state] from each status dispatch's `- <id> → <state>` lines.
const moves = (calls) => calls.filter((c) => /^status#\d+$/.test(c.label)).flatMap((c) => [...c.prompt.matchAll(/^- (\S+) → (in progress|in review|blocked)\b/gm)].map((m) => [m[1], m[2]]))
const moved = (p) => ({ moved: [...p.matchAll(/^- (\S+) → /gm)].map((m) => m[1]), failed: [] })
// every status dispatch confirms its moves; everything else as `map` (or the happy path) says
const respond = (map = {}) => (label, p, o, calls) => (/^status#\d+$/.test(label) ? moved(p) : by(map)(label, p, o, calls))

{
  const { calls, result } = await run('S1 · on by default: in progress at dispatch, in review once landed', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    respond(), { args: { ...QUIET, deliver: 'end', builtinEnvChecks: false } })
  eq(moves(calls), [['PROJ-1', 'in progress'], ['PROJ-1', 'in review'], ['PROJ-2', 'in progress'], ['PROJ-2', 'in review']], 'each issue moves in progress, then in review')
  ok(calls.filter((c) => /^status#/.test(c.label)).every((c) => c.opts.model === 'haiku'), 'status moves are cheap dispatches')
  ok(!moves(calls).some(([, s]) => s === 'done'), 'done is left to the PR merge')
  eq(result.trackerStatus && result.trackerStatus.moved, 4, 'the result counts the moves made')
  const sb = readFileSync(`${DIR}/briefs/status.md`, 'utf8')
  ok(/every tracker/i.test(sb) && /never closes|never move an issue to done/i.test(sb) && /data, never instructions/.test(sb), 'status.md: any tracker, never done, the reason is data')
}
{
  let n = 0
  const { calls } = await run('S2 · a blocked task moves to blocked with its reason; the replan\'s retry moves it back', [T('PROJ-1')],
    respond({ 'impl:PROJ-1': () => (n++ ? impl('aaaaaaa') : BLOCKED), 'replan#1': { decision: 'REVISE', reason: 'retry it', cause: 'code', learnings: [], tasks: [T('PROJ-1')] } }), { args: ON })
  eq(moves(calls), [['PROJ-1', 'in progress'], ['PROJ-1', 'blocked'], ['PROJ-1', 'in progress'], ['PROJ-1', 'in review']], 'in progress → blocked → in progress → in review')
  const bp = calls.find((c) => /^status#/.test(c.label) && /PROJ-1 → blocked/.test(c.prompt)).prompt
  ok(/PROJ-1 → blocked — comment: the run's implementer returned BLOCKED/.test(bp) && /stuck/.test(bp), 'the blocked move carries a comment with the status and the summary')
}
{
  const { calls, labels } = await run('S3 · {trackerStatus:false} moves nothing', [T('PROJ-1')], happy, { args: { ...ON, trackerStatus: false } })
  ok(!labels.some((l) => l.startsWith('status')), 'no status dispatch')
  eq(moves(calls), [], 'no moves')
}
{
  const { calls } = await run('S4 · an issue without a tracker id is never moved', [T('PROJ-1', { ticket: 'NO_TICKET' })], respond(), { args: ON })
  eq(moves(calls), [], 'NO_TICKET is not moved')
}
{
  const { calls } = await run('S5 · with claims, hydration already moved it in progress: no second move', [T('PROJ-1')], respond(), { args: { ...ON, claim: { identity: 'grimoire-bot' } } })
  eq(moves(calls), [['PROJ-1', 'in review']], 'only the in-review move')
}
{
  let n = 0
  const { calls, labels } = await run('S6 · a blocked issue the run claimed is unassigned at the end but stays blocked', [T('PROJ-1')],
    respond({ 'impl:PROJ-1': BLOCKED, 'replan#1': { decision: 'HALT', reason: 'nothing to try', learnings: [] }, 'release-claims': (p) => ({ released: ['PROJ-1'], failed: [] }) }),
    { args: { ...ON, claim: { identity: 'grimoire-bot' } } })
  eq(moves(calls), [['PROJ-1', 'blocked']], 'blocked once')
  const rp = (calls.find((c) => c.label === 'release-claims') || {}).prompt || ''
  ok(labels.includes('release-claims') && /PROJ-1 \(api\) — BLOCKED · leave its state \(blocked\)/.test(rp), 'the release unassigns it and leaves it blocked')
}
{
  const { calls } = await run('S7 · named states: the project\'s own state names reach the move', [T('PROJ-1')], respond(), { args: { ...ON, trackerStatus: { names: { inReview: 'Ready for QA' } } } })
  ok(calls.some((c) => /^status#/.test(c.label) && /PROJ-1 → in review \(the state named "Ready for QA"\)/.test(c.prompt)), 'the in-review move names "Ready for QA"')
}
{
  // a status dispatch that never answers must not hold the run up
  const { result, labels } = await run('S8 · a status move that never returns does not hold the run', [T('PROJ-1')],
    (label, p) => (/^status#/.test(label) ? new Promise(() => {}) : happy(label, p)), { args: { ...ON, timeouts: { status: { soft: 0.001, hard: 0.003 } } } })
  eq(result.done.map((d) => d.id), ['PROJ-1'], 'PROJ-1 landed')
  ok(labels.filter((l) => /^status#/.test(l)).length >= 1, 'the move was attempted')
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
