// ════════════════════════════════════════════════════════════════════════════
//  Tests — economy/facts: environment facts learned from recurring failures (token economy slice 6, #52)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/economy/facts.test.mjs
//
//  The cases are microsoft/TokenEconomizer's own pinned behaviour (tests/test_envfacts.py and
//  tests/test_envfacts_args.py, commit 1deb887, Apache-2.0), ported with the code: each names its
//  source test. Their synthetic Codex transcripts are grimoire call lists here: a `command_execution`
//  with an `exit_code` is a Bash call with that `exitCode`, a `file_change` an Edit. The source reads
//  them with the experiments' Python vocabulary; grimoire reads every repository with the generic one,
//  so the header is the plugin's and the expected values are the source's under that vocabulary. The
//  issue's pinned cases come last, with the rtk prefix.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { classifyCommand, errorClass, labelRule, testLabels, labelFailed, repositoryTop, observeCalls, stripRtkPrefix, formWorked, safeEnvValue } from './facts/observe.mjs'
import { newStore, update, render, injectedIds, seedInjected, toJSON, fromJSON } from './facts/families.mjs'
import { newLife } from './facts/lifecycle.mjs'
import { HEADER, MAX_FACTS, MAX_CHARS, lintOk, claim, workingForm } from './facts/render.mjs'
import { readTranscript } from './transcript.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)
const section = (t) => console.log(`\n── ${t}`)

const BASE = '/opt/env/base/bin/python'
const PROJ = '/opt/env/proj/bin/python'
const LOCAL = '~/.local/bin/pytest'
const OK = 'Ran 4 tests in 0.1s\n\nOK'
const ROOT = '/r'
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i)
const block = (...lines) => `${HEADER}\n${lines.map((l) => `- ${l}`).join('\n')}\n`
const pairs = (obs) => obs.map((o) => [o.intent, o.form])

// a Codex `command_execution` (its output and exit code) and `file_change`
const cmd = (command, result, exitCode) => ({ name: 'Bash', input: { command }, result, ok: exitCode === 0, exitCode, cwd: null })
const edit = (p, cwd = null) => ({ name: 'Edit', input: { file_path: p }, result: 'ok', ok: true, cwd })
// a Claude Code Bash call: a failed one is an error result that starts `Exit code N`
const sh = (command, result, cwd = null) => ({ name: 'Bash', input: { command }, result, ok: !/^Exit code [1-9]/.test(result), cwd })
const run = (label, out) => sh(`python tests/runtests.py ${label} -v 2 2>&1 | tail -20`, out)
const py = (code, out, env = '') => sh(`${env}python -c '${code}'`, out)

// The source's `_stream`: render for the next session, then fold it; returns the store and what it rendered.
function stream(tasks, s = newStore('acme/widget')) {
  const rendered = []
  tasks.forEach((calls, i) => { rendered.push(render(s)); update(s, calls, { iid: `w-${i}`, resolved: true }) })
  return { s, rendered }
}
const life = (over) => ({ ...newLife(false, false), ...over })
// a confirmation keeps its fold only: environment facts do not drift, so its edited files are never read (nor kept)
const confirms = (...pairs) => pairs.map(([i]) => [i, []])

// ---- the sessions the source's scenarios repeat ----
const broken = (i) => [edit(`pkg/mod${i}.py`), cmd('python -m pytest tests/test_a.py -q', `${BASE}: No module named pytest`, 1), cmd(`${PROJ} -m pytest tests/test_a.py -q`, '1 passed in 0.2s', 0)]
const clean = (i) => [edit(`pkg/c${i}.py`), cmd('pytest -q', 'bash: pytest: command not found', 127), cmd('python -m pytest -q', '4 passed in 0.01s', 0)]
const twoForms = (i) => [edit(`pkg/m${i}.py`), cmd('pytest tests/test_a.py -q', 'bash: pytest: command not found', 127),
  cmd('python -m pytest tests/test_a.py -q', `${BASE}: No module named pytest`, 1), cmd(`${PROJ} -m pytest tests/test_a.py -q`, '1 passed', 0)]
const PY_FACT = 'form_repair:run_tests:python -m pytest'
const PY_LINE = `\`python -m pytest …\` fails here with ModuleNotFoundError; \`${PROJ} -m pytest …\` works.`

section('observations (test_classify_forms_and_intents, test_error_classes_are_environmental_only)')
eq(pairs(classifyCommand('/bin/bash -lc "source /opt/env/bin/activate proj && python -m pytest tests -q"')), [['run_tests', 'source activate proj && python -m pytest']], 'a shell wrapper unwrapped, an activation carried into the form')
eq(pairs(classifyCommand("conda run -n proj python - <<'PY'\nimport x\nPY")), [['run_interpreter', 'conda run -n proj python']], '`conda run -n X` is part of the form; the heredoc body is no command')
eq(pairs(classifyCommand('PYTHONPATH=/testbed ./tests/runtests.py auth_tests -v 1')), [['run_tests', 'python tests/runtests.py']], 'a runner script run through its shebang is spelled as the interpreter running it')
eq(pairs(classifyCommand(`${PROJ} bin/test sympy/core/tests/test_a.py`)), [['run_tests', `${PROJ} bin/test`]], 'an explicit interpreter running a runner script')
eq(classifyCommand('git remote -v; git tag --contains HEAD | head; git log --oneline -3').map((o) => [o.intent, o.probe]), [['probe_vcs_refs', 'remote'], ['probe_vcs_refs', 'tag']], 'VCS probes beyond HEAD; `git log` is none')
eq(classifyCommand('curl -sS https://api.example.org/x | head -3').map((o) => [o.intent, o.hosts]), [['fetch_remote', ['api.example.org']]], 'a fetch names its host')
eq(classifyCommand('git tag | tail -5'), [], 'a plain `git tag` lists ALL tags, past ones included: not a beyond-HEAD probe')
eq(pairs(classifyCommand("python - <<'PY'\npytest_is_a_word = 1\nPY")), [['run_interpreter', 'python']], 'heredoc bodies never become commands')
eq([
  errorClass("ModuleNotFoundError: No module named 'x'"),
  errorClass('bash: pytest: command not found'),
  errorClass('curl: (7) Failed to connect to h port 443: Connection refused'),
  errorClass('AssertionError: 1 != 2\nFAILED tests/test_a.py::t'),
], ['module_missing', 'command_missing', 'connection_refused', null], 'error classes are environmental only: a failing assertion is none')

