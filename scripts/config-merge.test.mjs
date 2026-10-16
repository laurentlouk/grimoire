// ════════════════════════════════════════════════════════════════════════════
//  Tests — config-merge.mjs: the setup re-run's diff, and a write of only what is approved
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node scripts/config-merge.test.mjs
//
//  What this locks down (the CLI is spawned against temp files, the way setup runs it):
//    • a key missing from the current file is ADDED; a key both files hold with different
//      values is CHANGED and is applied only when an --approve names its path; a key only the
//      current file has is KEPT; without --write nothing is written
//    • hand-written keys the proposal does not know survive a --write, in their order
//    • repos[] is matched by name and specialists[] by agent: a hand-edited repos[].gate is kept
//      unless approved, the existing entries keep their order, a new repo is appended whole
//    • invalid JSON in either file: exit 1, one line naming the file, nothing written
//    • a missing current file: everything is ADDED, and --write creates it
//    • idempotence: the merged output as current, with the same proposal, gives no ADDED and
//      no CHANGED; a declined change is still a difference, so it is listed again
//    • secret-looking values (token|secret|password|apikey|api_key keys) are «redacted» in the
//      printed diff, text and --json, and intact in the written file; numbers stay visible
//    • .claude/settings.json: permissions lists are sets (user entries kept, proposed ones
//      appended once), hooks are matched by matcher and their commands merged as a set
//    • an --approve that names no CHANGED key warns on stderr and is ignored
//    • --write with nothing to change leaves the file's bytes alone
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'

const SCRIPT = new URL('./config-merge.mjs', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const section = (t) => console.log(`\n── ${t}`)
const same = (a, b, m) => {
  const c = isDeepStrictEqual(a, b)
  ok(c, m)
  if (!c) console.log(`      got:  ${JSON.stringify(a)}\n      want: ${JSON.stringify(b)}`)
}

const ROOT = mkdtempSync(join(tmpdir(), 'grimoire-config-merge-'))
const cli = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })
const json = (r) => { try { return JSON.parse(r.stdout) } catch { return null } }
const pretty = (v) => JSON.stringify(v, null, 2) + '\n'
const lines = (s) => s.split('\n')
let n = 0
const project = () => { const d = join(ROOT, `p${++n}`); mkdirSync(d, { recursive: true }); return d }

