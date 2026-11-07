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
//  Same stubbed runtime as the other loop tests (support/script-harness.mjs).
import { run, by, T, impl, BLOCKED, QUIET, sandbox, scriptOf, realRepo, receipt, heredocs, PR_URL, tick, spawn, existsSync, readFileSync, writeFileSync, mkdirSync, join } from './support/script-harness.mjs'

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
  const m = /^DELTA (ok|none|bad|skipped)(?: added=(\d+) already=(\d+) refused=(\d+))?/m.exec(out)
  return m ? { delta: m[1], deltaAdded: +(m[2] || 0), deltaAlready: +(m[3] || 0), deltaRefused: +(m[4] || 0), deltaDetail: out.split('\n').filter((l) => /^DELTA (bad|refused)/.test(l)).join('\n') } : {}
}
const shipFor = (X, seen) => (p) => { seen.push(p); const r = X.exec('bash', scriptOf(p)); seen.out = (seen.out || []).concat(r.out); return { ...receipt(r.out), ...deltaOf(r.out) } }
// the delta entries a ship or seal script carries: the base64 payload of its DELTA step
const deltaPayload = (p) => { const s = scriptOf(p); const at = s.indexOf("# 7 · the design's delta"); return at < 0 ? null : JSON.parse(heredocs(s.slice(at))[0]) }
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
  }), { args: { ...ARGS, repos: realRepo(X.W) }, index: { deltaFound: true } })

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
    "Each kept unplanned change is added to the delta (`origin: unplanned`, its reason as `why`) for you to acknowledge in the graph page's Data tab (`graph.mjs serve`). Nothing here blocks the run.",
  ], 'the draft PR (written by the real ship script, through the fake gh) lists planned ✓, pending, built differently, and unplanned ⚠ kept and reverted with their reasons')

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

// ══════════════ the briefs and the return contract say it ══════════════
{
  console.log('\n── the briefs, the agents and the roster carry the contract')
  const read = (f) => readFileSync(join(REPO, f), 'utf8')
  ok(/## Data model changes/.test(read('workflows/briefs/implement.md')) && /never a reason to stop/i.test(read('workflows/briefs/implement.md')) && /Never edit the delta/.test(read('workflows/briefs/implement.md')), 'implement.md: run graph_changes, keep or revert each unplanned change with a reason, never stop for one, never edit the delta')
  ok(/## The design's delta/.test(read('workflows/briefs/hydrate.md')), 'hydrate.md: copy each task\'s planned changes')
  ok(/never a finding by itself/.test(read('workflows/briefs/review.md')) && /on its merits/.test(read('workflows/briefs/review.md')), 'review.md: an unplanned change is never a finding by itself; a wrong one is, on its merits')
  ok(/DELTA/.test(read('workflows/briefs/ship.md')) && /deltaAdded/.test(read('workflows/briefs/ship.md')), 'ship.md maps the DELTA lines')
  ok(['templates/team-agent.md', 'agents/migration-engineer.md', 'agents/test-engineer.md', 'AGENTS.md'].every((f) => /modelChanges/.test(read(f))), 'the team-agent template, both specialists and the roster\'s return contract name modelChanges')
}

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
