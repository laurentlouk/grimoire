// ════════════════════════════════════════════════════════════════════════════
//  Run durability: incremental delivery, after the final review (0.9.0) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/run-durability-delivery-fix.test.mjs
//
//  An adversarial review of incremental delivery and the environment checks proved, each with a
//  repro, that:
//    • R · a land ship pushed unswept work onto a PR its terminal slot had ALREADY MARKED READY and
//      replaced the gate's final description with the draft banner (a replan, or a resume, landing
//      more work in a gated repo); a halt did the same
//    • P · the PR CLAIMED A HEAD THAT NEVER REACHED THE REMOTE: a failed push still rewrote the body
//      ("landed: PROJ-2") and the halt comment said "up to <the head that failed>"
//    • L · a ship given up on at its hard limit KEPT RUNNING next to the next ship, the halt ship and
//      the gate, all on one worktree and one PR (its push alone could run 15 min, past the ship's
//      12-min hard limit); a ship that started late overwrote a newer description
//    • W · a pre-push hook that edited the ship worktree made every later ship fail its checkout
//    • K · "Migrate to UTF-8 and ISO-8601 dates (PROJ-12)" keyed its run branch on `UTF-8`
//    • E · the commit probe checked out the whole tree, the checks ran one after the other past the
//      Bash tool's 120 s, and one transient ls-remote timeout halted a run whose next check passed
//    • G · a wedged gate that returned BLOCKED after the halt ship skipped its repo left the draft
//      PR with no banner and no comment
//    • I · an integrate that said MERGED without the run branch head made the ship push a lane tip
//    • N · the halt removed a lane worktree of a repo named `review-…`; `result.prs` listed a repo
//      that gated twice twice; a user check named `commit:<repo>` collided with the built-in
//    • M · a tracker title or summary shaped like the state marker put a forged marker above it
//    • S · the gate retyped up to 8000 base64 characters of marker with no check
//
//  Same stubbed runtime as the other loop tests. The ship, seal, gate-lock and environment scripts
//  are RUN in bash, zsh and dash against temporary git repositories, with a fake `gh` that keeps the
//  PR's draft state, body and comments (its `--jq` goes through the real jq when there is one).
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, existsSync, readdirSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = readFileSync(`${DIR}/orchestrate-loop.js`, 'utf8').replace(/^export const meta/m, 'const meta')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8')
const heredocs = (prompt) => [...prompt.matchAll(/<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/g)].map((m) => unb64(m[1]))
const tick = (ms) => new Promise((r) => setTimeout(r, ms))
const later = (v, ms = 15) => tick(ms).then(() => v)
const HANG = () => new Promise(() => {})
const markers = (text) => (String(text).match(/<!--\s*grimoire:state/g) || []).length
const lastLine = (text) => String(text).trimEnd().split('\n').pop()
const { cksum } = new Function(`${body.slice(body.indexOf('const B64_CHARS'), body.indexOf('// A heredoc that lands as a decoded file'))}\nreturn { cksum }`)()
const copied = (marker) => { const tok = (/grimoire:state v1 ([A-Za-z0-9+/=]+) -->/.exec(marker) || [])[1] || marker; return { marker, len: tok.length, sum: cksum(tok) } }

