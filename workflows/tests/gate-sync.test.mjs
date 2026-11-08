// ════════════════════════════════════════════════════════════════════════════
//  The gate's delta SYNC as a scripted step with a receipt (#99) — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/gate-sync.test.mjs
//
//  #97 commits the design's delta on the run branch from the ship worktree, so the orchestrating
//  checkout's run branch never gets those commits during the run. The gate used to bring them back
//  with a SYNC script its agent was told to run; skipped, its push was refused late, and the engine
//  never saw the outcome. Now the terminal slot runs it itself, between the last ship and the gate:
//  `sync:<repo>`, a cheap model running one fixed script, every git step capped (`to 60`), no lock
//  (nothing else writes the repository then). The engine parses its receipt and journals it:
//    SYNC ok mode=ff|merge head=<sha> · SYNC none · SYNC bad step=fetch|merge|branch|other
//  The gate prompt carries no SYNC step; on SYNC bad (or no receipt), the gate runs without its push,
//  lock or PR, and the slot ends SHIP_FAILED with the receipt's reason: never a refused push.
//    S1  ff: the checkout's run branch is behind the remote by the delta commit alone
//    S2  merge: a sweep commit on the checkout, the delta commit on the remote
//    S3  none: nothing kept, nothing to bring; S3b deliver: 'end', no remote branch yet (remote=0)
//    S4  bad step=merge: a conflict outside the delta's path, the merge abandoned, the worktree clean;
//        S4b the checkout's uncommitted delta, committed first, put back as it was when the merge fails
//    S5  bad step=fetch: the remote cannot be read; tried twice, then the gate runs without its push
//    S6  a skipped SYNC (no receipt, a garbled one): no gate push; with no gate command, no gate at all
//    S7  the script: every git step that can wait (the remote, a hook) is capped with `to 60`
//  Every script runs for real against a git sandbox (support/script-harness.mjs).
import { run, by, T, impl, QUIET, sandbox, scriptOf, realRepo, receipt, PR_URL, RUN_BRANCH, readFileSync, writeFileSync, mkdirSync, join } from './support/script-harness.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : `\n       want: ${JSON.stringify(b)}\n       got:  ${JSON.stringify(a)}`}`)

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const REL = 'docs/specs/x.delta.json'
const plan = (id, target, why) => ({ id, op: 'add', target, after: { type: 'TEXT', nullable: true }, why, slice: 1, origin: 'planned' })
const DELTA = { schema: 1, spec: 'docs/specs/x.md', data: [plan('isbn', 'api:db/books.isbn', 'search by isbn'), plan('due', 'api:db/books.due', 'loans come back by a date')], architecture: [] }
const deltaInRepo = (X, { commit = true } = {}) => {
  mkdirSync(join(X.W, 'docs/specs'), { recursive: true })
  writeFileSync(join(X.W, REL), JSON.stringify(DELTA, null, 2) + '\n')
  if (commit) X.sh(`git add -- ${REL} && git commit -q -m 'docs: the design delta'`, X.W)
}
const keptAs = (n) => ({ target: `api:db/books.k${n}`, op: 'add', kept: true, reason: `task ${n} needs it`, after: { type: 'TEXT', nullable: true } })
// the delta in the repository (`<root>/work/docs/specs/x.delta.json`), a journal that keeps its events
const inRepo = (X, extra = {}) => ({ ...QUIET, pluginRoot: REPO, builtinEnvChecks: false, root: X.T0, specPath: 'work/docs/specs/x.md', repos: realRepo(X.W), runId: 'run-99', telemetry: { flushEvery: 100 }, ...extra })
const og = (X, cmd) => X.sh(`git --git-dir=origin.git ${cmd}`)
// what `git status` says, the ship worktrees' folder aside (it sits in the checkout, untracked, in the sandbox)
const status = (X) => X.sh("git status --porcelain | grep -v '^?? .worktrees/$' || true", X.W)
const local = (X) => X.sh(`git rev-parse refs/heads/${RUN_BRANCH}`, X.W)
const blocksOf = (p) => [...p.matchAll(/```bash\n([\s\S]*?)\n[ \t]*```/g)].map((m) => m[1])
const unplannedIn = (text) => JSON.parse(text).data.filter((c) => c.origin === 'unplanned').map((c) => c.target)
// the ship's receipt (the real script's lines), as the ship brief maps them
const deltaOf = (out) => {
  const m = /^DELTA (ok|none|bad|skipped)(?: added=(\d+) already=(\d+) refused=(\d+))?(?: commit=([0-9a-f]+))?/m.exec(out)
  return m ? { delta: m[1], deltaAdded: +(m[2] || 0), deltaAlready: +(m[3] || 0), deltaRefused: +(m[4] || 0), deltaCommit: m[5] || '' } : {}
}
const shipFor = (X) => (p) => { const r = X.exec('bash', scriptOf(p)); return { ...receipt(r.out), ...deltaOf(r.out) } }
// the SYNC's receipt, as the ship brief's mode sync maps it: the SYNC line verbatim, the lines under it
const syncReceipt = (out) => {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => /^SYNC /.test(l))
  return i < 0 ? { line: '' } : { line: lines[i], detail: lines.slice(i + 1).filter((l) => l.trim()).join('\n') }
}
// runs the SYNC script for real (after `before`, a test's own move on the checkout); keeps what it printed
const syncFor = (X, seen, before = () => {}) => (p) => { before(); seen.prompts = (seen.prompts || []).concat(p); const out = X.exec('bash', scriptOf(p)).out; seen.out = (seen.out || []).concat(out); return syncReceipt(out) }
// the gate, for real: the lock, the push and the release its prompt gives, whichever it gives
const gateFor = (X, seen) => (p) => {
  seen.prompt = p
  const pick = (s) => blocksOf(p).find((b) => b.includes(s))
  const [take, push, rel] = [pick('shiplock gate'), pick('push -u origin'), pick('lkrel')]
  if (take) seen.take = X.exec('bash', take).out
  if (push) seen.push = X.exec('bash', push).out
  if (rel) X.exec('bash', rel)
  return { status: 'DONE', summary: 'green', prUrl: push ? PR_URL : '' }
}
// the journal's events, as its writer received them (each seq once: a chunk sent again is not counted twice)
const journal = (events) => (label, p) => {
  if (!label.startsWith('journal#')) return undefined
  const m = /<<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/.exec(p)
  const chunk = m ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8') : ''
  const lines = chunk.trim().split('\n').filter(Boolean)
  for (const l of lines) { try { const e = JSON.parse(l); if (e && e.type && !events.some((x) => x.seq === e.seq)) events.push(e) } catch {} }
  return { runDir: '.grimoire/runs/run-99', lines: lines.length, bytes: Buffer.byteLength(chunk, 'utf8') }
}
const withJournal = (events, map) => (label, p, o, calls) => journal(events)(label, p) ?? by(map)(label, p, o, calls)
const syncEvents = (events) => events.filter((e) => e.type === 'sync').map(({ seq, tok, at, attempt, type, ...rest }) => rest)
const shipFailed = (logs) => logs.some((l) => /^⛔ api: reviewed and certified, but the gate's push was skipped: /.test(l)) // SHIP_FAILED, as settle logs it
const before = (labels, a, b) => labels.indexOf(a) >= 0 && labels.indexOf(a) < labels.indexOf(b)

// ══════════════ S1 · ff: the remote is ahead by the delta commit alone ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const events = [], sync = {}, gate = {}
  const { result, logs, labels, prompt } = await run('S1 · one kept change: the ship commits it on the remote; the SYNC fast-forwards the checkout', [T('PROJ-1')], withJournal(events, {
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X),
    'sync:api': syncFor(X, sync),
    'gate:api': gateFor(X, gate),
  }), { args: inRepo(X), index: { deltaFound: true } })
  const d1 = X.origin()
  ok(og(X, `rev-list --parents -n 1 ${d1}`).split(' ')[1] === c1 && og(X, `diff --name-only ${c1} ${d1}`) === REL, '(the ship committed the delta on the remote, on the landed head the checkout\'s run branch was at)')
  eq([sync.out && sync.out[0].trim(), local(X), unplannedIn(readFileSync(join(X.W, REL), 'utf8')), status(X)],
    [`SYNC ok mode=ff head=${d1}`, d1, ['api:db/books.k1'], ''], "SYNC ok mode=ff: the checkout's run branch fast-forwarded to the remote's delta commit, its delta holds the unplanned change, the tree clean")
  ok(before(labels, 'ship:api#1', 'sync:api') && before(labels, 'sync:api', 'gate:api') && labels.filter((l) => l.startsWith('sync:')).length === 1, 'its own dispatch, after the last ship and before the gate, once')
  const sp = prompt('sync:api')
  ok(sp.includes('Mode: **sync**') && sp.includes('briefs/ship.md') && !/shiplock|LOCK_|\. "\$LKF"/.test(scriptOf(sp)), 'a mode of the ship brief, one script, no lock')
  const gp = prompt('gate:api')
  ok(!/SYNC/.test(gp) && !/\bmerge (-q|--no-ff|--ff-only)/.test(gp) && !/ls-remote|fetch -q/.test(gp), 'the gate prompt has no SYNC step: no merge, no fetch')
  ok(/^LOCK ok/m.test(gate.take || '') && /^PUSH exit=0$/m.test(gate.push || '') && X.origin() === d1, "the gate's push is a fast-forward (nothing new: the remote already holds that head)")
  ok(!result.ungatedRepos.includes('api') && logs.some((l) => /^   · api: terminal slot green/.test(l)), 'the slot is green')
  eq(syncEvents(events), [{ repo: 'api', label: 'sync:api', status: 'ok', mode: 'ff', step: null, head: d1.slice(0, 7), reason: null, detail: '', round: 1, then: 'gate' }], 'the journal keeps the receipt: ok, mode ff, the head')
  ok(logs.some((l) => l === `◎ sync:api: SYNC ok mode=ff — ${RUN_BRANCH} holds the remote's delta commits now (a fast-forward, at ${d1.slice(0, 7)}): the gate certifies and pushes that tree`), 'the run log says it')
  // run again: nothing to bring
  ok(X.exec('bash', scriptOf(sp)).out.trim() === 'SYNC none', 'run again: SYNC none')
  X.done()
}

