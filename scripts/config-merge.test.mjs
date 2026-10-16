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
//    • repos[] is matched by name, specialists[] by agent and manager.sources[] by id: a
//      hand-edited repos[].gate or source scope is kept unless approved, the existing entries keep
//      their order, a new repo or source is appended whole
//    • invalid JSON in either file: exit 1, one line naming the file with the line and column
//      only (Node's own message quotes the source, secrets included), nothing written
//    • a missing current file: everything is ADDED, and --write creates it
//    • idempotence: the merged output as current, with the same proposal, gives no ADDED and
//      no CHANGED; a declined change is still a difference, so it is listed again
//    • secrets of known shapes are masked in the output, text and --json: every string under
//      `env`, every string under a key named like a token, key, password, credential or auth,
//      and in any value a bearer or `Authorization:` header, URL credentials, `token=`/
//      `api-key:` pairs, `--token X`-style flags, `mysql -pX`, `curl -u`, cookies, secret query
//      parameters, JWTs, Slack webhooks and token formats (sk_live_…, ghp_…, github_pat_…,
//      xoxb-…, AKIA/ASIA…) print as «redacted», the rest of the string kept; keys and paths are
//      never masked (a repo named sk-frontend keeps its name and its --approve hint); the written
//      file keeps the real values; numbers stay visible; an empty proposal lists the whole
//      current file as KEPT, redacted (how setup reads it), a .mcp.json's header tokens, env
//      values and credentialed URLs included
//    • .claude/settings.json: permissions lists are sets (user entries kept, proposed ones
//      appended once), hooks are matched by matcher and their commands merged as a set keyed by
//      type and command, so a user's entry with extra fields is kept, not duplicated
//    • an --approve that names no CHANGED key warns on stderr and is ignored; the printed
//      --approve hint is shell-quoted and round-trips, a `'` in the key included
//    • --write with nothing to change leaves the file's bytes alone
//    • paths: the header and the wrote line name the absolute path, and a symlink's target; a
//      live or dangling symlink is written through, never replaced; the temp file keeps the
//      file's mode; a write failure is one line; an added repo on a kept repo's path is warned
//    • the script runs when started through a symlinked directory
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, realpathSync, symlinkSync, lstatSync, statSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
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

