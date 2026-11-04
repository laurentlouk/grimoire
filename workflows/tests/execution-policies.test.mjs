// ════════════════════════════════════════════════════════════════════════════
//  Execution policies (0.16.0 – 0.18.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/execution-policies.test.mjs
//
//  docs/specs/2026-10-31-execution-policies-design.md, slices 1–4: a task runs under a
//  profile (fast · balanced · strict) resolved by a deterministic router, no model call.
//    • no policy asked for: every task runs balanced, exactly as before; the router's `auto`
//      pick is recorded only (the shadow record the benchmark reads)
//    • policy 'auto': hard floors (strictPaths, strictTags, the migration specialist, a
//      dependency on another repo's task) make a task STRICT; a docs-only or small, cheap-tier
//      footprint picks FAST
//    • FAST: spec-hawk ∥ break-it once, one consolidated fix, the guard once (+ repos[].check);
//      a failure escalates to STRICT on the same head (no second implementation), or fails
//    • history: a repo whose FAST tasks escalated often, a learning naming a task's file → raise
//    • STRICT: the implementer on opus, privacy / data-integrity promoted into the task's
//      quality stage by its declared files
//    • overrides: tracker label > repos[].policy > run policy; below a hard floor refused,
//      unless policies.allowBelowFloor
//    • hydration may propose a stricter policy, never a looser one
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget).
import { run, by, QUIET, API, T, V, impl, heredocs } from './support/script-harness.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)

const WEB = { name: 'web', path: 'repositories/web', agent: 'web-engineer', tags: ['web'], gate: null }
const ARGS = (extra = {}) => ({ ...QUIET, builtinEnvChecks: false, ...extra })
const S = (id, files, extra = {}) => T(id, { model: 'sonnet', files, ...extra })
const implModel = (calls, id) => (calls.find((c) => c.label === `impl:${id}`) || { opts: {} }).opts.model
const reviewersOf = (labels, id) => labels.filter((l) => l.endsWith(`:${id}`) && !/^(impl|fix|precheck|guard|verify|hydrate|integrate)/.test(l)).map((l) => l.split(':')[0]).sort()

// ── 1. No policy asked for: 0.15.1 behaviour, the auto pick journaled only ──
{
  const tasks = [S('PROJ-1', ['src/auth/login.ts — check the token']), S('PROJ-2', ['README.md — document it'])]
  const { result, calls, labels } = await run('no policy: every task balanced, auto recorded as shadow', tasks, by({}), { args: ARGS() })
  eq([result.policies.tasks['PROJ-1'].policy, result.policies.tasks['PROJ-2'].policy], ['balanced', 'balanced'], 'both tasks run balanced')
  eq([result.policies.tasks['PROJ-1'].auto, result.policies.tasks['PROJ-2'].auto], ['strict', 'fast'], 'the router still records what auto would pick (auth floor · docs-only)')
  eq(result.policies.tasks['PROJ-1'].source, 'default', 'the source says nothing was asked for')
  eq(implModel(calls, 'PROJ-1'), 'sonnet', "the selector's tier is kept (no STRICT opus floor)")
  eq(reviewersOf(labels, 'PROJ-1'), ['break-it', 'data-integrity', 'spec-hawk'], 'the per-task panel is the repo panel, no lens promoted')
  ok(result.policies.tasks['PROJ-1'].signals.some((s) => s.includes('src/auth/login.ts matches **/auth/**')), 'the floor signal names the file and the glob')
}

// ── 2. policy auto: STRICT by floor, with opus and a promoted lens ──
{
  const tasks = [S('PROJ-1', ['src/auth/login.ts — check the token']), S('PROJ-2', ['README.md — document it']), S('PROJ-3', ['src/a.ts — x', 'src/b.ts — y'])]
  const { result, calls, labels } = await run('auto: auth floor → STRICT (opus, privacy promoted); docs → fast pick', tasks, by({}), { args: ARGS({ policy: 'auto' }) })
  eq(result.policies.tasks['PROJ-1'].policy, 'strict', 'the auth task runs STRICT')
  eq(implModel(calls, 'PROJ-1'), 'opus', 'STRICT floors the implementer at opus')
  eq(reviewersOf(labels, 'PROJ-1'), ['break-it', 'data-integrity', 'privacy', 'spec-hawk'], 'privacy joins the per-task quality stage')
  eq(result.policies.tasks['PROJ-2'].auto, 'fast', 'a docs-only footprint picks FAST')
  eq(result.policies.tasks['PROJ-2'].policy, 'fast', '…and runs FAST')
  eq(result.policies.tasks['PROJ-3'].auto, 'fast', 'two declared files on sonnet, nothing raised: FAST')
  eq(reviewersOf(labels, 'PROJ-3'), ['break-it', 'spec-hawk'], 'a FAST task draws spec-hawk ∥ break-it only (no data-integrity, even on a backend repo)')
  ok(result.done.length === 3, 'all three land')
}