section('form repair')
{ // test_interpreter_fact_forms_fires_and_renders
  const { s } = stream(range(0, 3).map(broken))
  eq(render(s), '', 'not before ACTIVE (3 confirmations) AND 4 exercised sessions')
  update(s, broken(3), { iid: 'w-3', resolved: true })
  eq(render(s), block(PY_LINE), 'then the block names the failing form, its error and the working form')
  eq(s.facts[PY_FACT], {
    id: PY_FACT, family: 'form_repair',
    params: { intent: 'run_tests', a: 'python -m pytest', bCounts: { [`${PROJ} -m pytest`]: 4 }, errorCounts: { module_missing: 4 }, bFails: {}, contraStreak: 0 },
    life: life({ state: 'ACTIVE', confirms: confirms([0, 'mod0.py'], [1, 'mod1.py'], [2, 'mod2.py'], [3, 'mod3.py']), fireNum: 4, fireDen: 4, promotedAt: 2 }),
  }, 'ACTIVE since the third fold, fired 4 of 4')
  ok(lintOk(render(s)), 'the block passes the advice lint')
}
{ // test_clean_environment_forms_nothing
  const { s } = stream(range(0, 8).map((i) => [edit(`pkg/m${i}.py`), cmd('python -m pytest tests/test_a.py -q', '1 passed', 0)]))
  eq([s.facts, render(s)], [{}, ''], 'a clean environment forms nothing')
}
{ // test_bare_runner_success_contradicts_and_retires
  const { s } = stream(range(0, 4).map(broken))
  eq(render(s), block(PY_LINE), 'injected')
  const { rendered } = stream(range(20, 23).map((i) => [edit(`pkg/f${i}.py`), cmd('python -m pytest tests/test_a.py -q', '1 passed', 0)]), s)
  const f = s.facts[PY_FACT]
  eq([rendered.map((r) => r.length > 0), f.life.state, f.life.contradicts, f.life.retiredAt, f.params.contraStreak, render(s)], [[true, true, false], 'RETIRED', [5, 6], 5, 3, ''],
    'the bare runner working again: the first contradiction waits for a second in a row, which retires the fact')
}
{ // test_bare_one_liner_success_is_not_a_contradiction
  const { s } = stream(range(0, 4).map(broken))
  update(s, [edit('pkg/q.py'), cmd("python -c 'import pkg; print(pkg.__version__)'", '1.0', 0), cmd(`${PROJ} -m pytest tests -q`, '2 passed', 0)], { iid: 'w-9', resolved: true })
  eq([s.facts[PY_FACT].life.state, s.lastDigest.verdicts], ['ACTIVE', { [PY_FACT]: ['confirm', false, true] }], 'a bare `python -c` succeeding proves nothing: a pure-Python package imports under any interpreter')
}
{ // test_form_repair_facts_sharing_the_working_form_merge_into_one_line, test_a_merged_line_with_one_working_form_says_works
  const { s } = stream(range(0, 4).map(twoForms))
  eq(render(s), block(`\`pytest …\` and \`python -m pytest …\` fail here (ModuleNotFoundError, command not found); \`${PROJ} -m pytest …\` works.`), 'two facts with one working form merge into one line, which says "works"')
}
{ // test_an_environment_fact_forms_in_a_repository_where_every_session_edits_one_file
  const { s } = stream(range(0, 4).map(() => [edit('pkg/stock.py'), cmd('pytest -q', 'bash: pytest: command not found', 127), cmd('python -m pytest -q', '4 passed in 0.01s', 0)]))
  eq([s.facts['form_repair:run_tests:pytest'].life.state, render(s)], ['ACTIVE', block('`pytest …` fails here with command not found; `python -m pytest …` works.')], 'an environment fact forms though every session edits the same file')
}
{ // test_one_session_is_one_piece_of_evidence_per_form
  const { s } = stream(range(0, 2).map(clean))
  render(s)
  update(s, [edit('pkg/r2.py'), ...Array(3).fill(cmd('pytest -q', 'bash: pytest: command not found', 127)), ...Array(2).fill(cmd(`${PROJ} -m pytest -q`, '1 passed', 0))], { iid: 'r', resolved: true })
  const f = s.facts['form_repair:run_tests:pytest']
  eq([f.params.bCounts, workingForm(f)], [{ 'python -m pytest': 2, [`${PROJ} -m pytest`]: 1 }, 'python -m pytest'], 'a session is one piece of evidence per form: a repair typed twice counts once')
}
{ // test_a_named_form_that_stops_working_is_named_no_more
  const { s } = stream(range(0, 4).map(clean))
  eq(render(s), block('`pytest …` fails here with command not found; `python -m pytest …` works.'), 'named while it works')
  stream(range(4, 9).map((i) => [edit(`pkg/g${i}.py`), cmd('pytest -q', 'bash: pytest: command not found', 127), cmd('python -m pytest -q', `${BASE}: No module named pytest`, 1)]), s)
  const f = s.facts['form_repair:run_tests:pytest']
  eq([f.params.bCounts, f.params.bFails, workingForm(f), claim(f), render(s)], [{ 'python -m pytest': 4 }, { 'python -m pytest': 5 }, null, '', ''], 'a named form that stops working is named no more: the fact makes no claim')
}

