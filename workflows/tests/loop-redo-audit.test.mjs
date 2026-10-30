// ═════════════════════════════════════════════════════════════════════════════
//  Loop redo audit (2026-10-30) — orchestrate-loop.js
// ═════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/loop-redo-audit.test.mjs
//
//  Grounded in one real week of runs (0.12.1, one web repository, a scroll-story project):
//    • THE SESSION'S FOLDER MOVED UNDER THE RUN — the orchestrating session `cd`'d into a webapp
//      worktree while the loop ran, and every agent started after that began there. The journal's
//      relative run dir then resolved against the WEBAPP repo's main checkout (a second run dir in
//      the wrong repository), the commit check ran `git -C repositories/webapp` from the wrong place
//      and exited 128, and the next launch, reading the real dir, rebuilt a task already landed.
//      A `root` option now pins the workspace: every brief'd prompt names it and every verbatim
//      script changes to it first; and a run dir the writer resolved once stays absolute.
//    • AN ENVIRONMENT HALT THAT NAMED THE WRONG CAUSE — that exit 128 ("cannot change to
//      'repositories/webapp'") was reported as a signing failure, "unlock the commit-signing agent".
//      A failed check's reason now quotes its first output line, and a path that does not resolve
//      is named as one.
//    • A WEDGE HALT THAT KILLED THE WRITER IT WAITED FOR — an implementer passed its 180-minute hard
//      limit four minutes before it would have finished. Nothing else was left, so the run halted
//      at once, which ended the implementer; the resume rebuilt the task for three hours. A wedged
//      writer now keeps a grace window (`wedgeGraceMin`) before the run stops on it.
//    • AN EARLIER ATTEMPT'S COMMITS NEVER REVIEWED — the rebuilt task's implementer found the work
//      on the branch, added one comment commit, and the panel reviewed only that commit. Its
//      `landedBefore` SHAs now widen the reviewed range when it also committed.
import { readFileSync } from 'node:fs'
import { run, by, T, impl, happy, QUIET, envReport, scriptOf } from './support/script-harness.mjs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const HANG = () => new Promise(() => {})
const after = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))
const ROOT = '/ws/odyyy-orchestrator'
const FAST = { agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.005 } // soft 60 ms · writer hard 300 ms
const NO_SHIP = { deliver: 'end', builtinEnvChecks: false }