// ── 3. auto: the raises ──
{
  const tasks = [
    S('PROJ-1', []), // no declared files
    S('PROJ-2', ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']), // > fastMaxFiles
    T('PROJ-3', { model: 'opus', files: ['src/e.ts'] }), // the selector chose opus
    S('PROJ-4', ['src/f.ts']), // unlocks three tasks
    S('PROJ-5', ['src/g.ts'], { dependsOn: ['PROJ-4'] }),
    S('PROJ-6', ['src/h.ts'], { dependsOn: ['PROJ-5'] }),
    S('PROJ-7', ['src/i.ts'], { dependsOn: ['PROJ-6'] }),
  ]
  const { result } = await run('auto: raises to balanced', tasks, by({}), { args: ARGS({ policy: 'auto' }) })
  const p = (id) => result.policies.tasks[id]
  eq(['PROJ-1', 'PROJ-2', 'PROJ-3', 'PROJ-4'].map((id) => p(id).auto), ['balanced', 'balanced', 'balanced', 'balanced'], 'no files · 4 files · opus · fan-out 3 each raise to balanced')
  ok(p('PROJ-1').signals.includes('no declared files'), 'signal: no declared files')
  ok(p('PROJ-2').signals.includes('4 declared files > 3'), 'signal: file count')
  ok(p('PROJ-3').signals.includes('the selector chose opus'), 'signal: opus pick')
  ok(p('PROJ-4').signals.some((s) => s.startsWith('unlocks 3 downstream')), 'signal: fan-out')
  eq(p('PROJ-7').auto, 'fast', 'the end of the chain, small and on sonnet: FAST')
}

// ── 4. auto: floors from config, tags, the specialist, another repo ──
{
  const INFRA = { name: 'ops', path: 'repositories/ops', agent: 'ops-engineer', tags: ['infra'], gate: null }
  const tasks = [
    S('PROJ-1', ['src/a.ts']),
    S('PROJ-2', ['web/page.tsx'], { repo: 'web', agent: 'web-engineer', dependsOn: ['PROJ-1'] }),
    S('PROJ-3', ['main.yaml'], { repo: 'ops', agent: 'ops-engineer' }),
    S('PROJ-4', ['db/schema.sql'], { agent: 'migration-engineer' }),
  ]
  const { result, labels } = await run('auto: cross-repo, infra tag, migration specialist → STRICT', tasks, by({}), {
    args: ARGS({ policy: 'auto', repos: [API, WEB, INFRA], specialists: [{ agent: 'migration-engineer', repos: ['api'] }] }),
  })
  const p = (id) => result.policies.tasks[id]
  eq([p('PROJ-1').auto, p('PROJ-2').auto, p('PROJ-3').auto, p('PROJ-4').auto], ['fast', 'strict', 'strict', 'strict'], 'only the plain task stays below STRICT')
  ok(p('PROJ-2').signals.includes('depends on api:PROJ-1 in another repo'), 'signal: cross-repo dependency')
  ok(p('PROJ-3').signals.includes('repo tag infra'), 'signal: strictTags')
  ok(p('PROJ-4').signals.includes('routed to the migration specialist'), 'signal: migration specialist')
  ok(reviewersOf(labels, 'PROJ-2').includes('data-integrity'), 'a cross-repo dependency promotes data-integrity, even on a web repo')
  ok(reviewersOf(labels, 'PROJ-4').includes('data-integrity') && !reviewersOf(labels, 'PROJ-4').includes('privacy'), 'a .sql footprint promotes data-integrity, not privacy')
}

// ── 5. overrides: precedence, refusal below a floor, allowBelowFloor ──
{
  const WEBF = { ...WEB, policy: 'strict' }
  const tasks = [
    S('PROJ-1', ['src/auth/a.ts']), // run policy balanced: below the floor → refused
    S('PROJ-2', ['src/b.ts'], { labels: ['grimoire:policy/strict'] }), // label wins over the run policy
    S('PROJ-3', ['web/c.tsx'], { repo: 'web', agent: 'web-engineer' }), // repo policy strict
    S('PROJ-4', ['web/d.tsx'], { repo: 'web', agent: 'web-engineer', labels: ['grimoire:policy/balanced'] }), // label wins over repo
    S('PROJ-5', ['db/migrations/0001.sql'], { labels: ['grimoire:policy/fast'] }), // label below a floor → refused
  ]
  const { result, logs } = await run('overrides: label > repo > run; refused below a floor', tasks, by({}), { args: ARGS({ policy: 'balanced', repos: [API, WEBF] }) })
  const p = (id) => result.policies.tasks[id]
  eq([p('PROJ-1').policy, p('PROJ-1').refused, p('PROJ-1').source], ['strict', 'balanced', 'run'], 'run policy balanced on an auth file: refused, runs STRICT')
  eq([p('PROJ-2').policy, p('PROJ-2').source], ['strict', 'label'], 'the label overrides the run policy')
  eq([p('PROJ-3').policy, p('PROJ-3').source], ['strict', 'repo'], "the repo's policy overrides the run's")
  eq([p('PROJ-4').policy, p('PROJ-4').source], ['balanced', 'label'], "the label overrides the repo's policy")
  eq([p('PROJ-5').policy, p('PROJ-5').refused], ['strict', 'fast'], 'a fast label on a migration is refused')
  eq(result.policies.refused, 2, 'two refusals counted')
  ok(logs.some((l) => /PROJ-5: label policy fast refused — below the hard floor \(db\/migrations\/0001\.sql matches \*\*\/migrations\/\*\*\)/.test(l)), 'the refusal is logged with its signal')

  const r2 = await run('allowBelowFloor: the override is honoured, flagged', [S('PROJ-1', ['src/auth/a.ts'])], by({}), { args: ARGS({ policy: 'balanced', policies: { allowBelowFloor: true } }) })
  eq([r2.result.policies.tasks['PROJ-1'].policy, r2.result.policies.tasks['PROJ-1'].belowFloor, r2.result.policies.belowFloor], ['balanced', true, 1], 'balanced runs, counted below its floor')
  eq(implModel(r2.calls, 'PROJ-1'), 'sonnet', 'no opus floor when STRICT was overridden')
}

// ── 6. hydration proposes; config reshapes the rules ──
{
  const tasks = [S('PROJ-1', ['src/a.ts'], { policy: 'strict', policyReason: 'it moves money' }), S('PROJ-2', ['src/b.ts'], { policy: 'fast' })]
  const { result } = await run('hydration may raise, never lower', tasks, by({}), { args: ARGS({ policy: 'auto' }) })
  eq(result.policies.tasks['PROJ-1'].policy, 'strict', 'a proposed strict raises the pick')
  ok(result.policies.tasks['PROJ-1'].signals.includes('hydration proposed strict: it moves money'), 'with its reason as a signal')

  const d = await run('default policy ignores a proposal', [S('PROJ-1', ['src/a.ts'], { policy: 'strict' })], by({}), { args: ARGS() })
  eq([d.result.policies.tasks['PROJ-1'].policy, d.result.policies.tasks['PROJ-1'].auto], ['balanced', 'strict'], 'no policy asked: balanced runs, the proposal shows in auto')

  const c = await run('policies config: own globs, own limits', [S('PROJ-1', ['lib/core/x.ts']), S('PROJ-2', ['a.ts', 'b.ts'])], by({}), {
    args: ARGS({ policy: 'auto', policies: { strictPaths: ['lib/core/**'], fastMaxFiles: 1, strictTags: 'infra' } }),
  })
  eq([c.result.policies.tasks['PROJ-1'].auto, c.result.policies.tasks['PROJ-2'].auto], ['strict', 'balanced'], 'a custom floor glob and fastMaxFiles apply')
  ok(c.logs.some((l) => l.includes('policies.strictTags ignored')), 'a malformed key keeps its default, logged')

  const bad = await run('an unknown policy is ignored', [S('PROJ-1', ['src/a.ts'])], by({}), { args: ARGS({ policy: 'turbo' }) })
  eq(bad.result.policies.tasks['PROJ-1'].source, 'default', 'policy turbo is ignored: default')
  ok(bad.logs.some((l) => l.includes('policy "turbo" is not one of auto | fast | balanced | strict')), 'and logged')
}

// ── 7. the preview lists index-level floors ──
{
  const INFRA = { name: 'ops', path: 'repositories/ops', agent: 'ops-engineer', tags: ['infra'], gate: null }
  const tasks = [S('PROJ-1', ['src/a.ts']), S('PROJ-2', ['x'], { repo: 'web', agent: 'web-engineer', dependsOn: ['PROJ-1'] }), S('PROJ-3', ['y'], { repo: 'ops', agent: 'ops-engineer' })]
  const { result } = await run('preview: policy and index-level floors', tasks, by({}), { args: ARGS({ execute: false, policy: 'auto', repos: [API, WEB, INFRA] }) })
  eq(result.policies.policy, 'auto', 'the preview names the policy')
  eq(Object.keys(result.policies.strictAtIndex).sort(), ['PROJ-2', 'PROJ-3'], 'cross-repo and infra issues are STRICT before hydration')
  ok(Array.isArray(result.policies.rules.strictPaths), 'the routing rules in force are shown')
}

// ── 8. FAST: first-round PASS, no guard, no fix ──
const FINDING = (severity, file, issue) => ({ severity, file, line: 3, issue })
const VF = (...findings) => ({ verdict: 'FAIL', findings, summary: 'FAIL' })
const GUARD = (decision) => ({ decision, reason: decision === 'PASS' ? 'all findings addressed' : 'not addressed' })
const FIX = (head = 'bbbbbbb') => ({ status: 'DONE', summary: 'fixed', commits: [head], baseSha: '0000000', startSha: 'aaaaaaa', headSha: head, filesChanged: ['src/a.ts'] })
{
  const { result, labels } = await run('FAST: one round passes, lands', [S('PROJ-1', ['src/a.ts'])], by({}), { args: ARGS({ policy: 'fast' }) })
  eq(reviewersOf(labels, 'PROJ-1'), ['break-it', 'spec-hawk'], 'spec-hawk ∥ break-it, once')
  ok(!labels.some((l) => /^(fix|guard):/.test(l)), 'no fix, no guard')
  eq([result.done.length, result.policies.fast.passed], [1, 1], 'it lands, counted as a FAST pass')
}

// ── 9. FAST: both stages fail → ONE consolidated fix, spec first → the guard (with the check) → lands ──
{
  const { result, labels, prompt } = await run('FAST: one consolidated fix, guard PASS, lands', [S('PROJ-1', ['src/a.ts'])], by({
    'spec-hawk:PROJ-1': VF(FINDING('major', 'src/a.ts', 'misses the empty case the issue names')),
    'break-it:PROJ-1': VF(FINDING('blocker', 'src/a.ts', 'races on concurrent writes')),
    'fix:PROJ-1:fast#1': FIX(),
    'guard:PROJ-1:fast': GUARD('PASS'),
  }), { args: ARGS({ policy: 'fast', repos: [{ ...API, check: 'npm test -- --changed' }] }) })
  eq(labels.filter((l) => l.startsWith('fix:')), ['fix:PROJ-1:fast#1'], 'exactly one fix dispatch, for both stages')
  const fp = prompt('fix:PROJ-1:fast#1')
  ok(fp.indexOf('misses the empty case') >= 0 && fp.indexOf('misses the empty case') < fp.indexOf('races on concurrent writes'), 'the fix carries both findings, spec first')
  ok(prompt('guard:PROJ-1:fast').includes('npm test -- --changed'), "the guard runs the repo's check command")
  ok(!labels.some((l) => /#1$|~/.test(l) && /^(spec-hawk|break-it)/.test(l)), 'no panel re-review after the fix')
  eq([result.done.length, result.policies.fast.passed, result.policies.fast.escalated], [1, 1, 0], 'lands as a FAST pass')
}

// ── 10. FAST: the guard says RE_REVIEW → STRICT on the same head, never re-implemented ──
{
  const { result, labels, calls } = await run('FAST: guard RE_REVIEW escalates to STRICT in place', [S('PROJ-1', ['src/a.ts'])], by({
    'break-it:PROJ-1': VF(FINDING('blocker', 'src/a.ts', 'races on concurrent writes')),
    'fix:PROJ-1:fast#1': FIX(),
    'guard:PROJ-1:fast': GUARD('RE_REVIEW'),
  }), { args: ARGS({ policy: 'fast' }) })
  eq(labels.filter((l) => l.startsWith('impl:')), ['impl:PROJ-1'], 'one implementation, no second impl dispatch')
  ok(['spec-hawk:PROJ-1~strict', 'break-it:PROJ-1~strict', 'data-integrity:PROJ-1~strict'].every((l) => labels.includes(l)), "the strict panel (the repo's full core) reviews round 0 again")
  const strictReview = calls.find((c) => c.label === 'spec-hawk:PROJ-1~strict').prompt
  ok(strictReview.includes('0000000') && strictReview.includes('bbbbbbb'), 'it judges the whole task range, start to the fixed head')
  eq([result.done.length, result.policies.fast.escalated, result.policies.tasks['PROJ-1'].escalated], [1, 1, true], 'lands after escalation, counted')
}

// ── 11. FAST escalated: the fix round spent counts against STRICT's budget; the strict fix runs on opus ──
{
  const { result, labels, calls } = await run('FAST escalated: budget shared, opus', [S('PROJ-1', ['src/a.ts'])], by({
    'break-it:PROJ-1': VF(FINDING('blocker', 'src/a.ts', 'race')),
    'fix:PROJ-1:fast#1': FIX(),
    'guard:PROJ-1:fast': GUARD('RE_REVIEW'),
    'break-it:PROJ-1~strict': VF(FINDING('blocker', 'src/a.ts', 'still racy')),
    'fix:PROJ-1:quality#1': FIX('ccccccc'),
    'break-it:PROJ-1#1': V('PASS'),
    'guard:PROJ-1#1': GUARD('PASS'),
  }), { args: ARGS({ policy: 'fast', maxFixAttempts: 2 }) })
  eq(labels.filter((l) => l.startsWith('fix:')), ['fix:PROJ-1:fast#1', 'fix:PROJ-1:quality#1'], 'one strict fix left of a budget of 2')
  eq(calls.find((c) => c.label === 'fix:PROJ-1:quality#1').opts.model, 'opus', 'the strict fix runs on opus')
  eq(result.done.length, 1, 'lands')

  const r2 = await run('FAST escalated with maxFixAttempts 1: no strict fix left', [S('PROJ-1', ['src/a.ts'])], by({
    'break-it:PROJ-1': VF(FINDING('blocker', 'src/a.ts', 'race')),
    'fix:PROJ-1:fast#1': FIX(),
    'guard:PROJ-1:fast': GUARD('RE_REVIEW'),
    'break-it:PROJ-1~strict': VF(FINDING('blocker', 'src/a.ts', 'still racy')),
  }), { args: ARGS({ policy: 'fast', maxFixAttempts: 1, maxReplans: 0 }) })
  eq(r2.labels.filter((l) => l.startsWith('fix:')), ['fix:PROJ-1:fast#1'], 'the FAST fix used the only round')
  eq(r2.result.needsAttention.map((n) => n.status), ['QUALITY_FAILED'], 'the strict stage fails without buying another')
}

// ── 12. onFail 'fail': a FAST failure is booked, blocks only its dependents ──
{
  const tasks = [S('PROJ-1', ['src/a.ts']), S('PROJ-2', ['src/b.ts'], { dependsOn: ['PROJ-1'] }), S('PROJ-3', ['src/c.ts'])]
  const { result, labels } = await run("onFail 'fail': booked SPEC_FAILED, dependents wait, the rest lands", tasks, by({
    'spec-hawk:PROJ-1': VF(FINDING('major', 'src/a.ts', 'wrong field')),
    'fix:PROJ-1:fast#1': FIX(),
    'guard:PROJ-1:fast': GUARD('RE_REVIEW'),
  }), { args: ARGS({ policy: 'fast', maxReplans: 0, policies: { fast: { onFail: 'fail' } } }) })
  eq(result.needsAttention.map((n) => [n.id, n.status]), [['PROJ-1', 'SPEC_FAILED']], 'a spec finding gated: SPEC_FAILED')
  ok(!labels.some((l) => l.includes('~strict')), 'no escalation')
  eq(result.done.map((d) => d.id), ['PROJ-3'], 'the independent task lands')
  ok(result.blocked.some((b) => b.id === 'PROJ-2'), 'its dependent never ran')
  eq(result.policies.fast.failed, 1, 'counted as a FAST failure')
}

// ── 13. one DAG, three policies ──
{
  const tasks = [
    S('PROJ-1', ['docs/guide.md']),
    S('PROJ-2', ['src/auth/session.ts'], { dependsOn: ['PROJ-1'] }),
    S('PROJ-3', ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], { dependsOn: ['PROJ-2'] }),
  ]
  const { result, labels } = await run('mixed: fast → strict → balanced, in dependency order', tasks, by({}), { args: ARGS({ policy: 'auto' }) })
  eq(['PROJ-1', 'PROJ-2', 'PROJ-3'].map((id) => result.policies.tasks[id].policy), ['fast', 'strict', 'balanced'], 'three policies in one run')
  const at = (l) => labels.indexOf(l)
  ok(at('impl:PROJ-1') < at('impl:PROJ-2') && at('impl:PROJ-2') < at('impl:PROJ-3'), 'dependency order kept')
  eq(result.done.map((d) => d.id), ['PROJ-1', 'PROJ-2', 'PROJ-3'], 'all land')
  eq(result.policies.byPolicy, { fast: 1, strict: 1, balanced: 1 }, 'byPolicy counts each once')
}

// ── 14. a docs-only FAST pick that changed code runs balanced ──
{
  const { result, labels } = await run('docs-only pick, code changed: raised before review', [S('PROJ-1', ['README.md'])], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), filesChanged: ['README.md', 'src/server.ts'] },
  }), { args: ARGS({ policy: 'auto' }) })
  eq(result.policies.tasks['PROJ-1'].raisedAtPrecheck, ['src/server.ts'], 'the code file is named')
  ok(labels.includes('data-integrity:PROJ-1'), "it draws the repo's full quality core")

  const all = await run("reviewParallel 'all': the early FAST-panel rounds are discarded on the raise", [S('PROJ-1', ['README.md'])], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), filesChanged: ['README.md', 'src/server.ts'] },
    'precheck:PROJ-1': { verdict: 'PASS', problems: [], summary: 'ok' },
  }), { args: ARGS({ policy: 'auto', precheck: true, reviewParallel: 'all' }) })
  ok(all.labels.some((l) => /^data-integrity:PROJ-1~h\d$/.test(l)), 'the balanced panel reviews round 0 again, data-integrity included')
  eq(all.result.done.length, 1, 'and it lands')
}

