// ════════════════════════════════════════════════════════════════════════════
//  Fix rounds · did the fix weaken a test? (0.10.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/fix-test-integrity.test.mjs
//
//  Every gate in the loop trusts the tests, and when a reviewer sends a finding back, the
//  cheapest way to make it go away is to loosen the test that exposed it. Nothing caught that:
//  the precheck only checks that tests moved with behaviour, and the whole-task diff a re-review
//  reads cannot show a test the task added and a fix then weakened. So, per review fix round (spec,
//  quality and the terminal sweep, whose fix range comes from the fix's own report):
//    • the GUARD gets a fact sheet built from the fix's OWN diff: test files that existed before
//      the fix and that it deleted, the assertions it removed from them, the skips or focus
//      markers it added
//    • a RE-REVIEW round hands the same sheet to ONE reviewer (break-it, else spec-hawk, else the
//      first lens) with the findings the fix answered, so it is raised once, not once per lens
//    • no fix, or a fix that did not move the head → no sheet anywhere
//    • the sheet is one fixed command: run here for real against a temp git repo, in bash, zsh
//      and dash (those installed), so what it flags is checked, not assumed
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, spawnSync, SHELLS, GITENV, QUIET } from './support/script-harness.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)

const SHEET = '## Did the fix weaken a test?'
const API = { name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null } // quality core: data-integrity + break-it → guard
const WEB = { name: 'web', path: 'repositories/web', agent: 'web-engineer', tags: ['web'], gate: null } // quality core: break-it alone → no guard
const TASK = (repo = 'api') => ({ id: 'PROJ-1', ticket: 'PROJ-1', repo, agent: `${repo === 'api' ? 'backend' : 'web'}-engineer`, slice: 1, sliceLabel: 'v', order: 1, taskText: 'Build it', deferred: false, branch: 'feat/x', files: ['src/a.ts — add a'] })
const IMPL = (head = 'aaaaaaa', start = '0000000') => ({ status: 'DONE', summary: 'built', commits: [head], baseSha: start, startSha: start, headSha: head, filesChanged: ['src/a.ts'] })
const FIX = (head = 'bbbbbbb') => ({ status: 'DONE', summary: 'fixed', commits: [head], headSha: head, filesChanged: ['src/a.ts'] })
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const BLOCKER = V('FAIL', [{ severity: 'blocker', file: 'src/a.ts', line: 3, issue: 'the empty case returns 500' }])
const ARGS = (repos) => ({ ...QUIET, repos, builtinEnvChecks: false })
// first reviewer call of `who` fails, later ones pass
const failOnce = (who) => { let n = 0; return (label) => label.startsWith(`${who}:`) && n++ === 0 }
const respond = ({ failing, guard = 'RE_REVIEW', impl = IMPL(), fix = FIX() }) => (label) => {
  if (label.startsWith('impl:')) return impl
  if (label.startsWith('fix:')) return fix
  if (label.startsWith('guard:')) return { decision: guard, reason: guard === 'PASS' ? 'addressed, contained' : 'test weakened: tests/a.test.ts:4' }
  if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
  if (failing && failing(label)) return BLOCKER
  return V('PASS')
}
const reviewCalls = (calls, who) => calls.filter((c) => c.label.startsWith(`${who}:PROJ-1`))

// ══════════════ W-1 · the guard reads the sheet for the fix's own diff ══════════════
{
  const { calls, result } = await run('W-1 · two-lens quality core: blocker → fix → the guard gets the sheet for aaaaaaa..bbbbbbb', [TASK()],
    respond({ failing: failOnce('data-integrity'), guard: 'PASS' }), { args: ARGS([API]) })
  const guard = calls.find((c) => c.label.startsWith('guard:'))
  ok(!!guard && guard.prompt.includes(SHEET), 'the guard prompt carries the sheet')
  ok(!!guard && guard.prompt.includes('--diff-filter=MR aaaaaaa..bbbbbbb'), 'built from the fix diff: pre-fix head → fixed head')
  ok(!!guard && !guard.prompt.includes('The blocking findings this fix answered'), 'the guard is not handed the findings twice (its header lists them)')
  ok(calls.filter((c) => !c.label.startsWith('guard:')).every((c) => !c.prompt.includes(SHEET)), 'no other dispatch got the sheet: no re-review round happened')
  eq(result.done.map((d) => d.status), ['DONE'], 'the task landed on the guard PASS')
}

