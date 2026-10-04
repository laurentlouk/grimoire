// ════════════════════════════════════════════════════════════════════════════
//  Run durability: the opaque journal payload and the landed ledger (0.9.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-ledger.test.mjs
//
//  Grounded in a real unattended run (one static-site repo, ten issues in a strict blocked-by
//  chain) that took about 29 hours over three attempts and ended with zero PRs:
//    • A JOURNAL WRITER THAT OBEYED ITS PAYLOAD — the haiku `journal#N` agent, whose brief is "run
//      one script", read imperative replan learnings pasted verbatim into its heredoc and acted on
//      them: it committed code, edited config and ran the test suite. The payloads (event lines,
//      run.json, the ledger) now travel base64, and run.json is guarded by sequence so a late
//      writer never rolls a newer checkpoint back
//    • A CHECKPOINT NOBODY READ — `checkpoint.landed` was written and never read back, and the
//      tracker keeps issues open until the PR merges, so every resume re-dispatched landed work.
//      Checkpoint v2 lists each landed task with its SHAs, is flushed on every landing, and is
//      absorbed at the next launch once the index agent finds each head on the run branch — from
//      the local checkpoint or from the state marker in the run branch's PR (another machine)
//    • "ALREADY DONE" FAILED AS EMPTY — three landed slices were replayed: their implementers
//      reported "already done, no commits", the precheck failed the empty range, fix rounds were
//      bought and the work was re-reviewed (3.5 h for two tiny commits). An implementer now names
//      the SHAs that already implement the task (`landedBefore`): reviewed ones are absorbed,
//      unreviewed ones are reviewed as they stand, and no "no change" fix is ever bought
//
//  Same stubbed runtime as the other loop tests (agent / parallel / log / phase / args / budget);
//  the journal and the reconcile scripts are also RUN in bash against temp directories.
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8')
const heredocs = (prompt) => [...prompt.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => m[1])

const REPOS = [{ name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: REPOS }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const RUN_BRANCH = 'feat/proj-700-api'

const TASK = { id: 'PROJ-1', ticket: 'PROJ-1', repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: 'Build it', deferred: false, files: ['src/a.ts — add a'] }
const TASK2 = { ...TASK, id: 'PROJ-2', ticket: 'PROJ-2', order: 2, files: ['src/b.ts — add b'], dependsOn: ['PROJ-1'] }
const IMPL_OK = { status: 'DONE', summary: 'built it', commits: ['aaaaaaa'], baseSha: '0000000', startSha: '0000000', headSha: 'aaaaaaa', filesChanged: ['src/a.ts'] }
const GATE_OK = { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
const V = (verdict, findings = []) => ({ verdict, findings, summary: verdict })
const happy = (label) => {
  if (label.startsWith('impl:')) return IMPL_OK
  if (label.startsWith('fix:')) return { status: 'DONE', summary: 'fixed', commits: ['bbbbbbb'], headSha: 'bbbbbbb' }
  if (label.startsWith('gate:')) return GATE_OK
  if (label.startsWith('precheck:')) return { verdict: 'PASS', problems: [] }
  return V('PASS')
}

const indexOf = (tasks, extra) => ({
  slices: [...new Set(tasks.map((t) => t.slice ?? 1))].sort((a, b) => a - b).map((s) => ({
    slice: s,
    sliceLabel: 'v',
    issues: tasks.filter((t) => (t.slice ?? 1) === s).map((t) => ({ id: t.id, title: `Title of ${t.id}`, repo: t.repo, state: t.state || 'todo', assignee: '', dependsOn: t.dependsOn || [] })),
  })),
  hookProblems: [],
  ...extra,
})

async function run(scenario, tasks, responder, { args = {}, index = {} } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks, index)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map(({ state, ...t }) => t) }
    if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
    if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
    if (label === 'crystallize') return { reports: [], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 0, docsSynced: [], prUrl: '', summary: '' }
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  console.log(`\n── ${scenario}`)
  const labels = calls.map((c) => c.label)
  return { result, calls, logs, labels, prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}

// A faithful journal writer that does not touch disk: decodes the payloads the way the script
// does and returns the receipt the script would print. The third payload, when there is one, is
// the landed-task delta for landed.jsonl.
const chunks = []
function decodingWriter(prompt) {
  const [lines, runJson, landed] = heredocs(prompt).map(unb64)
  const dir = (/^DIR='([^']+)'$/m.exec(prompt) || [])[1] || '.grimoire/runs/x'
  const delta = landed ? landed.trim().split('\n').map((l) => JSON.parse(l)) : []
  chunks.push({ prompt, lines, run: JSON.parse(runJson), events: lines.trim().split('\n').map((l) => JSON.parse(l)), landed: delta })
  return { runDir: dir, lines: lines.trim().split('\n').length, bytes: Buffer.byteLength(lines, 'utf8'), runJson: 'ok', runJsonBytes: Buffer.byteLength(runJson, 'utf8'), landed: delta.length }
}