// ── 15. resume mid-escalation: the checkpoint keeps the task STRICT ──
{
  const { result, calls } = await run('resume: an escalated task stays STRICT', [S('PROJ-1', ['README.md'])], by({}), {
    args: ARGS({ policy: 'auto', resumeState: { attempt: 1, lastSeq: 10, policies: { 'PROJ-1': 'strict', 'NOT-IN-PROJECT': 'strict', 'PROJ-9': 'fast' } } }),
  })
  eq([result.policies.tasks['PROJ-1'].policy, result.policies.tasks['PROJ-1'].auto], ['strict', 'fast'], 'strict from the checkpoint, though auto alone would pick fast')
  eq(implModel(calls, 'PROJ-1'), 'opus', 'at the strict tier')
}

// ── 16. history: escalation rate, and a learning naming a file ──
{
  const tasks = [S('PROJ-1', ['src/a.ts']), S('PROJ-2', ['web/x.tsx'], { repo: 'web', agent: 'web-engineer' }), S('PROJ-3', ['web/y.tsx'], { repo: 'web', agent: 'web-engineer' })]
  const { result, logs } = await run('history raises, never lowers', tasks, by({}), {
    args: ARGS({ policy: 'auto', repos: [API, WEB] }),
    context: { policyHistory: [{ repo: 'api', fast: 8, escalated: 3 }, { repo: 'web', fast: 2, escalated: 2 }], priorLearnings: [{ text: 'web/y.tsx re-renders the whole list on every keystroke', repos: ['web'] }] },
  })
  const p = (id) => result.policies.tasks[id]
  eq(p('PROJ-1').auto, 'balanced', 'api escalated 3/8 > 0.25: balanced')
  ok(p('PROJ-1').signals.includes('history: FAST escalated 3/8 in earlier runs of api'), 'with the signal')
  eq(p('PROJ-2').auto, 'fast', 'web: 2/2 is under the minimum sample — no raise')
  eq(p('PROJ-3').auto, 'balanced', 'a learning about web naming web/y.tsx raises that task')
  eq(logs.filter((l) => l.includes('its tasks run at least balanced')).length, 1, 'the repo raise is logged once')
}