// ══════════════ S2 · merge: a sweep commit here, the delta commit there ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const events = [], sync = {}, gate = {}
  let s = ''
  const { result, prompt } = await run('S2 · the terminal sweep committed a fix: the SYNC merges the remote\'s delta commit', [T('PROJ-1')], withJournal(events, {
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X),
    'sync:api': syncFor(X, sync, () => { s = X.commit('sweep') }),
    'gate:api': gateFor(X, gate),
  }), { args: inRepo(X), index: { deltaFound: true } })
  const head = local(X)
  const d1 = og(X, `rev-parse ${head}^2`)
  eq([sync.out[0].trim(), X.sh(`git rev-list --parents -n 1 ${head}`, X.W).split(' ').slice(1), X.sh(`git diff --name-only ${s} ${head}`, X.W), X.sh(`git log -1 --format=%s ${head}`, X.W), X.sh(`git log -1 --format='%(trailers:key=Grimoire-Run,valueonly)' ${head}`, X.W)],
    [`SYNC ok mode=merge head=${head}`, [s, d1], REL, `chore(data): bring the unplanned changes recorded in ${REL} into the run branch`, 'run-99'],
    "SYNC ok mode=merge: the sweep's head and the remote's delta commit, merged; the merge changes only the delta; its subject and the run's trailer")
  ok(/^PUSH exit=0$/m.test(gate.push || '') && X.origin() === head && !result.ungatedRepos.includes('api'), "the gate's push is a fast-forward of the remote: it holds the swept head and the entry")
  eq(syncEvents(events).map((e) => [e.status, e.mode, e.head]), [['ok', 'merge', head.slice(0, 7)]], 'the journal keeps the receipt: ok, mode merge')
  ok(!/SYNC/.test(prompt('gate:api')), 'the gate prompt has no SYNC step')
  X.done()
}

