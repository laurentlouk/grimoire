// ════════════════════════════════════════════════════════════════════════════
//  Tests — render-logs.mjs: render, summary, prune over a fixture telemetry dir
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/render-logs.test.mjs
//
//  What this locks down:
//    • render writes one self-contained HTML file naming every run and ledger,
//      and an agent-written string cannot break out of the embedded data blob
//    • events are read from events/<firstSeq>.jsonl chunks and/or a legacy single
//      events.jsonl, merged, deduped by seq (first seen wins) and sorted by seq
//    • a malformed line is counted and skipped, never fatal
//    • run.json checkpoint and summary.telemetry reach the page
//    • telemetry.dir, telemetry.retentionDays and runsDir in grimoire.config.json
//      are the defaults when the flags are absent
//    • summary numbers per version: first-round pass rate, fix rounds per model,
//      guard PASS later re-flagged by terminal, verify overturns per persona,
//      escalations, replans, halts, tokens per run
//    • prune --dry-run removes nothing; prune removes only the old run; prune
//      refuses / , $HOME and anything outside the working directory; a dir holding
//      only events/ chunks counts as a run dir
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('./render-logs.mjs', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const section = (t) => console.log(`\n── ${t}`)

const ROOT = mkdtempSync(join(tmpdir(), 'grimoire-logs-'))
const RUNS = join(ROOT, '.grimoire', 'runs')
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })

const DAY = 86400000
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString()
const XSS = '</script><img src=x onerror=alert(1)>'