// ── 17. the review minors: annotated paths, a glob's braces ──
{
  const tasks = [S('PROJ-1', ['api/foo.proto (new)']), S('PROJ-2', ['`infra/main.tf` — add a bucket']), S('PROJ-3', ['src/x.gen.ts: regenerate'])]
  const { result } = await run('annotated declared files still meet their floor', tasks, by({}), { args: ARGS({ policy: 'auto', policies: { strictPaths: ['**/*.proto', '**/*.tf', '**/*.{gen.ts,gen.js}'] } }) })
  eq(['PROJ-1', 'PROJ-2', 'PROJ-3'].map((id) => result.policies.tasks[id].auto), ['strict', 'strict', 'strict'], '"(new)", backticks and ": what" are stripped; braces take globs')
}

// ── 18. an escalation not landed is written to its repo's PR marker (esc) ──
{
  const { calls } = await run('marker: esc lists the escalated task that did not land', [S('PROJ-1', ['src/a.ts']), S('PROJ-2', ['src/b.ts'])], by({
    'break-it:PROJ-1': VF(FINDING('blocker', 'src/a.ts', 'races')),
    'fix:PROJ-1:fast#1': FIX(),
    'guard:PROJ-1:fast': GUARD('RE_REVIEW'),
    'break-it:PROJ-1~strict': VF(FINDING('blocker', 'src/a.ts', 'still racy')),
    'impl:PROJ-2': impl('ccccccc'),
  }), { args: ARGS({ policy: 'fast', maxFixAttempts: 1, maxReplans: 0 }) })
  const ship = calls.filter((c) => /^ship:api/.test(c.label)).pop()
  const tok = ship && (/grimoire:state v1 ([A-Za-z0-9+/=]+) -->/.exec([ship.prompt, ...heredocs(ship.prompt)].join('\n')) || [])[1]
  const st = tok ? JSON.parse(Buffer.from(tok, 'base64').toString('utf8')) : {}
  eq(st.esc, ['PROJ-1'], 'the escalated task is listed, the landed one is not')
}

