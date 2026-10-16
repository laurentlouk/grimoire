// ════════════════════════════════════════════════════════════════════════════
//  Tests — manager.mjs brief: WorkItems → a ranked briefing, a ledger, a lock
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/manager.test.mjs
//
//  What this locks down (v0, ODY-871):
//    • validation: anything but a JSON array of WorkItems is refused with exit 1, naming the
//      item's index and field, never echoing the value; nothing is written then
//    • urgency from the fields, each rule at its threshold and just past it, with one --now:
//      1 ≤ priority ≤ urgent.priorityAtMost, an SLA breaching within 24 h or past, a due date
//      overdue or within urgent.dueWithinDays (calendar days, the machine's time zone)
//    • groups: triage or urgent-and-unassigned → Decide, urgent → Do, ready → Hand to AI,
//      the scout's "waiting" reading → Waiting on others, the rest → Not now; completed and
//      canceled items are counted, not listed
//    • bucketHint moves an item only between the non-urgent groups: it never makes one urgent,
//      never moves one out of Decide or Do, and never makes an ineligible issue ready for AI
//    • the order within a group: urgent, priority (none last), due date (none last), oldest
//      created, id
//    • output: briefings/<YYYYMMDD-HHMMSS>.md and latest.md, groups in order, why and next
//      lines, ticket text escaped, front matter counts equal view()'s
//    • the ledger keeps firstSeenAt across runs and hashes what matters
//    • a fresh .lock refuses with exit 3, one older than 30 min is broken
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('./manager.mjs', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const section = (t) => console.log(`\n── ${t}`)

const TMP = mkdtempSync(join(tmpdir(), 'grimoire-manager-'))
const NOW = '2026-10-16T12:00:00.000Z'
const HOUR = 3600000
const at = (ms) => new Date(Date.parse(NOW) + ms).toISOString()
// Calendar days are read in the machine's time zone: pin it so the fixtures mean one thing.
const ENV = { ...process.env, TZ: 'UTC' }

let n = 0
// A fresh project dir per run unless one is given; items and config go next to it.
function brief(items, { config = {}, now = NOW, root = null, extra = [], raw = null } = {}) {
  const dir = root || join(TMP, `p${++n}`)
  mkdirSync(dir, { recursive: true })
  const itemsFile = join(dir, 'items.json')
  writeFileSync(itemsFile, raw ?? JSON.stringify(items))
  const cfgFile = join(dir, 'grimoire.config.json')
  writeFileSync(cfgFile, JSON.stringify(config))
  const args = ['brief', '--items', itemsFile, '--config', cfgFile, '--root', dir, ...(now ? ['--now', now] : []), ...extra]
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: ENV })
  return { ...r, root: dir, mdir: join(dir, '.grimoire', 'manager') }
}
const cli = (args, cwd = TMP) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: ENV })

const base = { sourceId: 'linear', kind: 'issue', stateType: 'unstarted', createdAt: '2026-10-01T00:00:00Z' }
const item = (id, over = {}) => ({ ...base, id, title: `title of ${id}`, assignee: 'Ada', ...over })

// latest.md → { front, groups: { <title>: [{ key, line, why, next }] }, order: [titles] }
function parse(md) {
  const out = { front: {}, groups: {}, order: [] }
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)
  if (fm) for (const l of fm[1].split('\n')) { const m = /^(\w+): (.*)$/.exec(l); if (m) { try { out.front[m[1]] = JSON.parse(m[2]) } catch { out.front[m[1]] = m[2] } } }
  let g = null, last = null
  for (const l of md.split('\n')) {
    const h = /^## (.+?) \((\d+)\)$/.exec(l)
    if (h) { g = h[1]; out.order.push(g); out.groups[g] = []; continue }
    const it = /^- \*\*(.+?)\*\*/.exec(l)
    if (it && g) { last = { key: it[1].replace(/\\(.)/g, '$1'), line: l, why: '', next: '' }; out.groups[g].push(last); continue }
    const w = /^ {2}- why: (.*)$/.exec(l)
    if (w && last) last.why = w[1]
    const x = /^ {2}- next: (.*)$/.exec(l)
    if (x && last) last.next = x[1]
  }
  return out
}
const latest = (r) => { try { return readFileSync(join(r.mdir, 'latest.md'), 'utf8') } catch { return '' } }
const readJ = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return { items: {}, sources: {} } } }
const groupOf = (P, key) => Object.keys(P.groups).find((g) => P.groups[g].some((e) => e.key === key)) ?? null
const entry = (P, key) => Object.values(P.groups).flat().find((e) => e.key === key) ?? null
const E = (P, key) => entry(P, key) || { key, line: '', why: '', next: '' }
const urgent = (P, key) => !!entry(P, key) && /\*\*urgent\*\*/.test(entry(P, key).line)