// ══════════════ P · the workspace root ══════════════
{
  const { calls, prompt } = await run('P1 · with `root`, every brief names it and reads its brief by absolute path', [T('PROJ-1')], happy,
    { args: { ...QUIET, ...NO_SHIP, root: ROOT } })
  const ip = prompt('impl:PROJ-1')
  ok(ip.includes(`Read \`${ROOT}/workflows/briefs/implement.md\``), 'the implementer reads its brief at the absolute path')
  ok(ip.includes(`Workspace root: \`${ROOT}\``) && /your shell may start elsewhere/.test(ip), 'the header names the workspace root and why it matters')
  const briefd = calls.filter((c) => c.prompt.includes('## Brief\n'))
  ok(briefd.length > 3 && briefd.every((c) => c.prompt.includes(`Workspace root: \`${ROOT}\``)), `every brief'd dispatch names the root (${briefd.length})`)
}
{
  const { calls, prompt } = await run('P2 · without `root`, prompts are as before', [T('PROJ-1')], happy, { args: { ...QUIET, ...NO_SHIP } })
  ok(prompt('impl:PROJ-1').includes('Read `workflows/briefs/implement.md`'), 'the relative brief path is unchanged')
  ok(!calls.some((c) => c.prompt.includes('Workspace root:')), 'no root line anywhere')
}
{
  const cd = `R='${ROOT}'; builtin cd "$R" 2>/dev/null || cd "$R" || { echo "ROOT missing: $R"; exit 1; }`
  const { calls } = await run('P3 · with `root`, the verbatim scripts change to it before anything else', [T('PROJ-1')],
    by({ 'env:start': (p) => envReport(p) }), { args: { ...QUIET, root: ROOT, runId: 'run-p3', telemetry: { flushEvery: 100 } } })
  const scripts = calls.filter((c) => /^(journal#|ship:|seal:|env:)/.test(c.label)).map((c) => [c.label, scriptOf(c.prompt)])
  ok(scripts.length >= 3, `journal, ship and env scripts were dispatched (${scripts.map((s) => s[0]).join(', ')})`)
  const wrong = scripts.filter(([, s]) => s.split('\n')[0] !== cd).map(([l]) => l)
  eq(wrong, [], 'each one starts with the cd to the root')
  ok(calls.filter((c) => /^journal#/.test(c.label)).every((c) => c.prompt.includes(`from \`${ROOT}\``)), 'the journal prompt names where it runs')
}

// ══════════════ J · a run dir the writer resolved stays absolute ══════════════
{
  const ABS = '/main/checkout/.grimoire/runs/run-j1'
  const { calls } = await run('J1 · a resumed run whose first flush resolved its dir writes every later flush there', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })], (label, p) => {
    if (/^journal#/.test(label)) return { runDir: label === 'journal#1' ? ABS : (/^DIR='([^']+)'$/m.exec(p) || [])[1], lines: 0, bytes: 0, runJson: 'kept' }
    return happy(label, p)
  }, { args: { ...QUIET, ...NO_SHIP, runId: 'run-j1', resumeState: { version: 2, attempt: 1, lastSeq: 4, landedTasks: [] }, telemetry: { flushEvery: 1 } } })
  const dirs = calls.filter((c) => /^journal#\d+$/.test(c.label)).map((c) => (/^DIR='([^']+)'$/m.exec(c.prompt) || [])[1])
  ok(dirs.length >= 3, `several flushes (${dirs.length})`)
  eq(dirs[0], '.grimoire/runs/run-j1', 'the first flush carries the relative dir the resume knows')
  eq([...new Set(dirs.slice(1))], [ABS], 'every later flush carries the absolute dir the writer resolved')
}

// ══════════════ E · an environment halt names the failure it saw ══════════════
{
  const OUT = "fatal : cannot change to 'repositories/api': No such file or directory\nsigning: commit.gpgsign=true gpg.format=ssh gpg.ssh.program=/opt/signer/op-ssh-sign"
  const { result } = await run('E1 · a commit check whose repo path does not resolve is reported as that, not as signing', [T('PROJ-1')], happy,
    { args: QUIET, index: { envResults: [{ name: 'commit:api', exit: 128, output: OUT }, { name: 'remote:api', exit: 128, output: "fatal: cannot change to 'repositories/api': No such file or directory" }] } })
  eq(result.error, 'environment_unavailable', 'the run is refused')
  ok(/commit:api exited 128 \(repositories\/api does not resolve from the check's working directory: "fatal : cannot change to 'repositories\/api': No such file or directory"\)/.test(result.note || ''),
    'the note says the path did not resolve and quotes the line')
  ok(!/unlock or approve the commit-signing agent/.test(result.note || ''), 'no signing advice for a path failure')
  ok(/run from the workspace root, or pass `root`/.test(result.note || ''), 'the fix names the root')
}
{
  const OUT = 'error: 1Password: agent returned an error\nsigning: commit.gpgsign=true gpg.format=ssh gpg.ssh.program=/opt/signer/op-ssh-sign'
  const { result } = await run('E2 · a signing failure keeps its signing advice and now quotes the error', [T('PROJ-1')], happy,
    { args: QUIET, index: { envResults: [{ name: 'commit:api', exit: 128, output: OUT }, { name: 'remote:api', exit: 0, output: '' }] } })
  ok(/commit:api exited 128 \(signed commit in a scratch worktree; commit\.gpgsign=true, gpg\.format=ssh, gpg\.ssh\.program=\/opt\/signer\/op-ssh-sign; "error: 1Password: agent returned an error"\) — unlock or approve the commit-signing agent/.test(result.note || ''),
    'the signer, the quoted error, then the signing fix')
}

// ══════════════ W · a wedged writer gets a grace window before the run stops on it ══════════════
{
  const { result, labels, logs } = await run('W1 · a writer that returns inside its grace window lands; the run does not halt', [T('PROJ-1')],
    by({ 'impl:PROJ-1': () => after(450, impl('aaaaaaa')) }), { args: { ...QUIET, ...NO_SHIP, ...FAST } })
  eq(result.halt || null, null, 'no halt')
  eq(result.done.map((d) => d.id), ['PROJ-1'], 'PROJ-1 landed')
  ok(labels.includes('spec-hawk:PROJ-1'), 'and was reviewed')
  ok(logs.some((l) => /⛔ \[wedged\] impl:PROJ-1 .* still awaited for up to 0\.005 min more before the run stops on it/.test(l)), 'the wedge log names the grace window')
}
{
  const { result, logs } = await run('W2 · one that never returns halts the run once its grace is over, with the same reason', [T('PROJ-1')],
    by({ 'impl:PROJ-1': HANG }), { args: { ...QUIET, ...NO_SHIP, ...FAST } })
  eq((result.halt || {}).kind, 'wedged', 'halt kind: wedged')
  ok(/^still running: impl:PROJ-1 in api passed the 0\.005-min hard limit and has not returned; it may still commit — let it finish \(git log, ps\) before resuming$/.test((result.halt || {}).reason || ''), 'the halt reason is unchanged')
  ok(logs.some((l) => /impl:PROJ-1 is still out after its 0\.005-min grace window/.test(l)), 'the end of the grace is logged')
}
{
  const { result } = await run('W3 · {wedgeGraceMin:0} keeps the old behaviour: a late result after the hard limit is not used', [T('PROJ-1')],
    by({ 'impl:PROJ-1': () => after(450, impl('aaaaaaa')) }), { args: { ...QUIET, ...NO_SHIP, ...FAST, wedgeGraceMin: 0 } })
  eq((result.halt || {}).kind, 'wedged', 'the run halts on the wedge')
  eq(result.done, [], 'nothing landed')
}

// ══════════════ R · an earlier attempt's commits are reviewed with the ones on top ══════════════
{
  const ON_TOP = { status: 'DONE', summary: 'an earlier attempt built it; I fixed a comment', commits: ['eeeeeee'], baseSha: '0000000', startSha: 'ddddddd', headSha: 'eeeeeee', landedBefore: ['ccccccc', 'ddddddd'], filesChanged: [] }
  const { result, labels, prompt } = await run('R1 · landedBefore plus new commits: the panel reviews the whole range', [T('PROJ-1')],
    by({ 'impl:PROJ-1': ON_TOP }), { args: { ...QUIET, ...NO_SHIP } })
  ok(prompt('spec-hawk:PROJ-1').includes('ccccccc^..eeeeeee') && prompt('break-it:PROJ-1').includes('ccccccc^..eeeeeee'), 'spec and quality review ccccccc^..eeeeeee')
  ok(!labels.some((l) => l.startsWith('fix:')), 'no fix is bought')
  eq([result.done[0].headSha, result.done[0].range.firstSha], ['eeeeeee', 'ccccccc'], 'it lands with its head and the widened range')
}
{
  const OWN = { status: 'DONE', summary: 'built it', commits: ['eeeeeee'], baseSha: '0000000', startSha: 'ddddddd', headSha: 'eeeeeee', filesChanged: [] }
  const { prompt } = await run('R2 · no landedBefore: the range is the dispatch\'s own', [T('PROJ-1')], by({ 'impl:PROJ-1': OWN }), { args: { ...QUIET, ...NO_SHIP } })
  ok(prompt('spec-hawk:PROJ-1').includes('ddddddd..eeeeeee') && !prompt('spec-hawk:PROJ-1').includes('ccccccc'), 'reviewed ddddddd..eeeeeee')
}

// ══════════════ B · the briefs: no single wait past the cache life ══════════════
{
  const ib = readFileSync(`${DIR}/briefs/implement.md`, 'utf8')
  const gb = readFileSync(`${DIR}/briefs/gate.md`, 'utf8')
  ok(/never one shell wait past 4 minutes/i.test(ib) && /prompt cache expires after 5/.test(ib) && /\[ \$SECONDS -ge 240 \]/.test(ib), 'implement.md: background long commands and wait in chunks of at most 4 minutes')
  ok(!/run it in the FOREGROUND and wait/.test(ib), 'implement.md no longer asks for a foreground wait the 10-minute shell cap cannot hold')
  ok(/also list them in `landedBefore`/.test(ib), 'implement.md: work an earlier attempt committed is named even when you commit on top')
  ok(/longer than the shell's 10-minute cap/.test(gb) && /\[ \$SECONDS -ge 240 \]/.test(gb), 'gate.md: a gate past the shell cap runs in the background, waited on in chunks')
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