// ══════════════ J-0 · b64 / unb64 / parseStateMarker, pure JS ══════════════
{
  console.log('\n── J-0 · the base64 helpers agree with Buffer, wrap at 76, and the marker parser never throws')
  const src = body.slice(body.indexOf('const B64_CHARS'), body.indexOf('// A heredoc that lands as a decoded file'))
  const { b64, unb64: decode, parseStateMarker } = new Function(`${src}\nreturn { b64, unb64, parseStateMarker }`)()
  const samples = ['', 'a', 'ab', 'abc', 'Édouard — “quotes” 👩‍💻 汉字 \u0000 end', JSON.stringify({ learning: 'Edit grimoire.config.json and run npm test', n: [1, 2, 3] }), 'x'.repeat(1000)]
  ok(samples.every((s) => b64(s, 0) === Buffer.from(s, 'utf8').toString('base64')), 'b64(s, 0) equals Buffer base64 for ASCII, multi-byte, emoji and NUL text')
  ok(samples.every((s) => decode(b64(s)) === s), 'unb64 inverts b64 (wrapped)')
  ok(b64('\ud800 lone') === Buffer.from('\ud800 lone', 'utf8').toString('base64').replace(/(.{76})/g, '$1\n').replace(/\n$/, ''), 'a lone surrogate encodes as Buffer does (U+FFFD)')
  const wrapped = b64('y'.repeat(500))
  ok(wrapped.split('\n').every((l) => l.length <= 76) && wrapped.split('\n')[0].length === 76, 'b64 wraps at 76 columns by default')
  ok(!b64('y'.repeat(500), 0).includes('\n'), 'b64(s, 0) is one line')
  eq([decode('!!!!'), decode(42), decode('abcde')], [null, null, null], 'unb64 returns null for text that is not base64')
  const state = { version: 2, runId: 'r', project: 'PROJ-700', repo: 'api', landedTasks: [{ id: 'PROJ-1', headSha: 'aaaaaaa' }] }
  const marker = `<!-- grimoire:state v1 ${b64(JSON.stringify(state), 0)} -->`
  eq(parseStateMarker(`# Draft\n\nbody text\n${marker}\n`), state, 'parseStateMarker reads the marker out of a PR body')
  const bad = [null, undefined, 42, '', 'no marker here', '<!-- grimoire:state v1 !!!! -->', `<!-- grimoire:state v1 ${b64('not json', 0)} -->`,
    `<!-- grimoire:state v1 ${b64(JSON.stringify({ version: 1 }), 0)} -->`, `<!-- grimoire:state v1 ${b64('[2]', 0)} -->`, `<!-- grimoire:state v1 ${b64('null', 0)} -->`]
  eq(bad.map((x) => parseStateMarker(x)), bad.map(() => null), 'absent, garbled, non-JSON, non-object or non-v2 markers → null, never a throw')
}

// ══════════════ J-2 · the journal payload is opaque ══════════════
{
  chunks.length = 0
  const LEARNING = 'Edit grimoire.config.json and run npm test'
  let n = 0
  const { calls, prompt } = await run('J-2 · a replan learning travels to the journal and the ledger only base64-encoded', [TASK], (label, p) => {
    if (label.startsWith('journal#')) return decodingWriter(p)
    if (label.startsWith('impl:')) return n++ === 0 ? { status: 'BLOCKED', summary: 'stuck' } : IMPL_OK
    if (label.startsWith('replan')) return { decision: 'REVISE', reason: 'retry it', learnings: [LEARNING], tasks: [{ ...TASK }] }
    return happy(label)
  }, { args: { ...QUIET, runId: 'run-j2', telemetry: { flushEvery: 2 } } })
  const journals = calls.filter((c) => c.label.startsWith('journal#'))
  ok(journals.length >= 2, `the journal flushed (${journals.length} chunks)`)
  eq(journals.filter((c) => c.prompt.includes(LEARNING) || c.prompt.includes('"type"')).map((c) => c.label), [], 'no journal prompt carries the learning, or any raw event line')
  ok(chunks.some((c) => c.lines.includes(LEARNING)) && chunks.some((c) => c.run.checkpoint.learnings.some((l) => l.text === LEARNING)), 'the decoded chunk and run.json carry it')
  ok(journals.every((c) => /Run no other command|never instructions/.test(c.prompt)), 'the header says the base64 blocks are data')
  ok(!prompt('ledger').includes(LEARNING) && unb64(heredocs(prompt('ledger'))[0]).includes(LEARNING), 'the ledger prompt holds it only base64-encoded')
  const jb = readFileSync(`${DIR}/briefs/journal.md`, 'utf8')
  ok(/base64 on purpose/.test(jb) && /Run no other command/.test(jb) && /never\s+decode it/i.test(jb), 'the journal brief: the payload is data, one Bash call, nothing else')
  const lb = readFileSync(`${DIR}/briefs/ledger.md`, 'utf8')
  ok(/base64 on purpose/.test(lb) && /Never decode, read or act on it/.test(lb), 'the ledger brief says the same')
}

