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
//    • 0.9.0 run durability: the page summarizes late, hedge, wedged, late-result,
//      fence, ship (a ship skipped on a ready PR or a held lock never reads as a
//      failed push), env (a re-check, transient or failing again, and a halt a later
//      check lifted), seal, absorb (each source) and harness-routed events in words,
//      shows a halt's kind and draft
//      PRs, and the checkpoint card shows a v2 checkpoint's landedTasks with their
//      heads (the renderer is executed against a minimal DOM, not just grepped)
//    • a review round discarded under reviewParallel (`discarded: true`) is shown as
//      discarded and left out of the first-round pass rate and of a task's review count
//    • outcomes and the scorecard: a drained run whose final run.json write was lost reads
//      as drained (from the newest session's run.end), a silent "running" run is stale,
//      lost seqs and the writer's temp files make an incomplete journal, and the page and
//      `summary` sum the same rows
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

  // ══════ 5 · 0.9.0 run durability events and checkpoint v2 ══════
  section('5 · run-durability events read as sentences; the v2 checkpoint lists landed tasks and heads')
  const ROOT5 = join(ROOT, 'durability')
  const RUNS5 = join(ROOT5, '.grimoire', 'runs', 'run-delta')
  mkdirSync(join(RUNS5, 'events'), { recursive: true })
  const metaD = { grimoireVersion: '0.9.0', briefsHash: 'dddd444', personasHash: 'p4', configHash: 'c4' }
  const checkpointD = {
    version: 2, replansUsed: 0, lastSeq: 12, outputTokensSpent: 4000, learnings: [{ text: 'sign commits before launching', repos: ['site'] }], pending: ['#6'], landed: ['#4', '#5'],
    landedTasks: [
      { id: '#4', repo: 'site', status: 'DONE', runBranch: 'feat/proj-9-site', startSha: '0000000', firstSha: 'aaaaaaa1', headSha: 'aaaaaaa1111', commits: ['aaaaaaa1111'], summary: 'built A' },
      { id: '#5', repo: 'site', status: 'DONE', runBranch: 'feat/proj-9-site', startSha: 'aaaaaaa1111', firstSha: 'bbbbbbb2', headSha: 'bbbbbbb2222', commits: ['bbbbbbb2222'], summary: 'built B' },
    ],
    shipped: { site: { pushedHead: 'bbbbbbb2222', prUrl: 'https://example.invalid/pr/7', draft: true } },
  }
  writeFileSync(join(RUNS5, 'run.json'), JSON.stringify({ runId: 'run-delta', project: 'PROJ-9', meta: metaD, startedAt: iso(0), updatedAt: iso(0), status: 'halted', checkpoint: checkpointD,
    summary: { draftPrs: { site: 'https://example.invalid/pr/7' } } }))
  const evD = [
    { type: 'run.start', project: 'PROJ-9', mode: 'execute', meta: metaD, knobs: {}, repos: ['site'] },
    { type: 'absorb', task: '#4', source: 'checkpoint', head: 'aaaaaaa1111' },
    { type: 'env', when: 'start', why: 'startup', ok: true, failed: [] },
    { type: 'late', label: 'impl:#5', task: '#5', kind: 'writer', softMin: 40 },
    { type: 'hedge', label: 'precheck:#5' },
    { type: 'late-result', label: 'impl:#5', task: '#5', accepted: true, status: 'DONE' },
    { type: 'review', task: '#5', stage: 'spec', persona: 'spec-hawk', verdict: 'FAIL', gating: 1, advisory: 0, round: 0 },
    { type: 'review', task: '#5', stage: 'quality', persona: 'break-it', verdict: 'FAIL', gating: 1, advisory: 0, round: 0, discarded: true, reason: 'a spec fix moved the head' },
    { type: 'fix', task: '#5', stage: 'spec', round: 1, model: 'sonnet', findings: 1 },
    { type: 'review', task: '#5', stage: 'spec', persona: 'spec-hawk', verdict: 'PASS', gating: 0, advisory: 0, round: 1 },
    { type: 'review', task: '#5', stage: 'quality', persona: 'break-it', verdict: 'PASS', gating: 0, advisory: 0, round: 0 },
    { type: 'absorb', task: '#7', repo: 'site', source: 'verify-only', head: 'ccccccc3333' },
    { type: 'absorb', task: '#8', repo: 'site', source: 'reviewed-earlier', head: 'ddddddd4444' },
    { type: 'harness-routed', task: 'site:final', stage: 'terminal', persona: 'Privacy Engineer', severity: 'major', where: 'grimoire.config.json:3' },
    { type: 'settle', task: '#5', repo: 'site', status: 'DONE' },
    { type: 'ship', repo: 'site', mode: 'land', pushed: true, head: 'bbbbbbb2222', prUrl: 'https://example.invalid/pr/7', draft: true },
    { type: 'ship', repo: 'site', mode: 'halt', pushed: null, head: 'bbbbbbb2222', failedStep: 'comment', detail: 'gh: rate limited', prUrl: 'https://example.invalid/pr/7', draft: true },
    { type: 'env', when: 'stall', why: 'a failed push of site', ok: null, failed: [] },
    // the delivery fixes: a held ship lock, a PR out of draft (the gate's), the seal after a green gate
    { type: 'ship', repo: 'site', mode: 'land', pushed: false, head: 'bbbbbbb2222', failedStep: null, skipped: 'lock', detail: 'LOCK busy: held by ship 4242 for 150 s', prUrl: 'https://example.invalid/pr/7', draft: true },
    { type: 'seal', repo: 'app', ok: false, already: false, step: 'view', round: 1 },
    { type: 'seal', repo: 'app', ok: true, already: false, step: null, round: 2 },
    { type: 'seal', repo: 'web', ok: true, already: true, step: null, round: 1 },
    { type: 'ship', repo: 'app', mode: 'land', pushed: null, head: 'eeeeeee5555', failedStep: null, skipped: 'ready', prUrl: 'https://example.invalid/pr/8', draft: false },
    // a stall check that fails, re-checked: transient once; then latched, lifted by a later green check
    { type: 'env', when: 'stall', why: '#6 → BLOCKED', ok: false, failed: ['remote:site'] },
    { type: 'env', when: 'stall', why: '#6 → BLOCKED', ok: true, failed: [], recheck: true },
    { type: 'env', when: 'stall', why: 'late writer: impl:#5', ok: false, failed: ['commit:site'] },
    { type: 'env', when: 'stall', why: 'late writer: impl:#5', ok: false, failed: ['commit:site'], recheck: true },
    { type: 'env', when: 'stall', why: '#7 → DIED', ok: true, failed: [], cleared: ['commit:site'] },
    { type: 'wedged', label: 'impl:#6', task: '#6', repo: 'site', hardMin: 180 },
    { type: 'fence', repo: 'site', action: 'hold' },
    { type: 'env', when: 'stall', why: 'late writer', ok: false, failed: ['commit:site'] },
    { type: 'env', when: 'stall', why: 'late writer', ok: false, failed: ['commit:site'], recheck: true },
    { type: 'ship', repo: 'app', mode: 'halt', pushed: null, head: 'eeeeeee5555', failedStep: null, skipped: 'ready', prUrl: 'https://example.invalid/pr/8', draft: false },
    { type: 'halt', reason: 'environment: commit:site timed out after 30 s', kind: 'environment' },
  ].map((e, i) => JSON.stringify({ seq: i + 1, at: iso(0), tok: (i + 1) * 100, ...e }))
  writeFileSync(join(RUNS5, 'events', '00000001.jsonl'), evD.join('\n') + '\n')
  const r5 = spawnSync(process.execPath, [SCRIPT, '--out', 'logs.html'], { cwd: ROOT5, encoding: 'utf8' })
  ok(r5.status === 0, `render exits 0 (stderr: ${r5.stderr.trim() || 'none'})`)
  const html5 = r5.status === 0 ? readFileSync(join(ROOT5, 'logs.html'), 'utf8') : ''
  // Execute the page's renderer against a minimal DOM and read back the text it produced.
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.className = '' }
    setAttribute() {}
    addEventListener() {}
    append(...kids) { this.children.push(...kids) }
    replaceChildren(...kids) { this.children = kids }
    get textContent() { return this.children.map((c) => (c instanceof El ? c.textContent : String(c))).join(' ') }
  }
  const blob5 = (html5.match(/<script type="application\/json" id="grimoire-data">([\s\S]*?)<\/script>/) || [])[1] || '{}'
  const js5 = (html5.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || ''
  const doc = { body: new El('body'), createElement: (t) => new El(t), getElementById: (id) => (id === 'grimoire-data' ? { textContent: blob5 } : null) }
  let text = ''
  try { new Function('document', 'Node', js5)(doc, El); text = doc.body.textContent } catch (e) { ok(false, `the renderer ran (${e.message})`) }
  const has = (re, m) => ok(re.test(text), m)
  has(/impl:#5 past its 40-min soft limit \(writer\): still awaited, not stopped/, 'late: the label, the soft limit and that it is still awaited')
  has(/precheck:#5: a duplicate dispatch started/, 'hedge: a duplicate dispatch')
  has(/impl:#6 past its 180-min hard limit and still running: site fenced/, 'wedged: the hard limit and the fenced repo')
  has(/impl:#5 returned late \(DONE\) → accepted/, 'late-result: accepted, with its status')
  has(/site → held: no dispatch into it/, 'fence: held')
  has(/site · land → pushed bbbbbbb2222 · https:\/\/example\.invalid\/pr\/7 \(draft\)/, 'ship: the pushed head and the draft PR')
  has(/stall \(late writer\) → FAILED: commit:site/, 'env: the failed check')
  has(/site · halt → bbbbbbb2222 already on the remote · comment step failed: gh: rate limited · https:\/\/example\.invalid\/pr\/7 \(draft\)/, 'ship: nothing to push, a failed step after it')
  has(/stall \(a failed push of site\) → no usable report \(not counted as a failure\)/, 'env: a check that returned nothing usable')
  has(/start \(startup\) → ok/, 'env: a passing check')
  has(/stall re-check \(#6 → BLOCKED\) → ok: the failure was transient, the run goes on/, 'env: a re-check that passes reads as a transient failure')
  has(/stall re-check \(late writer\) → FAILED again on the re-check: commit:site/, 'env: a re-check that fails again')
  has(/stall \(#7 → DIED\) → ok: commit:site answered again, the environment halt is lifted/, 'env: a later green check lifts the halt (cleared)')
  has(/site · land → skipped: another ship or the gate held the ship lock — nothing pushed or rewritten, not a failed push: LOCK busy: held by ship 4242 for 150 s · https:\/\/example\.invalid\/pr\/7 \(draft\)/, 'ship skipped on a held lock: nothing moved, with the holder')
  ok(!/site · land → failed at push/.test(text), 'ship skipped on a held lock: never read as a failed push (its pushed is false)')
  has(/app · land → skipped: its PR is out of draft and only the gate pushes to it — nothing pushed, its description left alone · the new work waits for the next terminal slot · https:\/\/example\.invalid\/pr\/8 \(ready\)/, 'ship skipped on a ready PR: the new work waits for the gate')
  has(/app · halt → skipped: its PR is out of draft and only the gate pushes to it — nothing pushed, its description left alone · status comment only · https:\/\/example\.invalid\/pr\/8 \(ready\)/, 'halt ship on a ready PR: the status comment only')
  has(/app → the state marker could not be checked \(step view\), try 1/, 'seal: a failed try, with its step')
  has(/app → the state marker was put back as the last line of the PR body \(the gate's copy differed\)/, 'seal: the marker put back')
  has(/web → the state marker the gate kept is exact: nothing edited/, 'seal: an exact copy, nothing edited')
  has(/landed in an earlier attempt, verified on the run branch \(from the checkpoint\) @ aaaaaaa1111/, 'absorb from the checkpoint: verified on the run branch, with the head')
  has(/already on the branch, not reviewed for this task: sent to the panel as it stands @ ccccccc3333/, 'absorb verify-only: reviewed as it stands, never "landed earlier"')
  has(/already on the branch and reviewed for this task: landed with no new review @ ddddddd4444/, 'absorb reviewed-earlier: landed with no new review')
  has(/terminal · Privacy Engineer · major at grimoire\.config\.json:3: a harness file, routed to crystallize/, 'harness-routed: in words')
  has(/#5\s+DONE\s+3 reviews \(\+1 discarded\) · 1 fixes/, "a task's review count leaves the discarded round out and shows it apart")
  has(/\[environment\] environment: commit:site timed out/, 'halt: its kind')
  has(/Checkpoint\s+· v2/, 'the checkpoint card shows its version')
  has(/landed:\s+#4 @ aaaaaaa \(site · feat\/proj-9-site\), #5 @ bbbbbbb \(site · feat\/proj-9-site\)/, 'the checkpoint card lists landedTasks with their heads and run branch')
  has(/pushed:\s+site @ bbbbbbb · https:\/\/example\.invalid\/pr\/7 \(draft\)/, 'the checkpoint card shows what was pushed')
  has(/sign commits before launching/, 'a {text, repos} learning shows its text')
  has(/https:\/\/example\.invalid\/pr\/7 \(draft\)/, 'the overview tags the draft PR')
  ok(!/\{"label"/.test(text) && !/\{"task"/.test(text) && !/\{"repo"/.test(text), 'no new event type falls back to its raw JSON')
  has(/quality · break-it → FAIL \(gating 1, advisory 0, round 0\) · discarded: a spec fix moved the head, not counted/, 'a discarded review round reads as discarded, with its reason')
  const s5 = spawnSync(process.execPath, [SCRIPT, 'summary', '--json'], { cwd: ROOT5, encoding: 'utf8' })
  let S5 = null
  try { S5 = JSON.parse(s5.stdout) } catch {}
  const g9 = S5 && S5.groups.find((g) => g.version === '0.9.0')
  ok(g9 && g9.firstRound.total === 2 && g9.firstRound.passed === 1,
    `first-round pass skips the discarded quality round: spec failed round 0, quality passed its re-run → 1/2 (got ${g9 ? `${g9.firstRound.passed}/${g9.firstRound.total}` : 'none'})`)

  // ══════ 6 · guard PASSes the terminal sweep re-flagged ══════
  // The count crystallize reads to decide whether to tighten the guard brief. Read the old way
  // (any guard PASS in a repo whose terminal verdict was not PASS) this run gave 3 of 5: the
  // sweep's own guard counted as a guard PASS, a sweep that died or whose reviewers were
  // unavailable counted as a re-flag, a repair landed after the re-flag counted, and the one real
  // re-flag (api: blocking terminal review, fixed, verdict PASS) was missed because a `<repo>:final`
  // task maps to no repo. Right: 1 of 4.
  section('6 · guard PASSes the terminal sweep re-flagged: per-task guards, real re-flags, in order')
  const ROOT6 = join(ROOT, 'reflag')
  const RUN6 = join(ROOT6, '.grimoire', 'runs', 'run-epsilon')
  mkdirSync(RUN6, { recursive: true })
  const metaE = { grimoireVersion: '0.10.0', briefsHash: 'eeee555', personasHash: 'p5', configHash: 'c5' }
  writeFileSync(join(RUN6, 'run.json'), JSON.stringify({ runId: 'run-epsilon', project: 'PROJ-10', meta: metaE, startedAt: iso(0), updatedAt: iso(0), status: 'drained' }))
  const task = (id, repo) => [
    { type: 'route', task: id, repo, agent: `${repo}-engineer`, model: 'sonnet', reason: 'default tier', fallback: false },
    { type: 'dispatch', task: id, repo, agent: `${repo}-engineer`, model: 'sonnet', lane: 'direct', cycle: 1 },
    { type: 'review', task: id, stage: 'quality', persona: 'break-it', verdict: 'FAIL', gating: 1, advisory: 0, round: 0 },
    { type: 'fix', task: id, stage: 'quality', round: 1, model: 'sonnet', findings: 1 },
    { type: 'guard', task: id, stage: 'quality', round: 1, decision: 'PASS', reason: 'addressed, contained' },
    { type: 'settle', task: id, repo, status: 'DONE' },
  ]
  const ev6 = [
    { type: 'run.start', project: 'PROJ-10', mode: 'execute', meta: metaE, knobs: {}, repos: ['api', 'web', 'app', 'ops'] },
    // api: its guard passed T-9, then the sweep raised a blocker, fixed it under its own guard, and passed → re-flagged
    ...task('T-9', 'api'),
    { type: 'review', task: 'api:final', stage: 'terminal', persona: 'Reliability & Release SRE', verdict: 'FAIL', gating: 1, advisory: 0, round: 0 },
    { type: 'fix', task: 'api:final', stage: 'terminal', round: 1, model: 'sonnet', findings: 1 },
    { type: 'guard', task: 'api:final', stage: 'terminal', round: 1, decision: 'PASS', reason: 'addressed, contained' },
    { type: 'terminal', repo: 'api', verdict: 'PASS' },
    // web: the sweep died → not a re-flag; app: its reviewers were unavailable → not a re-flag
    ...task('T-10', 'web'),
    { type: 'terminal', repo: 'web', verdict: 'DIED' },
    ...task('T-11', 'app'),
    { type: 'terminal', repo: 'app', verdict: 'UNAVAILABLE' },
    // ops: the sweep failed first, then a repair task's guard passed and the retried sweep passed → the repair was not re-flagged
    { type: 'review', task: 'ops:final', stage: 'terminal', persona: 'Privacy Engineer', verdict: 'FAIL', gating: 1, advisory: 0, round: 0 },
    { type: 'terminal', repo: 'ops', verdict: 'FAIL' },
    ...task('T-12', 'ops'),
    { type: 'terminal', repo: 'ops', verdict: 'PASS' },
    { type: 'run.end', status: 'drained', done: 4, failed: 0, blocked: 0, prs: 4, tokens: 8000 },
  ]
  writeFileSync(join(RUN6, 'events.jsonl'), ev6.map((e, i) => JSON.stringify({ seq: i + 1, at: iso(0), tok: (i + 1) * 100, ...e })).join('\n') + '\n')
  const s6 = spawnSync(process.execPath, [SCRIPT, 'summary', '--json'], { cwd: ROOT6, encoding: 'utf8' })
  let S6 = null
  try { S6 = JSON.parse(s6.stdout) } catch {}
  const g10 = S6 && S6.groups.find((g) => g.version === '0.10.0')
  ok(g10 && g10.guardPass === 4, `guard PASS counts the 4 per-task guards, not the sweep's own (got ${g10 && g10.guardPass})`)
  ok(g10 && g10.guardPassReflagged === 1, `re-flagged: only api's T-9 — a blocking terminal review counts even when a fix cleared it; a died or unavailable sweep does not; a repair after the re-flag does not (got ${g10 && g10.guardPassReflagged})`)
  const t6 = spawnSync(process.execPath, [SCRIPT, 'summary'], { cwd: ROOT6, encoding: 'utf8' })
  ok(/guard PASS 4 · later re-flagged by terminal 1/.test(t6.stdout), 'the text summary carries the same numbers')

  // ══════ 7 · outcomes and the scorecard ══════
  section('7 · outcomes: a lost final run.json write, stale runs, lost events, and the scorecard over them')
  const ROOT7 = join(ROOT, 'outcomes')
  const RUNS7 = join(ROOT7, '.grimoire', 'runs')
  const meta7 = { grimoireVersion: '0.9.1', briefsHash: 'eeee555', personasHash: 'p5', configHash: 'c5' }
  // events as one chunk per attempt, from a given first seq; `at` steps by an hour within an attempt
  const writeEvents = (runId, attempt, firstSeq, startHoursAgo, events) => {
    const d = join(RUNS7, runId, 'events')
    mkdirSync(d, { recursive: true })
    const at0 = Date.now() - startHoursAgo * 3600000
    const lines = events.map((e, i) => JSON.stringify({ seq: firstSeq + i, at: new Date(at0 + i * 3600000).toISOString(), tok: (i + 1) * 1000, attempt, ...e }))
    writeFileSync(join(d, `${pad(firstSeq)}${attempt > 1 ? `.a${attempt}` : ''}.jsonl`), lines.join('\n') + '\n')
  }
  const runJson7 = (runId, extra) => { mkdirSync(join(RUNS7, runId), { recursive: true }); writeFileSync(join(RUNS7, runId, 'run.json'), JSON.stringify({ runId, project: 'P6', meta: meta7, ...extra })) }
  // E · session 1 halted on the environment; session 2 resumed and drained, but run.json's last write was lost
  // (it still says running), the first chunk of session 1 never landed (seq 1–4) and left its .b64 behind.
  runJson7('run-epsilon', { startedAt: new Date(Date.now() - 30 * 3600000).toISOString(), updatedAt: new Date(Date.now() - 20 * 3600000).toISOString(), status: 'running', summary: null })
  writeEvents('run-epsilon', 1, 5, 30, [
    { type: 'settle', task: 'E-1', repo: 'web', status: 'DONE' },
    { type: 'halt', reason: 'environment: commit:web exited 128', kind: 'environment' },
    { type: 'run.end', status: 'halted', done: 1, failed: 0, blocked: 2, prs: 0, tokens: 1000 },
  ])
  writeEvents('run-epsilon', 2, 8, 20, [
    { type: 'run.start', project: 'P6', mode: 'execute', meta: meta7, resumed: true, repos: ['web'] },
    { type: 'route', task: 'E-2', repo: 'web', agent: 'web-engineer', model: 'sonnet', reason: 'default', fallback: false },
    { type: 'dispatch', task: 'E-2', repo: 'web', agent: 'web-engineer', model: 'sonnet', lane: 'direct', cycle: 1 },
    { type: 'late', label: 'impl:E-2', task: 'E-2', kind: 'writer', softMin: 40 },
    { type: 'late', label: 'guard:E-2', task: 'E-2', kind: 'reader', softMin: 40 },
    { type: 'review', task: 'E-2', stage: 'spec', persona: 'Spec Hawk', verdict: 'PASS', gating: 0, advisory: 0, round: 0 },
    { type: 'settle', task: 'E-2', repo: 'web', status: 'DONE_WITH_CONCERNS' },
    { type: 'gate', repo: 'web', status: 'DONE_WITH_CONCERNS', applies: true, prUrl: 'https://example.invalid/pr/60' },
    { type: 'run.end', status: 'drained', done: 3, failed: 0, blocked: 0, prs: 1, tokens: 6000 },
  ])
  writeFileSync(join(RUNS7, 'run-epsilon', 'events', '00000001.jsonl.4242.b64'), 'eyJzZXEiOjF9')
  // Z · resumed after a halt and still running, written to 1 h ago: running, not stale, not repaired
  runJson7('run-zeta', { startedAt: new Date(Date.now() - 5 * 3600000).toISOString(), updatedAt: new Date(Date.now() - 3600000).toISOString(), status: 'running', summary: null })
  writeEvents('run-zeta', 1, 1, 5, [
    { type: 'run.start', project: 'P6', mode: 'execute', meta: meta7, repos: ['api'] },
    { type: 'halt', reason: 'environment: docker is not running', kind: 'environment' },
    { type: 'run.end', status: 'halted', done: 0, failed: 0, blocked: 1, prs: 0, tokens: 500 },
  ])
  writeEvents('run-zeta', 2, 4, 1, [
    { type: 'run.start', project: 'P6', mode: 'execute', meta: meta7, resumed: true, repos: ['api'] },
    { type: 'dispatch', task: 'Z-1', repo: 'api', agent: 'api-engineer', model: 'sonnet', lane: 'direct', cycle: 1 },
  ])
  // H · halted for good on a gate failure; T · "running" with no write for two days: stale
  runJson7('run-eta', { startedAt: new Date(Date.now() - 50 * 3600000).toISOString(), updatedAt: new Date(Date.now() - 48 * 3600000).toISOString(), status: 'halted',
    summary: { done: 1, failed: 1, blocked: 0, prs: 0, halt: { reason: 'gate failed twice', kind: null } } })
  writeEvents('run-eta', 1, 1, 50, [
    { type: 'run.start', project: 'P6', mode: 'execute', meta: meta7, repos: ['api'] },
    { type: 'review', task: 'H-1', stage: 'spec', persona: 'Spec Hawk', verdict: 'FAIL', gating: 1, advisory: 0, round: 0 },
    { type: 'settle', task: 'H-1', repo: 'api', status: 'DONE' },
    { type: 'settle', task: 'H-2', repo: 'api', status: 'SPEC_FAILED' },
    { type: 'gate', repo: 'api', status: 'GATE_FAILED', applies: true, prUrl: '' },
    { type: 'halt', reason: 'gate failed twice' },
  ])
  runJson7('run-theta', { startedAt: new Date(Date.now() - 60 * 3600000).toISOString(), updatedAt: new Date(Date.now() - 50 * 3600000).toISOString(), status: 'running', summary: null })
  writeEvents('run-theta', 1, 1, 60, [
    { type: 'run.start', project: 'P6', mode: 'execute', meta: meta7, repos: ['api'] },
    { type: 'dispatch', task: 'T-9', repo: 'api', agent: 'api-engineer', model: 'sonnet', lane: 'direct', cycle: 1 },
  ])
  const s7 = spawnSync(process.execPath, [SCRIPT, 'summary', '--json'], { cwd: ROOT7, encoding: 'utf8' })
  let S7 = null
  try { S7 = JSON.parse(s7.stdout) } catch {}
  const out7 = (id) => S7 && S7.outcomes.find((o) => o.runId === id)
  const eps = out7('run-epsilon'), zeta = out7('run-zeta'), eta = out7('run-eta'), theta = out7('run-theta')
  ok(eps && eps.status === 'drained' && /run\.json still says running.*run\.end #16 of session 2 says drained/.test(eps.journal.statusNote),
    'a drained run whose final run.json write was lost reads as drained, from the newest session\'s run.end, and says so')
  ok(eps && eps.tasks.landed === 3 && eps.tasks.blocked === 0 && eps.prs === 1 && eps.attempts === 2, "its tasks and PRs come from that run.end, not session 1's")
  ok(eps && eps.journal.missingEvents === 4 && eps.journal.leftovers === 1, 'a first chunk that never landed: 4 events missing, its .b64 counted as an unfinished write')
  ok(eps && eps.activeMin === 2 * 60 + 8 * 60, "active time sums each session's first-to-last write, not the gap between sessions (2 h + 8 h)")
  ok(eps && eps.late === 2 && eps.lateImpl === 1 && eps.dispatches === 1, 'late: 2 agents in all, 1 of them the implementer')
  ok(eps && eps.halts.length === 1 && eps.halts[0].kind === 'environment', 'the halt of session 1 is kept on a run that later drained')
  ok(zeta && zeta.status === 'running' && !zeta.stale && !zeta.journal.statusNote, "session 1's run.end does not end a run whose session 2 is still running")
  ok(theta && theta.status === 'running' && theta.stale && theta.tasks.inFlight === 1, `"running" with no write for ${50} h is stale, its dispatched task in flight`)
  ok(eta && eta.status === 'halted' && eta.tasks.landed === 1 && eta.tasks.failed === 1 && eta.halts[0].kind === null, 'a halted run without run.end: tasks from run.json\'s summary, a halt with no kind')
  const sc7 = S7 && S7.scorecard
  ok(sc7 && sc7.runs === 4 && sc7.drained === 1 && sc7.halted === 1 && sc7.running === 1 && sc7.stale === 1, 'scorecard: 4 runs · 1 drained · 1 halted · 1 running · 1 stale')
  ok(sc7 && sc7.runSuccess === 0.5 && sc7.cleanDrains === 1, 'scorecard: run success 1/2 finished runs, 1 clean drain')
  ok(sc7 && sc7.tasks.landed === 4 && sc7.tasks.failed === 1 && sc7.tasks.blocked === 0 && sc7.tasks.inFlight === 2 && sc7.landingRate === 0.8,
    "scorecard: landing rate 4 landed of 5 settled; the resumed run's task is in flight, not blocked as its session 1 left it")
  ok(sc7 && sc7.haltKinds.environment.count === 2 && sc7.haltKinds.environment.resumedToDrain === 1 && sc7.haltKinds.unclassified.count === 1,
    'scorecard: halts by kind, with the environment halt a resume carried to a drain')
  ok(sc7 && sc7.personas['Spec Hawk'].reviews === 2 && sc7.personas['Spec Hawk'].fails === 1, 'scorecard: Spec Hawk 1 FAIL of 2 reviews')
  ok(sc7 && sc7.repos.api.gatesFailed === 1 && sc7.repos.web.gatesPassed === 1, 'scorecard: gates passed and failed per repository')
  ok(sc7 && sc7.journal.runsIncomplete === 1 && sc7.journal.statusRepaired === 1, 'scorecard: one run with an incomplete journal, one status taken from run.end')
  const t7 = spawnSync(process.execPath, [SCRIPT, 'summary'], { cwd: ROOT7, encoding: 'utf8' })
  ok(t7.status === 0 && /outcomes: 4 runs · drained 1 · halted 1 · running 1 · stale 1/.test(t7.stdout) && /landing rate 80%/.test(t7.stdout)
    && t7.stdout.indexOf('outcomes:') < t7.stdout.indexOf('version 0.9.1'), 'text summary leads with the outcomes, then the per-version detail')
  const r7 = spawnSync(process.execPath, [SCRIPT, '--out', 'logs.html', '--run', 'run-epsilon'], { cwd: ROOT7, encoding: 'utf8' })
  const html7 = r7.status === 0 ? readFileSync(join(ROOT7, 'logs.html'), 'utf8') : ''
  const blob7 = (html7.match(/<script type="application\/json" id="grimoire-data">([\s\S]*?)<\/script>/) || [])[1] || '{}'
  const js7 = (html7.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || ''
  const doc7 = { body: new El('body'), createElement: (t) => new El(t), getElementById: (id) => (id === 'grimoire-data' ? { textContent: blob7 } : null) }
  let text7 = ''
  try { new Function('document', 'Node', js7)(doc7, El); text7 = doc7.body.textContent } catch (e) { ok(false, `the renderer ran (${e.message})`) }
  ok(/Scorecard \(4 runs\)/.test(text7) && /50%\s+run success/.test(text7) && /80%\s+task landing/.test(text7), 'the page leads with the scorecard: runs, run success, task landing')
  ok(/Why runs stopped/.test(text7) && /environment\s+2\s+2\s+1/.test(text7), 'the page lists why runs stopped, by kind (halts, runs, resumed to a drain)')
  ok(/running · stale/.test(text7) && /⚠ 4 event\(s\) missing, 1 unfinished write\(s\), status from run\.end/.test(text7), 'the runs table marks the stale run and the incomplete journal')
  ok(/status: run\.json still says running/.test(text7) && /halted in session 1, then resumed: \[environment\]/.test(text7),
    "the overview says where its status came from, and shows session 1's halt as resumed, not as the run's verdict")
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