// ── 19. reviewParallel 'off': an escalated task's STRICT round 0 runs spec, then quality; its verifier has its own name ──
{
  const { labels } = await run("reviewParallel 'off' after an escalation", [S('PROJ-1', ['src/a.ts'])], by({
    'break-it:PROJ-1': VF(FINDING('blocker', 'src/a.ts', 'race')),
    'fix:PROJ-1:fast#1': FIX(),
    'guard:PROJ-1:fast': GUARD('RE_REVIEW'),
    'break-it:PROJ-1~strict': VF(FINDING('major', 'src/a.ts', 'still racy')),
    'verify:PROJ-1:quality#0': { results: [{ index: 1, verdict: 'CONFIRMED', evidence: 'x' }] },
    'verify:PROJ-1:quality#0~strict': { results: [{ index: 1, verdict: 'CONFIRMED', evidence: 'x' }] },
    'fix:PROJ-1:quality#1': FIX('ccccccc'),
    'guard:PROJ-1#1': GUARD('PASS'),
  }), { args: ARGS({ policy: 'fast', reviewParallel: 'off', verifyFindings: true }) })
  const at = (l) => labels.indexOf(l)
  ok(at('spec-hawk:PROJ-1~strict') >= 0 && at('break-it:PROJ-1~strict') > at('spec-hawk:PROJ-1~strict'), 'spec ~strict first, quality ~strict after it')
  ok(labels.includes('verify:PROJ-1:quality#0') && labels.includes('verify:PROJ-1:quality#0~strict'), "the FAST and the STRICT round-0 verifiers have their own labels")
}

