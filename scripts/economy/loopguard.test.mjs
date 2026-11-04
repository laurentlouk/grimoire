// ════════════════════════════════════════════════════════════════════════════
//  Tests — economy/loopguard: the stuck watch's fold and rules (token economy slice 3, #49)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/economy/loopguard.test.mjs
//
//  The cases are microsoft/TokenEconomizer's own pinned behaviour (tests/test_live_core.py, commit
//  1deb887, Apache-2.0), ported with the code: edits made through the shell, a runner's summary
//  verdict, what counts as a verification, a test run whose status a pipe replaced, reading a file
//  full of asserts, the failure signature, the gate, the stuck rule and the redirect ladder.
import { shellEditTargets, tokens } from './loopguard/shell-edits.mjs'
import { newState, update, failureSig, editChurn, distinctEditFiles, recentDigest, stagnation } from './loopguard/state.mjs'
import { DEFAULT_THRESHOLDS, gateForJudge, isStuck, nudgeText, VERIFY_RE, runnerVerdict, statusOfTests } from './loopguard/rules.mjs'
import { newTurn, foldCall, resolved, verificationState, freeVerdict, wantsJudge, decide } from './loopguard/turn.mjs'
import { percentile, envelopeOf, withSample } from './loopguard/envelope.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)
const section = (t) => console.log(`\n── ${t}`)
const fold = (t, name, args, result = '', exitCode = null) => foldCall(t, { name, args, result, exitCode })

section('edits made through the shell')
for (const [cmd, want] of [
  ["sed -i 's/a/b/' pkg/mod.py", ['mod.py']],
  ["cd /t && sed -i.bak -e 's/a/b/' -e 's/c/d/' x.py y.py && pytest -q", ['x.py', 'y.py']],
  ["sed -i '' 's/a/b/' x.py", ['x.py']],
  ["perl -pi -e 's/foo/bar/' src/a.rs", ['a.rs']],
  ["cat > repro.py <<'EOF'\nprint(1 > 0)\nEOF\npython repro.py", ['repro.py']],
  ["echo 'x' | tee -a setup.cfg", ['setup.cfg']],
  ["python - <<'E'\np='sympy/printing/str.py'; s=open(p).read()\nopen(p,'w').write(s)\nE", ['str.py']],
  ["python - <<'E'\nfor p in ['x/a.py', 'x/b.py']:\n    open(p, 'w').write('')\nE", ['a.py', 'b.py']],
  ["python - <<'E'\nfrom pathlib import Path\nPath('m/n.py').write_text('x')\nE", ['n.py']],
  ['git apply /tmp/fix.diff', ['(patch)']],
  ["apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: pkg/__init__.py\n@@\n-    x\n+    y\n*** End Patch\nPATCH\npython3 -m unittest", ['__init__.py']],
  ["apply_patch <<'P'\n*** Begin Patch\n*** Add File: a/new.py\n+x\n*** Update File: b/old.py\n*** End Patch\nP", ['new.py', 'old.py']],
  ['git checkout -- a.py b/c.py', ['a.py', 'c.py']],
  ['python -m pytest -q > /tmp/out.txt 2>&1; tail -5 /tmp/out.txt', []],
  ["grep -n 'x' a.py > hits.txt", []],
  ["grep -n '>' x.py", []],
  ["grep -nE 'a|b' x.py | head", []],
  ['python -c "print(1>2)"', []],
  ['git stash -q; python bin/test x; git stash pop -q', []],
  ["sed -n '1,20p' pkg/mod.py", []],
  ["sed -i -E 's/x (<|<=|>|>=) y/z/' numbers.py expr.py", ['numbers.py', 'expr.py']],
  ["sed -i 's/a/b/' x.py 2>&1 | tail -2", ['x.py']],
]) eq(shellEditTargets(cmd), want, `${JSON.stringify(cmd).slice(0, 70)} → ${JSON.stringify(want)}`)
eq(tokens("a 2>&1 | b 'c d' # e\nf"), ['a', '2', '>&', '1', '|', 'b', "'c d'", 'f'], "the tokenizer: punctuation runs, a quoted word whole, a comment through its newline")

