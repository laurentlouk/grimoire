// ════════════════════════════════════════════════════════════════════════════
//  Run durability: a journal that arrives whole — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-journal.test.mjs
//
//  Seven real runs' journals, read back with /grimoire:logs, had lost what mattered most:
//    • A CHUNK NEVER LANDED in three of them: seq 1–16 and 1–24 (the first chunk, run.start
//      included) and 36–47. The first chunk was held until the first landing, hours in, and was
//      the biggest payload the haiku writer had to retype; one leftover temp file decoded to a
//      payload copied wrong and cut short. A chunk the writer did not confirm was counted and
//      dropped, never sent again.
//    • THE FINAL run.json NEVER LANDED in two drained runs: run.json still said "running" while
//      the last chunk held a `run.end` with status drained. Nothing after the run's end rewrites it.
//  Now the first flush goes before the first dispatch (small, and the run is on disk from its
//  start), a flush also goes once the buffered events reach `flushBytes`, a chunk not confirmed
//  is sent again once in two pieces that carry its events only (to `<firstSeq>.r1.jsonl`), the
//  final run.json not confirmed is sent again alone, and a flush's landed delta is capped in bytes.
//
//  Same stubbed runtime as the other loop tests. The writer scripts of JR-1 are RUN, in bash,
//  zsh and dash (whichever exist), with a payload mistyped the way a writer copies one wrong;
//  the journal they leave is read back with scripts/render-logs.mjs.
import { readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRuns, runOutcome } from '../../scripts/render-logs.mjs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')
const constant = (name) => Number((new RegExp(`const ${name} = (\\d+)`).exec(body) || [])[1])
const LANDED_DELTA_BYTES = constant('LANDED_DELTA_BYTES')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const section = (t) => console.log(`\n── ${t}`)
const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8')
const heredocs = (prompt) => [...prompt.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => m[1])
const bashOf = (p) => (/```bash\n([\s\S]*?)\n```/.exec(p) || [])[1] || ''
const which = (t) => spawnSync('/bin/sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim()
const SHELLS = ['bash', 'zsh', 'dash'].map((name) => ({ name, path: which(name) })).filter((s) => s.path)
const TMP = mkdtempSync(join(tmpdir(), 'grimoire-journal-'))
let tmpN = 0
const fresh = (tag = 'd') => { const d = join(TMP, `${tag}-${++tmpN}`); mkdirSync(d, { recursive: true }); return d }

const REPOS = [{ name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: REPOS }
const QUIET = { precheck: false, verifyFindings: false }
const T = (n, extra = {}) => ({ id: `PROJ-${n}`, ticket: `PROJ-${n}`, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: n, taskText: `Build ${n}`, deferred: false, files: [`src/f${n}.ts — add ${n}`], dependsOn: n > 1 ? [`PROJ-${n - 1}`] : [], ...extra })
const IMPL = (n, extra = {}) => ({ status: 'DONE', summary: `built ${n}`, commits: [`a${n}aaaaa`], baseSha: '0000000', startSha: '0000000', headSha: `a${n}aaaaa`, filesChanged: [`src/f${n}.ts`], ...extra })
const happy = (label) => {
  if (label.startsWith('impl:')) return IMPL(+label.split('-')[1])
  if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
  if (label.startsWith('ship:')) return { pushed: true, remoteHead: 'x', prUrl: 'https://github.com/x/y/pull/9', draft: true }
  return { verdict: 'PASS', findings: [], summary: 'PASS' }
}
const indexOf = (tasks) => ({ slices: [{ slice: 1, sliceLabel: 'v', issues: tasks.map((t) => ({ id: t.id, title: `Title of ${t.id}`, repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })) }], hookProblems: [] })
async function run(scenario, tasks, responder, { args = {} } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map((t) => ({ ...t })) }
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
  const labels = calls.map((c) => c.label)
  return { result, calls, logs, labels, journals: calls.filter((c) => c.label.startsWith('journal#')) }
}

// What each journal script carries: its chunk, run.json and the landed delta are each optional (a resend carries one).
const payloads = (p) => {
  const hs = heredocs(p).map(unb64)
  const has = { chunk: /F="\$DIR\/events\//.test(p), runJson: /T="\$DIR\/run\.json\.\$\$"/.test(p), landed: /T="\$DIR\/landed\.jsonl\.\$\$"/.test(p) }
  return { has, chunk: has.chunk ? hs.shift() : null, runJson: has.runJson ? JSON.parse(hs.shift()) : null, landed: has.landed ? hs.shift() : null }
}
// What a faithful haiku returns: the script's lines mapped onto JOURNAL_SCHEMA.
const receiptOf = (out) => {
  const num = (re) => Number((re.exec(out) || [])[1] || 0)
  return { runDir: (/^RUNDIR (.+)$/m.exec(out) || [])[1] || '', lines: num(/^LINES (\d+)$/m), bytes: num(/^BYTES (\d+)$/m), runJson: (/^RUNJSON (ok|kept|bad)\b/m.exec(out) || [])[1], runJsonBytes: num(/^RUNJSON_BYTES (\d+)$/m), runJsonKept: (/^RUNJSON kept: (.*)$/m.exec(out) || [])[1], landed: num(/^LANDED ok (\d+)$/m) }
}
// A writer that confirms without touching disk: it reports what the script would.
const confirming = (p) => {
  const { has, chunk, runJson, landed } = payloads(p)
  return { runDir: (/^DIR='([^']+)'$/m.exec(p) || [])[1], lines: has.chunk ? chunk.trim().split('\n').length : 0, bytes: has.chunk ? Buffer.byteLength(chunk) : 0,
    runJson: has.runJson ? 'ok' : 'kept', runJsonBytes: has.runJson ? Buffer.byteLength(JSON.stringify(runJson) + '\n') : 0, landed: landed ? landed.trim().split('\n').length : 0 }
}
// The way a writer copies a payload wrong: one base64 character mistyped in the i-th heredoc.
const mistype = (script, i) => {
  const blocks = [...script.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)]
  const b = blocks[i][1]
  const k = Math.min(10, b.length - 1)
  return script.replace(b, b.slice(0, k) + (b[k] === 'A' ? 'B' : 'A') + b.slice(k + 1))
}
const sh = (shell, script) => spawnSync(shell.path, ['-c', script], { encoding: 'utf8' })
const isFlush = (label) => /^journal#\d+$/.test(label)
const leftovers = (d) => [...readdirSync(d), ...(existsSync(join(d, 'events')) ? readdirSync(join(d, 'events')) : [])].filter((f) => /\.\d+$|\.b64$|\.s$|\.d$|^\.lock$/.test(f))