// ── fixtures: a configured project whose config was edited by hand ──
const CURRENT = {
  baseBranch: 'origin/main',
  memoryDir: 'memory',
  myTeamNote: 'hand-written, no proposal knows it',
  maxOutputTokens: 4000000,
  guard: { enabled: true, protectedBranches: ['main'] },
  repos: [
    { name: 'web', path: 'repositories/web', agent: 'web-engineer', tags: ['frontend'], gate: null },
    { name: 'api', path: 'repositories/api', agent: 'api-engineer', tags: ['backend'], gate: { run: 'make e2e-test E2E_LOCK_WAIT=1800' }, timeoutMin: 60 },
  ],
}
const PROPOSED = {
  baseBranch: 'origin/main',
  memoryDir: 'memory',
  maxOutputTokens: 3000000,
  runsDir: 'runs',
  guard: { enabled: true, protectedBranches: ['main', 'release/*'] },
  telemetry: { enabled: true, dir: '.grimoire/runs', retentionDays: 183 },
  repos: [
    { name: 'api', path: 'repositories/api', agent: 'api-engineer', tags: ['backend'], gate: { run: 'make e2e-test', stamp: 'tests/e2e/.e2e-green' } },
    { name: 'infra', path: 'repositories/infra', agent: 'infra-engineer', tags: ['infra'], gate: null },
    { name: 'web', path: 'repositories/web', agent: 'web-engineer', tags: ['frontend'], gate: null },
  ],
}
const INFRA = PROPOSED.repos[1]
const TELEMETRY = PROPOSED.telemetry
// The merge with nothing approved: current keys in their order, added ones appended.
const mergedWith = ({ branches = ['main'], gate = { run: 'make e2e-test E2E_LOCK_WAIT=1800' }, tokens = 4000000 } = {}) => ({
  baseBranch: 'origin/main',
  memoryDir: 'memory',
  myTeamNote: 'hand-written, no proposal knows it',
  maxOutputTokens: tokens,
  guard: { enabled: true, protectedBranches: branches },
  repos: [
    { name: 'web', path: 'repositories/web', agent: 'web-engineer', tags: ['frontend'], gate: null },
    { name: 'api', path: 'repositories/api', agent: 'api-engineer', tags: ['backend'], gate, timeoutMin: 60 },
    INFRA,
  ],
  runsDir: 'runs',
  telemetry: TELEMETRY,
})
const DIFF = {
  added: [
    { path: 'repos[infra]', value: INFRA },
    { path: 'runsDir', value: 'runs' },
    { path: 'telemetry', value: TELEMETRY },
  ],
  changed: [
    { path: 'maxOutputTokens', current: 4000000, proposed: 3000000, approved: false },
    { path: 'guard.protectedBranches', current: ['main'], proposed: ['main', 'release/*'], approved: false },
    { path: 'repos[api].gate', current: { run: 'make e2e-test E2E_LOCK_WAIT=1800' }, proposed: { run: 'make e2e-test', stamp: 'tests/e2e/.e2e-green' }, approved: false },
  ],
  kept: [
    { path: 'myTeamNote', value: 'hand-written, no proposal knows it' },
    { path: 'repos[api].timeoutMin', value: 60 },
  ],
  unchanged: ['baseBranch', 'memoryDir', 'guard.enabled', 'repos[web]', 'repos[api].name', 'repos[api].path', 'repos[api].agent', 'repos[api].tags'],
}

