// ════════════════════════════════════════════════════════════════════════════
//  Tests — hooks/scripts/economy.mjs: the stuck watch on dispatched agents, shadow (#49)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node hooks/scripts/economy.test.mjs
//
//  What this locks down, through the real hook process (Claude Code's JSON on stdin):
//    • every answer is {} under shadow, malformed input included, which logs one error line
//    • 20 failing calls with one signature write a judge request holding the digest, never content
//    • reads and greps of a file full of asserts never count as failures
//    • GRIMOIRE_ECONOMY=0, no agent_id, and economy.loopGuard "off" write nothing that watches
//    • state lands in the MAIN checkout's .grimoire/economy, from a linked worktree too
//    • SubagentStop feeds the role's envelope only from a dispatch that ended green; a busy lock
//      drops the sample with an error line; stuck past 2.5× the envelope, a dispatch is would-redirect
//    • a judge's verdict on the current segment is recorded; one on an older segment is ignored
//    • under "on" (#51): a ready verdict sends the redirect (the judge's, else the template) as
//      additionalContext under the incoming event name, the next one the BLOCKED line; the backstop
//      redirects without a judge; the main session gets the free rules only, then a systemMessage
//    • the handler's median time per call stays under 30 ms (spike S2)
import { spawnSync, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle } from './economy.mjs'

const HOOK = new URL('./economy.mjs', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)
const section = (t) => console.log(`\n── ${t}`)

const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'grimoire-economy-hook-')))
const project = (name, config = { repos: [{ name: 'api', path: 'repositories/api', agent: 'api-engineer' }] }) => {
  const p = join(SANDBOX, name)
  mkdirSync(join(p, 'repositories', 'api'), { recursive: true })
  writeFileSync(join(p, 'grimoire.config.json'), JSON.stringify(config))
  return p
}
const run = (proj, payload, env = {}) => spawnSync(process.execPath, [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: proj, GRIMOIRE_ECONOMY: '', ...env } })
const eco = (proj) => join(proj, '.grimoire', 'economy')
const readJ = (p) => JSON.parse(readFileSync(p, 'utf8'))
const FAIL_OUT = 'Traceback (most recent call last):\n  File "/r/a.py", line 3\nAssertionError: 3 != 4\nFAILED (failures=1)'
const call = (proj, id, tool, input, response, extra = {}) => ({ hook_event_name: 'PostToolUse', cwd: join(proj, 'repositories', 'api'), session_id: 's', agent_id: id, agent_type: 'api-engineer', tool_name: tool, tool_input: input, tool_response: response, ...extra })
const failing = (proj, id, i) => call(proj, id, 'Bash', { command: 'python -m pytest -q' }, '', { hook_event_name: 'PostToolUseFailure', error: FAIL_OUT.replace('3 != 4', `${i} != ${i + 1}`) })
const edit = (proj, id, n) => call(proj, id, 'Edit', { file_path: join(proj, 'repositories', 'api', 'src', 'a.py'), old_string: 'x', new_string: `y${n}` }, { filePath: 'a.py' })
const stop = (proj, id) => ({ hook_event_name: 'SubagentStop', cwd: join(proj, 'repositories', 'api'), agent_id: id, agent_type: 'api-engineer', agent_transcript_path: '/x.jsonl', stop_hook_active: false })