// chunk: 0 → legacy single events.jsonl; n → events/<8-digit firstSeq>.jsonl of n lines each.
// The files are written in reverse order so the reader must sort by name, not trust the disk.
const pad = (n) => String(n).padStart(8, '0')
function writeRun(runId, run, events, { extraLines = [], chunk = 0, dupChunk = null } = {}) {
  const d = join(RUNS, runId)
  mkdirSync(d, { recursive: true })
  if (run) writeFileSync(join(d, 'run.json'), JSON.stringify({ runId, ...run }))
  const at0 = Date.parse(run ? run.startedAt : iso(400))
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: new Date(at0 + i * 1000).toISOString(), tok: (i + 1) * 100, ...e }))
  if (!chunk) return writeFileSync(join(d, 'events.jsonl'), [...lines, ...extraLines].join('\n') + '\n')
  mkdirSync(join(d, 'events'), { recursive: true })
  const chunks = []
  for (let i = 0; i < lines.length; i += chunk) chunks.push([i + 1, lines.slice(i, i + chunk)])
  for (const [first, ls] of chunks.reverse()) writeFileSync(join(d, 'events', `${pad(first)}.jsonl`), ls.join('\n') + '\n')
  if (dupChunk) writeFileSync(join(d, 'events', `${pad(dupChunk.first)}.jsonl`), dupChunk.lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

// Run A · v0.5.1: two api tasks; t1 fails spec first round (data), guard PASSes, then api terminal FAILs.
const metaA = { grimoireVersion: '0.5.1', briefsHash: 'aaaa111', personasHash: 'p1', configHash: 'c1' }
writeRun('run-alpha', { project: 'PROJ-1', meta: metaA, startedAt: iso(2), updatedAt: iso(2), status: 'drained' }, [
  { type: 'run.start', project: 'PROJ-1', mode: 'execute', meta: metaA, knobs: {}, repos: ['api'] },
  { type: 'route', task: 'T-1', repo: 'api', agent: 'api-engineer', model: 'sonnet', reason: 'default tier', fallback: false },
  { type: 'dispatch', task: 'T-1', repo: 'api', agent: 'api-engineer', model: 'sonnet', lane: 'direct', cycle: 1 },
  { type: 'precheck', task: 'T-1', verdict: 'PASS', problems: [] },
  { type: 'review', task: 'T-1', stage: 'spec', persona: 'qa', verdict: 'PASS', gating: 0, advisory: 1, round: 1 },
  { type: 'review', task: 'T-1', stage: 'spec', persona: 'data', verdict: 'FAIL', gating: 1, advisory: 0, round: 1 },
  { type: 'verify', task: 'T-1', stage: 'spec', round: 1, confirmed: 1, overturned: 0, reasons: [] },
  { type: 'fix', task: 'T-1', stage: 'spec', round: 1, model: 'sonnet', findings: 1 },
  { type: 'guard', task: 'T-1', stage: 'spec', round: 1, decision: 'PASS', reason: 'finding addressed' },
  { type: 'resolve', task: 'T-1', scout: 'codebase-scout', answered: true, question: XSS },
  { type: 'settle', task: 'T-1', repo: 'api', status: 'DONE' },
  { type: 'route', task: 'T-2', repo: 'api', agent: 'api-engineer', model: 'sonnet', reason: 'default tier', fallback: false },
  { type: 'dispatch', task: 'T-2', repo: 'api', agent: 'api-engineer', model: 'sonnet', lane: 'worktree', cycle: 1 },
  { type: 'review', task: 'T-2', stage: 'spec', persona: 'qa', verdict: 'PASS', gating: 0, advisory: 0, round: 1 },
  { type: 'settle', task: 'T-2', repo: 'api', status: 'DONE' },
  { type: 'terminal', repo: 'api', verdict: 'FAIL' },
  { type: 'run.end', status: 'drained', done: 2, failed: 0, blocked: 0, prs: 0, tokens: 5000 },
], { extraLines: ['{"seq": 99, "type": "broken', 'not json at all'] })

// Run B · v0.6.0, chunked (5 lines per chunk: 00000001, 00000006, 00000011, 00000016) plus a
// retried flush 00000007.jsonl that re-sends seq 6–7 with different content; it sorts after
// 00000006.jsonl, so the originals are seen first and win. One web task; qa FAIL is half overturned,
// sonnet→opus escalation, guard RE_REVIEW, replan.
const metaB = { grimoireVersion: '0.6.0', briefsHash: 'bbbb222', personasHash: 'p2', configHash: 'c2' }
const checkpointB = { replansUsed: 1, learnings: ['split migrations'], fixRounds: { 'T-3': 2 }, outputTokensSpent: 9000, lastSeq: 16, landed: ['T-3'], pending: ['T-4'] }
writeRun('run-beta', { project: 'PROJ-2', meta: metaB, startedAt: iso(1), updatedAt: iso(1), status: 'halted', checkpoint: checkpointB,
  summary: { done: 1, telemetry: { flushRetries: 1, chunksWritten: 4 } } }, [
  { type: 'run.start', project: 'PROJ-2', mode: 'execute', meta: metaB, knobs: {}, repos: ['web'] },
  { type: 'route', task: 'T-3', repo: 'web', agent: 'web-engineer', model: 'sonnet', reason: 'ui task', fallback: false },
  { type: 'dispatch', task: 'T-3', repo: 'web', agent: 'web-engineer', model: 'sonnet', lane: 'direct', cycle: 1 },
  { type: 'review', task: 'T-3', stage: 'spec', persona: 'qa', verdict: 'FAIL', gating: 2, advisory: 0, round: 1 },
  { type: 'verify', task: 'T-3', stage: 'spec', round: 1, confirmed: 1, overturned: 1, reasons: ['not in scope'] },
  { type: 'fix', task: 'T-3', stage: 'spec', round: 1, model: 'sonnet', findings: 1 },
  { type: 'escalate', task: 'T-3', from: 'sonnet', to: 'opus', reason: 'second fix round' },
  { type: 'fix', task: 'T-3', stage: 'spec', round: 2, model: 'opus', findings: 1 },
  { type: 'guard', task: 'T-3', stage: 'spec', round: 2, decision: 'RE_REVIEW', reason: 'diff widened' },
  { type: 'review', task: 'T-3', stage: 'spec', persona: 'qa', verdict: 'PASS', gating: 0, advisory: 0, round: 2 },
  { type: 'settle', task: 'T-3', repo: 'web', status: 'DONE' },
  { type: 'mystery.event', task: 'T-3', weird: { nested: 'raw-field-value' } },
  { type: 'terminal', repo: 'web', verdict: 'PASS' },
  { type: 'replan', n: 1, decision: 'REVISE', reason: 'unblocked dependents', requeued: 1, learnings: ['split migrations'] },
  { type: 'halt', reason: 'budget cap' },
  { type: 'run.end', status: 'halted', done: 1, failed: 0, blocked: 0, prs: 0, tokens: 9000 },
], { chunk: 5, dupChunk: { first: 7, lines: [
  { seq: 6, type: 'verify', task: 'T-3', stage: 'spec', round: 1, confirmed: 0, overturned: 99, reasons: ['DUPLICATE-SHOULD-LOSE'] },
  { seq: 7, type: 'fix', task: 'T-3', stage: 'spec', round: 1, model: 'haiku', findings: 1 },
] } })

// Run C · old: must be pruned (startedAt 400 days ago).
writeRun('run-ancient', { project: 'PROJ-0', meta: metaA, startedAt: iso(400), updatedAt: iso(400), status: 'drained' }, [
  { type: 'run.start', project: 'PROJ-0', mode: 'execute', meta: metaA, knobs: {}, repos: ['api'] },
], { chunk: 10 })

// Run D · no run.json, only an events/ chunk dir, dir mtime 400 days ago: still a run dir, still pruned.
writeRun('run-chunks-only', null, [{ type: 'run.start', project: 'PROJ-9', mode: 'execute', knobs: {}, repos: [] }], { chunk: 10 })
const old = new Date(Date.now() - 400 * DAY)
utimesSync(join(RUNS, 'run-chunks-only'), old, old)

// A non-run directory inside --dir: never touched by prune.
mkdirSync(join(RUNS, 'not-a-run'), { recursive: true })
writeFileSync(join(RUNS, 'not-a-run', 'keep.txt'), 'x')

// A committed ledger.
mkdirSync(join(ROOT, 'runs'), { recursive: true })
writeFileSync(join(ROOT, 'runs', '2026-09-01-ledger-proj.json'), JSON.stringify({ project: 'LEDGER-PROJ', done: ['a'], needsAttention: [], prs: ['https://example.invalid/pr/1'], learnings: ['keep it small'], replans: 0, halt: null }))

try {
  // ══════ 1 · render ══════
  section('1 · render writes one self-contained, injection-safe HTML file')
  const r = cli('--out', '.grimoire/logs.html')
  ok(r.status === 0, `render exits 0 (stderr: ${r.stderr.trim() || 'none'})`)
  const out = join(ROOT, '.grimoire', 'logs.html')
  ok(r.stdout.trim().endsWith('logs.html') && existsSync(out), 'prints the path of the file it wrote')
  const html = existsSync(out) ? readFileSync(out, 'utf8') : ''
  ok(['run-alpha', 'run-beta', 'run-ancient', 'run-chunks-only'].every((id) => html.includes(id)), 'HTML contains every run id')
  ok(html.includes('LEDGER-PROJ'), 'HTML contains the committed ledger')
  ok(!html.includes(XSS) && !html.includes('<img'), 'the malicious event string is not present raw')
  ok((html.match(/<script/gi) || []).length === 2 && (html.match(/<\/script/gi) || []).length === 2, 'exactly two <script> elements: the data blob and the renderer')
  ok(!/src=["']?https?:|href=["']?https?:|@import|url\(/i.test(html), 'no external scripts, stylesheets, fonts or network URLs')
  ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(html), 'the renderer never writes HTML from data')
  ok(html.includes('prefers-color-scheme:dark'), 'light and dark themes via prefers-color-scheme')
  const blob = html.match(/<script type="application\/json" id="grimoire-data">([\s\S]*?)<\/script>/)
  let data = null
  try { data = JSON.parse(blob[1]) } catch {}
  ok(data && data.runs.length === 4, 'the embedded data blob parses back to 4 runs')
  const alpha = data && data.runs.find((x) => x.runId === 'run-alpha')
  ok(alpha && alpha.badLines === 2 && alpha.events.length === 17, 'the malformed lines are counted (2) and skipped')
  ok(alpha && alpha.events.some((e) => e.question === XSS), 'the agent-written string survives intact as data')
  const beta = data && data.runs.find((x) => x.runId === 'run-beta')
  ok(beta && beta.events.some((e) => e.type === 'mystery.event' && e.weird.nested === 'raw-field-value'), 'unknown event types and fields are kept raw')
  ok(beta && beta.events.length === 16 && beta.events.every((e, i) => e.seq === i + 1), 'chunks are merged and sorted by seq (16 events, 1..16)')
  ok(beta && beta.duplicates === 2 && !JSON.stringify(beta.events).includes('DUPLICATE-SHOULD-LOSE'), 'a retried flush is deduped by seq, first seen wins')
  ok(beta && beta.checkpoint && beta.checkpoint.lastSeq === 16 && beta.checkpoint.pending[0] === 'T-4', 'run.json checkpoint is carried to the page')
  ok(beta && beta.summary.telemetry.chunksWritten === 4, 'run.json summary.telemetry is carried to the page')
  ok(html.includes("'Checkpoint'") && html.includes('Telemetry (run summary)'), 'the page renders checkpoint and summary.telemetry panels')
  const dRun = data && data.runs.find((x) => x.runId === 'run-chunks-only')
  ok(dRun && dRun.events.length === 1 && dRun.project === 'PROJ-9', 'a chunk-only run without run.json still loads')

  const pick = cli('--run', 'run-alpha', '--version', '0.5.1', '--out', '.grimoire/alpha.html')
  const ahtml = pick.status === 0 ? readFileSync(join(ROOT, '.grimoire', 'alpha.html'), 'utf8') : ''
  ok(ahtml.includes('"initialRun":"run-alpha"') && !ahtml.includes('run-beta'), '--run preselects a run, --version filters to one version')

  // ══════ 2 · summary ══════
  section('2 · summary aggregates per version / briefsHash')
  const sj = cli('summary', '--json')
  ok(sj.status === 0, 'summary --json exits 0')
  let S = null
  try { S = JSON.parse(sj.stdout) } catch {}
  ok(S && S.runs === 4 && S.skippedLines === 2, 'counts 4 runs and 2 skipped lines')
  const g5 = S && S.groups.find((g) => g.version === '0.5.1')
  const g6 = S && S.groups.find((g) => g.version === '0.6.0')
  ok(S && S.groups[0].version === '0.6.0', 'newest version first')
  ok(g5 && g5.runs === 2 && g5.tasks === 2 && g5.briefsHash === 'aaaa111', 'v0.5.1: 2 runs (incl. the old one), 2 tasks')
  ok(g5 && g5.firstRound.passed === 1 && g5.firstRound.total === 2 && g5.firstRoundPassRate === 0.5, 'v0.5.1: first-round pass 1/2')
  ok(g5 && g5.fixRoundsByModel.sonnet === 1 && Object.keys(g5.fixRoundsByModel).length === 1, 'v0.5.1: fix rounds sonnet 1')
  ok(g5 && g5.guardPass === 1 && g5.guardPassReflagged === 1, 'v0.5.1: guard PASS 1, later re-flagged by the failed terminal 1')
  ok(g5 && g5.overturnedByPersona.data && g5.overturnedByPersona.data.overturned === 0 && g5.overturnedByPersona.data.checked === 1, 'v0.5.1: verify attributed to the gating persona (data 0/1)')
  ok(g5 && g5.escalations === 0 && g5.replans === 0 && g5.halts === 0, 'v0.5.1: no escalations, replans or halts')
  ok(g5 && g5.tokensPerRun.max === 5000, 'v0.5.1: tokens per run max 5000 (from run.end)')
  ok(g6 && g6.runs === 1 && g6.tasks === 1 && g6.firstRound.passed === 0 && g6.firstRound.total === 1, 'v0.6.0: first-round pass 0/1')
  ok(g6 && g6.fixRoundsByModel.sonnet === 1 && g6.fixRoundsByModel.opus === 1, 'v0.6.0: fix rounds sonnet 1, opus 1')
  ok(g6 && g6.overturnedByPersona.qa && g6.overturnedByPersona.qa.overturned === 1 && g6.overturnedByPersona.qa.checked === 2, 'v0.6.0: qa overturned 1/2')
  ok(g6 && g6.escalations === 1 && g6.escalationsByPath['sonnet→opus'] === 1, 'v0.6.0: one sonnet→opus escalation')
  ok(g6 && g6.guardPass === 0 && g6.replans === 1 && g6.halts === 1, 'v0.6.0: no guard PASS, 1 replan, 1 halt')
  ok(g6 && g6.tokensPerRun.avg === 9000, 'v0.6.0: tokens per run 9000')
  const st = cli('summary')
  ok(st.status === 0 && /version 0\.6\.0 · briefs bbbb222/.test(st.stdout) && /first-round pass 50% \(1\/2\)/.test(st.stdout), 'text summary is readable and carries the same numbers')

  // ══════ 3 · prune ══════
  section('3 · prune removes only runs past retention, only inside --dir')
  const dry = cli('prune', '--dry-run')
  ok(dry.status === 0 && /would remove .*run-ancient/.test(dry.stdout) && /would remove .*run-chunks-only/.test(dry.stdout)
    && !/run-alpha|run-beta/.test(dry.stdout), '--dry-run lists only the old runs (incl. the chunk-only one, by mtime)')
  ok(existsSync(join(RUNS, 'run-ancient')) && existsSync(join(RUNS, 'run-chunks-only')), '--dry-run removes nothing')
  const real = cli('prune')
  ok(real.status === 0 && /removed .*run-ancient/.test(real.stdout), 'prune reports what it removed')
  ok(!existsSync(join(RUNS, 'run-ancient')) && !existsSync(join(RUNS, 'run-chunks-only')), 'the old runs are gone')
  ok(existsSync(join(RUNS, 'run-alpha')) && existsSync(join(RUNS, 'run-beta')), 'recent runs are kept')
  ok(existsSync(join(RUNS, 'not-a-run', 'keep.txt')), 'a non-run directory inside --dir is untouched')
  ok(existsSync(join(ROOT, 'runs', '2026-09-01-ledger-proj.json')), 'committed ledgers are untouched')
  const days = cli('prune', '--days', '0', '--dry-run')
  ok(/would remove 2 runs/.test(days.stdout), '--days overrides the default retention')
  writeFileSync(join(ROOT, 'grimoire.config.json'), JSON.stringify({ telemetry: { retentionDays: 0 } }))
  const cfgDry = cli('prune', '--dry-run')
  ok(/would remove 2 runs older than 0 days/.test(cfgDry.stdout), 'telemetry.retentionDays in grimoire.config.json sets the default')
  // telemetry.dir and runsDir from the config: a second telemetry dir and ledger dir, flags absent
  writeRun('../../alt-runs/run-gamma', { project: 'PROJ-ALT', meta: metaB, startedAt: iso(1), updatedAt: iso(1), status: 'drained' },
    [{ type: 'run.start', project: 'PROJ-ALT', mode: 'execute', meta: metaB, knobs: {}, repos: [] }], { chunk: 10 })
  mkdirSync(join(ROOT, 'ledgers2'), { recursive: true })
  writeFileSync(join(ROOT, 'ledgers2', '2026-09-02-two.json'), JSON.stringify({ project: 'LEDGER-TWO', done: [] }))
  writeFileSync(join(ROOT, 'grimoire.config.json'), JSON.stringify({ runsDir: 'ledgers2', telemetry: { dir: 'alt-runs', retentionDays: 0 } }))
  const alt = cli('summary', '--json')
  let A = null
  try { A = JSON.parse(alt.stdout) } catch {}
  ok(A && A.dir === 'alt-runs' && A.runs === 1, 'telemetry.dir in grimoire.config.json is the default --dir')
  const altHtml = cli('--out', '.grimoire/alt.html')
  const ah = altHtml.status === 0 ? readFileSync(join(ROOT, '.grimoire', 'alt.html'), 'utf8') : ''
  ok(ah.includes('run-gamma') && ah.includes('LEDGER-TWO') && !ah.includes('LEDGER-PROJ'), 'runsDir in grimoire.config.json is the default --ledgers')
  const altPrune = cli('prune', '--dry-run')
  ok(/would remove 1 run older than 0 days from alt-runs/.test(altPrune.stdout), 'prune defaults to telemetry.dir too')
  const over = cli('summary', '--json', '--dir', '.grimoire/runs')
  let O = null
  try { O = JSON.parse(over.stdout) } catch {}
  ok(O && O.dir === '.grimoire/runs' && O.runs === 2, '--dir overrides telemetry.dir')
  rmSync(join(ROOT, 'grimoire.config.json'))
  for (const [d, why] of [['/', '/'], [homedir(), '$HOME'], ['..', 'outside the cwd'], ['.', 'the cwd itself']]) {
    const x = cli('prune', '--dir', d, '--dry-run')
    ok(x.status !== 0 && /refusing/.test(x.stderr), `refuses --dir ${why}`)
  }
  ok(existsSync(join(RUNS, 'run-alpha')), 'refused prunes touched nothing')

  // ══════ 4 · empty and missing dirs ══════
  section('4 · missing telemetry dir is not an error')
  const none = cli('summary', '--dir', 'nowhere')
  ok(none.status === 0 && /no runs found/.test(none.stdout), 'summary over a missing dir says no runs found')
  const noneHtml = cli('--dir', 'nowhere', '--out', '.grimoire/empty.html')
  ok(noneHtml.status === 0 && existsSync(join(ROOT, '.grimoire', 'empty.html')), 'render over a missing dir still writes a page')
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