// ── 20. the build is routed again: a floor on a changed file, the precheck's auth signal, FAST's footprint ──
{
  const { result, labels, calls } = await run('no declared files, the build changed an auth file → STRICT before the panel', [S('PROJ-1', [])], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), filesChanged: ['src/auth/session.ts', 'src/a.ts'] },
    'privacy:PROJ-1': VF(FINDING('major', 'src/auth/session.ts', 'logs the token')),
    'fix:PROJ-1:quality#1': FIX(),
    'guard:PROJ-1#1': GUARD('PASS'),
  }), { args: ARGS({ policy: 'auto' }) })
  const p = result.policies.tasks['PROJ-1']
  eq([p.auto, p.policy, result.policies.byPolicy], ['balanced', 'strict', { balanced: 0, strict: 1 }], 'routed balanced on the declared footprint (none); policy and byPolicy count what ran')
  ok((p.raisedAfterBuild || []).some((x) => x.includes('changed src/auth/session.ts matches **/auth/**')), 'raised after the build, the changed file and glob named')
  ok(labels.includes('privacy:PROJ-1'), 'privacy is promoted into the quality stage')
  eq(calls.find((c) => c.label === 'fix:PROJ-1:quality#1').opts.model, 'opus', 'the fixes from here on run on opus')

  const a = await run("the precheck's auth signal raises a FAST task, whatever its files are named", [S('PROJ-1', ['src/resolvers/user.ts'])], by({
    'precheck:PROJ-1': { verdict: 'PASS', problems: [], summary: 'ok', authChange: 'src/resolvers/user.ts:41 — drops check_user_authenticated()' },
  }), { args: ARGS({ policy: 'auto', precheck: true }) })
  ok((a.result.policies.tasks['PROJ-1'].raisedAfterBuild || []).some((x) => x.includes('drops check_user_authenticated()')), 'the signal is the precheck\'s words')
  eq(reviewersOf(a.labels, 'PROJ-1'), ['break-it', 'data-integrity', 'privacy', 'spec-hawk'], 'the strict panel with privacy, not FAST\'s two lenses')

  const f = await run("a FAST build past FAST's footprint runs balanced", [S('PROJ-1', ['src/a.ts'])], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), filesChanged: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'] },
  }), { args: ARGS({ policy: 'auto' }) })
  eq(f.result.policies.tasks['PROJ-1'].raisedAtPrecheck, ['src/a.ts', 'src/b.ts', 'src/c.ts'], 'raised, the files named')
  ok(f.labels.includes('data-integrity:PROJ-1'), "the repo's full quality core")

  const d = await run('no policy asked for: the build changes nothing (balanced, 0.15.1)', [S('PROJ-1', [])], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), filesChanged: ['src/auth/session.ts'] },
  }), { args: ARGS() })
  ok(!d.labels.includes('privacy:PROJ-1') && !('raisedAfterBuild' in d.result.policies.tasks['PROJ-1']), 'no raise, no promoted lens')
}

