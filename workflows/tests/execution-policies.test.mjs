// ════════════════════════════════════════════════════════════════════════════
//  Execution policies (0.16.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/execution-policies.test.mjs
//
//  docs/specs/2026-10-31-execution-policies-design.md, slices 1 and 2: a task runs under a
//  profile (fast · balanced · strict) resolved by a deterministic router, no model call.
//    • no policy asked for: every task runs balanced, exactly as before; the router's `auto`
//      pick is recorded only (the shadow record the benchmark reads)
//    • policy 'auto': hard floors (strictPaths, strictTags, the migration specialist, a
//      dependency on another repo's task) make a task STRICT; a docs-only or small, cheap-tier
//      footprint picks FAST (which runs balanced until its own slice ships)
//    • STRICT: the implementer on opus, privacy / data-integrity promoted into the task's
//      quality stage by its declared files
//    • overrides: tracker label > repos[].policy > run policy; below a hard floor refused,
//      unless policies.allowBelowFloor
//    • hydration may propose a stricter policy, never a looser one
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget).
import { run, by, QUIET, API, T } from './support/script-harness.mjs'

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
  eq(result.policies.tasks['PROJ-2'].policy, 'balanced', '…which runs balanced until the FAST profile ships')
  eq(result.policies.tasks['PROJ-3'].auto, 'fast', 'two declared files on sonnet, nothing raised: FAST')
  eq(reviewersOf(labels, 'PROJ-3'), ['break-it', 'data-integrity', 'spec-hawk'], 'a non-STRICT task draws no promoted lens')
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

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