section('a store read back')
{
  const s = fromJSON({ repo: 'r', now: 3, facts: { 'form_repair:run_tests:x': { id: 'form_repair:run_tests:x', family: 'form_repair', params: { intent: 'run_tests', a: 'x' }, life: newLife(false, false) },
    'boundary:fetch_remote': { id: 'boundary:fetch_remote', family: 'boundary', params: { hosts: { 'a.example': 1 } }, life: newLife(true, false) } } }, 'r')
  eq(Object.keys(s.facts), ['boundary:fetch_remote'], 'a fact missing its family\'s params is dropped, never folded')
}

section('empty probe and boundary')
{ // test_history_fact_forms_only_when_probes_return_nothing
  const { s } = stream(range(0, 4).map((i) => [edit(`pkg/e${i}.py`), cmd('git remote -v; git tag --contains HEAD | head', '', 0), cmd(`${PROJ} -m pytest tests -q`, '1 passed', 0)]))
  eq(render(s), block('This checkout has no git remote and no branches, tags or unreachable objects beyond HEAD; its history ends at the checked-out commit.'), 'probes that always come back empty form the history fact')
  const leaky = stream(range(0, 4).map((i) => [edit(`pkg/l${i}.py`), cmd('git tag --contains HEAD | head', '0.22\n0.22.1\n0.23.0', 0)]), newStore('acme/leaky')).s
  eq([render(leaky), leaky.facts['empty_probe:vcs_refs'].life.state, leaky.facts['empty_probe:vcs_refs'].life.retiredAt], ['', 'RETIRED', 0], 'a probe that returns tags retires the high-stakes fact at once, even as a candidate')
}
{ // test_refused_hosts_form_a_boundary_fact_and_a_reachable_host_does_not
  const refused = (i) => [edit(`pkg/n${i}.py`),
    cmd('curl -sS https://raw.example.org/a/b.py', 'curl: (7) Failed to connect to raw.example.org port 443: Connection refused', 7),
    cmd('curl -sS https://api.example.org/search?q=x', 'curl: (7) Failed to connect to api.example.org port 443: Connection refused', 7)]
  const { s } = stream(range(0, 4).map(refused))
  eq(render(s), block('Outbound connections to raw.example.org and api.example.org are refused here; nothing can be fetched from them.'), 'refused hosts form a boundary fact')
  update(s, [cmd('curl -sS https://api.example.org/ok', '{"ok": true}', 0)], { iid: 'w-9', resolved: true })
  eq([s.facts['boundary:fetch_remote'].life.state, render(s)], ['RETIRED', ''], 'a later fetch from a listed host succeeding is a hard contradiction')
}

section('rendering discipline')
// test_lint_refuses_completion_advice
eq([lintOk('You are done once the tests pass; skip the rest.'), lintOk('`python …` fails here with command not found; `/x/bin/python …` works.')], [false, true], 'the lint refuses completion advice and passes a fact')
{ // test_block_is_capped_in_facts_and_tokens
  const s = newStore('acme/widget')
  for (const i of range(0, 7)) {
    const id = `form_repair:run_tests:tool${i}`
    s.facts[id] = { id, family: 'form_repair', params: { intent: 'run_tests', a: `tool${i}`, bCounts: { [`/very/long/path/number/${i}/that/keeps/going/bin/tool${i}`]: 3 }, errorCounts: { command_missing: 3 } }, life: life({ state: 'ACTIVE', fireNum: 10, fireDen: 10 }) }
  }
  const text = render(s)
  const line = (i) => `\`tool${i} …\` fails here with command not found; \`/very/long/path/number/${i}/that/keeps/going/bin/tool${i} …\` works.`
  eq([text, text.length <= MAX_CHARS + 1, (text.match(/\n- /g) || []).length <= MAX_FACTS, injectedIds(s)], [block(line(3), line(2), line(1), line(0)), true, true, range(0, 4).map((i) => `form_repair:run_tests:tool${i}`)],
    `the block is capped at ${MAX_FACTS} facts and about ${MAX_CHARS} characters`)
}

section('which working form a fact names')
{ // test_a_form_that_only_worked_with_an_assignment_before_it_is_not_named
  const messy = (i) => [edit(`pkg/m${i}.py`), cmd('pytest -q', 'bash: pytest: command not found', 127), cmd('pytest -q', 'bash: pytest: command not found', 127),
    cmd(`${LOCAL} -q`, "E   ModuleNotFoundError: No module named 'stock'\nInterrupted: 1 error during collection\n1 error in 0.08s", 2),
    cmd(`PYTHONPATH=. ${LOCAL} -q`, '4 passed in 0.01s', 0), cmd(`PYTHONPATH=. ${LOCAL} -q`, '4 passed in 0.01s', 0)]
  const { s } = stream([...range(0, 3).map(clean), ...range(3, 6).map(messy)])
  eq([s.facts['form_repair:run_tests:pytest'].params.bCounts, render(s)], [{ 'python -m pytest': 3 }, block('`pytest …` fails here with command not found; `python -m pytest …` works.')],
    'a VAR= form proves nothing for the bare form: `PYTHONPATH=. ~/.local/bin/pytest` passing is not counted for `~/.local/bin/pytest`')
}
{ // test_env_assignments_after_env_are_part_of_how_a_command_was_typed
  eq([...classifyCommand('env PYTHONPATH=. pytest -q'), ...classifyCommand('PYTHONPATH=. python -m pytest -q'), ...classifyCommand('python -m pytest -q')].map((o) => [o.intent, o.form, o.env]),
    [['run_tests', 'pytest', true], ['run_tests', 'python -m pytest', true], ['run_tests', 'python -m pytest', false]], 'assignments, after `env` too, are recorded on the observation and left out of its form')
}