// ══════════════ W-2 · a re-review round: exactly one reviewer judges it ══════════════
{
  const { calls } = await run('W-2 · guard RE_REVIEW → the re-review round hands the sheet to break-it only', [TASK()],
    respond({ failing: failOnce('data-integrity'), guard: 'RE_REVIEW' }), { args: ARGS([API]) })
  const di = reviewCalls(calls, 'data-integrity'), bi = reviewCalls(calls, 'break-it')
  eq([di.length, bi.length], [2, 2], 'both lenses ran round 0 and the re-review')
  ok(!di[0].prompt.includes(SHEET) && !bi[0].prompt.includes(SHEET), 'round 0: nobody gets it (there is no fix yet)')
  ok(bi[1].prompt.includes(SHEET) && !di[1].prompt.includes(SHEET), 'round 1: break-it gets it, data-integrity does not')
  ok(bi[1].prompt.includes('The blocking findings this fix answered') && bi[1].prompt.includes('src/a.ts:3 — the empty case returns 500'), 'with the findings the fix answered, so a requested test change is not flagged')
  ok(bi[1].prompt.includes('--diff-filter=MR aaaaaaa..bbbbbbb'), 'for the fix diff, not the whole task')
  ok(bi[1].prompt.indexOf(SHEET) < bi[1].prompt.indexOf('## Running commands'), 'placed before the Running commands block')
}

// ══════════════ W-3 · single-lens stages: the one re-reviewer gets it ══════════════
{
  const { calls } = await run('W-3a · spec stage: spec-hawk FAIL → fix → spec-hawk re-review gets the sheet', [TASK('web')],
    respond({ failing: failOnce('spec-hawk') }), { args: ARGS([WEB]) })
  const sh = reviewCalls(calls, 'spec-hawk')
  eq(sh.length, 2, 'spec-hawk ran twice')
  ok(!sh[0].prompt.includes(SHEET) && sh[1].prompt.includes(SHEET), 'only the re-review carries it')
  ok(!calls.some((c) => c.label.startsWith('guard:')), 'no guard on a one-lens stage')
}
{
  const { calls } = await run('W-3b · one-lens quality core: break-it FAIL → fix → break-it re-review gets the sheet', [TASK('web')],
    respond({ failing: failOnce('break-it') }), { args: ARGS([WEB]) })
  const bi = reviewCalls(calls, 'break-it')
  ok(bi.length >= 2 && !bi[0].prompt.includes(SHEET) && bi[bi.length - 1].prompt.includes(SHEET), 'the re-review carries it, round 0 does not')
}

// ══════════════ W-4 · no fix, or a fix that did not move the head → no sheet ══════════════
{
  const { calls } = await run('W-4a · everything passes first time', [TASK()], respond({}), { args: ARGS([API]) })
  ok(calls.every((c) => !c.prompt.includes(SHEET)), 'no dispatch carries the sheet')
}
{
  const { calls } = await run('W-4b · the fix reports the same head (nothing committed)', [TASK()],
    respond({ failing: failOnce('data-integrity'), fix: FIX('aaaaaaa') }), { args: ARGS([API]) })
  ok(calls.some((c) => c.label.startsWith('fix:')), 'a fix was dispatched')
  ok(calls.every((c) => !c.prompt.includes(SHEET)), 'no sheet: there is no fix diff to read')
}