try {
  // ──────────────────────────────────────────────────────────────────────────
  section('validation: the WorkItems are refused whole, naming the item and field')
  {
    const r = brief([item('T-1')])
    ok(r.status === 0, `a valid minimal item passes (exit ${r.status}${r.stderr ? `: ${r.stderr.trim()}` : ''})`)
    const min = brief([{ sourceId: 'linear', id: 'M-1', title: 'only the required fields', kind: 'issue', stateType: 'backlog' }])
    ok(min.status === 0, 'an item with only sourceId, id, title, kind and stateType passes')

    const notArray = brief(null, { raw: '{"items": []}' })
    ok(notArray.status === 1 && /JSON array/.test(notArray.stderr), 'a file that is not a JSON array is refused with exit 1')
    const badJson = brief(null, { raw: '[{"title": "sk_live_SHOULD_NOT_LEAK"' })
    ok(badJson.status === 1 && /invalid JSON/.test(badJson.stderr) && !/SHOULD_NOT_LEAK/.test(badJson.stderr), 'invalid JSON is refused without quoting the source')

    const missing = brief([item('T-1'), { sourceId: 'linear', id: 'T-2', title: 'no kind', stateType: 'started' }])
    ok(missing.status === 1 && /items\[1\]\.kind/.test(missing.stderr), `a missing required field names items[1].kind (${missing.stderr.trim()})`)
    const prio = brief([item('T-1', { priority: 7 })])
    ok(prio.status === 1 && /items\[0\]\.priority/.test(prio.stderr), 'a priority outside 0–4 names items[0].priority')
    const frac = brief([item('T-1', { priority: 1.5 })])
    ok(frac.status === 1 && /items\[0\]\.priority/.test(frac.stderr), 'a fractional priority is refused')
    const unknown = brief([item('T-1', { dueDate: '2026-10-17' })])
    ok(unknown.status === 1 && /items\[0\]\.dueDate/.test(unknown.stderr) && /unknown field/.test(unknown.stderr), 'an unknown field (dueDate) is refused by name')
    const date = brief([item('T-1', { dueAt: 'next tuesday' })])
    ok(date.status === 1 && /items\[0\]\.dueAt/.test(date.stderr), 'a due date that is not ISO is refused')
    const kind = brief([item('T-1', { kind: 'epic' })])
    ok(kind.status === 1 && /items\[0\]\.kind/.test(kind.stderr), 'a kind outside issue|pr|run is refused')
    const state = brief([item('T-1', { stateType: 'in progress' })])
    ok(state.status === 1 && /items\[0\]\.stateType/.test(state.stderr), 'a stateType outside the six is refused')
    const refs = brief([item('T-1', { blockedBy: [3] })])
    ok(refs.status === 1 && /items\[0\]\.blockedBy\[0\]/.test(refs.stderr), 'a blockedBy entry that is not a string names its index')
    const proj = brief([item('T-1', { project: { name: 'P', sliced: 'yes' } })])
    ok(proj.status === 1 && /items\[0\]\.project\.sliced/.test(proj.stderr), 'project.sliced must be a boolean')
    const src = brief([item('T-1', { sourceId: 'bad id/../x' })])
    ok(src.status === 1 && /items\[0\]\.sourceId/.test(src.stderr), 'a sourceId outside [A-Za-z0-9._-] is refused')
    const dup = brief([item('T-1'), item('T-1')])
    ok(dup.status === 1 && /items\[1\]/.test(dup.stderr) && /duplicate/.test(dup.stderr), 'a duplicate id within a source is refused')
    const leak = brief([item('T-1', { assignee: { token: 'sk_live_SHOULD_NOT_LEAK' } })])
    ok(leak.status === 1 && /items\[0\]\.assignee/.test(leak.stderr) && !/SHOULD_NOT_LEAK/.test(leak.stderr), 'the refusal never echoes the value')
    ok(!existsSync(join(leak.mdir, 'latest.md')) && !existsSync(join(leak.mdir, 'ledger.json')), 'nothing is written when the items are refused')
    const many = brief(Array.from({ length: 3 }, (_, i) => item(`E-${i}`, { priority: 9 })))
    ok(many.status === 1 && /items\[0\]/.test(many.stderr) && /items\[2\]/.test(many.stderr), 'every invalid item is listed, not only the first')

    const usage = cli(['brief'])
    ok(usage.status === 2 && /--items/.test(usage.stderr), 'brief without --items is a usage error (exit 2)')
    const badNow = brief([item('T-1')], { now: 'yesterday' })
    ok(badNow.status === 2 && /--now/.test(badNow.stderr), 'an unreadable --now is a usage error (exit 2)')
    const cmd = cli(['frobnicate'])
    ok(cmd.status === 2 && /unknown command/.test(cmd.stderr), 'an unknown command exits 2')
    const badCfgDir = join(TMP, 'badcfg')
    mkdirSync(badCfgDir, { recursive: true })
    writeFileSync(join(badCfgDir, 'items.json'), JSON.stringify([item('T-1')]))
    writeFileSync(join(badCfgDir, 'grimoire.config.json'), '{"manager": {"token": "sk_live_SHOULD_NOT_LEAK"')
    const badCfg = cli(['brief', '--items', join(badCfgDir, 'items.json'), '--config', join(badCfgDir, 'grimoire.config.json'), '--root', badCfgDir, '--now', NOW], badCfgDir)
    ok(badCfg.status === 1 && /grimoire\.config\.json/.test(badCfg.stderr) && !/SHOULD_NOT_LEAK/.test(badCfg.stderr), 'an invalid config is refused, naming the file and not its content')
    const noCfgDir = join(TMP, 'nocfg')
    mkdirSync(noCfgDir, { recursive: true })
    writeFileSync(join(noCfgDir, 'items.json'), JSON.stringify([item('T-1', { priority: 2 })]))
    const noCfg = cli(['brief', '--items', join(noCfgDir, 'items.json'), '--root', noCfgDir, '--now', NOW], noCfgDir)
    ok(noCfg.status === 0 && urgent(parse(readFileSync(join(noCfgDir, '.grimoire/manager/latest.md'), 'utf8')), 'T-1'), 'no config file: the default thresholds apply (priority High is urgent)')
  }

  // ──────────────────────────────────────────────────────────────────────────
  section('urgency (v0 rules), each at its threshold and just past it')
  {
    const r = brief([
      item('P-1', { priority: 1 }), item('P-2', { priority: 2 }), item('P-3', { priority: 3 }), item('P-0', { priority: 0 }), item('P-none'),
      item('D-past', { dueAt: '2026-10-15' }), item('D-today', { dueAt: '2026-10-16' }), item('D-2', { dueAt: '2026-10-18' }), item('D-3', { dueAt: '2026-10-19' }),
      item('D-2t', { dueAt: '2026-10-18T23:30:00Z' }), item('D-3t', { dueAt: '2026-10-19T00:30:00Z' }),
      item('S-past', { slaAt: at(-HOUR) }), item('S-24', { slaAt: at(24 * HOUR) }), item('S-25', { slaAt: at(24 * HOUR + 60000) }),
      item('C-1', { priority: 1, stateType: 'completed' }), item('X-1', { priority: 1, dueAt: '2026-10-01', stateType: 'canceled' }),
    ])
    ok(r.status === 0, `brief exits 0 (${r.stderr.trim()})`)
    const P = parse(latest(r))
    ok(urgent(P, 'P-1') && /priority Urgent/.test(E(P, 'P-1').why), 'priority 1 is urgent: "priority Urgent"')
    ok(urgent(P, 'P-2') && /priority High/.test(E(P, 'P-2').why), 'priority 2 = priorityAtMost (default 2) is urgent: "priority High"')
    ok(!urgent(P, 'P-3'), 'priority 3, just past priorityAtMost, is not urgent')
    ok(!urgent(P, 'P-0') && !urgent(P, 'P-none'), 'priority 0 (none) and an absent priority are not urgent')
    ok(urgent(P, 'D-past') && /overdue by 1 day/.test(E(P, 'D-past').why), 'due yesterday is urgent: "overdue by 1 day"')
    ok(urgent(P, 'D-today') && /due today/.test(E(P, 'D-today').why), 'due today is urgent: "due today"')
    ok(urgent(P, 'D-2') && /due in 2 days/.test(E(P, 'D-2').why), 'due in 2 days = dueWithinDays (default 2) is urgent')
    ok(!urgent(P, 'D-3'), 'due in 3 days, just past dueWithinDays, is not urgent')
    ok(urgent(P, 'D-2t') && !urgent(P, 'D-3t'), 'a due date-time is read by its calendar day: 23:30 on day 2 is urgent, 00:30 on day 3 is not')
    ok(urgent(P, 'S-past') && /SLA breached/.test(E(P, 'S-past').why), 'an SLA already past is urgent: "SLA breached"')
    ok(urgent(P, 'S-24') && /SLA breaches in 24 h/.test(E(P, 'S-24').why), 'an SLA breaching in exactly 24 h is urgent')
    ok(!urgent(P, 'S-25'), 'an SLA breaching in 24 h and 1 min is not urgent')
    ok(!entry(P, 'C-1') && !entry(P, 'X-1'), 'completed and canceled items are not listed, whatever their priority or due date')
    ok(P.front.counts && P.front.counts.closed === 2, 'they are counted as closed in the front matter')
    ok(P.front.counts && P.front.counts.urgent === 8, `the front matter counts 8 urgent items (${P.front.counts && P.front.counts.urgent})`)

    const tight = brief([item('P-2', { priority: 2 }), item('P-1', { priority: 1 }), item('D-1', { dueAt: '2026-10-17' }), item('D-0', { dueAt: '2026-10-16' })],
      { config: { manager: { urgent: { priorityAtMost: 1, dueWithinDays: 0 } } } })
    const T = parse(latest(tight))
    ok(urgent(T, 'P-1') && !urgent(T, 'P-2'), 'manager.urgent.priorityAtMost 1: priority 2 is no longer urgent')
    ok(urgent(T, 'D-0') && !urgent(T, 'D-1'), 'manager.urgent.dueWithinDays 0: only today and overdue are urgent')
    const both = parse(latest(brief([item('B-1', { priority: 1, dueAt: '2026-10-15' })])))
    ok(/priority Urgent/.test(E(both, 'B-1').why) && /overdue by 1 day/.test(E(both, 'B-1').why), 'an item urgent for two reasons shows both')
  }

  // ──────────────────────────────────────────────────────────────────────────
  section('groups from the fields, and what bucketHint may and may not do')
  {
    const ready = { assignee: null, hasAcceptanceCriteria: true, stateType: 'backlog' }
    const r = brief([
      item('TRI', { stateType: 'triage', priority: 3 }),
      item('UU', { assignee: null, priority: 1 }),
      item('US', { stateType: 'started', priority: 1 }),
      item('UN', { stateType: 'unstarted', dueAt: '2026-10-16' }),
      item('UB', { stateType: 'backlog', priority: 2 }),
      item('AI', ready),
      item('AI-closed-blocker', { ...ready, blockedBy: ['DONE-1'] }), item('DONE-1', { stateType: 'completed' }),
      item('NA-assigned', { ...ready, assignee: 'Bob' }),
      item('NA-blocked', { ...ready, blockedBy: ['TRI'] }),
      item('NA-pr', { ...ready, linkedPr: 'https://github.com/acme/api/pull/1' }),
      item('NA-parent', { ...ready, parentOf: ['C-1', 'C-2'] }),
      item('NA-noac', { ...ready, hasAcceptanceCriteria: false }),
      item('NA-pr-kind', { ...ready, kind: 'pr' }),
      item('W', { bucketHint: 'waiting', nextStep: 'Wait for the vendor' }),
      item('H-do', { bucketHint: 'do' }), item('H-decide', { bucketHint: 'decide' }), item('H-ai', { bucketHint: 'ai', hasAcceptanceCriteria: true }),
      item('H-urgent-notnow', { stateType: 'started', priority: 1, bucketHint: 'notnow' }),
      item('H-urgent-waiting', { assignee: null, priority: 1, bucketHint: 'waiting' }),
      item('H-triage-notnow', { stateType: 'triage', bucketHint: 'notnow' }),
      item('H-ready-waiting', { ...ready, bucketHint: 'waiting' }),
      item('H-ready-notnow', { ...ready, bucketHint: 'notnow' }),
      item('REST'),
    ])
    ok(r.status === 0, `brief exits 0 (${r.stderr.trim()})`)
    const P = parse(latest(r))
    ok(groupOf(P, 'TRI') === 'Decide' && /in triage/.test(E(P, 'TRI').why), 'a triage issue goes to Decide: "in triage"')
    ok(groupOf(P, 'UU') === 'Decide' && /unassigned/.test(E(P, 'UU').why), 'an urgent unassigned issue goes to Decide')
    ok(groupOf(P, 'US') === 'Do' && groupOf(P, 'UN') === 'Do', 'an urgent assigned issue, started or not started, goes to Do')
    ok(groupOf(P, 'UB') === 'Do', 'an urgent assigned backlog issue goes to Do too: an urgent item is always in Decide or Do')
    ok(groupOf(P, 'AI') === 'Hand to AI' && /acceptance criteria/.test(E(P, 'AI').why), 'an issue with acceptance criteria, unassigned, unblocked, no PR, no sub-issues goes to Hand to AI')
    ok(groupOf(P, 'AI-closed-blocker') === 'Hand to AI', 'a blocker that is itself completed does not block')
    ok(groupOf(P, 'NA-assigned') === 'Not now' && /assigned to Bob/.test(E(P, 'NA-assigned').why), 'assigned: not ready for AI, and the reason says to whom')
    ok(groupOf(P, 'NA-blocked') === 'Not now' && /blocked by TRI/.test(E(P, 'NA-blocked').why), 'blocked by an open item: not ready for AI')
    ok(groupOf(P, 'NA-pr') === 'Not now' && /linked PR/.test(E(P, 'NA-pr').why), 'a linked PR: not ready for AI')
    ok(groupOf(P, 'NA-parent') === 'Not now' && /parent of 2/.test(E(P, 'NA-parent').why), 'a parent issue: not ready for AI')
    ok(groupOf(P, 'NA-noac') === 'Not now' && /no acceptance criteria/.test(E(P, 'NA-noac').why), 'no acceptance criteria: not ready for AI')
    ok(groupOf(P, 'NA-pr-kind') === 'Not now', 'only an issue is handed to AI, never a PR')
    ok(groupOf(P, 'W') === 'Waiting on others' && /Wait for the vendor/.test(E(P, 'W').next), 'the scout\'s "waiting" reading moves a non-urgent item to Waiting on others, with its next step')
    ok(groupOf(P, 'H-do') === 'Not now' && !urgent(P, 'H-do'), 'bucketHint "do" never makes an item urgent or puts it in Do')
    ok(groupOf(P, 'H-decide') === 'Not now', 'bucketHint "decide" never moves a non-urgent item into Decide')
    ok(groupOf(P, 'H-ai') === 'Not now', 'bucketHint "ai" never makes an ineligible issue ready for AI')
    ok(groupOf(P, 'H-urgent-notnow') === 'Do' && urgent(P, 'H-urgent-notnow'), 'bucketHint "notnow" never moves an urgent item out of Do')
    ok(groupOf(P, 'H-urgent-waiting') === 'Decide' && urgent(P, 'H-urgent-waiting'), 'bucketHint "waiting" never moves an urgent item out of Decide')
    ok(groupOf(P, 'H-triage-notnow') === 'Decide', 'bucketHint never moves a triage issue out of Decide')
    ok(groupOf(P, 'H-ready-waiting') === 'Waiting on others', 'bucketHint moves a ready issue between non-urgent groups (to Waiting on others)')
    ok(groupOf(P, 'H-ready-notnow') === 'Not now', 'and to Not now')
    ok(groupOf(P, 'REST') === 'Not now', 'the rest goes to Not now')
    ok(/repo/.test(E(P, 'AI').line) === false || /not checked/.test(E(P, 'AI').line), 'a ready issue without a repo claims no repo check')
    const withRepo = parse(latest(brief([item('AI-R', { ...ready, repo: 'api' })])))
    ok(groupOf(withRepo, 'AI-R') === 'Hand to AI' && /repo api/.test(E(withRepo, 'AI-R').line) && /not checked/.test(E(withRepo, 'AI-R').line),
      'the repo availability check is a seam: the repo is shown as not checked yet, and does not block')
  }

  // ──────────────────────────────────────────────────────────────────────────
  section('sort order within a group: urgent, priority (none last), due, oldest created, id')
  {
    const r = brief([
      item('N-e', { priority: 0 }),
      item('N-d', { priority: 4 }),
      item('N-c', { priority: 3 }),
      item('N-g', { priority: 3, dueAt: '2026-11-01', createdAt: '2026-10-02T00:00:00Z' }),
      item('N-a', { priority: 3, dueAt: '2026-11-01', createdAt: '2026-10-02T00:00:00Z' }),
      item('N-f', { priority: 3, dueAt: '2026-11-01', createdAt: '2026-09-20T00:00:00Z' }),
      item('N-b', { priority: 3, dueAt: '2026-10-25' }),
      item('N-h', { priority: 3, dueAt: '2026-11-01' }),
      item('Q-low', { stateType: 'triage', priority: 4, createdAt: '2020-01-01T00:00:00Z' }),
      item('Q-urgent', { stateType: 'triage', priority: 4, dueAt: '2026-10-16' }),
      item('Q-high', { stateType: 'triage', priority: 2 }),
    ])
    const P = parse(latest(r))
    const keys = (g) => (P.groups[g] || []).map((e) => e.key)
    // N-h was created 2026-10-01, before N-a and N-g (2026-10-02) and after N-f (2026-09-20)
    const want = ['N-b', 'N-f', 'N-h', 'N-a', 'N-g', 'N-c', 'N-d', 'N-e']
    ok(JSON.stringify(keys('Not now')) === JSON.stringify(want), `Not now is ordered ${want.join(' ')} (got ${keys('Not now').join(' ')})`)
    ok(keys('Decide')[keys('Decide').length - 1] === 'Q-low', 'a non-urgent item ranks after the urgent ones, however old')
    ok(keys('Decide')[0] === 'Q-high' && keys('Decide')[1] === 'Q-urgent', 'among urgent items, priority High ranks before Low')
  }

  // ──────────────────────────────────────────────────────────────────────────
  section('output: files, groups in order, why and next, escaping, front matter')
  {
    const HOSTILE = 'Pipe | star * <script>alert(1)</script> [click](javascript:alert(1)) `code` _em_'
    const r = brief([
      item('O-1', { priority: 1, assignee: null, nextStep: 'Decide who owns it', url: 'https://linear.app/x/issue/O-1' }),
      item('O-2', { title: HOSTILE, nextStep: HOSTILE, assignee: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }),
      item('O-3', { title: 'line one\n## Injected heading\n- [x] fake', nativeState: 'In *Review*' }),
      item('O-4', { title: 'a link (with parens)', url: 'https://example.com/a_(b)<c>' }),
    ])
    ok(r.status === 0, `brief exits 0 (${r.stderr.trim()})`)
    const file = join(r.mdir, 'briefings', '20261016-120000.md')
    ok(existsSync(file), 'the briefing is written to .grimoire/manager/briefings/<YYYYMMDD-HHMMSS>.md (UTC)')
    ok(r.stdout.trim() === file, `the briefing path is printed (${r.stdout.trim()})`)
    const md = latest(r)
    ok(md && md === readFileSync(file, 'utf8'), 'latest.md is the same briefing')
    const P = parse(md)
    ok(JSON.stringify(P.order) === JSON.stringify(['Decide', 'Do', 'Hand to AI', 'Waiting on others', 'Not now']), `the groups come in order (${P.order.join(', ')})`)
    ok(/_Nothing here\._/.test(md), 'an empty group says so')
    ok(E(P, 'O-1').why.length > 0 && E(P, 'O-1').next === 'Decide who owns it', 'every item shows why it is there and its next step')
    ok(/\[title of O-1\]\(https:\/\/linear\.app\/x\/issue\/O-1\)/.test(md), 'an http(s) url becomes the link')
    ok(!/<script>/i.test(md) && /&lt;script&gt;/.test(md), '<script> in a title is escaped')
    ok(!/<img/i.test(md), 'HTML in the assignee is escaped')
    ok(!/\]\(javascript:/i.test(md), 'a ](javascript: link cannot form, in the title or the url')
    const o2 = E(P, 'O-2')
    ok(/\\\|/.test(o2.line) && /\\\*/.test(o2.line) && /\\`/.test(o2.line) && /\\_em\\_/.test(o2.line), 'Markdown control characters (|, *, `, _) are escaped in the title')
    ok(/\\\|/.test(o2.next) && /&lt;script&gt;/.test(o2.next) && /\\\[click\\\]/.test(o2.next), 'and in the next step')
    ok(!md.split('\n').includes('## Injected heading') && !/^- \[x\] fake/m.test(md), 'a newline in a title cannot start a heading or a list item')
    ok(/In \\\*Review\\\*/.test(E(P, 'O-3').line), 'the native state is escaped too')
    ok(/\(https:\/\/example\.com\/a_%28b%29%3Cc%3E\)/.test(md), 'parentheses and angle brackets in a url are percent-encoded')
    const counts = P.front.counts || {}
    ok(P.front.generatedAt === NOW, `the front matter has generatedAt (${P.front.generatedAt})`)
    ok(P.front.partial === false, 'and partial: false')
    ok(JSON.stringify(P.front.sources) === JSON.stringify(['linear']), 'and the sources read')
    ok(counts.total === 4 && counts.decide === 1 && counts.do === 0 && counts.ai === 0 && counts.waiting === 0 && counts.notnow === 3 && counts.urgent === 1,
      `and the counts per group (${JSON.stringify(counts)})`)
    ok(Object.keys(P.groups).every((g) => P.groups[g].length === { Decide: counts.decide, Do: counts.do, 'Hand to AI': counts.ai, 'Waiting on others': counts.waiting, 'Not now': counts.notnow }[g]),
      'the counts equal the items listed under each group')

    const empty = brief([])
    ok(empty.status === 0 && /Nothing needs you right now/.test(latest(empty)), 'no items: an explicit "nothing needs you right now"')
  }

  // ──────────────────────────────────────────────────────────────────────────
  section('ledger: written, firstSeenAt kept across runs, the hash tracks what matters')
  {
    const root = join(TMP, 'ledger')
    const r1 = brief([item('L-1', { priority: 3 }), item('L-2')], { root })
    const L1 = readJ(join(r1.mdir, 'ledger.json'))
    ok(L1.schemaVersion === 1, 'the ledger has schemaVersion 1')
    ok(L1.sources && L1.sources.linear && L1.sources.linear.lastRunAt === NOW && L1.sources.linear.lastStatus === 'ok', 'per source: lastRunAt and lastStatus')
    const e1 = L1.items && L1.items['linear:L-1']
    ok(e1 && e1.firstSeenAt === NOW && /^[0-9a-f]{16,}$/.test(e1.lastHash) && e1.lastBucket === 'notnow', 'per item: firstSeenAt, lastHash, lastBucket')
    const later = at(26 * HOUR)
    const r2 = brief([item('L-1', { priority: 3, title: 'renamed, which the hash ignores' }), item('L-2', { priority: 1 }), item('L-3')], { root, now: later })
    ok(r2.status === 0, 'a second run over the same project exits 0')
    const L2 = readJ(join(r2.mdir, 'ledger.json'))
    ok(L2.items['linear:L-1']?.firstSeenAt === NOW, 'a second run keeps firstSeenAt')
    ok(!!e1 && L2.items['linear:L-1']?.lastHash === e1.lastHash, 'the hash is unchanged when state, priority, assignee, due, blockers, labels and PR are')
    ok(L2.items['linear:L-2']?.lastHash !== L1.items['linear:L-2']?.lastHash && L2.items['linear:L-2']?.lastBucket === 'do', 'a priority change changes the hash and the bucket')
    ok(L2.items['linear:L-3']?.firstSeenAt === later, 'a new item is first seen now')
    ok(L2.sources.linear?.lastRunAt === later, 'the source records the latest run')
    ok((existsSync(join(r2.mdir, 'briefings')) && readdirSync(join(r2.mdir, 'briefings')).length === 2), 'each run keeps its own briefing file')

    mkdirSync(r2.mdir, { recursive: true })
    writeFileSync(join(r2.mdir, 'ledger.json'), '{ not json')
    const r3 = brief([item('L-1')], { root, now: at(30 * HOUR) })
    const L3 = readJ(join(r3.mdir, 'ledger.json'))
    ok(r3.status === 0 && L3.items['linear:L-1']?.firstSeenAt === at(30 * HOUR), 'a corrupt ledger is rebuilt, not a crash')

    const custom = join(TMP, 'custom-ledger', 'l.json')
    const r4 = brief([item('L-9')], { extra: ['--ledger', custom] })
    ok(r4.status === 0 && existsSync(custom) && !existsSync(join(r4.mdir, 'ledger.json')), '--ledger writes the ledger where it says')
  }

  // ──────────────────────────────────────────────────────────────────────────
  section('lock: a fresh .lock refuses with exit 3, a stale one is broken')
  {
    const root = join(TMP, 'lock')
    const mdir = join(root, '.grimoire', 'manager')
    mkdirSync(mdir, { recursive: true })
    writeFileSync(join(mdir, '.lock'), JSON.stringify({ pid: 4242, at: NOW }))
    const held = brief([item('K-1')], { root })
    ok(held.status === 3 && /a briefing is in progress/.test(held.stderr), `a fresh lock refuses with exit 3 (${held.status}: ${held.stderr.trim()})`)
    ok(existsSync(join(mdir, '.lock')) && !existsSync(join(mdir, 'latest.md')), 'the held lock is left alone and nothing is written')
    const old = (Date.now() - 31 * 60000) / 1000
    utimesSync(join(mdir, '.lock'), old, old)
    const stale = brief([item('K-1')], { root })
    ok(stale.status === 0 && existsSync(join(mdir, 'latest.md')), 'a lock older than 30 min is broken and the briefing runs')
    ok(!existsSync(join(mdir, '.lock')), 'the lock is released when the briefing is written')
    const fresh = (Date.now() - 29 * 60000) / 1000
    writeFileSync(join(mdir, '.lock'), 'garbage')
    utimesSync(join(mdir, '.lock'), fresh, fresh)
    ok(brief([item('K-1')], { root }).status === 3, 'a lock 29 min old is still held, whatever it holds')
    rmSync(join(mdir, '.lock'))
    ok(!existsSync(join(brief([item('K-1', { priority: 9 })], { root }).mdir, '.lock')), 'a refused items file releases the lock too')
  }

  // ──────────────────────────────────────────────────────────────────────────
  section('view(): the one view model, imported, agrees with the front matter')
  {
    const mod = await import(SCRIPT)
    ok(typeof mod.view === 'function', 'manager.mjs exports view()')
    const items = [
      item('V-1', { stateType: 'triage' }), item('V-2', { priority: 1 }), item('V-3', { assignee: null, hasAcceptanceCriteria: true }),
      item('V-4', { bucketHint: 'waiting' }), item('V-5'), item('V-6', { stateType: 'completed' }),
    ]
    const config = { manager: { urgent: { priorityAtMost: 2, dueWithinDays: 2 } } }
    const V = mod.view(items, config, null, NOW)
    const r = brief(items, { config })
    const F = parse(latest(r)).front
    ok(V && V.counts && JSON.stringify(V.counts) === JSON.stringify(F.counts), `view().counts equal the front matter's (${JSON.stringify(V && V.counts)})`)
    ok(Array.isArray(V.groups) && V.groups.map((g) => g.id).join() === 'decide,do,ai,waiting,notnow', 'view().groups are decide, do, ai, waiting, notnow, in order')
    const v2 = V.groups.flatMap((g) => g.items).find((i) => i.id === 'V-2')
    ok(v2 && v2.urgent === true && Array.isArray(v2.reasons) && v2.reasons.includes('priority Urgent'), 'each item carries urgent and its reasons[]')
    ok(typeof V.nextStep === 'string' && V.nextStep.length > 0, 'the view carries the briefing\'s next step')
    ok(V.generatedAt === NOW, 'and generatedAt from the one now')
    const again = mod.view(items, config, null, NOW)
    ok(JSON.stringify(again) === JSON.stringify(V), 'view() is deterministic')
    ok(JSON.stringify(items[0]) === JSON.stringify(item('V-1', { stateType: 'triage' })), 'view() does not mutate its input')
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