section('the store (test_save_load_roundtrip, test_claude_schema_yields_the_same_fact, test_prefix_stage_envfacts_profile_needs_no_runner_and_reports_zero)')
{
  const { s } = stream(range(0, 4).map(broken))
  const text = render(s)
  const saved = JSON.parse(JSON.stringify(s))
  const back = fromJSON(saved)
  eq([Object.keys(saved), saved.now, saved.repo, saved.vocab, JSON.stringify(toJSON(s)) === JSON.stringify(s)], [['repo', 'now', 'vocab', 'facts'], 4, 'acme/widget', 'generic', true],
    'the saved store is { repo, now, vocab, facts }: what a session was given is the process\'s, never saved')
  eq([back.now, render(back), injectedIds(back)], [4, text, [PY_FACT]], 'read back, it renders the same block')
  eq([fromJSON('{not json', 'acme/x'), fromJSON({ now: -1, facts: { a: { id: 'b' }, [PY_FACT]: s.facts[PY_FACT] } })].map(toJSON),
    [{ repo: 'acme/x', now: 0, vocab: 'generic', facts: {} }, { repo: '', now: 0, vocab: 'generic', facts: { [PY_FACT]: s.facts[PY_FACT] } }], 'a malformed file or fact is dropped, never thrown')
}
{
  const { s } = stream(range(0, 4).map((i) => [{ name: 'Edit', input: { file_path: `/testbed/pkg/c${i}.py` }, result: 'ok', ok: true, cwd: null },
    sh('python -m pytest tests/test_a.py -q', `Exit code 1\n${BASE}: No module named pytest`), sh(`${PROJ} -m pytest tests/test_a.py -q`, '1 passed')]))
  eq(render(s), block(PY_LINE), 'Claude Code\'s Bash results (`Exit code 1` on an error) yield the same fact as an exit code')
}
{
  const s = newStore('acme/widget')
  eq(render(s), '', 'a fresh store renders nothing')
  update(s, [cmd('python -m pytest -q', `${BASE}: No module named pytest`, 1), cmd(`${PROJ} -m pytest -q`, '1 passed', 0)], { iid: 'w-1', resolved: true })
  eq([Object.keys(s.facts), s.now, s.lastDigest], [[PY_FACT], 1, { iid: 'w-1', resolved: true, at: null, injected: [], verdicts: { [PY_FACT]: ['confirm', true, true] }, nCalls: 2 }], 'one fold forms the candidate and records its verdict')
}

section('rtk (test_the_classifier_sees_through_rtks_command_prefix)')
for (const bare of ['python -m pytest tests/ -q', 'pytest -q', 'bin/test sympy/x.py', 'K=1 pytest -q', 'pip install foo', 'curl https://x', 'git status', 'rg -n foo src']) {
  const want = JSON.stringify(pairs(classifyCommand(bare)))
  ok(['rtk ', 'rtk proxy ', 'rtk K=2 '].every((pre) => JSON.stringify(pairs(classifyCommand(pre + bare))) === want), `\`${bare}\` classifies the same behind \`rtk \`, \`rtk proxy \` and \`rtk K=2 \``)
}
eq(['rtk pytest -q', 'rtk proxy make', 'rtk', 'rtkfoo bar', 'pytest'].map(stripRtkPrefix), ['pytest -q', 'make', 'rtk', 'rtkfoo bar', 'pytest'], 'the stripper is exact: a bare `rtk`, or a word that starts with the letters, is no wrapper')

