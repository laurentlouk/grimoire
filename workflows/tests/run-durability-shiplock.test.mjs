// Run-durability · the ship lock is a file (workflows/scripts/ship-lock.sh), not text an agent retypes.
//
// The lock's functions (its mutex, take, release, the gate's heartbeat, the ship's unlock) were pasted
// into every ship, seal and gate prompt: the gate retyped about 13 kB of them per repo (its prompt grew
// from about 10 kB to 18 kB), the ship about 7 kB of its 16-kB script, and a mistyped line is a broken
// lock. Like the journal writer, they now ship with the engine as a file that every lock script
// sources after a cksum check; a file missing or altered prints LOCK missing and moves nothing, and the
// engine sends that dispatch again, and every later lock script, with the lock inline.
//   SL-1  the file is the engine's SHIP_LOCK byte for byte; --check fails on a drifted file
//   SL-2  no lock script carries the functions; the gate's prompt and its lock scripts are bounded
//   SL-3  a missing file: the first ship prints LOCK missing and moves nothing; it is sent again inline
//   SL-4  an altered file of the same size (only its cksum differs): the same
//   SL-5  the gate finds the file missing: BLOCKED (lock), sent again inline, takes, pushes, releases;
//         gates (and ships) built with the file that answer after another switched the run: the same
//   SL-6  the seal finds the file missing: sent again inline, the marker sealed
// The scripts run for real against a temp git sandbox with a fake gh (the lock windows themselves, in
// both modes and every shell, are run-durability-final's F-6).

