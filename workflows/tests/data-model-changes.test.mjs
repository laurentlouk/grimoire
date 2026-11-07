// ════════════════════════════════════════════════════════════════════════════
//  The data model map, slice 5 (#79): unplanned changes resolved and reported — orchestrate-loop.js
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node workflows/tests/data-model-changes.test.mjs
//
//  Spec D4: unplanned changes never block. The implementer sees its task's planned changes from the
//  design's delta, reads the branch with graph_changes, and keeps (with a reason) or reverts every
//  change outside the delta; the ship step, the single writer under the repo's ship lock, appends the
//  kept ones to the delta (origin: unplanned, the reason as why); the PR body lists every change,
//  planned ✓, pending, built differently or unplanned ⚠; the run report says the same.
//    M1  one task keeps an unplanned column and reverts another: the PR lists planned ✓, pending,
//        built differently and unplanned ⚠ with the reasons; the delta gains exactly one entry; the
//        run is not paused (the ship script runs for real against a git sandbox and a fake gh)
//    M2  two lanes landing together, while an earlier ship is in flight: one ship carries both kept
//        changes, one delta write, inside the lock; with the lock held by another, nothing is written
//    M3  malformed reports: a kept change with no reason is listed, never recorded; one with no target
//        is dropped; a delta step that failed leaves its changes for the next ship; nothing blocks
//    M4  no delta beside the design: the PR still gets the section (the branch's changes), no ship
//        writes anything; a run that changes no stored data gets no section
//    M5  a repo delivered at the end (no land ship): the seal after the gate records the kept changes
//    M6  a replanned task keeps its planned changes; a split gives each part the ones its text names
//    M7  a fix round reports the task's whole list against the task's start: a column reverted in the
//        fix is reverted (nothing appended), a new reason replaces the old, the fix's states replace
//    M8  the architecture (slice 6, #80): a planned component and an unplanned line kept with the
//        diagram updated: the brief carries both, the PR lists them under the same heading, and the
//        ship appends the line to the delta's `architecture` list
//    M9  graph_changes compared the diagram files only (the base checkout's index not at the fork
//        point): the implementer says so (architectureCompared, architectureWhy), and the PR does;
//        then the engine's isArchTarget against delta.mjs's
//  The delta committed on the run branch (#97): a delta inside a shipped repository is written in
//  the ship worktree and committed there, never in the orchestrating checkout (M1, M8: one outside
//  every repository is written in place, and the PR says so).
//    M10 one kept change: exactly one new commit on the run branch, on the landed head, touching only
//        the delta, pushed with it; the checkout's delta byte-identical, its run branch untouched
//    M11 a later landing: the earlier ship's delta commit is carried forward (a merge that changes
//        only the delta), the new entry committed on top; the gate's SYNC brings them into the
//        checkout before its gate command, so its push is a fast-forward
//    M12 two lanes landing together: one delta commit; with the lock held, nothing moves
//    M13 a commit hook that fails: the ship and its push stay green, the entry pending; the next
//        ship commits it
//    M14 deliver: 'end': the seal commits the delta on what the gate pushed, and pushes it
//    M15 the design's delta absent on the run branch: added from the checkout's copy, committed
//        with the first entry; at the gate, added on both sides, SYNC keeps the checkout's version
//        with the remote's unplanned change appended
//    M16 two repositories: the delta lives in one; the other's kept change goes to its ships
//    M17 the delta changed on both sides (an acknowledgement swept into a task's commit): the
//        carry-forward merge keeps the branch's version, appends the remote's entries, and pushes
//  Same stubbed runtime as the other loop tests (support/script-harness.mjs).
import { run, by, T, impl, BLOCKED, QUIET, sandbox, scriptOf, realRepo, receipt, heredocs, unb64, PR_URL, RUN_BRANCH, API, headOf, tick, spawn, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, join } from './support/script-harness.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : `\n       want: ${JSON.stringify(b)}\n       got:  ${JSON.stringify(a)}`}`)

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const DELTA_PATH = 'docs/specs/x.delta.json' // beside INPUTS.specPath (docs/specs/x.md)
const ARGS = { ...QUIET, pluginRoot: REPO, builtinEnvChecks: false } // the ship scripts run the plugin's delta-append.mjs
const plan = (id, op, target, why, after) => ({ id, op, target, ...(after ? { after } : {}), why, slice: 1, origin: 'planned' })
const PLANNED = [
  plan('isbn', 'add', 'api:db/books.isbn', 'search by isbn', { type: 'TEXT', nullable: true }),
  plan('due', 'add', 'api:db/books.due', 'loans come back by a date', { type: 'TEXT', nullable: false }),
  plan('loans', 'add', 'api:db/loans', 'lend books', { fields: [{ name: 'id', type: 'INTEGER', nullable: false }] }),
]
const asTask = (c) => ({ id: c.id, op: c.op, target: c.target, why: c.why })
const DELTA = { schema: 1, spec: 'docs/specs/x.md', data: PLANNED, architecture: [] }
const writeDelta = (X) => { mkdirSync(join(X.T0, 'docs/specs'), { recursive: true }); writeFileSync(join(X.T0, DELTA_PATH), JSON.stringify(DELTA, null, 2) + '\n') }
const readDelta = (X) => JSON.parse(readFileSync(join(X.T0, DELTA_PATH), 'utf8'))
// what the ship brief maps the script's DELTA lines to
const deltaOf = (out) => {
  const m = /^DELTA (ok|none|bad|skipped)(?: added=(\d+) already=(\d+) refused=(\d+))?(?: commit=([0-9a-f]+))?/m.exec(out)
  return m ? { delta: m[1], deltaAdded: +(m[2] || 0), deltaAlready: +(m[3] || 0), deltaRefused: +(m[4] || 0), deltaCommit: m[5] || '', deltaDetail: out.split('\n').filter((l) => /^DELTA (bad|refused)/.test(l)).join('\n') } : {}
}
const shipFor = (X, seen) => (p) => { seen.push(p); const r = X.exec('bash', scriptOf(p)); seen.out = (seen.out || []).concat(r.out); return { ...receipt(r.out), ...deltaOf(r.out) } }
// the delta entries a ship or seal script carries: the base64 payload of its DELTA step (decoded to $E)
const deltaPayload = (p) => { const m = /cat > "\$E\.b64" <<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/.exec(scriptOf(p)); return m ? JSON.parse(unb64(m[1])) : null }
// the PR description a ship script carries (decoded to $F)
const bodyOf = (p) => { const m = /cat > "\$F\.b64" <<'GRIMOIRE_EOF'\n([\s\S]*?)\nGRIMOIRE_EOF/.exec(scriptOf(p)); return m ? unb64(m[1]) : '' }
const hydrateOf = (calls) => (calls.find((c) => c.label.startsWith('hydrate:')) || {}).prompt || ''
const section = (body) => { const i = body.indexOf('### Data model and architecture changes'); return i < 0 ? null : body.slice(i).split('\n<!-- grimoire:state')[0].trimEnd().split('\n') }