section('a runner\'s summary gives its verdict')
const TAP_FAILING = '# tests 9\n# suites 0\n# pass 8\n# fail 1\n# cancelled 0'
for (const [out, failed] of [
  ['1 failed, 4 passed, 2 warnings in 1.23s', true], ['== 1 error in 0.12s ==', true], ['2 passed, 1 warning in 0.30s', false], ['no tests ran in 0.01s', null],
  ['Ran 3 tests in 0.1s\n\nFAILED (failures=1)', true], ['Ran 3 tests in 0.1s\n\nOK', false], ['tests finished: 10 passed, 1 failed, in 3.20 seconds', true], [TAP_FAILING, true],
  ['# pass 9\n# fail 0', false], ['Tests:       1 failed, 3 passed, 4 total', true], ['  3 passing (20ms)\n  1 failing', true], ['--- FAIL: TestAdd (0.00s)', true],
  ['ok  \tacme/x\t0.012s', false], ['test result: FAILED. 1 passed; 1 failed', true], ['test result: ok. 3 passed; 0 failed', false], ['5 examples, 1 failure', true],
  ['Tests run: 4, Failures: 0, Errors: 1', true], ['[INFO] BUILD SUCCESS', false], ["+    raise ValueError('no')", null], ['ok 1 - add', null],
]) eq(runnerVerdict(out), failed, `${JSON.stringify(out).slice(0, 50)} → ${failed}`)

section('what counts as a verification')
for (const cmd of ['python tests/runtests.py model_inheritance -v 2', './runtests.py basic', '.venv/bin/pytest -q tests/test_a.py', 'cd web && ./node_modules/.bin/jest src', '/usr/bin/python3 -m pytest',
  '/w/venv/bin/pytest -q', '~/.local/bin/pytest -q', 'python3 /w/repo/tests/runtests.py basic', 'node --test test/']) {
  const t = newTurn()
  fold(t, 'Edit', { file_path: '/r/a.py', old_string: 'x', new_string: 'y' }, 'ok')
  fold(t, 'Bash', { command: cmd }, 'FAILED (failures=1)', 1)
  ok(t.verifications === 1 && !resolved(t), `a runner named by path verifies, and its failure after the last edit is no green end: ${cmd}`)
}
for (const cmd of ['cat /w/pytest.ini', 'cat pytest.ini', 'ls /w/tests', 'vim tests/runtests.py.bak']) ok(!VERIFY_RE.test(cmd), `a file named like a runner is no verification: ${cmd}`)
{
  const t = newTurn()
  fold(t, 'Bash', { command: 'rtk npm test 2>&1 | tail -n 8' }, TAP_FAILING, 0)
  ok(t.verifications === 1 && t.lastVerifyFailed, 'rtk\'s prefix is stripped before the command is classified')
}

section('a test run whose status was replaced is judged by its output')
{
  let t = newTurn()
  for (let i = 0; i < 3; i++) fold(t, 'bash', { command: 'npm test 2>&1 | tail -n 8' }, TAP_FAILING, 0)
  eq([t.whole.errorOutputs, t.whole.repeatedFailSigs, resolved(t)], [3, 2, false], 'a piped run reads its own failing summary, three times: three errors, two repeats, no green end')
  t = newTurn()
  fold(t, 'bash', { command: "/bin/bash -lc 'cd /w && timeout 60 go test ./... 2>&1 | tail -3'" }, '--- FAIL: TestAdd (0.00s)\nFAIL\tacme/x\t0.01s', 0)
  eq([t.whole.errorOutputs, resolved(t)], [1, false], 'bash -lc: the script inside is judged')
  for (const cmd of ['python3 -m unittest tests.test_x; echo "exit=$?"', 'npm test || true']) {
    t = newTurn()
    fold(t, 'bash', { command: cmd }, 'FAILED (failures=1)\nexit=1', 0)
    eq([t.whole.errorOutputs, resolved(t)], [1, false], `a reported status: ${cmd}`)
  }
  t = newTurn()
  fold(t, 'bash', { command: 'set -o pipefail; npm test | tail -n 8' }, TAP_FAILING, 0)
  fold(t, 'bash', { command: 'pytest -q | grep FAILED' }, '', 1)
  eq([t.whole.errorOutputs, resolved(t)], [0, true], 'under pipefail the status is the tests\' own; a grep that finds nothing is no failure')
  t = newTurn()
  fold(t, 'bash', { command: 'pytest -q; git diff' }, "F.\n1 failed, 1 passed in 0.12s\ndiff --git a/m.py b/m.py\n+    raise ValueError('no')\n", 0)
  eq([t.whole.errorOutputs, resolved(t)], [1, false], 'a run followed by other commands is judged by its runner\'s summary')
  for (const code of [1, 0, null]) {
    t = newTurn()
    fold(t, 'bash', { command: 'pytest -q\ngit diff --exit-code' }, "2 passed in 0.10s\ndiff --git a/m.py b/m.py\n+    raise ValueError('no')\n", code)
    eq([t.whole.errorOutputs, resolved(t)], [0, true], `passing tests, whatever the later command's status (${code})`)
  }
  for (const cmd of ['tar -xOf pkg.tgz pkg/x.py | sed -n 1,80p', 'cat tests/test_x.py | head -40', 'grep -rn pytest src | head', 'python -m pytest x.py --collect-only -q | rg test_',
    'bin/test --help | head', 'python repro.py 2>&1 | tail', 'pytest -q; git diff --stat', "pytest -q\npython - <<'PY'\nx\nPY"]) {
    t = newTurn()
    fold(t, 'bash', { command: cmd }, "def f():\n    assert x\n    raise ValueError('no')\n", 0)
    eq(t.whole.errorOutputs, 0, `any other command keeps its exit status: ${cmd.split('\n')[0]}`)
  }
  for (const [out, failing] of [[TAP_FAILING, true], ['# pass 9\n# fail 0', false], ['not ok 3 - rates', true], ['  2 failing', true], ['5 examples, 0 failures', false],
    ['5 examples, 2 failures', true], ['Tests run: 4, Failures: 1, Errors: 0', true], ['Tests run: 4, Failures: 0, Errors: 0', false], ['--- FAIL: TestAdd (0.00s)', true], ['ok  \tacme/x\t0.01s', false]]) {
    t = newTurn()
    fold(t, 'bash', { command: 'make test' }, out, null)
    eq(t.whole.errorOutputs === 1, failing, `other ecosystems' failing summaries count: ${JSON.stringify(out).slice(0, 40)}`)
  }
  eq([statusOfTests('ls'), statusOfTests('pytest -q'), statusOfTests('pytest | tail'), statusOfTests('pytest; git diff'), statusOfTests('pytest && echo ok')], [null, 'own', 'hidden', 'mixed', 'own'], 'statusOfTests: none, own, hidden, mixed, own')
}