import { run, by, happy, later, headOf, API, T, impl, QUIET, PR_URL, RUN_BRANCH, SCRIPTS, sandbox, getScripts, scriptOf, realRepo, receipt, SHELLS, spawnSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, join } from './support/script-harness.mjs'
import { mkdtempSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'

let PASS = 0
let FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const section = (t) => console.log(`\n── ${t}`)
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const FILE = join(SCRIPTS, 'ship-lock.sh')
const read = (f) => { try { return readFileSync(f, 'utf8') } catch (e) { return null } }
const block = (re, p) => ((re.exec(p || '') || [])[1] || '').replace(/^ {2}/gm, '')
const gateTake = (p) => block(/Before you push, take this repo's SHIP LOCK[\s\S]*?```bash\n([\s\S]*?)\n {2}```/, p)
const gateRelease = (p) => block(/Release it once the PR is done[^\n]*\n {2}```bash\n([\s\S]*?)\n {2}```/, p)
const gatePush = (p) => block(/Push the (?:final head|run branch)[\s\S]*?```bash\n([\s\S]*?)\n {2}```/, p)
const FUNCS = ['lkin() {', 'shiplock() {', 'lkrel() {', 'lkbeat() {', 'shipunlock() {']
const carriesLock = (s) => FUNCS.some((f) => s.includes(f))
const bytes = (s) => Buffer.byteLength(s || '')
const missingLog = (logs) => logs.filter((l) => /ship-lock\.sh is missing or differs/.test(l)).length
const TMP = mkdtempSync(join(tmpdir(), 'grim-sl-'))
let n = 0
const fresh = (tag) => { const d = join(TMP, `${tag}-${++n}`); mkdirSync(d, { recursive: true }); return d }
const SHELL = SHELLS[0] || 'sh'
const LAST = SHELLS[SHELLS.length - 1] || 'sh' // dash where it is installed (CI)

// ══════════════ SL-1 · the file is the engine's lock; --check fails on drift ══════════════
{
  section('SL-1 · workflows/scripts/ship-lock.sh is the engine\'s SHIP_LOCK, and --check fails on a drifted copy')
  const builder = await import('../../scripts/build-ship-lock.mjs').catch(() => null)
  ok(!!builder && typeof builder.lockText === 'function' && builder.LOCK_FILE === FILE, 'scripts/build-ship-lock.mjs exports lockText() and LOCK_FILE (workflows/scripts/ship-lock.sh)')
  const text = builder ? builder.lockText() : ''
  ok(!!text && read(FILE) === text, 'the file is the engine\'s SHIP_LOCK byte for byte (else: node scripts/build-ship-lock.mjs)')
  ok(FUNCS.every((f) => text.includes(f)) && text.includes('now() {'), 'it holds the clock, the mutex, the take, the release, the heartbeat and the ship\'s unlock')
  const check = (root) => spawnSync(process.execPath, [join(root, 'scripts', 'build-ship-lock.mjs'), '--check'], { encoding: 'utf8' })
  const here = check(ROOT)
  ok(here.status === 0, `node scripts/build-ship-lock.mjs --check passes on this tree${here.status ? ` (${(here.stderr || '').trim()})` : ''}`)
  // a copy of the tree whose file drifted from its engine: same layout, one character changed
  const T1 = fresh('tree')
  mkdirSync(join(T1, 'scripts')); mkdirSync(join(T1, 'workflows', 'scripts'), { recursive: true })
  if (existsSync(join(ROOT, 'scripts', 'build-ship-lock.mjs'))) cpSync(join(ROOT, 'scripts', 'build-ship-lock.mjs'), join(T1, 'scripts', 'build-ship-lock.mjs'))
  cpSync(join(ROOT, 'workflows', 'orchestrate-loop.js'), join(T1, 'workflows', 'orchestrate-loop.js'))
  writeFileSync(join(T1, 'workflows', 'scripts', 'ship-lock.sh'), (read(FILE) || '').replace('LOCK busy', 'LOCK bust'))
  const drifted = check(T1)
  ok(drifted.status === 1 && /ship-lock\.sh differs from the engine's SHIP_LOCK/.test(drifted.stderr) && /node scripts\/build-ship-lock\.mjs/.test(drifted.stderr), 'a drifted file fails --check, naming the command that rewrites it')
  const rebuilt = spawnSync(process.execPath, [join(T1, 'scripts', 'build-ship-lock.mjs')], { encoding: 'utf8' })
  ok(rebuilt.status === 0 && check(T1).status === 0 && read(join(T1, 'workflows', 'scripts', 'ship-lock.sh')) === text, 'the builder rewrites it, and --check passes again')
}

// ══════════════ SL-2 · no lock script retypes the lock; the gate's prompt is bounded ══════════════
{
  section('SL-2 · every lock script sources the file; the gate\'s prompt and its lock scripts are bounded')
  const X = sandbox()
  const c1 = X.commit('c1')
  const file = await getScripts(X, c1, {}, { inline: false })
  const inline = await getScripts(X, c1, {}, { inline: true })
  const scripts = (g) => ({ take: gateTake(g.gate), release: gateRelease(g.gate), push: gatePush(g.gate), land: scriptOf(g.land), seal: scriptOf(g.seal) })
  const f = scripts(file), i = scripts(inline)
  ok(Object.values(f).every((s) => s.includes('. "$LKF"') && !carriesLock(s)), 'the ship, the seal and the gate\'s take, release and push each source the file and carry none of its functions')
  ok(Object.values(i).every((s) => carriesLock(s) && !s.includes('$LKF')), 'their fallback (the file missing) carries the lock inline')
  // The scripts name the sandbox and this checkout's scripts directory by absolute path, whose length
  // is the machine's (macOS's TMPDIR, a deep worktree), not the engine's: the bounds measure the shell
  // besides those paths. Each one is the earlier bound less the paths it held on CI's runner (about
  // 263 bytes for the three lock scripts), rounded down.
  const shell = (s) => bytes((s || '').replaceAll(X.W, '').replaceAll(X.T0, '').replaceAll(SCRIPTS, ''))
  const locks = shell(f.take) + shell(f.release) + shell(f.push)
  const was = shell(i.take) + shell(i.release) + shell(i.push)
  console.log(`   besides their paths · gate prompt: ${shell(file.gate)} bytes (${shell(inline.gate)} with the lock inline) · its three lock scripts: ${locks} bytes (${was} inline) · ship script: ${shell(f.land)} (${shell(i.land)}) · seal script: ${shell(f.seal)} (${shell(i.seal)})`)
  ok(shell(file.gate) < 7700, `the gate's prompt is under 7,700 bytes besides its paths (${shell(file.gate)})`)
  ok(locks < 2300, `the gate's three lock scripts together are under 2,300 bytes besides their paths (${locks}, against ${was} inline)`)
  ok(shell(f.land) < 9350 && shell(i.land) - shell(f.land) > 6100, `the ship script retypes ${shell(i.land) - shell(f.land)} bytes fewer (${shell(f.land)} against ${shell(i.land)}, besides their paths)`)
  ok(shell(f.seal) < 4400, `the seal script is under 4,400 bytes besides its paths (${shell(f.seal)})`)
  ok(/`LOCK missing`[^\n]*failedStep `lock`/.test(file.gate) && !/`LOCK missing`/.test(inline.gate), 'the gate is told what LOCK missing means (only while its scripts use the file)')
  const ship = read(join(ROOT, 'workflows', 'briefs', 'ship.md')) || '', gate = read(join(ROOT, 'workflows', 'briefs', 'gate.md')) || ''
  ok(/`lockMissing`: a `LOCK missing` line/.test(ship) && /never write, copy\s+or look for/i.test(ship), 'ship.md maps LOCK missing to lockMissing, and forbids fixing the file by hand')
  ok(/`LOCK missing`/.test(gate) && /`failedStep: lock`/.test(gate), 'gate.md: LOCK missing → BLOCKED with failedStep lock')
  X.done()
}

// A run with its own scriptsDir: land ships, the gate and the seal as stubs or real runs
// what the sandbox holds right after a script ran: the lock, the ship worktree, the gh calls, the PR body
const state = (X) => ({ lock: existsSync(join(X.W, '.git', 'grimoire-ship-api.lock')), worktrees: existsSync(join(X.W, '.worktrees')), gh: X.pr.ops().length, body: X.pr.body(), origin: X.origin() })
const shipReal = (X, shell, outs, tag) => (p) => { outs[tag] = X.exec(shell, scriptOf(p)).out; outs[`${tag}.after`] = state(X); return receipt(outs[tag]) }

// ══════════════ SL-3 · a missing file: LOCK missing, nothing moves, sent again inline ══════════════
for (const [id, shell, what, setup] of [
  ['SL-3', SHELL, 'missing', (d) => d],
  // the same size, other bytes: only the cksum tells it apart
  ['SL-4', LAST, 'altered (same size, other bytes)', (d) => { writeFileSync(join(d, 'ship-lock.sh'), (read(FILE) || '').replace('LOCK busy', 'LOCK bust')); return d }],
]) {
  const X = sandbox()
  const c1 = X.commit('c1')
  const dir = setup(fresh('scripts'))
  const outs = {}
  const r = await run(`${id} · [${shell}] the lock's file is ${what}: the first ship moves nothing and is sent again inline`, [T('PROJ-1')],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'ship:api#1': shipReal(X, shell, outs, 1), 'ship:api#1.inline': shipReal(X, shell, outs, 2) }),
    { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false, scriptsDir: dir } })
  if (what !== 'missing') ok(bytes(read(join(dir, 'ship-lock.sh'))) === bytes(read(FILE)), 'the altered file has the engine\'s byte count')
  const first = (outs[1] || '').trim()
  ok(first === `LOCK missing: ${join(dir, 'ship-lock.sh')}`, `the first ship prints LOCK missing and nothing else (${JSON.stringify(first.slice(0, 120))})`)
  const after = outs['1.after'] || {}
  ok(after.lock === false && after.worktrees === false && after.gh === 0 && after.origin === '', 'it took no lock, made no worktree, called no gh and pushed nothing')
  ok(r.labels.filter((l) => l === 'ship:api#1.inline').length === 1, 'it is sent again, once, with the lock inline')
  ok(/^LOCK ok$/m.test(outs[2] || '') && /^PUSH ok=1 /m.test(outs[2] || '') && /^PR ok=1 url=\S+ action=created$/m.test(outs[2] || '') && X.origin() === c1, 'the inline ship takes the lock, pushes the landed SHA and opens the draft PR')
  const later = r.calls.filter((c) => /^(gate|seal):/.test(c.label))
  ok(later.length >= 2 && later.every((c) => carriesLock(c.prompt) && !c.prompt.includes('$LKF')), 'every later lock script (the gate\'s, the seal\'s) carries the lock inline')
  ok(missingLog(r.logs) === 1 && r.result.telemetry.inlineShipLock === true, 'logged once; telemetry.inlineShipLock')
  X.done()
}