const API = { name: 'api', path: 'repositories/api', agent: 'backend-engineer', tags: ['backend'], gate: null }
const INFRA = { name: 'infra', path: 'repositories/infra', agent: 'infra-engineer', tags: ['infra'], gate: null }
const INPUTS = { specPath: 'docs/specs/x.md', planPath: 'docs/plans/x.md', project: 'PROJ-700', repos: [API] }
const QUIET = { precheck: false, verifyFindings: false, telemetry: { enabled: false } }
const RUN_BRANCH = 'feat/proj-700-api'
const PR_URL = 'https://github.com/x/y/pull/7'
const T = (id, extra = {}) => ({ id, ticket: id, repo: 'api', agent: 'backend-engineer', slice: 1, sliceLabel: 'v', order: 1, taskText: `Build ${id}`, deferred: false, files: [`src/${id.replace(/\W/g, '')}.ts — add it`], ...extra })
const IN = (id, extra = {}) => T(id, { repo: 'infra', agent: 'infra-engineer', files: [`infra/${id.replace(/\W/g, '')}.tf — add it`], ...extra })
const impl = (head, start = '0000000', summary = `built ${head}`) => ({ status: 'DONE', summary, commits: [head], baseSha: '0000000', startSha: start, headSha: head, filesChanged: [] })
const BLOCKED = { status: 'BLOCKED', summary: 'stuck', concerns: 'cannot proceed' }
const V = (verdict) => ({ verdict, findings: [], summary: verdict })
const headOf = (p) => (/landed head `([0-9a-f]+)`/.exec(p) || [])[1]
const checksIn = (p) => [...p.matchAll(/\bsay (?:'([^']+)'|(power)) /g)].map((m) => m[1] || m[2])
const envReport = (p, fail = {}) => ({ results: checksIn(p).map((name) => ({ name, exit: fail[name] ?? 0, output: '' })) })
const happy = (label, p) => {
  if (label.startsWith('impl:')) return impl('aaaaaaa')
  if (label.startsWith('gate:')) return { status: 'DONE', summary: 'green', prUrl: PR_URL }
  if (label.startsWith('ship:')) return { pushed: true, remoteHead: headOf(p), prUrl: PR_URL, draft: true }
  if (label.startsWith('seal:')) return { sealed: true, already: true, prUrl: PR_URL }
  if (label.startsWith('env:')) return envReport(p)
  if (label.startsWith('integrate:')) return { status: 'MERGED', headSha: 'eeeeeee' }
  return V('PASS')
}
const by = (map) => (label, p, o, calls) => (label in map ? (typeof map[label] === 'function' ? map[label](p, o, calls) : map[label]) : happy(label, p))
const indexOf = (tasks, extra) => ({
  slices: [{ slice: 1, sliceLabel: 'v', issues: tasks.map((t) => ({ id: t.id, title: t.title || `Title of ${t.id}`, repo: t.repo, state: 'todo', assignee: '', dependsOn: t.dependsOn || [] })) }],
  hookProblems: [],
  ...extra,
})
async function run(scenario, tasks, responder, { args = {}, index = {}, linger = 0 } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '?'
    calls.push({ label, prompt, opts })
    if (label === 'parse-index') return typeof index === 'function' ? index(prompt) : indexOf(tasks, index)
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
  if (linger) await tick(linger)
  console.log(`\n── ${scenario}`)
  const labels = calls.map((c) => c.label)
  return { result, calls, logs, labels, prompt: (l) => (calls.find((c) => c.label === l) || {}).prompt || '' }
}
const ships = (labels) => labels.filter((l) => l.startsWith('ship:'))

// ── the sandbox: a bare origin, a clone on the run branch, a fake gh that keeps the PR ──
const SHELLS = ['bash', 'zsh', 'dash'].filter((s) => spawnSync('sh', ['-c', `command -v ${s}`]).status === 0)
const HAS_JQ = spawnSync('sh', ['-c', 'command -v jq']).status === 0
const GITENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
// The fake gh: the PR's url, state, draft flag, body, comments and an op log in files. `pr view --jq`
// runs the real jq over {isDraft, body} when there is one, else the two expressions the scripts use.
const fakeGh = (S) => `#!${process.execPath}
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process')
const S = ${JSON.stringify(S)}
const rd = (f, d = '') => { try { return fs.readFileSync(path.join(S, f), 'utf8') } catch (e) { return d } }
const wr = (f, v) => fs.writeFileSync(path.join(S, f), v)
const log = (x) => fs.appendFileSync(path.join(S, 'log'), x + '\\n')
const a = process.argv.slice(2), op = a[0] + ' ' + a[1]
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
const url = rd('url').trim()
if (op === 'pr list') { if (url && rd('state', 'OPEN').trim() === 'OPEN') process.stdout.write(url + '\\n'); process.exit(0) }
if (op === 'pr create') { wr('url', 'https://github.com/x/y/pull/9'); wr('draft', a.includes('--draft') ? 'true' : 'false'); wr('body', fs.readFileSync(opt('--body-file'), 'utf8')); log('create'); process.stdout.write('https://github.com/x/y/pull/9\\n'); process.exit(0) }
if (op === 'pr edit') { wr('body', fs.readFileSync(opt('--body-file'), 'utf8')); log('edit'); process.exit(0) }
if (op === 'pr comment') { fs.appendFileSync(path.join(S, 'comments'), fs.readFileSync(opt('--body-file'), 'utf8') + '\\n<<<END>>>\\n'); log('comment'); process.exit(0) }
if (op === 'pr ready') { wr('draft', 'false'); log('ready'); process.exit(0) }
if (op === 'pr view') {
  const all = { isDraft: rd('draft', 'true').trim() === 'true', body: rd('body') }
  const json = {}; for (const f of (opt('--json') || '').split(',')) json[f] = all[f]
  const jq = opt('--jq')
  if (${HAS_JQ}) { const r = spawnSync('jq', ['-r', jq], { input: JSON.stringify(json), encoding: 'utf8' }); process.stdout.write(r.stdout); process.exit(r.status || 0) }
  if (jq === '.isDraft') { process.stdout.write(String(all.isDraft) + '\\n'); process.exit(0) }
  if (jq === '.body') { process.stdout.write(all.body + '\\n'); process.exit(0) }
  const m = /<!-- grimoire:state v1 ([A-Za-z0-9+/=]+) -->/.exec(all.body || '')
  let g = '-:0'; try { if (m) { const o = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); g = (o.session || '-') + ':' + (o.ship || 0) } } catch (e) {}
  process.stdout.write(all.isDraft + ' ' + g + '\\n'); process.exit(0)
}
process.exit(0)
`
function sandbox() {
  const T0 = mkdtempSync(join(tmpdir(), 'grimoire-fix-'))
  const sh = (cmd, cwd = T0) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: GITENV }).stdout.trim()
  const GH = join(T0, 'gh-state'), BIN = join(T0, 'bin')
  mkdirSync(GH); mkdirSync(BIN)
  writeFileSync(join(BIN, 'gh'), fakeGh(GH))
  chmodSync(join(BIN, 'gh'), 0o755)
  sh('git init -q --bare -b main origin.git && git clone -q origin.git work 2>/dev/null')
  const W = join(T0, 'work')
  sh(`git commit -q --allow-empty -m base && git push -q origin main && git checkout -q -b ${RUN_BRANCH}`, W)
  const file = (f, d = '') => { try { return readFileSync(join(GH, f), 'utf8') } catch (e) { return d } }
  return {
    T0, W, sh, GH,
    commit: (m) => sh(`git commit -q --allow-empty -m ${m} && git rev-parse HEAD`, W),
    origin: () => sh(`git --git-dir=origin.git rev-parse -q --verify refs/heads/${RUN_BRANCH}`),
    pr: { draft: () => file('draft', 'true').trim(), body: () => file('body'), comments: () => file('comments').split('\n<<<END>>>\n').filter((c) => c.trim()), ops: () => file('log').trim().split('\n').filter(Boolean), set: (f, v) => writeFileSync(join(GH, f), v) },
    exec: (shell, script, env = {}) => {
      const t = Date.now()
      const r = spawnSync(shell, ['-c', script], { cwd: T0, encoding: 'utf8', env: { ...GITENV, PATH: `${BIN}:${process.env.PATH}`, ...env } })
      return { out: r.stdout || '', err: r.stderr || '', ms: Date.now() - t }
    },
    done: () => rmSync(T0, { recursive: true, force: true }),
  }
}
const scriptOf = (p) => (/```bash\n([\s\S]*?)\n```/.exec(p) || [])[1] || ''
// what a faithful haiku returns from the lines the ship script printed (briefs/ship.md)
const receipt = (out) => {
  const push = /^PUSH ok=(\d)(?: hook=(\d))?/m.exec(out) || []
  const pr = /^PR ok=(\d)(?: url=(\S*))?/m.exec(out) || []
  const draft = /^DRAFT (\w+)/m.exec(out)
  const failedStep = push[1] === '0' ? 'push' : pr[1] === '0' ? 'pr' : /^COMMENT ok=0/m.test(out) ? 'comment' : undefined
  return { pushed: push[1] === '1', remoteHead: (/^PUSH ok=1 remote=(\S+)/m.exec(out) || [])[1] || '', prUrl: pr[2] || (/^READY url=(\S+)/m.exec(out) || [])[1] || '', draft: draft ? draft[1] === 'true' : undefined, hookBlocked: push[2] === '1', ready: /^READY /m.test(out), lockBusy: /^LOCK busy/m.test(out), failedStep, detail: out.slice(-300) }
}
const realRepo = (W, extra = {}) => [{ name: 'api', path: W, agent: 'backend-engineer', tags: ['backend'], gate: null, ...extra }]