try {
  section('20 failing calls with one signature: a judge request, and {} every time')
  {
    const P = project('loop')
    const outs = []
    for (let i = 0; i < 20; i++) outs.push(run(P, i % 2 ? failing(P, 'agent-1', i) : edit(P, 'agent-1', i)).stdout)
    ok(outs.every((o) => o === '{}'), `every answer is {} (${[...new Set(outs)].join(' | ')})`)
    const req = join(eco(P), 'judge', 'agent-1.request.json')
    ok(existsSync(req), 'the gate opened: a judge request is written')
    const r = existsSync(req) ? readJ(req) : {}
    eq([r.agentId, r.agentType, r.repo, r.segment, r.calls], ['agent-1', 'api-engineer', 'api', 0, 18], 'the request names the agent, its role and where the gate opened (18 calls)')
    ok(/turns=18 edit_churn=9 distinct_edit_files=1 error_outputs=9/.test(r.digest || '') && /\$ python -m pytest -q {2}\[err#[0-9a-f]{10}\]/.test(r.digest || '') && !/AssertionError|3 != 4/.test(r.digest || ''),
      `its digest holds counts, commands and failure signatures, never the output (${(r.digest || '').split('\n')[0]})`)
    ok(/No test or verification run|The last verification run failed/.test(r.digest || ''), 'and how the last verification went')
    const t = readJ(join(eco(P), 'turns', 'agent-1.json'))
    eq([t.calls, t.whole.errorOutputs, t.whole.repeatedFailSigs, t.repo, t.mode], [20, 10, 9, 'api', 'shadow'], 'the state: 20 calls, 10 failures, 9 repeats, its repo matched from the config, shadow mode')
  }

  section('what is never watched, and what never counts')
  {
    const P = project('quiet')
    eq(run(P, 'secret-token-123 { not json').stdout, '{}', 'malformed input: {}')
    const log = join(eco(P), 'errors.log')
    const logged = existsSync(log) ? readFileSync(log, 'utf8') : ''
    ok(logged.trim().split('\n').length === 1 && / unparsed the hook input is not JSON(?: \(at (?:position|line) [^)]+\))?\n$/.test(logged) && !logged.includes('secret-token'), `and one line in errors.log, its position only, never the input (${logged.trim()})`)
    for (let i = 0; i < 20; i++) run(P, failing(P, 'off-agent', i), { GRIMOIRE_ECONOMY: '0' })
    ok(!existsSync(join(eco(P), 'turns')), 'GRIMOIRE_ECONOMY=0: nothing written')
    const main = { ...failing(P, 'x', 1) }
    delete main.agent_id
    eq(run(P, main).stdout, '{}', 'the main session (no agent_id): {}')
    ok(!existsSync(join(eco(P), 'turns')), 'and nothing written under shadow')
    const file = "def test_total():\n    assert total([1, 2]) == 3\n    raise ValueError('no')\n"
    for (let i = 0; i < 6; i++) {
      run(P, call(P, 'reader', 'Read', { file_path: 'tests/test_total.py' }, { type: 'text', file: { content: file } }))
      run(P, call(P, 'reader', 'Grep', { pattern: 'assert' }, { content: 'tests/test_total.py:2:    assert total' }))
    }
    eq(readJ(join(eco(P), 'turns', 'reader.json')).whole.errorOutputs, 0, 'reads and greps of a file full of asserts: no failure')
    const O = project('off', { repos: [{ name: 'api', path: 'repositories/api' }], economy: { loopGuard: 'off' } })
    for (let i = 0; i < 20; i++) run(O, failing(O, 'a', i))
    eq([readJ(join(eco(O), 'turns', 'a.json')), existsSync(join(eco(O), 'judge'))], [{ v: 1, off: true }, false], 'economy.loopGuard "off": one marker, no state, no request')
  }

  section('loopGuard "on": the redirect, then BLOCKED, delivered to the agent (spike S1: subagent context)')
  {
    const P = project('on-agent', { repos: [{ name: 'api', path: 'repositories/api' }], economy: { loopGuard: 'on' } })
    for (let i = 0; i < 18; i++) run(P, i % 2 ? failing(P, 'w', i) : edit(P, 'w', i))
    mkdirSync(join(eco(P), 'judge'), { recursive: true })
    writeFileSync(join(eco(P), 'judge', 'w.result.json'), JSON.stringify({ segment: 0, stuck: true, confidence: 0.9, reason: 'same failure, same file', redirect: 'Re-read the failing assertion in tests/test_a.py before editing src/a.py again.' }))
    eq(JSON.parse(run(P, edit(P, 'w', 50)).stdout), { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Re-read the failing assertion in tests/test_a.py before editing src/a.py again.' } },
      'a ready verdict: the judge\'s redirect, as additionalContext under the incoming event name')
    const t1 = readJ(join(eco(P), 'turns', 'w.json'))
    eq([t1.segment, t1.events.map((e) => e.action)], [1, ['redirect']], 'recorded as redirect (no would-), and a fresh segment starts')
    writeFileSync(join(eco(P), 'judge', 'w.result.json'), JSON.stringify({ segment: 1, stuck: true, confidence: 0.8, reason: 'still the same failure' }))
    const blocked = JSON.parse(run(P, failing(P, 'w', 99)).stdout)
    eq(blocked, { hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: 'Stop now and return BLOCKED. Begin your summary with `STUCK WATCH w:`, then say what you tried and give this reason: judge-stuck@0.80: still the same failure. The automated stuck watch redirected you once and still sees a loop.' } },
      'the next stuck verdict: one line telling it to return BLOCKED, naming its record, under PostToolUseFailure for a failed call')
    const rec = readJ(join(eco(P), 'judge', 'w.blocked.json'))
    eq([rec.agentId, rec.repo, rec.segment, rec.calls, rec.reason], ['w', 'api', 1, 20, 'judge-stuck@0.80: still the same failure'], 'the record the resolve rung reads: who, where, and why')
    ok(/^turns=1 /.test(rec.digest) && /\[err#[0-9a-f]{10}\]/.test(rec.digest) && !/AssertionError/.test(rec.digest), `its digest: counts and failure signatures, never output (${rec.digest.split('\n')[0]})`)
    ok(!existsSync(join(eco(P), 'judge', 'w.request.json')), 'a pending judge request is dropped at the block')
    eq(run(P, edit(P, 'w', 100)).stdout, '{}', 'after the block, nothing more is sent')
    // the backstop redirects without a judge once the role has an envelope
    const B = project('on-backstop', { repos: [{ name: 'api', path: 'repositories/api' }], economy: { loopGuard: 'on' } })
    mkdirSync(eco(B), { recursive: true })
    writeFileSync(join(eco(B), 'envelope.json'), JSON.stringify({ 'api/api-engineer': { resolved: [6, 6, 6, 6, 6] } }))
    const outs = []
    for (let i = 0; i < 22; i++) outs.push(run(B, i % 2 ? failing(B, 'b', i) : edit(B, 'b', i)).stdout)
    const fired = outs.map((o, i) => [i + 1, o]).filter(([, o]) => o !== '{}')
    ok(fired.length === 1 && fired[0][0] === 20 && JSON.parse(fired[0][1]).hookSpecificOutput.additionalContext.startsWith('Process check (automated): so far you\'ve made 10 edits'),
      `past the backstop with no judge: the template redirect, once (${fired.map(([n]) => n).join(', ')})`)
    // an envelope-tier verdict alone does not act under "on": the judge decides
    const E = project('on-envelope', { repos: [{ name: 'api', path: 'repositories/api' }], economy: { loopGuard: 'on' } })
    mkdirSync(eco(E), { recursive: true })
    writeFileSync(join(eco(E), 'envelope.json'), JSON.stringify({ 'api/api-engineer': { resolved: [12, 12, 12, 12, 12] } }))
    const eouts = []
    for (let i = 0; i < 22; i++) eouts.push(run(E, i % 2 ? failing(E, 'e', i) : edit(E, 'e', i)).stdout)
    ok(eouts.every((o) => o === '{}'), 'stuck past the envelope but not the backstop: nothing sent without a judge\'s verdict')
  }

  section('loopGuard "on" in the main session: free rules only, one redirect line, then a notice')
  {
    const P = project('on-main', { repos: [{ name: 'api', path: 'repositories/api' }], economy: { loopGuard: 'on' } })
    const mainCall = (sid, payload) => { const p = { ...payload, session_id: sid }; delete p.agent_id; delete p.agent_type; return p }
    const prompt = (sid) => run(P, { hook_event_name: 'UserPromptSubmit', cwd: join(P, 'repositories', 'api'), session_id: sid, prompt: 'go' })
    const stopM = (sid) => run(P, { hook_event_name: 'Stop', cwd: join(P, 'repositories', 'api'), session_id: sid, stop_hook_active: false })
    for (let k = 0; k < 5; k++) { // five green turns: the main role's envelope
      prompt('ses')
      for (let i = 0; i < 5; i++) run(P, mainCall('ses', edit(P, 'x', i)))
      run(P, mainCall('ses', call(P, 'x', 'Bash', { command: 'pytest -q' }, { stdout: '3 passed in 0.10s', stderr: '' })))
      stopM('ses')
    }
    eq(readJ(join(eco(P), 'envelope.json'))['api/main'].resolved, [6, 6, 6, 6, 6], 'each green main-session turn feeds the main role\'s envelope at Stop')
    prompt('ses')
    const outs = []
    for (let i = 0; i < 44; i++) outs.push(run(P, mainCall('ses', i % 2 ? failing(P, 'x', i) : edit(P, 'x', i))).stdout)
    const fired = outs.map((o, i) => [i + 1, o && JSON.parse(o)]).filter(([, o]) => o && Object.keys(o).length)
    eq(fired.map(([n, o]) => [n, Object.keys(o)]), [[20, ['hookSpecificOutput']], [40, ['systemMessage']]], 'a looping turn: one redirect line at call 20, then a notice at call 40, nothing else')
    ok(fired[0][1].hookSpecificOutput.additionalContext.startsWith('Process check (automated)') && /stuck watch: this turn still looks like a loop after a redirect .* press Esc/i.test(fired[1][1].systemMessage),
      `the redirect is the template; the notice is for the person (${fired[1] && fired[1][1].systemMessage})`)
    ok(!existsSync(join(eco(P), 'judge', 'main-ses.request.json')), 'no judge request for the main session')
    stopM('ses')
    ok(!existsSync(join(eco(P), 'turns', 'main-ses.json')), 'Stop closes the turn')
    const S = project('shadow-main')
    eq(run(S, mainCall('z', failing(S, 'x', 1))).stdout, '{}', 'under shadow, a main-session call is not watched')
    ok(!existsSync(join(eco(S), 'turns')), 'and nothing is written')
  }

  section('a written file is no output')
  {
    const P = project('writes')
    for (let i = 0; i < 20; i++) {
      const content = `def test_${i}():\n    assert f(${i}) == ${i}\n    raise ValueError('no')\n`
      run(P, call(P, 'writer', 'Write', { file_path: `tests/t${i}.py`, content }, { type: 'create', filePath: `tests/t${i}.py`, content, structuredPatch: [], originalFile: null, userModified: false }))
    }
    const t = readJ(join(eco(P), 'turns', 'writer.json'))
    eq([t.calls, t.whole.errorOutputs, t.whole.repeatedFailSigs, existsSync(join(eco(P), 'judge', 'writer.request.json'))], [20, 0, 0, false],
      "20 Writes of test files full of asserts (Claude Code's Write response carries the file): no failure, no request")
    run(P, call(P, 'sh', 'Bash', { command: 'cat a.py' }, { stdout: 'all good', stderr: 'ValueError: boom', interrupted: false, isImage: false }))
    eq(readJ(join(eco(P), 'turns', 'sh.json')).whole.errorOutputs, 1, "a Bash response's stdout and stderr are read")
  }

  section('one agent\'s parallel calls are all folded')
  {
    const P = project('parallel')
    const procs = Array.from({ length: 8 }, (_, i) => new Promise((done) => {
      const c = spawn(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_PROJECT_DIR: P, GRIMOIRE_ECONOMY: '' } })
      let out = ''
      c.stdout.on('data', (d) => { out += d })
      c.on('close', () => done(out))
      c.stdin.end(JSON.stringify(edit(P, 'par', i)))
    }))
    const outs = await Promise.all(procs)
    const t = readJ(join(eco(P), 'turns', 'par.json'))
    eq([outs.every((o) => o === '{}'), t.calls, t.edits], [true, 8, 8], 'eight concurrent hook calls of one agent: eight folds, none lost')
  }

  section('a resumed agent, and a judge\'s verdict under shadow')
  {
    const P = project('resume')
    for (let i = 0; i < 2; i++) run(P, edit(P, 'res', i))
    run(P, call(P, 'res', 'Bash', { command: 'pytest -q' }, { stdout: '1 passed in 0.10s', stderr: '' }))
    run(P, stop(P, 'res'))
    run(P, edit(P, 'res', 9)); run(P, call(P, 'res', 'Bash', { command: 'pytest -q' }, { stdout: '1 passed in 0.10s', stderr: '' }))
    run(P, stop(P, 'res'))
    eq(readJ(join(eco(P), 'envelope.json'))['api/api-engineer'].resolved, [3, 5], 'an agent resumed after it stopped is watched again, and its next stop feeds the envelope')
    const O = project('shadow-judge')
    mkdirSync(join(eco(O), 'judge'), { recursive: true })
    run(O, edit(O, 'o', 0))
    writeFileSync(join(eco(O), 'judge', 'o.result.json'), JSON.stringify({ segment: 0, stuck: true, confidence: 0.9, redirect: 'Try another file.' }))
    eq(run(O, edit(O, 'o', 1)).stdout, '{}', 'shadow (the default): a stuck verdict injects nothing')
    eq(readJ(join(eco(O), 'turns', 'o.json')).events.map((e) => e.action), ['would-redirect'], 'it is recorded as would-redirect')
  }

  section('the wrapper')
  {
    const P = project('wrap')
    const sh = (payload) => spawnSync('bash', [new URL('./economy.sh', import.meta.url).pathname], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: P, GRIMOIRE_ECONOMY: '' } })
    const main = failing(P, 'x', 1)
    delete main.agent_id
    eq(sh(main).stdout, '{}', 'the main session: {} without starting node')
    for (const ev of ['UserPromptSubmit', 'Stop']) eq(sh({ hook_event_name: ev, cwd: P, session_id: 'm' }).stdout, '{}', `${ev} under shadow: {} without starting node`)
    ok(!existsSync(join(eco(P), 'turns')), 'nothing watched')
    const ON = project('wrap-on', { repos: [{ name: 'api', path: 'repositories/api' }], economy: { loopGuard: 'on' } })
    const shOn = (payload) => spawnSync('bash', [new URL('./economy.sh', import.meta.url).pathname], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ON, GRIMOIRE_ECONOMY: '' } })
    const mainOn = { ...failing(ON, 'x', 1), session_id: 'm' }
    delete mainOn.agent_id
    eq([shOn(mainOn).stdout, existsSync(join(eco(ON), 'turns', 'main-m.json'))], ['{}', true], 'under "on", a main-session call reaches the hook')
    const reg = JSON.parse(readFileSync(new URL('../hooks.json', import.meta.url), 'utf8')).hooks
    eq(['PostToolUse', 'PostToolUseFailure', 'SubagentStop', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop'].filter((e) => !JSON.stringify(reg[e] ?? []).includes('hooks/scripts/economy.sh')), [],
      'hooks.json routes every event the hook handles to the wrapper, the main session\'s prompts and stops included')
    eq([sh(failing(P, 'w', 1)).stdout, existsSync(join(eco(P), 'turns', 'w.json'))], ['{}', true], 'a subagent call reaches the hook')
    eq([sh({ hook_event_name: 'SessionStart', cwd: P, session_id: 'z', source: 'startup' }).stdout, sh({ hook_event_name: 'SessionEnd', cwd: P, session_id: 'z', transcript_path: '/none' }).stdout], ['{}', '{}'],
      'the session events go through to the hook (and answer {} with nothing to say)')
  }

  section('a linked worktree shares the main checkout\'s state')
  {
    const P = project('main')
    const g = (...a) => execFileSync('git', ['-C', P, ...a], { stdio: 'ignore' })
    g('init', '-q', '-b', 'main')
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x')
    const lane = join(SANDBOX, 'lane')
    g('worktree', 'add', '-q', lane)
    run(lane, { ...failing(lane, 'wt-agent', 1), cwd: lane })
    ok(existsSync(join(eco(P), 'turns', 'wt-agent.json')) && !existsSync(join(lane, '.grimoire')), 'the state lands in the main checkout')
  }

  section('the envelope, fed at SubagentStop by dispatches that ended green')
  {
    const P = project('env')
    const green = (id, n) => {
      for (let i = 0; i < n - 1; i++) run(P, edit(P, id, i))
      run(P, call(P, id, 'Bash', { command: 'python -m pytest -q' }, { stdout: '3 passed in 0.10s', stderr: '' }))
      run(P, stop(P, id))
    }
    green('g1', 6)
    eq(readJ(join(eco(P), 'envelope.json')), { 'api/api-engineer': { resolved: [6] } }, 'a green dispatch adds its length to its role')
    ok(readJ(join(eco(P), 'turns', 'g1.json')).stopped === true && !existsSync(join(eco(P), 'judge', 'g1.request.json')), 'its state is closed')
    run(P, edit(P, 'red', 0)); run(P, failing(P, 'red', 1)); run(P, stop(P, 'red'))
    eq(readJ(join(eco(P), 'envelope.json'))['api/api-engineer'].resolved, [6], 'a dispatch whose last check after its last edit failed adds nothing')
    for (const id of ['g2', 'g3', 'g4', 'g5']) green(id, 6)
    eq(readJ(join(eco(P), 'envelope.json'))['api/api-engineer'].resolved, [6, 6, 6, 6, 6], 'five samples: the role has an envelope (7.5 calls)')
    for (let i = 0; i < 22; i++) run(P, i % 2 ? failing(P, 'spiral', i) : edit(P, 'spiral', i))
    const ev = readJ(join(eco(P), 'turns', 'spiral.json')).events
    eq(ev.map((e) => [e.action, e.reason, e.calls, e.segment]), [['would-redirect', 'backstop:20>=19', 20, 0]], 'stuck past 2.5× the envelope: would-redirect, recorded, nothing sent')
    mkdirSync(join(eco(P), 'envelope.lock'))
    green('g6', 6)
    eq(readJ(join(eco(P), 'envelope.json'))['api/api-engineer'].resolved.length, 5, 'a busy lock: the sample is dropped, never written unlocked')
    ok(/SubagentStop envelope sample of api\/api-engineer \(6 calls\) dropped: the lock stayed busy/.test(readFileSync(join(eco(P), 'errors.log'), 'utf8')), 'and the error log says so')
  }

  section('a judge\'s verdict')
  {
    const P = project('judge')
    for (let i = 0; i < 18; i++) run(P, i % 2 ? failing(P, 'j', i) : edit(P, 'j', i))
    mkdirSync(join(eco(P), 'judge'), { recursive: true })
    writeFileSync(join(eco(P), 'judge', 'j.result.json'), JSON.stringify({ segment: 3, stuck: true, confidence: 0.9, reason: 'old' }))
    run(P, edit(P, 'j', 99))
    eq(readJ(join(eco(P), 'turns', 'j.json')).events, [], 'a verdict on another segment is ignored')
    writeFileSync(join(eco(P), 'judge', 'j.result.json'), JSON.stringify({ segment: 0, stuck: true, confidence: 0.8, reason: 'same failure, same file' }))
    run(P, edit(P, 'j', 100))
    const t = readJ(join(eco(P), 'turns', 'j.json'))
    eq(t.events.map((e) => [e.action, e.reason, e.segment]), [['would-redirect', 'judge-stuck@0.80', 0]], 'a stuck verdict at ≥ 0.7: would-redirect')
    ok(t.segment === 1 && !existsSync(join(eco(P), 'judge', 'j.result.json')), 'a fresh segment starts, and the verdict is consumed')
  }

  section('learned facts: folded at SubagentStop and SessionEnd, injected at SessionStart')
  {
    const P = project('facts')
    const REPO = join(P, 'repositories', 'api')
    let k = 0
    // a Claude Code transcript: each call an assistant tool_use (with the call's cwd) and its result
    const transcript = (name, calls) => {
      const lines = calls.flatMap(([tool, input, out, err]) => {
        const id = `c${++k}`
        return [JSON.stringify({ type: 'assistant', cwd: REPO, message: { id: `m${k}`, model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name: tool, input }], usage: { input_tokens: 1, output_tokens: 1 } } }),
          JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!err, content: out }] } })]
      })
      const f = join(SANDBOX, `${name}.jsonl`)
      writeFileSync(f, `${lines.join('\n')}\n`)
      return f
    }
    const BASE = '/opt/env/base/bin/python', PROJ = '/opt/env/proj/bin/python'
    const broken = (i) => transcript(`broken${i}`, [['Edit', { file_path: join(REPO, `pkg/mod${i}.py`) }, 'ok'], ['Bash', { command: 'python -m pytest tests/test_a.py -q' }, `${BASE}: No module named pytest`, true],
      ['Bash', { command: `${PROJ} -m pytest tests/test_a.py -q` }, '1 passed in 0.2s']])
    const stopF = (id, file) => ({ hook_event_name: 'SubagentStop', cwd: REPO, session_id: 's', agent_id: id, agent_type: 'api-engineer', agent_transcript_path: file, stop_hook_active: false })
    const store = () => readJ(join(eco(P), 'facts', 'api.json'))
    for (let i = 0; i < 4; i++) eq(run(P, stopF(`f${i}`, broken(i))).stdout, '{}', `SubagentStop answers {} (dispatch ${i + 1})`)
    const s1 = store()
    eq([s1.repo, s1.now, Object.values(s1.facts).map((f) => [f.family, f.life.state, f.life.fireNum, f.life.fireDen])], ['api', 4, [['form_repair', 'ACTIVE', 4, 4]]],
      'four dispatches that repaired the same form: an active fact, past the firing gate (≥ 40 % over ≥ 4)')
    run(P, stopF('f0', broken(0)))
    eq(store().now, 4, 'a dispatch is folded once, whatever its stops')
    const start = (source, cwd = REPO) => run(P, { hook_event_name: 'SessionStart', cwd, session_id: 'sess-1', source, transcript_path: '/x.jsonl' })
    const { render, fromJSON } = await import('../../scripts/economy/facts/families.mjs')
    const want = render(fromJSON(s1, 'api'))
    ok(want.includes('environment facts learned from earlier sessions') && want.includes(PROJ), `the repo renders a block naming the working form (${want.split('\n')[1] || want})`)
    for (const source of ['startup', 'clear', 'compact']) eq(JSON.parse(start(source).stdout || '{}'), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: want } }, `SessionStart (${source}): the block as additionalContext`)
    eq(start('resume').stdout, '{}', 'SessionStart on resume: nothing (the session replays its own bytes)')
    eq(start('startup', P).stdout, '{}', 'a session outside every repo gets no block')
    ok(existsSync(join(eco(P), 'facts', 'sessions', 'sess-1.json')), 'the ids it was shown are kept for the session\'s fold')
    // the session runs the working form first: the failure was prevented, and still counts as fired
    const prevented = transcript('session', [['Edit', { file_path: join(REPO, 'pkg/x.py') }, 'ok'], ['Bash', { command: `${PROJ} -m pytest tests/test_a.py -q` }, '1 passed in 0.2s']])
    eq(run(P, { hook_event_name: 'SessionEnd', cwd: REPO, session_id: 'sess-1', transcript_path: prevented, reason: 'clear' }).stdout, '{}', 'SessionEnd answers {}')
    const f = Object.values(store().facts)[0]
    eq([store().now, f.life.fireNum, f.life.fireDen, existsSync(join(eco(P), 'facts', 'sessions', 'sess-1.json'))], [5, 5, 5, false], 'the session is folded with the ids it was shown: a prevented failure counts as fired')
    // a loop dispatch was shown the block in its brief: the marker in its first prompt seeds its fold
    const shownIds = Object.keys(store().facts)
    const briefed = join(SANDBOX, 'briefed.jsonl')
    // the real marker comes first; a quoted one later in the brief (a task about the marker itself) changes nothing
    writeFileSync(briefed, [JSON.stringify({ type: 'user', message: { role: 'user', content: `## Learned environment facts (machine-observed; you never write them)\n...\n<!-- grimoire:facts ${JSON.stringify({ repo: 'api', ids: shownIds })} -->\n\n## Task\nDocument \`<!-- grimoire:facts {"repo":"api","ids":[]} -->\`` } }),
      ...readFileSync(transcript('briefed-calls', [['Edit', { file_path: join(REPO, 'pkg/y.py') }, 'ok'], ['Bash', { command: `${PROJ} -m pytest tests/test_a.py -q` }, '1 passed in 0.2s']]), 'utf8').trim().split('\n')].join('\n') + '\n')
    run(P, stopF('briefed', briefed))
    const fb = Object.values(store().facts)[0]
    eq([store().now, fb.life.fireNum, fb.life.fireDen], [6, 6, 6], 'a loop dispatch whose brief showed the fact and that ran the working form: the prevented failure counts as fired')
    mkdirSync(join(eco(P), 'facts.lock'))
    run(P, stopF('f9', broken(9)))
    ok(store().now === 6 && /SubagentStop facts of agent f9 not folded: the lock stayed busy/.test(readFileSync(join(eco(P), 'errors.log'), 'utf8')), 'a busy lock skips the fold, never writes unlocked, and logs it')
    rmSync(join(eco(P), 'facts.lock'), { recursive: true })
    run(P, stopF('f9', broken(9)))
    eq(store().now, 7, 'a dispatch skipped on a busy lock is folded at its next stop')
    const { renderRepos, durableFacts } = await import('../../scripts/economy/facts/cli.mjs')
    const rr = renderRepos(P, ['api', 'web', '../evil'])
    eq([Object.keys(rr.repos), rr.repos.api.block, rr.repos.api.ids], [['api'], render(fromJSON(store(), 'api')), Object.keys(store().facts)], 'the facts CLI: a block and its ids for each listed repo that has one (a bad name is skipped)')
    const cliOut = spawnSync(process.execPath, [new URL('../../scripts/economy/facts/cli.mjs', import.meta.url).pathname, 'render', '--root', P, '--repos', 'api,web'], { encoding: 'utf8' })
    eq(JSON.parse(cliOut.stdout), rr.repos.api ? { repos: { api: rr.repos.api } } : null, 'and the same JSON from the command line')
    const id = Object.keys(store().facts)[0]
    eq([durableFacts(P, { minFolds: 10 }), durableFacts(P, { minFolds: 4 }).map((d) => [d.repo, d.id, d.activeFolds, d.fired, d.exercised])], [[], [['api', id, 5, 7, 7]]],
      'durable facts: active for at least that many of the repo\'s folds (promoted at fold 2, now 7: 5), with their counts')
    // two repos in one transcript, one store holding a corrupt fact: both folded once
    const M = project('facts-multi', { repos: [{ name: 'api', path: 'repositories/api' }, { name: 'web', path: 'repositories/web' }] })
    mkdirSync(join(M, 'repositories', 'web'), { recursive: true })
    mkdirSync(join(eco(M), 'facts'), { recursive: true })
    writeFileSync(join(eco(M), 'facts', 'web.json'), JSON.stringify({ repo: 'web', now: 1, facts: { x: { id: 'x' } } }))
    const two = (name) => {
      const lines = [['Bash', { command: 'python -m pytest -q' }, `${BASE}: No module named pytest`, true, join(M, 'repositories', 'api')], ['Bash', { command: 'npm test' }, 'ok', false, join(M, 'repositories', 'web')], ['Bash', { command: 'ls' }, 'a', false, null]]
        .flatMap(([tool, input, out, err, cwd], i) => [JSON.stringify({ type: 'assistant', ...(cwd ? { cwd } : {}), message: { id: `mm${i}`, content: [{ type: 'tool_use', id: `cc${i}`, name: tool, input }], usage: { input_tokens: 1, output_tokens: 1 } } }),
          JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `cc${i}`, is_error: err, content: out }] } })])
      const f = join(SANDBOX, `${name}.jsonl`); writeFileSync(f, `${lines.join('\n')}\n`); return f
    }
    const mStop = (id) => run(M, { hook_event_name: 'SubagentStop', cwd: M, session_id: 's', agent_id: id, agent_type: 'x', agent_transcript_path: two(id) })
    mStop('m1'); mStop('m1')
    eq([readJ(join(eco(M), 'facts', 'api.json')).now, readJ(join(eco(M), 'facts', 'web.json')).now, readJ(join(eco(M), 'facts', 'web.json')).facts, Object.keys(readJ(join(eco(M), 'facts', 'folded.json')))], [1, 2, {}, ['agent:m1']],
      'calls are split by repo (a call with no cwd belongs to none); a corrupt fact is dropped as its store is read; each repo folded once, the key recorded once')
    // a worktree of a repo (a loop lane) is that repo
    const W = project('facts-wt')
    const repoDir = join(W, 'repositories', 'api')
    const g = (...a) => execFileSync('git', ['-C', repoDir, ...a], { stdio: 'ignore' })
    g('init', '-q', '-b', 'main'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x')
    const lane = join(W, 'repositories', 'api-lane')
    g('worktree', 'add', '-q', lane)
    const laneFile = join(SANDBOX, 'lane.jsonl')
    writeFileSync(laneFile, [JSON.stringify({ type: 'assistant', cwd: join(lane, 'src'), message: { id: 'l1', content: [{ type: 'tool_use', id: 'lt1', name: 'Bash', input: { command: 'ls' } }], usage: { input_tokens: 1, output_tokens: 1 } } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'lt1', content: 'a' }] } })].join('\n') + '\n')
    run(W, { hook_event_name: 'SubagentStop', cwd: lane, session_id: 's', agent_id: 'lane1', agent_type: 'x', agent_transcript_path: laneFile })
    eq(readJ(join(eco(W), 'facts', 'api.json')).now, 1, 'a call in a worktree of a repo (a loop lane) folds into that repo')
    const O = project('facts-off', { repos: [{ name: 'api', path: 'repositories/api' }], economy: { facts: 'off' } })
    run(O, { ...stopF('o1', broken(1)), cwd: join(O, 'repositories', 'api') })
    ok(!existsSync(join(eco(O), 'facts')), 'economy.facts "off": nothing learned')
  }

  section('latency (spike S2)')
  {
    const P = project('fast')
    const env = { CLAUDE_PROJECT_DIR: P }
    const times = []
    for (let i = 0; i < 200; i++) {
      const p = i % 2 ? failing(P, 'speed', i) : edit(P, 'speed', i)
      const t0 = performance.now()
      handle(p, { env })
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    const median = times[100]
    ok(median < 30, `the handler's median per call is under 30 ms (${median.toFixed(2)} ms; p95 ${times[190].toFixed(2)} ms)`)
  }
} finally {
  rmSync(SANDBOX, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
