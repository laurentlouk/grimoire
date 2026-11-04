// ════════════════════════════════════════════════════════════════════════════
//  Tests — the cost cap, maxCost (token economy slice 2, #48)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/economy-maxcost.test.mjs
//
//  What this locks down:
//    • with maxCost set, every journal script runs the cost command after writing
//      (scripts/economy/runs.mjs cost --run <runId>), and the writer returns costSoFar
//    • the engine checks the cost before every dispatch, beside maxOutputTokens: past the cap it
//      stops dispatching, lets in-flight work settle, and halts budget_exhausted naming the cost cap
//    • 80 % of the cap is journaled once as a warning; the stop as a budget event of kind cost
//    • a cost the writer cannot read never halts: one budget event says the cap is blind
//    • without maxCost, the script carries no cost command
//    • the generated script, run for real against a fixture Claude dir, prints COST <n> for every
//      session of the runId (a resumed run carries its earlier sessions' cost)
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeClaudeRun } from '../../scripts/economy/fixtures.mjs'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SCRIPTS = `${DIR}/scripts`
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const section = (t) => console.log(`\n── ${t}`)
const tick = (ms) => new Promise((r) => setTimeout(r, ms))
const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8')
const bashOf = (p) => (/```bash\n([\s\S]*?)\n```/.exec(p) || [])[1] || ''
const TMP = mkdtempSync(join(tmpdir(), 'grimoire-maxcost-'))
let tmpN = 0
const fresh = (tag) => { const d = join(TMP, `${tag}-${++tmpN}`); mkdirSync(d, { recursive: true }); return d }

const REPOS = [{ name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }]
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: REPOS }
const QUIET = { precheck: false, verifyFindings: false }
const T = (n) => ({ id: `PROJ-${n}`, ticket: `PROJ-${n}`, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: n, taskText: `Build ${n}`, deferred: false, files: [`src/f${n}.ts — add ${n}`], dependsOn: n > 1 ? [`PROJ-${n - 1}`] : [] })
const IMPL = (n) => ({ status: 'DONE', summary: `built ${n}`, commits: [`a${n}aaaaa`], baseSha: '0000000', startSha: '0000000', headSha: `a${n}aaaaa`, filesChanged: [`src/f${n}.ts`] })
const indexOf = (tasks) => ({ slices: [{ slice: 1, sliceLabel: 'v', issues: tasks.map((t) => ({ id: t.id, title: `Title of ${t.id}`, repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn })) }], hookProblems: [] })
const happy = (label) => {
  if (label.startsWith('impl:')) return IMPL(+label.split('-')[1])
  if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' }
  if (label.startsWith('ship:')) return { pushed: true, remoteHead: 'x', prUrl: 'https://github.com/x/y/pull/9', draft: true }
  return { verdict: 'PASS', findings: [], summary: 'PASS' }
}
// A writer that confirms without touching disk, reporting the cost it is told to.
const payloadsOf = (p) => [...p.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => unb64(m[1]))
const confirming = (p, costSoFar) => {
  const hasChunk = /"\$DIR\/\.chunk\.\$\$\.b64"/.test(p), hasRun = /"\$DIR\/\.runjson\.\$\$\.b64"/.test(p)
  const hs = payloadsOf(p)
  const chunk = hasChunk ? hs[0] : ''
  return { writer: 'ok', runDir: (/^DIR='([^']+)'$/m.exec(p) || [])[1] || '/tmp/x', lines: hasChunk ? chunk.trim().split('\n').length : 0, bytes: hasChunk ? Buffer.byteLength(chunk) : 0,
    runJson: hasRun ? 'ok' : 'kept', runJsonBytes: hasRun ? Buffer.byteLength(hs[hasChunk ? 1 : 0]) : 0, landed: 0, ...(costSoFar === undefined ? {} : { costSoFar }) }
}
// Every event the engine sent to the writer, in order.
const eventsOf = (calls) => calls.filter((c) => /^journal#\d+$/.test(c.label) && /"\$DIR\/\.chunk\.\$\$\.b64"/.test(c.prompt))
  .flatMap((c) => payloadsOf(c.prompt)[0].trim().split('\n').map((l) => JSON.parse(l))).sort((a, b) => a.seq - b.seq)

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
  return { result, calls, logs, labels: calls.map((c) => c.label), events: eventsOf(calls) }
}