// ══════════════ M1 · keep one, revert another ══════════════
{
  const X = sandbox()
  writeDelta(X)
  const c1 = X.commit('c1')
  const kept = { target: 'api:db/books.subtitle', op: 'add', kept: true, reason: 'the search page shows it', after: { type: 'TEXT', nullable: true } }
  const reverted = { target: 'api:db/books.legacy_code', op: 'remove', kept: false, reason: 'dropped by mistake: restored' }
  const ships = []
  const { result, labels, logs, prompt, calls } = await run('M1 · an implementer keeps one unplanned column and reverts another', [T('PROJ-1', { deltaChanges: PLANNED.map(asTask) })], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [kept, reverted], deltaStates: [{ id: 'isbn', state: 'planned-built' }, { id: 'due', state: 'pending' }, { id: 'loans', state: 'built-differently', note: 'column id: INTEGER, not null → absent' }] },
    'ship:api#1': shipFor(X, ships),
  }), { args: { ...ARGS, root: X.T0, repos: realRepo(X.W) }, index: { deltaFound: true } })

  ok(prompt('parse-index').includes(`The design's delta, beside the spec (optional: only a design that changes stored data has one): ${DELTA_PATH} — return \`deltaFound\``), 'the index agent is asked whether the delta beside the spec exists')
  ok(hydrateOf(calls).includes(`## The design's delta: \`${DELTA_PATH}\``) && hydrateOf(calls).includes('set `deltaChanges` to the delta\'s `data` changes it builds'), 'the hydration copies each task\'s planned changes from the delta')
  const ip = prompt('impl:PROJ-1')
  ok(ip.includes(`## Data model changes — the design's delta \`${DELTA_PATH}\``) && ip.includes('- `isbn` · add `api:db/books.isbn` — search by isbn') && ip.includes('- `loans` · add `api:db/loans` — lend books') && ip.includes(`run \`graph_changes\` with \`delta: "${DELTA_PATH}"\``) && ip.includes('Nothing waits on it'),
    'the implementer brief carries the task\'s planned changes, names the delta, and asks for graph_changes before it returns')

  const body = X.pr.body()
  eq(section(body), [
    '### Data model and architecture changes',
    `Against the design's delta \`${DELTA_PATH}\`, each state as its task's implementer read it with \`graph_changes\`:`,
    '- planned ✓ `api:db/books.isbn` — add `isbn`: search by isbn · PROJ-1',
    '- pending `api:db/books.due` — add `due`: loans come back by a date · PROJ-1',
    '- built differently `api:db/loans` — add `loans`: column id: INTEGER, not null → absent · PROJ-1',
    '- unplanned ⚠ kept `api:db/books.subtitle` (add) — the search page shows it · PROJ-1',
    '- unplanned ⚠ reverted `api:db/books.legacy_code` (remove) — dropped by mistake: restored · PROJ-1',
    '',
    "Each kept unplanned change is added to the delta (`origin: unplanned`, its reason as `why`) for you to acknowledge in the graph page's Data tab (`graph.mjs serve`). The delta lives outside the shipped repositories: written in place, not committed. Nothing here blocks the run.",
  ], 'the draft PR (written by the real ship script, through the fake gh) lists planned ✓, pending, built differently, and unplanned ⚠ kept and reverted with their reasons; the delta outside the repository is said to be written in place, not committed')
  eq([X.origin(), X.sh(`git --git-dir=origin.git rev-list --count ${c1}`)], [c1, X.sh(`git rev-list --count ${c1}`, X.W)], 'the delta outside every shipped repository: nothing is committed for it, the run branch holds the landed head only')

  const after = readDelta(X)
  const added = after.data.filter((c) => c.origin === 'unplanned')
  eq([after.data.length, added.map(({ id, ...c }) => c), /^unplanned-PROJ-1-[0-9a-f]{8}$/.test(added[0] && added[0].id)],
    [4, [{ op: 'add', target: 'api:db/books.subtitle', after: { type: 'TEXT', nullable: true }, why: 'the search page shows it', slice: 1, origin: 'unplanned' }], true],
    'the delta gains exactly one entry: the kept change, origin unplanned, the reason as why, the task\'s slice, never acknowledged; nothing for the reverted one')
  ok(/^LOCK ok$/m.test(ships.out[0]) && /^DELTA ok added=1 already=0 refused=0$/m.test(ships.out[0]) && ships.out[0].indexOf('LOCK ok') < ships.out[0].indexOf('DELTA ok') && !existsSync(join(X.W, '.git', 'grimoire-ship-api.lock')), 'written by the ship script, after it took the repo\'s ship lock, released after')
  ok(!result.halt && labels.includes('gate:api') && result.done.map((d) => d.id).join() === 'PROJ-1' && !labels.some((l) => /^(replan|resolve)/.test(l)), 'nothing paused or blocked: no replan, no question, the run drained to its gate')
  ok(logs.some((l) => l === '◎ PROJ-1: data model — unplanned ⚠ kept api:db/books.subtitle · reverted api:db/books.legacy_code — the kept ones go to the delta with the next ship; nothing waits on it') && logs.some((l) => /^◎ ship:api#1: the design's delta — 1 unplanned change\(s\) added$/.test(l)), 'the run log says what was kept, what was reverted, and what reached the delta')
  eq(result.dataModel, { delta: DELTA_PATH, changes: [{ task: 'PROJ-1', repo: 'api', target: 'api:db/books.subtitle', op: 'add', kept: true, reason: 'the search page shows it', delta: 'added' }, { task: 'PROJ-1', repo: 'api', target: 'api:db/books.legacy_code', op: 'remove', kept: false, reason: 'dropped by mistake: restored', delta: null }], unrecorded: [] },
    'the run\'s result reports both, the kept one added to the delta')
  const gate = prompt('gate:api')
  ok(gate.includes('The body\'s **Data model and architecture changes** section') && gate.includes('  - unplanned ⚠ kept `api:db/books.subtitle` (add) — the search page shows it · PROJ-1 · added to the delta'), 'the gate keeps the section in the final body, the kept change now said to be in the delta')
  ok(deltaPayload(prompt('seal:api')) === null, 'nothing left for the seal to record')
  X.done()
}

// ══════════════ M2 · two lanes land together: one delta write, under the lock ══════════════
{
  const X = sandbox()
  writeDelta(X)
  const c0 = X.commit('c0'), c2 = X.commit('c2')
  const K = (n) => ({ target: `api:db/books.k${n}`, op: 'add', kept: true, reason: `lane ${n} needs it`, after: { type: 'TEXT', nullable: true } })
  const L0 = T('PROJ-0', { files: ['src/zero.ts — add it'] })
  const L1 = T('PROJ-1', { dependsOn: ['PROJ-0'], files: ['src/one.ts — add it'] }), L2 = T('PROJ-2', { dependsOn: ['PROJ-0'], files: ['src/two.ts — add it'] })
  const when = {}
  const ships = []
  const { calls, result } = await run('M2 · two lanes land while the first ship is in flight', [L0, L1, L2], by({
    'impl:PROJ-0': impl(c0.slice(0, 7)),
    'impl:PROJ-1': { ...impl('1111111'), modelChanges: [K(1)] },
    'impl:PROJ-2': { ...impl('2222222'), modelChanges: [K(2)] },
    'integrate:PROJ-1': { status: 'MERGED', headSha: c2.slice(0, 7) },
    'integrate:PROJ-2': { status: 'MERGED', headSha: c2.slice(0, 7) },
    'ship:api#1': async (p) => { when.s1 = [Date.now()]; await tick(400); const r = shipFor(X, ships)(p); when.s1.push(Date.now()); return r },
    'ship:api#2': (p) => { when.s2 = Date.now(); return shipFor(X, ships)(p) },
  }), { args: { ...ARGS, repos: realRepo(X.W), maxPerRepo: 2 }, index: { deltaFound: true } })
  const shipCalls = calls.filter((c) => c.label.startsWith('ship:'))
  const payloads = shipCalls.map((c) => deltaPayload(c.prompt))
  eq([shipCalls.map((c) => c.label), payloads.map((p) => p && p.map((e) => e.target))], [['ship:api#1', 'ship:api#2'], [null, ['api:db/books.k1', 'api:db/books.k2']]],
    'the two landings coalesce into the queued ship: one ship carries both kept changes (the first ship, in flight, carried none)')
  ok(when.s2 >= when.s1[1], 'the second ship starts once the first has returned: one ship of a repo at a time')
  const s2 = scriptOf(shipCalls[1].prompt)
  const take = s2.indexOf('if shiplock ship; then LK=1'), step = s2.indexOf("# 7 · the design's delta"), unlock = s2.lastIndexOf('shipunlock;')
  ok(take > 0 && take < step && step < unlock && s2.slice(step, unlock).includes('if [ "$LK" != 1 ]; then echo "DELTA skipped lock=0"'), 'its delta step runs inside the repo\'s ship lock, and only while the lock is held')
  eq([(ships.out[1].match(/^DELTA .*/gm) || []), readDelta(X).data.filter((c) => c.origin === 'unplanned').map((c) => c.target)], [['DELTA ok added=2 already=0 refused=0'], ['api:db/books.k1', 'api:db/books.k2']], 'one write: both changes appended by that one step')
  ok(!result.halt && result.done.length === 3, 'nothing blocked')

  // the same step with the lock held by a live ship of another session: it waits, then writes nothing
  writeDelta(X)
  const LK = join(X.W, '.git', 'grimoire-ship-api.lock')
  const holder = spawn('sleep', ['30'])
  mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `${holder.pid} ${Math.floor(Date.now() / 1000)} ship\n`)
  const busy = X.exec('bash', s2, { GRIMOIRE_SHIP_LOCK_WAIT: '1' })
  ok(/^LOCK busy/m.test(busy.out) && /^DELTA skipped lock=0$/m.test(busy.out) && readDelta(X).data.length === PLANNED.length, 'with the lock held by another: DELTA skipped, the delta untouched')
  holder.kill()
  X.done()
}

