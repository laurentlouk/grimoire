// ════════════════════════════════════════════════════════════════════════════
//  Run durability: how the saved state is WRITTEN (0.9.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-statewrite.test.mjs
//
//  An unattended run resumes from what its journal writer left on disk: run.json's checkpoint,
//  the event chunks, the ledger. Two reviews of 0.9.0 broke that state with the writer's own
//  scripts, executed in bash:
//    • ONE CORRUPT CHARACTER REPLACED A GOOD run.json — the haiku writer retypes a base64 payload;
//      a mistyped character, a payload cut off mid-way or a missing `base64`/`openssl` decoded
//      into garbage or an empty file that replaced the checkpoint, and the receipt still said OK.
//      Two overlapping flushes shared one temp name and corrupted it in 77 of 150 races. Now each
//      payload is decoded into a per-process temp, checked against the engine's byte count and
//      POSIX cksum, and moved into place atomically under a lock — or refused, with a receipt the
//      engine counts as a lost write. The ledger gets the same check.
//    • A ZOMBIE FIRST FLUSH ROLLED THE CHECKPOINT BACK — the attempt was bumped by "the first flush
//      of the session that lands": a first flush abandoned at its hard limit that ran after the
//      next one had landed bumped again and won the guard with an older lastSeq. Now the attempt
//      is registered once per session token, seeded from the engine's own number on a resume.
//    • THE CHECKPOINT GREW WITH EVERY TASK — a 40-task run sent 89 KB per flush (2 MB over the run)
//      for a haiku to retype. run.json now keeps what a resume needs per task; each task's detail
//      goes once, in the flush where it lands, to the append-only landed.jsonl.
//    • THE HALT KIND WAS NOT JOURNALED — the halt event and run.json's summary carry it now.
//
//  Same stubbed runtime as the other loop tests. Every writer script here is RUN, in bash, zsh and
//  dash (whichever exist), against temp directories.
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const RENDER = new URL('../../scripts/render-logs.mjs', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const section = (t) => console.log(`\n── ${t}`)
const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8')
const heredocs = (prompt) => [...prompt.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => m[1])
const bashOf = (p) => (/```bash\n([\s\S]*?)\n```/.exec(p) || [])[1] || ''
const which = (t) => spawnSync('/bin/sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim()
const SHELLS = ['bash', 'zsh', 'dash'].map((name) => ({ name, path: which(name) })).filter((s) => s.path)
const TMP = mkdtempSync(join(tmpdir(), 'grimoire-statewrite-'))
let tmpN = 0
const fresh = (tag = 'd') => { const d = join(TMP, `${tag}-${++tmpN}`); mkdirSync(d, { recursive: true }); return d }

const REPOS = [{ name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: REPOS }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const RUN_BRANCH = 'feat/proj-700-api'
const T = (n, extra = {}) => ({ id: `PROJ-${n}`, ticket: `PROJ-${n}`, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: n, taskText: `Build ${n}`, deferred: false, files: [`src/f${n}.ts — add ${n}`], dependsOn: n > 1 ? [`PROJ-${n - 1}`] : [], ...extra })
const V = (verdict) => ({ verdict, findings: [], summary: verdict })
const IMPL = (n) => ({ status: 'DONE', summary: `built ${n} — “quoted” 👩‍💻 'single' "double" \\ $HOME \`tick\` __AT__`, commits: [`a${n}aaaaa`], baseSha: '0000000', startSha: '0000000', headSha: `a${n}aaaaa`, filesChanged: [`src/f${n}.ts`] })
const happy = (label) => {
  if (label.startsWith('impl:')) return IMPL(+label.split('-')[1])
  if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
  if (label.startsWith('ship:')) return { pushed: true, remoteHead: 'x', prUrl: 'https://github.com/x/y/pull/9', draft: true }
  if (label.startsWith('precheck:')) return { verdict: 'PASS', problems: [] }
  return V('PASS')
}
const indexOf = (tasks, extra) => ({
  slices: [{ slice: 1, sliceLabel: 'v', issues: tasks.map((t) => ({ id: t.id, title: t.title || `Title of ${t.id}`, repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })) }],
  hookProblems: [],
  ...extra,
})
async function run(scenario, tasks, responder, { args = {}, index = {} } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks, index)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map(({ title, ...t }) => t) }
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
  section(scenario)
  return { result, calls, logs, labels: calls.map((c) => c.label), prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}

// What a faithful haiku returns: the script's lines mapped onto JOURNAL_SCHEMA.
const receiptOf = (out) => {
  const num = (re) => Number((re.exec(out) || [])[1] || 0)
  return { runDir: (/^RUNDIR (.+)$/m.exec(out) || [])[1] || '', lines: num(/^LINES (\d+)$/m), bytes: num(/^BYTES (\d+)$/m), runJson: (/^RUNJSON (ok|kept|bad)\b/m.exec(out) || [])[1], runJsonBytes: num(/^RUNJSON_BYTES (\d+)$/m), landed: num(/^LANDED ok (\d+)$/m) }
}
// A writer that confirms without touching disk (for capturing prompts): it reports what the script would.
const confirming = (p) => {
  const [lines, rj, landed] = heredocs(p).map(unb64)
  return { runDir: (/^DIR='([^']+)'$/m.exec(p) || [])[1], lines: lines.trim().split('\n').length, bytes: Buffer.byteLength(lines), runJson: 'ok', runJsonBytes: Buffer.byteLength(rj), landed: landed ? landed.trim().split('\n').length : 0 }
}
const sh = (shell, script, env) => spawnSync(shell.path, ['-c', script], { encoding: 'utf8', env: env || process.env })
const shAsync = (shell, script) => new Promise((res) => { const c = spawn(shell.path, ['-c', script]); let out = ''; c.stdout.on('data', (d) => (out += d)); c.on('close', (code) => res({ code, out })) })
const retarget = (p, from, to) => bashOf(p).replaceAll(`DIR='${from}'`, `DIR='${to}'`)
const seqOf = (p) => JSON.parse(unb64(heredocs(p)[1])).checkpoint.lastSeq
const readRun = (d) => { try { return JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')) } catch { return null } }
const readOr = (f, dflt = '') => { try { return readFileSync(f, 'utf8') } catch { return dflt } }
const leftovers = (d) => [...readdirSync(d), ...(existsSync(join(d, 'events')) ? readdirSync(join(d, 'events')) : [])].filter((f) => /\.\d+$|\.b64$|\.s$|^\.lock$/.test(f))
// A PATH holding only the named tools (a machine without base64, openssl or cksum).
const binWith = (tools) => {
  const b = fresh('bin')
  for (const t of tools) { const w = which(t); if (w) symlinkSync(w, join(b, t)) }
  return b
}
const BASE_TOOLS = ['sed', 'date', 'wc', 'tr', 'head', 'mkdir', 'cat', 'rm', 'mv', 'awk', 'sleep']

// Capture the journal prompts of one session (`dead`: labels whose writer returns null, unexecuted).
async function capture(name, tasks, { runId = 'run-w', tel, args = {}, index = {}, dead = [], respond } = {}) {
  const prompts = []
  const r = await run(name, tasks, (label, p) => {
    if (label.startsWith('journal#')) { prompts.push({ label, p }); return dead.includes(label) ? null : confirming(p) }
    return respond ? respond(label, p) : happy(label)
  }, { args: { ...QUIET, runId, telemetry: { dir: tel, flushEvery: 4 }, ...args }, index })
  return { ...r, prompts, dir: `${tel}/${runId}` }
}

// ══════════════ W-0 · the checksum the engine computes is the one `cksum` prints ══════════════
{
  section('W-0 · the engine\'s cksum in pure JS equals POSIX cksum (every payload check rests on it)')
  const src = body.slice(body.indexOf('function utf8Encode'), body.indexOf('function b64(')) + body.slice(body.indexOf('const CKSUM_TABLE'), body.indexOf("// The run's STATE MARKER"))
  const { cksum, utf8Encode } = new Function(`${src}\nreturn { cksum, utf8Encode }`)()
  const samples = ['', 'a', 'hello\n', 'Édouard — “quotes” 👩‍💻 汉字 \u0000 end\n', 'x'.repeat(70000)]
  const sys = (s) => spawnSync('cksum', { input: Buffer.from(s, 'utf8'), encoding: 'utf8' }).stdout.trim().split(/\s+/).slice(0, 2).join(' ')
  eq(samples.map((s) => `${cksum(s)} ${utf8Encode(s).length}`), samples.map(sys), 'the same CRC and byte count as the system cksum, for ASCII, multi-byte, emoji, NUL and 70 kB')
}

// ══════════════ W-1 · a corrupt, truncated or undecodable payload never replaces run.json ══════════════
const TEL1 = fresh('tel')
const S1 = await capture('W-1 · (capture) three tasks, flushes of 4 events', [T(1), T(2), T(3)], { runId: 'run-w1', tel: TEL1 })
{
  const ps = S1.prompts.map((x) => x.p)
  const first = ps[0], last = ps[ps.length - 1]
  const rjBlock = heredocs(last)[1]
  const expected = Buffer.byteLength(unb64(rjBlock))
  const variants = {
    'one base64 character mistyped': rjBlock.replace(/^(.{40})./m, (m, a) => a + (m[40] === 'A' ? 'B' : 'A')),
    'the payload cut off at 60 %': rjBlock.slice(0, Math.floor(rjBlock.length * 0.6)),
    'one line of it dropped': rjBlock.split('\n').filter((_, i) => i !== 3).join('\n'),
    'a stray character inserted': rjBlock.replace(/^(.{20})/m, '$1!'),
  }
  ok(seqOf(last) > seqOf(first), `the late flush (seq ${seqOf(last)}) is newer than the baseline (seq ${seqOf(first)}): only the check can stop it`)
  for (const shell of SHELLS) {
    for (const [name, bad] of Object.entries(variants)) {
      const D = join(fresh(shell.name), 'run-w1')
      sh(shell, retarget(first, S1.dir, D))
      const before = readFileSync(join(D, 'run.json'), 'utf8')
      const r = sh(shell, retarget(last, S1.dir, D).replace(rjBlock, bad))
      const rc = receiptOf(r.stdout)
      ok(readFileSync(join(D, 'run.json'), 'utf8') === before && rc.runJson === 'bad' && leftovers(D).length === 0,
        `${shell.name} · ${name}: run.json is byte for byte the previous one, the receipt says RUNJSON bad (decoded ${rc.runJsonBytes} of ${expected} bytes${rc.runJsonBytes === expected ? ': the same count, refused on the checksum' : ''}), no temp left`)
    }
    // no decoder at all: neither base64 nor openssl
    const D = join(fresh(shell.name), 'run-w1')
    sh(shell, retarget(first, S1.dir, D))
    const before = readFileSync(join(D, 'run.json'), 'utf8')
    const chunksBefore = readdirSync(join(D, 'events'))
    const none = sh(shell, retarget(last, S1.dir, D), { ...process.env, PATH: binWith([...BASE_TOOLS, 'cksum']) })
    const rc = receiptOf(none.stdout)
    ok(readFileSync(join(D, 'run.json'), 'utf8') === before && rc.runJson === 'bad' && rc.lines === 0 && /^CHUNK bad/m.test(none.stdout) && readdirSync(join(D, 'events')).join() === chunksBefore.join() && leftovers(D).length === 0,
      `${shell.name} · no base64, no openssl: run.json unchanged, no chunk written, LINES 0, no temp left`)
    // openssl alone decodes; without cksum the byte count alone decides (a truncated payload is still refused)
    const O = join(fresh(shell.name), 'run-w1')
    const viaOpenssl = receiptOf(sh(shell, retarget(last, S1.dir, O), { ...process.env, PATH: binWith([...BASE_TOOLS, 'cksum', 'openssl']) }).stdout)
    ok(viaOpenssl.runJson === 'ok' && viaOpenssl.runJsonBytes === expected && readRun(O).checkpoint.lastSeq === seqOf(last), `${shell.name} · openssl without base64: decoded, checked, written`)
    const N = join(fresh(shell.name), 'run-w1')
    const noCk = binWith([...BASE_TOOLS, 'base64'])
    ok(receiptOf(sh(shell, retarget(last, S1.dir, N), { ...process.env, PATH: noCk }).stdout).runJson === 'ok' && readRun(N).checkpoint.lastSeq === seqOf(last), `${shell.name} · no cksum: written on the byte count`)
    const cut = receiptOf(sh(shell, retarget(last, S1.dir, N).replace(rjBlock, variants['the payload cut off at 60 %']), { ...process.env, PATH: noCk }).stdout)
    ok(cut.runJson === 'bad' && readRun(N).checkpoint.lastSeq === seqOf(last), `${shell.name} · no cksum: a truncated payload is still refused`)
  }
}
{
  // the engine counts a refused or unconfirmed run.json write as lost, like a chunk
  const writer = (map) => (label, p) => (label.startsWith('journal#') ? { ...confirming(p), ...(map[label] || {}) } : happy(label))
  const tel = { telemetry: { dir: fresh('tel'), flushEvery: 4 }, runId: 'run-lost' }
  const bad = await run('W-1b · a RUNJSON bad receipt is a lost write', [T(1)], writer({ 'journal#2': { runJson: 'bad', runJsonBytes: 3 } }), { args: { ...QUIET, ...tel } })
  ok(bad.result.telemetry.journal.runJsonLost === 1 && bad.logs.some((l) => /run\.json write #2 lost: writer reported bad \(3 byte\(s\), expected \d+\)/.test(l)), 'counted (telemetry.journal.runJsonLost) and logged')
  const off = await run('W-1c · RUNJSON ok with the wrong byte count, or no RUNJSON at all, is lost too', [T(1)], writer({ 'journal#1': { runJsonBytes: 1 }, 'journal#2': { runJson: undefined } }), { args: { ...QUIET, ...tel } })
  eq(off.result.telemetry.journal.runJsonLost, 2, 'two lost writes')
  const kept = await run('W-1d · RUNJSON kept is not a loss: a newer checkpoint is on disk', [T(1)], writer({ 'journal#1': { runJson: 'kept', runJsonBytes: 0 } }), { args: { ...QUIET, ...tel } })
  eq(kept.result.telemetry.journal.runJsonLost, 0, 'nothing lost')
}

// ══════════════ W-2 · overlapping flushes never corrupt run.json, never roll it back ══════════════
{
  const ps = S1.prompts.map((x) => x.p)
  const older = ps[1], newer = ps[ps.length - 1]
  for (const shell of SHELLS) {
    section(`W-2 · ${shell.name}: 20 races of a late flush (seq ${seqOf(older)}) against the current one (seq ${seqOf(newer)})`)
    let good = 0, rolled = 0, corrupt = 0, litter = 0
    for (let i = 0; i < 20; i++) {
      const D = join(fresh(shell.name), 'run-w1')
      sh(shell, retarget(ps[0], S1.dir, D))
      const a = shAsync(shell, retarget(older, S1.dir, D))
      await new Promise((r) => setTimeout(r, i % 4))
      const b = shAsync(shell, retarget(newer, S1.dir, D))
      await Promise.all([a, b])
      const o = readRun(D)
      if (!o) corrupt++
      else if (o.checkpoint.lastSeq !== seqOf(newer)) rolled++
      else good++
      if (leftovers(D).length) litter++
    }
    eq({ good, rolled, corrupt, litter }, { good: 20, rolled: 0, corrupt: 0, litter: 0 }, 'every race ends on the newer checkpoint, parseable, with no temp or lock left')
    // every flush of the session at once
    const D = join(fresh(shell.name), 'run-w1')
    const outs = await Promise.all(ps.map((p) => shAsync(shell, retarget(p, S1.dir, D))))
    const o = readRun(D)
    ok(o && o.checkpoint.lastSeq === Math.max(...ps.map(seqOf)) && o.attempt === 1 && outs.every((x) => x.code === 0) && leftovers(D).length === 0, `all ${ps.length} flushes at once: run.json holds the newest (seq ${o && o.checkpoint.lastSeq}), attempt 1, nothing left behind`)
    ok(readdirSync(join(D, 'events')).length === ps.length && readOr(join(D, 'sessions')).trim().split('\n').filter(Boolean).length === 1, 'every chunk written once, one session registered')
  }
}

// ══════════════ W-3 · the zombie first flush (s10) and the attempt across sessions ══════════════
const TEL3 = fresh('tel')
const S2 = await capture('W-3 · (capture) session 2: flush #1 abandoned at its hard limit, the rest land', [T(1), T(2)], { runId: 'run-s', tel: TEL3, dead: ['journal#1'] })
const LEGACY = '{"runId":"run-s","attempt":1,"project":"PROJ-700","status":"halted","startedAt":"2026-09-01T00:00:00Z","checkpoint":{"lastSeq":5}}'
{
  const zombie = S2.prompts.find((x) => x.label === 'journal#1').p
  const rest = S2.prompts.filter((x) => x.label !== 'journal#1').map((x) => x.p)
  const two = rest[0], last = rest[rest.length - 1]
  ok(seqOf(zombie) < seqOf(two) && seqOf(two) < seqOf(last), `seqs: zombie #1 ${seqOf(zombie)} < #2 ${seqOf(two)} < last ${seqOf(last)}`)
  ok(!/firstOfSession|PREV:-0\} \+ 1/.test(zombie) && (/SESSION=([0-9a-f]+)/.exec(zombie) || [])[1] === (/SESSION=([0-9a-f]+)/.exec(last) || [])[1], 'every flush carries the same session token, none a "first of session" bump')
  for (const shell of SHELLS) {
    const D = join(fresh(shell.name), 'run-s')
    mkdirSync(join(D, 'events'), { recursive: true })
    writeFileSync(join(D, 'run.json'), LEGACY) // attempt 1, written by an earlier session (0.9.0 format)
    sh(shell, retarget(two, S2.dir, D))
    const afterTwo = readRun(D)
    sh(shell, retarget(last, S2.dir, D))
    const z = sh(shell, retarget(zombie, S2.dir, D))
    const o = readRun(D)
    ok(afterTwo.attempt === 2 && o.attempt === 2 && o.gen === 2 && o.checkpoint.lastSeq === seqOf(last) && receiptOf(z.stdout).runJson === 'kept',
      `${shell.name} · #2, the newest, then the zombie #1: attempt stays 2, lastSeq stays ${seqOf(last)}, the zombie says RUNJSON kept`)
    const zchunk = `${String(JSON.parse(unb64(heredocs(zombie)[0]).split('\n')[0]).seq).padStart(8, '0')}.a2.jsonl`
    ok(readdirSync(join(D, 'events')).includes(zchunk) && !readdirSync(join(D, 'events')).some((f) => /\.a3\./.test(f)), `${shell.name} · the zombie's events land in its own session's ${zchunk}, no phantom attempt 3`)
    eq(readOr(join(D, 'sessions')), `${(/SESSION=([0-9a-f]+)/.exec(zombie) || [])[1]} 2\n`, `${shell.name} · one registry line: this session is attempt 2`)
    // the zombie runs at the same time as the newest flush, or before every other one
    let rolled = 0
    for (let i = 0; i < 10; i++) {
      const R = join(fresh(shell.name), 'run-s')
      mkdirSync(join(R, 'events'), { recursive: true })
      writeFileSync(join(R, 'run.json'), LEGACY)
      sh(shell, retarget(two, S2.dir, R))
      await Promise.all([shAsync(shell, retarget(zombie, S2.dir, R)), shAsync(shell, retarget(last, S2.dir, R))])
      const x = readRun(R)
      if (!x || x.checkpoint.lastSeq !== seqOf(last) || x.attempt !== 2) rolled++
    }
    eq(rolled, 0, `${shell.name} · 10 races of the zombie against the newest flush: never rolled back`)
    const F = join(fresh(shell.name), 'run-s')
    mkdirSync(join(F, 'events'), { recursive: true })
    writeFileSync(join(F, 'run.json'), LEGACY)
    for (const p of [zombie, two, last]) sh(shell, retarget(p, S2.dir, F))
    ok(readRun(F).attempt === 2 && readRun(F).checkpoint.lastSeq === seqOf(last), `${shell.name} · a zombie that lands first is just the session's first write: attempt 2, then the newer flushes win`)
  }
}
{
  // across sessions, in bash: the resumed session beats every writer of the one it resumed; the
  // engine seeds the attempt on a machine with no local journal; a corrupt run.json resets nothing
  const shell = SHELLS[0]
  const D = join(fresh('x'), 'run-s')
  mkdirSync(join(D, 'events'), { recursive: true })
  writeFileSync(join(D, 'run.json'), LEGACY)
  const zombie = S2.prompts.find((x) => x.label === 'journal#1').p
  const rest = S2.prompts.filter((x) => x.label !== 'journal#1').map((x) => x.p)
  for (const p of rest) sh(shell, retarget(p, S2.dir, D))
  const S3 = await capture('W-3b · (capture) session 3 resumes session 2\'s checkpoint', [T(1), T(2), T(3)], { runId: 'run-s', tel: TEL3, args: { resumeState: readRun(D).checkpoint }, index: { runBranches: [{ repo: 'api', local: 'a2aaaaa', remote: 'a2aaaaa', sync: 'same' }] } })
  ok(S3.prompts.every((x) => /SEED=3;/.test(x.p)), 'session 3 passes the attempt it knows from the checkpoint: SEED=3')
  for (const x of S3.prompts) sh(shell, retarget(x.p, S3.dir, D))
  const s3 = readRun(D)
  const late = [sh(shell, retarget(zombie, S2.dir, D)), sh(shell, retarget(rest[rest.length - 1], S2.dir, D))].map((r) => receiptOf(r.stdout).runJson)
  ok(s3.attempt === 3 && s3.gen === 3 && readRun(D).checkpoint.lastSeq === s3.checkpoint.lastSeq && late.join() === 'kept,kept', 'session 2\'s zombie and its newest flush, run after session 3: both kept, run.json stays attempt 3')

  const M = join(fresh('x'), 'run-s') // another machine: no run.json, no registry
  const S4 = await capture('W-3c · (capture) a resume on another machine from a checkpoint at attempt 4', [T(1)], { runId: 'run-s', tel: TEL3, args: { resumeState: { version: 2, attempt: 4, lastSeq: 12, landedTasks: [] } } })
  sh(shell, retarget(S4.prompts[0].p, S4.dir, M))
  ok(readRun(M).attempt === 5 && readRun(M).gen === 5 && readdirSync(join(M, 'events')).every((f) => /\.a5\.jsonl$/.test(f)), 'its first flush writes attempt 5 (seeded), chunks .a5 — not attempt 1')

  writeFileSync(join(D, 'run.json'), '{"runId":"run-s","attem') // a run.json cut off by an older writer
  const S5 = await capture('W-3d · (capture) a relaunch with no resumeState over a corrupt run.json', [T(1)], { runId: 'run-s', tel: TEL3, index: { runBranches: [{ repo: 'api', local: 'a3aaaaa', remote: '', sync: 'ahead' }] } })
  sh(shell, retarget(S5.prompts[0].p, S5.dir, D))
  ok(readRun(D) && readRun(D).attempt === 4, 'the registry keeps the count: attempt 4, not 2, and run.json is whole again')
}
{
  section('W-3e · the session token: one per launch, from what the launch started from')
  const tok = (r) => (/SESSION=([0-9a-f]+)/.exec(r.prompts[0].p) || [])[1]
  const tel = fresh('tel')
  const a = await capture('W-3e · (capture) a launch', [T(1)], { runId: 'run-t', tel })
  const b = await capture('W-3e · (capture) the same launch replayed', [T(1)], { runId: 'run-t', tel })
  const moved = await capture('W-3e · (capture) a relaunch after a landing moved the run branch', [T(1)], { runId: 'run-t', tel, index: { runBranches: [{ repo: 'api', local: 'a1aaaaa', remote: '', sync: 'local-only' }] } })
  const resumed = await capture('W-3e · (capture) a resume', [T(1)], { runId: 'run-t', tel, args: { resumeState: { version: 2, attempt: 1, lastSeq: 9, landedTasks: [] } } })
  ok(/^[0-9a-f]{16}$/.test(tok(a)) && a.prompts.every((x) => x.p.includes(`SESSION=${tok(a)};`)), 'a 16-hex token, the same in every flush of a launch')
  ok(tok(a) === tok(b), 'a replay of the same launch (the runtime replays) has the same token: no clock, no randomness')
  ok(new Set([tok(a), tok(moved), tok(resumed)]).size === 3, 'a moved run branch or a resume base gives another token')
}

// ══════════════ W-4 · landed.jsonl: each task's detail once, in the flush where it landed ══════════════
const TEL4 = fresh('tel')
{
  let k = 0
  const execWriter = (dir) => (label, p) => {
    if (!label.startsWith('journal#')) return happy(label)
    const shell = SHELLS[k++ % SHELLS.length] // the writers of one run need not share a shell
    return receiptOf(sh(shell, bashOf(p)).stdout)
  }
  const { result, calls } = await run('W-4 · three landings, every flush run for real (shells in turn)', [T(1), T(2), T(3)], execWriter(), { args: { ...QUIET, runId: 'run-l', telemetry: { dir: TEL4, flushEvery: 100 } } })
  const D = join(TEL4, 'run-l')
  const lines = readOr(join(D, 'landed.jsonl')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  eq(lines.map((l) => [l.id, l.headSha, l.commits, l.files, l.attempt]), [1, 2, 3].map((n) => [`PROJ-${n}`, `a${n}aaaaa`, [`a${n}aaaaa`], [`src/f${n}.ts`], 1]), 'landed.jsonl: one line per landing, with its commits, files and attempt')
  ok(lines.every((l) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(l.at) && l.summary === IMPL(l.id.split('-')[1]).summary), 'each line stamped with its flush time; the summary byte for byte, `__AT__` in it untouched')
  const deltas = calls.filter((c) => c.label.startsWith('journal#')).map((c) => (heredocs(c.prompt)[2] ? unb64(heredocs(c.prompt)[2]).trim().split('\n').map((l) => JSON.parse(l).id) : []))
  eq(deltas.flat(), ['PROJ-1', 'PROJ-2', 'PROJ-3'], 'across all flushes each task travels once: the delta, never the whole list')
  const rj = readRun(D)
  eq(rj.checkpoint.landedTasks, [1, 2, 3].map((n) => ({ id: `PROJ-${n}`, repo: 'api', runBranch: RUN_BRANCH, headSha: `a${n}aaaaa`, firstSha: `a${n}aaaaa`, title: `Title of PROJ-${n}` })), 'run.json keeps what a resume needs: id, repo, run branch, head, first commit, title')
  ok(result.telemetry.journal.runJsonLost === 0 && result.telemetry.journal.mismatches === 0 && leftovers(D).length === 0, 'every receipt matched; nothing left behind')

  // a writer that dies on the flush carrying a delta: the next flush sends it again
  const dead = await capture('W-4b · the flush carrying PROJ-1\'s detail dies; the next one carries it', [T(1), T(2)], { runId: 'run-l2', tel: TEL4, dead: [] , args: { telemetry: { dir: TEL4, flushEvery: 100 } }, respond: happy })
  const firstDelta = dead.prompts.findIndex((x) => heredocs(x.p)[2])
  const again = await run('W-4b · (rerun) with that writer dead', [T(1), T(2)], (label, p) => (label === dead.prompts[firstDelta].label ? null : label.startsWith('journal#') ? confirming(p) : happy(label)),
    { args: { ...QUIET, runId: 'run-l2', telemetry: { dir: TEL4, flushEvery: 100 } } })
  const ids = again.calls.filter((c) => c.label.startsWith('journal#') && c.label !== dead.prompts[firstDelta].label).flatMap((c) => (heredocs(c.prompt)[2] ? unb64(heredocs(c.prompt)[2]).trim().split('\n').map((l) => JSON.parse(l).id) : []))
  eq(ids, ['PROJ-1', 'PROJ-2'], 'PROJ-1\'s detail rides the next flush, then PROJ-2\'s: nothing lost, nothing twice')

  // a resume from run.json ALONE absorbs the landed tasks, and never re-sends their detail
  const ON = { reconcile: [1, 2].map((n) => ({ id: `PROJ-${n}`, repo: 'api', sha: `a${n}aaaaa`, local: true, origin: false, onBranch: true, inBase: 'no' })), runBranches: [{ repo: 'api', local: 'a2aaaaa', remote: '', sync: 'local-only', fetch: 'ok' }] }
  const slim = { ...rj.checkpoint, landedTasks: rj.checkpoint.landedTasks.slice(0, 2) }
  const res = await run('W-4c · resume from the slim checkpoint: PROJ-1 and PROJ-2 absorbed, PROJ-3 built', [T(1), T(2), T(3)], (label, p) => (label.startsWith('journal#') ? confirming(p) : happy(label)),
    { args: { ...QUIET, runId: 'run-l', telemetry: { dir: TEL4, flushEvery: 100 }, resumeState: slim }, index: ON })
  eq(res.labels.filter((l) => l.startsWith('impl:')), ['impl:PROJ-3'], 'only PROJ-3 is implemented')
  eq(res.result.resumedLanded.map((r) => r.id), ['PROJ-1', 'PROJ-2'], 'absorbed from run.json alone (summaries and files are enrichment)')
  ok(/PROJ-1 — Title of PROJ-1: \(no report\)/.test(res.prompt('gate:api')), 'the PR body lists an absorbed task without a summary as "(no report)"')
  eq(res.calls.filter((c) => c.label.startsWith('journal#')).flatMap((c) => (heredocs(c.prompt)[2] ? unb64(heredocs(c.prompt)[2]).trim().split('\n').map((l) => JSON.parse(l).id) : [])), ['PROJ-3'], 'its deltas carry PROJ-3 only')
}

// ══════════════ W-5 · the payload per flush, at 80 tasks ══════════════
{
  const sha = (n, k) => (n * 1000 + k).toString(16).padStart(8, '0') + 'abcdef0123456789abcdef0123456789'
  const big = (N) => Array.from({ length: N }, (_, i) => T(i + 1, { title: `Feature ${i + 1}: ${'a very long issue title that keeps going '.repeat(5)}`, files: Array.from({ length: 10 }, (_, k) => `apps/web/src/features/feature-${i + 1}/components/Component${k}.tsx — change ${k}`) }))
  const IMPLB = (n) => ({ status: 'DONE', summary: 'Implemented the feature with the new component, wired it into the route, added tests and docs. '.repeat(8), commits: Array.from({ length: 5 }, (_, k) => sha(n, k)), baseSha: sha(0, 0), startSha: sha(n, 0), headSha: sha(n, 4), filesChanged: Array.from({ length: 60 }, (_, k) => `apps/web/src/features/feature-${n}/components/Component${k}.tsx`) })
  const LEARN = Array.from({ length: 40 }, (_, i) => ({ text: `learning ${i}: ${'measured, not guessed. '.repeat(30)}`, repos: ['api'] }))
  const measure = async (N) => {
    const caps = []
    await run(`W-5 · (measure) ${N} tasks, 40-character SHAs, 200-character titles, 60 files each, 40 carried learnings`, big(N), (label, p) => {
      if (label.startsWith('journal#')) { caps.push(p); return confirming(p) }
      if (label.startsWith('impl:')) return IMPLB(+label.split('-')[1])
      return happy(label)
    }, { args: { ...QUIET, runId: `run-big-${N}`, telemetry: { dir: fresh('tel'), flushEvery: 40 }, resumeState: { version: 2, attempt: 1, lastSeq: 0, landedTasks: [], learnings: LEARN } } })
    const runJson = caps.map((p) => unb64(heredocs(p)[1]))
    const rest = caps.map((p) => p.length - heredocs(p)[1].length) // everything but the run.json payload
    return { caps, runJson, rest, last: JSON.parse(runJson[runJson.length - 1]) }
  }
  const small = await measure(10)
  const at80 = await measure(80)
  const cp = at80.last.checkpoint
  ok(cp.landedTasks.length === 80 && cp.landedTasks.every((t) => Object.keys(t).every((k) => ['id', 'repo', 'status', 'runBranch', 'headSha', 'firstSha', 'title'].includes(k)) && t.title.length <= 120), 'each landed task: id, repo, run branch, head, first commit, title capped at 120')
  ok(cp.learnings.length === 30 && cp.learnings.every((l) => l.text.length <= 300) && cp.learnings[29].text.startsWith('learning 39'), 'learnings: the last 30, each at most 300 characters')
  const maxOf = (m) => Math.max(...m.runJson.map((x) => Buffer.byteLength(x)))
  const perTask = Math.round((maxOf(at80) - maxOf(small)) / 70)
  ok(perTask <= 340 && maxOf(at80) < 48000, `run.json grows ${perTask} bytes per landed task (≤ 340; the 0.9.0 checkpoint carried every task's summary, commits and files, ~4.5 kB each here): ${maxOf(at80)} bytes at 80 tasks, learnings and titles at their caps`)
  ok(Math.max(...at80.rest) <= Math.max(...small.rest) * 1.1, `everything else in a flush does not grow with the run: ${Math.max(...at80.rest)} characters at 80 tasks, ${Math.max(...small.rest)} at 10`)
  const maxPrompt = (m) => Math.max(...m.caps.map((p) => p.length))
  ok(maxPrompt(at80) - maxPrompt(small) <= 70 * 440, `the largest journal prompt grows only by run.json's base64: ${maxPrompt(small)} characters at 10 tasks, ${maxPrompt(at80)} at 80`)
  eq(at80.caps.reduce((a, p) => a + (heredocs(p)[2] ? unb64(heredocs(p)[2]).trim().split('\n').length : 0), 0), 80, 'landed.jsonl receives 80 detail lines over the run: one per task')
}

// ══════════════ W-6 · the halt kind, in the halt event and in run.json's summary ══════════════
{
  const TEL6 = fresh('tel')
  const execAll = (label, p) => (label.startsWith('journal#') ? receiptOf(sh(SHELLS[0], bashOf(p)).stdout) : null)
  const env = await run('W-6 · an environment halt', [T(1)], (label, p) => {
    if (label.startsWith('journal#')) return execAll(label, p)
    if (label === 'impl:PROJ-1') return { status: 'BLOCKED', summary: 'git commit hung for 25 s' }
    if (label.startsWith('replan')) return { decision: 'REVISE', cause: 'environment', reason: 'commit signing hangs — unlock the agent, then resume', learnings: [], tasks: [T(1)] }
    return happy(label)
  }, { args: { ...QUIET, runId: 'run-env', telemetry: { dir: TEL6, flushEvery: 4 } } })
  const evs = (id) => readdirSync(join(TEL6, id, 'events')).flatMap((f) => readFileSync(join(TEL6, id, 'events', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
  const h1 = evs('run-env').find((e) => e.type === 'halt')
  ok(env.result.halt.kind === 'environment' && h1 && h1.kind === 'environment' && /^environment: commit signing hangs/.test(h1.reason), 'the halt event carries kind: environment')
  eq(readRun(join(TEL6, 'run-env')).summary.halt, { reason: env.result.halt.reason, kind: 'environment' }, "run.json's summary.halt: {reason, kind}")
  const plain = await run('W-6b · a halt with no kind', [T(1)], (label, p) => {
    if (label.startsWith('journal#')) return execAll(label, p)
    if (label === 'impl:PROJ-1') return { status: 'BLOCKED', summary: 'x' }
    if (label.startsWith('replan')) return { decision: 'HALT', reason: 'stop here', learnings: [] }
    return happy(label)
  }, { args: { ...QUIET, runId: 'run-plain', telemetry: { dir: TEL6, flushEvery: 4 } } })
  const h2 = evs('run-plain').find((e) => e.type === 'halt')
  ok(h2 && 'kind' in h2 && h2.kind === null && readRun(join(TEL6, 'run-plain')).summary.halt.kind === null && plain.result.halt.reason === 'stop here', 'no kind → kind: null in the event and in the summary')

  // render-logs reads both: the kind in brackets, nothing for null — and the checkpoint card joins landed.jsonl
  const html = (dir) => {
    const r = spawnSync(process.execPath, [RENDER, '--dir', dir, '--out', join(dir, 'logs.html')], { cwd: dir, encoding: 'utf8' })
    return r.status === 0 ? readFileSync(join(dir, 'logs.html'), 'utf8') : ''
  }
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.className = '' }
    setAttribute() {}
    addEventListener() {}
    append(...kids) { this.children.push(...kids) }
    replaceChildren(...kids) { this.children = kids }
    get textContent() { return this.children.map((c) => (c instanceof El ? c.textContent : String(c))).join(' ') }
  }
  const page = (h, runId) => {
    const blob = (h.match(/<script type="application\/json" id="grimoire-data">([\s\S]*?)<\/script>/) || [])[1] || '{}'
    const data = JSON.parse(blob)
    data.initialRun = runId
    const js = (h.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || ''
    const doc = { body: new El('body'), createElement: (t) => new El(t), getElementById: (id) => (id === 'grimoire-data' ? { textContent: JSON.stringify(data) } : null) }
    try { new Function('document', 'Node', js)(doc, El); return doc.body.textContent } catch (e) { return `renderer threw: ${e.message}` }
  }
  const h6 = html(TEL6)
  ok(/halt: \[environment\] environment: commit signing hangs/.test(page(h6, 'run-env')), 'render-logs: halt: [environment] …')
  const t2 = page(h6, 'run-plain')
  ok(/halt: stop here/.test(t2) && !/\[null\]|halt: null/.test(t2), 'render-logs: a halt without a kind shows its reason alone')
  const t4 = page(html(TEL4), 'run-l')
  ok(/landed:\s+PROJ-1 @ a1aaaaa \(api · feat\/proj-700-api\)/.test(t4) && /PROJ-2 — Title of PROJ-2: built 2/.test(t4) && /1 commit\(s\), 1 file\(s\)/.test(t4), "render-logs: the checkpoint card joins each landed task with its landed.jsonl detail")
}

// ══════════════ W-7 · a truncated ledger payload never becomes a committed ledger ══════════════
{
  const { prompt } = await run('W-7 · (capture) the ledger writer', [T(1)], happy, { args: QUIET })
  const p = prompt('ledger')
  const block = heredocs(p)[0]
  const script = bashOf(p)
  const cases = {
    'truncated at 40 %': script.replace(block, block.slice(0, Math.floor(block.length * 0.4))),
    'one character mistyped': script.replace(block, block.replace(/^(.{30})./m, (m, a) => a + (m[30] === 'A' ? 'B' : 'A'))),
  }
  for (const shell of SHELLS) {
    const W = fresh(shell.name)
    const good = spawnSync(shell.path, ['-c', script], { cwd: W, encoding: 'utf8' })
    const path = (/^LEDGER (\S+)$/m.exec(good.stdout) || [])[1]
    ok(good.status === 0 && path && JSON.parse(readFileSync(join(W, path), 'utf8')).project === 'PROJ-700' && readdirSync(join(W, 'runs')).length === 1, `${shell.name} · intact: LEDGER <path>, the file is the ledger, nothing else in runs/`)
    for (const [name, s] of Object.entries(cases)) {
      const X = fresh(shell.name)
      const r = spawnSync(shell.path, ['-c', s], { cwd: X, encoding: 'utf8' })
      ok(r.status !== 0 && /^LEDGER bad: .*commit nothing/m.test(r.stdout) && !/^LEDGER runs/m.test(r.stdout) && readdirSync(join(X, 'runs')).length === 0, `${shell.name} · ${name}: LEDGER bad, a failing exit, runs/ empty (no file, no temp)`)
    }
    const Y = fresh(shell.name)
    const r = spawnSync(shell.path, ['-c', script], { cwd: Y, encoding: 'utf8', env: { ...process.env, PATH: binWith([...BASE_TOOLS, 'cksum']) } })
    ok(r.status !== 0 && /^LEDGER bad/m.test(r.stdout) && readdirSync(join(Y, 'runs')).length === 0, `${shell.name} · no decoder: LEDGER bad, nothing written`)
  }
  const lb = readFileSync(`${DIR}/briefs/ledger.md`, 'utf8')
  ok(/If it prints `LEDGER bad` instead/.test(lb) && /add, commit and push nothing/.test(lb), 'the ledger brief: on LEDGER bad, commit and push nothing')
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