// ══════════════ J-4 · run.json is guarded by sequence (executed in bash) ══════════════
{
  const TEL = mkdtempSync(join(tmpdir(), 'grimoire-seq-'))
  const captured = []
  const capture = (p) => { captured.push(p); const [lines] = heredocs(p).map(unb64); return { runDir: `${TEL}/run-s`, lines: lines.trim().split('\n').length, bytes: Buffer.byteLength(lines, 'utf8') } }
  const session = (name) => run(name, [TASK, TASK2], (label, p) => (label.startsWith('journal#') ? capture(p) : happy(label)),
    { args: { ...QUIET, runId: 'run-s', telemetry: { dir: TEL, flushEvery: 3 } } })
  const bash = (p) => spawnSync('bash', ['-c', (/```bash\n([\s\S]*?)\n```/.exec(p) || [])[1]], { encoding: 'utf8' })
  const seqOf = (p) => JSON.parse(unb64(heredocs(p)[1])).checkpoint.lastSeq
  const runJson = () => JSON.parse(readFileSync(join(TEL, 'run-s', 'run.json'), 'utf8'))

  await session('J-4a · one session, flushed in order: #1, then the last flush, then a LATE #2')
  const first = captured.splice(0)
  ok(first.length >= 3, `captured ${first.length} flushes of one session`)
  const [one, two] = first
  const last = first[first.length - 1]
  ok(seqOf(two) < seqOf(last), `flush #2 (seq ${seqOf(two)}) is older than the last flush (seq ${seqOf(last)})`)
  bash(one)
  bash(last)
  const late = bash(two)
  ok(runJson().checkpoint.lastSeq === seqOf(last) && runJson().attempt === 1, 'run.json keeps the newer checkpoint')
  ok(/RUNJSON kept/.test(late.stdout) && /^LINES \d+$/m.test(late.stdout), 'the late writer says it kept it, and still prints its receipt')
  const files = readdirSync(join(TEL, 'run-s', 'events'))
  ok(files.includes(`${String(JSON.parse(unb64(heredocs(two)[0]).trim().split('\n')[0]).seq).padStart(8, '0')}.jsonl`), "the late writer's event chunk is still written (chunks are idempotent by name)")
  ok(readFileSync(join(TEL, 'run-s', 'events', files.sort()[0]), 'utf8').split('\n')[0].startsWith('{"seq":1,'), 'the decoded chunk is plain JSON lines')

  // a relaunch's index sees the run branch J-4a moved: its session token differs (it hashes what a launch started from)
  await run('J-4b · a NEW attempt under the same runId restarts at a lower seq — and still writes', [TASK, TASK2], (label, p) => (label.startsWith('journal#') ? capture(p) : happy(label)),
    { args: { ...QUIET, runId: 'run-s', telemetry: { dir: TEL, flushEvery: 3 } }, index: { runBranches: [{ repo: 'api', local: 'aaaaaaa', remote: '', sync: 'local-only' }] } })
  const second = captured.splice(0)
  bash(second[0])
  ok(runJson().attempt === 2 && runJson().checkpoint.lastSeq === seqOf(second[0]) && seqOf(second[0]) < seqOf(last), 'run.json is attempt 2, at its own lower seq')
  rmSync(TEL, { recursive: true, force: true })
}