// ══════════════ SL-5 · the gate finds the file missing ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const dir = fresh('scripts')
  const outs = {}
  const gate = (tag, status) => (p) => {
    outs[tag] = { take: X.exec(SHELL, gateTake(p)).out }
    if (/^LOCK missing/m.test(outs[tag].take)) return { status: 'BLOCKED', summary: 'LOCK missing', failedStep: 'lock' }
    outs[tag].push = X.exec(SHELL, gatePush(p)).out
    outs[tag].release = X.exec(SHELL, gateRelease(p)).out
    return { status, summary: 'green', prUrl: PR_URL, headSha: c1 }
  }
  const r = await run(`SL-5 · [${SHELL}] deliver: end — the gate is the first to find the lock's file missing`, [T('PROJ-1')],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'gate:api': gate(1, 'DONE'), 'gate:api.inline': gate(2, 'DONE'), 'seal:api': (p) => { outs.seal = p; return { sealed: true, already: true, prUrl: PR_URL } } }),
    { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false, deliver: 'end', scriptsDir: dir } })
  ok(/^LOCK missing: /m.test(outs[1] ? outs[1].take : '') && !outs[1].push && !existsSync(join(X.W, '.git', 'grimoire-ship-api.lock')), 'the first gate\'s take prints LOCK missing and takes nothing; it returns BLOCKED (lock) without pushing')
  ok(r.labels.filter((l) => l === 'gate:api').length === 1 && r.labels.filter((l) => l === 'gate:api.inline').length === 1, 'the gate is sent again, once, with the lock inline')
  const o = outs[2] || {}
  ok(/^LOCK ok \//m.test(o.take || '') && /^PUSH exit=0$/m.test(o.push || '') && /^LOCK released$/m.test(o.release || '') && X.origin() === c1 && !existsSync(join(X.W, '.git', 'grimoire-ship-api.lock')), 'the inline gate takes the lock, pushes the run branch and releases the lock')
  ok(r.result.prs.some((p) => p.repo === 'api') && !(r.result.ungatedRepos || []).includes('api'), 'the repo gated: its PR is reported, not an ungated repo')
  ok(!!outs.seal && carriesLock(outs.seal) && missingLog(r.logs) === 1 && r.result.telemetry.inlineShipLock === true, 'the seal after it carries the lock inline; logged once')
  X.done()
}