// ══════════════ R · a PR out of draft belongs to the gate ══════════════
{
  let infra = 0
  const { labels, logs, prompt, calls, result } = await run('R1 · api gates (PR ready); a replan lands more api work → no ship touches the ready PR; the next gate pushes it and rewrites the body over every task', [T('PROJ-1'), IN('PROJ-2')],
    by({
      'impl:PROJ-1': impl('aaaaaaa'), 'impl:PROJ-2': () => (++infra === 1 ? BLOCKED : impl('bbbbbbb')), 'impl:PROJ-9': impl('ccccccc', 'aaaaaaa'),
      'replan#1': { decision: 'REVISE', cause: 'code', reason: 'retry infra, plus an api contract fix', learnings: [], tasks: [IN('PROJ-2'), T('PROJ-9', { files: ['src/proj9.ts — x'] })] },
      'gate:api': { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' },
    }), { args: { ...QUIET, repos: [API, INFRA] } })
  const gates = labels.map((l, i) => [l, i]).filter(([l]) => l === 'gate:api').map(([, i]) => i)
  eq(gates.length, 2, 'api gates twice (once before the replan, once after the new work landed)')
  ok(!labels.slice(gates[0] + 1).some((l) => /^ship:api#\d/.test(l)), 'no land ship for api after its PR was marked ready')
  ok(logs.some((l) => /api: no ship — its PR https:\/\/github\.com\/x\/y\/pull\/9 is out of draft, and only the gate pushes to a ready PR; PROJ-9 waits for api's next terminal slot/.test(l)), 'logged: PROJ-9 waits for the next terminal slot')
  const g2 = calls.filter((c) => c.label === 'gate:api')[1].prompt
  ok(g2.includes('https://github.com/x/y/pull/9 is already READY') && g2.includes('over EVERY task listed below') && !g2.includes('gh pr ready https://') && g2.includes('PROJ-9'), 'the second gate: the PR is already ready — push, rewrite the body over every task (PROJ-9 listed), no `gh pr ready`')
  eq(result.prs.map((p) => [p.repo, p.id]), [['api', 'api:gate'], ['infra', 'infra:gate']], 'result.prs lists api once (the latest gate)')
  eq([result.shipped.api.draft, result.draftPrs], [false, {}], 'api: out of draft, no draft PR left')
  void prompt
}
for (const SHELL of SHELLS) {
  const X = sandbox()
  const c1 = X.commit('c1'), c2 = X.commit('c2')
  X.pr.set('url', 'https://github.com/x/y/pull/9'); X.pr.set('draft', 'false'); X.pr.set('body', 'FINAL GATE BODY\n')
  const outs = {}
  const shipReal = (tag) => (p) => { outs[tag] = X.exec(SHELL, scriptOf(p)).out; return receipt(outs[tag]) }
  const { labels, result, logs } = await run(`R2 · [${SHELL}] the real script finds the PR out of draft (the engine did not know): nothing pushed, nothing rewritten; no ship after it`, [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'impl:PROJ-2': () => later(impl(c2.slice(0, 7), c1), 30), 'ship:api#1': shipReal(1), 'ship:api#2': shipReal(2) }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  ok(/^READY url=https:\/\/github\.com\/x\/y\/pull\/9$/m.test(outs[1]) && /^PUSH skipped ready=1$/m.test(outs[1]) && /^PR ok=1 url=\S+ action=ready$/m.test(outs[1]), 'READY, PUSH skipped, PR action=ready')
  eq([X.origin(), X.pr.body(), X.pr.ops(), X.pr.comments().length], ['', 'FINAL GATE BODY\n', [], 0], 'origin has no run branch, the body is the gate\'s, no edit, no comment')
  ok(!labels.includes('ship:api#2') && logs.some((l) => /ship:api#1: its PR https:\/\/github\.com\/x\/y\/pull\/9 is out of draft — nothing pushed, its description left alone/.test(l)), 'booked as out of draft (not a failed push): the second landing ships nothing')
  eq([result.shipped.api.draft, result.shipped.api.disabled], [false, null], 'shipped: draft false, nothing disabled (no failed push booked)')
  X.done()
}
{
  let infra = 0
  const { labels, prompt } = await run('R3 · api gates (ready), a replan lands PROJ-9 there and PROJ-10 blocks; the run halts → the halt ship of the ready PR: the status comment only', [T('PROJ-1'), IN('PROJ-2')],
    by({
      'impl:PROJ-1': impl('aaaaaaa'), 'impl:PROJ-2': () => (++infra, BLOCKED), 'impl:PROJ-9': impl('ccccccc', 'aaaaaaa'), 'impl:PROJ-10': BLOCKED,
      'replan#1': { decision: 'REVISE', cause: 'code', reason: 'an api fix, retry infra', learnings: [], tasks: [IN('PROJ-2'), T('PROJ-9', { files: ['src/proj9.ts — x'] }), T('PROJ-10', { files: ['src/proj10.ts — x'], dependsOn: ['PROJ-9'] })] },
      'replan#2': { decision: 'HALT', reason: 'infra needs a human decision', learnings: [] },
      'gate:api': { status: 'DONE', summary: 'green', prUrl: 'https://github.com/x/y/pull/9' },
    }), { args: { ...QUIET, repos: [API, INFRA], builtinEnvChecks: false } })
  ok(labels.includes('ship:api#halt') && labels.filter((l) => l === 'gate:api').length === 1, 'api gated once; its halt ship runs (new work landed after the gate)')
  const h = prompt('ship:api#halt')
  ok(!/push origin/.test(h) && !/gh pr edit/.test(h) && !/gh pr create/.test(h) && h.includes('gh pr comment "$U" --body-file "$C"'), 'no push, no description: the status comment only')
  const [c = ''] = heredocs(h)
  ok(c.includes('this PR is out of draft') && c.includes('the halt pushed nothing to it') && /- PROJ-9 · `ccccccc` · passed spec and quality review · \*\*landed locally, not yet pushed\*\*/.test(c), 'the comment: out of draft, nothing pushed, PROJ-9 landed locally and not pushed')
}
for (const SHELL of SHELLS) {
  const X = sandbox()
  const c1 = X.commit('c1'), c2 = X.commit('c2')
  const outs = {}
  const shipReal = (tag, before) => (p) => { if (before) before(); outs[tag] = X.exec(SHELL, scriptOf(p)).out; return receipt(outs[tag]) }
  const deny = () => { mkdirSync(join(X.T0, 'origin.git/hooks'), { recursive: true }); writeFileSync(join(X.T0, 'origin.git/hooks/pre-receive'), '#!/bin/sh\necho "remote: denied" >&2\nexit 1\n'); chmodSync(join(X.T0, 'origin.git/hooks/pre-receive'), 0o755) }
  const allowAndReady = () => { rmSync(join(X.T0, 'origin.git/hooks/pre-receive'), { force: true }); X.pr.set('draft', 'false') }
  await run(`R4 · [${SHELL}] the PR was marked ready by hand before the halt; the engine still thinks draft: the halt pushes nothing, rewrites nothing, posts the "out of draft" comment`, [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] }), T('PROJ-3', { dependsOn: ['PROJ-2'] })],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'impl:PROJ-2': () => later(impl(c2.slice(0, 7), c1), 30), 'impl:PROJ-3': BLOCKED,
      'ship:api#1': shipReal(1), 'ship:api#2': shipReal(2, deny), 'ship:api#halt': shipReal('halt', allowAndReady), 'replan#1': { decision: 'HALT', reason: 'stuck', learnings: [] } }),
    { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  ok(/^READY /m.test(outs.halt) && /^PUSH skipped ready=1$/m.test(outs.halt) && /^COMMENT ok=1$/m.test(outs.halt), 'halt: READY, no push, the comment posted')
  eq([X.origin(), X.pr.ops().filter((o) => o === 'edit').length], [c1, 0], 'origin stays at c1 (c2 never pushed); the description was never rewritten after its creation')
  const last = X.pr.comments().pop() || ''
  ok(last.includes('this PR is out of draft') && last.includes(`is at \`${c1.slice(0, 7)}\``) && last.includes('**landed locally, not yet pushed**'), 'the comment: out of draft, the remote at c1, PROJ-2 local only')
  X.done()
}
{
  const marker = '' // no verified marker: the engine learns the PR is ready from the PR line alone
  void marker
  const index = {
    prState: [{ repo: 'api', url: 'https://github.com/x/y/pull/9', state: 'OPEN', isDraft: false, marker: 'none', len: 0, sum: 0 }],
    reconcile: [{ id: 'PROJ-1', repo: 'api', sha: 'aaaaaaa', local: true, origin: false, onBranch: true, inBase: 'no' }],
    runBranches: [{ repo: 'api', local: 'aaaaaaa', remote: '', sync: 'local-only', fetch: 'ok' }],
  }
  const resumeState = { version: 2, attempt: 1, lastSeq: 10, replansUsed: 0, landedTasks: [{ id: 'PROJ-1', repo: 'api', runBranch: RUN_BRANCH, headSha: 'aaaaaaa' }] }
  const { labels, logs, prompt } = await run('R5 · a resume finds the PR already ready and the remote behind, with new issues: no ship at start, none after a landing; the gate gets it', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-2': impl('bbbbbbb', 'aaaaaaa') }), { args: { ...QUIET, resumeState, builtinEnvChecks: false }, index })
  ok(!labels.includes('impl:PROJ-1') && labels.includes('impl:PROJ-2'), 'PROJ-1 absorbed, PROJ-2 built')
  eq(ships(labels), [], 'no ship at all: the PR is out of draft')
  ok(logs.some((l) => /origin\/feat\/proj-700-api lacks the last absorbed head aaaaaaa, but its PR https:\/\/github\.com\/x\/y\/pull\/9 is out of draft — only the gate pushes to it/.test(l)), 'logged at start')
  ok(prompt('gate:api').includes('https://github.com/x/y/pull/9 is already READY'), 'the gate is told the PR is already ready')
}

// ══════════════ P · the PR never claims a head the remote does not hold ══════════════
for (const SHELL of SHELLS) {
  const X = sandbox()
  const c1 = X.commit('c1'), c2 = X.commit('c2')
  const outs = {}
  const shipReal = (tag) => (p) => { outs[tag] = X.exec(SHELL, scriptOf(p)).out; return receipt(outs[tag]) }
  const deny = () => { mkdirSync(join(X.T0, 'origin.git/hooks'), { recursive: true }); writeFileSync(join(X.T0, 'origin.git/hooks/pre-receive'), '#!/bin/sh\necho "remote: denied" >&2\nexit 1\n'); chmodSync(join(X.T0, 'origin.git/hooks/pre-receive'), 0o755) }
  await run(`P1 · [${SHELL}] ship #1 pushes c1; then the remote refuses: ship #2 and the halt fail to push c2 — the body never lists it as landed, the comments say what the remote holds`, [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] }), T('PROJ-3', { dependsOn: ['PROJ-2'] })],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'impl:PROJ-2': () => later(impl(c2.slice(0, 12), c1), 30), 'impl:PROJ-3': BLOCKED,
      'ship:api#1': (p) => { const r = shipReal(1)(p); deny(); return r }, 'ship:api#2': shipReal(2), 'ship:api#halt': shipReal('halt'), 'replan#1': { decision: 'HALT', reason: 'stuck', learnings: [] } }),
    { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  ok(/^PR ok=1 url=https:\/\/github\.com\/x\/y\/pull\/9 action=created$/m.test(outs[1]), `ship #1 opened the PR (${SHELL}: the guarded cd works)`)
  ok(/^PUSH ok=0/m.test(outs[2]) && /^PR ok=1 url=\S+ action=kept$/m.test(outs[2]), 'ship #2: the push failed, the description kept')
  const b = X.pr.body()
  ok(b.includes(`\`${c1.slice(0, 7)}\` · passed`) && !b.includes(`\`${c2.slice(0, 7)}\``) && b.includes('### Landed (1/3)'), 'the body lists PROJ-1 only: never PROJ-2, whose push failed')
  eq(X.pr.ops().filter((o) => o === 'edit').length, 0, 'never edited after the failed pushes')
  const [note = '', halt = ''] = X.pr.comments()
  ok(!!note && note.includes(`could not push \`${c2.slice(0, 7)}\``) && note.includes(`is at \`${c1.slice(0, 7)}\``) && note.includes('PROJ-2 — Title of PROJ-2'), 'ship #2 posted a note: c2 not pushed, origin at c1, PROJ-2 on this machine only')
  ok(!!halt && halt.includes(`the push of \`${c2.slice(0, 7)}\` to \`${RUN_BRANCH}\` FAILED`) && halt.includes(`is at \`${c1.slice(0, 7)}\``) && !halt.includes(`up to \`${c2.slice(0, 7)}\``) && /PROJ-2 — Title of PROJ-2 · `[0-9a-f]{7}` · passed spec and quality review · \*\*landed locally, not yet pushed\*\*/.test(halt), 'the halt comment: the push FAILED, the remote at c1, PROJ-2 local only — never "up to c2"')
  eq(X.origin(), c1, 'origin holds c1')
  X.done()
}
{
  const { calls, prompt } = await run('P2 · a landing without a head SHA: the halt body marks it local only and does not close its issue', [T('#4'), T('#5', { dependsOn: ['#4'] }), T('#6', { dependsOn: ['#5'] })],
    by({ 'impl:#4': impl('aaaaaaa'), 'impl:#5': { status: 'DONE', summary: 'built, no SHA reported', commits: [], filesChanged: [] }, 'impl:#6': BLOCKED, 'replan#1': { decision: 'HALT', reason: 'stuck', learnings: [] } }), { args: { ...QUIET, builtinEnvChecks: false } })
  eq(calls.filter((c) => c.label.startsWith('ship:')).map((c) => [c.label, headOf(c.prompt)]), [['ship:api#1', 'aaaaaaa'], ['ship:api#halt', 'aaaaaaa']], 'every ship pushes aaaaaaa, the last reported head')
  const hb = heredocs(prompt('ship:api#halt'))[0] || ''
  ok(hb.includes('- Closes #4 — Title of #4 · `aaaaaaa`') && hb.includes('- #5 — Title of #5 · head SHA not reported · passed spec and quality review · **landed locally, not yet pushed**') && !hb.includes('Closes #5'), 'the body: #4 closes, #5 is local only and does not close')
}
{
  const { calls, logs } = await run('P3 · an integrate that says MERGED without the run branch head: no ship ever pushes a lane tip', [T('PROJ-1'), T('PROJ-2')],
    by({ 'impl:PROJ-1': impl('1a1a1a1'), 'impl:PROJ-2': () => later(impl('2b2b2b2'), 30), 'integrate:PROJ-1': { status: 'MERGED' }, 'integrate:PROJ-2': { status: 'MERGED', headSha: '2222222' } }), { args: { ...QUIET, builtinEnvChecks: false, maxPerRepo: 2 } })
  const pushed = calls.filter((c) => c.label.startsWith('ship:')).map((c) => headOf(c.prompt))
  ok(pushed.length >= 1 && pushed.every((h) => h === '2222222'), `only the run branch head an integrate reported is pushed (${pushed.join(', ')})`)
  ok(logs.some((l) => /integrate:PROJ-1 reported MERGED without the run branch head — the lane tip 1a1a1a1 is never pushed/.test(l)), 'logged')
}

// ══════════════ L · one ship at a time, bounded, never over a newer description ══════════════
{
  // one engine run hands out the scripts; each is then run under the conditions of the scenario
  const X0 = sandbox()
  const c1 = X0.commit('c1')
  const got = {}
  await run('  (the ship script of a landing, for the lock scenarios)', [T('PROJ-1')], by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'ship:api#1': (p) => { got.land = p; return { pushed: false, failedStep: 'push' } } }), { args: { ...QUIET, repos: realRepo(X0.W), builtinEnvChecks: false } })
  X0.done()
  const land = scriptOf(got.land)
  ok(/to 480 git -C "\$W" push origin/.test(land) && !/to 900\b/.test(land) && /GRIMOIRE_SHIP_DEADLINE:-540/.test(land), 'L0 · the push is bounded at 480 s, the script at 540 s — both under the ship\'s 12-min hard limit and the Bash tool\'s 600 s')
  ok(got.land.includes("with the Bash tool's timeout at its maximum (600000 ms)"), 'the ship agent is told to give the Bash call its maximum timeout')
  for (const SHELL of SHELLS) {
    console.log(`\n── L1 · [${SHELL}] the ship lock`)
    const X = sandbox()
    X.commit('c0')
    const s = land.split(land.match(/P='([^']+)'/)[1]).join(X.W) // the same script, pointed at this sandbox's checkout…
    const h = (s.match(/checkout -f --detach -q ([0-9a-f]+)/) || [])[1] // …and at its own head
    const mine = X.sh('git rev-parse HEAD', X.W)
    const script = s.split(h).join(mine)
    const LK = join(X.W, '.git', 'grimoire-ship-api.lock')
    const holder = spawn('sleep', ['30'])
    mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `${holder.pid} ${Math.floor(Date.now() / 1000)} ship\n`)
    let r = X.exec(SHELL, script, { GRIMOIRE_SHIP_LOCK_WAIT: '2' })
    ok(/^LOCK busy: held by ship \d+/m.test(r.out) && /^PUSH ok=0 hook=0 step=lock$/m.test(r.out) && /^PR ok=1 url= action=kept$/m.test(r.out), 'a live ship holds the lock: LOCK busy, nothing pushed, no description')
    eq([X.origin(), X.pr.ops(), existsSync(LK)], ['', [], true], 'origin untouched, no PR opened, the holder\'s lock left in place')
    ok(receipt(r.out).lockBusy === true && receipt(r.out).pushed === false, 'the receipt says lockBusy')
    holder.kill()
    await tick(100)
    r = X.exec(SHELL, script, { GRIMOIRE_SHIP_LOCK_WAIT: '2' })
    ok(/^LOCK stale: ship \d+ /m.test(r.out) && /^LOCK ok$/m.test(r.out) && /^PUSH ok=1 /m.test(r.out) && /^PR ok=1 url=\S+ action=created$/m.test(r.out), 'its pid gone: the lock is taken over, the push and the PR go through')
    eq([X.origin(), existsSync(LK)], [mine, false], 'origin at the head; the lock released')
    mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `1 ${Math.floor(Date.now() / 1000)} gate\n`)
    r = X.exec(SHELL, script, { GRIMOIRE_SHIP_LOCK_WAIT: '1' })
    ok(/^LOCK busy: held by gate /m.test(r.out), 'a fresh gate lock: a land ship waits, then moves nothing')
    rmSync(LK, { recursive: true, force: true })
    X.done()
  }
}
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const got = {}
  await run('  (the gate prompt, for its lock)', [T('PROJ-1')], by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'gate:api': (p) => { got.gate = p; return { status: 'DONE', summary: 'green', prUrl: PR_URL } } }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false, deliver: 'end' } })
  const take = (/Before you push, take this repo's SHIP LOCK[\s\S]*?```bash\n([\s\S]*?)\n {2}```/.exec(got.gate) || [])[1] || ''
  const release = (/Release it once the PR is done — or the moment you stop, pass or fail: `([^`]+)`/.exec(got.gate) || [])[1] || ''
  ok(!!take && !!release, 'L2 · the gate prompt carries the lock script and its release')
  for (const SHELL of SHELLS) {
    console.log(`\n── L2 · [${SHELL}] the gate takes the same lock`)
    const LK = join(X.W, '.git', 'grimoire-ship-api.lock')
    const holder = spawn('sleep', ['30'])
    mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `${holder.pid} ${Math.floor(Date.now() / 1000)} ship\n`)
    let r = X.exec(SHELL, take.replace(/^ {2}/gm, ''), { GRIMOIRE_SHIP_LOCK_WAIT: '1' })
    ok(/^LOCK busy/m.test(r.out), 'a live ship holds it: LOCK busy')
    holder.kill()
    await tick(100)
    r = X.exec(SHELL, take.replace(/^ {2}/gm, ''), { GRIMOIRE_SHIP_LOCK_WAIT: '1' })
    ok(/^LOCK ok \//m.test(r.out) && / gate$/.test(readFileSync(join(LK, 'owner'), 'utf8').trim()), 'then LOCK ok: held as `gate`')
    r = X.exec(SHELL, release)
    ok(/LOCK released/.test(r.out) && !existsSync(LK), 'the release removes it')
  }
  X.done()
}
for (const SHELL of SHELLS) {
  const X = sandbox()
  const c1 = X.commit('c1'), c2 = X.commit('c2')
  const outs = {}
  let s2 = ''
  await run(`L3 · [${SHELL}] a ship that starts late (a newer description is on the PR) pushes, but leaves the description alone`, [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'impl:PROJ-2': () => later(impl(c2.slice(0, 7), c1), 30),
      'ship:api#1': (p) => { outs[1] = X.exec(SHELL, scriptOf(p)).out; return receipt(outs[1]) },
      'ship:api#2': (p) => { s2 = p; return { pushed: true, remoteHead: c2.slice(0, 7), prUrl: 'https://github.com/x/y/pull/9', draft: true } } }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  const ses = (/SES='([^']*)'; GEN=(\d+)/.exec(scriptOf(s2)) || [])
  const newer = `newer body\n<!-- grimoire:state v1 ${Buffer.from(JSON.stringify({ version: 2, session: ses[1], ship: Number(ses[2]) + 3 })).toString('base64')} -->\n`
  X.pr.set('body', newer)
  const r = X.exec(SHELL, scriptOf(s2)).out
  ok(/^PUSH ok=1 /m.test(r) && /^PR ok=1 url=\S+ action=newer$/m.test(r), 'pushed (fast-forward), PR action=newer')
  eq([X.pr.body(), X.origin()], [newer, c2], 'the newer description kept; origin at c2')
  X.done()
}
for (const SHELL of SHELLS) {
  const X = sandbox()
  const c1 = X.commit('c1')
  mkdirSync(join(X.T0, 'hooks'))
  writeFileSync(join(X.T0, 'hooks', 'pre-push'), '#!/bin/sh\nsleep 30\nexit 0\n')
  chmodSync(join(X.T0, 'hooks', 'pre-push'), 0o755)
  X.sh(`git config core.hooksPath ${JSON.stringify(join(X.T0, 'hooks'))}`, X.W)
  let out = '', ms = 0
  await run(`L4 · [${SHELL}] a pre-push hook that hangs: the script stops at its own deadline, the hook killed with the push`, [T('PROJ-1')],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'ship:api#1': (p) => { const r = X.exec(SHELL, scriptOf(p), { GRIMOIRE_SHIP_DEADLINE: '4' }); out = r.out; ms = r.ms; return receipt(out) } }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  ok(ms < 15000 && /^PUSH ok=0 hook=0 exit=142$/m.test(out), `returned in ${ms} ms with PUSH ok=0 exit=142`)
  ok(/^PR ok=1 url= action=kept$/m.test(out), 'and opened no PR for what it could not push')
  X.done()
}

// ══════════════ W · the ship worktree is reset and cleaned before each ship ══════════════
for (const SHELL of SHELLS) {
  const X = sandbox()
  X.sh('echo one > tracked.txt && git add tracked.txt && git commit -q -m c1', X.W)
  const c1 = X.sh('git rev-parse HEAD', X.W)
  X.sh('echo two > tracked.txt && git commit -q -am c2', X.W)
  const c2 = X.sh('git rev-parse HEAD', X.W)
  mkdirSync(join(X.T0, 'hooks'))
  writeFileSync(join(X.T0, 'hooks', 'pre-push'), '#!/bin/sh\necho edited-by-hook >> tracked.txt\ntouch hook-droppings\nexit 0\n')
  chmodSync(join(X.T0, 'hooks', 'pre-push'), 0o755)
  X.sh(`git config core.hooksPath ${JSON.stringify(join(X.T0, 'hooks'))}`, X.W)
  const outs = {}
  await run(`W1 · [${SHELL}] a pre-push hook edits a tracked file in the ship worktree: the next ship still checks out and pushes`, [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'impl:PROJ-2': () => later(impl(c2.slice(0, 7), c1), 30), 'ship:api#1': (p) => { outs[1] = X.exec(SHELL, scriptOf(p)).out; return receipt(outs[1]) }, 'ship:api#2': (p) => { outs[2] = X.exec(SHELL, scriptOf(p)).out; return receipt(outs[2]) } }),
    { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  ok(/^PUSH ok=1 /m.test(outs[1]) && /^PUSH ok=1 /m.test(outs[2]), 'both ships pushed')
  eq([X.origin(), existsSync(join(X.W, '.worktrees', 'ship-api', 'hook-droppings'))], [c2, true], 'origin at c2 (the hook ran again on the second push, after the worktree was cleaned)')
  X.done()
}

// ══════════════ K · the run branch key ══════════════
{
  console.log('\n── K1 · projectKey: a bare ABC-123 counts only as the whole text, its start, or in brackets — never a standard\'s prefix')
  const a = body.indexOf('const fnv1a'), b = body.indexOf('const PROJECT_KEY')
  const { projectKey, keyToken } = new Function(`${body.slice(a, b)}\nreturn { projectKey, keyToken }`)()
  const cases = [
    ['PROJ-700', 'PROJ-700', 'proj-700'],
    ['PROJ-700 Points: earn and show points', 'PROJ-700', 'proj-700'],
    ['Migrate to UTF-8 and ISO-8601 dates (PROJ-12)', 'PROJ-12', 'proj-12'],
    ['[ENG-42] Billing', 'ENG-42', 'eng-42'],
    ['UTF-8 cleanup [ENG-4]', 'ENG-4', 'eng-4'],
    ['Add SHA-256 support to the signer', 'Add SHA-256 support to the signer', 'add-sha-256-support-to-the-signer'],
    ['Rollout of HTTP-2 for ACME-5', 'Rollout of HTTP-2 for ACME-5', 'rollout-of-http-2-for-acme-5'],
    ['UTF-8 migration', 'UTF-8 migration', 'utf-8-migration'],
    ['CVE-2024-1234 fix', 'CVE-2024-1234 fix', 'cve-2024-1234-fix'],
    ['acme/site#3 — GitHub parent issue #3, its slices are …', 'acme/site#3', 'acme-site-3'],
    ['Fix bug #123 in repo (see PR #4)', '#123', 'issue-123'],
    ['Q3 billing rework — see https://github.com/acme/site/issues/44', 'acme/site#44', 'acme-site-44'],
    ['https://linear.app/acme/issue/ENG-123/foo', 'ENG-123', 'eng-123'],
    ['https://acme.atlassian.net/browse/PROJ-12', 'PROJ-12', 'proj-12'],
  ]
  for (const [text, key, token] of cases) eq([projectKey(text), keyToken(text)], [key, token], JSON.stringify(text))
}
{
  const IDX = [{ name: 'idealex', path: '.', agent: 'idealex-engineer', tags: ['web'], gate: null }]
  const W = (t) => ({ ...t, repo: 'idealex', agent: 'idealex-engineer' })
  const two = [W(T('PROJ-1')), W(T('PROJ-2', { dependsOn: ['PROJ-1'] }))]
  const A = 'Migrate to UTF-8 and ISO-8601 dates'
  const s1 = await run('K2 · session 1, "Migrate to UTF-8 and ISO-8601 dates": PROJ-1 lands, PROJ-2 blocks, halt', two,
    by({ 'impl:PROJ-1': impl('aaaaaaa'), 'impl:PROJ-2': BLOCKED, 'replan#1': { decision: 'HALT', reason: 'x', learnings: [] } }), { args: { ...QUIET, repos: IDX, project: A, builtinEnvChecks: false } })
  const marker = (heredocs(s1.prompt('ship:idealex#halt'))[0] || '').split('\n').find((l) => l.startsWith('<!-- grimoire:state ')) || ''
  ok(s1.prompt('ship:idealex#halt').includes('feat/migrate-to-utf-8-and-iso-8601-dates-idealex'), 'its run branch is the slugged text, not `utf-8`')
  const index = { prState: [{ repo: 'idealex', url: PR_URL, state: 'OPEN', isDraft: true, ...copied(marker) }], reconcile: [{ id: 'PROJ-1', repo: 'idealex', sha: 'aaaaaaa', onBranch: true, inBase: 'no' }], runBranches: [{ repo: 'idealex', local: 'aaaaaaa', remote: 'aaaaaaa', sync: 'same', fetch: 'ok' }] }
  const other = await run('K2 · another project that mentions UTF-8 ("Add UTF-8 to the CSV export") does not take that state', two, happy, { args: { ...QUIET, repos: IDX, project: 'Add UTF-8 to the CSV export', builtinEnvChecks: false }, index })
  ok(other.labels.includes('impl:PROJ-1') && other.logs.some((l) => /for another project, repo or run branch — ignored/.test(l)), 'ignored: PROJ-1 is built again')
}

// ══════════════ E · the environment checks ══════════════
{
  const X = sandbox()
  X.sh('git push -q origin HEAD 2>/dev/null', X.W)
  const checks = [{ name: 'slow1', run: 'sleep 2', timeoutSec: 5 }, { name: 'slow2', run: 'sleep 2', timeoutSec: 5 }, { name: 'slow3', run: 'sleep 2', timeoutSec: 5 }, { name: 'hangs', run: 'sleep 20', timeoutSec: 30 }]
  const { prompt } = await run('  (the index prompt for the environment script)', [T('PROJ-1')], happy,
    { args: { ...QUIET, repos: realRepo(X.W), environmentChecks: checks }, index: { inputProblems: ['stop after the index'] } })
  const s = (/## Also CHECK the environment[\s\S]*?```bash\n([\s\S]*?)\n```/.exec(prompt('parse-index')) || [])[1] || ''
  ok(s.includes('worktree add --detach --no-checkout -q "$T" HEAD'), 'E1 · the commit probe adds its scratch worktree without a checkout')
  for (const SHELL of SHELLS) {
    console.log(`\n── E1 · [${SHELL}] the checks run in parallel, under one deadline`)
    const r = X.exec(SHELL, s, { GRIMOIRE_ENV_DEADLINE: '6' })
    const exits = Object.fromEntries([...r.out.matchAll(/^CHECK (\S+) EXIT (\d+)$/gm)].map((m) => [m[1], Number(m[2])]))
    eq([exits['commit:api'], exits['remote:api'], exits.slow1, exits.slow2, exits.slow3, exits.hangs], [0, 0, 0, 0, 0, 142], 'commit and remote answer, three 2-s checks pass, the hanging one is stopped at the deadline (142)')
    ok(r.ms < 12000, `in ${r.ms} ms: about the deadline, not the sum of the checks`)
    eq(X.sh(`git worktree list --porcelain | grep -c '^worktree '`, X.W), '1', 'the probe\'s scratch worktree is gone')
  }
  X.done()
}
{
  const { result, labels, logs } = await run('E2 · a failed check is re-checked once: the re-check passes → a transient failure, the run goes on', [T('PROJ-1'), T('PROJ-2'), T('PROJ-3', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-1': () => later(impl('aaaaaaa'), 400), 'impl:PROJ-2': () => later(impl('bbbbbbb'), 600), 'integrate:PROJ-1': { status: 'MERGED', headSha: '1111111' }, 'integrate:PROJ-2': { status: 'MERGED', headSha: '2222222' },
      'env:stall#1': (p) => envReport(p, { 'commit:api': 142 }) }), { args: { ...QUIET, maxPerRepo: 2, agentTimeoutMin: 0.002, agentHardTimeoutMin: 0 } })
  ok(labels.includes('env:recheck#1') && labels.indexOf('env:recheck#1') > labels.indexOf('env:stall#1'), 'env:stall#1 failed, env:recheck#1 ran')
  ok(!result.halt && result.done.map((d) => d.id).sort().join() === 'PROJ-1,PROJ-2,PROJ-3', 'no halt: all three land')
  eq([result.environment.failures, result.environment.transient], [[], [{ name: 'commit:api', exit: 142 }]], 'environment: no failure, one transient')
  ok(logs.some((l) => /commit:api answered on the re-check — a transient failure, the run goes on/.test(l)), 'logged')
}
{
  const { result, labels } = await run('E3 · the re-check fails too → the halt latches; a later green check before the run stops lifts it, and the replan runs', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-1': () => later(BLOCKED, 300), 'env:stall#1': (p) => envReport(p, { 'remote:api': 142 }), 'env:recheck#1': (p) => envReport(p, { 'remote:api': 142 }), 'replan#1': { decision: 'HALT', reason: 'PROJ-1 needs a product decision', learnings: [] } }),
    { args: { ...QUIET, agentTimeoutMin: 0.001, agentHardTimeoutMin: 0 } })
  ok(labels.includes('env:recheck#1') && labels.includes('env:stall#2') && labels.includes('replan#1'), 'stall#1 and its re-check failed; PROJ-1 → BLOCKED asked for stall#2, which passed; then the replan')
  ok(result.halt && result.halt.reason === 'PROJ-1 needs a product decision' && result.halt.kind !== 'environment', `the halt is the replan's, not the environment's (${result.halt && result.halt.reason})`)
}

// ══════════════ G · a terminal slot that ends badly after the halt ship skipped it ══════════════
{
  const r = await run('G1 · the gate wedges, the run halts (wedged), the gate then returns BLOCKED → its halt ship runs then', [T('PROJ-1')],
    by({ 'gate:api': () => later({ status: 'BLOCKED', summary: 'tests failed', failedStep: 'gate' }, 500) }), { args: { ...QUIET, builtinEnvChecks: false, agentTimeoutMin: 0.001, agentHardTimeoutMin: 0.004 }, linger: 900 })
  eq(r.result.halt && r.result.halt.kind, 'wedged', 'the run halted: the gate is still running')
  ok(r.labels.includes('ship:api#halt') && r.labels.indexOf('ship:api#halt') > r.labels.indexOf('gate:api'), 'after the gate returned, the halt ship ran')
  const [hb = '', hc = ''] = heredocs(r.prompt('ship:api#halt'))
  ok(hb.includes("⏸ **Halted:** api's terminal slot, still running when the run stopped, ended GATE_FAILED: tests failed") && hc.includes('## ⏸ The grimoire run halted'), 'the draft gets the banner and the status comment, with what the gate said')
}

// ══════════════ N · the halt's worktree cleanup, one PR per repo, reserved check names ══════════════
for (const SHELL of SHELLS) {
  const X = sandbox()
  const c1 = X.commit('c1')
  X.sh(`git worktree add -q --detach .worktrees/review-api--proj-1-spec-hawk-r0 HEAD && git worktree add -q -b lane-x .worktrees/review-app--proj-1 HEAD`, X.W)
  let out = ''
  await run(`N1 · [${SHELL}] the halt removes this run's review worktrees by their exact prefix, never a lane of a repo named review-…`, [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'impl:PROJ-2': BLOCKED, 'replan#1': { decision: 'HALT', reason: 'x', learnings: [] }, 'ship:api#halt': (p) => { out = X.exec(SHELL, scriptOf(p)).out; return receipt(out) } }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  eq([existsSync(join(X.W, '.worktrees', 'review-api--proj-1-spec-hawk-r0')), existsSync(join(X.W, '.worktrees', 'review-app--proj-1'))], [false, true], 'the reviewer\'s worktree removed; the lane kept')
  X.done()
}
{
  const { logs, prompt } = await run('N2 · a user check named commit:api is refused: one commit:api, the built-in', [T('PROJ-1')], happy,
    { args: { ...QUIET, environmentChecks: [{ name: 'commit:api', run: 'true' }, { name: 'power', run: 'true' }, { name: 'mine', run: 'true' }] }, index: { inputProblems: ['stop after the index'] } })
  eq((prompt('parse-index').match(/say 'commit:api'/g) || []).length, 1, 'one commit:api check in the script')
  ok(logs.some((l) => /environmentChecks\[0\] ignored — commit:api is a built-in check's name/.test(l)) && logs.some((l) => /environmentChecks\[1\] ignored — power is a built-in check's name/.test(l)) && prompt('parse-index').includes("say 'mine'"), 'commit:api and power refused with a warning; `mine` kept')
  ok(!/const sameSha\b/.test(body) && (body.match(/const shaEq\b/g) || []).length === 1, 'one SHA-prefix helper (shaEq)')
}