// ══════════════ R · checkpoint v2, absorption on resume, "already landed" accepted ══════════════
const LANDED_1 = { id: 'PROJ-1', repo: 'api', status: 'DONE', ticket: 'PROJ-1', title: 'Title of PROJ-1', runBranch: RUN_BRANCH, startSha: '0000000', firstSha: 'aaaaaaa', headSha: 'aaaaaaa', commits: ['aaaaaaa'], summary: 'built A' }
const IMPL_2 = { ...IMPL_OK, summary: 'built B', commits: ['bbbbbbb'], startSha: 'aaaaaaa', headSha: 'bbbbbbb', filesChanged: ['src/b.ts'] }
const byLabel = (map) => (label, p) => (label in map ? (typeof map[label] === 'function' ? map[label](p) : map[label]) : label.startsWith('journal#') ? decodingWriter(p) : happy(label))
// a TASK line verifies a record only with its SHA, onBranch=yes AND inBase=no (run-durability-resume.test.mjs)
const ON = (id, extra = {}) => ({ reconcile: [{ id, repo: 'api', sha: 'aaaaaaa', local: true, origin: true, onBranch: true, inBase: 'no' }], runBranches: [{ repo: 'api', local: 'aaaaaaa', remote: 'aaaaaaa', sync: 'same', fetch: 'ok' }], ...extra })
const hydratedIds = (calls) => calls.filter((c) => c.label.startsWith('hydrate:')).flatMap((c) => ['PROJ-1', 'PROJ-2', 'PROJ-3'].filter((id) => c.prompt.includes(`- ${id} `)))
{
  const resumeState = { version: 2, attempt: 1, lastSeq: 12, replansUsed: 0, landedTasks: [LANDED_1] }
  const { result, labels, calls, prompt, logs } = await run('R1 · a checkpoint-landed task verified on the run branch is absorbed, never re-run', [TASK, TASK2],
    byLabel({ 'impl:PROJ-2': IMPL_2 }), { args: { ...QUIET, resumeState }, index: ON('PROJ-1') })
  ok(!labels.includes('impl:PROJ-1') && !hydratedIds(calls).includes('PROJ-1'), 'PROJ-1 is neither hydrated nor implemented')
  ok(labels.includes('impl:PROJ-2') && result.done.map((d) => d.id).join() === 'PROJ-2', 'its dependent runs, and only it')
  ok(prompt('gate:api').includes('PROJ-1 — Title of PROJ-1: built A') && prompt('gate:api').includes('PROJ-2 — Title of PROJ-2: built B'), 'the gate (PR body) lists the absorbed task with its report, next to the new one')
  eq(result.resumedLanded, [{ id: 'PROJ-1', repo: 'api', headSha: 'aaaaaaa', source: 'checkpoint' }], 'result.resumedLanded')
  const ip = prompt('parse-index')
  ok(/RECONCILE the run branches/.test(ip) && ip.includes(`chk 'api' 'repositories/api' '${RUN_BRANCH}' 'PROJ-1' aaaaaaa`) && ip.includes('merge-base --is-ancestor "$5" "refs/heads/${3}"') && ip.includes('merge-base --is-ancestor "$5" "$BASE"'), "the index prompt's RECONCILE checks aaaaaaa against the run branch and the base")
  ok(ip.includes(`gh pr list --head "$3" --state all`) && ip.includes('fetch -q origin'), 'and reads the run branch PR and fetches the branch, best effort')
  ok(/AFTER the probe's second call/.test(ip), 'never between the two probe calls')
  ok(logs.some((l) => /resumed: 1 task\(s\) absorbed .* PROJ-1@aaaaaaa \(checkpoint\)/.test(l)), 'logged')
  const prev = await run('R1b · a preview reconciles READ-ONLY (its resume proof; run-durability-resume.test.mjs)', [TASK], happy, { args: { ...QUIET, execute: false, resumeState } })
  ok(/RECONCILE/.test(prev.prompt('parse-index')) && /\nRO=1;/.test(prev.prompt('parse-index')) && /READ-ONLY/.test(prev.prompt('parse-index')), 'the preview RECONCILE is read-only (RO=1)')
}
{
  const resumeState = { version: 2, attempt: 1, lastSeq: 12, landedTasks: [LANDED_1] }
  const { result, labels, logs } = await run('R2 · the same task whose head is NOT on the run branch runs again', [TASK, TASK2],
    byLabel({ 'impl:PROJ-2': IMPL_2 }), { args: { ...QUIET, resumeState }, index: { reconcile: [{ id: 'PROJ-1', repo: 'api', sha: 'aaaaaaa', local: false, origin: false, onBranch: false }] } })
  ok(labels.includes('impl:PROJ-1') && labels.indexOf('impl:PROJ-1') < labels.indexOf('impl:PROJ-2'), 'PROJ-1 is re-dispatched, before its dependent')
  ok(logs.some((l) => /PROJ-1: the checkpoint state lists it as landed \(head aaaaaaa\), but that head is not on feat\/proj-700-api — it runs again/.test(l)), 'with a warning naming the head and the branch')
  eq(result.resumedLanded, [], 'nothing absorbed')
}
{
  chunks.length = 0
  const { labels } = await run('R3 · checkpoint v2 is flushed on every landing, with each task and its SHAs', [TASK, TASK2],
    byLabel({ 'impl:PROJ-2': IMPL_2 }), { args: { ...QUIET, runId: 'run-r3', telemetry: { flushEvery: 100 } } })
  const beforeGate = labels.slice(0, labels.indexOf('gate:api')).filter((l) => l.startsWith('journal#'))
  ok(beforeGate.length >= 2, `${beforeGate.length} flushes before the final wave (one per landing; flushEvery is 100)`)
  const cp = chunks[chunks.length - 1].run.checkpoint
  ok(cp.version === 2 && cp.attempt === '__ATTEMPT__', 'checkpoint version 2, its attempt left for the writer to stamp')
  // run.json keeps what a resume needs; each task's detail travels once, in landed.jsonl (see run-durability-statewrite)
  eq(cp.landedTasks, [{ id: 'PROJ-1', repo: 'api', runBranch: RUN_BRANCH, headSha: 'aaaaaaa', firstSha: 'aaaaaaa', title: 'Title of PROJ-1' }, { id: 'PROJ-2', repo: 'api', runBranch: RUN_BRANCH, headSha: 'bbbbbbb', firstSha: 'bbbbbbb', title: 'Title of PROJ-2' }], 'landedTasks: id, repo, run branch, head, first commit, title')
  const detail = chunks.flatMap((c) => c.landed)
  eq(detail.map((t) => [t.id, t.headSha, t.commits, t.summary, t.files]), [['PROJ-1', 'aaaaaaa', ['aaaaaaa'], 'built it', ['src/a.ts']], ['PROJ-2', 'bbbbbbb', ['bbbbbbb'], 'built B', ['src/b.ts']]],
    "each task's commits, summary and paths go to landed.jsonl once (the gate condition reads the paths after a resume, when the record has them)")
  ok(cp.landed.includes('PROJ-1') && Array.isArray(cp.pending), '`landed` and `pending` are still there for older readers')
  const firstFlush = chunks[0].run.checkpoint
  ok(firstFlush.landedTasks.length === 1 && firstFlush.landedTasks[0].id === 'PROJ-1' && chunks[0].landed.map((t) => t.id).join() === 'PROJ-1', 'the first flush already holds PROJ-1, and its detail: both were written when PROJ-1 landed')
}
{
  chunks.length = 0
  const resumeState = { version: 2, attempt: 1, lastSeq: 12, landedTasks: [LANDED_1] }
  const NOOP = { status: 'DONE', summary: 'already there; verified', commits: [], startSha: 'aaaaaaa', headSha: 'aaaaaaa', landedBefore: ['aaaaaaa'] }
  // 0.9.0 review fix: a checkpoint record counts as reviewed only once the reconcile VERIFIED it (here it
  // did not: no TASK line), so the SHAs it lists are reviewed as they stand — never rebuilt, never "fixed"
  const { result, labels } = await run('R4 · "already done" with SHAs an UNVERIFIED checkpoint lists → reviewed as they stand, no fix', [TASK],
    byLabel({ 'impl:PROJ-1': NOOP }), { args: { verifyFindings: false, resumeState, runId: 'run-r4', telemetry: { flushEvery: 100 } } }) // precheck ON; reconcile missing → PROJ-1 re-dispatched
  ok(labels.includes('precheck:PROJ-1') && labels.includes('spec-hawk:PROJ-1') && !labels.some((l) => l.startsWith('fix:')), 'precheck and panel review aaaaaaa; no fix is bought')
  ok(result.done.length === 1 && result.done[0].headSha === 'aaaaaaa' && !result.done[0].absorbed, 'it lands, with its head')
  const ev = chunks.flatMap((c) => c.events).find((e) => e.type === 'absorb' && e.task === 'PROJ-1')
  ok(ev && ev.source === 'verify-only' && ev.head === 'aaaaaaa', 'an absorb event, source verify-only')
}
{
  const NOOP = { status: 'DONE', summary: 'PROJ-1 already built this', commits: [], startSha: 'aaaaaaa', headSha: 'aaaaaaa', landedBefore: ['aaaaaaa'] }
  // 0.9.0 review fix: reviewed SHAs are PER TASK — PROJ-1's reviewed head is not a review of PROJ-2
  const { result, labels, prompt } = await run('R4b · in one session: a task citing a PREDECESSOR\'s reviewed SHA is reviewed as it stands', [TASK, TASK2],
    byLabel({ 'impl:PROJ-2': NOOP }), { args: QUIET })
  ok(labels.includes('spec-hawk:PROJ-2') && labels.includes('break-it:PROJ-2') && prompt('spec-hawk:PROJ-2').includes('aaaaaaa^..aaaaaaa'), "PROJ-2's panel reviews aaaaaaa^..aaaaaaa")
  ok(!labels.some((l) => l.startsWith('fix:')) && result.done.map((d) => d.id).join() === 'PROJ-1,PROJ-2' && !result.done[1].absorbed, 'no fix; both land, PROJ-2 not absorbed')
}
{
  chunks.length = 0
  const NOOP = { status: 'DONE', summary: 'a predecessor committed it before it was booked dead', commits: [], startSha: 'ddddddd', headSha: 'ddddddd', landedBefore: ['ccccccc', 'ddddddd'] }
  const { result, labels, prompt } = await run('R5 · "already done" with SHAs nobody reviewed → reviewed as they stand, no fix', [TASK],
    byLabel({ 'impl:PROJ-1': NOOP }), { args: { verifyFindings: false, runId: 'run-r5', telemetry: { flushEvery: 100 } } })
  ok(prompt('precheck:PROJ-1').includes('diff ccccccc^..ddddddd') && !/is empty|startSha/.test(prompt('precheck:PROJ-1').split('## The exact diff')[1] || ''), 'the precheck judges ccccccc^..ddddddd, not an empty range')
  ok(labels.includes('spec-hawk:PROJ-1') && labels.includes('break-it:PROJ-1') && prompt('spec-hawk:PROJ-1').includes('diff ccccccc^..ddddddd'), 'the panel reviews that range')
  ok(!labels.some((l) => l.startsWith('fix:')), 'no fix is bought')
  ok(result.done[0].headSha === 'ddddddd' && result.done[0].range.firstSha === 'ccccccc', 'it lands with that head and range')
  ok(chunks.flatMap((c) => c.events).some((e) => e.type === 'absorb' && e.source === 'verify-only'), 'an absorb event, source verify-only')
}
{
  let pc = 0
  const EMPTY = { status: 'DONE', summary: 'nothing to do?', commits: [], startSha: 'aaaaaaa', headSha: 'aaaaaaa' }
  const { labels, prompt } = await run('R6 · an empty range with no evidence still fails the precheck; the fix is told about landedBefore', [TASK],
    byLabel({ 'impl:PROJ-1': EMPTY, 'precheck:PROJ-1': () => (pc++ ? { verdict: 'PASS', problems: [] } : { verdict: 'FAIL', problems: [{ check: 'change', issue: 'the range aaaaaaa..aaaaaaa is empty' }] }) }), { args: { verifyFindings: false } })
  ok(labels.includes('fix:PROJ-1:precheck#1'), "today's precheck FAIL → fix path")
  ok(prompt('fix:PROJ-1:precheck#1').includes('is empty (if the work is already on the branch, return `landedBefore` instead of redoing it)'), 'the change finding carries the landedBefore hint')
  const ib = readFileSync(`${DIR}/briefs/implement.md`, 'utf8')
  ok(/## Already done when you start/.test(ib) && /landedBefore/.test(ib) && /do not redo, regenerate or re-commit it/.test(ib), 'implement.md has the "Already done when you start" section')
}

{
  const GATED = [{ ...REPOS[0], gate: { run: 'make gate', when: { pathsMatching: ['infra/'] } } }]
  const absorbed = (files) => run(`R7 · conditional gate after a resume — absorbed task files ${JSON.stringify(files)}`, [TASK, TASK2], byLabel({ 'impl:PROJ-2': IMPL_2 }),
    { args: { ...QUIET, repos: GATED, resumeState: { version: 2, attempt: 1, lastSeq: 1, landedTasks: [{ ...LANDED_1, ...(files ? { files } : {}) }] } }, index: ON('PROJ-1') })
  const hit = await absorbed(['infra/main.tf'])
  ok(/Gate command: \*\*APPLIES\*\*/.test(hit.prompt('gate:api')) && hit.prompt('gate:api').includes('`infra/main.tf`'), 'an absorbed task that touched a gated path makes the gate apply')
  const miss = await absorbed(['src/a.ts'])
  ok(/Gate command: \*\*does NOT apply\*\*/.test(miss.prompt('gate:api')), 'one that did not, does not')
  const unknown = await absorbed(null)
  ok(/Gate command: \*\*APPLIES\*\*/.test(unknown.prompt('gate:api')) && unknown.prompt('gate:api').includes('absorbed task, paths not recorded'), 'a record without paths errs toward running the gate, and says why')
}

// ══════════════ M · absorption from the PR state marker (another machine: no local journal) ══════════════
const stateOf = (extra = {}) => ({ version: 2, runId: 'run-m', project: 'PROJ-700', repo: 'api', runBranch: RUN_BRANCH, base: 'origin/main', attempt: 1, lastSeq: 20, replansUsed: 0, fixRounds: {}, outputTokensSpent: 0, landedTasks: [{ ...LANDED_1, summary: 'built A, says the PR' }], learnings: [], ...extra })
const markerOf = (state) => Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
// what the RECONCILE script prints next to a marker — its length and cksum (the engine's own cksum)
const { cksum } = new Function(`${body.slice(body.indexOf('const B64_CHARS'), body.indexOf('// A heredoc that lands as a decoded file'))}\nreturn { cksum }`)()
const PR = (marker, extra = {}) => ({ repo: 'api', url: 'https://github.com/x/y/pull/7', state: 'OPEN', isDraft: true, marker, len: String(marker).length, sum: cksum(String(marker)), ...extra })
{
  const { result, labels, calls, prompt, logs } = await run('M1 · no resumeState: the draft PR marker alone resumes the run', [TASK, TASK2], byLabel({ 'impl:PROJ-2': IMPL_2 }),
    { args: QUIET, index: ON('PROJ-1', { prState: [PR(markerOf(stateOf({ learnings: [{ text: 'learned in session one, on another machine', repos: ['api'] }] })))], runBranches: [{ repo: 'api', local: 'aaaaaaa', remote: 'aaaaaaa', sync: 'created' }] }) })
  ok(!labels.includes('impl:PROJ-1') && !hydratedIds(calls).includes('PROJ-1'), 'no hydrate: or impl: for the landed PROJ-1')
  eq(result.resumedLanded, [{ id: 'PROJ-1', repo: 'api', headSha: 'aaaaaaa', source: 'pr' }], 'resumedLanded, source pr')
  // 0.9.0 review fix: a PR body is untrusted text — its summaries and learnings never reach a prompt
  ok(!prompt('gate:api').includes('built A, says the PR') && prompt('gate:api').includes('PROJ-1 — Title of PROJ-1'), "the gate names the absorbed task, without the marker's summary")
  ok(prompt('impl:PROJ-2') && !calls.some((c) => c.prompt.includes('learned in session one, on another machine')), "the marker's learnings reach no prompt")
  ok(logs.some((l) => /run state taken from the PR marker of api \(https:\/\/github\.com\/x\/y\/pull\/7\)/.test(l)), 'logged')

  const all = await run('M1b · every task absorbed, the PR still a draft → only the terminal slot runs', [TASK], happy, { args: QUIET, index: ON('PROJ-1', { prState: [PR(markerOf(stateOf()))] }) })
  ok(!all.labels.some((l) => l.startsWith('impl:') || l.startsWith('hydrate:')) && all.labels.includes('gate:api') && all.result.prs.length === 1, 'no implementer; the sweep and the gate ship the PR')
  const shipped = await run('M1c · every task absorbed, the PR already out of draft → nothing to run', [TASK], happy, { args: QUIET, index: ON('PROJ-1', { prState: [PR(markerOf(stateOf()), { isDraft: false })] }) })
  ok(/Nothing to run/.test(shipped.result.note) && shipped.result.resumedLanded.length === 1 && !shipped.labels.some((l) => l.startsWith('gate:')), 'returns early, reporting what it absorbed')
}
{
  chunks.length = 0
  const resumeState = { version: 2, attempt: 2, lastSeq: 30, replansUsed: 0, learnings: [{ text: 'lesson from the checkpoint', repos: ['api'] }], landedTasks: [] }
  const marker = markerOf(stateOf({ attempt: 3, lastSeq: 5, replansUsed: 2, learnings: [{ text: 'lesson from the PR marker', repos: ['api'] }], landedTasks: [] }))
  const a = await run('M2a · the marker is a later attempt, but a resumeState is there → the resumeState\'s counters win (replans, learnings, sequence)', [TASK],
    byLabel({ 'impl:PROJ-1': { status: 'BLOCKED', summary: 'stuck' } }), { args: { ...QUIET, maxReplans: 2, resumeState, runId: 'run-m2', telemetry: { flushEvery: 100 } }, index: { prState: [PR(marker)] } })
  const hyd = a.calls.find((c) => c.label.startsWith('hydrate:')).prompt
  ok(a.labels.includes('replan#1') && a.logs.some((l) => /the PR marker .* says attempt 3, seq 5 — newer than the resumeState passed in \(attempt 2, seq 30\); the counters stay the resumeState's/.test(l)), "the marker's 2 spent replans are not taken: the checkpoint spent none, a replan runs (a PR body never outranks the run's own journal)")
  ok(hyd.includes('lesson from the checkpoint') && !hyd.includes('lesson from the PR marker'), "learnings come from the local checkpoint only, never from the PR marker (0.9.0 review fix)")
  ok(chunks[0].events[0].seq === 31, `the journal continues the checkpoint's sequence (first event seq ${chunks[0].events[0].seq})`)
  chunks.length = 0
  const b = await run('M2b · same attempt, the checkpoint at a higher seq → the checkpoint wins', [TASK],
    byLabel({ 'impl:PROJ-1': { status: 'BLOCKED', summary: 'stuck' } }), { args: { ...QUIET, maxReplans: 2, resumeState: { ...resumeState, attempt: 3, lastSeq: 40 }, runId: 'run-m2', telemetry: { flushEvery: 100 } }, index: { prState: [PR(marker)] } })
  const hyd2 = b.calls.find((c) => c.label.startsWith('hydrate:')).prompt
  ok(hyd2.includes('lesson from the checkpoint') && !hyd2.includes('lesson from the PR marker') && chunks[0].events[0].seq === 41 && b.labels.includes('replan#1'), 'its learnings, its sequence (41) and its replan budget (none spent)')
}
{
  const marker = markerOf(stateOf())
  const a = await run('M3a · a marker whose head is not on the run branch stays pending', [TASK], happy,
    { args: QUIET, index: { prState: [PR(marker)], reconcile: [{ id: 'PROJ-1', repo: 'api', sha: 'aaaaaaa', local: false, origin: false, onBranch: false }] } })
  ok(a.labels.includes('impl:PROJ-1') && a.result.resumedLanded.length === 0 && a.logs.some((l) => /PROJ-1: the pr state lists it as landed/.test(l)), 'PROJ-1 runs again, with a warning')
  // 0.9.0 review fix: a repo with work left on a diverged run branch refuses to start (run_branch_diverged)
  const b = await run('M3b · a run branch that diverged from origin absorbs nothing — and the run refuses to build on it', [TASK], happy,
    { args: QUIET, index: ON('PROJ-1', { prState: [PR(marker)], runBranches: [{ repo: 'api', local: 'eeeeeee', remote: 'aaaaaaa', sync: 'diverged', fetch: 'ok' }] }) })
  ok(!b.labels.includes('impl:PROJ-1') && b.result.error === 'run_branch_diverged' && b.logs.some((l) => /api: the local run branch feat\/proj-700-api and origin\/feat\/proj-700-api have DIVERGED/.test(l)), 'nothing absorbed, nothing built: refused, the divergence reported')
  const c = await run('M3c · a reconcile line for another head does not verify this one', [TASK], happy,
    { args: QUIET, index: { prState: [PR(marker)], reconcile: [{ id: 'PROJ-1', repo: 'api', sha: 'fffffff', onBranch: true }] } })
  ok(c.labels.includes('impl:PROJ-1') && c.result.resumedLanded.length === 0, 'the SHA must match')
}
{
  const bad = ['!!!!not base64', Buffer.from('not json').toString('base64'), markerOf({ version: 1, landedTasks: [LANDED_1] }), markerOf(stateOf({ project: 'OTHER-1' })), markerOf(stateOf({ runBranch: 'feat/elsewhere' })), 'none', '']
  const { result, labels, logs } = await run('M4 · invalid or foreign markers are ignored without crashing', [TASK], happy,
    { args: QUIET, index: ON('PROJ-1', { prState: bad.map((m) => PR(m)) }) })
  ok(!result.error && labels.includes('impl:PROJ-1') && result.done.length === 1 && result.resumedLanded.length === 0, 'the run proceeds and builds PROJ-1')
  ok(logs.filter((l) => /state marker .* (unreadable|for another project, repo or run branch) — ignored/.test(l)).length === 5, 'each bad marker is logged once (an empty one is not a marker)')
}

// ══════════════ RC · the RECONCILE script, run in bash against real git repos ══════════════
{
  const T = mkdtempSync(join(tmpdir(), 'grimoire-reconcile-'))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
  const sh = (cmd, cwd = T) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env }).stdout.trim()
  const commit = (dir, msg) => sh(`git commit -q --allow-empty -m ${msg} && git rev-parse HEAD`, dir)
  // a fake `gh` that applies the --jq filter to canned PR JSON with the real jq, as gh does
  const BIN = join(T, 'bin')
  mkdirSync(BIN)
  writeFileSync(join(BIN, 'gh'), '#!/bin/sh\nexpr=\nwhile [ $# -gt 0 ]; do [ "$1" = --jq ] && { expr=$2; shift; }; shift; done\nprintf \'%s\' "$GH_FAKE_JSON" | jq -r "$expr"\n')
  chmodSync(join(BIN, 'gh'), 0o755)
  const hasJq = spawnSync('jq', ['--version']).status === 0
  // one origin, a pusher clone that builds the run branch, and the run's own checkout
  sh(`git init -q --bare -b main origin.git && git clone -q origin.git pusher 2>/dev/null && git clone -q origin.git work 2>/dev/null`)
  const P = join(T, 'pusher'), W = join(T, 'work')
  commit(P, 'base')
  sh('git push -q origin main', P)
  sh(`git pull -q origin main 2>/dev/null`, W)
  sh(`git checkout -q -b ${RUN_BRANCH}`, P)
  const c1 = commit(P, 'c1'), c2 = commit(P, 'c2')
  sh(`git push -q origin ${RUN_BRANCH}`, P)
  const script = async (landedTasks, prs = []) => {
    const { prompt } = await run('  (index prompt for the reconcile script)', [TASK], happy,
      { args: { ...QUIET, repos: [{ ...REPOS[0], path: W }], resumeState: { version: 2, attempt: 1, lastSeq: 1, landedTasks } }, index: { inputProblems: ['stop after the index'] } })
    const s = (/## Also RECONCILE[\s\S]*?```bash\n([\s\S]*?)\n```/.exec(prompt('parse-index')) || [])[1]
    const r = spawnSync('bash', ['-c', s], { cwd: T, encoding: 'utf8', env: { ...env, PATH: `${BIN}:${process.env.PATH}`, GH_FAKE_JSON: JSON.stringify(prs) } })
    return r.stdout
  }
  const rec = (id, head) => ({ ...LANDED_1, id, headSha: head, firstSha: head, commits: [head] })

  // A · another machine: no local run branch; the PR's marker lists a task the checkpoint does not
  const marker = markerOf(stateOf({ landedTasks: [rec('PROJ-3', c2)] }))
  const outA = await script([rec('PROJ-1', c1)], [{ number: 7, url: 'https://github.com/x/y/pull/7', state: 'OPEN', isDraft: true, isCrossRepository: false, body: `## Draft\n\n<!-- grimoire:state v1 ${marker} -->\n` }])
  ok(outA.includes(`BRANCH repo=api local=${c2} remote=${c2} sync=created`), 'RC-A · a missing local run branch is created from origin')
  ok(outA.includes(`TASK id=PROJ-1 repo=api sha=${c1} local=yes origin=yes onBranch=yes`), 'RC-A · the checkpoint task is verified on both refs')
  if (hasJq) {
    ok(outA.includes(`PR repo=api url=https://github.com/x/y/pull/7 state=OPEN isDraft=true len=${marker.length} sum=${cksum(marker)} marker=${marker}`), 'RC-A · the PR line carries the marker raw, with its length and cksum')
    ok(outA.includes(`TASK id=PROJ-3 repo=api sha=${c2} local=yes origin=yes onBranch=yes`), "RC-A · the marker's own task is verified too")
  } else console.log('   (jq not installed — the PR half of RC-A is skipped)')

  // B · the run's checkout is ON the run branch, clean, and behind origin → fast-forwarded
  sh(`git checkout -q ${RUN_BRANCH} && git reset -q --hard ${c1}`, W)
  const outB = await script([rec('PROJ-2', c2)])
  ok(outB.includes(`sync=fast-forwarded`) && sh('git rev-parse HEAD', W) === c2, 'RC-B · a clean, checked-out branch strictly behind origin is fast-forwarded')
  ok(outB.includes(`TASK id=PROJ-2 repo=api sha=${c2} local=yes origin=yes onBranch=yes`), 'RC-B · then the remote-only head verifies')

  // C · a local commit origin does not have, and origin moved on → diverged: reported, nothing touched
  const c3 = commit(P, 'c3')
  sh(`git push -q origin ${RUN_BRANCH}`, P)
  const d1 = commit(W, 'd1')
  const outC = await script([rec('PROJ-1', c1)])
  ok(outC.includes(`local=${d1} remote=${c3} sync=diverged`) && sh('git rev-parse HEAD', W) === d1, 'RC-C · diverged: reported, the local branch left exactly as it was')
  ok(outC.includes(`TASK id=PROJ-1 repo=api sha=${c1} local=yes origin=yes onBranch=no`), 'RC-C · and no task is on the branch for absorption')
  ok(!/PR repo=/.test(outC), 'RC-C · no PR → no PR line')
  rmSync(T, { recursive: true, force: true })
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