// ══════════════ S3 · none: nothing kept, nothing to bring ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const events = [], sync = {}, gate = {}
  const { result, logs } = await run('S3 · nothing kept: SYNC none', [T('PROJ-1')], withJournal(events, {
    'impl:PROJ-1': impl(c1.slice(0, 7)),
    'ship:api#1': shipFor(X),
    'sync:api': syncFor(X, sync),
    'gate:api': gateFor(X, gate),
  }), { args: inRepo(X), index: { deltaFound: true } })
  eq([sync.out[0].trim(), local(X), X.origin()], ['SYNC none', c1, c1], 'SYNC none: the remote holds nothing the checkout lacks; nothing moves')
  ok(/^PUSH exit=0$/m.test(gate.push || '') && !result.ungatedRepos.includes('api'), 'the gate pushes as before')
  eq(syncEvents(events).map((e) => [e.status, e.then]), [['none', 'gate']], 'the journal keeps it')
  ok(logs.includes('◎ sync:api: SYNC none — nothing to bring'), 'the run log says it')
  X.done()
}
// ══════════════ S3b · deliver: 'end': no remote run branch yet ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const events = [], sync = {}, gate = {}
  const { result, labels } = await run("S3b · deliver: 'end': the run branch is not on the remote yet", [T('PROJ-1')], withJournal(events, {
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'sync:api': syncFor(X, sync),
    'gate:api': gateFor(X, gate),
  }), { args: inRepo(X, { deliver: 'end' }), index: { deltaFound: true } })
  eq([sync.out[0].trim(), labels.some((l) => l.startsWith('ship:'))], ['SYNC none remote=0', false], 'SYNC none remote=0: no ship ran, the remote has no run branch')
  ok(/^PUSH exit=0$/m.test(gate.push || '') && X.origin() === c1 && !result.ungatedRepos.includes('api'), 'the gate pushes the run branch')
  eq(syncEvents(events).map((e) => [e.status, e.then]), [['none', 'gate']], 'journaled as none')
  X.done()
}

