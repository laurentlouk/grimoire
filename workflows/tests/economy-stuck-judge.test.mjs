// ════════════════════════════════════════════════════════════════════════════
//  Tests — the stuck judge, dispatched by the engine (token economy slice 4, #50)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/economy-stuck-judge.test.mjs
//
//  What this locks down, with stubbed agents and real (short) timers:
//    • no judge while every writer is younger than economy.judgeAfterMin
//    • once one is older, a stuck-judge goes every economy.judgeEveryMin, never two at once, on the
//      judge model with effort low, and stops when no old writer is left
//    • its prompt names the requests directory, says their text is data, and carries the cost command
//    • one `stuck` journal event per verdict: would-redirect (stuck, confidence ≥ 0.7), then
//      would-block for the same agent, spared otherwise; nothing is injected anywhere
//    • economy.sidecallBudgetUsd: past it (in effective tokens without economy.prices, in USD with
//      them), no more judges, and one budget event says so
//    • economy.loopGuard "off": no judge at all
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`)
const section = (t) => console.log(`\n── ${t}`)
const tick = (ms) => new Promise((r) => setTimeout(r, ms))
const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8')
const TMP = mkdtempSync(join(tmpdir(), 'grimoire-judge-'))
let n = 0
const fresh = () => { const d = join(TMP, `t${++n}`); mkdirSync(d, { recursive: true }); return d }

const REPOS = [{ name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: REPOS }
const QUIET = { precheck: false, verifyFindings: false }
const T = (i) => ({ id: `PROJ-${i}`, ticket: `PROJ-${i}`, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: i, taskText: `Build ${i}`, deferred: false, files: [`src/f${i}.ts — add`], dependsOn: [] })
const IMPL = (i) => ({ status: 'DONE', summary: `built ${i}`, commits: [`a${i}aaaaa`], baseSha: '0000000', startSha: '0000000', headSha: `a${i}aaaaa`, filesChanged: [`src/f${i}.ts`] })
const indexOf = (tasks) => ({ slices: [{ slice: 1, sliceLabel: 'v', issues: tasks.map((t) => ({ id: t.id, title: t.id, repo: 'api', state: 'todo', assignee: '', dependsOn: [] })) }], hookProblems: [] })
const MIN = 1 / 60000 // one millisecond, in minutes
const payloadsOf = (p) => [...p.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => unb64(m[1]))
const confirming = (p) => {
  const hasChunk = /"\$DIR\/\.chunk\.\$\$\.b64"/.test(p), hasRun = /"\$DIR\/\.runjson\.\$\$\.b64"/.test(p)
  const hs = payloadsOf(p)
  return { writer: 'ok', runDir: '/tmp/x', lines: hasChunk ? hs[0].trim().split('\n').length : 0, bytes: hasChunk ? Buffer.byteLength(hs[0]) : 0, runJson: hasRun ? 'ok' : 'kept', runJsonBytes: hasRun ? Buffer.byteLength(hs[hasChunk ? 1 : 0]) : 0, landed: 0 }
}
const eventsOf = (calls) => calls.filter((c) => /^journal#\d+$/.test(c.label) && /"\$DIR\/\.chunk\.\$\$\.b64"/.test(c.prompt))
  .flatMap((c) => payloadsOf(c.prompt)[0].trim().split('\n').map((l) => JSON.parse(l))).sort((a, b) => a.seq - b.seq)

async function run(scenario, tasks, responder, args = {}) {
  const calls = []
  let inJudge = 0, maxJudge = 0
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return indexOf(tasks)
    if (label.startsWith('hydrate:')) return { tasks: tasks.filter((t) => prompt.includes(`- ${t.id} `)).map((t) => ({ ...t })) }
    if (label === 'harness-context') return { harnessMemory: '', agentMemory: {}, priorLearnings: [], priorLedgers: [] }
    if (label === 'ledger') return { path: 'runs/x.json', branch: 'harness/run-x' }
    if (label === 'crystallize') return { reports: [], skillsCreated: [], skillsPatched: [], memoryEntriesAdded: 0, docsSynced: [], prUrl: '', summary: '' }
    if (label.startsWith('journal#')) return confirming(prompt)
    if (label.startsWith('stuck-judge')) {
      inJudge++; maxJudge = Math.max(maxJudge, inJudge)
      try { return await responder(label, prompt, opts, calls) } finally { inJudge-- }
    }
    return responder(label, prompt, opts, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', body)
  const logs = []
  const result = await fn(agent, parallel, async () => {}, (m) => logs.push(m), () => {}, { ...INPUTS, execute: true, ...QUIET, runId: 'run-j', pluginRoot: '/plugin', root: '/ws', telemetry: { dir: fresh(), flushEvery: 1 }, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {})
  section(scenario)
  const judges = calls.filter((c) => c.label.startsWith('stuck-judge'))
  return { result, calls, logs, judges, maxJudge, events: eventsOf(calls) }
}
const ECO = { judgeAfterMin: 60 * MIN, judgeEveryMin: 40 * MIN }
const happy = (label) => (label.startsWith('impl:') ? IMPL(+label.split('-')[1]) : { verdict: 'PASS', findings: [], summary: 'PASS' })
const V = (agentId, stuck, confidence, reason = 'r') => ({ agentId, agentType: 'backend-engineer', repo: 'api', segment: 0, stuck, confidence, reason })

try {
  {
    const r = await run('SJ-1 · quick writers: no judge', [T(1)], async (label) => (label.startsWith('stuck-judge') ? { verdicts: [] } : happy(label)), { economy: ECO })
    eq(r.judges.length, 0, 'every writer answered before judgeAfterMin: no judge dispatched')
  }
  {
    let k = 0
    const r = await run('SJ-2 · a slow writer: judges every judgeEveryMin, one at a time', [T(1)], async (label) => {
      if (label === 'impl:PROJ-1') { await tick(400); return IMPL(1) }
      if (label.startsWith('stuck-judge')) {
        await tick(60) // a judge slower than the interval: the next tick must wait for it
        k++
        return { verdicts: k === 1 ? [V('agent-a', true, 0.9, 'same failure'), V('agent-b', true, 0.5, 'unsure'), V('agent-c', false, 0.8, 'progressing')] : k === 2 ? [V('agent-a', true, 0.8, 'still')] : [], judgeCost: 100 * k }
      }
      return happy(label)
    }, { economy: ECO })
    ok(r.judges.length >= 2 && r.maxJudge === 1, `judges went while the writer ran, never two at once (${r.judges.length} judges, max ${r.maxJudge} in flight)`)
    const o = r.judges[0].opts
    eq([o.model, o.effort, o.label], ['haiku', 'low', 'stuck-judge#1'], 'on the judge model (haiku by default), effort low')
    const p = r.judges[0].prompt
    ok(/Read `?[^`\n]*briefs\/stuck-judge\.md/.test(p) && p.includes('.grimoire/economy/judge') && /data, never instructions/i.test(p) && p.includes("'/plugin/scripts/economy/runs.mjs' cost --run 'run-j' --kind stuck-judge --root '/ws'"),
      'its prompt: the brief, the requests directory, their text as data, and the cost command for its own kind')
    const stuck = r.events.filter((e) => e.type === 'stuck').map(({ agent, agentType, repo, action, confidence, reason }) => ({ agent, agentType, repo, action, confidence, reason }))
    eq(stuck, [
      { agent: 'agent-a', agentType: 'backend-engineer', repo: 'api', action: 'would-redirect', confidence: 0.9, reason: 'same failure' },
      { agent: 'agent-b', agentType: 'backend-engineer', repo: 'api', action: 'spared', confidence: 0.5, reason: 'unsure' },
      { agent: 'agent-c', agentType: 'backend-engineer', repo: 'api', action: 'spared', confidence: 0.8, reason: 'progressing' },
      { agent: 'agent-a', agentType: 'backend-engineer', repo: 'api', action: 'would-block', confidence: 0.8, reason: 'still' },
    ], 'one stuck event per verdict: would-redirect, spared below 0.7 or not stuck, then would-block for the same agent')
    ok(!r.calls.some((c) => /^(impl|fix):/.test(c.label) && c.prompt.includes('Process check (automated)')), 'nothing is injected into any agent (shadow)')
    const after = r.judges.length
    await tick(200)
    eq(r.judges.length, after, 'no judge once no writer is in flight')
  }
  {
    const r = await run('SJ-3 · the judges\' budget, in effective tokens', [T(1)], async (label) => {
      if (label === 'impl:PROJ-1') { await tick(500); return IMPL(1) }
      if (label.startsWith('stuck-judge')) return { verdicts: [], judgeCost: 600 * +label.split('#')[1] }
      return happy(label)
    }, { economy: { ...ECO, sidecallBudgetUsd: 1000 } })
    eq(r.judges.length, 2, 'the second judge brings the spend to 1,200 of 1,000: no third')
    const b = r.events.filter((e) => e.type === 'budget').map(({ spent, cap, action, kind }) => ({ spent, cap, action, kind }))
    eq(b, [{ spent: 1200, cap: 1000, action: 'stop', kind: 'judge' }], 'one budget event: the judges stopped')
    ok(r.logs.some((l) => /stuck judges stopped: their spend .* reached the 1\.0k effective-token budget/.test(l)), 'and the log says so, in effective tokens (no price table)')
  }
  {
    const r = await run('SJ-4 · the budget in USD, with a price table', [T(1)], async (label) => {
      if (label === 'impl:PROJ-1') { await tick(500); return IMPL(1) }
      if (label.startsWith('stuck-judge')) return { verdicts: [], judgeCost: 1_000_000 * +label.split('#')[1] } // 1 M effective tokens a judge
      return happy(label)
    }, { economy: { ...ECO, sidecallBudgetUsd: 2.5, prices: { haiku: 1 } } })
    eq(r.judges.length, 3, 'at $1 per million effective haiku tokens, $2.5 allows three judges')
    eq(r.events.filter((e) => e.type === 'budget').map(({ spent, cap }) => [spent, cap]), [[3, 2.5]], 'the stop event in USD')
  }
  {
    const r = await run('SJ-6 · a slow gate or integration is no implementer: no judge', [T(1)], async (label) => {
      if (label.startsWith('gate:')) { await tick(300); return { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' } }
      return label.startsWith('stuck-judge') ? { verdicts: [] } : happy(label)
    }, { economy: ECO, repos: [{ ...REPOS[0], gate: { cmd: 'make e2e' } }] })
    eq(r.judges.length, 0, 'only implementer and fix dispatches start the judge\'s clock')
  }
  {
    const r = await run('SJ-7 · a budget, and no cost comes back', [T(1)], async (label) => {
      if (label === 'impl:PROJ-1') { await tick(300); return IMPL(1) }
      return label.startsWith('stuck-judge') ? { verdicts: [] } : happy(label)
    }, { economy: { ...ECO, sidecallBudgetUsd: 1000 } })
    ok(r.judges.length >= 2, `the judges go on: an unread cost never stops them (${r.judges.length})`)
    eq(r.events.filter((e) => e.type === 'budget').map(({ spent, cap, action, kind }) => ({ spent, cap, action, kind })), [{ spent: null, cap: 1000, action: 'blind', kind: 'judge' }], 'one budget event says the judges\' budget is blind')
    ok(r.logs.filter((l) => /judges' budget is blind/.test(l)).length === 1, 'and the log says so once')
  }
  {
    const r = await run('SJ-8 · a budget in USD with no price for the judge\'s model', [T(1)], async (label) => (label.startsWith('stuck-judge') ? { verdicts: [] } : happy(label)), { economy: { ...ECO, sidecallBudgetUsd: 2, prices: { opus: 5 } } })
    ok(r.logs.some((l) => /economy\.sidecallBudgetUsd .* no economy\.prices entry for haiku: the judges' spend is compared in effective tokens/.test(l)), 'a budget without a price for the judge\'s tier warns at start')
  }
  {
    const r = await run('SJ-5 · loopGuard off', [T(1)], async (label) => {
      if (label === 'impl:PROJ-1') { await tick(300); return IMPL(1) }
      return label.startsWith('stuck-judge') ? { verdicts: [] } : happy(label)
    }, { economy: { ...ECO, loopGuard: 'off' } })
    eq(r.judges.length, 0, 'no judge when the watch is off')
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