section('reading a file full of asserts is no failure')
{
  const file = "def test_total():\n    assert total([1, 2]) == 3\n    raise ValueError('no')\n"
  const t = newTurn()
  for (let i = 0; i < 3; i++) { fold(t, 'read', { path: 'tests/test_total.py' }, file); fold(t, 'grep', { pattern: 'assert' }, 'tests/test_total.py:2:    assert total') }
  fold(t, 'bash', { command: 'cat tests/test_total.py' }, file, 0)
  eq([t.whole.errorOutputs, t.whole.repeatedFailSigs], [0, 0], 'reads and a successful cat: no failure, no repeat')
  ok(!gateForJudge(t.whole, { ...DEFAULT_THRESHOLDS, gate_min_turns: 1 }), 'and no gate opens')
  fold(t, 'bash', { command: 'pytest -q' }, 'FAILED tests/test_total.py - AssertionError', 1)
  fold(t, 'bash', { command: 'pytest -q' }, 'FAILED tests/test_total.py - AssertionError', null)
  eq([t.whole.errorOutputs, t.whole.repeatedFailSigs], [2, 1], 'what did fail still counts: a non-zero exit, or markers with no status')
  const s = newState()
  update(s, 'Read', { file_path: 'x.py' }, 'Error: File does not exist.', true)
  eq(s.errorOutputs, 1, 'a read the tool itself reports as failed counts')
}

section('shell edits reach the state and the green end')
{
  const t = newTurn()
  const edit = "python - <<'E'\np='pkg/mod.py'; s=open(p).read()\nopen(p,'w').write(s[::-1])\nE"
  fold(t, 'Bash', { command: edit }); fold(t, 'Bash', { command: edit })
  eq([editChurn(t.st), distinctEditFiles(t.whole), t.edits], [2, 1, 2], 'two inline-python edits of one file')
  const d = recentDigest(t.st)
  ok(d.includes('edit_churn=2') && d.includes('[edits mod.py]'), 'the digest says so')
  fold(t, 'Bash', { command: "sed -i 's/b/c/' pkg/mod.py && pytest -q" }, 'FAILED tests/test_m.py::t - AssertionError')
  ok(t.edits === 3 && t.lastVerify > t.lastEdit && !resolved(t), 'an edit and a failing run in one command: no green end')
  eq(verificationState(t), 'The last verification run failed.', 'the verification state the judge is told')
  fold(t, 'Edit', { file_path: 'pkg/mod.py' }, 'ok')
  eq(verificationState(t), 'The last verification run failed. There have been edits since.', 'and edits since')
}

