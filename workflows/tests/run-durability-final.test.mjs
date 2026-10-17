// Run-durability v0.9.0 · the last review round: the ship lock, the process-group kill, the
// environment re-check and the halt comment under a busy lock.
//
// Grounded in a final adversarial review of the delivery fixes. Each case failed before its fix:
//   F-1  a ship lock that cannot be created looped forever (≈120 takeovers a second) instead of
//        failing fast; the gate's lock script did the same
//   F-2  an environment re-check that answered nothing ({results: []}, or no reply) cleared a REAL
//        failure as transient, and the run replanned instead of halting
//   F-3  two waiters breaking the same stale ship lock could both hold it
//   F-4  a SIGTERM to the ship script's process group left its push and pre-push hook running,
//        outside the lock, and the next ship took the lock over beside them
//   F-5  a halt ship whose lock was busy posted "the push … FAILED" although no push was tried
//   F-6  the takeover's own mutex was broken while its breaker was still inside (its time stamp
//        not written yet read as age 0), so two breakers removed the lock and two ships held it; a
//        lock with no owner line was judged by how long the waiter had waited, not by its own age;
//        a holder whose owner line was not written held the lock anyway; five instant tries at a
//        busy mutex gave up in a tenth of a second; and a gate whose take came back LOCK busy
//        removed the live ship's lock when it released. Then the windows that left open, each
//        closed by one mutex for every change of hands: a release that raced a takeover (the
//        gate's, finding no lock, still ran `rm`; a ship's, against a takeover judged on age); the
//        heartbeat that wrote the gate's owner line over a ship that had taken the lock over; a
//        mutex whose holder was killed inside, its pid reused, that stuck forever; a breaker that
//        acted with its pid unwritten, or no longer in the mutex; and stamps left by killed waiters
// The scripts run for real in bash, zsh and dash against a temp git sandbox with a fake gh. They
// source the lock from workflows/scripts/ship-lock.sh; F-6 also runs every case through the fallback
// (the lock inline), and GRIMOIRE_TEST_SHIP_LOCK=inline runs the whole file that way.

import { run, by, T, impl, BLOCKED, QUIET, envReport, sandbox, getScripts, scriptOf, lockPrefix, realRepo, SHELLS, GITENV, spawn, spawnSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync, join, tick } from './support/script-harness.mjs'

let PASS = 0
let FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