// ══════════════ W-6 · the verifier of a re-review round is handed the fix diff ══════════════
// A weakened-test blocker is about a change only the fix diff shows; judged against the whole
// range alone, the verifier would overturn it for not finding the removed line.
{
  let bi = 0, fixes = 0
  const WEAK = V('FAIL', [{ severity: 'blocker', file: 'tests/a.test.ts', line: 4, issue: 'the fix removed the empty-case assertion (line before the fix)' }])
  const { calls } = await run('W-6 · guard RE_REVIEW → break-it raises a weakened test → its verifier gets the fix diff', [TASK()], (label) => {
    if (label.startsWith('fix:')) return FIX(++fixes === 1 ? 'bbbbbbb' : 'ccccccc')
    if (label.startsWith('break-it:')) return ++bi === 2 ? WEAK : V('PASS')
    if (label.startsWith('verify:')) return { results: [{ index: 1, verdict: 'CONFIRMED' }] }
    return respond({ failing: failOnce('data-integrity') })(label)
  }, { args: { ...ARGS([API]), verifyFindings: true } })
  const v0 = calls.find((c) => c.label === 'verify:PROJ-1:quality#0'), v1 = calls.find((c) => c.label === 'verify:PROJ-1:quality#1')
  ok(!!v0 && !v0.prompt.includes('## This round re-reviewed a fix'), 'round 0: the verifier gets the whole range only')
  ok(!!v1 && v1.prompt.includes('## This round re-reviewed a fix') && v1.prompt.includes('diff aaaaaaa..bbbbbbb'), 'round 1: it also gets the fix diff the finding is about')
  ok(!!v1 && v1.prompt.indexOf('## This round re-reviewed a fix') < v1.prompt.indexOf('## Running commands'), 'placed before the Running commands block')
}

// ══════════════ W-7 · a second fix round reads the second fix, not the first ══════════════
{
  let di = 0, fixes = 0
  const { calls } = await run('W-7 · two fix rounds, guard RE_REVIEW both times', [TASK()], (label) => {
    if (label.startsWith('fix:')) return FIX(++fixes === 1 ? 'bbbbbbb' : 'ccccccc')
    if (label.startsWith('data-integrity:')) return ++di <= 2 ? BLOCKER : V('PASS')
    return respond({})(label)
  }, { args: ARGS([API]) })
  const guards = calls.filter((c) => c.label.startsWith('guard:'))
  eq(guards.length, 2, 'two guards')
  ok(guards[0].prompt.includes('aaaaaaa..bbbbbbb') && guards[1].prompt.includes('bbbbbbb..ccccccc') && !guards[1].prompt.includes('--diff-filter=MR aaaaaaa'), 'each guard reads its own fix')
  const bi = reviewCalls(calls, 'break-it')
  ok(bi.length === 3 && bi[1].prompt.includes('--diff-filter=MR aaaaaaa..bbbbbbb') && bi[2].prompt.includes('--diff-filter=MR bbbbbbb..ccccccc'), 'and each re-review round the latest fix')
}

// ══════════════ W-8 · a judge that returned nothing is retried with the sheet ══════════════
{
  const { calls } = await run('W-8 · break-it returns nothing in the re-review round, then is retried', [TASK()], (label) => {
    if (label === 'break-it:PROJ-1#1') return null
    return respond({ failing: failOnce('data-integrity') })(label)
  }, { args: ARGS([API]) })
  const retry = calls.find((c) => c.label === 'break-it:PROJ-1#1~r1')
  ok(!!retry && retry.prompt.includes(SHEET), 'the retry still carries the sheet')
}