section('test labels (test_envfacts_args.py)')
for (const [a, b, rule] of [ // test_only_a_shape_rewrite_counts_as_a_repair
  ['tests.model_inheritance', 'model_inheritance', ['strip', 'tests.']],
  ['tests.admin_views.tests', 'admin_views.tests', ['strip', 'tests.']],
  ['db.datetime.test_x::DateTests::test_a', 'db.datetime.test_x.DateTests.test_a', ['sep', '::']],
  ['db.datetime.test_x::DateTests', 'db.datetime.test_x', ['sep', '::']],
  ['model_fields.DurationFieldTests', 'model_fields', null], // a class that is not there
  ['admin_views.ChangeListTests', 'admin_views', null],
  ['app.tests', 'other.tests', null],
]) eq(labelRule(a, b), rule, `\`${a}\` → \`${b}\`: ${rule ? rule.join(' ') : 'no rewrite'}`)
// test_labels_are_the_structured_arguments_after_the_runner
eq([testLabels(classifyCommand('python tests/runtests.py tests.app -v 2 --settings=x 2>&1 | tail')[0]), testLabels(classifyCommand('python -m pytest pkg/test_a.py::T::test_b -q > /tmp/o.log')[0])],
  [['tests.app'], ['pkg/test_a.py::T::test_b']], 'labels are the structured arguments after the runner; option values and redirects are not')
{ // test_a_label_prefix_the_runner_rejects_becomes_a_fact
  const { s, rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), run(`tests.app${i}`, "ModuleNotFoundError: No module named 'tests'"), run(`app${i}`, OK)]))
  const f = s.facts['arg_repair:python tests/runtests.py:strip:tests.']
  eq([rendered[5], claim(f), lintOk(claim(f))], [block('`python tests/runtests.py` takes test labels without the `tests.` prefix (`app0`, not `tests.app0`).'), '`python tests/runtests.py` takes test labels without the `tests.` prefix (`app0`, not `tests.app0`).', true],
    'a label prefix the runner rejects becomes a fact')
}
{ // test_pytest_style_separators_the_runner_rejects_become_a_fact
  const { rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), run(`app${i}.tests::T::test_x`, `ImportError: Failed to import test module: app${i}.tests::T::test_x`), run(`app${i}.tests.T.test_x`, OK)]))
  eq(rendered[5], block('`python tests/runtests.py` takes dotted test labels (`module.Class.test`, not `module::Class::test`).'), 'pytest-style separators the runner rejects become a fact')
}
{ // test_a_plain_mistake_is_not_a_fact
  const { s, rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), run(`app${i}.tests.Missing`, `AttributeError: module 'app${i}.tests' has no attribute 'Missing'`), run(`app${i}`, OK)]))
  eq([s.facts, rendered[5]], [{}, ''], 'a label naming something that does not exist is a plain mistake, not a fact')
}
{ // test_a_prefixed_label_that_loads_contradicts_the_fact
  const tasks = range(0, 4).map((i) => [edit(`/r/pkg/mod${i}.py`), run(`tests.app${i}`, "ModuleNotFoundError: No module named 'tests'"), run(`app${i}`, OK)])
  const { s } = stream([...tasks, [edit('/r/pkg/mod9.py'), run('tests.app9', OK)]])
  eq(s.lastDigest.verdicts, { 'arg_repair:python tests/runtests.py:strip:tests.': ['contradict', false, true] }, 'a prefixed label that loads contradicts the fact')
}
{ // test_output_filtered_away_neither_teaches_nor_contradicts
  const tasks = range(0, 4).map((i) => [edit(`/r/pkg/mod${i}.py`), run(`app${i}.tests::T::test_x`, `app${i}.tests::T::test_x (unittest.loader._FailedTest) ... ERROR`), run(`app${i}.tests.T.test_x`, OK)])
  const { s } = stream([...tasks, [edit('/r/pkg/mod8.py'), run('app8.tests::T::test_x', 'FAILED (errors=1)'), run('app8.tests::T::test_y', '')]])
  const fid = 'arg_repair:python tests/runtests.py:sep:::'
  eq([s.lastDigest.verdicts[fid], s.facts[fid].life.state], [[null, false, true], 'ACTIVE'], 'output filtered away (`FAILED (errors=1)`, a silent run) neither teaches nor contradicts')
}
{ // test_a_repair_needs_the_rewritten_label_to_have_run_tests
  const { s } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), run(`tests.app${i}`, "ModuleNotFoundError: No module named 'tests'"), run(`app${i}`, '')]))
  eq(s.facts, {}, 'a repair needs the rewritten label to have run tests')
}
{ // test_mistyped_labels_do_not_teach_that_the_runner_fails
  const bad = "tests (unittest.loader._FailedTest) ... ERROR\nImportError: Failed to import test module: tests\nModuleNotFoundError: No module named 'tests.app'"
  const { s, rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), run(`tests.app${i}.tests.T`, bad), sh(`cd tests && python runtests.py app${i}.tests.T -v 2`, OK)]))
  eq([s.facts, rendered[5]], [{}, ''], 'mistyped labels (a ModuleNotFoundError inside `_FailedTest`) do not teach that the runner fails')
}
// test_a_directory_change_is_part_of_the_form
{ const o = classifyCommand('cd tests && python runtests.py forms -v 2')[0]; eq([o.form, testLabels(o)], ['cd tests && python runtests.py', ['forms']], 'a directory change is part of the form') }
// test_a_missing_runner_is_still_a_form_failure_not_a_label_one
eq([
  labelFailed(['tests/test_a.py'], '/usr/bin/python3: No module named pytest'),
  labelFailed(['tests.app'], "ModuleNotFoundError: No module named 'tests'"),
  labelFailed(['app.tests.Missing'], "AttributeError: module 'app.tests' has no attribute 'Missing'"),
  labelFailed(['app.tests'], "AttributeError: 'NoneType' object has no attribute 'pk'"),
], [false, true, true, false], 'a missing runner is a form failure, not a label one')