// ══════════════ S4 · bad step=merge: a conflict outside the delta's path ══════════════
// The checkout's branch moved the delta to another path and edited it there (an acknowledgement next
// to where a ship appends); the remote appended to it at its old path. The remote holds the delta alone,
// so the merge is tried; it stops at the moved file, outside the delta's path, a conflict the loop never
// resolves: abandoned, the worktree as it was.
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const MOVED = 'docs/specs/x.delta.moved.json'
  const { setAcks, changeHash } = await import('../../tools/graph/lib/data/delta.mjs')
  const events = [], sync = {}, gate = {}
  let h0 = ''
  const move = () => {
    X.sh(`git mv ${REL} ${MOVED}`, X.W)
    writeFileSync(join(X.W, MOVED), setAcks(readFileSync(join(X.W, MOVED), 'utf8'), [[1, { by: 'owner', at: '2026-11-08T10:00:00Z', hash: changeHash(DELTA.data[1]) }]]))
    X.sh(`git commit -q -am 'docs: move the delta'`, X.W)
    h0 = local(X)
  }
  const { result, logs, labels, prompt } = await run('S4 · the merge stops outside the delta: SYNC bad step=merge, the push skipped', [T('PROJ-1')], withJournal(events, {
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X),
    'sync:api': syncFor(X, sync, move),
    'gate:api': gateFor(X, gate),
  }), { args: inRepo(X, { repos: realRepo(X.W, { gate: { run: 'true' } }) }), index: { deltaFound: true } })
  const d1 = X.origin()
  const line = sync.out[0].split('\n')[0]
  ok(/^SYNC bad step=merge\b/.test(line), `SYNC bad step=merge (${line})`)
  // git's own lines, in whatever language git speaks here: they name the moved file, never the delta's path
  const gitLines = (out) => out.split('\n').slice(1).filter((l) => l.trim())
  ok(gitLines(sync.out[0]).some((l) => l.endsWith(` ${MOVED}`)) && !gitLines(sync.out[0]).some((l) => l.endsWith(` ${REL}`)), "git's own lines under it: the conflict is at the moved file, not at the delta's path")
  ok(((syncEvents(events)[0] || {}).detail || '').includes(MOVED), '… and the journal keeps them')
  eq([local(X), status(X), X.sh('git rev-parse -q --verify MERGE_HEAD || echo none', X.W)], [h0, '', 'none'], 'the merge is abandoned: the branch where it was, the worktree clean, no merge in progress')
  ok(labels.filter((l) => l.startsWith('sync:')).length === 1, 'not tried again: a conflict does not go away')
  const gp = prompt('gate:api')
  ok(/no push/i.test(gp) && gp.includes('SYNC bad step=merge') && !blocksOf(gp).some((b) => /push -u origin|shiplock gate|lkrel/.test(b)) && !/gh pr (ready|edit|create)/.test(gp), 'the gate runs its command without its push: no lock, no push, no PR step, the receipt named')
  ok(gate.push === undefined && X.origin() === d1, 'no push was tried: the remote holds what the ship pushed')
  ok(shipFailed(logs) && result.ungatedRepos.includes('api') && /SYNC bad step=merge/.test(result.ungatedReasons.api || '') && /push/.test(result.ungatedReasons.api || ''), `the slot ends SHIP_FAILED, the reason the receipt's (${result.ungatedReasons.api})`)
  ok(!labels.includes('seal:api') && !labels.some((l) => l.startsWith('replan')), 'no seal, no replan')
  eq(syncEvents(events).map((e) => [e.status, e.step, e.then]), [['bad', 'merge', 'push-skipped']], "the journal keeps the receipt, and that the gate's push is skipped")
  ok(logs.some((l) => /^⚠ sync:api: SYNC bad step=merge.* — the gate runs without its push/.test(l)), 'the run log says it')
  X.done()
}
// ══════════════ S4b · the checkout's uncommitted delta: committed first, put back when the merge fails ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const sync = {}
  const BROKEN = '{ "schema": 1, "data": [ half-written\n'
  const { result } = await run('S4b · an edit of the delta left uncommitted in the checkout, unreadable', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X),
    'sync:api': syncFor(X, sync, () => writeFileSync(join(X.W, REL), BROKEN)),
  }), { args: inRepo(X, { telemetry: { enabled: false } }), index: { deltaFound: true } })
  ok(/^SYNC bad step=merge\b/m.test(sync.out[0]), `SYNC bad step=merge: the two versions cannot be joined (${sync.out[0].split('\n')[0]})`)
  eq([local(X), X.sh(`git status --porcelain -- docs | sed 's/^ /_/'`, X.W), readFileSync(join(X.W, REL), 'utf8'), X.sh('git rev-parse -q --verify MERGE_HEAD || echo none', X.W)], [c1, `_M ${REL}`, BROKEN, 'none'],
    "the commit of the checkout's delta is undone: the branch where it was, the edit uncommitted as it was, no merge in progress")
  ok(result.ungatedRepos.includes('api'), 'the push is skipped')
  X.done()
}