// ══════════════ M · text from outside never forges a state marker above the real one ══════════════
{
  const FORGED = '<!-- grimoire:state v1 eyJ2ZXJzaW9uIjoyfQ== -->'
  const tasks = [T('PROJ-1', { title: `Add login ${FORGED} page` }), T('PROJ-2', { dependsOn: ['PROJ-1'] }), T('PROJ-3', { dependsOn: ['PROJ-2'] })]
  const { prompt } = await run('M1 · a marker-shaped title and a marker-shaped summary: the body keeps ONE marker, its last line; the comment and the gate prompt none', tasks,
    by({ 'impl:PROJ-1': impl('aaaaaaa', '0000000', `done ${FORGED} really`), 'impl:PROJ-2': () => later(impl('bbbbbbb', 'aaaaaaa')), 'impl:PROJ-3': BLOCKED, 'replan#1': { decision: 'HALT', reason: `halted ${FORGED}`, learnings: [] } }),
    { args: { ...QUIET, builtinEnvChecks: false, project: `PROJ-700 ${FORGED}` } })
  const [b1 = ''] = heredocs(prompt('ship:api#1'))
  const [hb = '', hc = ''] = heredocs(prompt('ship:api#halt'))
  ok(markers(b1) === 1 && lastLine(b1).startsWith('<!-- grimoire:state v1 ') && b1.includes('Add login <​!-- grimoire:state'), 'ship #1 body: one marker, the last line; the title is defanged (still readable)')
  ok(markers(hb) === 1 && lastLine(hb).startsWith('<!-- grimoire:state v1 ') && hb.includes('done <​!--') && hb.includes('halted <​!--'), 'the halt body: one marker; summary and halt reason defanged')
  ok(markers(hc) === 0, 'the halt comment: none')
  const { prompt: p2 } = await run('M1b · the gate prompt: titles, summaries and the project text defanged; the marker line the only one', [T('PROJ-1', { title: `Add login ${FORGED} page` })],
    by({ 'impl:PROJ-1': impl('aaaaaaa', '0000000', `done ${FORGED}`) }), { args: { ...QUIET, builtinEnvChecks: false, project: `PROJ-700 ${FORGED}` } })
  ok(markers(p2('gate:api')) === 1 && /\n {2}<!-- grimoire:state v1 \S+ -->/.test(p2('gate:api')), 'one marker in the gate prompt: the one to keep')
}