section('the failure signature')
{
  eq(failureSig('Traceback (most recent call last):\n  File "/a/b.py", line 12\nAssertionError: 3 != 4'), failureSig('Traceback (most recent call last):\n  File "/c/d.py", line 99\nAssertionError: 5 != 6'),
    'numbers and paths are masked: one failure, one signature')
  eq(failureSig('all good'), null, 'no failure line: no signature')
  ok(failureSig('FAIL: test_x (t.T)') === null && failureSig('--- FAIL: TestAdd (0.00s)') !== null, "unittest's `FAIL: test_x` is not Go's `--- FAIL:`")
  ok(/^[0-9a-f]{10}$/.test(failureSig('ValueError: no')), 'ten hex characters, never the content')
  eq(failureSig('downloading 10%\rdownloading 100%\rValueError: no'), failureSig('ValueError: no'), 'a progress line ended by a lone \\r is its own line')
  const p = newState()
  update(p, 'Edit', { file_path: 'src/constructor' }, 'ok'); update(p, 'Edit', { file_path: 'src/constructor' }, 'ok'); update(p, 'constructor', {}, 'ok')
  eq([editChurn(p), p.editCounts.constructor], [2, 2], 'a file named like an Object key counts like any other')
  update(p, 'Bash', { command: ['not', 'a', 'string'] }, 'ok')
  eq(p.turns, 4, 'a command that is not a string is folded without throwing')
}

section('the gate, the stuck rule and the ladder')
{
  const fail = 'Traceback (most recent call last):\nAssertionError: 0.30000000000000004 != 0.3\n\nFAILED (failures=1)\n'
  const t = newTurn()
  const loop = (n) => { for (let k = 0; k < n; k++) { fold(t, 'Edit', { file_path: 'src/calc.py' }, 'ok'); fold(t, 'Bash', { command: 'python -m unittest' }, fail, 1) } }
  loop(8)
  ok(!gateForJudge(t.st) && !isStuck(t.st), '16 calls: the gate waits for 18')
  loop(1)
  ok(gateForJudge(t.st) && wantsJudge(t), '18 calls with a repeated failure: the gate opens, a judge request is due')
  t.lastRequestAt = t.st.turns
  loop(1)
  ok(!wantsJudge(t), 'the next request waits JUDGE_GAP calls')
  ok(isStuck(t.st) && stagnation(t.st) > 0.2, '20 calls, churn on one file, sustained repeated failures: stuck')
  eq([freeVerdict(t, null), freeVerdict(t, 30), freeVerdict(t, 12), freeVerdict(t, 6)], [null, null, 'envelope', 'backstop'], 'free verdicts: no envelope, within it, past it, past 2.5× it')
  eq(decide(t, 'envelope', { at: 'T1' }), 'would-redirect', 'shadow: the first stuck verdict would redirect')
  ok(t.segment === 1 && t.st.turns === 0 && !isStuck(t.st), 'and starts a fresh segment, the agent\'s window to recover')
  loop(10)
  eq(decide(t, 'judge-stuck@0.80'), 'would-block', 'a later one would block')
  ok(t.blocked && !wantsJudge(t), 'no judge request after a block')
  eq(t.events.map((e) => [e.action, e.reason, e.segment]), [['would-redirect', 'envelope', 0], ['would-block', 'judge-stuck@0.80', 1]], 'both recorded, with their segments')
  ok(!resolved(t), 'a blocked dispatch never ended green')
  {
    // the envelope tier reads the segment's length, the backstop the whole dispatch's (the source's rule)
    const u = newTurn()
    for (let k = 0; k < 10; k++) { fold(u, 'Edit', { file_path: 'src/b.py' }, 'ok'); fold(u, 'Bash', { command: 'python -m unittest' }, fail, 1) }
    decide(u, 'first')
    for (let k = 0; k < 10; k++) { fold(u, 'Edit', { file_path: 'src/b.py' }, 'ok'); fold(u, 'Bash', { command: 'python -m unittest' }, fail, 1) }
    eq([u.calls, u.st.turns, freeVerdict(u, 25), freeVerdict(u, 19)], [40, 20, null, 'envelope'], 'after a redirect: 40 calls, 20 in the segment; an envelope of 25 is not passed (though the dispatch is past it), one of 19 is')
  }
  ok(nudgeText(newTurn().st).includes('Do NOT stop') && nudgeText(t.whole).includes('most to `calc.py`'), 'the redirect mirrors the agent\'s own actions and never says stop')
}

section('the envelope')
eq([percentile([], 90), percentile([7], 90), percentile([10, 20, 30, 40, 50], 90)], [null, 7, 46], 'a linear percentile')
eq([envelopeOf([10, 20, 30, 40]), envelopeOf([10, 20, 30, 40, 50])], [null, 46 * 1.25], 'no envelope before 5 dispatches ended green; then p90 × 1.25')
eq(withSample({ 'api/be': { resolved: [1, 2] } }, 'api/be', 3), { 'api/be': { resolved: [1, 2, 3] } }, 'a sample appended per role')
eq(withSample({ x: { resolved: Array.from({ length: 500 }, (_, i) => i + 1) } }, 'x', 999).x.resolved.slice(-2).concat([withSample({ x: { resolved: Array.from({ length: 500 }, (_, i) => i + 1) } }, 'x', 999).x.resolved.length]), [500, 999, 500], 'the history is capped at the last 500')

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