// ══════════════ M3 · malformed reports, a failed delta step: listed, retried, never blocking ══════════════
{
  const A = T('PROJ-1'), B = T('PROJ-2', { dependsOn: ['PROJ-1'] })
  const good = { target: 'api:db/books.note', op: 'add', kept: true, reason: 'notes are shown', after: { type: 'TEXT', nullable: true } }
  const { calls, result, logs, prompt } = await run('M3 · a kept change with no reason, one with no target; the first delta step fails', [A, B], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), modelChanges: [good, { target: 'api:db/books.tag', op: 'add', kept: true, after: { type: 'TEXT', nullable: true } }, { op: 'add', kept: true, reason: 'no target here' }, 'not an object'] },
    'impl:PROJ-2': { ...impl('bbbbbbb', 'aaaaaaa'), modelChanges: [{ ...good, target: 'api:db/books.color', reason: 'covers are colored' }] },
    'ship:api#1': (p) => ({ pushed: true, remoteHead: (/landed head `([0-9a-f]+)`/.exec(p) || [])[1], prUrl: PR_URL, draft: true, delta: 'bad', deltaDetail: 'DELTA bad step=node' }),
    'ship:api#2': (p) => ({ pushed: true, remoteHead: (/landed head `([0-9a-f]+)`/.exec(p) || [])[1], prUrl: PR_URL, draft: true, delta: 'ok', deltaAdded: 2, deltaAlready: 0, deltaRefused: 0 }),
  }), { args: ARGS, index: { deltaFound: true } })
  const p1 = deltaPayload(prompt('ship:api#1')), p2 = deltaPayload(prompt('ship:api#2'))
  eq([p1.map((e) => e.target), p2.map((e) => e.target)], [['api:db/books.note'], ['api:db/books.note', 'api:db/books.color']], 'a kept change with no reason is never sent to the delta; one the first ship could not write rides the next one, with the new one')
  const body = heredocs(prompt('ship:api#2'))[0]
  ok(body.includes("- no planned change recorded in this session's tasks") && body.includes('- unplanned ⚠ kept `api:db/books.tag` (add) — no reason given · PROJ-1 · not added to the delta (no reason given)') && body.includes('- unplanned ⚠ kept `api:db/books.note` (add) — notes are shown · PROJ-1') && !body.includes('no target here'),
    'the PR lists the kept change with no reason as such; the entry with no target says nothing and is dropped')
  ok(logs.some((l) => l === '⚠ PROJ-1: the unplanned change api:db/books.tag was kept with no reason given — listed in the PR, not added to the delta') && logs.some((l) => l === '⚠ PROJ-1: 2 modelChanges entries named no target — dropped') && logs.some((l) => /^⚠ ship:api#1: the design's delta was not written \(DELTA bad: DELTA bad step=node\) — its 1 unplanned change\(s\) wait for the next ship$/.test(l)), 'each said in the run log')
  ok(!result.halt && result.done.length === 2 && !calls.some((c) => /^(replan|resolve)/.test(c.label)), 'nothing blocked')
  eq(result.dataModel.changes.map((m) => `${m.target} ${m.delta}`), ['api:db/books.note added', 'api:db/books.tag no reason given', 'api:db/books.color added'], 'the result says what reached the delta and what did not, and why')
}

// ══════════════ M4 · no delta beside the design ══════════════
{
  const ch = { target: 'api:db/books.subtitle', op: 'add', kept: true, reason: 'the search page shows it' }
  const { prompt, calls } = await run('M4 · no delta: the PR still lists the branch\'s changes', [T('PROJ-1')], by({ 'impl:PROJ-1': { ...impl('aaaaaaa'), modelChanges: [ch, { ...ch, target: 'api:db/books.old', op: 'remove', kept: false, reason: 'still read by the export' }] } }), { args: ARGS, index: { deltaFound: false } })
  eq(section(heredocs(prompt('ship:api#1'))[0]), [
    '### Data model and architecture changes',
    `No delta beside the design (\`${DELTA_PATH}\`): the changes this branch makes to stored data, as its implementers reported them against their base.`,
    '- kept `api:db/books.subtitle` (add) — the search page shows it · PROJ-1',
    '- reverted `api:db/books.old` (remove) — still read by the export · PROJ-1',
  ], 'the section lists the branch\'s changes, kept or reverted with their reasons, none marked unplanned')
  ok(!calls.some((c) => /^(ship|seal):/.test(c.label) && deltaPayload(c.prompt)) && !hydrateOf(calls).includes("The design's delta"), 'no ship or seal writes anything, and the hydration copies nothing')
  ok(prompt('impl:PROJ-1').includes('## Data model changes — this design has no delta') && prompt('impl:PROJ-1').includes('list in `modelChanges` every change to stored data your commits made'), 'the implementer still reports its changes to stored data')
  const quiet = await run('M4b · no delta, nothing reported: no section', [T('PROJ-1')], by({}), { args: ARGS })
  ok(section(heredocs(quiet.prompt('ship:api#1'))[0]) === null && !quiet.prompt('gate:api').includes('Data model and architecture changes'), 'a run that changes no stored data gets no section')
}

// ══════════════ M5 · delivered at the end: the seal records them ══════════════
{
  let seal = ''
  const { result, labels } = await run('M5 · deliver: end — no land ship; the seal after the gate writes the delta', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), modelChanges: [{ target: 'api:db/books.note', op: 'add', kept: true, reason: 'notes are shown', after: { type: 'TEXT', nullable: true } }] },
    'seal:api': (p) => { seal = p; return { sealed: true, already: true, prUrl: PR_URL, delta: 'ok', deltaAdded: 1, deltaAlready: 0, deltaRefused: 0 } },
  }), { args: { ...ARGS, deliver: 'end' }, index: { deltaFound: true } })
  ok(!labels.some((l) => l.startsWith('ship:')) && deltaPayload(seal).map((e) => e.target).join() === 'api:db/books.note' && seal.includes('Then return what its SEAL and DELTA lines say'), 'no land ship ran; the seal carries the kept change')
  eq(result.dataModel.changes.map((m) => m.delta), ['added'], '… and the result says it reached the delta')
}