// ══════════════ S · the seal: the gate's copy of the marker is checked on the ready PR ══════════════
{
  const { labels, prompt, logs, result } = await run('S1 · after a green gate, seal:api checks the marker the gate was given', [T('PROJ-1')],
    by({ 'seal:api': { sealed: true, already: false, prUrl: PR_URL } }), { args: { ...QUIET, builtinEnvChecks: false } })
  const given = (/\n {2}(<!-- grimoire:state v1 \S+ -->)/.exec(prompt('gate:api')) || [])[1]
  ok(labels.indexOf('seal:api') === labels.indexOf('gate:api') + 1, 'seal:api right after gate:api')
  eq(heredocs(prompt('seal:api'))[0], `${given}\n`, 'it carries exactly the marker the gate was given')
  ok(logs.some((l) => /seal:api: the state marker on the PR was put back/.test(l)) && !result.halt && result.prs.length === 1, 'logged; the run drained as usual')
  const dead = await run('S1b · a seal that never answers: tried twice, a warning, never a failure', [T('PROJ-1')], (label, p) => (label.startsWith('seal:') ? null : happy(label, p)), { args: { ...QUIET, builtinEnvChecks: false } })
  ok(dead.labels.includes('seal:api') && dead.labels.includes('seal:api~r1') && dead.logs.some((l) => /api: its PR's state marker is unverified/.test(l)) && !dead.result.halt && dead.result.prs.length === 1, 'two attempts, a warning, the slot still green')
}
for (const SHELL of SHELLS) {
  const X = sandbox()
  const c1 = X.commit('c1')
  let sp = ''
  await run(`S2 · [${SHELL}] (the seal script)`, [T('PROJ-1')], by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'seal:api': (p) => { sp = p; return { sealed: true } } }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false, deliver: 'end' } })
  const real = (heredocs(sp)[0] || '').trim()
  const mangled = real.replace(/v1 (.)/, (m, ch) => `v1 ${ch === 'A' ? 'B' : 'A'}`)
  const prose = 'Closes #1\n\nWhat changes: everything.\n'
  X.pr.set('url', 'https://github.com/x/y/pull/9'); X.pr.set('draft', 'false'); X.pr.set('body', `${prose}\n${mangled}\n`)
  let out = X.exec(SHELL, scriptOf(sp)).out
  ok(/^SEAL ok=1 url=\S+ edited=1$/m.test(out), 'a mangled copy: SEAL ok=1 edited=1')
  eq([X.pr.body(), X.pr.draft()], [`${prose}\n${real}\n`, 'false'], 'the prose untouched, the mangled line replaced by the real marker; the PR still ready')
  out = X.exec(SHELL, scriptOf(sp)).out
  ok(/^SEAL ok=1 url=\S+ already=1$/m.test(out) && X.pr.ops().filter((o) => o === 'edit').length === 1, 'run again: already=1, no second edit')
  X.done()
}
{
  console.log('\n── B · the briefs')
  const sb = readFileSync(`${DIR}/briefs/ship.md`, 'utf8')
  const gb = readFileSync(`${DIR}/briefs/gate.md`, 'utf8')
  ok(/`ready`: a `READY` line → true/.test(sb) && /`lockBusy`: a `LOCK busy` line → true/.test(sb) && /Mode seal/.test(sb) && /600000 ms/.test(sb), 'ship.md maps READY, LOCK busy and the seal, and asks for the maximum Bash timeout')
  ok(/ship lock/.test(gb) && /already READY/.test(gb) && /puts it back if your\s+copy differs/.test(gb), 'gate.md: the ship lock, the PR already ready, the marker check')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