section('never a secret (grimoire: the block reaches every later session)')
{
  const NEED_KEY = 'Traceback (most recent call last):\nRuntimeError: missing environment variable STRIPE_API_KEY'
  const { s, rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/k${i}.py`), py('import app; app.run()', NEED_KEY), py('import app; app.run()', 'ran', 'STRIPE_API_KEY=sk_live_51Habc123SECRET ')]))
  eq([s.facts['env_value:STRIPE_API_KEY'].params, rendered[5]], [{ var: 'STRIPE_API_KEY', good: { '<redacted>': 6 }, bad: {} },
    block('Code that imports the project needs `STRIPE_API_KEY` set here (its value is not recorded).')], 'a secret-looking variable\'s value is never stored nor shown: the fact names the variable only')
  const NEED_DB = 'Traceback (most recent call last):\nRuntimeError: missing environment variable APP_DB'
  const db = stream(range(0, 6).map((i) => [edit(`/r/pkg/d${i}.py`), py('import app', NEED_DB), py('import app', 'ran', 'APP_DB=postgres://admin:hunter2@db.internal/app ')])).s
  ok(!JSON.stringify(db.facts).includes('hunter2') && !render(db).includes('hunter2'), 'a value that is not a short plain word or path (a URL with credentials) is redacted, whatever the name')
  eq(['ghp_AbCdEf1234567890xyz', 'sk_live_51Habc123SECRET', 'AKIAABCDEFGHIJKLMNOP', 'a1b2c3d4e5f6a7b8c9d0e1', 'conf.dev', '/testbed', 'tests.settings.local', '1', 'production'].map((v) => safeEnvValue('GH_STUFF', v)),
    ['<redacted>', '<redacted>', '<redacted>', '<redacted>', 'conf.dev', '/testbed', 'tests.settings.local', '1', 'production'], 'a token-shaped value is redacted under any name; plain words, paths and dotted names are kept')
  const clone = (i) => [edit(`pkg/c${i}.py`), cmd('git clone https://x-access-token:ghp_AbCdEf123456@github.com/acme/private.git', "fatal: unable to access 'https://github.com/acme/private.git/': Could not resolve host: github.com", 128)]
  const cl = stream(range(0, 4).map(clone)).s
  ok(!JSON.stringify(cl.facts).includes('ghp_') && render(cl).includes('github.com') && !render(cl).includes('x-access-token'), `a URL's userinfo never reaches a host (${render(cl).split('\n')[1] || 'no block'})`)
}

section('environment variables (test_envfacts_args.py)')
const NEED = 'Traceback (most recent call last):\n  ...\nRuntimeError: settings are missing. Define the environment variable APP_SETTINGS before importing app.'
{ // test_an_environment_variable_the_code_asks_for_and_its_working_value_become_a_fact
  const { s, rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), py('import app; app.run()', NEED),
    py('import app; app.run()', "Traceback (most recent call last):\nModuleNotFoundError: No module named 'conf.missing'", 'APP_SETTINGS=conf.missing '),
    py('import app; app.run()', 'ran', 'APP_SETTINGS=conf.dev ')]))
  const line = 'Code that imports the project needs `APP_SETTINGS` set here: `APP_SETTINGS=conf.dev` works, `conf.missing` does not.'
  eq([rendered[5], lintOk(claim(s.facts['env_value:APP_SETTINGS']))], [block(line), true], 'a variable the code asks for and its working value become a fact')
}
{ // test_a_value_set_in_the_code_counts_too
  const code = 'import os; os.environ.setdefault("APP_SETTINGS", "conf.dev"); import app'
  const { s } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), py('import app', NEED), sh(`python -c '${code}'`, 'ran')]))
  eq(s.facts['env_value:APP_SETTINGS'].params, { var: 'APP_SETTINGS', good: { 'conf.dev': 6 }, bad: {} }, 'a value set in the code counts too')
}
{ // test_no_value_that_worked_means_no_fact
  const { s } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), py('import app', NEED), py('import app', 'Traceback (most recent call last):\nNameError: x', 'APP_SETTINGS=conf.missing ')]))
  eq(s.facts, {}, 'no value that worked means no fact')
}
{ // test_being_asked_for_the_variable_again_does_not_confirm_its_value
  const { s, rendered } = stream([[edit('/r/pkg/mod0.py'), py('import app', NEED), py('import app', 'ran', 'APP_SETTINGS=conf.dev ')], ...range(1, 6).map((i) => [edit(`/r/pkg/mod${i}.py`), py('import app', NEED)])])
  const l = s.facts['env_value:APP_SETTINGS'].life
  eq([l.state, l.confirms, l.fireNum, l.fireDen, rendered[5]], ['CANDIDATE', confirms([0, 'mod0.py']), 6, 6, ''], 'being asked for the variable again fires, but does not confirm its value')
}