// ══════════════ M6 · a replanned task keeps its planned changes (the replanner never sees the delta) ══════════════
{
  let n = 0
  const { calls, prompt } = await run('M6 · BLOCKED, then REVISE with a task that states no changes', [T('PROJ-1', { deltaChanges: PLANNED.slice(0, 1).map(asTask) })], by({
    'impl:PROJ-1': () => (++n === 1 ? { ...BLOCKED } : { ...impl('aaaaaaa'), deltaStates: [{ id: 'isbn', state: 'planned-built' }] }),
    'replan#1': { decision: 'REVISE', cause: 'code', reason: 'another approach', learnings: [], tasks: [T('PROJ-1', { taskText: 'Build PROJ-1 another way' })] },
  }), { args: ARGS, index: { deltaFound: true } })
  const again = calls.filter((c) => c.label === 'impl:PROJ-1')[1]
  ok(!!again && again.prompt.includes('- `isbn` · add `api:db/books.isbn` — search by isbn') && !again.prompt.includes('This task plans no change to stored data'), 'the retried task\'s brief still carries its planned change')
  ok((section(heredocs(prompt('ship:api#1'))[0]) || []).includes('- planned ✓ `api:db/books.isbn` — add `isbn`: search by isbn · PROJ-1'), '… and the PR still lists it, planned ✓')

  // a split: the failed id retried for one part, a new task for another. Each gets the changes its
  // text names; a change no task names goes to every one of them (which one builds it cannot be told)
  let m = 0
  const three = [...PLANNED.slice(0, 2), PLANNED[2]].map(asTask) // isbn, due, loans
  const split = await run('M6b · BLOCKED, then a split into the retried id and a new task', [T('PROJ-1', { deltaChanges: three })], by({
    'impl:PROJ-1': () => (++m === 1 ? { ...BLOCKED } : impl('aaaaaaa')),
    'replan#1': { decision: 'REVISE', cause: 'code', reason: 'two smaller steps', learnings: [], tasks: [
      T('PROJ-1', { taskText: 'Add the isbn column to books', files: ['src/books.ts — the column'] }),
      T('PROJ-1b', { ticket: 'NO_TICKET', taskText: 'Create the loans table', files: ['src/loans.ts — the table'] }),
    ] },
  }), { args: ARGS, index: { deltaFound: true } })
  const planned = (label) => [...((split.calls.filter((c) => c.label === label).pop() || {}).prompt || '').matchAll(/^- `([^`]+)` · /gm)].map((x) => x[1])
  eq([planned('impl:PROJ-1'), planned('impl:PROJ-1b')], [['isbn', 'due'], ['due', 'loans']], 'each split task gets the changes its text names (isbn, loans), and the one neither names (due) goes to both')
}

// ══════════════ M7 · a fix round: the report is the task's whole list, against the task's start ══════════════
{
  const kept = { target: 'api:db/books.subtitle', op: 'add', kept: true, reason: 'the search page shows it', after: { type: 'TEXT', nullable: true } }
  const FAIL_MAJOR = { verdict: 'FAIL', findings: [{ severity: 'major', file: 'src/PROJ1.ts', line: 3, issue: 'the subtitle leaks drafts' }], summary: 'FAIL' }
  const first = { ...impl('aaaaaaa', '0000000'), modelChanges: [kept], deltaStates: [{ id: 'loans', state: 'built-differently', note: 'column id: INTEGER, not null → absent' }] }
  const task = () => T('PROJ-1', { deltaChanges: [asTask(PLANNED[2])] })
  let fixPrompt = ''
  const reverted = await run('M7 · the implementer keeps a column, a fix round reverts it and reports none', [task()], by({
    'impl:PROJ-1': first,
    'break-it:PROJ-1': FAIL_MAJOR,
    'fix:PROJ-1:quality#1': (p) => { fixPrompt = p; return { ...impl('bbbbbbb', 'aaaaaaa'), modelChanges: [], deltaStates: [{ id: 'loans', state: 'planned-built' }] } },
  }), { args: ARGS, index: { deltaFound: true } })
  ok(fixPrompt.includes('`base` = `0000000`') && fixPrompt.includes("this task's start, not this dispatch's") && fixPrompt.includes('- kept `api:db/books.subtitle` (add) — the search page shows it') && fixPrompt.includes('the FULL current list'),
    'the fix brief names the task\'s start as the base, lists the earlier report, and asks for the whole current list')
  eq(reverted.result.dataModel.changes.map((c) => [c.target, c.kept, c.delta]), [['api:db/books.subtitle', false, null]], 'after the fix the kept column is reverted: nothing waits for the delta')
  ok(deltaPayload(reverted.prompt('ship:api#1')) === null, '… and no ship appends it')
  const s = section(heredocs(reverted.prompt('ship:api#1'))[0]) || []
  ok(s.includes('- planned ✓ `api:db/loans` — add `loans`: lend books · PROJ-1') && s.some((l) => l.startsWith('- unplanned ⚠ reverted `api:db/books.subtitle` (add) — ')), 'the PR says it was reverted, and the fix\'s state replaces the first round\'s (planned ✓, no longer built differently)')

  const rekept = await run('M7b · a fix that keeps it with a new reason', [task()], by({
    'impl:PROJ-1': first,
    'break-it:PROJ-1': FAIL_MAJOR,
    'fix:PROJ-1:quality#1': { ...impl('bbbbbbb', 'aaaaaaa'), modelChanges: [{ ...kept, reason: 'the export reads it too' }] },
  }), { args: ARGS, index: { deltaFound: true } })
  const payload = deltaPayload(rekept.prompt('ship:api#1'))
  eq([rekept.result.dataModel.changes.map((c) => [c.target, c.kept, c.reason]), payload.map((e) => [e.target, e.why])], [[['api:db/books.subtitle', true, 'the export reads it too']], [['api:db/books.subtitle', 'the export reads it too']]], 'kept again with a new reason: one change, its reason updated, one entry for the delta')
  ok((section(heredocs(rekept.prompt('ship:api#1'))[0]) || []).includes('- built differently `api:db/loans` — add `loans`: column id: INTEGER, not null → absent · PROJ-1'), 'a fix that reports no states leaves the earlier ones standing')

  const silent = await run('M7c · a fix that does not report at all', [task()], by({
    'impl:PROJ-1': first,
    'break-it:PROJ-1': FAIL_MAJOR,
    'fix:PROJ-1:quality#1': impl('bbbbbbb', 'aaaaaaa'),
  }), { args: ARGS, index: { deltaFound: true } })
  eq(silent.result.dataModel.changes.map((c) => [c.target, c.kept, c.reason]), [['api:db/books.subtitle', true, 'the search page shows it']], 'a fix with no modelChanges at all says nothing new: the earlier report stands')
}

// ══════════════ M8 · the architecture: a planned component, an unplanned line kept ══════════════
{
  const X = sandbox()
  const ARCH = [{ id: 'search', op: 'add', target: 'component:search', after: { label: 'Search', type: 'backend' }, why: 'find books by title', slice: 1, origin: 'planned' }]
  mkdirSync(join(X.T0, 'docs/specs'), { recursive: true })
  writeFileSync(join(X.T0, DELTA_PATH), JSON.stringify({ ...DELTA, architecture: ARCH }, null, 2) + '\n')
  const c1 = X.commit('c1')
  const line = { target: 'connection:web->store', op: 'add', kept: true, reason: 'the page shows the stock as it is', after: { label: 'reads stock' } }
  const ships = []
  const { result, prompt, calls } = await run('M8 · a planned component and an unplanned line, kept with the diagram updated', [T('PROJ-1', { deltaChanges: [asTask(PLANNED[0]), asTask(ARCH[0])] })], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [line], deltaStates: [{ id: 'isbn', state: 'planned-built' }, { id: 'search', state: 'planned-built' }] },
    'ship:api#1': shipFor(X, ships),
  }), { args: { ...ARGS, root: X.T0, repos: realRepo(X.W) }, index: { deltaFound: true } })
  ok(hydrateOf(calls).includes('and its `architecture` changes'), 'the hydration copies the delta\'s architecture changes too')
  const ip = prompt('impl:PROJ-1')
  ok(ip.includes('- `search` · add `component:search` — find books by title') && ip.includes('Unplanned lists (the data model\'s and the architecture\'s)') && ip.includes('with the diagram updated in your commits'), 'the implementer brief carries the planned component and asks for the architectural impact, kept with the diagram updated')
  eq(section(X.pr.body()), [
    '### Data model and architecture changes',
    `Against the design's delta \`${DELTA_PATH}\`, each state as its task's implementer read it with \`graph_changes\`:`,
    '- planned ✓ `api:db/books.isbn` — add `isbn`: search by isbn · PROJ-1',
    '- planned ✓ `component:search` — add `search`: find books by title · PROJ-1',
    '- unplanned ⚠ kept `connection:web->store` (add) — the page shows the stock as it is · PROJ-1',
    '',
    "Each kept unplanned change is added to the delta (`origin: unplanned`, its reason as `why`), a kept architectural one with the diagram updated in this branch, for you to acknowledge in the graph page's Architecture tab (`graph.mjs serve`). The delta lives outside the shipped repositories: written in place, not committed. Nothing here blocks the run.",
  ], 'the PR section lists the architecture under the same heading: the planned component ✓, the unplanned line kept with its reason, acknowledged in the Architecture tab')
  const after = readDelta(X)
  eq([after.data.length, after.architecture.map(({ id, ...c }) => c), /^unplanned-PROJ-1-[0-9a-f]{8}$/.test(after.architecture[1] && after.architecture[1].id)],
    [PLANNED.length, [(({ id, ...c }) => c)(ARCH[0]), { op: 'add', target: 'connection:web->store', after: { label: 'reads stock' }, why: 'the page shows the stock as it is', slice: 1, origin: 'unplanned' }], true],
    'the ship appends the kept line to the delta\'s architecture list (origin unplanned, the reason as why), never to its data')
  ok(/^DELTA ok added=1 already=0 refused=0$/m.test(ships.out[0]) && !result.halt && result.dataModel.changes.map((m) => `${m.target} ${m.delta}`).join() === 'connection:web->store added', 'written under the ship lock; nothing blocked; the run\'s result says it reached the delta')
  X.done()
}