// ══════════════ S5 · bad step=fetch: the remote cannot be read ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const events = [], sync = {}, gate = {}
  const gone = join(X.T0, 'gone.git')
  const { result, logs, labels } = await run('S5 · origin unreachable at the SYNC: tried twice, then the gate runs without its push', [T('PROJ-1')], withJournal(events, {
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X),
    'sync:api': syncFor(X, sync, () => X.sh(`git remote set-url origin ${gone}`, X.W)),
    'sync:api~r1': syncFor(X, sync),
    'gate:api': (p) => { X.sh(`git remote set-url origin ${join(X.T0, 'origin.git')}`, X.W); return gateFor(X, gate)(p) },
  }), { args: inRepo(X, { repos: realRepo(X.W, { gate: { run: 'true' } }) }), index: { deltaFound: true } })
  const d1 = X.origin()
  ok(sync.out.length === 2 && sync.out.every((o) => /^SYNC bad step=fetch\b/m.test(o)), `SYNC bad step=fetch, twice (${(sync.out[0] || '').split('\n')[0]})`)
  ok(before(labels, 'sync:api', 'sync:api~r1') && before(labels, 'sync:api~r1', 'gate:api'), 'a fetch that failed is tried once more, before the gate')
  ok(gate.push === undefined && X.origin() === d1 && local(X) === c1, 'no push was tried; nothing moved')
  ok(/SYNC bad step=fetch/.test(result.ungatedReasons.api || '') && shipFailed(logs), 'SHIP_FAILED, with the receipt as its reason')
  eq(syncEvents(events).map((e) => [e.label, e.status, e.step, e.round, e.then]), [['sync:api', 'bad', 'fetch', 1, 'retry'], ['sync:api~r1', 'bad', 'fetch', 2, 'push-skipped']], 'both receipts journaled')
  ok(logs.some((l) => /^⚠ sync:api: SYNC bad step=fetch.* — trying once more$/.test(l)), 'the run log says it tries again')
  X.done()
}