// ── 20b. the review's majors: allowBelowFloor, an already-STRICT task, an explicit fast ──
{
  const ab = await run('allowBelowFloor: the build raises nothing', [S('PROJ-1', [])], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), filesChanged: ['src/auth/session.ts'] },
  }), { args: ARGS({ policy: 'auto', policies: { allowBelowFloor: true } }) })
  ok(!('raisedAfterBuild' in ab.result.policies.tasks['PROJ-1']) && !ab.labels.includes('privacy:PROJ-1'), 'an undeclared floor file is honoured below its floor like a declared one')

  const st = await run('already STRICT (another repo), the diff drops an auth check: privacy joins', [S('PROJ-1', ['src/a.ts']), S('PROJ-2', ['web/page.tsx'], { repo: 'web', agent: 'web-engineer', dependsOn: ['PROJ-1'] })], by({
    'precheck:PROJ-2': { verdict: 'PASS', problems: [], summary: 'ok', authChange: 'web/page.tsx:9 — calls the API without the session check' },
  }), { args: ARGS({ policy: 'auto', precheck: true, repos: [API, WEB] }) })
  eq(st.result.policies.tasks['PROJ-2'].promotedAfterBuild, ['privacy'], 'the strict task gains privacy')
  ok(st.labels.includes('privacy:PROJ-2'), 'and the privacy lens reviews it')

  const ex = await run('an explicit fast keeps its size; its floors still apply', [S('PROJ-1', ['src/a.ts']), S('PROJ-2', ['src/b.ts'])], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), filesChanged: ['src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/c.ts'] },
    'impl:PROJ-2': { ...impl('bbbbbbb'), filesChanged: ['src/b.ts', 'db/migrations/0002.sql'] },
  }), { args: ARGS({ policy: 'fast' }) })
  eq([ex.result.policies.tasks['PROJ-1'].policy, ex.result.policies.tasks['PROJ-2'].policy], ['fast', 'strict'], 'four changed files stay FAST; a changed migration is still STRICT')
}