// ══════════════ M9 · the code's architectural impact not compared: said in the brief and the PR ══════════════
{
  const { prompt } = await run('M9 · graph_changes compared the diagram files only (the base index not at the fork point)', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl('aaaaaaa'), modelChanges: [], architectureCompared: 'diagrams-only', architectureWhy: 'base index not at the fork point' },
  }), { args: ARGS, index: { deltaFound: false } })
  ok(prompt('impl:PROJ-1').includes('If its Architecture part says "diagram files only, the code not compared", return `architectureCompared: "diagrams-only"`'), 'the brief asks the implementer to say when the code was not compared')
  eq(section(heredocs(prompt('ship:api#1'))[0]), [
    '### Data model and architecture changes',
    `No delta beside the design (\`${DELTA_PATH}\`): the changes this branch makes to stored data, as its implementers reported them against their base.`,
    "- architecture: diagram files only (base index not at the fork point): the code's impact on it was not compared · PROJ-1",
  ], 'the PR says the architecture was compared on the diagram files only, and why: never read as no impact')
}

// ══════════════ the delta inside the shipped repository: committed on the run branch (#97) ══════════════
// The repository is `<root>/work` and the spec `work/docs/specs/x.md`: its delta is the repository's
// `docs/specs/x.delta.json`. Every ship and seal script runs for real (git sandbox, fake gh).
const REL = 'docs/specs/x.delta.json'
const inRepo = (X, extra = {}) => ({ ...ARGS, root: X.T0, specPath: 'work/docs/specs/x.md', repos: realRepo(X.W), runId: 'run-97', ...extra })
const deltaInRepo = (X, { commit = true } = {}) => {
  mkdirSync(join(X.W, 'docs/specs'), { recursive: true })
  writeFileSync(join(X.W, REL), JSON.stringify(DELTA, null, 2) + '\n')
  if (commit) X.sh(`git add -- ${REL} && git commit -q -m 'docs: the design delta'`, X.W)
}
const og = (X, cmd) => X.sh(`git --git-dir=origin.git ${cmd}`) // the remote
const parentsOf = (X, sha) => og(X, `rev-list --parents -n 1 ${sha}`).split(' ').slice(1)
const unplannedAt = (X, sha) => JSON.parse(og(X, `show ${sha}:${REL}`)).data.filter((c) => c.origin === 'unplanned')
const blocksOf = (p) => [...p.matchAll(/```bash\n([\s\S]*?)\n[ \t]*```/g)].map((m) => m[1])
const keptAs = (n, extra = {}) => ({ target: `api:db/books.k${n}`, op: 'add', kept: true, reason: `task ${n} needs it`, after: { type: 'TEXT', nullable: true }, ...extra })
const CLOSING_COMMIT = "Each kept unplanned change is added to the delta (`origin: unplanned`, its reason as `why`) in its own commit on this branch, for you to acknowledge in the graph page's Data tab (`graph.mjs serve`). Nothing here blocks the run."

// ══════════════ M10 · one kept change: one commit on the run branch, the checkout untouched ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const before = readFileSync(join(X.W, REL), 'utf8')
  const ships = []
  const { result, logs } = await run('M10 · an implementer keeps one unplanned change: the ship commits the delta on the run branch', [T('PROJ-1', { deltaChanges: PLANNED.map(asTask) })], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1, { reason: 'the search page shows it' })], deltaStates: [{ id: 'isbn', state: 'planned-built' }] },
    'ship:api#1': shipFor(X, ships),
  }), { args: inRepo(X), index: { deltaFound: true } })
  const tip = X.origin()
  eq([og(X, `rev-list --count ${c1}..${tip}`), parentsOf(X, tip), og(X, `diff --name-only ${c1} ${tip}`)], ['1', [c1], REL], 'exactly one new commit on the run branch, on the landed head, touching only the delta file')
  eq(unplannedAt(X, tip).map(({ id, ...c }) => c), [{ op: 'add', target: 'api:db/books.k1', after: { type: 'TEXT', nullable: true }, why: 'the search page shows it', slice: 1, origin: 'unplanned' }], 'it holds the origin: "unplanned" entry, the reason as why')
  eq([og(X, `log -1 --format=%s ${tip}`), og(X, `log -1 --format='%(trailers:key=Grimoire-Run,valueonly)' ${tip}`)], [`chore(data): record unplanned changes in ${REL} (PROJ-1)`, 'run-97'], 'its own commit: the subject names the delta and the task, the run in its trailer')
  ok(readFileSync(join(X.W, REL), 'utf8') === before && X.sh(`git rev-parse refs/heads/${RUN_BRANCH}`, X.W) === c1 && X.sh('git status --porcelain -- docs', X.W) === '', "the orchestrating checkout is not modified: its delta byte-identical, its run branch where the landing left it")
  const out = ships.out[0]
  ok(new RegExp(`^PUSH ok=1 remote=${c1}$`, 'm').test(out) && new RegExp(`^DELTA ok added=1 already=0 refused=0 commit=${tip.slice(0, 7)}$`, 'm').test(out) && out.indexOf('LOCK ok') < out.indexOf('DELTA ok') && !existsSync(join(X.W, '.git', 'grimoire-ship-api.lock')),
    'the push carried it (the receipt names the landed head the remote now holds), the DELTA line names the commit; under the ship lock, released after')
  eq(result.dataModel.changes.map((c) => c.delta), ['added'], 'the run\'s result says it reached the delta')
  ok(logs.includes(`◎ ship:api#1: the design's delta — 1 unplanned change(s) added, committed on ${RUN_BRANCH} (${tip.slice(0, 7)})`), 'the run log names the commit')
  eq((section(X.pr.body()) || []).at(-1), CLOSING_COMMIT, 'the PR section says the delta is recorded in its own commit on this branch')
  X.done()
}

// ══════════════ M11 · a later landing: the earlier delta commit carried forward; the gate brings it in ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1'), c2 = X.commit('c2')
  const before = readFileSync(join(X.W, REL), 'utf8')
  const ships = [], tips = []
  const ship = (p) => { const r = shipFor(X, ships)(p); tips.push(X.origin()); return r }
  const { result, prompt } = await run('M11 · two landings, each keeping a change: the second ship carries the first commit forward', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'impl:PROJ-2': { ...impl(c2.slice(0, 7), c1.slice(0, 7)), modelChanges: [keptAs(2)] },
    'ship:api#1': ship, 'ship:api#2': ship,
  }), { args: inRepo(X), index: { deltaFound: true } })
  const [d1, d2] = tips
  const m = parentsOf(X, d2)[0]
  eq([parentsOf(X, d1), parentsOf(X, d2).length, parentsOf(X, m), og(X, `log -1 --format=%s ${m}`), og(X, `log -1 --format=%s ${d2}`), og(X, `diff --name-only ${c2} ${d2}`)],
    [[c1], 1, [c2, d1], `chore(data): carry ${REL} forward from the run branch`, `chore(data): record unplanned changes in ${REL} (PROJ-2)`, REL],
    'the second ship merges the first delta commit into its landed head (a merge that changes only the delta), then commits its own entry on top: both pushes fast-forward')
  eq(unplannedAt(X, d2).map((c) => c.target), ['api:db/books.k1', 'api:db/books.k2'], 'the run branch holds both entries')
  ok(ships.out.every((o) => /^PUSH ok=1 /m.test(o) && /^DELTA ok added=1 already=0 refused=0 commit=/m.test(o)) && !result.halt && result.dataModel.changes.every((c) => c.delta === 'added'), 'both ships pushed and recorded; nothing failed or halted')
  ok(readFileSync(join(X.W, REL), 'utf8') === before && X.sh(`git rev-parse refs/heads/${RUN_BRANCH}`, X.W) === c2, 'the checkout still has neither: its delta untouched, its run branch at the landed head')

  // the terminal slot: a sweep commit on the checkout's run branch, then the gate's SYNC brings the
  // recorded delta in before the gate command runs, and its push is a fast-forward of the remote
  const gp = prompt('gate:api')
  ok(gp.includes(`this repo holds the design's delta (\`${REL}\`)`) && /^- Before the gate command/m.test(gp) && gp.indexOf('SYNC ok') < gp.indexOf('Gate command:'), 'the gate prompt carries the SYNC script, before the gate command')
  const B = blocksOf(gp), pick = (s) => B.find((b) => b.includes(s)) || ''
  const s = X.commit('sweep')
  const so = X.exec('bash', pick('SYNC ok')).out
  const head = X.sh('git rev-parse HEAD', X.W)
  eq([so.trim(), X.sh(`git rev-list --parents -n 1 ${head}`, X.W).split(' ').slice(1), X.sh(`git diff --name-only ${s} ${head}`, X.W)], [`SYNC ok head=${head}`, [s, d2], REL], "SYNC merges the remote's delta commits into the checkout's run branch: a merge that changes only the delta")
  const take = X.exec('bash', pick('shiplock gate')).out, push = X.exec('bash', pick('push -u origin')).out
  X.exec('bash', pick('lkrel'))
  ok(/^LOCK ok/m.test(take) && /^PUSH exit=0$/m.test(push) && X.origin() === head, "the gate's push is a fast-forward: the remote holds the swept head with both entries")
  ok(X.exec('bash', pick('SYNC ok')).out.trim() === 'SYNC none', 'run again: SYNC none, nothing to bring')
  X.done()
}