// ══════════════ S6 · a skipped SYNC: no receipt, never a refused push ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const events = []
  const { result, logs, labels } = await run('S6 · the SYNC agent returns a garbled line, then nothing; no gate command', [T('PROJ-1')], withJournal(events, {
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X),
    'sync:api': { line: 'SYNC ok' }, // no mode, no head: not a receipt
    'sync:api~r1': null,
  }), { args: inRepo(X), index: { deltaFound: true } })
  const d1 = X.origin()
  ok(!labels.includes('gate:api') && X.origin() === d1 && local(X) === c1, 'no gate command and no push to make: the gate is not dispatched; nothing moved')
  ok(/no receipt/.test(result.ungatedReasons.api || '') && shipFailed(logs), `SHIP_FAILED: the SYNC returned no receipt (${result.ungatedReasons.api})`)
  eq(syncEvents(events).map((e) => [e.status, e.round, e.then]), [[null, 1, 'retry'], [null, 2, 'push-skipped']], 'both journaled, with no status')
  ok(logs.some((l) => /^⚠ sync:api~r1: no SYNC receipt — the gate runs without its push/.test(l)), 'the run log says it')

  // with a gate command: the gate runs, with no push, lock or PR step
  const Y = sandbox()
  deltaInRepo(Y)
  const e1 = Y.commit('c1')
  const gate = {}
  const r2 = await run('S6b · no receipt; a gate command', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl(e1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(Y),
    'sync:api': null,
    'sync:api~r1': null,
    'gate:api': gateFor(Y, gate),
  }), { args: inRepo(Y, { repos: realRepo(Y.W, { gate: { run: 'true' } }), telemetry: { enabled: false } }), index: { deltaFound: true } })
  ok(r2.labels.includes('gate:api') && gate.push === undefined && gate.take === undefined && shipFailed(r2.logs), 'the gate runs its command; no lock taken, no push: SHIP_FAILED')
  // a gate that fails its command is still a failed gate: replannable, whatever the SYNC said
  const Z = sandbox()
  deltaInRepo(Z)
  const f1 = Z.commit('c1')
  const r3 = await run('S6c · no receipt; the gate command fails', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl(f1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(Z),
    'sync:api': null,
    'sync:api~r1': null,
    'gate:api': { status: 'BLOCKED', summary: '2 tests fail', failedStep: 'gate' },
    'replan#1': { decision: 'HALT', reason: 'stop here', learnings: [] },
  }), { args: inRepo(Z, { repos: realRepo(Z.W, { gate: { run: 'false' } }), telemetry: { enabled: false } }), index: { deltaFound: true } })
  ok(r3.logs.some((l) => /^⛔ api: gate failed/.test(l)) && r3.labels.includes('replan#1') && !r3.result.ungatedReasons.api, 'GATE_FAILED and a replan, as any failed gate')
  X.done(); Y.done(); Z.done()
}

// ══════════════ S7 · the script: every step that can wait is capped ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const { prompt } = await run('S7 · (capture the SYNC script)', [T('PROJ-1')], by({ 'impl:PROJ-1': impl(c1.slice(0, 7)) }), { args: inRepo(X, { telemetry: { enabled: false } }), index: { deltaFound: true } })
  const sc = scriptOf(prompt('sync:api'))
  // ls-remote, fetch, the commit of the checkout's delta, the fast-forward, the merge, the merge's commit
  const steps = [...sc.matchAll(/(\S+ \S+ )?git -C "\$P" (ls-remote|fetch|merge(?!-base)(?! --abort)|commit)\b/g)]
  eq(steps.map((m) => `${m[1]}${m[2]}`), ['to 60 ls-remote', 'to 60 fetch', 'to 60 commit', 'to 60 merge', 'to 60 merge', 'to 60 commit'], 'every ls-remote, fetch, merge and commit runs under `to 60`')
  ok(/\bto 60 node /.test(sc) && /^now\(\) \{/m.test(sc) && /^to\(\) \{/m.test(sc), 'the delta step too; the script carries its own clock and cap')
  ok(!/push/.test(sc.replace(/GIT_TERMINAL_PROMPT/g, '')) && !/\bgh\b/.test(sc), 'it pushes nothing and touches no PR')
  X.done()
}

// ══════════════ the briefs say it ══════════════
{
  console.log('\n── the briefs')
  const read = (f) => readFileSync(join(REPO, f), 'utf8')
  const gate = read('workflows/briefs/gate.md')
  ok(/there is no SYNC for you to run/.test(gate) && !/run it once the\s+tree is clean/.test(gate) && !/`SYNC ok` brings them in/.test(gate), 'gate.md: the gate runs no SYNC itself')
  ok(/## When the push is skipped/.test(gate) && /take no lock, push nothing/.test(gate), 'gate.md: what to do when the header says the push is skipped')
  ok(/## Mode sync/.test(read('workflows/briefs/ship.md')) && /SYNC ok mode=/.test(read('workflows/briefs/ship.md')), 'ship.md maps the SYNC line')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