// ══════════════ F-6 · the ship lock's one mutex, an owner-less lock, a lost owner line ══════════════
// On a simulated clock: `date +%s` reads it, and `sleep` moves it on at once, then plays the
// scenario's steps that have come due; `rm`, `find` and `mkdir` can play steps too, so a step lands
// between two of the script's own commands. Every interleaving is replayed exactly, none left to
// timing. Each shell runs its own sandbox, all three at once: nothing here waits on the real clock.
// Every case runs twice per shell, at once: through the lock's file (workflows/scripts/ship-lock.sh,
// sourced after its cksum check) and through the fallback, the scripts that carry the lock inline once
// a script found that file missing.
// It spends its time spawning processes, not waiting on a real clock, so it starts first and runs while
// F-1 … F-5 wait on their real locks and deadlines; its lines are printed at the end, in order.
const F6 = (async () => {
  const X0 = sandbox()
  const c1 = X0.commit('c1')
  const MODES = [['file', await getScripts(X0, c1, {}, { inline: false })], ['inline', await getScripts(X0, c1, {}, { inline: true })]]
  const BASE = Math.floor(Date.now() / 1000)
  const real = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim()
  const R = { rm: real('rm'), mkdir: real('mkdir'), find: real('find'), date: real('date') }
  const dead = spawnSync('true').pid, live = process.pid
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const got = (r) => /^GOT$/m.test(r.out)
  const f6 = async (SHELL, mode, scripts, log) => {
    const ok = (c, m) => { if (c) { PASS++; log(`   ✓ ${m}`) } else { FAIL++; log(`   ✗ FAIL: ${m}`) } }
    const tag = `${SHELL} · ${mode}`
    const land = scriptOf(scripts.land)
    const { prefix: prefix0, close } = lockPrefix(land)
    const gateTake0 = ((/Before you push, take this repo's SHIP LOCK[\s\S]*?```bash\n([\s\S]*?)\n {2}```/.exec(scripts.gate) || [])[1] || '').replace(/^ {2}/gm, '')
    const gateRelease0 = ((/Release it once the PR is done[^\n]*\n {2}```bash\n([\s\S]*?)\n {2}```/.exec(scripts.gate) || [])[1] || '').replace(/^ {2}/gm, '')
    const gatePush0 = ((/Push the (?:final head|run branch)[\s\S]*?```bash\n([\s\S]*?)\n {2}```/.exec(scripts.gate) || [])[1] || '').replace(/^ {2}/gm, '')
    const gateId = (/shiplock gate (\S+);/.exec(gateTake0) || [])[1] || ''
    // the mode is what it says: the file's scripts source it and carry no lock function, the fallback's carry them
    const all = [land, gateTake0, gateRelease0, gatePush0]
    ok(mode === 'file' ? all.every((s) => s.includes('. "$LKF"') && !s.includes('lkin() {')) : all.every((s) => s.includes('lkin() {') && !s.includes('$LKF')), `${tag}: the ship script and the gate's three lock scripts ${mode === 'file' ? 'source the lock\'s file and carry none of its functions' : 'carry the lock inline'}`)
    const X = sandbox()
    const at = (s) => s.split(X0.W).join(X.W) // the same scripts, pointed at this shell's own checkout
    const prefix = at(prefix0), gateTake = at(gateTake0), gateRelease = at(gateRelease0), gatePush = at(gatePush0)
    const LK = join(X.W, '.git', 'grimoire-ship-api.lock'), BRK = `${LK}.brk`
    const SIM = join(X.T0, 'sim'), HOOK = join(X.T0, 'hook'), CLK = join(SIM, 'clock'), STEPS = join(SIM, 'steps')
    mkdirSync(SIM); mkdirSync(HOOK)
    // every fake reads the clock (with `read`: one process per call, not two), names itself (hook) and its
    // arguments (args), then plays the steps due
    const play = (hook) => `read -r c <'${CLK}'; hook=${hook}; args="$*"\n. '${STEPS}'`
    writeFileSync(join(SIM, 'date'), `#!/bin/sh\nif [ "$1" = +%s ]; then ${play('date')}\necho $((${BASE} + c / 10)); else exec ${R.date} "$@"; fi\n`)
    writeFileSync(join(SIM, 'sleep'), `#!/bin/sh\nread -r c <'${CLK}'; case "$1" in *.*) i=\${1%%.*}; d=\${1#*.}; d=\${d%"\${d#?}"}; c=$((c + \${i:-0} * 10 + \${d:-0})) ;; *) c=$((c + $1 * 10)) ;; esac; echo "$c" >'${CLK}'\nhook=sleep; args="$*"\n. '${STEPS}'\nexit 0\n`)
    // rm and find play their steps before they run, mkdir once it made its directory
    writeFileSync(join(HOOK, 'rm'), `#!/bin/sh\n${play('rm')}\nexec ${R.rm} "$@"\n`)
    writeFileSync(join(HOOK, 'find'), `#!/bin/sh\n${play('find')}\nexec ${R.find} "$@"\n`)
    writeFileSync(join(HOOK, 'mkdir'), `#!/bin/sh\n${R.mkdir} "$@" || exit $?\n${play('mkdir')}\nexit 0\n`)
    for (const f of ['date', 'sleep']) chmodSync(join(SIM, f), 0o755)
    for (const f of ['rm', 'find', 'mkdir']) chmodSync(join(HOOK, f), 0o755)
    const exec = (script, env) => new Promise((resolve) => {
      const p = spawn(SHELL, ['-c', script], { cwd: X.T0, env: { ...GITENV, PATH: `${X.BIN}:${process.env.PATH}`, ...env }, timeout: 30000, killSignal: 'SIGKILL' })
      let out = ''
      p.stdout.setEncoding('utf8'); p.stdout.on('data', (d) => (out += d)); p.stderr.resume()
      p.on('close', () => resolve({ out }))
    })
    // steps: [[second, shell, {on, when, every}]], each run once (every: each time) by the first call of
    // `on` (default sleep) at or past its second, `when` (a shell condition) holding
    const clocked = async (wait, script, steps = [], { hooks = false, env = {} } = {}) => {
      writeFileSync(CLK, '0')
      steps.forEach((_, i) => rmSync(join(SIM, `done${i}`), { force: true }))
      writeFileSync(STEPS, `${steps.map(([s, cmd, { on = 'sleep', when = '', every = false } = {}], i) => `if [ "$hook" = ${on} ] && [ "$c" -ge ${s * 10} ]${when ? ` && ${when}` : ''}${every ? '' : ` && [ ! -e '${SIM}/done${i}' ]`}; then ${every ? '' : `: >'${SIM}/done${i}'; `}${cmd}; fi`).join('\n')}\n`)
      const r = await exec(script, { GRIMOIRE_SHIP_LOCK_WAIT: String(wait), PATH: `${hooks ? `${HOOK}:` : ''}${SIM}:${X.BIN}:${process.env.PATH}`, ...env })
      return { ...r, at: Number(readFileSync(CLK, 'utf8')) / 10 }
    }
    const sim = (wait, steps = [], pre = '', opts = {}) => clocked(wait, `${prefix}\n${pre}if shiplock ship; then echo GOT; shipunlock; fi${close}`, steps, opts)
    // another ship, run for real inside a step: it tries once (no wait, so no sleep inside the step), keeps
    // the lock if it gets it, and records the owner line it wrote
    const TOOK = join(SIM, 'took')
    writeFileSync(join(SIM, 'taker.sh'), `${prefix}\nGS=\${TAKER_GS:-0}\nif shiplock ship; then { echo took; cat "$LKP/owner"; } >'${TOOK}'; fi${close}`)
    const taker = (gs = 0) => `GRIMOIRE_SHIP_LOCK_WAIT=0 TAKER_GS=${gs} ${SHELL} '${join(SIM, 'taker.sh')}' >'${SIM}/taker.out' 2>&1`
    const took = () => (existsSync(TOOK) ? readFileSync(TOOK, 'utf8').split('\n')[1] || '' : '')
    const owner = () => (existsSync(join(LK, 'owner')) ? readFileSync(join(LK, 'owner'), 'utf8').trim() : '')
    const reset = () => { try { chmodSync(LK, 0o755) } catch (e) { /* not there */ } rmSync(LK, { recursive: true, force: true }); rmSync(BRK, { recursive: true, force: true }); rmSync(TOOK, { force: true }) }
    const plant = (line) => { reset(); mkdirSync(LK); if (line) writeFileSync(join(LK, 'owner'), `${line}\n`) }

    // a breaker that has made the mutex and not yet written into it: its mutex is not anyone's to break
    plant(`${dead} ${BASE} ship`); mkdirSync(BRK)
    let r = await sim(3)
    ok(/^LOCK busy/m.test(r.out) && !got(r) && !/LOCK stale/.test(r.out) && existsSync(BRK) && owner() === `${dead} ${BASE} ship`, `${tag}: a takeover mutex just made, no pid in it yet, is left to its breaker (LOCK busy after 3 s, nothing taken over)`)
    r = await sim(20)
    ok(/^LOCK stale: ship /m.test(r.out) && got(r) && r.at >= 5 && r.at < 8, `${tag}: the same mutex, still with no pid (its breaker died), is broken once 5 s old by its own age (at ${r.at} s), then the dead lock`)
    // a live breaker's mutex is waited for with a backoff, not given up on after 5 instant tries
    plant(`${dead} ${BASE} ship`); mkdirSync(BRK); writeFileSync(join(BRK, 'pid'), `${live}\n`)
    rmSync(join(SIM, 'intact'), { force: true })
    r = await sim(10, [[2, `[ "$(cat '${BRK}/pid')" = ${live} ] && : >'${SIM}/intact'; rm -rf '${BRK}'`]])
    ok(existsSync(join(SIM, 'intact')) && /^LOCK stale: ship /m.test(r.out) && got(r) && !/LOCK error/.test(r.out) && r.at >= 2 && r.at < 4, `${tag}: a live breaker's mutex is left alone and waited for (no LOCK error); once it is released, the dead lock is taken over (at ${r.at} s)`)
    // a waiter that has already waited 12 s meets a lock made a moment ago, its owner line not yet written
    plant(`${live} ${BASE} ship`)
    r = await sim(30, [[12, `rm -rf '${LK}'; mkdir '${LK}'`], [14, `echo '${live} ${BASE + 14} ship' >'${LK}/owner'`]])
    ok(/^LOCK busy: held by ship \d+/m.test(r.out) && !got(r) && !/LOCK stale/.test(r.out) && owner() === `${live} ${BASE + 14} ship`, `${tag}: an owner-less lock is judged by its own age, not by the 12 s the waiter had waited (LOCK busy, the new holder's lock kept)`)
    plant('')
    r = await sim(30)
    ok(/^LOCK stale: no owner /m.test(r.out) && got(r) && r.at >= 10 && r.at < 13, `${tag}: a lock its taker never wrote an owner line into is taken over once 10 s old (at ${r.at} s)`)
    // the owner line cannot be written (umask 777 makes the new lock unwritable): the lock is not held
    reset()
    if (!asRoot) {
      r = await sim(3, [], 'umask 777\n')
      ok(/^LOCK error: /m.test(r.out) && !got(r) && !existsSync(LK), `${tag}: a lock whose owner line could not be written is not held (LOCK error, the lock removed)`)
    }
    // a gate whose take came back LOCK busy still runs its release ("the moment you stop"): the live ship's lock is not its to remove
    plant(`${live} ${BASE} ship`)
    const take = await clocked(2, gateTake)
    const rel = await exec(gateRelease, {})
    ok(!!gateTake && !!gateRelease && /^LOCK busy/m.test(take.out) && /^LOCK kept: held by ship /m.test(rel.out) && !/LOCK released/.test(rel.out) && owner() === `${live} ${BASE} ship`, `${tag}: a gate whose take came back LOCK busy, then released, leaves the live ship's lock in place (LOCK kept)`)

    // ── every change of hands under the one mutex (the windows #36 left open) ──
    // 1a · the gate's release finds no lock, and a ship takes it at the release's first rm: the ship keeps it
    reset()
    r = await clocked(0, gateRelease, [[0, taker(), { on: 'rm', when: `case " $args " in *" ${LK} "*|*" ${LK}.brk "*) true ;; *) false ;; esac` }]], { hooks: true })
    ok(!!gateRelease && /^LOCK released/m.test(r.out) && (!took() || owner() === took()), `${tag}: a gate release that finds no lock removes nothing — a ship that takes the lock meanwhile keeps it${took() && owner() !== took() ? ' (its lock was removed)' : ''}`)
    // 1b · a ship releases, and a waiter that judged its lock stale by age takes it over at the release's rm
    reset()
    r = await clocked(0, `${prefix}\nif shiplock ship; then echo GOT; echo "$$ ${BASE - 1000} ship" >"$LKP/owner"; shipunlock; fi${close}`, [[0, taker(), { on: 'rm', when: `[ "$args" = "-rf ${LK}" ]` }]], { hooks: true })
    ok(got(r) && (!took() || owner() === took()), `${tag}: a ship's release and a takeover of its lock (stale by age) never interleave — the taker keeps what it took${took() && owner() !== took() ? ' (its lock was removed by the release)' : ''}`)
    // 2 · a halt ship takes the gate's lock over at the heartbeat's beat: the heartbeat never writes over it.
    // The push waits for the heartbeat itself; a step stops it (the fake sleep's parent is the heartbeat's shell)
    plant(`${gateId} ${BASE} gate`)
    const hb = gatePush.replace(/git -C \S+ push -u origin [^\s;]+/, 'wait "$HB"')
    r = await clocked(0, hb, [[1, taker(1), { on: 'date' }], [2, 'kill $PPID']], { env: { GRIMOIRE_GATE_LOCK_BEAT: '1' } })
    ok(!!gateId && hb.includes('wait "$HB"; RC=$?') && !!took() && owner() === took() && /^LOCK kept: held by ship /m.test(r.out), `${tag}: the heartbeat rewrites the owner line only while it names this gate — a halt ship's takeover is not written over (LOCK kept, the heartbeat stopped)${took() && owner() !== took() ? ` (got "${owner()}")` : ''}`)
    plant(`${gateId} ${BASE} gate`)
    r = await clocked(0, hb, [[3, 'kill $PPID']], { env: { GRIMOIRE_GATE_LOCK_BEAT: '1' } })
    ok(owner() === `${gateId} ${BASE + 2} gate` && /^PUSH exit=/m.test(r.out), `${tag}: with nobody else, the heartbeat renews the gate's lock and its id survives it (${owner()})`)
    // 3 · a breaker SIGKILLed inside the mutex, its pid reused by a live process: the mutex is broken by its age
    plant(`${dead} ${BASE} ship`); mkdirSync(BRK); writeFileSync(join(BRK, 'pid'), `${live}\n`)
    r = await sim(45)
    ok(/^LOCK stale: ship /m.test(r.out) && got(r) && r.at >= 30 && r.at < 33, `${tag}: a mutex unchanged for 30 s is broken even when its pid looks alive (at ${r.at} s), then the dead lock taken over`)
    // 4a · the breaker's pid cannot be written into its mutex (a directory stands where it goes): it touches nothing
    plant(`${dead} ${BASE} ship`)
    r = await sim(3, [[0, `${R.mkdir} '${BRK}/pid'`, { on: 'mkdir', when: `[ "$args" = '${BRK}' ]`, every: true }]], '', { hooks: true })
    ok(!got(r) && !/LOCK stale/.test(r.out) && owner() === `${dead} ${BASE} ship`, `${tag}: a breaker whose pid could not be written into the mutex leaves the lock alone${got(r) ? ' (it took the lock over)' : ''}`)
    // 4b · the mutex changes hands while its breaker is inside (judging an owner-less lock): the breaker backs off
    plant('')
    r = await sim(12, [[10, `echo ${live} >'${BRK}/pid'`, { on: 'find', when: `[ -s '${BRK}/pid' ]` }]], '', { hooks: true })
    const brkPid = existsSync(join(BRK, 'pid')) ? readFileSync(join(BRK, 'pid'), 'utf8').trim() : ''
    ok(!got(r) && existsSync(LK) && owner() === '' && brkPid === String(live), `${tag}: a breaker whose mutex no longer holds its pid backs off — the lock and the other's mutex untouched${got(r) ? ' (it took the lock over)' : ''}`)
    // 5 · stamps left by waiters killed with SIGKILL are swept on the next take; a live waiter's stamp stays
    reset()
    const stamp = (pid, k) => `${LK}.${pid}.${k}`
    for (const s of [stamp(dead, 'l'), stamp(dead, 'b'), stamp(live, 'l')]) writeFileSync(s, '')
    r = await sim(3)
    ok(got(r) && !existsSync(stamp(dead, 'l')) && !existsSync(stamp(dead, 'b')) && existsSync(stamp(live, 'l')), `${tag}: a take sweeps the stamps of dead waiters and keeps a live waiter's`)
    X.done()
  }
  const runs = MODES.flatMap(([mode, scripts]) => SHELLS.map((SHELL) => [SHELL, mode, scripts]))
  const logs = runs.map(() => [])
  await Promise.all(runs.map(([SHELL, mode, scripts], k) => f6(SHELL, mode, scripts, (l) => logs[k].push(l))))
  X0.done()
  return logs.flat()
})()
F6.catch(() => {}) // a crash is reported where it is awaited, after F-5, not as an unhandled rejection mid-way

// ══════════════ F-1 · a lock that cannot be created fails fast, in every shell ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const got = await getScripts(X, c1)
  const land = scriptOf(got.land)
  const gateTake = ((/Before you push, take this repo's SHIP LOCK[\s\S]*?```bash\n([\s\S]*?)\n {2}```/.exec(got.gate) || [])[1] || '').replace(/^ {2}/gm, '')
  console.log('\n── F-1 · the ship lock cannot be created (.git not writable): fail fast, never spin')
  ok(!!land && !!gateTake, 'captured the land ship script and the gate lock script')
  // root writes through a 0555 directory: there, a regular file at the lock path makes `mkdir` fail the same way
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  if (asRoot) { console.log('   (as root: .git cannot be made unwritable — a file at the lock path takes the same branch)'); writeFileSync(join(X.W, '.git', 'grimoire-ship-api.lock'), '') }
  else chmodSync(join(X.W, '.git'), 0o555)
  for (const SHELL of SHELLS) {
    const r = X.exec(SHELL, land, { GRIMOIRE_SHIP_DEADLINE: '20' }, { timeout: 15000, killSignal: 'SIGKILL' })
    ok(r.signal === null && r.ms < 8000 && /^LOCK error: cannot create /m.test(r.out) && r.out.split('\n').length < 20, `${SHELL}: ship returns in ${r.ms} ms with LOCK error, nothing moves`)
    const g = X.exec(SHELL, gateTake, {}, { timeout: 15000, killSignal: 'SIGKILL' })
    ok(g.signal === null && g.ms < 8000 && /LOCK error: cannot create /.test(g.out) && /^LOCK busy/m.test(g.out), `${SHELL}: the gate's lock script returns in ${g.ms} ms (LOCK error, then LOCK busy for the gate's retry rule)`)
  }
  if (asRoot) rmSync(join(X.W, '.git', 'grimoire-ship-api.lock'), { force: true })
  else chmodSync(join(X.W, '.git'), 0o755)
  X.done()
}

// ══════════════ F-2 · a re-check that answers nothing never clears a real failure ══════════════
{
  const scenario = async (name, recheck) => {
    const { result, logs } = await run(name, [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
      by({
        'impl:PROJ-1': BLOCKED,
        'replan#1': { decision: 'HALT', reason: 'stuck', learnings: [] },
        'env:stall#1': (p) => envReport(p, { 'commit:api': 1 }),
        'env:recheck#1': recheck,
      }), { args: { ...QUIET, builtinEnvChecks: true } })
    return { result, logs, env: result.environment || { failures: [], transient: [] } }
  }
  const empty = await scenario('F-2a · the re-check report is empty ({results: []})', () => ({ results: [] }))
  ok(empty.result.halt && empty.result.halt.kind === 'environment' && /^environment: commit:api/.test(empty.result.halt.reason), 'the run halts on the environment (no replan of a machine fault)')
  ok(empty.env.transient.length === 0 && empty.env.failures.some((f) => f.name === 'commit:api'), 'the failure stands; nothing is recorded as transient')
  ok(empty.logs.some((l) => /the re-check did not answer commit:api — its first failure stands/.test(l)), 'logged: the re-check did not answer it')
  const none = await scenario('F-2b · the re-check agent returns nothing', () => null)
  ok(none.result.halt && none.result.halt.kind === 'environment' && none.env.transient.length === 0, 'a re-check that returned nothing keeps the first failure: halt')
  const again = await scenario('F-2c · control: the re-check fails too', (p) => envReport(p, { 'commit:api': 1 }))
  ok(again.result.halt && again.result.halt.kind === 'environment', 'halts')
  const passes = await scenario('F-2d · control: the re-check passes', (p) => envReport(p))
  ok(!(passes.result.halt && passes.result.halt.kind === 'environment') && passes.env.transient.some((t) => t.name === 'commit:api'), 'a re-check that answered it and passed: transient, the run goes on')
}

// ══════════════ F-3 · breaking a stale lock is mutually exclusive ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const land = scriptOf((await getScripts(X, c1)).land)
  const { prefix, close } = lockPrefix(land)
  const P = (/^T0=\$\(now\); P='([^']+)'/m.exec(prefix) || [])[1]
  console.log('\n── F-3 · six waiters on a dead holder\'s lock: one inside at a time')
  // Each trial gets its own repo, so its own lock, and every trial of every shell runs at once: a
  // trial's waiters spend it asleep in the lock's 1-s retry, so all of them take about as long as one.
  const trial = async (SHELL, n) => {
    const R = join(X.T0, `trial-${SHELL}-${n}`) // the script's P: its lock is R/.git/grimoire-ship-api.lock
    mkdirSync(R); X.sh('git init -q', R)
    const LK = join(R, '.git', 'grimoire-ship-api.lock')
    const OCC = join(R, 'occ')
    mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `999999 ${Math.floor(Date.now() / 1000)} ship\n`)
    const body = `${prefix.split(`P='${P}'`).join(`P='${R}'`)}\nif shiplock ship; then if mkdir "${OCC}" 2>/dev/null; then sleep 0.3; rmdir "${OCC}"; echo OK; else echo VIOLATION; fi; shipunlock; else echo BUSY; fi${close}`
    const outs = await Promise.all(Array.from({ length: 6 }, () => new Promise((res) => {
      const p = spawn(SHELL, ['-c', body], { cwd: X.T0, env: { ...process.env, GRIMOIRE_SHIP_LOCK_WAIT: '30', PATH: `${X.BIN}:${process.env.PATH}` } })
      let o = ''
      p.stdout.on('data', (d) => (o += d))
      p.on('close', () => res(o))
    })))
    return outs.join('').split('\n').includes('VIOLATION')
  }
  ok(!!P && prefix.includes(`P='${P}'`), 'captured the lock prefix of the land ship script')
  const trials = await Promise.all(SHELLS.map((SHELL) => Promise.all([0, 1, 2, 3].map((n) => trial(SHELL, n)))))
  SHELLS.forEach((SHELL, i) => {
    const violations = trials[i].filter(Boolean).length
    ok(violations === 0, `${SHELL}: 0 of 4 trials with two holders at once${violations ? ` (got ${violations})` : ''}`)
  })
  X.done()
}

// ══════════════ F-4 · a group kill takes the push and its hook down, and frees the lock ══════════════
{
  const X = sandbox()
  X.sh('echo one > t.txt && git add t.txt && git commit -q -m c1', X.W)
  const c1 = X.sh('git rev-parse HEAD', X.W)
  const land = scriptOf((await getScripts(X, c1)).land)
  mkdirSync(join(X.T0, 'hooks'))
  writeFileSync(join(X.T0, 'hooks', 'pre-push'), `#!/bin/sh\necho "hook started $$" >> ${X.T0}/hook.log\nsleep 27\necho "hook finished $$" >> ${X.T0}/hook.log\nexit 0\n`)
  chmodSync(join(X.T0, 'hooks', 'pre-push'), 0o755)
  X.sh(`git config core.hooksPath ${join(X.T0, 'hooks')}`, X.W)
  writeFileSync(join(X.T0, 'ship.sh'), land)
  console.log('\n── F-4 · SIGTERM to the ship script\'s process group mid-push')
  const p = spawn('perl', ['-e', 'setpgrp(0,0); exec @ARGV', 'bash', join(X.T0, 'ship.sh')], { cwd: X.T0, env: { ...process.env, PATH: `${X.BIN}:${process.env.PATH}` }, stdio: 'ignore' })
  let exited = false
  p.once('exit', () => (exited = true))
  const lk = join(X.W, '.git', 'grimoire-ship-api.lock')
  for (let i = 0; i < 400 && !existsSync(join(X.T0, 'hook.log')); i++) await tick(25)
  ok(existsSync(join(X.T0, 'hook.log')) && existsSync(lk), 'the push is in its pre-push hook, under the lock')
  process.kill(-p.pid, 'SIGTERM')
  // the group kill has run its course once the script has exited, its lock is gone and no hook (nor its
  // sleep) is left; wait for that, never longer than the 3 s this step always waited, then check
  const left = () => spawnSync('bash', ['-c', `ps -A -o command | grep -v grep | grep -F -e "sleep 27" -e "${join(X.T0, 'hooks', 'pre-push')}"`], { encoding: 'utf8' }).stdout.trim()
  for (const end = Date.now() + 3000; Date.now() < end && !(exited && !existsSync(lk) && left() === '');) await tick(50)
  const survivors = spawnSync('bash', ['-c', 'ps -A -o command | grep -E "sleep 27" | grep -v grep'], { encoding: 'utf8' }).stdout.trim()
  ok(survivors === '', 'no hook or push survives the group kill')
  ok(!existsSync(lk), 'the lock is released by the script\'s trap')
  const hookLog = readFileSync(join(X.T0, 'hook.log'), 'utf8')
  ok(!/hook finished/.test(hookLog), 'the killed hook never finished (no orphan push completing later)')
  spawnSync('pkill', ['-f', 'sleep 27'])
  X.done()
}

// ══════════════ F-5 · a halt ship with a busy lock claims no failed push ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  let halt = ''
  await run('F-5 · the halt ship finds the lock busy (a live ship holds it)', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })], by({
    'impl:PROJ-1': impl(c1.slice(0, 7)),
    'impl:PROJ-2': BLOCKED,
    'ship:api#1': { pushed: false, failedStep: 'push', detail: 'x' },
    'ship:api#halt': (q) => { halt = q; return { pushed: false } },
    'replan#1': { decision: 'HALT', reason: 'stuck', learnings: [] },
  }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  const script = scriptOf(halt)
  const LK = join(X.W, '.git', 'grimoire-ship-api.lock')
  const holder = spawn('sleep', ['30'])
  mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `${holder.pid} ${Math.floor(Date.now() / 1000)} ship\n`)
  X.pr.set('url', 'https://github.com/x/y/pull/9'); X.pr.set('draft', 'true'); X.pr.set('body', 'old body\n')
  const r = X.exec('bash', script, { GRIMOIRE_SHIP_LOCK_WAIT: '1' })
  ok(/^LOCK busy/m.test(r.out) && /^PUSH ok=0 hook=0 step=lock/m.test(r.out), 'no push was tried (LOCK busy)')
  ok(!X.pr.comments().some((c) => /FAILED/.test(c)), 'no "push FAILED" comment is posted')
  ok(X.pr.body() === 'old body\n', 'the description is untouched')
  holder.kill()
  X.done()
}


console.log('\n── F-6 · on a simulated clock: the ship lock\'s one mutex, an owner-less lock, a lost owner line')
for (const l of await F6) console.log(l)

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