// ══════════════ M11b · later landings that keep nothing still carry the delta commit forward ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1'), c2 = X.commit('c2'), c3 = X.commit('c3')
  const ships = [], tips = []
  const ship = (p) => { const r = shipFor(X, ships)(p); tips.push(X.origin()); return r }
  const { result, logs, calls } = await run('M11b · the first landing keeps a change, the next two keep none', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] }), T('PROJ-3', { dependsOn: ['PROJ-2'] })], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'impl:PROJ-2': impl(c2.slice(0, 7), c1.slice(0, 7)),
    'impl:PROJ-3': impl(c3.slice(0, 7), c2.slice(0, 7)),
    'ship:api#1': ship, 'ship:api#2': ship, 'ship:api#3': ship,
  }), { args: inRepo(X), index: { deltaFound: true } })
  const ff = (a, b) => X.sh(`git --git-dir=origin.git merge-base --is-ancestor ${a} ${b} && echo yes`) === 'yes'
  eq([ships.out.map((o) => (/^PUSH ok=1 /m.test(o) ? 'pushed' : 'refused')), ff(tips[0], tips[1]) && ff(tips[1], tips[2]), parentsOf(X, tips[1]), parentsOf(X, tips[2]), unplannedAt(X, tips[2]).map((c) => c.target)],
    [['pushed', 'pushed', 'pushed'], true, [c2, tips[0]], [c3, tips[1]], ['api:db/books.k1']], 'each later ship carries the delta commit forward (a merge that changes only the delta) and pushes a fast-forward, with nothing of its own to record')
  const later = calls.filter((c) => c.label === 'ship:api#2' || c.label === 'ship:api#3')
  ok(later.length === 2 && later.every((c) => deltaPayload(c.prompt) === null && scriptOf(c.prompt).includes('# 4a · the design\'s delta')) && !/^DELTA /m.test(ships.out[1] + ships.out[2]) && og(X, `diff --name-only ${c3} ${tips[2]}`) === REL, 'no DELTA step and no DELTA line, no seed commit: the carry-forward only')
  ok(!logs.some((l) => /refuses incremental pushes|push of \S+ failed/.test(l)) && !result.halt, 'no failed push, the ships never stopped')
  X.done()
}

// ══════════════ M11c · a resumed run: origin ahead of the local run branch by a delta commit ══════════════
// The earlier session's ship committed PROJ-1's kept change on the remote; PROJ-2 then landed locally
// and the session ended before its ship. Local and origin have diverged by the delta commit alone:
// the reconcile says so (sync=delta-ahead) instead of refusing the run, and the first ship after the
// resume carries the commit forward.
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1'), c2 = X.commit('c2'), c3 = X.commit('c3')
  const first = []
  await run('M11c (earlier session) · PROJ-1 keeps a change; its ship commits it', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X, first),
  }), { args: inRepo(X), index: { deltaFound: true } })
  const d1 = X.origin()
  ok(parentsOf(X, d1).join() === c1 && X.sh(`git rev-parse refs/heads/${RUN_BRANCH}`, X.W) === c3, '(the remote one delta commit past c1; the local run branch at c3, PROJ-2 landed there unshipped)')
  const landed = (id, head) => ({ id, repo: 'api', status: 'DONE', ticket: id, title: `Title of ${id}`, runBranch: RUN_BRANCH, firstSha: head, headSha: head })
  const resumeState = { version: 2, runId: 'run-97', attempt: 1, lastSeq: 1, landedTasks: [landed('PROJ-1', c1), landed('PROJ-2', c2)] }
  const tasks = [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] }), T('PROJ-3', { dependsOn: ['PROJ-2'] })]
  // the reconcile script this resume runs, for real against the sandbox
  const probe = await run('M11c (the reconcile script)', tasks, by({}), { args: inRepo(X, { resumeState }), index: { deltaFound: true, inputProblems: ['stop after the index'] } })
  const rs = (/## Also RECONCILE[\s\S]*?```bash\n([\s\S]*?)\n```/.exec(probe.prompt('parse-index')) || [])[1] || ''
  const line = (X.exec('bash', rs).out.match(/^.*BRANCH repo=api .*$/m) || [''])[0]
  ok(line.includes(`BRANCH repo=api local=${c3} remote=${d1} sync=delta-ahead fetch=ok`), `the reconcile: diverged by the delta's own commit alone → sync=delta-ahead (${line.trim()})`)
  ok(X.sh(`git rev-parse refs/heads/${RUN_BRANCH}`, X.W) === c3, '… and it moved nothing')
  // the resumed run: PROJ-1 and PROJ-2 absorbed, PROJ-3 built (keeping nothing)
  const ships = [], tips = []
  const ship = (p) => { const r = shipFor(X, ships)(p); tips.push(X.origin()); return r }
  const TASK = (id, sha) => ({ id, repo: 'api', sha, local: true, origin: false, onBranch: true, inBase: 'no', first: 'none', firstOk: 'none' })
  const { result, logs, labels } = await run('M11c · resumed: the first ships after the resume carry the delta commit forward', tasks, by({
    'impl:PROJ-3': impl(c3.slice(0, 7), c2.slice(0, 7)),
    'ship:api#1': ship, 'ship:api#2': ship,
  }), { args: inRepo(X, { resumeState }), index: { deltaFound: true, reconcile: [TASK('PROJ-1', c1), TASK('PROJ-2', c2)], runBranches: [{ repo: 'api', local: c3, remote: d1, sync: 'delta-ahead', fetch: 'ok' }] } })
  ok(!result.error && !labels.includes('impl:PROJ-1') && !labels.includes('impl:PROJ-2') && result.done.map((d) => d.id).join() === 'PROJ-3', `not refused: PROJ-1 and PROJ-2 absorbed, PROJ-3 built (${result.error || 'ok'})`)
  ok(logs.some((l) => l.includes(`origin/${RUN_BRANCH} holds the design's delta commits the local run branch lacks`)), 'the log says why the branches differ')
  const tip = X.origin()
  eq([ships.out.length > 0 && ships.out.every((o) => /^PUSH ok=1 /m.test(o)), X.sh(`git --git-dir=origin.git merge-base --is-ancestor ${d1} ${tip} && echo yes`), X.sh(`git --git-dir=origin.git merge-base --is-ancestor ${c3} ${tip} && echo yes`), og(X, `diff --name-only ${c3} ${tip}`), unplannedAt(X, tip).map((c) => c.target)],
    [true, 'yes', 'yes', REL, ['api:db/books.k1']], "the remote's delta commit is carried forward on the first ships after the resume: fast-forward pushes, the landed heads and the entry all there")
  ok(!logs.some((l) => /refuses incremental pushes|push of \S+ failed/.test(l)), 'no failed push')
  X.done()
}