try {
  // ══════════════ JR-1 · run for real: the first chunk and the final run.json copied wrong ══════════════
  for (const shell of SHELLS) {
    const TEL = fresh('tel')
    let finalLabel = null
    const r = await run(`JR-1 · ${shell.name}: the first chunk and the final run.json arrive mistyped; their resends make the journal whole`, [T(1), T(2)], (label, p) => {
      if (!label.startsWith('journal#')) return happy(label)
      let script = bashOf(p)
      if (label === 'journal#1') script = mistype(script, 0) // the chunk payload
      const pl = payloads(p)
      if (isFlush(label) && pl.runJson && pl.runJson.status !== 'running') { finalLabel = label; script = mistype(script, 1) } // the final run.json
      return receiptOf(sh(shell, script).stdout)
    }, { args: { ...QUIET, runId: 'run-j', telemetry: { dir: TEL } } })
    const D = join(TEL, 'run-j')
    const labels = r.journals.map((c) => c.label)
    const j = r.result.telemetry.journal
    ok(labels.includes('journal#1.r1') && labels.includes('journal#1.r2') && !labels.some((l) => /^journal#[2-9]\d*\.r\d$/.test(l)), 'the mistyped first chunk is resent in two pieces, and only it')
    const piece = r.journals.find((c) => c.label === 'journal#1.r1').prompt
    const pp = payloads(piece)
    ok(pp.has.chunk && !pp.has.runJson && !pp.has.landed && heredocs(piece).length === 1 && /F="\$DIR\/events\/\d{8}\.r1\.jsonl"/.test(bashOf(piece)) && /RUNJSON kept: not sent with this script/.test(piece),
      'a piece carries its events only: one payload, a .r1 file, no run.json, no landed delta')
    ok(!!finalLabel && labels.includes(`${finalLabel}.rj1`) && !labels.includes(`${finalLabel}.rj2`), `the final run.json (${finalLabel}), mistyped, is resent alone once, and that is enough`)
    const rj = r.journals.find((c) => c.label === `${finalLabel}.rj1`).prompt
    const rp = payloads(rj)
    ok(rp.has.runJson && !rp.has.chunk && !rp.has.landed && heredocs(rj).length === 1 && /echo "LINES 0"; echo "BYTES 0"/.test(rj) && rp.runJson.status === 'drained', 'the run.json resend carries run.json only, with the final status')
    const files = readdirSync(join(D, 'events')).sort()
    ok(!files.includes('00000001.jsonl') && files.includes('00000001.r1.jsonl') && files.filter((f) => f.endsWith('.r1.jsonl')).length === 2, `the mistyped chunk wrote nothing; its pieces did (${files.join(' ')})`)
    eq(leftovers(D), [], 'no temp file left behind')
    const [loaded] = loadRuns(TEL)
    const out = loaded && runOutcome(loaded)
    const seqs = loaded ? loaded.events.map((e) => e.seq) : []
    ok(!!loaded && loaded.status === 'drained' && !loaded.statusNote && readFileSync(join(D, 'run.json'), 'utf8').includes('"status":"drained"'), 'run.json says drained, written by the resend (no status repaired from run.end)')
    ok(!!out && out.journal.missingEvents === 0 && seqs.length === j.events && seqs.every((s, i) => s === i + 1), `render-logs reads every event, seq 1 to ${j.events}, none missing`)
    ok(j.resent === 1 && j.lost === 0 && j.lostEvents === 0 && j.written === j.events && j.runJsonResent === 1, `telemetry.journal: resent 1, lost 0, written ${j.written}/${j.events}, final run.json resent 1`)
  }

  // ══════════════ JR-1b · the same from session 2: pieces are `<firstSeq>.r1.a2.jsonl` ══════════════
  if (SHELLS.length) {
    const shell = SHELLS[0]
    const TEL = fresh('tel')
    mkdirSync(join(TEL, 'run-a2', 'events'), { recursive: true })
    writeFileSync(join(TEL, 'run-a2', 'sessions'), 'deadbeef 1\n') // an earlier launch registered attempt 1
    const r = await run(`JR-1b · ${shell.name}: a second session's mistyped first chunk`, [T(1)], (label, p) => {
      if (!label.startsWith('journal#')) return happy(label)
      return receiptOf(sh(shell, label === 'journal#1' ? mistype(bashOf(p), 0) : bashOf(p)).stdout)
    }, { args: { ...QUIET, runId: 'run-a2', telemetry: { dir: TEL } } })
    const files = readdirSync(join(TEL, 'run-a2', 'events')).sort()
    ok(files.length > 0 && files.every((f) => /\.a2\.jsonl$/.test(f)) && files.filter((f) => /^\d{8}\.r1\.a2\.jsonl$/.test(f)).length === 2, `the pieces carry the session: ${files.join(' ')}`)
    const [loaded] = loadRuns(TEL)
    ok(!!loaded && loaded.events.every((e) => e.attempt === 2) && runOutcome(loaded).journal.missingEvents === 0 && r.result.telemetry.journal.lost === 0, 'every event read back as attempt 2, none missing')
  }

  // ══════════════ JR-2 · the first flush goes before the first dispatch ══════════════
  {
    const r = await run('JR-2 · the run is on disk from its start', [T(1)], (label, p) => (label.startsWith('journal#') ? confirming(p) : happy(label)), { args: { ...QUIET, runId: 'run-s', telemetry: { dir: fresh('tel') } } })
    const first = r.labels.indexOf('journal#1'), impl = r.labels.findIndex((l) => l.startsWith('impl:'))
    const p1 = payloads(r.journals[0].prompt)
    const types = p1.chunk.trim().split('\n').map((l) => JSON.parse(l).type)
    ok(first >= 0 && first < impl, `journal#1 is dispatched before the first implementer (${first} < ${impl})`)
    ok(types[0] === 'run.start' && !types.includes('route') && !types.includes('dispatch') && p1.runJson.status === 'running', `its chunk holds the start only (${types.join(', ')}), and run.json says running`)
  }

  // ══════════════ JR-3 · a flush once the buffered events reach flushBytes ══════════════
  {
    const tasks = [1, 2, 3, 4].map((n) => T(n))
    const chunks = async (flushBytes) => {
      const r = await run(`JR-3 · flushEvery 1000, flushBytes ${flushBytes}`, tasks, (label, p) => (label.startsWith('journal#') ? confirming(p) : happy(label)),
        { args: { ...QUIET, runId: 'run-b', telemetry: { dir: fresh('tel'), flushEvery: 1000, flushBytes } } })
      return r.journals.filter((c) => isFlush(c.label)).map((c) => payloads(c.prompt).chunk.trim().split('\n'))
    }
    const big = await chunks(1e9)
    const small = await chunks(600)
    const largest = Math.max(...small.flat().map((l) => Buffer.byteLength(l)))
    ok(small.length > big.length, `more, smaller chunks: ${small.length} at 600 bytes, ${big.length} without a byte limit`)
    ok(small.every((c) => c.reduce((a, l) => a + Buffer.byteLength(l), 0) <= 600 + largest), `no chunk holds more than 600 bytes plus its last event (largest event ${largest} bytes)`)
  }

  // ══════════════ JR-4 · the writer returns nothing once: the resend writes the chunk ══════════════
  {
    const r = await run('JR-4 · journal#2 returns nothing; its pieces land', [T(1), T(2)], (label, p) => (label === 'journal#2' ? null : label.startsWith('journal#') ? confirming(p) : happy(label)),
      { args: { ...QUIET, runId: 'run-n', telemetry: { dir: fresh('tel') } } })
    const j = r.result.telemetry.journal
    ok(r.labels.includes('journal#2.r1') && j.resent === 1 && j.lost === 0 && j.lostEvents === 0 && j.written === j.events, 'resent in pieces, nothing lost')
    ok(r.labels.filter((l) => isFlush(l)).length > 2 && !r.logs.some((l) => /marked dead/.test(l)), 'the writer is not marked dead: a confirmed piece resets the count')
  }

  // ══════════════ JR-5 · a resend that writes nothing either ══════════════
  {
    const fails = (p) => ({ ...confirming(p), lines: 0, bytes: 0 }) // the payload did not decode: CHUNK bad
    const r = await run('JR-5 · journal#2 and both its pieces fail; journal#3 fails too', [T(1), T(2), T(3)], (label, p) => {
      if (/^journal#2(\.|$)/.test(label) || label === 'journal#3') return fails(p)
      return label.startsWith('journal#') ? confirming(p) : happy(label)
    }, { args: { ...QUIET, runId: 'run-f', telemetry: { dir: fresh('tel') } } })
    const j = r.result.telemetry.journal
    const two = payloads(r.journals.find((c) => c.label === 'journal#2').prompt).chunk.trim().split('\n').length
    const three = payloads(r.journals.find((c) => c.label === 'journal#3').prompt).chunk.trim().split('\n').length
    ok(j.resent === 1 && !r.labels.some((l) => l.startsWith('journal#3.')), 'journal#2 is resent; journal#3 is not: a resend that wrote nothing turns resends off')
    ok(j.lost === 2 && j.lostEvents === two + three, `both chunks counted lost, with their ${two + three} events`)
    eq(r.logs.filter((l) => /later chunks are not resent/.test(l)).length, 1, 'logged once')
  }

  // ══════════════ JR-6 · a writer that never answers ══════════════
  {
    const r = await run('JR-6 · every writer returns nothing', [T(1), T(2)], (label) => (label.startsWith('journal#') ? null : happy(label)),
      { args: { ...QUIET, runId: 'run-d', telemetry: { dir: fresh('tel') } } })
    const j = r.result.telemetry.journal
    ok(r.labels.includes('journal#1.r1') && !r.labels.includes('journal#1.r2'), 'one piece is tried; the second null marks the writer dead and the other piece is not dispatched')
    ok(!r.labels.some((l) => /\.rj\d$/.test(l)) && j.lostEvents === j.events && j.written === 0, `no run.json resend once dead; every event counted lost (${j.lostEvents}/${j.events})`)
  }

  // ══════════════ JR-7 · a final run.json kept is no loss ══════════════
  {
    const r = await run('JR-7 · the final run.json kept: a newer one is on disk', [T(1)], (label, p) => {
      if (!label.startsWith('journal#')) return happy(label)
      const pl = payloads(p)
      return pl.runJson && pl.runJson.status !== 'running' ? { ...confirming(p), runJson: 'kept', runJsonBytes: 0, runJsonKept: 'gen 2 seq 99 on disk is newer than gen 1 seq 9' } : confirming(p)
    }, { args: { ...QUIET, runId: 'run-k', telemetry: { dir: fresh('tel') } } })
    ok(!r.labels.some((l) => /\.rj\d$/.test(l)) && r.result.telemetry.journal.runJsonResent === 0, 'not resent')
  }

  // ══════════════ JR-8 · the landed delta is capped in bytes ══════════════
  {
    // The writer confirms no landed delta until four tasks have landed: the backlog it leaves must
    // still go out in deltas of at most LANDED_DELTA_BYTES (or one task), never all at once.
    const tasks = [1, 2, 3, 4, 5, 6].map((n) => T(n))
    const long = (n) => IMPL(n, { summary: `Implemented ${n}: ${'wired the component into the route, added tests. '.repeat(6)}`, filesChanged: Array.from({ length: 12 }, (_, k) => `apps/web/src/features/feature-${n}/components/Component${k}.tsx`) })
    let landedSoFar = 0
    const seen = []
    const r = await run('JR-8 · six landings of ~1.3 kB of detail each; the first deltas go unconfirmed', tasks, (label, p) => {
      if (label.startsWith('impl:')) { landedSoFar++; return long(+label.split('-')[1]) }
      if (!label.startsWith('journal#')) return happy(label)
      const { landed } = payloads(p)
      if (landed) seen.push({ ids: landed.trim().split('\n').map((l) => JSON.parse(l).id), bytes: Buffer.byteLength(landed), landedSoFar })
      return landedSoFar < 4 ? { ...confirming(p), landed: 0 } : confirming(p)
    }, { args: { ...QUIET, runId: 'run-l', telemetry: { dir: fresh('tel') } } })
    const backlog = seen.find((d) => d.landedSoFar >= 4)
    ok(seen.every((d) => d.ids.length === 1 || d.bytes <= LANDED_DELTA_BYTES), `every delta holds one task, or at most ${LANDED_DELTA_BYTES} bytes of them (${seen.map((d) => `${d.ids.length} task(s)/${d.bytes} B`).join(', ')})`)
    ok(!!backlog && backlog.ids.length > 1 && backlog.ids.length < backlog.landedSoFar, `the backlog goes out capped: ${backlog && backlog.ids.length} of ${backlog && backlog.landedSoFar} unconfirmed in the first delta after it`)
    eq([...new Set(seen.slice(seen.indexOf(backlog)).flatMap((d) => d.ids))].sort(), tasks.map((t) => t.id).sort(), 'every task reaches landed.jsonl by the end')
    ok(r.result.done.length === 6, 'all six landed')
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