try {
  // ══════ 1 · added, changed, kept; nothing written without --write ══════
  section('1 · a missing key is ADDED, a changed key is listed and NOT applied without --approve, nothing written without --write')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const before = readFileSync(join(d, 'grimoire.config.json'), 'utf8')

    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json')
    ok(r.status === 0, `--json dry run exits 0 (got ${r.status}; stderr: ${r.stderr.trim()})`)
    same(json(r), { current: 'grimoire.config.json', proposed: 'proposal.json', currentExists: true, ...DIFF, ignoredApprovals: [], written: null },
      '--json lists every added, changed, kept and unchanged path, in file order, with full values')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === before, 'without --write the current file is byte-for-byte untouched')
    same(readdirSync(d).sort(), ['grimoire.config.json', 'proposal.json'], 'without --write no other file appears either')

    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json')
    ok(t.status === 0, 'the text dry run exits 0')
    same(lines(t.stdout), [
      'config-merge: grimoire.config.json ← proposal.json',
      '  ADDED    repos[infra]  ' + JSON.stringify(INFRA),
      '  ADDED    runsDir  "runs"',
      '  ADDED    telemetry  ' + JSON.stringify(TELEMETRY),
      "  CHANGED  maxOutputTokens  4000000 → 3000000  (kept: needs --approve 'maxOutputTokens')",
      `  CHANGED  guard.protectedBranches  ["main"] → ["main","release/*"]  (kept: needs --approve 'guard.protectedBranches')`,
      `  CHANGED  repos[api].gate  {"run":"make e2e-test E2E_LOCK_WAIT=1800"} → {"run":"make e2e-test","stamp":"tests/e2e/.e2e-green"}  (kept: needs --approve 'repos[api].gate')`,
      '  KEPT     myTeamNote  "hand-written, no proposal knows it"  (only in the current file)',
      '  KEPT     repos[api].timeoutMin  60  (only in the current file)',
      '3 added · 3 changed (0 approved) · 2 kept · 8 unchanged',
      'nothing written: dry run (add --write to apply the added keys and the approved changes)',
      '',
    ], 'the text diff prints added, then changed (with the --approve that would apply each), then kept, then the counts')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === before, 'the text dry run writes nothing either')

    const w = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    ok(w.status === 0, '--write with no --approve exits 0')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty(mergedWith()),
      '--write with no --approve applies the added keys only: every changed key keeps its current value (exact JSON, 2-space, trailing newline)')
    ok(/^wrote grimoire\.config\.json$/m.test(w.stdout), '--write says which file it wrote')
    same(readdirSync(d).sort(), ['grimoire.config.json', 'proposal.json'], 'the atomic write leaves no temp file behind')
  }

  section('1b · --approve applies exactly the changed keys it names')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--approve', 'guard.protectedBranches', '--approve', 'maxOutputTokens', '--write', '--json')
    ok(r.status === 0, `--write with two --approve exits 0 (stderr: ${r.stderr.trim()})`)
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty(mergedWith({ branches: ['main', 'release/*'], tokens: 3000000 })),
      'the two approved keys take the proposed value; the unapproved repos[api].gate keeps the hand-edited one (exact JSON)')
    const j = json(r)
    same(j && j.changed.map((c) => [c.path, c.approved]), [['maxOutputTokens', true], ['guard.protectedBranches', true], ['repos[api].gate', false]], '--json marks which changed keys were approved')
    ok(j && j.written === 'grimoire.config.json', '--json names the written file')
    ok(r.stderr === '', 'approving changed keys prints no warning')
  }

  // ══════ 2 · hand-written keys survive ══════
  section('2 · hand-written keys the proposal does not know survive a --write, in their order')
  {
    const d = project()
    const cur = { $comment: 'ours', zeta: 1, alpha: { nested: ['x', 'y'], deep: { k: true } }, repos: [{ name: 'api', path: '.', agent: 'api-engineer', custom: 'kept' }], mid: null }
    const prop = { baseBranch: 'origin/main', repos: [{ name: 'api', path: '.', agent: 'api-engineer' }] }
    writeFileSync(join(d, 'grimoire.config.json'), pretty(cur))
    writeFileSync(join(d, 'proposal.json'), pretty(prop))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write', '--json')
    ok(r.status === 0, 'exits 0')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty({ ...cur, baseBranch: 'origin/main' }),
      'every hand-written key, a null among them, stays with its value and in its place; the added key is appended (exact JSON)')
    same(json(r) && json(r).kept.map((k) => k.path), ['$comment', 'zeta', 'alpha', 'repos[api].custom', 'mid'], 'they are listed as KEPT')
  }

  // ══════ 3 · repos[] matched by name ══════
  section('3 · repos[] matched by name: a hand-edited gate is kept without --approve, order preserved, a new repo appended; specialists[] by agent')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    const got = JSON.parse(readFileSync(join(d, 'grimoire.config.json'), 'utf8'))
    ok(r.status === 0, 'exits 0')
    same(got.repos.map((x) => x.name), ['web', 'api', 'infra'], 'the existing entries keep their order (web, api) although the proposal lists api first; infra is appended')
    same(got.repos[1].gate, { run: 'make e2e-test E2E_LOCK_WAIT=1800' }, "api's hand-edited gate is kept whole: the proposal's stamp is not mixed into it")
    same(got.repos[1].timeoutMin, 60, "api's hand-added timeoutMin is kept")
    same(got.repos[2], INFRA, 'the new repo entry is added whole')

    const a = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--approve', 'repos[api].gate', '--write')
    ok(a.status === 0, '--approve repos[api].gate exits 0')
    same(JSON.parse(readFileSync(join(d, 'grimoire.config.json'), 'utf8')).repos[1],
      { name: 'api', path: 'repositories/api', agent: 'api-engineer', tags: ['backend'], gate: { run: 'make e2e-test', stamp: 'tests/e2e/.e2e-green' }, timeoutMin: 60 },
      'approved, the gate is replaced whole by the proposed one, and the hand-added timeoutMin still stays')

    const s = project()
    writeFileSync(join(s, 'grimoire.config.json'), pretty({ specialists: [{ agent: 'test-engineer', repos: ['*'] }, { agent: 'migration-engineer', repos: ['api'], use: 'ours' }] }))
    writeFileSync(join(s, 'proposal.json'), pretty({ specialists: [{ agent: 'migration-engineer', repos: ['api', 'db'] }, { agent: 'test-engineer', repos: ['*'] }, { agent: 'perf-engineer', repos: ['web'] }] }))
    const sj = json(cli(s, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json'))
    same(sj && { added: sj.added, changed: sj.changed, kept: sj.kept, unchanged: sj.unchanged }, {
      added: [{ path: 'specialists[perf-engineer]', value: { agent: 'perf-engineer', repos: ['web'] } }],
      changed: [{ path: 'specialists[migration-engineer].repos', current: ['api'], proposed: ['api', 'db'], approved: false }],
      kept: [{ path: 'specialists[migration-engineer].use', value: 'ours' }],
      unchanged: ['specialists[test-engineer]', 'specialists[migration-engineer].agent'],
    }, 'specialists[] entries are matched by agent; other arrays (repos inside one) are values compared whole')
  }

  // ══════ 4 · invalid JSON ══════
  section('4 · invalid JSON in either file: exit 1, one line naming the file, nothing written')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), '{ "repos": [ ,] }\n')
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write', '--out', 'merged.json')
    ok(r.status === 1, `an invalid current file exits 1 (got ${r.status})`)
    const err = r.stderr.trim().split('\n')
    ok(err.length === 1 && /^config-merge: grimoire\.config\.json: invalid JSON \(.+\)$/.test(err[0]), `one stderr line naming the current file (got ${JSON.stringify(r.stderr)})`)
    ok(r.stdout === '', 'nothing on stdout')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === '{ "repos": [ ,] }\n' && !existsSync(join(d, 'merged.json')), 'nothing written: the bad file as it was, no --out file')

    const e = project()
    writeFileSync(join(e, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(e, 'proposal.json'), '{"baseBranch": "origin/main",}')
    const p = cli(e, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    ok(p.status === 1 && /^config-merge: proposal\.json: invalid JSON \(.+\)\n$/.test(p.stderr), `an invalid proposal exits 1 with one line naming it (got ${JSON.stringify(p.stderr)})`)
    ok(readFileSync(join(e, 'grimoire.config.json'), 'utf8') === pretty(CURRENT), 'the current file is untouched')

    const f = project()
    writeFileSync(join(f, 'grimoire.config.json'), '[1, 2]\n')
    writeFileSync(join(f, 'proposal.json'), pretty(PROPOSED))
    const q = cli(f, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    ok(q.status === 1 && /^config-merge: grimoire\.config\.json: the top level must be a JSON object\n$/.test(q.stderr), `a top level that is not an object is refused (got ${JSON.stringify(q.stderr)})`)
    ok(readFileSync(join(f, 'grimoire.config.json'), 'utf8') === '[1, 2]\n', 'and nothing is written')

    const g = project()
    writeFileSync(join(g, 'grimoire.config.json'), pretty(CURRENT))
    const m = cli(g, '--current', 'grimoire.config.json', '--proposed', 'nope.json', '--write')
    ok(m.status === 1 && /^config-merge: nope\.json: not found\n$/.test(m.stderr), `a missing proposal exits 1 naming it (got ${JSON.stringify(m.stderr)})`)
    const u = cli(g, '--current', 'grimoire.config.json')
    ok(u.status === 1 && /--proposed/.test(u.stderr), 'a missing --proposed is a usage error')
  }

  // ══════ 5 · first-time setup ══════
  section('5 · a missing current file: everything is ADDED, and --write creates it')
  {
    const d = project()
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json')
    ok(r.status === 0, 'exits 0')
    same(json(r), {
      current: 'grimoire.config.json', proposed: 'proposal.json', currentExists: false,
      added: Object.entries(PROPOSED).map(([path, value]) => ({ path, value })),
      changed: [], kept: [], unchanged: [], ignoredApprovals: [], written: null,
    }, 'every top-level key of the proposal is ADDED, nothing else is listed')
    ok(!existsSync(join(d, 'grimoire.config.json')), 'the dry run creates nothing')
    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json')
    ok(lines(t.stdout)[0] === 'config-merge: grimoire.config.json ← proposal.json (no current file: everything is added)', 'the text header says there is no current file')

    const w = cli(d, '--current', '.claude/settings.json', '--proposed', 'proposal.json', '--write')
    ok(w.status === 0 && readFileSync(join(d, '.claude', 'settings.json'), 'utf8') === pretty(PROPOSED), '--write creates the file, and its missing parent directory, holding the proposal')
  }

  // ══════ 6 · idempotence ══════
  section('6 · idempotence: a second run on the merged output gives no ADDED and no CHANGED')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const all = ['--approve', 'maxOutputTokens', '--approve', 'guard.protectedBranches', '--approve', 'repos[api].gate']
    ok(cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', ...all, '--write').status === 0, 'first run, every change approved, writes')
    const after1 = readFileSync(join(d, 'grimoire.config.json'), 'utf8')
    const j = json(cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json'))
    same(j && [j.added, j.changed], [[], []], 'the second run lists nothing to add and nothing to change')
    same(j && j.kept.map((k) => k.path), ['myTeamNote', 'repos[api].timeoutMin'], 'the hand-written keys are still KEPT')
    const w = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    ok(w.status === 0 && /^nothing to write: grimoire\.config\.json already holds the merged result$/m.test(w.stdout), 'a --write with nothing to change says so')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === after1, 'and leaves the file as it was')

    const e = project()
    writeFileSync(join(e, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(e, 'proposal.json'), pretty(PROPOSED))
    cli(e, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--approve', 'maxOutputTokens', '--write')
    const k = json(cli(e, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json'))
    same(k && [k.added, k.changed.map((c) => c.path)], [[], ['guard.protectedBranches', 'repos[api].gate']],
      'after a run that declined two changes, the next run adds nothing and lists exactly the declined changes again (they are still differences)')

    const f = project()
    const spaced = JSON.stringify(PROPOSED, null, 4) // the user's own formatting
    writeFileSync(join(f, 'grimoire.config.json'), spaced)
    writeFileSync(join(f, 'proposal.json'), pretty(PROPOSED))
    cli(f, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    ok(readFileSync(join(f, 'grimoire.config.json'), 'utf8') === spaced, 'a --write with nothing to change does not even reformat the file')
  }

  // ══════ 7 · secrets ══════
  section('7 · secret-looking values are «redacted» in the printed diff, intact in the written file')
  {
    const d = project()
    const SECRETS = ['ghp_live_should_not_print_123', 'xoxb-old-secret', 'xoxb-new-secret', 'sk-proposed-secret-456', 'hunter2', 'oauth-refresh-789']
    const cur = { maxOutputTokens: 4000000, env: { GITHUB_TOKEN: 'ghp_live_should_not_print_123', LOG_LEVEL: 'debug' }, slack: { botToken: 'xoxb-old-secret' } }
    const prop = { maxOutputTokens: 3000000, slack: { botToken: 'xoxb-new-secret' }, apiKey: 'sk-proposed-secret-456', servers: [{ name: 'db', password: 'hunter2' }], secrets: { refresh: 'oauth-refresh-789', ttl: 3600 } }
    writeFileSync(join(d, 'grimoire.config.json'), pretty(cur))
    writeFileSync(join(d, 'proposal.json'), pretty(prop))
    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--approve', 'slack.botToken', '--write')
    ok(t.status === 0, 'exits 0')
    ok(SECRETS.every((s) => !t.stdout.includes(s) && !t.stderr.includes(s)), 'no secret value appears anywhere in the text output')
    same(lines(t.stdout).filter((l) => l.startsWith('  ')), [
      '  ADDED    apiKey  "«redacted»"',
      '  ADDED    servers  [{"name":"db","password":"«redacted»"}]',
      '  ADDED    secrets  {"refresh":"«redacted»","ttl":3600}',
      "  CHANGED  maxOutputTokens  4000000 → 3000000  (kept: needs --approve 'maxOutputTokens')",
      '  CHANGED  slack.botToken  "«redacted»" → "«redacted»"  (approved)',
      '  KEPT     env  {"GITHUB_TOKEN":"«redacted»","LOG_LEVEL":"debug"}  (only in the current file)',
    ], 'secret strings are redacted at any depth, under a secret-looking key; numbers (maxOutputTokens, ttl) and other strings stay visible')
    const written = readFileSync(join(d, 'grimoire.config.json'), 'utf8')
    ok(written === pretty({ maxOutputTokens: 4000000, env: cur.env, slack: { botToken: 'xoxb-new-secret' }, apiKey: prop.apiKey, servers: prop.servers, secrets: prop.secrets }),
      'the written file carries every value intact, the approved secret change applied (exact JSON)')
    ok(!written.includes('«redacted»'), 'the written file holds no redaction marker')

    writeFileSync(join(d, 'grimoire.config.json'), pretty(cur))
    const j = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json')
    ok(SECRETS.every((s) => !j.stdout.includes(s)), 'no secret value appears in the --json output either')
    same(json(j) && json(j).changed[1], { path: 'slack.botToken', current: '«redacted»', proposed: '«redacted»', approved: false }, '--json shows a changed secret as «redacted» on both sides')
  }

  // ══════ 8 · .claude/settings.json ══════
  section('8 · settings.json: permissions lists are sets, hooks matched by matcher, plugins and marketplaces merged as objects')
  {
    const d = project()
    mkdirSync(join(d, '.claude'))
    const LINT = { type: 'command', command: './scripts/lint-bash.sh' }
    const RTK = { type: 'command', command: 'rtk hook claude' }
    const MARKET = { grimoire: { source: { source: 'github', repo: 'laurentlouk/grimoire' } } }
    const cur = {
      permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(./.env)', 'Bash(curl:*)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [LINT] }], SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
      enabledPlugins: { 'other@market': true },
    }
    const prop = {
      extraKnownMarketplaces: MARKET,
      enabledPlugins: { 'grimoire@grimoire': true },
      permissions: { deny: ['Bash(curl:*)', 'Read(./.env.*)', 'Read(./.env.*)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [RTK] }, { matcher: 'Write|Edit', hooks: [RTK] }] },
    }
    writeFileSync(join(d, '.claude', 'settings.json'), pretty(cur))
    writeFileSync(join(d, 'proposal.json'), pretty(prop))
    const r = cli(d, '--current', '.claude/settings.json', '--proposed', 'proposal.json', '--write', '--json')
    ok(r.status === 0, `exits 0 (stderr: ${r.stderr.trim()})`)
    const want = {
      permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(./.env)', 'Bash(curl:*)', 'Read(./.env.*)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [LINT, RTK] }, { matcher: 'Write|Edit', hooks: [RTK] }], SessionStart: cur.hooks.SessionStart },
      enabledPlugins: { 'other@market': true, 'grimoire@grimoire': true },
      extraKnownMarketplaces: MARKET,
    }
    ok(readFileSync(join(d, '.claude', 'settings.json'), 'utf8') === pretty(want),
      "permissions.deny keeps the user's entries in order and appends the proposed one once; the rtk hook joins the user's Bash group (exact JSON)")
    const j = json(r)
    same(j && { added: j.added, changed: j.changed, kept: j.kept, unchanged: j.unchanged }, {
      added: [
        { path: 'permissions.deny[]', value: 'Read(./.env.*)' },
        { path: 'hooks.PreToolUse[Bash].hooks[]', value: RTK },
        { path: 'hooks.PreToolUse[Write|Edit]', value: { matcher: 'Write|Edit', hooks: [RTK] } },
        { path: 'enabledPlugins.grimoire@grimoire', value: true },
        { path: 'extraKnownMarketplaces', value: MARKET },
      ],
      changed: [],
      kept: [
        { path: 'permissions.allow', value: ['Bash(npm test:*)'] },
        { path: 'permissions.deny[]', value: 'Read(./.env)' },
        { path: 'hooks.PreToolUse[Bash].hooks[]', value: LINT },
        { path: 'hooks.SessionStart', value: cur.hooks.SessionStart },
        { path: 'enabledPlugins.other@market', value: true },
      ],
      unchanged: ['hooks.PreToolUse[Bash].matcher'],
    }, 'nothing in a permission list or a hook group is ever CHANGED; an item both files hold is not listed at all')

    const again = json(cli(d, '--current', '.claude/settings.json', '--proposed', 'proposal.json', '--json'))
    same(again && [again.added, again.changed], [[], []], 'a second run on the merged settings adds nothing: no duplicate deny rule, no second rtk hook')

    const e = project()
    writeFileSync(join(e, 'settings.json'), pretty({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [LINT, RTK] }] } }))
    writeFileSync(join(e, 'proposal.json'), pretty({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [RTK] }] } }))
    const k = json(cli(e, '--current', 'settings.json', '--proposed', 'proposal.json', '--json'))
    same(k && [k.added, k.changed], [[], []], 'an rtk hook the user already registered beside their own is not proposed twice')
  }

  // ══════ 9 · --approve of a path that is not CHANGED ══════
  section('9 · an --approve that names no changed key warns on stderr and is ignored')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--approve', 'runsDir', '--approve', 'repos[api]', '--approve', 'nope.nothing', '--write', '--json')
    ok(r.status === 0, 'exits 0')
    same(r.stderr.trim().split('\n'), [
      "config-merge: --approve 'runsDir' is not a changed key (it is added); ignored",
      "config-merge: --approve 'repos[api]' is not a changed key; ignored",
      "config-merge: --approve 'nope.nothing' is not a changed key; ignored",
    ], 'one warning per ignored path')
    same(json(r) && json(r).ignoredApprovals, ['runsDir', 'repos[api]', 'nope.nothing'], '--json lists the ignored approvals')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty(mergedWith()), 'and the write is exactly the one with nothing approved')
  }

  // ══════ 10 · --out ══════
  section('10 · --write --out writes the merge elsewhere and leaves the current file alone')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write', '--out', 'out/merged.json')
    ok(r.status === 0 && readFileSync(join(d, 'out', 'merged.json'), 'utf8') === pretty(mergedWith()), '--out receives the merged file')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty(CURRENT), 'the current file is untouched')
  }

  // ══════ 11 · the module ══════
  section('11 · importing the module runs nothing and exposes the pure functions')
  {
    const mod = await import(SCRIPT)
    ok(typeof mod.planMerge === 'function' && typeof mod.redact === 'function' && typeof mod.renderText === 'function', 'planMerge, redact and renderText are exported')
    const plan = mod.planMerge(CURRENT, PROPOSED, ['repos[api].gate'])
    same(plan.merged, mergedWith({ gate: PROPOSED.repos[0].gate }), 'planMerge returns the merged object with only the approved change applied')
    same(CURRENT.repos[1].gate, { run: 'make e2e-test E2E_LOCK_WAIT=1800' }, 'and does not mutate its inputs')
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