try {
  // ══════ MC-1 · past the cap: no new dispatch, in-flight work settles, halt names the cost cap ══════
  {
    const r = await run('MC-1 · the cost rises past maxCost while PROJ-1 builds', [T(1), T(2)], async (label, p, o, calls) => {
      if (label.startsWith('journal#')) return confirming(p, calls.some((c) => c.label === 'impl:PROJ-1') ? 1200 : 100)
      if (label === 'impl:PROJ-1') { await tick(80); return IMPL(1) } // the flushes during its build report the new cost
      return happy(label)
    }, { args: { ...QUIET, runId: 'run-mc1', scriptsDir: SCRIPTS, maxCost: 1000, telemetry: { dir: fresh('tel'), flushEvery: 1 } } })
    ok(r.labels.includes('impl:PROJ-1') && !r.labels.includes('impl:PROJ-2'), `the dependent is never dispatched once the cost is past the cap (${r.labels.filter((l) => l.startsWith('impl:')).join(' ')})`)
    ok(JSON.stringify(r.result.done.map((d) => d.id)) === '["PROJ-1"]', `the task in flight still settles (${JSON.stringify(r.result.done.map((d) => d.id))})`)
    ok(r.result.halt && r.result.halt.kind === 'budget' && r.result.halt.reason === "budget_exhausted: this run's cost cap (1.0k effective tokens) reached at 1.2k — stopped cleanly at quiescence",
      `the halt names the cost cap (${JSON.stringify(r.result.halt)})`)
    const budget = r.events.filter((e) => e.type === 'budget').map(({ spent, cap, action, kind }) => ({ spent, cap, action, kind }))
    ok(JSON.stringify(budget) === JSON.stringify([{ spent: 1200, cap: 1000, action: 'warn', kind: 'cost' }, { spent: 1200, cap: 1000, action: 'stop', kind: 'cost' }]),
      `the journal holds the warning at 80 % and the stop, both of kind cost (${JSON.stringify(budget)})`)
    const flush = r.calls.find((c) => /^journal#\d+$/.test(c.label)).prompt
    ok(flush.includes(`COSTJS='${SCRIPTS}/../../scripts/economy/runs.mjs'; RUNID='run-mc1'`), 'the journal script names the cost command and the runId')
  }

  // ══════ MC-2 · an unreadable cost never halts: the cap is blind, said once ══════
  {
    const r = await run('MC-2 · the writer reports no cost', [T(1), T(2)], (label, p) => (label.startsWith('journal#') ? confirming(p) : happy(label)),
      { args: { ...QUIET, runId: 'run-mc2', maxCost: 1000, telemetry: { dir: fresh('tel'), flushEvery: 1 } } })
    ok(!r.result.halt && JSON.stringify(r.result.done.map((d) => d.id)) === '["PROJ-1","PROJ-2"]', `the run builds everything (${JSON.stringify(r.result.done.map((d) => d.id))} ${JSON.stringify(r.result.halt)})`)
    const blind = r.events.filter((e) => e.type === 'budget')
    ok(blind.length === 1 && blind[0].action === 'blind' && blind[0].kind === 'cost' && blind[0].cap === 1000 && blind[0].spent === null,
      `one budget event says the cost cap is blind (${JSON.stringify(blind)})`)
    ok(r.logs.filter((l) => /cost cap is blind/.test(l)).length === 1, 'and the log says so once')
  }

  // ══════ MC-3 · no maxCost: no cost command; no journal: the cap is blind from the start ══════
  {
    const r = await run('MC-3 · without maxCost', [T(1)], (label, p) => (label.startsWith('journal#') ? confirming(p, 99999) : happy(label)),
      { args: { ...QUIET, runId: 'run-mc3', telemetry: { dir: fresh('tel'), flushEvery: 1 } } })
    const flush = r.calls.find((c) => /^journal#\d+$/.test(c.label)).prompt
    ok(/^COSTJS=; RUNID=$/m.test(bashOf(flush).split('\n').find((l) => l.startsWith('COSTJS=')) || '') && !r.result.halt,
      'the script carries an empty cost command, and a cost the writer reports anyway is ignored')
    const q = await run('MC-3b · maxCost with the journal off', [T(1)], happy, { args: { ...QUIET, runId: 'run-mc3b', maxCost: 10, telemetry: { enabled: false } } })
    ok(!q.result.halt && q.logs.some((l) => /maxCost=10: the cost cap is blind: the journal is off/.test(l)), `with no journal the cap is blind, and the log says why (${q.logs.find((l) => /cost cap is blind/.test(l)) || 'no line'})`)
  }

  // ══════ MC-4 · the generated script, run for real: COST for every session of the runId ══════
  {
    const root = fresh('root')
    const claude = fresh('claude')
    writeClaudeRun(claude, root, 'run-mc4') // two sessions of run-mc4 (a resume) + another run, which must be ignored
    const r = await run('MC-4 · (capture) one flush', [T(1)], (label, p) => (label.startsWith('journal#') ? confirming(p, 0) : happy(label)),
      { args: { ...QUIET, runId: 'run-mc4', scriptsDir: SCRIPTS, maxCost: 1e9, telemetry: { dir: fresh('tel'), flushEvery: 1000 } } })
    const script = bashOf(r.calls.find((c) => /^journal#\d+$/.test(c.label)).prompt)
    const out = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', env: { ...process.env, PWD: root, CLAUDE_CONFIG_DIR: claude } })
    ok(/^RUNDIR /m.test(out.stdout) && /^COST 12921$/m.test(out.stdout), `the script prints COST, summed over both sessions of the run (${(out.stdout.match(/^COST.*$/m) || [`${out.stdout}${out.stderr}`.trim().slice(-300)])[0]})`)
    const none = spawnSync('bash', ['-c', script.replace("RUNID='run-mc4'", "RUNID='no-such-run'")], { cwd: root, encoding: 'utf8', env: { ...process.env, PWD: root, CLAUDE_CONFIG_DIR: claude } })
    ok(/^COST none$/m.test(none.stdout) && /^RUNDIR /m.test(none.stdout), `no workflow of that runId: COST none, and the chunk is still written (${(none.stdout.match(/^COST.*$/m) || ['no COST line'])[0]})`)
  }

  // ══════ MC-5 · the installed layout: the skill runs a copy of workflows/ only, and passes pluginRoot ══════
  {
    const root = fresh('root')
    const claude = fresh('claude')
    writeClaudeRun(claude, root, 'run-mc5')
    const engine = join(root, '.grimoire', 'engine-0.20.0') // what skills/orchestrate copies: $P/workflows/. and nothing else
    mkdirSync(engine, { recursive: true })
    spawnSync('cp', ['-R', `${DIR}/.`, engine])
    const PLUGIN = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
    const script = async (args) => {
      const r = await run('MC-5 · (capture) the installed engine', [T(1)], (label, p) => (label.startsWith('journal#') ? confirming(p, 0) : happy(label)),
        { args: { ...QUIET, runId: 'run-mc5', briefsDir: join(engine, 'briefs'), maxCost: 1e9, telemetry: { dir: fresh('tel'), flushEvery: 1000 }, ...args } })
      const s = bashOf(r.calls.find((c) => /^journal#\d+$/.test(c.label)).prompt)
      return spawnSync('bash', ['-c', s], { cwd: root, encoding: 'utf8', env: { ...process.env, PWD: root, CLAUDE_CONFIG_DIR: claude } })
    }
    const withRoot = await script({ pluginRoot: PLUGIN })
    ok(/^COST 12921$/m.test(withRoot.stdout), `with pluginRoot, the copied engine reaches the plugin's cost script (${(withRoot.stdout.match(/^COST.*$/m) || ['no COST line'])[0]})`)
    const r = await run('MC-5b · no pluginRoot, an engine copy with no cost script beside it', [T(1)], (label, p) => (label.startsWith('journal#') ? confirming(p) : happy(label)),
      { args: { ...QUIET, runId: 'run-mc5b', briefsDir: join(engine, 'briefs'), maxCost: 1e9, telemetry: { dir: fresh('tel'), flushEvery: 1000 } } })
    ok(r.logs.some((l) => l.includes(`the cost cap is blind: a journal flush returned no cost; the cost script is looked for at ${join(engine, 'scripts')}/../../scripts/economy/runs.mjs, and an engine copy holds workflows/ only: pass pluginRoot`)),
      `without pluginRoot, the blind cap says where it looked for the cost script and what to pass (${r.logs.find((l) => /cost cap is blind/.test(l)) || 'no line'})`)
    ok(r.logs.filter((l) => /cost cap is blind/.test(l)).length === 1 && !r.logs.some((l) => /cost cap is blind.*maxOutputTokens still applies/.test(l)), 'said once, and without naming an output-token cap the run does not have')
  }

  // ══════ MC-6 · a resumed run already past the cap dispatches nothing ══════
  {
    const r = await run('MC-6 · resumed, its earlier sessions already cost more than the cap', [T(1), T(2)], (label, p) => (label.startsWith('journal#') ? confirming(p, 5000) : happy(label)),
      { args: { ...QUIET, runId: 'run-mc6', scriptsDir: SCRIPTS, maxCost: 1000, resumeState: { version: 2, runId: 'run-mc6', attempt: 1, lastSeq: 40, landed: [], pending: [] }, telemetry: { dir: fresh('tel'), flushEvery: 1000 } } })
    ok(!r.labels.some((l) => l.startsWith('impl:')) && r.result.halt && /^budget_exhausted: this run's cost cap \(1\.0k effective tokens\) reached at 5\.0k/.test(r.result.halt.reason),
      `the start flush is read before the first dispatch: no implementer runs (${r.labels.filter((l) => l.startsWith('impl:')).join(' ') || 'none'} · ${JSON.stringify(r.result.halt)})`)
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