// ── 21. repos[].strictPaths: one repo's own floor globs ──
{
  const API2 = { ...API, strictPaths: ['src/services/auth.rs', '**/aws_cognito/**'] }
  const tasks = [S('PROJ-1', ['src/services/auth.rs — check the token']), S('PROJ-2', ['lib/aws_cognito/client.rs']), S('PROJ-3', ['src/services/feed.rs'])]
  const { result } = await run('repos[].strictPaths add to the run\'s floor globs', tasks, by({}), { args: ARGS({ policy: 'auto', repos: [API2] }) })
  eq(['PROJ-1', 'PROJ-2', 'PROJ-3'].map((id) => result.policies.tasks[id].auto), ['strict', 'strict', 'fast'], "the repo's globs floor its tasks; the rest route as before")
  const bad = await run('a malformed repos[].strictPaths is ignored', [S('PROJ-1', ['src/a.ts'])], by({}), { args: ARGS({ policy: 'auto', repos: [{ ...API, strictPaths: 'src/**' }] }) })
  ok(bad.logs.some((l) => l.includes('repos[api].strictPaths ignored')), 'logged, the run\'s globs apply')
}

// ── 22. the contract lens: promoted by a contract file or a cross-repo dependency, both sides in its brief ──
{
  const tasks = [S('PROJ-1', ['api/events.proto — add a field']), S('PROJ-2', ['web/page.tsx'], { repo: 'web', agent: 'web-engineer', dependsOn: ['PROJ-1'] }), S('PROJ-3', ['src/a.ts'])]
  const { labels, prompt } = await run('contract: promoted under STRICT, never by a tag', tasks, by({}), { args: ARGS({ policy: 'auto', repos: [API, WEB] }) })
  ok(labels.includes('contract:PROJ-1'), 'a .proto footprint promotes the contract lens')
  ok(labels.includes('contract:PROJ-2'), 'so does a dependency on another repo\'s task')
  ok(!labels.includes('contract:PROJ-3'), 'a plain task never draws it')
  const p2 = prompt('contract:PROJ-2')
  ok(p2.includes('The other side of the contract') && p2.includes('`repositories/api`') && p2.includes('PROJ-1 (api)'), "its brief names the other repo's path and the task it depends on")
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
