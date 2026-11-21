// ════════════════════════════════════════════════════════════════════════════
//  Tests — live.mjs: the live snapshot, over fixture projects in a temp dir
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/live.test.mjs            (LIVE_PRINT=1 prints each fixture's snapshot)
//
//  What this locks down:
//    • the contract's shape: every field present, in every fixture, null when unknown
//    • a running run: task counts, the active tasks (step, agent, model, round, since), the last
//      decisions newest first, the caps and output tokens from the journal, the effective cost
//      from .grimoire/live/cost.json only, which a detached child refreshes (one at a time) once
//      it is missing or 60 s old, recomputing only when a transcript or a dispatch moved
//    • review regressions: of two running runs the one written to last; the caps of the last
//      run.start; counts as the run's own outcome has them (tracker-done issues left out, a BLOCKED
//      settle failed, what never ran on an ended run blocked); a task an earlier session left in
//      flight is queued; event types such as `constructor` or `__proto__` look up nothing; a time
//      a Date cannot hold is null in its field only
//    • a run halted by the cost fuse reads budget_exhausted; a closed run reads closed; a run
//      that ended more than 6 h ago, and a "running" one silent for a day, are no run
//    • the briefing line is exactly what `manager.mjs headline` prints
//    • the stuck watch: its mode, and its verdicts of the last hour, newest first, at most 5
//    • a corrupt chunk, run.json, cache, turn state or briefing still prints valid JSON, exit 0;
//      a part that throws is null and counted in `errors`
//    • the canary: ticket text written in a briefing, a journal, a checkpoint, landed.jsonl, a
//      close note or a judge's reason never reaches the output
//    • 5 runs × 2000 events: the CLI answers within 300 ms
//    • hooks/scripts/live-pointer.sh writes the plugin root to <project>/.grimoire/live/plugin-root,
//      never in the plugin folder or $HOME, silent and exit 0 whatever happens; in a linked git
//      worktree it counts the main checkout's .grimoire/ and writes in the worktree's own
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync, realpathSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { snapshot, COST_EVERY_MS } from './live.mjs'
import { closeRun, loadRuns, runOutcome } from './render-logs.mjs'
import { writeClaudeRun } from './economy/fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = realpathSync(join(HERE, '..'))
const SCRIPT = join(HERE, 'live.mjs')
const MANAGER = join(HERE, 'manager.mjs')
const POINTER = join(PLUGIN, 'hooks', 'scripts', 'live-pointer.sh')
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const section = (t) => console.log(`\n── ${t}`)
const PRINT = process.env.LIVE_PRINT === '1'

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'grimoire-live-')))
const CLAUDE = join(TMP, 'claude')
mkdirSync(join(CLAUDE, 'projects'), { recursive: true })
const ENV = { ...process.env, CLAUDE_CONFIG_DIR: CLAUDE }
const cli = (root, extra = []) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], { encoding: 'utf8', env: ENV })
const MIN = 60000, HOUR = 3600000
const ago = (ms) => new Date(Date.now() - ms).toISOString()
// ticket text, a judge's reasoning, a person's note: none of it may reach the snapshot
const CANARY = 'CANARY-7f3a ticket text: Customer ACME wants refunds for invoice 4411'
const CANARY_RE = /CANARY|Customer ACME|refunds|invoice 4411/