// ══════════════ W-9 · the terminal sweep: no task range, so the fix's own report ══════════════
{
  let sre = 0
  const { calls } = await run("W-9a · terminal sweep: blocker → fix → the guard and one re-reviewer read the fix's reported range", [TASK()], (label) => {
    if (label.startsWith('reliability-sre:')) return ++sre === 1 ? BLOCKER : V('PASS')
    if (label.startsWith('fix:') && label.includes(':terminal')) return { status: 'DONE', summary: 'fixed', startSha: 'ddddddd', commits: ['eeeeeee'], headSha: 'eeeeeee', filesChanged: ['src/a.ts'] }
    return respond({})(label)
  }, { args: ARGS([API]) })
  const guard = calls.find((c) => c.label.startsWith('guard:api:final'))
  ok(!!guard && guard.prompt.includes('--diff-filter=MR ddddddd..eeeeeee'), 'the terminal guard gets the sheet for the fix it judges')
  ok(!!guard && guard.prompt.includes('diff ddddddd..eeeeeee        # ← the fix you are judging'), 'and the fix diff itself, where it used to be told to find the commits')
  const sre1 = calls.find((c) => c.label === 'reliability-sre:api:final#1'), pr1 = calls.find((c) => c.label === 'privacy:api:final#1')
  ok(!!sre1 && sre1.prompt.includes(SHEET) && !!pr1 && !pr1.prompt.includes(SHEET), 'one re-reviewer judges it (the first lens: the sweep has no break-it or spec hawk)')
}
{
  let sre = 0
  const { calls } = await run('W-9b · terminal sweep: a fix that reports no SHAs', [TASK()], (label) => {
    if (label.startsWith('reliability-sre:')) return ++sre === 1 ? BLOCKER : V('PASS')
    if (label.startsWith('fix:') && label.includes(':terminal')) return { status: 'DONE', summary: 'fixed' }
    return respond({})(label)
  }, { args: ARGS([API]) })
  const guard = calls.find((c) => c.label.startsWith('guard:api:final'))
  ok(!!guard && !guard.prompt.includes(SHEET) && guard.prompt.includes('establish the fix commits yourself'), 'no range, no sheet: the guard is told to find the commits, as before')
}