section('directories (test_envfacts_args.py)')
{ // test_a_bare_runner_in_a_directory_an_earlier_cd_left_is_learned_with_that_cd
  const { s, rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`, ROOT), sh('python -m pytest tests/app/tests.py -q', '/venv/bin/python: No module named pytest', ROOT),
    sh(`cd tests && python runtests.py app${i} -v 2`, OK, ROOT), sh(`python runtests.py app${i}.tests -v 2`, OK, ROOT + '/tests'),
    sh('python runtests.py app.tests 2>&1 | tail -3', "python: can't open file 'runtests.py': [Errno 2] No such file or directory", ROOT)]))
  eq([rendered[5], Object.keys(s.facts)], [block('`python -m pytest …` fails here with ModuleNotFoundError; `(cd tests && python runtests.py …)` works.'), [PY_FACT]],
    'a bare runner in the directory an earlier `cd` left is learned with that `cd`, shown as a subshell')
}
// test_a_cd_into_the_start_directory_by_absolute_path_is_no_cd
eq([
  classifyCommand('cd /r && python tests/runtests.py app', { cwd: '', root: '/r' }),
  classifyCommand('cd /r/tests && python runtests.py app', { cwd: '', root: '/r' }),
  classifyCommand('cd .. && python runtests.py app', { cwd: 'tests', root: '/r' }),
  classifyCommand('python runtests.py app', { cwd: 'tests', root: '/r' }),
  classifyCommand('cd /elsewhere && python runtests.py app', { cwd: '', root: '/r' }),
].map((o) => o[0].form), ['python tests/runtests.py', 'cd tests && python runtests.py', 'python runtests.py', 'cd tests && python runtests.py', 'cd /elsewhere && python runtests.py'],
'a `cd` into the start directory by absolute path is no `cd`; leaving it is taken as typed')
{ // test_a_cd_up_to_the_repository_from_a_subdirectory_is_no_cd
  const kw = { cwd: '', root: '/r/pkg', top: '/r' }
  eq([
    classifyCommand('cd /r && pytest -q', kw), classifyCommand('cd .. && pytest -q', kw), classifyCommand('cd /r && cd tests && python runtests.py app', kw),
    classifyCommand('cd /r/tests && python runtests.py app', kw), classifyCommand('cd /elsewhere && pytest -q', kw), classifyCommand('cd /r && pytest -q', { cwd: '', root: '/r/pkg' }),
  ].map((o) => o[0].form), ['pytest', 'pytest', 'cd tests && python runtests.py', 'cd /r/tests && python runtests.py', 'cd /elsewhere && pytest', 'cd /r && pytest'],
  'a `cd` up to the repository from a subdirectory is no `cd`; anywhere else above the start, or no repository known, is as typed')
}
const tmp = mkdtempSync(path.join(tmpdir(), 'grimoire-facts-'))
try {
  // test_the_repository_is_the_nearest_directory_holding_git
  mkdirSync(path.join(tmp, 'repo', '.git'), { recursive: true })
  mkdirSync(path.join(tmp, 'repo', 'pkg', 'sub'), { recursive: true })
  mkdirSync(path.join(tmp, 'wt', 'pkg'), { recursive: true })
  writeFileSync(path.join(tmp, 'wt', '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n')
  eq([repositoryTop(path.join(tmp, 'repo', 'pkg', 'sub')), repositoryTop(path.join(tmp, 'wt', 'pkg')), repositoryTop('relative/path'), repositoryTop(path.join(tmp, 'repo', 'gone'))],
    [path.join(tmp, 'repo'), path.join(tmp, 'wt'), null, null], 'the repository is the nearest directory holding `.git` (a worktree\'s file too); a relative or removed start has none')
  { // test_sessions_started_in_a_subdirectory_learn_the_repositorys_plain_form
    const repo = path.join(tmp, 'repo'), start = path.join(repo, 'pkg')
    const { s, rendered } = stream(range(0, 6).map((i) => [edit(`${repo}/pkg/m${i}.py`, start), sh(`cd ${repo} && pytest -q`, 'bash: line 1: pytest: command not found', start), sh(`cd ${repo} && python -m pytest -q`, '1 passed in 0.1s', start)]))
    eq([rendered[5], Object.keys(s.facts)], [block('`pytest …` fails here with command not found; `python -m pytest …` works.'), ['form_repair:run_tests:pytest']],
      'sessions started in a subdirectory learn the repository\'s plain form: no machine path in a form')
  }
  { // test_call_directories_line_up_with_the_calls (grimoire's transcript reader records each call's directory)
    const f = path.join(tmp, 't.jsonl')
    const use = (id, name, input, cwd) => ({ type: 'assistant', ...(cwd ? { cwd } : {}), message: { id: `m${id}`, content: [{ type: 'tool_use', id: `t${id}`, name, input }] } })
    const res = (id, content) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${id}`, content }] } })
    writeFileSync(f, [use(0, 'Bash', { command: 'ls' }, ROOT), res(0, 'a'), use(1, 'Read', { file_path: '/r/a' }), res(1, 'x'), use(2, 'Bash', { command: 'ls' }, ROOT + '/tests'), res(2, 'b')].map((l) => JSON.stringify(l)).join('\n'))
    eq(readTranscript(f).calls.map((c) => c.cwd), [ROOT, null, ROOT + '/tests'], 'the calls\' directories line up with the calls')
  }
} finally { rmSync(tmp, { recursive: true, force: true }) }
// test_a_command_stopped_by_its_own_cd_teaches_nothing
eq(observeCalls([sh('cd tests && python runtests.py app', 'Exit code 1\n/bin/bash: line 1: cd: tests: No such file or directory', ROOT + '/tests')]).obs, [], 'a command stopped by its own `cd` teaches nothing')
const CANT_OPEN = "Exit code 2\npython: can't open file 'runtests.py': [Errno 2] No such file or directory"
{ // test_a_runner_script_run_where_it_is_not_becomes_a_fact
  const { rendered } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`, ROOT), sh(`python runtests.py app${i}`, CANT_OPEN, ROOT), sh(`cd tests && python runtests.py app${i}`, OK, ROOT)]))
  eq(rendered[5], block('`python runtests.py …` fails here with a file-not-found error; `(cd tests && python runtests.py …)` works.'), 'a runner script run where it is not becomes a fact')
}
{ // test_an_option_the_runner_rejects_is_not_a_failing_form
  const bad = 'Exit code 2\nusage: runtests.py [-h] [module [module ...]]\nruntests.py: error: unrecognized arguments: test_x'
  const { s } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`, ROOT), sh(`python runtests.py app${i} -k test_x`, bad, ROOT + '/tests'), sh(`python tests/runtests.py app${i}`, OK, ROOT)]))
  eq(s.facts, {}, 'an option the runner rejects is not a failing form')
}
{ // test_a_working_form_that_leaves_the_shell_where_it_is_is_the_one_named
  const tasks = range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`, ROOT), sh(`python runtests.py app${i}`, CANT_OPEN, ROOT), sh(`cd tests && python runtests.py app${i}`, OK, ROOT), sh(`cd tests && python runtests.py app${i}.tests`, OK, ROOT)])
  tasks[3].push(sh('python tests/runtests.py app3', OK, ROOT))
  const { s, rendered } = stream(tasks)
  eq([s.facts['form_repair:run_tests:python runtests.py'].params.bCounts, rendered[5]], [{ 'cd tests && python runtests.py': 6, 'python tests/runtests.py': 1 }, block('`python runtests.py …` fails here with a file-not-found error; `python tests/runtests.py …` works.')],
    'a working form that leaves the shell where it is is the one named, however rarely it worked')
}

section('pinned (#52): timeout, plain git tag, VAR=, pipes, a prevented failure, rtk')
eq([...classifyCommand('timeout 30 pytest -q'), ...classifyCommand('timeout 60 python -m pytest tests/x.py'), ...classifyCommand('timeout 10 curl https://h.example/x')].map((o) => [o.intent, o.form, o.hosts]),
  [['run_tests', 'pytest', []], ['run_tests', 'python -m pytest', []], ['fetch_remote', 'curl', ['h.example']]], 'a `timeout` prefix consumes its argument: `timeout 30 pytest` is the `pytest` form, not a `30` command')
eq(classifyCommand('timeout 5'), [], '`timeout N` with no command is nothing')
{
  const { s } = stream(range(0, 4).map((i) => [edit(`pkg/t${i}.py`), sh('timeout 60 pytest -q', 'Exit code 127\nbash: pytest: command not found'), sh('timeout 60 python -m pytest -q', '3 passed in 0.1s')]))
  eq(render(s), block('`pytest …` fails here with command not found; `python -m pytest …` works.'), 'and the forms learned through `timeout` are the bare ones')
}
eq(['git tag', 'git tag | tail -5', 'git tag -l "v*"', 'git tag --contains HEAD'].map((c) => classifyCommand(c).map((o) => o.probe)), [[], [], [], ['tag']], 'plain `git tag` is not a probe; only `git tag --contains` is')
eq(observeCalls([cmd('git tag', 'v1.0\nv1.1', 0)]).obs, [], 'so a plain `git tag` listing past tags neither forms nor contradicts the history fact')
{
  const o = observeCalls([cmd('PYTHONPATH=. pytest -q', '4 passed', 0)]).obs[0]
  eq([o.form, o.env, o.outcome], ['pytest', true, 'ran'], 'a `VAR=` form is observed as the bare form with `env` set, so it never counts as the bare form working as typed')
}
{
  const filtered = observeCalls([sh("python runtests.py app 2>&1 | grep -E '^(OK|FAILED|Ran )'", '(Bash completed with no output)')]).obs[0]
  const tailed = observeCalls([sh('python -m pytest -q 2>&1 | tail -3', 'collecting ...')]).obs[0]
  const fetchGrep = observeCalls([sh('curl -sS https://h.example/x | grep ok', 'ok')]).obs[0]
  const fetchHead = observeCalls([sh('curl -sS https://h.example/x | head -3', 'ok')]).obs[0]
  eq([[filtered.outcome, filtered.testsRan, formWorked(filtered)], [tailed.outcome, tailed.testsRan, formWorked(tailed)], fetchGrep.outcome, fetchHead.outcome],
    [['ran', false, false], ['ran', false, false], null, 'ran'],
    'piped output proves no exit code: a test run must show tests running, and a fetch piped through a filter that rewrites its output is not judged (a pass-through `head` is)')
  const { s } = stream(range(0, 6).map((i) => [edit(`/r/pkg/mod${i}.py`, ROOT), sh('python -m pytest tests/app', 'Exit code 1\n/venv/bin/python: No module named pytest', ROOT),
    sh(`python runtests.py app${i} 2>&1 | grep -E '^(OK|FAILED|Ran )'`, '(Bash completed with no output)', ROOT)]))
  eq(s.facts, {}, 'so a piped run whose output was filtered away does not show a form works (test_a_run_whose_output_was_filtered_away_does_not_show_a_form_works)')
}
{ // test_prevented_waste_still_counts_as_firing, in one process and across two
  const followed = [edit('pkg/z.py'), cmd(`${PROJ} -m pytest tests/test_z.py -q`, '3 passed', 0)]
  const { s } = stream(range(0, 4).map(broken))
  eq([render(s), injectedIds(s)], [block(PY_LINE), [PY_FACT]], 'injected for the next session')
  update(s, followed, { iid: 'w-9', resolved: true })
  eq(injectedIds(s), [], 'a fold clears what the session was given')
  eq([s.facts[PY_FACT].life.fireNum, s.facts[PY_FACT].life.fireDen, s.lastDigest.verdicts[PY_FACT], render(s)], [5, 5, ['confirm', true, true], block(PY_LINE)],
    'a prevented failure keeps the fact: the agent used the working form at once, nothing failed, and the fact still fired')
  const twoProcesses = (seed) => {
    const a = stream(range(0, 4).map(broken)).s
    render(a) // the session-start process renders...
    const ids = injectedIds(a)
    const b = fromJSON(JSON.parse(JSON.stringify(a))) // ...and the fold runs in another, from the saved store
    if (seed) seedInjected(b, [...ids, 'form_repair:run_tests:gone'])
    update(b, followed, { iid: 'w-9', resolved: true })
    return [b.lastDigest.injected, b.facts[PY_FACT].life.fireNum, b.facts[PY_FACT].life.fireDen]
  }
  eq([twoProcesses(true), twoProcesses(false)], [[[PY_FACT], 5, 5], [[], 4, 5]], 'across processes the fold must be told what was given (`seedInjected`, unknown ids dropped): unseeded, the prevented failure does not fire')
}
{
  const { s, rendered } = stream(range(0, 4).map((i) => [edit(`src/a${i}.ts`), sh('rtk npm run build', 'Exit code 127\nsh: tsc: command not found'), sh('rtk proxy npx tsc -p .', 'ok')]))
  eq([rendered[3], render(s)], ['', block('`npm run build …` fails here with command not found; `npx tsc …` works.')], 'an rtk-prefixed build learns the same fact as the bare one: no `rtk` in a form')
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