// ══════════════ M12 · two lanes landing together: one delta commit; the lock held, nothing moves ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c0 = X.commit('c0'), c2 = X.commit('c2')
  const L0 = T('PROJ-0', { files: ['src/zero.ts — add it'] })
  const L1 = T('PROJ-1', { dependsOn: ['PROJ-0'], files: ['src/one.ts — add it'] }), L2 = T('PROJ-2', { dependsOn: ['PROJ-0'], files: ['src/two.ts — add it'] })
  const ships = []
  const { calls } = await run('M12 · two lanes land while the first ship is in flight: one delta commit', [L0, L1, L2], by({
    'impl:PROJ-0': impl(c0.slice(0, 7)),
    'impl:PROJ-1': { ...impl('1111111'), modelChanges: [keptAs(1)] },
    'impl:PROJ-2': { ...impl('2222222'), modelChanges: [keptAs(2)] },
    'integrate:PROJ-1': { status: 'MERGED', headSha: c2.slice(0, 7) },
    'integrate:PROJ-2': { status: 'MERGED', headSha: c2.slice(0, 7) },
    'ship:api#1': async (p) => { await tick(400); return shipFor(X, ships)(p) },
    'ship:api#2': shipFor(X, ships),
  }), { args: inRepo(X, { maxPerRepo: 2 }), index: { deltaFound: true } })
  const tip = X.origin()
  eq([calls.filter((c) => c.label.startsWith('ship:')).length, og(X, `rev-list --count ${c2}..${tip}`), parentsOf(X, tip), og(X, `diff --name-only ${c2} ${tip}`), unplannedAt(X, tip).map((c) => c.target), ships.out[1].match(/^DELTA .*/gm).length],
    [2, '1', [c2], REL, ['api:db/books.k1', 'api:db/books.k2'], 1], 'the two landings coalesce into one ship: one delta commit on the landed head, both entries in it, one DELTA line')

  // the same ship script with the lock held by a live ship of another session: it waits, then moves nothing
  const s2 = scriptOf(calls.filter((c) => c.label === 'ship:api#2')[0].prompt)
  const LK = join(X.W, '.git', 'grimoire-ship-api.lock')
  const holder = spawn('sleep', ['30'])
  mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `${holder.pid} ${Math.floor(Date.now() / 1000)} ship\n`)
  const busy = X.exec('bash', s2, { GRIMOIRE_SHIP_LOCK_WAIT: '1' })
  ok(/^LOCK busy/m.test(busy.out) && /^DELTA skipped lock=0$/m.test(busy.out) && X.origin() === tip, 'with the lock held by another: DELTA skipped, nothing committed or pushed')
  holder.kill()
  X.done()
}

// ══════════════ M13 · a commit hook that fails: the ship and the push stay green, the entry waits ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1'), c2 = X.commit('c2')
  const hook = join(X.W, '.git', 'hooks', 'pre-commit')
  const ships = [], tips = []
  const { result, logs, prompt } = await run('M13 · the first delta commit is refused by a pre-commit hook; the next ship records it', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'impl:PROJ-2': impl(c2.slice(0, 7), c1.slice(0, 7)),
    'ship:api#1': (p) => { mkdirSync(join(X.W, '.git', 'hooks'), { recursive: true }); writeFileSync(hook, '#!/bin/sh\necho "lint: refused" >&2\nexit 1\n'); chmodSync(hook, 0o755); const r = shipFor(X, ships)(p); rmSync(hook); tips.push(X.origin()); return r },
    'ship:api#2': (p) => { const r = shipFor(X, ships)(p); tips.push(X.origin()); return r },
  }), { args: inRepo(X), index: { deltaFound: true } })
  ok(new RegExp(`^PUSH ok=1 remote=${c1}$`, 'm').test(ships.out[0]) && /^DELTA bad step=commit$/m.test(ships.out[0]) && tips[0] === c1, 'the commit failed: the push of the landed head went through, nothing else reached the remote')
  ok(logs.some((l) => /^⚠ ship:api#1: the design's delta was not written \(DELTA bad: DELTA bad step=commit.*\) — its 1 unplanned change\(s\) wait for the next ship$/.test(l)) && !logs.some((l) => /refuses incremental pushes/.test(l)), 'said in the run log; the push counts as green')
  eq([deltaPayload(prompt('ship:api#2')).map((e) => e.target), parentsOf(X, tips[1]), og(X, `diff --name-only ${c2} ${tips[1]}`), unplannedAt(X, tips[1]).map((c) => c.target)], [['api:db/books.k1'], [c2], REL, ['api:db/books.k1']], 'the next ship carries the pending entry and commits it on its landed head')
  ok(!result.halt && result.dataModel.changes[0].delta === 'added' && !result.dataModel.unrecorded.length, 'nothing halted; the change reached the delta in the end')
  X.done()
}

// ══════════════ M14 · deliver: 'end' — the seal commits the delta on what the gate pushed ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  const before = readFileSync(join(X.W, REL), 'utf8')
  let sealOut = '', sealPrompt = ''
  const { result, labels } = await run('M14 · deliver: end — the seal writes, commits and pushes the delta', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'gate:api': () => { X.sh(`git push -q origin ${c1}:refs/heads/${RUN_BRANCH}`, X.W); X.pr.set('url', PR_URL); return { status: 'DONE', summary: 'green', prUrl: PR_URL } },
    'seal:api': (p) => { sealPrompt = p; sealOut = X.exec('bash', scriptOf(p)).out; return { sealed: /^SEAL ok=1/m.test(sealOut), prUrl: PR_URL, ...deltaOf(sealOut) } },
  }), { args: inRepo(X, { deliver: 'end' }), index: { deltaFound: true } })
  const tip = X.origin()
  ok(!labels.some((l) => l.startsWith('ship:')) && sealPrompt.includes('Then return what its SEAL and DELTA lines say'), 'no land ship ran; the seal carries the change')
  eq([parentsOf(X, tip), og(X, `diff --name-only ${c1} ${tip}`), unplannedAt(X, tip).map((c) => c.target), new RegExp(`^DELTA ok added=1 already=0 refused=0 commit=${tip.slice(0, 7)}$`, 'm').test(sealOut)], [[c1], REL, ['api:db/books.k1'], true],
    'one commit on the head the gate pushed, touching only the delta, pushed by the seal')
  ok(readFileSync(join(X.W, REL), 'utf8') === before && result.dataModel.changes[0].delta === 'added', "the checkout's delta untouched; the result says it reached the delta")
  X.done()
}

// ══════════════ M15 · the design's delta not on the run branch yet: added from the checkout's copy ══════════════
{
  const X = sandbox()
  deltaInRepo(X, { commit: false }) // written by the design in the checkout, never committed
  const c1 = X.commit('c1')
  const before = readFileSync(join(X.W, REL), 'utf8')
  const ships = []
  const { prompt } = await run('M15 · the run branch has no delta at the landed head', [T('PROJ-1')], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'ship:api#1': shipFor(X, ships),
  }), { args: inRepo(X), index: { deltaFound: true } })
  const tip = X.origin()
  const atTip = JSON.parse(og(X, `show ${tip}:${REL}`))
  eq([parentsOf(X, tip), og(X, `diff --name-status ${c1} ${tip}`), atTip.data.map((c) => c.id).slice(0, 3), atTip.data.filter((c) => c.origin === 'unplanned').map((c) => c.target)], [[c1], `A\t${REL}`, ['isbn', 'due', 'loans'], ['api:db/books.k1']],
    "one commit adds the design's delta, as the checkout holds it, with the unplanned entry appended")
  ok(og(X, `log -1 --format=%b ${tip}`).includes("The design's delta was not on this branch yet: added as the orchestrating checkout holds it.") && /^DELTA ok added=1 /m.test(ships.out[0]), 'its message says so')
  ok(readFileSync(join(X.W, REL), 'utf8') === before && X.sh(`git status --porcelain -- ${REL}`, X.W) === `?? ${REL}`, "the checkout's copy byte-identical, still uncommitted there")

  // the gate: its step 1 commits what is uncommitted, the design's delta with it, so the delta was
  // added on both sides; SYNC keeps the checkout's version and appends the remote's unplanned change
  X.sh(`git add -- ${REL} && git commit -q -m 'docs: the design delta'`, X.W)
  const g = X.sh('git rev-parse HEAD', X.W)
  const B = blocksOf(prompt('gate:api')), pick = (s) => B.find((b) => b.includes(s)) || ''
  const so = X.exec('bash', pick('SYNC ok')).out.trim()
  const head = X.sh('git rev-parse HEAD', X.W)
  const local = JSON.parse(readFileSync(join(X.W, REL), 'utf8'))
  eq([so, X.sh(`git rev-list --parents -n 1 ${head}`, X.W).split(' ').slice(1), local.data.map((c) => c.id).slice(0, 3), local.data.filter((c) => c.origin === 'unplanned').map((c) => c.target), X.sh('git status --porcelain -- docs', X.W)],
    [`SYNC ok head=${head}`, [g, tip], ['isbn', 'due', 'loans'], ['api:db/books.k1'], ''], "the delta added on both sides: SYNC merges, keeping the checkout's version with the remote's unplanned change appended")
  X.exec('bash', pick('shiplock gate'))
  ok(/^PUSH exit=0$/m.test(X.exec('bash', pick('push -u origin')).out) && X.origin() === head, "the gate's push is a fast-forward")
  X.done()
}