// ══════════════ W-5 · the sheet, run for real ══════════════
// A temp repo: the task's commit A adds tests and code, the fix's commit B weakens some of them.
const D = mkdtempSync(join(tmpdir(), 'grim-fti-'))
process.on('exit', () => rmSync(D, { recursive: true, force: true }))
const git = (cmd) => spawnSync('bash', ['-c', `git ${cmd}`], { cwd: D, encoding: 'utf8', env: GITENV })
const put = (f, s) => { mkdirSync(join(D, f, '..'), { recursive: true }); writeFileSync(join(D, f), s) }
const commit = (m, flags = '') => { git('add -A'); git(`commit -q ${flags} -m ${m}`); return git('rev-parse HEAD').stdout.trim() }
git('init -q -b main')
const BASE = commit('base', '--allow-empty')
put('tests/calc.test.js', ["import { add } from '../src/calc.js'", "describe('add', () => {", "  it('adds', () => {", '    expect(add(1, 2)).toBe(3)', '  })', "  it('handles negatives', () => {", '    expect(add(-1, -2)).toBe(-3)', '  })', '})', ''].join('\n'))
put('src/calc_test.go', ['package calc', 'func TestAdd(t *testing.T) {', '\tif got := Add(1, 2); got != 3 {', '\t\tt.Errorf("Add = %d", got)', '\t}', '}', ''].join('\n'))
put('test_old.py', ['def test_one():', '    assert one() == 1', ''].join('\n'))
put('src/app.js', ['const expect = compute()', 'export default expect', ''].join('\n'))
put('tests/flow.rs', ['#[test]', 'fn flows() {}', ''].join('\n'))
put('src/test/java/FlowTest.java', ['class FlowTest {', '  @Test void flows() {}', '}', ''].join('\n'))
put('cypress/e2e/login.cy.ts', ["it('logs in', () => {", "  cy.contains('Welcome').should('be.visible')", '})', ''].join('\n'))
put('Flow.Tests/FlowTests.cs', ['public class FlowTests {', '  [Fact] public void Flows() {}', '}', ''].join('\n'))
put('tests/empty.test.js', '')
put('tests/fixtures/shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]))
put('tests/old_name.test.js', ["it('x', () => {", '  expect(x()).toBe(1)', '  expect(y()).toBe(2)', '})', ''].join('\n'))
put('docs/specs/plan.md', ['# Plan', 'The client must retry.', ''].join('\n'))
put('app/tests.py', ['def test_ok():', '    assert ok()', ''].join('\n'))
put('tests/sub dir/space file.test.js', ['expect(z()).toBe(1)', 'expect(w()).toBe(2)', ''].join('\n'))
const A = commit('task')
// the fix: removes an assertion, skips a test, empties a Go check, deletes a test file — and, as
// controls, edits an assertion-looking line in non-test code and adds a brand-new skipped test
put('tests/calc.test.js', ["import { add } from '../src/calc.js'", "describe('add', () => {", "  it('adds', () => {", '  })', "  it.skip('handles negatives', () => {", '    expect(add(-1, -2)).toBe(-3)', '  })', '})', ''].join('\n'))
put('src/calc_test.go', ['package calc', 'func TestAdd(t *testing.T) {', '\tif got := Add(1, 2); got != 3 {', '\t}', '}', ''].join('\n'))
rmSync(join(D, 'test_old.py'))
put('src/app.js', ['export default compute()', ''].join('\n'))
put('tests/new.test.js', ["it.skip('later', () => {})", ''].join('\n'))
put('tests/flow.rs', ['#[test]', '#[ignore]', 'fn flows() {}', ''].join('\n'))
put('src/test/java/FlowTest.java', ['class FlowTest {', '  @Disabled @Test void flows() {}', '}', ''].join('\n'))
put('cypress/e2e/login.cy.ts', ["it('logs in', () => {", '})', ''].join('\n'))
put('Flow.Tests/FlowTests.cs', ['public class FlowTests {', '  [Ignore("flaky")] [Fact] public void Flows() {}', '}', ''].join('\n'))
rmSync(join(D, 'tests/empty.test.js')); rmSync(join(D, 'tests/fixtures/shot.png'))
rmSync(join(D, 'tests/old_name.test.js')); put('tests/new_name.test.js', ["it('x', () => {", '  expect(x()).toBe(1)', '})', ''].join('\n'))
put('docs/specs/plan.md', ['# Plan', ''].join('\n'))
put('app/tests.py', ['def test_ok():', '    pass', ''].join('\n'))
put('tests/sub dir/space file.test.js', ['expect(w()).toBe(2)', ''].join('\n'))
const B = commit('fix')
put('src/calc.js', ['export const add = (a, b) => a + b', ''].join('\n'))
const C = commit('clean-fix') // a fix that touches no test
put('tests/many.test.js', ['expect(' + 'x'.repeat(500) + ').toBe(1)', ...Array.from({ length: 69 }, (_, i) => `expect(f(${i})).toBe(${i})`), ''].join('\n'))
const M1 = commit('many')
put('tests/many.test.js', '// emptied\n')
const M2 = commit('many-gone') // 70 assertions removed at once

const sheetFor = async (from, to) => {
  const { calls } = await run('(capture the guard sheet)', [TASK()],
    respond({ failing: failOnce('data-integrity'), guard: 'PASS', impl: IMPL(from, BASE), fix: FIX(to) }), { args: ARGS([{ ...API, path: D }]) })
  const p = (calls.find((c) => c.label.startsWith('guard:')) || {}).prompt || ''
  return ((p.split(SHEET)[1] || '').match(/```bash\n([\s\S]*?)\n```/) || [])[1] || ''
}
const sh = (shell, cmd) => spawnSync(shell, ['-c', cmd], { encoding: 'utf8', env: GITENV })
const lines = (out) => out.trim().split('\n').filter(Boolean)
{
  const cmd = await sheetFor(A, B)
  ok(cmd.includes(`git -C ${D} -c core.quotePath=false diff`) && cmd.includes(`${A}..${B}`), 'the sheet names the real repo and the fix range')
  for (const SHELL of SHELLS) {
    console.log(`\n── W-5 · ${SHELL}: the weakening fix`)
    const r = sh(SHELL, cmd)
    const out = lines(r.stdout)
    eq(r.status, 0, 'exits 0')
    ok(out.includes('removed assertion: tests/calc.test.js:4 (before the fix):     expect(add(1, 2)).toBe(3)'), 'the removed expect(), cited by its line before the fix')
    ok(out.includes("added skip/focus: tests/calc.test.js:5:   it.skip('handles negatives', () => {"), 'the added it.skip, at its new line')
    ok(out.some((l) => l.startsWith('removed assertion: src/calc_test.go:4 (before the fix):') && l.includes('t.Errorf')), 'the removed Go t.Errorf, in a *_test.go file outside tests/')
    ok(out.includes('deleted test file: test_old.py'), 'the deleted test_*.py file')
    ok(out.includes('added skip/focus: tests/flow.rs:2: #[ignore]'), 'the added Rust #[ignore] (a bracket expression in the pattern)')
    ok(out.includes('added skip/focus: src/test/java/FlowTest.java:2:   @Disabled @Test void flows() {}'), 'the added JUnit @Disabled, matched case-insensitively')
    ok(out.includes("removed assertion: cypress/e2e/login.cy.ts:2 (before the fix):   cy.contains('Welcome').should('be.visible')"), 'the removed Cypress should(), in a *.cy.ts file under e2e/')
    ok(out.includes('added skip/focus: Flow.Tests/FlowTests.cs:2:   [Ignore("flaky")] [Fact] public void Flows() {}'), 'the added NUnit [Ignore] (a bracket expression in the pattern)')
    ok(out.includes('deleted test file: tests/empty.test.js') && out.includes('deleted test file: tests/fixtures/shot.png'), 'deleted empty and binary test files (no hunk to read)')
    ok(out.includes('removed assertion: tests/new_name.test.js:3 (before the fix):   expect(y()).toBe(2)') && !out.some((l) => l.includes('old_name')), 'a test renamed and loosened: the removed assertion under its new path, not a deletion')
    ok(out.includes('removed assertion: app/tests.py:2 (before the fix):     assert ok()'), 'a tests.py module')
    ok(out.includes('removed assertion: tests/sub dir/space file.test.js:1 (before the fix): expect(z()).toBe(1)'), 'a path with a space, without git\'s trailing tab')
    ok(!out.some((l) => l.includes('docs/specs')), 'not docs: a "must" removed from docs/specs/plan.md')
    ok(!out.some((l) => l.includes('assert one() == 1')), 'a deleted file is reported once, not line by line')
    ok(!out.some((l) => l.includes('src/app.js')), 'not code: an `expect` removed from src/app.js is not a test')
    ok(!out.some((l) => l.includes('tests/new.test.js')), 'not a test the fix added: it did not exist before the fix')
    eq(out.length, 13, 'exactly the thirteen candidates')
  }
}
{
  const cmd = await sheetFor(B, C)
  for (const SHELL of SHELLS) {
    console.log(`\n── W-5 · ${SHELL}: a fix that touches no test, and a range git cannot resolve`)
    eq(lines(sh(SHELL, cmd).stdout), ['(none)'], 'a clean fix prints (none)')
    const bad = sh(SHELL, cmd.replaceAll(`${B}..${C}`, `${B}..${'f'.repeat(40)}`))
    ok(lines(bad.stdout)[0] === '!! the diff failed: read the fix diff yourself', 'a failed diff says so instead of printing (none)')
  }
}
{
  const cmd = await sheetFor(M1, M2)
  for (const SHELL of SHELLS) {
    console.log(`\n── W-5 · ${SHELL}: a fix that removes 70 assertions, one of them 500 characters long`)
    const out = lines(sh(SHELL, cmd).stdout)
    eq(out.length, 61, 'sixty candidates and a count of the rest')
    eq(out[60], '... and 10 more', 'the cut is said, not silent')
    ok(out.every((l) => l.length <= 240), 'no line longer than 240 characters')
  }
}

console.log(`\n${FAIL ? '✗' : '✓'} ${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