// ══════════════ SL-5b · dispatches built with the file, answered after another switched the run ══════════════
// The terminal slots run in parallel, and so do ships of different repos: a dispatch built while the run
// still used the file can answer LOCK missing after another dispatch already switched it to inline. It is
// sent again all the same (its prompt was the file's), never booked as a failure or a busy lock.
{
  const WEB = { name: 'web', path: 'repositories/web', agent: 'web-engineer', tags: ['frontend'], gate: null }
  const repos = [{ ...API, path: 'repositories/api' }, WEB]
  const tasks = [T('PROJ-1'), T('PROJ-2', { repo: 'web', agent: 'web-engineer', files: ['web/proj2.ts — add it'] })]
  const viaFile = (p) => p.includes('LOCK missing: $LKF')
  const delay = { api: 10, web: 120 } // web's answer comes back after api's switched the run to inline
  const repoOf = (label) => (/^\w+:(\w+)/.exec(label) || [])[1]
  const answers = (label, p) => {
    if (/^gate:/.test(label)) return later(viaFile(p) ? { status: 'BLOCKED', summary: 'LOCK missing', failedStep: 'lock' } : { status: 'DONE', summary: 'green', prUrl: `${PR_URL}${repoOf(label)}` }, viaFile(p) ? delay[repoOf(label)] : 0)
    if (/^ship:/.test(label)) return later(viaFile(p) ? { pushed: false, lockMissing: true } : { pushed: true, remoteHead: headOf(p), prUrl: `${PR_URL}${repoOf(label)}`, draft: true }, viaFile(p) ? delay[repoOf(label)] : 0)
    if (/^impl:/.test(label)) return impl(label.endsWith('PROJ-1') ? 'aaaaaaa' : 'bbbbbbb')
    return happy(label, p)
  }
  const gates = await run('SL-5b · deliver: end — two gates built with the file, api\'s LOCK missing first, web\'s after the switch', tasks, answers,
    { args: { ...QUIET, repos, builtinEnvChecks: false, deliver: 'end', scriptsDir: fresh('scripts') } })
  ok(['gate:api', 'gate:web', 'gate:api.inline', 'gate:web.inline'].every((l) => gates.labels.filter((x) => x === l).length === 1), `both gates are sent again inline, once each (${gates.labels.filter((l) => /^gate:/.test(l)).join(' ')})`)
  ok((gates.result.ungatedRepos || []).length === 0 && ['api', 'web'].every((r) => gates.result.prs.some((p) => p.repo === r)), `no repo is left ungated (ungated: ${JSON.stringify(gates.result.ungatedRepos || [])})`)
  ok(missingLog(gates.logs) === 1, 'the switch is logged once')
  const ships = await run('SL-5c · two land ships built with the file, api\'s LOCK missing first, web\'s after the switch', tasks, answers,
    { args: { ...QUIET, repos, builtinEnvChecks: false, scriptsDir: fresh('scripts') } })
  ok(['ship:api#1.inline', 'ship:web#1.inline'].every((l) => ships.labels.includes(l)), `both ships are sent again inline (${ships.labels.filter((l) => /^ship:/.test(l)).join(' ')})`)
  ok(ships.result.shipped.web.pushedHead === 'bbbbbbb' && !ships.logs.some((l) => /ship:web#1: .*nothing pushed or rewritten/.test(l)), 'web\'s landing is pushed by its inline ship, not booked as a skipped lock')
}

// ══════════════ SL-6 · the seal finds the file missing ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const dir = fresh('scripts')
  writeFileSync(join(dir, 'ship-lock.sh'), read(FILE) || '')
  X.pr.set('url', PR_URL); X.pr.set('draft', 'false'); X.pr.set('body', 'The gate\'s body\n')
  const outs = {}
  const seal = (tag) => (p) => { outs[tag] = X.exec(SHELL, scriptOf(p)).out; outs[`${tag}.after`] = state(X); return { sealed: /^SEAL ok=1/m.test(outs[tag]), already: /already=1/.test(outs[tag]), prUrl: PR_URL, lockMissing: /^LOCK missing/m.test(outs[tag]) } }
  const r = await run(`SL-6 · [${SHELL}] the lock's file goes missing after the gate: the seal moves nothing and is sent again inline`, [T('PROJ-1')],
    by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'gate:api': () => { rmSync(join(dir, 'ship-lock.sh')); return { status: 'DONE', summary: 'green', prUrl: PR_URL } }, 'seal:api': seal(1), 'seal:api.inline': seal(2) }),
    { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false, scriptsDir: dir } })
  const after = outs['1.after'] || {}
  ok((outs[1] || '').trim() === `LOCK missing: ${join(dir, 'ship-lock.sh')}` && after.body === 'The gate\'s body\n' && after.gh === 0 && after.lock === false, 'the seal prints LOCK missing, takes no lock and calls no gh')
  ok(r.labels.filter((l) => l === 'seal:api.inline').length === 1 && /^SEAL ok=1 url=\S+ edited=1$/m.test(outs[2] || '') && /<!-- grimoire:state v1 [A-Za-z0-9+/=]+ -->\n?$/.test(X.pr.body()), 'it is sent again inline, and seals the marker as the body\'s last line')
  ok(missingLog(r.logs) === 1 && r.result.telemetry.inlineShipLock === true, 'logged once; telemetry.inlineShipLock')
  X.done()
}

rmSync(TMP, { recursive: true, force: true })
void RUN_BRANCH
console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