// ══════════════ M17 · the delta changed on both sides: an acknowledgement swept into a task's commit ══════════════
{
  const X = sandbox()
  deltaInRepo(X)
  const c1 = X.commit('c1')
  // the next task's commit also carries an acknowledgement the owner made in `serve` on the checkout
  // (its `git add -A` swept it in), on the last planned change: next to where a ship appends
  const { setAcks, changeHash } = await import('../../tools/graph/lib/data/delta.mjs')
  writeFileSync(join(X.W, REL), setAcks(readFileSync(join(X.W, REL), 'utf8'), [[2, { by: 'owner', at: '2026-11-07T10:00:00Z', hash: changeHash(PLANNED[2]) }]]))
  X.sh(`git commit -q -am 'feat: PROJ-2'`, X.W)
  const c2 = X.sh('git rev-parse HEAD', X.W)
  const ships = [], tips = []
  const ship = (p) => { const r = shipFor(X, ships)(p); tips.push(X.origin()); return r }
  const { result } = await run('M17 · the second landing acknowledged a planned change in the delta: the carry-forward merge conflicts', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })], by({
    'impl:PROJ-1': { ...impl(c1.slice(0, 7)), modelChanges: [keptAs(1)] },
    'impl:PROJ-2': { ...impl(c2.slice(0, 7), c1.slice(0, 7)), modelChanges: [keptAs(2)] },
    'ship:api#1': ship, 'ship:api#2': ship,
  }), { args: inRepo(X), index: { deltaFound: true } })
  const merge = parentsOf(X, tips[1])[0]
  const atTip = JSON.parse(og(X, `show ${tips[1]}:${REL}`))
  eq([ships.out.map((o) => /^PUSH ok=1 /m.test(o)), parentsOf(X, merge), og(X, `diff --name-only ${c2} ${tips[1]}`), atTip.data.find((c) => c.id === 'loans').ack && atTip.data.find((c) => c.id === 'loans').ack.by, atTip.data.filter((c) => c.origin === 'unplanned').map((c) => c.target)],
    [[true, true], [c2, tips[0]], REL, 'owner', ['api:db/books.k1', 'api:db/books.k2']],
    "the merge keeps the branch's version (the acknowledgement) and appends the remote's unplanned change; the push goes through, the new entry on top")
  const mm = og(X, `log -1 --format=%B ${merge}`).trim().split('\n\n')
  eq([mm[0], mm.at(-1), /Conflicts/.test(mm.join('\n'))], [`chore(data): carry ${REL} forward from the run branch`, 'Grimoire-Run: run-97', false], "the resolved merge's message: its subject, the run's trailer last, no conflict list")
  ok(!result.halt && result.dataModel.changes.every((c) => c.delta === 'added'), 'both reached the delta; nothing halted')
  X.done()
}

// ══════════════ M16 · two repositories: the delta lives in one; the other's kept change goes to its ships ══════════════
{
  const WEB = { name: 'web', path: 'repositories/web', agent: 'frontend-engineer', tags: ['frontend'], gate: null }
  const webChange = { target: 'web:db/carts.note', op: 'add', kept: true, reason: 'the cart shows it', after: { type: 'TEXT', nullable: true } }
  const { calls, prompt, result } = await run('M16 · a kept change in web; the delta in api', [T('PROJ-1'), T('PROJ-2', { repo: 'web', agent: 'frontend-engineer', dependsOn: ['PROJ-1'] })], by({
    'impl:PROJ-2': { ...impl('bbbbbbb'), modelChanges: [webChange] },
    'ship:api#2': (p) => ({ pushed: true, remoteHead: headOf(p), prUrl: PR_URL, draft: true, delta: 'ok', deltaAdded: 1, deltaAlready: 0, deltaRefused: 0, deltaCommit: 'ccccccc' }),
  }), { args: { ...ARGS, specPath: 'repositories/api/docs/specs/x.md', repos: [API, WEB] }, index: { deltaFound: true } })
  const withDelta = calls.filter((c) => /^(ship|seal):/.test(c.label) && deltaPayload(c.prompt)).map((c) => c.label)
  eq([withDelta, deltaPayload(prompt('ship:api#2')).map((e) => e.target)], [['ship:api#2'], ['web:db/carts.note']], "web's kept change is recorded by a ship of api, the repository that holds the delta (one sent for it, its head already pushed); no web ship writes the delta")
  ok(scriptOf(prompt('ship:api#2')).includes(`git -C "$W" add -- '${REL}'`), '… committed there, on api\'s run branch')
  ok((section(heredocs(prompt('ship:web#1'))[0]) || []).at(-1).includes("in its own commit on `feat/proj-700-api` (api's run branch: the delta lives there)"), "web's PR says where the delta is committed")
  ok((section(bodyOf(prompt('ship:api#2'))) || []).includes('- the delta on this branch also records what web kept: `web:db/carts.note` · PROJ-2 (listed in web\'s PR)'), "api's PR says its delta commit also carries web's change")
  eq(result.dataModel.changes.map((c) => [c.repo, c.delta]), [['web', 'added']], 'the result says it reached the delta')
}

// ══════════════ the engine and the graph tell an architecture target alike ══════════════
// (the engine imports nothing: its one-line isArchTarget, matched in its own source, is evaluated here)
{
  const { isArchTarget } = await import('../../tools/graph/lib/data/delta.mjs')
  const src = readFileSync(join(REPO, 'workflows/orchestrate-loop.js'), 'utf8')
  const line = /^const isArchTarget = (\(t\) => .+)$/m.exec(src)
  const engine = line ? new Function(`return ${line[1]}`)() : () => null
  const cases = ['component:x', 'connection:a->b', 'connection:a->b#l', 'boundary:Edge', 'components:x', 'component', 'connector:a->b', 'Component:x', '', 'api:db/books.isbn']
  eq([!!line, cases.map((t) => engine(t)), cases.map((t) => engine(t) === isArchTarget(t)).every(Boolean)], [true, [true, true, true, true, false, false, false, false, false, false], true],
    "the engine's isArchTarget (it imports nothing) agrees with delta.mjs's on targets and near-misses")
}

// ══════════════ the briefs and the return contract say it ══════════════
{
  console.log('\n── the briefs, the agents and the roster carry the contract')
  const read = (f) => readFileSync(join(REPO, f), 'utf8')
  ok(/## Data model changes/.test(read('workflows/briefs/implement.md')) && /never a reason to stop/i.test(read('workflows/briefs/implement.md')) && /Never edit the delta/.test(read('workflows/briefs/implement.md')), 'implement.md: run graph_changes, keep or revert each unplanned change with a reason, never stop for one, never edit the delta')
  ok(/## The design's delta/.test(read('workflows/briefs/hydrate.md')), 'hydrate.md: copy each task\'s planned changes')
  ok(/never a finding by itself/.test(read('workflows/briefs/review.md')) && /on its merits/.test(read('workflows/briefs/review.md')), 'review.md: an unplanned change is never a finding by itself; a wrong one is, on its merits')
  ok(/DELTA/.test(read('workflows/briefs/ship.md')) && /deltaAdded/.test(read('workflows/briefs/ship.md')) && /deltaCommit/.test(read('workflows/briefs/ship.md')), 'ship.md maps the DELTA lines, the commit included')
  ok(/SYNC/.test(read('workflows/briefs/gate.md')), 'gate.md says when to run the SYNC script and what its lines mean')
  ok(['templates/team-agent.md', 'agents/migration-engineer.md', 'agents/test-engineer.md', 'AGENTS.md'].every((f) => /modelChanges/.test(read(f))), 'the team-agent template, both specialists and the roster\'s return contract name modelChanges')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