const pad = (n) => String(n).padStart(8, '0')
// A run dir: run.json, the events in chunks of `chunk` (each chunk's `at` is its flush time), landed.jsonl.
function writeRun(root, runId, { run = {}, events = [], at = Date.now(), step = 0, chunk = 40, landed = [], raw = null } = {}) {
  const d = join(root, '.grimoire', 'runs', runId)
  mkdirSync(join(d, 'events'), { recursive: true })
  if (run !== null) writeFileSync(join(d, 'run.json'), raw ?? JSON.stringify({ runId, attempt: 1, project: 'PROJ', meta: { grimoireVersion: '0.46.0' }, ...run }))
  for (let i = 0; i < events.length; i += chunk) {
    const flushed = new Date(at + Math.floor(i / chunk) * step).toISOString()
    const lines = events.slice(i, i + chunk).map((e, j) => JSON.stringify({ seq: i + j + 1, tok: (i + j + 1) * 50, at: flushed, attempt: 1, ...e }))
    writeFileSync(join(d, 'events', `${pad(i + 1)}.jsonl`), `${lines.join('\n')}\n`)
  }
  if (landed.length) writeFileSync(join(d, 'landed.jsonl'), landed.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return d
}
const KNOBS = { maxCost: 5000000, maxOutputTokens: 2000000 }
const start = (over = {}) => ({ type: 'run.start', project: 'PROJ', mode: 'execute', resumed: false, knobs: KNOBS, repos: ['api', 'web'], ...over })

// The contract's keys, exactly.
const KEYS = {
  top: ['version', 'at', 'root', 'run', 'briefing', 'watch', 'errors'],
  run: ['id', 'status', 'haltReason', 'startedAt', 'updatedAt', 'isStale', 'tasks', 'active', 'recent', 'cost'],
  tasks: ['total', 'done', 'active', 'failed', 'blocked', 'queued'],
  active: ['task', 'title', 'step', 'agent', 'model', 'round', 'since'],
  recent: ['at', 'kind', 'task', 'text'],
  cost: ['effective', 'maxCost', 'output', 'maxOutput', 'isCovered'],
  briefing: ['line', 'urgent', 'ready', 'isStale', 'isPartial', 'page'],
  watch: ['mode', 'flags'],
  flag: ['agent', 'reason', 'at'],
}
const same = (o, keys) => o !== null && typeof o === 'object' && JSON.stringify(Object.keys(o)) === JSON.stringify(keys)
function shapeOk(s) {
  if (!same(s, KEYS.top) || s.version !== 1 || typeof s.at !== 'string' || typeof s.errors !== 'number') return false
  if (s.run !== null) {
    const r = s.run
    if (!same(r, KEYS.run) || !same(r.tasks, KEYS.tasks) || !same(r.cost, KEYS.cost)) return false
    if (!Array.isArray(r.active) || r.active.length > 8 || !r.active.every((a) => same(a, KEYS.active))) return false
    if (!Array.isArray(r.recent) || r.recent.length > 8 || !r.recent.every((e) => same(e, KEYS.recent) && e.text.length <= 100)) return false
  }
  if (s.briefing !== null && !same(s.briefing, KEYS.briefing)) return false
  if (s.watch !== null && (!same(s.watch, KEYS.watch) || s.watch.flags.length > 5 || !s.watch.flags.every((f) => same(f, KEYS.flag)))) return false
  return true
}
const run = (root, extra) => {
  const r = cli(root, extra)
  let json = null
  try { json = JSON.parse(r.stdout) } catch {}
  return { ...r, json, lines: r.stdout.split('\n').filter(Boolean).length }
}
const samples = {}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
// The detached refresh: waits (up to 15 s) for the run's cache, matching `pred`, with no lock held.
function waitCost(root, runId, pred = () => true) {
  const live = join(root, '.grimoire', 'live')
  for (let i = 0; i < 150; i++) {
    let c = null
    try { c = JSON.parse(readFileSync(join(live, 'cost.json'), 'utf8')) } catch {}
    if (c && c.runId === runId && pred(c) && !existsSync(join(live, 'cost.lock'))) return true
    sleep(100)
  }
  return false
}

try {
  // ── a running run ─────────────────────────────────────────────────────────
  const P1 = join(TMP, 'running')
  mkdirSync(P1, { recursive: true })
  writeFileSync(join(P1, 'grimoire.config.json'), JSON.stringify({ economy: { loopGuard: 'on' } }))
  const t0 = Date.now() - 40 * MIN
  writeRun(P1, 'R1', {
    run: { startedAt: new Date(t0).toISOString(), updatedAt: ago(2 * MIN), status: 'running',
      checkpoint: { version: 2, outputTokensSpent: 812345, landed: ['T3'], pending: ['T1', 'T2', 'T4', 'T5', 'T6', 'T7'],
        landedTasks: [{ id: 'T3', repo: 'api', headSha: 'abc', title: CANARY }], learnings: [{ text: CANARY, repos: ['api'] }] } },
    at: t0, step: 2 * MIN, chunk: 6,
    landed: [{ id: 'T3', repo: 'api', status: 'DONE', title: CANARY, summary: CANARY, commits: ['abc'], files: ['a.ts'] }],
    events: [
      start(),
      { type: 'claim', task: 'T1', action: 'claim', by: 'Jane Customer' },
      { type: 'route', task: 'T1', repo: 'api', agent: 'api-engineer', model: 'sonnet', reason: CANARY, policy: 'balanced' },
      { type: 'route', task: 'T2', repo: 'web', agent: 'web-engineer', model: 'haiku', reason: CANARY },
      { type: 'route', task: 'T3', repo: 'api', agent: 'api-engineer', model: 'sonnet', reason: CANARY },
      { type: 'route', task: 'T4', repo: 'api', agent: 'migration-engineer', model: 'opus', reason: CANARY },
      { type: 'dispatch', task: 'T3', repo: 'api', agent: 'api-engineer', model: 'sonnet', lane: 'direct', cycle: 1 },
      { type: 'precheck', task: 'T3', verdict: 'PASS', problems: [] },
      { type: 'settle', task: 'T3', repo: 'api', status: 'DONE' },
      { type: 'dispatch', task: 'T6', repo: 'web', agent: 'web-engineer', model: 'haiku', lane: 'direct', cycle: 1 },
      { type: 'settle', task: 'T6', repo: 'web', status: 'BLOCKED' },
      { type: 'dispatch', task: 'T7', repo: 'api', agent: 'api-engineer', model: 'sonnet', lane: 'direct', cycle: 1 },
      { type: 'settle', task: 'T7', repo: 'api', status: 'REVIEW_FAILED' },
      { type: 'dispatch', task: 'T1', repo: 'api', agent: 'api-engineer', model: 'sonnet', lane: 'direct', cycle: 2 },
      { type: 'precheck', task: 'T1', verdict: 'FAIL', problems: [`a.ts:3 — ${CANARY}`] },
      { type: 'review', task: 'T1', stage: 'spec', persona: 'spec-hawk', verdict: 'FAIL', gating: 2, advisory: 1, round: 1, reason: CANARY },
      { type: 'verify', task: 'T1', stage: 'spec', round: 1, confirmed: 1, overturned: 1, reasons: [CANARY] },
      { type: 'replan', n: 1, decision: 'REVISE', cause: 'code', reason: CANARY, requeued: 1, learnings: [CANARY] },
      { type: 'stuck', agent: 'a1', agentType: 'api-engineer', repo: 'api', action: 'would-redirect', confidence: 0.91, reason: CANARY },
      { type: 'dispatch', task: 'T2', repo: 'web', agent: 'web-engineer', model: 'haiku', lane: 'worktree', cycle: 2 },
      { type: 'fix', task: 'T1', stage: 'spec', round: 1, model: 'sonnet', findings: 1 },
      { type: 'escalate', task: 'T1', from: 'sonnet', to: 'opus', reason: CANARY },
      { type: 'budget', spent: 1700000, cap: 2000000, action: 'warn' },
      { type: 'landed.flush', n: 1 },
      { type: 'dispatch', task: CANARY, repo: 'api', agent: 'api-engineer', model: 'sonnet' }, // a task id that is free text never prints
    ],
  })
  // an older halted run in the same project: the running one wins
  writeRun(P1, 'R0', { run: { startedAt: ago(5 * HOUR), updatedAt: ago(4 * HOUR), status: 'halted' }, at: Date.now() - 4 * HOUR,
    events: [start(), { type: 'halt', reason: CANARY, kind: 'harness' }, { type: 'run.end', status: 'halted', done: 0, failed: 0, blocked: 0, prs: 0, tokens: 5 }] })
  writeClaudeRun(CLAUDE, P1, 'R1')
  // the briefing: the headline's counts, and ticket text in its body
  const mdir = join(P1, '.grimoire', 'manager')
  mkdirSync(mdir, { recursive: true })
  const counts = { total: 6, urgent: 2, decide: 0, do: 2, ai: 3, waiting: 0, notnow: 1, closed: 0, new: 1, changed: 0, resolved: 0, runsNeedingUs: 1 }
  const fm = { generatedAt: ago(5 * HOUR), firstBriefing: false, partial: true, notChecked: ['jira'], sources: ['linear', 'jira'], counts }
  writeFileSync(join(mdir, 'latest.md'), `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# Briefing\n\n- PROJ-1 — ${CANARY}\n`)
  writeFileSync(join(mdir, 'briefing.html'), `<html>${CANARY}</html>`)
  // the stuck watch's states: two verdicts this hour, one older, a spared one, a state not touched for a day
  const turns = join(P1, '.grimoire', 'economy', 'turns')
  mkdirSync(turns, { recursive: true })
  const now = Date.now()
  writeFileSync(join(turns, 'a1.json'), JSON.stringify({ v: 1, agentId: 'a1', agentType: 'api-engineer', repo: 'api', calls: 44, events: [
    { action: 'would-redirect', reason: 'backstop:40>=38', calls: 40, segment: 0, at: now - 2 * HOUR },
    { action: 'spared', reason: 'judge-productive', calls: 41, segment: 0, at: now - 20 * MIN },
    { action: 'redirect', reason: 'backstop:40>=38', calls: 40, segment: 0, at: now - 10 * MIN },
    { action: 'block', reason: `judge-stuck@0.91: ${CANARY}`, calls: 44, segment: 1, at: now - 5 * MIN },
  ] }))
  writeFileSync(join(turns, 'main-s1.json'), JSON.stringify({ v: 1, agentId: 'main-s1', agentType: 'main', events: [{ action: 'would-block', reason: 'backstop:60>=50', at: now - 3 * MIN }] }))
  writeFileSync(join(turns, 'old.json'), JSON.stringify({ v: 1, agentId: 'old', agentType: 'web-engineer', events: [{ action: 'block', reason: 'backstop:9>=8', at: now - 30 * MIN }] }))
  utimesSync(join(turns, 'old.json'), new Date(now - 24 * HOUR), new Date(now - 24 * HOUR))
  writeFileSync(join(turns, 'broken.json'), '{ not json')

  section('a running run')
  const s0 = run(P1)
  ok(s0.json.run.cost.effective === null && s0.json.run.cost.isCovered === false, 'the first snapshot never reads a transcript: no bill yet, a refresh started in a detached child')
  ok(waitCost(P1, 'R1'), 'the child wrote the bill to .grimoire/live/cost.json and released its lock')
  const s1 = run(P1)
  samples.running = s1.json
  ok(s1.status === 0 && s1.lines === 1 && s1.stderr === '', 'exit 0, one line of JSON, nothing on stderr')
  ok(shapeOk(s1.json), 'every field of the contract, in order')
  const r1 = s1.json.run
  ok(r1.id === 'R1' && r1.status === 'running' && r1.haltReason === null && r1.isStale === false, `the newest running run, not stale (${r1.id} ${r1.status})`)
  ok(r1.startedAt === new Date(t0).toISOString() && Date.parse(r1.updatedAt) > Date.now() - 10 * MIN, 'startedAt from run.json, updatedAt from the last write')
  const tk = r1.tasks
  ok(tk.total === 7 && tk.done === 1 && tk.active === 2 && tk.failed === 2 && tk.blocked === 0 && tk.queued === 2, `tasks: 7 total, 1 done, 2 active, 2 failed (a BLOCKED settle is failed, as run.end counts it), 2 queued (${JSON.stringify(tk)})`)
  ok(r1.active.map((a) => a.task).join(',') === 'T2,T1', `active tasks newest dispatch first (${r1.active.map((a) => a.task)})`)
  const a1 = r1.active.find((a) => a.task === 'T1')
  ok(a1.step === 'fix' && a1.agent === 'api-engineer' && a1.model === 'opus' && a1.round === 1 && a1.title === null, `T1: fix round 1, escalated to opus, no title (${JSON.stringify(a1)})`)
  const a2 = r1.active.find((a) => a.task === 'T2')
  ok(a2.step === 'build' && a2.model === 'haiku' && a2.round === 0 && typeof a2.since === 'string', `T2: building on haiku since its dispatch (${JSON.stringify(a2)})`)
  ok(r1.recent.length === 8 && r1.recent[0].kind === 'dispatch' && r1.recent[0].task === null && r1.recent[1].kind === 'budget', `the last 8 decisions, newest first, the writer's landed.flush left out (${r1.recent.map((e) => e.kind)})`)
  ok(r1.recent[0].text === '? dispatched to api-engineer on sonnet', `a free-text task id prints as ? (${r1.recent[0].text})`)
  ok(r1.recent.some((e) => e.text === 'T1 escalated sonnet → opus') && r1.recent.some((e) => e.text === 'replan #1: REVISE · cause code · 1 requeued'), 'decision lines from ids, enums and counts')
  ok(r1.recent.every((e) => typeof e.at === 'string'), 'each decision carries its chunk\'s time')
  const c1 = r1.cost
  ok(c1.maxCost === 5000000 && c1.maxOutput === 2000000 && c1.output === 812345, `caps from run.start's knobs, output tokens from the checkpoint (${JSON.stringify(c1)})`)
  ok(typeof c1.effective === 'number' && c1.effective > 0, `then the effective cost from the transcripts (${c1.effective})`)
  ok(c1.isCovered === false, 'not covered: T1 has an implementer transcript, T2, T3, T6 and T7 none')
  const b1 = s1.json.briefing
  const headline = spawnSync(process.execPath, [MANAGER, 'headline', '--root', P1], { encoding: 'utf8', env: ENV }).stdout.replace(/\n$/, '')
  ok(b1 && headline && b1.line === headline, `the briefing line is exactly the headline (${b1 && b1.line})`)
  ok(b1.urgent === 2 && b1.ready === 3 && b1.isPartial === true && b1.isStale === false && b1.page === join(mdir, 'briefing.html'), `counts, partial, fresh, the page (${JSON.stringify({ ...b1, line: undefined })})`)
  const w1 = s1.json.watch
  ok(w1.mode === 'on', 'the watch mode from the config')
  ok(w1.flags.map((f) => f.reason).join(' | ') === 'would-block backstop:60>=50 | block | redirect backstop:40>=38', `this hour's verdicts, newest first; a spared one and an older one left out; a reason with text cut to its action (${w1.flags.map((f) => f.reason).join(' | ')})`)
  ok(w1.flags[0].agent === 'main' && w1.flags[1].agent === 'api-engineer', 'each flag names the agent type')
  ok(s1.json.errors === 0, 'no part failed (a corrupt turn state is skipped)')
  ok(!CANARY_RE.test(s1.stdout) && !/Jane/.test(s1.stdout), 'canary: no ticket text, reason, note or identity in the output')

  section('the cost cache: read, never recomputed on the snapshot\'s path')
  const cacheFile = join(P1, '.grimoire', 'live', 'cost.json')
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'))
  ok(cache.runId === 'R1' && cache.effective === c1.effective && typeof cache.key === 'string' && cache.key.startsWith('R1|'), `keyed by runId, newest transcript and dispatches (${cache.key})`)
  writeFileSync(cacheFile, JSON.stringify({ ...cache, effective: 42 }))
  ok(run(P1).json.run.cost.effective === 42 && !existsSync(join(P1, '.grimoire', 'live', 'cost.lock')), 'within 60 s the cache answers and no refresh starts')
  sleep(300)
  ok(JSON.parse(readFileSync(cacheFile, 'utf8')).effective === 42, '… and nothing rewrites it')
  writeFileSync(cacheFile, JSON.stringify({ ...cache, effective: 42, checkedAt: Date.now() - COST_EVERY_MS - 1000 }))
  ok(run(P1).json.run.cost.effective === 42, 'past 60 s the cached bill answers at once')
  ok(waitCost(P1, 'R1', (c) => Date.now() - c.checkedAt < 30000), 'and the child checks it again and stamps it')
  ok(JSON.parse(readFileSync(cacheFile, 'utf8')).effective === 42, 'nothing moved: the bill stands, not recomputed')
  writeFileSync(cacheFile, JSON.stringify({ ...cache, effective: 42, checkedAt: Date.now() - COST_EVERY_MS - 1000, key: 'R1|0|1' }))
  ok(run(P1).json.run.cost.effective === 42, 'a transcript or a dispatch moved: the old bill answers at once')
  ok(waitCost(P1, 'R1', (c) => c.effective === c1.effective) && run(P1).json.run.cost.effective === c1.effective, 'and the next snapshot has the recomputed one')
  writeFileSync(cacheFile, '{ broken')
  const sb = run(P1)
  ok(sb.json.run.cost.effective === null && sb.json.errors === 0, 'a corrupt cache is no bill, no error')
  ok(waitCost(P1, 'R1', (c) => c.effective === c1.effective), 'and is rewritten by the child')
  mkdirSync(join(P1, '.grimoire', 'live', 'cost.lock'))
  writeFileSync(cacheFile, JSON.stringify({ ...cache, effective: 42, checkedAt: Date.now() - COST_EVERY_MS - 1000, key: 'R1|0|1' }))
  run(P1)
  sleep(1500)
  ok(JSON.parse(readFileSync(cacheFile, 'utf8')).effective === 42, 'a refresh already at work (its lock): no second one')
  rmSync(join(P1, '.grimoire', 'live', 'cost.lock'), { recursive: true, force: true })

  // ── a run the cost fuse halted ────────────────────────────────────────────
  const P2 = join(TMP, 'halted')
  writeRun(P2, 'R2', {
    run: { startedAt: ago(3 * HOUR), updatedAt: ago(1 * HOUR), status: 'halted', summary: { done: 2, failed: 0, blocked: 0, tokens: 900000, halt: { reason: CANARY, kind: 'budget' } } },
    at: Date.now() - 1 * HOUR,
    events: [
      start(), { type: 'dispatch', task: 'A1', repo: 'api', agent: 'api-engineer', model: 'sonnet' }, { type: 'settle', task: 'A1', repo: 'api', status: 'DONE' },
      { type: 'dispatch', task: 'A2', repo: 'api', agent: 'api-engineer', model: 'sonnet' }, { type: 'settle', task: 'A2', repo: 'api', status: 'DONE_WITH_CONCERNS' },
      { type: 'budget', spent: 5100000, cap: 5000000, action: 'stop', kind: 'cost' },
      { type: 'halt', reason: `budget_exhausted: this run's cost cap (5.0M effective tokens) reached at 5.1M — stopped cleanly at quiescence ${CANARY}`, kind: 'budget' },
      { type: 'run.end', status: 'halted', done: 2, failed: 0, stillRunning: 0, recovered: 0, blocked: 0, prs: 1, tokens: 900000 },
    ],
  })
  section('a run the cost fuse halted')
  const s2 = run(P2)
  samples.halted = s2.json
  ok(shapeOk(s2.json) && s2.json.run.status === 'halted' && s2.json.run.haltReason === 'budget_exhausted' && s2.json.run.isStale === false, `halted · budget_exhausted (${s2.json.run.haltReason})`)
  ok(s2.json.run.tasks.done === 2 && s2.json.run.tasks.total === 2 && s2.json.run.active.length === 0, 'its tasks landed, none active')
  ok(s2.json.run.recent[0].text === 'run halted · 2 done, 0 failed, 0 blocked, 1 PR(s)' && s2.json.run.recent[1].text === 'halt · budget_exhausted' && s2.json.run.recent[2].text === 'budget cost stop · 5100000 of 5000000', `the fuse's decisions (${s2.json.run.recent.slice(0, 3).map((e) => e.text).join(' | ')})`)
  ok(s2.json.run.cost.output === 900000 && s2.json.run.cost.effective === null && s2.json.run.cost.isCovered === false, 'output from run.end; no transcripts on this machine: effective null, not covered')
  ok(s2.json.briefing === null && s2.json.watch.mode === 'shadow' && s2.json.watch.flags.length === 0, 'no briefing; the watch in its default mode, nothing flagged')
  ok(!CANARY_RE.test(s2.stdout), 'canary: the halt reason never prints')

  // ── a closed run ──────────────────────────────────────────────────────────
  const P3 = join(TMP, 'closed')
  writeRun(P3, 'R3', { run: { startedAt: ago(4 * HOUR), updatedAt: ago(2 * HOUR), status: 'drained' }, at: Date.now() - 2 * HOUR,
    events: [start(), { type: 'run.end', status: 'drained', done: 0, failed: 1, blocked: 0, prs: 0, tokens: 1000 }] })
  const closed = closeRun(join(P3, '.grimoire', 'runs'), 'R3', { reason: 'superseded', note: 'redone by hand: CANARY-7f3a' })
  section('a closed run')
  const s3 = run(P3)
  samples.closed = s3.json
  ok(closed.file && shapeOk(s3.json) && s3.json.run.status === 'closed' && s3.json.run.haltReason === null, `closed (${s3.json.run.status})`)
  ok(s3.json.run.recent[0].kind === 'run.close' && s3.json.run.recent[0].text === 'run closed · superseded', 'the close, its reason only')
  ok(Date.parse(s3.json.run.updatedAt) < Date.now() - HOUR, 'a close is no work: updatedAt stays the loop\'s last write')
  ok(!CANARY_RE.test(s3.stdout), 'canary: the close note never prints')

  // ── old runs ──────────────────────────────────────────────────────────────
  const P4 = join(TMP, 'old')
  writeRun(P4, 'R4', { run: { startedAt: ago(10 * HOUR), updatedAt: ago(8 * HOUR), status: 'drained' }, at: Date.now() - 8 * HOUR,
    events: [start(), { type: 'run.end', status: 'drained', done: 1, failed: 0, blocked: 0, prs: 1, tokens: 10 }] })
  writeRun(P4, 'R5', { run: { startedAt: ago(30 * HOUR), updatedAt: ago(20 * HOUR), status: 'running' }, at: Date.now() - 20 * HOUR, events: [start()] })
  const d6 = writeRun(P4, 'R6', { run: { startedAt: ago(3 * HOUR), updatedAt: ago(1 * HOUR), status: 'running' }, at: Date.now() - HOUR, events: [start()] })
  for (const p of [d6, join(d6, 'run.json'), join(d6, 'events'), join(d6, 'events', pad(1) + '.jsonl')]) utimesSync(p, new Date(now - 30 * HOUR), new Date(now - 30 * HOUR))
  section('old runs')
  const s4 = run(P4)
  samples.old = s4.json
  ok(shapeOk(s4.json) && s4.json.run === null && s4.json.errors === 0, 'a run that ended 8 h ago, and one "running" but silent for 20 h: no run')
  ok(s4.json.run === null, 'a run dir untouched for 30 h is not read at all, whatever its journal says')

  // ── corrupt files ─────────────────────────────────────────────────────────
  const P5 = join(TMP, 'corrupt')
  const d7 = writeRun(P5, 'R7', { run: { startedAt: ago(30 * MIN), updatedAt: ago(1 * MIN), status: 'running' }, at: Date.now() - MIN,
    events: [start(), { type: 'dispatch', task: 'C1', repo: 'api', agent: 'api-engineer', model: 'sonnet' }] })
  writeFileSync(join(d7, 'events', `${pad(3)}.jsonl`), '{"seq":3,"type":"review","task":"C1"\nnot json at all\n[1,2]\n"str"\n\u0000\u0001garbage\n')
  writeFileSync(join(d7, 'run.json'), '{ "runId": "R7", "status": ')
  mkdirSync(join(P5, '.grimoire', 'manager'), { recursive: true })
  writeFileSync(join(P5, '.grimoire', 'manager', 'latest.md'), `---\ncounts: {broken\n---\n${CANARY}\n`)
  mkdirSync(join(P5, '.grimoire', 'live'), { recursive: true })
  writeFileSync(join(P5, '.grimoire', 'live', 'cost.json'), '[]')
  writeFileSync(join(P5, 'grimoire.config.json'), '{ not json')
  section('corrupt files')
  const s5 = run(P5)
  samples.corrupt = s5.json
  ok(s5.status === 0 && shapeOk(s5.json), 'a corrupt chunk, run.json, briefing, cache and config: valid JSON, exit 0')
  ok(s5.json.run && s5.json.run.id === 'R7' && s5.json.run.status === 'running' && s5.json.run.tasks.active === 1, `the lines that parse still count (${JSON.stringify(s5.json.run && s5.json.run.tasks)})`)
  ok(s5.json.briefing === null && s5.json.watch.mode === 'shadow', 'a corrupt briefing is none; a config that does not parse is the default mode')
  ok(!CANARY_RE.test(s5.stdout), 'canary: a corrupt briefing\'s text never prints')
  // a part that throws: the runs dir is a file
  const P6 = join(TMP, 'failing')
  mkdirSync(join(P6, '.grimoire'), { recursive: true })
  writeFileSync(join(P6, '.grimoire', 'runs'), 'a file where the runs dir goes')
  const s6 = run(P6)
  samples.failing = s6.json
  ok(s6.status === 0 && shapeOk(s6.json) && s6.json.run === null && s6.json.errors === 1, `a part that throws is null and counted (errors ${s6.json.errors})`)
  const s7 = run(join(TMP, 'no-such-dir'), ['--now', 'not a time'])
  ok(s7.status === 0 && shapeOk(s7.json) && s7.json.errors === 1, 'a bad --now: still one line of valid JSON, exit 0')
  const direct = snapshot({ root: P1, claudeDir: CLAUDE })
  ok(shapeOk(direct) && direct.run.id === 'R1', 'snapshot() in process gives the same snapshot')

  // ── review regressions ────────────────────────────────────────────────────
  // A run dir written session by session: chunks [{attempt, at, events}], seq per session.
  function writeSessions(root, runId, run, chunks) {
    const d = join(root, '.grimoire', 'runs', runId)
    rmSync(join(d, 'events'), { recursive: true, force: true })
    mkdirSync(join(d, 'events'), { recursive: true })
    writeFileSync(join(d, 'run.json'), JSON.stringify({ runId, project: 'PROJ', meta: {}, ...run }))
    const seqs = {}
    for (const c of chunks) {
      const a = c.attempt ?? 1
      seqs[a] ??= 0
      const first = seqs[a] + 1
      const lines = c.events.map((e) => JSON.stringify({ seq: ++seqs[a], at: new Date(c.at).toISOString(), attempt: a, ...e }))
      writeFileSync(join(d, 'events', `${pad(first)}${a > 1 ? `.a${a}` : ''}.jsonl`), `${lines.join('\n')}\n`)
    }
  }
  const T0 = Date.now()
  section('review: which run, which session')
  const RA = join(TMP, 'two-running')
  // resumed now under an old startedAt, and a newer start whose session died 4 h ago (run.json still "running")
  writeSessions(RA, 'R_OLD', { attempt: 2, startedAt: ago(72 * HOUR), updatedAt: ago(2 * MIN), status: 'running', checkpoint: { attempt: 2, pending: ['X1', 'X2'] } }, [
    { attempt: 1, at: T0 - 72 * HOUR, events: [start(), { type: 'halt', kind: 'harness' }, { type: 'run.end', status: 'halted', done: 0, failed: 0, blocked: 0 }] },
    { attempt: 2, at: T0 - 2 * MIN, events: [start({ resumed: true }), { type: 'dispatch', task: 'X1', agent: 'api-engineer', model: 'sonnet' }] },
  ])
  writeSessions(RA, 'R_NEW', { attempt: 1, startedAt: ago(5 * HOUR), updatedAt: ago(4 * HOUR), status: 'running', checkpoint: { pending: ['Y1'] } }, [
    { attempt: 1, at: T0 - 4 * HOUR, events: [start(), { type: 'dispatch', task: 'Y1', agent: 'web-engineer', model: 'haiku' }] },
  ])
  const ra = run(RA).json.run
  ok(ra.id === 'R_OLD' && ra.isStale === false && ra.active.map((a) => a.task).join() === 'X1', `of two running runs, the one written to last, not the one started last (${ra.id})`)
  const RK = join(TMP, 'knobs')
  writeSessions(RK, 'R', { attempt: 2, startedAt: ago(5 * HOUR), updatedAt: ago(MIN), status: 'running', checkpoint: { attempt: 2, outputTokensSpent: 10 } }, [
    { attempt: 1, at: T0 - 4 * HOUR, events: [start({ knobs: { maxCost: 5000000, maxOutputTokens: 1000000 } }), { type: 'halt', kind: 'budget', reason: 'budget_exhausted: x' }, { type: 'run.end', status: 'halted' }] },
    { attempt: 2, at: T0 - MIN, events: [start({ resumed: true, knobs: { maxCost: 20000000, maxOutputTokens: 4000000 } })] },
  ])
  const rk = run(RK).json.run.cost
  ok(rk.maxCost === 20000000 && rk.maxOutput === 4000000, `the caps of the session writing now: the last run.start's knobs (${rk.maxCost}, ${rk.maxOutput})`)
  const RB = join(TMP, 'resume')
  // session 1 dispatched T1 and T2 (T2 landed) and died with T1 in review; session 2 resumed, absorbed T2, has not dispatched T1 again
  writeSessions(RB, 'R', { attempt: 2, startedAt: ago(9 * HOUR), updatedAt: ago(3 * MIN), status: 'running', checkpoint: { attempt: 2, pending: ['T1', 'T3'], landed: ['T2'], landedTasks: [{ id: 'T2', repo: 'api' }] } }, [
    { attempt: 1, at: T0 - 8 * HOUR, events: [start(), { type: 'dispatch', task: 'T1', agent: 'api-engineer', model: 'opus' }, { type: 'dispatch', task: 'T2', agent: 'api-engineer', model: 'sonnet' }, { type: 'settle', task: 'T2', status: 'DONE' }, { type: 'review', task: 'T1', stage: 'spec', verdict: 'FAIL', round: 1, gating: 1 }, { type: 'fix', task: 'T1', round: 1, model: 'opus' }] },
    { attempt: 2, at: T0 - 3 * MIN, events: [start({ resumed: true }), { type: 'absorb', task: 'T2', source: 'checkpoint' }] },
  ])
  const rb = run(RB).json.run
  ok(rb.active.length === 0 && JSON.stringify(rb.tasks) === JSON.stringify({ total: 3, done: 1, active: 0, failed: 0, blocked: 0, queued: 2 }),
    `a task an earlier session left in flight, not dispatched again by the current one, is queued, not active (${JSON.stringify(rb.tasks)})`)
  writeSessions(RB, 'R', { attempt: 2, startedAt: ago(9 * HOUR), updatedAt: ago(MIN), status: 'running', checkpoint: { attempt: 2, pending: ['T1', 'T3'], landed: ['T2'], landedTasks: [{ id: 'T2', repo: 'api' }] } }, [
    { attempt: 1, at: T0 - 8 * HOUR, events: [start(), { type: 'dispatch', task: 'T1', agent: 'api-engineer', model: 'opus' }] },
    { attempt: 2, at: T0 - MIN, events: [start({ resumed: true }), { type: 'dispatch', task: 'T1', agent: 'api-engineer', model: 'sonnet' }] },
  ])
  const rb2 = run(RB).json.run
  ok(rb2.active.length === 1 && rb2.active[0].task === 'T1' && rb2.active[0].model === 'sonnet' && rb2.tasks.active === 1, 'dispatched again by the current session: active')

  section('review: counts agree with the run\'s own outcome')
  const RC = join(TMP, 'counts')
  // D1–D3 were done in the tracker before the run (checkpoint.landed seeds them); T1 landed, T2 settled BLOCKED, T3 never ran
  writeSessions(RC, 'R', { attempt: 1, startedAt: ago(2 * HOUR), updatedAt: ago(10 * MIN), status: 'drained', summary: { done: 1, failed: 1, blocked: 1 },
    checkpoint: { landed: ['D1', 'D2', 'D3', 'T1'], landedTasks: [{ id: 'T1', repo: 'api' }], pending: ['T3'] } }, [
    { attempt: 1, at: T0 - 10 * MIN, events: [start(),
      { type: 'dispatch', task: 'T1', agent: 'a', model: 'sonnet' }, { type: 'settle', task: 'T1', status: 'DONE' },
      { type: 'dispatch', task: 'T2', agent: 'a', model: 'sonnet' }, { type: 'settle', task: 'T2', status: 'BLOCKED' },
      { type: 'run.end', status: 'drained', done: 1, failed: 1, stillRunning: 0, recovered: 0, blocked: 1, prs: 1, tokens: 5 }] },
  ])
  const rc = run(RC).json.run.tasks
  const oc = runOutcome(loadRuns(join(RC, '.grimoire', 'runs'))[0]).tasks
  ok(JSON.stringify(rc) === JSON.stringify({ total: 3, done: 1, active: 0, failed: 1, blocked: 1, queued: 0 }) && rc.done === oc.landed && rc.failed === oc.failed && rc.blocked === oc.blocked && rc.active === oc.inFlight,
    `an ended run: its run.end's counts, as render-logs reads them; tracker-done issues are not the run's (${JSON.stringify(rc)} vs ${JSON.stringify(oc)})`)
  const RD = join(TMP, 'counts-running')
  writeSessions(RD, 'R', { attempt: 1, startedAt: ago(HOUR), updatedAt: ago(MIN), status: 'running', checkpoint: { landed: ['D1', 'D2', 'T1'], landedTasks: [{ id: 'T1', repo: 'api' }], pending: ['T3'] } }, [
    { attempt: 1, at: T0 - MIN, events: [start(), { type: 'dispatch', task: 'T1', agent: 'a', model: 'sonnet' }, { type: 'settle', task: 'T1', status: 'DONE' },
      { type: 'dispatch', task: 'T2', agent: 'a', model: 'sonnet' }, { type: 'settle', task: 'T2', status: 'BLOCKED' }] },
  ])
  const rd = run(RD).json.run.tasks
  ok(JSON.stringify(rd) === JSON.stringify({ total: 3, done: 1, active: 0, failed: 1, blocked: 0, queued: 1 }), `a running run: tracker-done issues left out, a BLOCKED settle failed, what has not run queued (${JSON.stringify(rd)})`)
  const RE = join(TMP, 'counts-lost-end')
  // closed, its run.end lost: counted from the journal, what never ran blocked
  writeSessions(RE, 'R', { attempt: 1, startedAt: ago(2 * HOUR), updatedAt: ago(HOUR), status: 'running', checkpoint: { pending: ['T2', 'T3'] } }, [
    { attempt: 1, at: T0 - HOUR, events: [start(), { type: 'dispatch', task: 'T1', agent: 'a', model: 'sonnet' }, { type: 'settle', task: 'T1', status: 'DONE' }] },
  ])
  closeRun(join(RE, '.grimoire', 'runs'), 'R', { reason: 'abandoned', now: Date.now() + 13 * HOUR })
  const re = run(RE).json.run
  ok(re.status === 'closed' && JSON.stringify(re.tasks) === JSON.stringify({ total: 3, done: 1, active: 0, failed: 0, blocked: 2, queued: 0 }), `an ended run with no run.end: what never ran is blocked, not queued (${JSON.stringify(re.tasks)})`)

  section('review: hostile event types and times')
  for (const type of ['constructor', '__proto__', 'valueOf', 'hasOwnProperty', 'toString']) {
    const RP = join(TMP, `proto-${type.replace(/_/g, 'u')}`)
    writeSessions(RP, 'R', { attempt: 1, startedAt: ago(HOUR), updatedAt: ago(MIN), status: 'running', checkpoint: { pending: ['T1'] } }, [
      { attempt: 1, at: T0 - MIN, events: [start(), { type: 'dispatch', task: 'T1', agent: 'a', model: 'sonnet' }, { type, task: 'T1', reason: CANARY, note: 'secret sk-ant-xxxx' }] },
    ])
    const r = run(RP)
    const a = r.json && r.json.run && r.json.run.active[0]
    ok(r.status === 0 && shapeOk(r.json) && r.json.errors === 0 && a && a.step === 'build' && typeof r.json.run.recent[0].text === 'string' && !CANARY_RE.test(r.stdout) && !/sk-ant/.test(r.stdout),
      `an event of type ${type}: no prototype lookup, the run shown, nothing leaked (${r.json && r.json.run && r.json.run.recent[0].text})`)
  }
  const RI = join(TMP, 'iso')
  writeSessions(RI, 'R', { attempt: 1, startedAt: ago(HOUR), updatedAt: ago(MIN), status: 'running', checkpoint: { pending: ['T1'] } }, [
    { attempt: 1, at: T0 - MIN, events: [start(), { type: 'dispatch', task: 'T1', agent: 'a', model: 'sonnet' }, { type: 'review', task: 'T1', verdict: 'PASS', at: 1e16 }] },
  ])
  mkdirSync(join(RI, '.grimoire', 'economy', 'turns'), { recursive: true })
  writeFileSync(join(RI, '.grimoire', 'economy', 'turns', 'a.json'), JSON.stringify({ agentId: 'a', agentType: 'api-engineer', events: [{ action: 'block', reason: 'backstop:9>=8', at: T0 - MIN }, { action: 'block', reason: 'x', at: 1e16 }] }))
  const ri = run(RI).json
  ok(ri.errors === 0 && ri.run && ri.run.recent[0].kind === 'review' && ri.run.recent[0].at === null && ri.watch && ri.watch.flags.some((f) => f.at === null) && ri.watch.flags.some((f) => typeof f.at === 'string'),
    'a time a Date cannot hold is null in its own field: the run and the watch still shown, no error')

  // ── timing: 5 runs × 2000 events ──────────────────────────────────────────
  const P8 = join(TMP, 'big')
  const kinds = ['route', 'dispatch', 'precheck', 'review', 'verify', 'guard', 'fix', 'integrate', 'settle']
  for (let r = 0; r < 5; r++) {
    const events = [start()]
    for (let i = 1; i < 2000; i++) {
      const task = `B${r}-${Math.floor(i / 9)}`
      const type = kinds[i % 9]
      events.push({ type, task, repo: 'api', agent: 'api-engineer', model: 'sonnet', verdict: 'PASS', stage: 'spec', persona: 'spec-hawk', round: 1, status: 'DONE', gating: 0, decision: 'PASS', findings: 1, reason: CANARY })
    }
    if (r < 4) events.push({ type: 'run.end', status: 'drained', done: 222, failed: 0, blocked: 0, prs: 1, tokens: 10 })
    writeRun(P8, `BIG${r}`, { run: { startedAt: ago((5 - r) * HOUR), updatedAt: ago((5 - r) * HOUR - 30 * MIN), status: r < 4 ? 'drained' : 'running' }, at: Date.now() - (5 - r) * HOUR, step: 1000, events })
  }
  section('timing: 5 runs × 2000 events')
  const times = []
  let big = null
  for (let i = 0; i < 5; i++) {
    const t = process.hrtime.bigint()
    big = run(P8)
    times.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  samples.big = big.json && { ...big.json, run: big.json.run && { ...big.json.run, recent: big.json.run.recent.slice(0, 2) } }
  times.sort((a, b) => a - b)
  const median = times[2]
  console.log(`   · CLI wall time, node startup included: ${times.map((t) => `${Math.round(t)} ms`).join(', ')} (median ${Math.round(median)} ms)`)
  ok(big.json && big.json.run && big.json.run.id === 'BIG4' && big.json.run.tasks.total > 200, `the running one of five (${big.json && big.json.run && big.json.run.id}, ${big.json && big.json.run && big.json.run.tasks.total} tasks)`)
  ok(median < 300, `median under 300 ms (${Math.round(median)} ms)`)
  ok(!CANARY_RE.test(big.stdout), 'canary: 2000 events of reasons, none printed')

  // ── the SessionStart pointer ──────────────────────────────────────────────
  section('hooks/scripts/live-pointer.sh')
  const hook = (project, env = {}) => spawnSync('bash', [POINTER], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: project, ...env } })
  const PP = join(TMP, 'pointer')
  mkdirSync(PP, { recursive: true })
  const h0 = hook(PP)
  ok(h0.status === 0 && !existsSync(join(PP, '.grimoire')), 'a project grimoire never wrote to (no .grimoire/): nothing created')
  mkdirSync(join(PP, '.grimoire'))
  const h1 = hook(PP)
  const pointer = join(PP, '.grimoire', 'live', 'plugin-root')
  ok(h1.status === 0 && h1.stdout === '' && h1.stderr === '', 'silent, exit 0')
  ok(existsSync(pointer) && readFileSync(pointer, 'utf8') === `${PLUGIN}\n`, 'writes the plugin\'s absolute root, one line, creating .grimoire/live/')
  const m1 = statSync(pointer).mtimeMs
  utimesSync(pointer, new Date(m1 - 60000), new Date(m1 - 60000))
  hook(PP)
  ok(statSync(pointer).mtimeMs < m1, 'an unchanged path is not rewritten')
  const viaDir = spawnSync('bash', [POINTER], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: '', CLAUDE_PROJECT_DIR: join(TMP, 'pointer2') } })
  ok(viaDir.status === 0, 'a project dir that does not exist: exit 0')
  const inside = join(PLUGIN, 'scripts')
  const ptr = (d) => join(d, '.grimoire', 'live', 'plugin-root')
  const had = [inside, PLUGIN].map((d) => (existsSync(ptr(d)) ? statSync(ptr(d)).mtimeMs : null))
  hook(inside)
  hook(PLUGIN)
  ok([inside, PLUGIN].every((d, i) => (existsSync(ptr(d)) ? statSync(ptr(d)).mtimeMs : null) === had[i]), 'never inside the plugin folder itself')
  const HOMEP = join(TMP, 'home')
  mkdirSync(join(HOMEP, '.grimoire'), { recursive: true })
  hook(HOMEP, { HOME: HOMEP })
  ok(!existsSync(join(HOMEP, '.grimoire', 'live')), 'never in $HOME')
  const RO = join(TMP, 'readonly')
  mkdirSync(RO)
  writeFileSync(join(RO, '.grimoire'), 'a file')
  const h2 = hook(RO)
  ok(h2.status === 0 && h2.stdout === '' && h2.stderr === '', '.grimoire/ that cannot be created: silent, exit 0')
  // a linked git worktree (the files git writes, as project-config.mjs reads them): the main checkout's .grimoire/ counts
  const MAIN = join(TMP, 'wt-main'), WT = join(TMP, 'wt-lane')
  mkdirSync(join(MAIN, '.git', 'worktrees', 'lane'), { recursive: true })
  writeFileSync(join(MAIN, '.git', 'worktrees', 'lane', 'commondir'), '../..\n')
  mkdirSync(WT, { recursive: true })
  writeFileSync(join(WT, '.git'), `gitdir: ${join(MAIN, '.git', 'worktrees', 'lane')}\n`)
  hook(WT)
  ok(!existsSync(join(WT, '.grimoire')), 'a linked worktree whose main checkout has no .grimoire/: nothing written')
  mkdirSync(join(MAIN, '.grimoire'))
  const hw = hook(WT)
  ok(hw.status === 0 && hw.stdout === '' && readFileSync(join(WT, '.grimoire', 'live', 'plugin-root'), 'utf8') === `${PLUGIN}\n` && !existsSync(join(MAIN, '.grimoire', 'live')),
    'its main checkout has one: the pointer goes in the worktree\'s own .grimoire/live/, created there')
  writeFileSync(join(WT, '.git'), 'gitdir: wt-relative/none\n')
  rmSync(join(WT, '.grimoire'), { recursive: true, force: true })
  const hx = hook(WT)
  ok(hx.status === 0 && !existsSync(join(WT, '.grimoire')), 'a .git file naming no git dir: no main checkout, nothing written')
  const reg = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart.flatMap((h) => h.hooks)
  ok(reg.some((h) => h.command === 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/live-pointer.sh"' && h.timeout === 5), 'hooks.json registers it under SessionStart, timeout 5')

  if (PRINT) for (const [k, v] of Object.entries(samples)) console.log(`\n=== ${k}\n${JSON.stringify(v)}`)
} finally {
  // the detached cost refreshes: let them end before their project dirs go
  for (let i = 0; i < 100; i++) {
    let busy = false
    try { busy = readdirSync(TMP).some((d) => existsSync(join(TMP, d, '.grimoire', 'live', 'cost.lock'))) } catch {}
    if (!busy) break
    sleep(100)
  }
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