// The real path: the CLI prints absolute paths resolved against its cwd, which the OS reports
// without symlinks (macOS's tmpdir is under one).
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'grimoire-config-merge-')))
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
    same(json(r), { current: join(d, 'grimoire.config.json'), proposed: join(d, 'proposal.json'), currentExists: true, currentLinksTo: null, ...DIFF, ignoredApprovals: [], warnings: [], written: null },
      '--json names both files by absolute path and lists every added, changed, kept and unchanged path, in file order, with full values')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === before, 'without --write the current file is byte-for-byte untouched')
    same(readdirSync(d).sort(), ['grimoire.config.json', 'proposal.json'], 'without --write no other file appears either')

    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json')
    ok(t.status === 0, 'the text dry run exits 0')
    same(lines(t.stdout), [
      `config-merge: ${join(d, 'grimoire.config.json')} ← ${join(d, 'proposal.json')}`,
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
    ok(lines(w.stdout).includes(`wrote ${join(d, 'grimoire.config.json')}`), '--write says which file it wrote, by absolute path')
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
    ok(j && j.written === join(d, 'grimoire.config.json'), '--json names the written file')
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
  section('4 · invalid JSON in either file: exit 1, one line naming the file, its line and column, nothing written')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), '{ "repos": [ ,] }\n')
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write', '--out', 'merged.json')
    ok(r.status === 1, `an invalid current file exits 1 (got ${r.status})`)
    ok(r.stderr === `config-merge: ${join(d, 'grimoire.config.json')}: invalid JSON at line 1, column 14\n`, `one stderr line: the file, the line and the column (got ${JSON.stringify(r.stderr)})`)
    ok(r.stdout === '', 'nothing on stdout')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === '{ "repos": [ ,] }\n' && !existsSync(join(d, 'merged.json')), 'nothing written: the bad file as it was, no --out file')

    const e = project()
    writeFileSync(join(e, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(e, 'proposal.json'), '{"baseBranch": "origin/main",}')
    const p = cli(e, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    ok(p.status === 1 && p.stderr === `config-merge: ${join(e, 'proposal.json')}: invalid JSON at line 1, column 30\n`, `an invalid proposal exits 1 with one line naming it (got ${JSON.stringify(p.stderr)})`)
    ok(readFileSync(join(e, 'grimoire.config.json'), 'utf8') === pretty(CURRENT), 'the current file is untouched')

    const f = project()
    writeFileSync(join(f, 'grimoire.config.json'), '[1, 2]\n')
    writeFileSync(join(f, 'proposal.json'), pretty(PROPOSED))
    const q = cli(f, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    ok(q.status === 1 && q.stderr === `config-merge: ${join(f, 'grimoire.config.json')}: the top level must be a JSON object\n`, `a top level that is not an object is refused (got ${JSON.stringify(q.stderr)})`)
    ok(readFileSync(join(f, 'grimoire.config.json'), 'utf8') === '[1, 2]\n', 'and nothing is written')

    const g = project()
    writeFileSync(join(g, 'grimoire.config.json'), pretty(CURRENT))
    const m = cli(g, '--current', 'grimoire.config.json', '--proposed', 'nope.json', '--write')
    ok(m.status === 1 && m.stderr === `config-merge: ${join(g, 'nope.json')}: not found\n`, `a missing proposal exits 1 naming it (got ${JSON.stringify(m.stderr)})`)
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
      current: join(d, 'grimoire.config.json'), proposed: join(d, 'proposal.json'), currentExists: false, currentLinksTo: null,
      added: Object.entries(PROPOSED).map(([path, value]) => ({ path, value })),
      changed: [], kept: [], unchanged: [], ignoredApprovals: [], warnings: [], written: null,
    }, 'every top-level key of the proposal is ADDED, nothing else is listed')
    ok(!existsSync(join(d, 'grimoire.config.json')), 'the dry run creates nothing')
    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json')
    ok(lines(t.stdout)[0] === `config-merge: ${join(d, 'grimoire.config.json')} ← ${join(d, 'proposal.json')} (no current file: everything is added)`, 'the text header says there is no current file')

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
    ok(w.status === 0 && lines(w.stdout).includes(`nothing to write: ${join(d, 'grimoire.config.json')} already holds the merged result`), 'a --write with nothing to change says so')
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
      '  KEPT     env  {"GITHUB_TOKEN":"«redacted»","LOG_LEVEL":"«redacted»"}  (only in the current file)',
    ], 'secret strings are redacted at any depth, under a secret-looking key, and every env value whatever its name; numbers (maxOutputTokens, ttl) stay visible')
    const written = readFileSync(join(d, 'grimoire.config.json'), 'utf8')
    ok(written === pretty({ maxOutputTokens: 4000000, env: cur.env, slack: { botToken: 'xoxb-new-secret' }, apiKey: prop.apiKey, servers: prop.servers, secrets: prop.secrets }),
      'the written file carries every value intact, the approved secret change applied (exact JSON)')
    ok(!written.includes('«redacted»'), 'the written file holds no redaction marker')

    writeFileSync(join(d, 'grimoire.config.json'), pretty(cur))
    const j = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json')
    ok(SECRETS.every((s) => !j.stdout.includes(s)), 'no secret value appears in the --json output either')
    same(json(j) && json(j).changed[1], { path: 'slack.botToken', current: '«redacted»', proposed: '«redacted»', approved: false }, '--json shows a changed secret as «redacted» on both sides')

    // How setup reads a JSON file without putting its secrets in context: an empty proposal.
    writeFileSync(join(d, 'empty.json'), '{}\n')
    const e = cli(d, '--current', 'grimoire.config.json', '--proposed', 'empty.json', '--write', '--json')
    same(json(e) && { added: json(e).added, changed: json(e).changed, kept: json(e).kept, written: json(e).written }, {
      added: [], changed: [],
      kept: [
        { path: 'maxOutputTokens', value: 4000000 },
        { path: 'env', value: { GITHUB_TOKEN: '«redacted»', LOG_LEVEL: '«redacted»' } },
        { path: 'slack', value: { botToken: '«redacted»' } },
      ],
      written: null,
    }, 'against an empty proposal every key is listed as KEPT, secrets redacted, and even --write writes nothing')
    ok(readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty(cur), 'the file is untouched')
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

  // ══════ 12 · secrets: env, keys, and secrets inside any string ══════
  section('12 · secrets of known shapes are masked in the output: every env value, secret-looking keys, and known shapes inside any string')
  {
    const d = project()
    const SECRETS = ['sk_live_STRIPE0000secret', 'github_pat_11ABCDEFG0123456789', 'hunter2db', 'otel-secret-token-42', 'sk-live-123abcdef', 'xoxb-1234567890-abcdef',
      'xak-plain-value-777', 'plain-pass-888', 'pem-body-plain-999', 'regpass999', 'AKIAABCDEFGHIJKLMNOP', 'sk_live_STRIPE1111proposed', 'zzz-proposed-key-999', 'tok-proposed-555', 'newpass000']
    const CURL = 'Bash(curl -H "Authorization: Bearer sk-live-123abcdef" https://api.example.com)'
    const NOTIFY = { type: 'command', command: 'SLACK_TOKEN=xoxb-1234567890-abcdef ./notify.sh' }
    const REPORT = { type: 'command', command: './report.sh --token=tok-proposed-555 --verbose' }
    const GH = 'Bash(gh api -H "x-api-key: zzz-proposed-key-999" /user)'
    const cur = {
      env: { STRIPE_KEY: 'sk_live_STRIPE0000secret', GITHUB_PAT: 'github_pat_11ABCDEFG0123456789', DATABASE_URL: 'postgres://app:hunter2db@db.internal:5432/app', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer otel-secret-token-42' },
      permissions: { allow: [CURL, 'Bash(npm test:*)'] },
      hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [NOTIFY] }] },
      mcpHeaders: { 'x-api-key': 'xak-plain-value-777' },
      credentials: { pass: 'plain-pass-888' },
      PRIVATE_KEY: 'pem-body-plain-999',
      registry: 'https://deploy:regpass999@npm.example.com/',
      awsCmd: 'aws s3 ls --profile ci AKIAABCDEFGHIJKLMNOP',
    }
    const prop = {
      env: { STRIPE_KEY: 'sk_live_STRIPE1111proposed' },
      permissions: { allow: [GH] },
      hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [REPORT] }] },
      registry: 'https://deploy:newpass000@npm.example.com/',
    }
    writeFileSync(join(d, 'settings.json'), pretty(cur))
    writeFileSync(join(d, 'proposal.json'), pretty(prop))
    const t = cli(d, '--current', 'settings.json', '--proposed', 'proposal.json')
    ok(t.status === 0, `exits 0 (stderr: ${t.stderr.trim()})`)
    const leaks = (r) => SECRETS.filter((s) => r.stdout.includes(s) || r.stderr.includes(s))
    same(leaks(t), [], 'none of these secrets appears in the text output')
    const kept = '  (only in the current file)'
    same(lines(t.stdout).filter((l) => l.startsWith('  ')), [
      '  ADDED    permissions.allow[]  "Bash(gh api -H \\"x-api-key: «redacted»\\" /user)"',
      '  ADDED    hooks.PostToolUse[Bash].hooks[]  {"type":"command","command":"./report.sh --token=«redacted» --verbose"}',
      "  CHANGED  env.STRIPE_KEY  \"«redacted»\" → \"«redacted»\"  (kept: needs --approve 'env.STRIPE_KEY')",
      "  CHANGED  registry  \"https://«redacted»@npm.example.com/\" → \"https://«redacted»@npm.example.com/\"  (kept: needs --approve 'registry')",
      '  KEPT     env.GITHUB_PAT  "«redacted»"' + kept,
      '  KEPT     env.DATABASE_URL  "«redacted»"' + kept,
      '  KEPT     env.OTEL_EXPORTER_OTLP_HEADERS  "«redacted»"' + kept,
      '  KEPT     permissions.allow[]  "Bash(curl -H \\"Authorization: «redacted»\\" https://api.example.com)"' + kept,
      '  KEPT     permissions.allow[]  "Bash(npm test:*)"' + kept,
      '  KEPT     hooks.PostToolUse[Bash].hooks[]  {"type":"command","command":"SLACK_TOKEN=«redacted» ./notify.sh"}' + kept,
      '  KEPT     mcpHeaders  {"x-api-key":"«redacted»"}' + kept,
      '  KEPT     credentials  {"pass":"«redacted»"}' + kept,
      '  KEPT     PRIVATE_KEY  "«redacted»"' + kept,
      '  KEPT     awsCmd  "aws s3 ls --profile ci «redacted»"' + kept,
    ], 'each secret is masked and the rest of its string kept: a bearer header, URL credentials, token= and api-key: pairs, an AWS key; every env value and every value under a secret-looking key')

    const j = cli(d, '--current', 'settings.json', '--proposed', 'proposal.json', '--json')
    same(leaks(j), [], 'none appears in the --json output either')
    same(json(j) && json(j).added.map((e) => e.value), ['Bash(gh api -H "x-api-key: «redacted»" /user)', { type: 'command', command: './report.sh --token=«redacted» --verbose' }], '--json masks the same way')

    const w = cli(d, '--current', 'settings.json', '--proposed', 'proposal.json', '--approve', 'env.STRIPE_KEY', '--approve', 'registry', '--write')
    same(leaks(w), [], 'a --write prints no secret')
    ok(readFileSync(join(d, 'settings.json'), 'utf8') === pretty({
      env: { ...cur.env, STRIPE_KEY: 'sk_live_STRIPE1111proposed' },
      permissions: { allow: [CURL, 'Bash(npm test:*)', GH] },
      hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [NOTIFY, REPORT] }] },
      mcpHeaders: cur.mcpHeaders, credentials: cur.credentials, PRIVATE_KEY: cur.PRIVATE_KEY,
      registry: 'https://deploy:newpass000@npm.example.com/',
      awsCmd: cur.awsCmd,
    }), 'the written file keeps every real value, the approved secret changes applied (exact JSON)')
  }

  // ══════ 13 · invalid JSON that holds a secret ══════
  section("13 · an invalid file's error names the line and column, never the source around it")
  {
    const d = project()
    writeFileSync(join(d, 'proposal.json'), '{}\n')
    const cases = [
      ['{"env": {"GITHUB_TOKEN": "ghp_abcdefghijklmnop123"}, "list": [ ,]}', 1, (raw) => raw.indexOf('[ ,') + 3], // Node quotes the whole source here
      ['{"env": {"GITHUB_TOKEN": "ghp_abcdefghijklmnop123"} "x": 1}', 1, (raw) => raw.indexOf('"x"') + 1],
      ['{\n  "env": {"T": "ghp_abcdefghijklmnop123"},\n  "x": tru\n}\n', 3, () => 8],
    ]
    for (const [raw, line, col] of cases) {
      writeFileSync(join(d, 'settings.json'), raw)
      const r = cli(d, '--current', 'settings.json', '--proposed', 'proposal.json')
      ok(r.status === 1 && r.stderr === `config-merge: ${join(d, 'settings.json')}: invalid JSON at line ${line}, column ${col(raw)}\n` && !r.stderr.includes('ghp_'),
        `line ${line}, column ${col(raw)}, and no token (got ${JSON.stringify(r.stderr)})`)
    }
  }

  // ══════ 14 · started through a symlink ══════
  section('14 · the script runs when started through a symlinked directory or a symlinked file')
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(d, 'proposal.json'), pretty(PROPOSED))
    symlinkSync(dirname(SCRIPT), join(ROOT, 'linked-scripts'))
    symlinkSync(SCRIPT, join(ROOT, 'linked-config-merge.mjs'))
    for (const via of [join(ROOT, 'linked-scripts', 'config-merge.mjs'), join(ROOT, 'linked-config-merge.mjs')]) {
      const r = spawnSync(process.execPath, [via, '--current', 'grimoire.config.json', '--proposed', 'proposal.json'], { cwd: d, encoding: 'utf8' })
      ok(r.status === 0 && lines(r.stdout)[0] === `config-merge: ${join(d, 'grimoire.config.json')} ← ${join(d, 'proposal.json')}` && lines(r.stdout).length === 12,
        `${via.slice(ROOT.length + 1)}: prints the whole diff, not a silent no-op (got ${JSON.stringify(r.stdout.slice(0, 80))})`)
    }
  }

  // ══════ 15 · symlinked files, modes, write failures ══════
  section('15 · a symlinked file is named with its target and written through, live or dangling; the mode is kept; a failed write is one line')
  {
    const d = project()
    mkdirSync(join(d, 'dotfiles'))
    mkdirSync(join(d, '.claude'))
    const link = join(d, '.claude', 'settings.json'), real = join(d, 'dotfiles', 'settings.json')
    writeFileSync(real, pretty({ permissions: { deny: ['Read(./.env)'] } }))
    chmodSync(real, 0o600)
    symlinkSync('../dotfiles/settings.json', link)
    writeFileSync(join(d, 'proposal.json'), pretty({ enabledPlugins: { 'grimoire@grimoire': true } }))
    const t = cli(d, '--current', '.claude/settings.json', '--proposed', 'proposal.json')
    ok(lines(t.stdout)[0] === `config-merge: ${link} (symlink → ${real}) ← ${join(d, 'proposal.json')}`, 'the header names the link and the file it points at')
    ok(json(cli(d, '--current', '.claude/settings.json', '--proposed', 'proposal.json', '--json')).currentLinksTo === real, '--json gives the target as currentLinksTo')
    const w = cli(d, '--current', '.claude/settings.json', '--proposed', 'proposal.json', '--write')
    ok(w.status === 0 && lines(w.stdout).includes(`wrote ${link} (symlink → ${real})`), 'the wrote line names the link and its target')
    ok(lstatSync(link).isSymbolicLink() && readFileSync(real, 'utf8') === pretty({ permissions: { deny: ['Read(./.env)'] }, enabledPlugins: { 'grimoire@grimoire': true } }),
      'a live symlink stays a symlink, and the file it points at holds the merge')
    ok((statSync(real).mode & 0o777) === 0o600, 'the written file keeps its mode (0600)')
    same(readdirSync(join(d, 'dotfiles')), ['settings.json'], 'no temp file is left beside it')

    const e = project()
    mkdirSync(join(e, '.claude'))
    const dangling = join(e, '.claude', 'settings.json'), target = join(e, 'dotfiles', 'settings.json')
    symlinkSync('../dotfiles/settings.json', dangling)
    writeFileSync(join(e, 'proposal.json'), pretty({ enabledPlugins: { 'grimoire@grimoire': true } }))
    const td = cli(e, '--current', '.claude/settings.json', '--proposed', 'proposal.json')
    ok(lines(td.stdout)[0] === `config-merge: ${dangling} (symlink → ${target}) ← ${join(e, 'proposal.json')} (no current file: everything is added)`, 'a dangling symlink is named with its target, as a missing file')
    const wd = cli(e, '--current', '.claude/settings.json', '--proposed', 'proposal.json', '--write')
    ok(wd.status === 0 && lstatSync(dangling).isSymbolicLink() && readFileSync(target, 'utf8') === pretty({ enabledPlugins: { 'grimoire@grimoire': true } }),
      'a dangling symlink is written through too: the link stays, its target is created with the merge')

    const f = project()
    writeFileSync(join(f, 'grimoire.config.json'), pretty(CURRENT))
    writeFileSync(join(f, 'proposal.json'), pretty(PROPOSED))
    writeFileSync(join(f, 'blocker'), 'a file where a directory should be\n')
    const out = join(f, 'blocker', 'sub', 'merged.json')
    const x = cli(f, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write', '--out', 'blocker/sub/merged.json')
    ok(x.status === 1 && new RegExp(`^config-merge: ${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: cannot write \\((ENOTDIR|EEXIST)\\)\\n$`).test(x.stderr),
      `a directory that cannot be made is one line naming the file, no stack trace (got ${JSON.stringify(x.stderr)})`)
  }

  // ══════ 16 · hook items keyed by type and command ══════
  section("16 · a hook command the user registered with extra fields is KEPT, not added a second time")
  {
    const d = project()
    const MINE = { type: 'command', command: 'rtk hook claude', timeout: 5 }
    writeFileSync(join(d, 'settings.json'), pretty({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [MINE] }] } }))
    writeFileSync(join(d, 'proposal.json'), pretty({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } }))
    const j = json(cli(d, '--current', 'settings.json', '--proposed', 'proposal.json', '--json'))
    same(j && { added: j.added, changed: j.changed, kept: j.kept }, { added: [], changed: [], kept: [{ path: 'hooks.PreToolUse[Bash].hooks[]', value: MINE }] },
      'the same type and command is one hook: the user\'s entry, timeout included, is KEPT and nothing is added')
    const before = readFileSync(join(d, 'settings.json'), 'utf8')
    cli(d, '--current', 'settings.json', '--proposed', 'proposal.json', '--write')
    ok(readFileSync(join(d, 'settings.json'), 'utf8') === before, 'and a --write leaves the file alone')
  }

  // ══════ 17 · an added repo on a kept repo's path ══════
  section("17 · an added repos[] entry on a kept entry's path is warned about (a renamed repo)")
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty({ repos: [{ name: 'backend', path: 'repositories/api', agent: 'api-engineer' }] }))
    writeFileSync(join(d, 'proposal.json'), pretty({ repos: [{ name: 'api', path: './repositories/api/', agent: 'api-engineer' }] }))
    const r = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json')
    const msg = 'repos[api] (added) has the same path as repos[backend] (repositories/api): a renamed repo? Both entries would be kept'
    ok(r.status === 0 && r.stderr === `config-merge: warning: ${msg}\n`, `one warning on stderr (got ${JSON.stringify(r.stderr)})`)
    same(json(r) && json(r).warnings, [msg], '--json lists it under warnings')
    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json')
    ok(t.stderr === `config-merge: warning: ${msg}\n`, 'the text run warns the same way')
  }

  // ══════ 18 · the --approve hint is shell-quoted ══════
  section("18 · the printed --approve hint round-trips through the shell, a ' in the key included")
  {
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty({ "it's": 1, repos: [{ name: "o'neil", path: 'x', agent: 'a', gate: null }] }))
    writeFileSync(join(d, 'proposal.json'), pretty({ "it's": 2, repos: [{ name: "o'neil", path: 'x', agent: 'a', gate: { run: 'make e2e' } }] }))
    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json')
    const hints = [...t.stdout.matchAll(/needs --approve ('.*')\)$/gm)].map((m) => m[1])
    same(hints, [`'it'"'"'s'`, `'repos[o'"'"'neil].gate'`], "a ' is closed, escaped and reopened inside the single quotes")
    same(hints.map((h) => spawnSync('sh', ['-c', `printf %s ${h}`], { encoding: 'utf8' }).stdout), ["it's", "repos[o'neil].gate"], 'the shell reads each hint back as the exact path')
    const q = (s) => `'${s.replace(/'/g, `'"'"'`)}'`
    const r = spawnSync('sh', ['-c', `${q(process.execPath)} ${q(SCRIPT)} --current grimoire.config.json --proposed proposal.json --approve ${hints[0]} --approve ${hints[1]} --write`], { cwd: d, encoding: 'utf8' })
    ok(r.status === 0 && r.stderr === '' && readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty({ "it's": 2, repos: [{ name: "o'neil", path: 'x', agent: 'a', gate: { run: 'make e2e' } }] }),
      `pasted into a shell, the hints approve exactly those keys (stderr: ${r.stderr.trim()})`)
  }

  // ══════ 19 · keys and paths are never masked ══════
  section('19 · a name that looks like a token prefix keeps its name in paths and hints; real token shapes in values are still masked')
  {
    const d = project()
    const cur = {
      repos: [{ name: 'sk-frontend', path: 'repositories/sk-frontend', agent: 'web-engineer', gate: null }],
      specialists: [{ agent: 'pk-checkout-engineer', repos: ['sk-frontend'] }],
    }
    const prop = {
      repos: [{ name: 'sk-frontend', path: 'repositories/sk-frontend', agent: 'web-engineer', gate: { run: 'npm run e2e' } }],
      specialists: [{ agent: 'pk-checkout-engineer', repos: ['sk-frontend', 'api'] }],
    }
    writeFileSync(join(d, 'grimoire.config.json'), pretty(cur))
    writeFileSync(join(d, 'proposal.json'), pretty(prop))
    const t = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json')
    same(lines(t.stdout).filter((l) => l.startsWith('  ')), [
      `  CHANGED  repos[sk-frontend].gate  null → {"run":"npm run e2e"}  (kept: needs --approve 'repos[sk-frontend].gate')`,
      `  CHANGED  specialists[pk-checkout-engineer].repos  ["sk-frontend"] → ["sk-frontend","api"]  (kept: needs --approve 'specialists[pk-checkout-engineer].repos')`,
    ], 'sk-frontend and pk-checkout-engineer print as themselves, in the paths and in the values')
    const hints = [...t.stdout.matchAll(/needs --approve ('.*')\)$/gm)].map((m) => m[1])
    same(hints.map((h) => spawnSync('sh', ['-c', `printf %s ${h}`], { encoding: 'utf8' }).stdout), ['repos[sk-frontend].gate', 'specialists[pk-checkout-engineer].repos'], 'the shell reads each hint back as the exact path')
    const q = (s) => `'${s.replace(/'/g, `'"'"'`)}'`
    const r = spawnSync('sh', ['-c', `${q(process.execPath)} ${q(SCRIPT)} --current grimoire.config.json --proposed proposal.json --approve ${hints[0]} --approve ${hints[1]} --write`], { cwd: d, encoding: 'utf8' })
    ok(r.status === 0 && r.stderr === '' && readFileSync(join(d, 'grimoire.config.json'), 'utf8') === pretty(prop), `pasted into a shell, the two hints approve both keys (stderr: ${r.stderr.trim()})`)

    const e = project()
    const TOKENS = ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github_pat_11ABCDEFG0123456789_abcdefghij', 'sk-ant-api03-AbCdEf1234567890XYZ', 'sk_live_51HxYzABCDEFGHIJKLMN', 'xoxb-123456789012-abcdefghijkl']
    writeFileSync(join(e, 'settings.json'), pretty({ permissions: { allow: [...TOKENS.map((x) => `Bash(./deploy.sh ${x})`), 'Bash(cd repositories/sk-frontend && npm test)', 'Bash(./run.sh pk-checkout-engineer rk-tools)'] } }))
    writeFileSync(join(e, 'proposal.json'), '{}\n')
    const j = json(cli(e, '--current', 'settings.json', '--proposed', 'proposal.json', '--json'))
    same(j && j.kept[0].value, { allow: [...TOKENS.map(() => 'Bash(./deploy.sh «redacted»)'), 'Bash(cd repositories/sk-frontend && npm test)', 'Bash(./run.sh pk-checkout-engineer rk-tools)'] },
      'ghp_ (36), github_pat_, sk-ant-, sk_live_ and xoxb- tokens are masked in values; ordinary names with those prefixes are not')
  }

  // ══════ 20 · the leak shapes in permission and command strings ══════
  section('20 · each known secret shape inside a permission or command string is masked, the rest of the string kept')
  {
    const d = project()
    const SHAPES = [
      ['--token X', 'Bash(gh release upload --token ghsplainvalue v1)', 'Bash(gh release upload --token «redacted» v1)'],
      ['--password X', 'Bash(psql --password hunter2pw -h db)', 'Bash(psql --password «redacted» -h db)'],
      ['--api-key=X', 'Bash(tool --api-key=abc123xyz run)', 'Bash(tool --api-key=«redacted» run)'],
      ['--with-token X', 'Bash(gh auth login --with-token tok999abc)', 'Bash(gh auth login --with-token «redacted»)'],
      ['a flag naming a variable stays', 'Bash(gh release upload --token $GH_TOKEN v1)', 'Bash(gh release upload --token $GH_TOKEN v1)'],
      ['mysql -pX', 'Bash(mysql -u root -pS3cretPass mydb)', 'Bash(mysql -u root -p«redacted» mydb)'],
      ['curl -u user:pass', 'Bash(curl -u deploy:hunter2 https://x.example.com)', 'Bash(curl -u «redacted» https://x.example.com)'],
      ['Authorization: token X', 'Bash(curl -H "Authorization: token plainabc" https://api.example.com)', 'Bash(curl -H "Authorization: «redacted»" https://api.example.com)'],
      ['Cookie: …', 'Bash(curl -H "Cookie: session=abc123; theme=dark" https://x.example.com)', 'Bash(curl -H "Cookie: «redacted»" https://x.example.com)'],
      ['?key=', 'WebFetch(https://maps.example.com/api?key=AIzaPlain123&format=json)', 'WebFetch(https://maps.example.com/api?key=«redacted»&format=json)'],
      ['&token=', 'WebFetch(https://x.example.com/feed?format=rss&token=plaintok77)', 'WebFetch(https://x.example.com/feed?format=rss&token=«redacted»)'],
      ['a JWT', 'Bash(curl -H "X-Id: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U" https://x.example.com)', 'Bash(curl -H "X-Id: «redacted»" https://x.example.com)'],
      ['a Slack webhook', 'Bash(curl -X POST https://hooks.slack.com/services/T0001/B0002/abcdefXYZ)', 'Bash(curl -X POST https://hooks.slack.com/services/«redacted»)'],
      ['an ASIA key', 'Bash(aws sts get-caller-identity ASIAABCDEFGHIJKLMNOP)', 'Bash(aws sts get-caller-identity «redacted»)'],
    ]
    writeFileSync(join(d, 'settings.json'), pretty({ permissions: { allow: SHAPES.map(([, raw]) => raw) } }))
    writeFileSync(join(d, 'proposal.json'), '{}\n')
    const j = json(cli(d, '--current', 'settings.json', '--proposed', 'proposal.json', '--json'))
    const got = (j && j.kept[0] && j.kept[0].value.allow) || []
    SHAPES.forEach(([shape, , want], i) => {
      ok(got[i] === want, `${shape}: ${JSON.stringify(want)}${got[i] === want ? '' : ` (got ${JSON.stringify(got[i])})`}`)
    })
  }

  // ══════ 21 · manager.sources[] matched by id ══════
  section('21 · manager.sources[] matched by id: a hand-edited scope and threshold are kept, a new source is appended, a duplicate id makes the array a value')
  {
    const LINEAR = { id: 'linear', category: 'tracker', kind: 'linear', hint: 'mcp__abc__* (Linear, the claude.ai connector)', readOnly: 'guard', scope: { teams: ['ODY'] }, verifiedAt: '2026-10-01T08:00:00Z' }
    const RUNS = { id: 'runs', category: 'runs', kind: 'grimoire' }
    const PRS = { id: 'prs', category: 'prs', kind: 'github', hint: 'gh CLI, authenticated', readOnly: 'permission-rule', scope: { repos: ['acme/app'] }, verifiedAt: '2026-10-16T09:00:00Z' }
    const current = { manager: { sources: [{ ...LINEAR, scope: { teams: ['ODY', 'OPS'] }, note: 'ours' }, RUNS], urgent: { priorityAtMost: 2, dueWithinDays: 2, blocksAtLeast: 2, stalledDays: 7 }, maxItemsPerSource: 200 } }
    const proposed = { manager: { sources: [LINEAR, PRS, RUNS], urgent: { priorityAtMost: 2, dueWithinDays: 2, blocksAtLeast: 2, stalledDays: 5 }, repoLabels: { frontend: 'app' }, maxItemsPerSource: 200 } }
    const d = project()
    writeFileSync(join(d, 'grimoire.config.json'), pretty(current))
    writeFileSync(join(d, 'proposal.json'), pretty(proposed))
    const j = json(cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json'))
    same(j && { added: j.added, changed: j.changed, kept: j.kept }, {
      added: [{ path: 'manager.sources[prs]', value: PRS }, { path: 'manager.repoLabels', value: { frontend: 'app' } }],
      changed: [
        { path: 'manager.sources[linear].scope.teams', current: ['ODY', 'OPS'], proposed: ['ODY'], approved: false },
        { path: 'manager.urgent.stalledDays', current: 7, proposed: 5, approved: false },
      ],
      kept: [{ path: 'manager.sources[linear].note', value: 'ours' }],
    }, 'sources are matched by id: the hand-edited scope and stalledDays are one CHANGED key each, the new prs source is ADDED whole, a hand-added field is KEPT')
    ok(j && j.unchanged.includes('manager.sources[runs]') && j.unchanged.includes('manager.sources[linear].verifiedAt'), 'an equal source, and an equal verifiedAt, are unchanged')

    const w = cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--write')
    const got = JSON.parse(readFileSync(join(d, 'grimoire.config.json'), 'utf8'))
    ok(w.status === 0, '--write exits 0')
    same(got.manager.sources.map((s) => s.id), ['linear', 'runs', 'prs'], 'the current sources keep their order; prs is appended')
    same(got.manager.sources[0].scope, { teams: ['ODY', 'OPS'] }, 'without --approve the hand-edited scope stays')
    same(got.manager.urgent.stalledDays, 7, 'without --approve the hand-set stalledDays stays')
    const again = json(cli(d, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json'))
    same(again && { added: again.added, changed: again.changed.map((c) => c.path) }, { added: [], changed: ['manager.sources[linear].scope.teams', 'manager.urgent.stalledDays'] },
      'a second run adds nothing and lists the two declined changes again')

    const a = project()
    writeFileSync(join(a, 'grimoire.config.json'), pretty({ manager: { sources: [LINEAR, { ...LINEAR, hint: 'other' }] } }))
    writeFileSync(join(a, 'proposal.json'), pretty({ manager: { sources: [LINEAR] } }))
    const v = json(cli(a, '--current', 'grimoire.config.json', '--proposed', 'proposal.json', '--json'))
    same(v && v.changed.map((c) => c.path), ['manager.sources'], 'two sources with one id are not keyable: the array is one value, CHANGED whole')
  }

  // ══════ 22 · .mcp.json read through the script ══════
  section('22 · a .mcp.json diffed against {} (how setup reads it): header tokens, env keys and credentialed URLs print as «redacted», server names and plain fields stay')
  {
    const d = project()
    const MCP = {
      mcpServers: {
        github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/x/issues/readonly', headers: { Authorization: 'Bearer ghp_plainvalue1234567890abcd' } },
        linear: { command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp', '--header', 'Authorization: Bearer lin_api_plain123'], env: { LINEAR_API_KEY: 'lin_api_plain123', AUTH_HEADER: 'Bearer lin_api_plain123' } },
        jira: { type: 'http', url: 'https://bot:hunter2@jira.example.com/mcp?api_key=plainkey99' },
        expo: { command: 'npx', args: ['expo-mcp', '--dev-server-url', 'http://localhost:8081'] },
      },
    }
    writeFileSync(join(d, '.mcp.json'), pretty(MCP))
    writeFileSync(join(d, 'empty.json'), '{}\n')
    const r = cli(d, '--current', '.mcp.json', '--proposed', 'empty.json', '--json')
    const j = json(r)
    const s = (j && j.kept[0] && j.kept[0].value) || {}
    ok(r.status === 0 && j && j.kept.length === 1 && j.kept[0].path === 'mcpServers', 'the whole file is listed as KEPT, nothing added or written')
    same(s.github && s.github.headers, { Authorization: '«redacted»' }, 'a remote server\'s Authorization header prints as «redacted»')
    same(s.linear && s.linear.env, { LINEAR_API_KEY: '«redacted»', AUTH_HEADER: '«redacted»' }, 'every env value of an mcp-remote entry prints as «redacted»')
    same(s.linear && s.linear.args, ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp', '--header', 'Authorization: «redacted»'], 'an Authorization header passed as an argument is masked, the rest kept')
    ok(s.jira && s.jira.url === 'https://«redacted»@jira.example.com/mcp?api_key=«redacted»', `URL credentials and a key parameter are masked (got ${JSON.stringify(s.jira && s.jira.url)})`)
    same(s.github && s.github.url, 'https://api.githubcopilot.com/mcp/x/issues/readonly', 'a plain URL stays readable, so setup can tell a read-only endpoint')
    same(s.expo, MCP.mcpServers.expo, 'a server with no secret prints as it is')
    ok(!/plainvalue|lin_api_plain|hunter2|plainkey99/.test(r.stdout), 'no secret value appears anywhere in the output')
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
