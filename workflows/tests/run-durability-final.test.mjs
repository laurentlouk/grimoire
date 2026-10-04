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
// The scripts run for real in bash, zsh and dash against a temp git sandbox with a fake gh.

import { run, by, T, impl, BLOCKED, QUIET, envReport, sandbox, getScripts, scriptOf, realRepo, SHELLS, spawn, spawnSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync, join, tick } from './support/script-harness.mjs'

let PASS = 0
let FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

// ══════════════ F-1 · a lock that cannot be created fails fast, in every shell ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const got = await getScripts(X, c1)
  const land = scriptOf(got.land)
  const gateTake = ((/Before you push, take this repo's SHIP LOCK[\s\S]*?```bash\n([\s\S]*?)\n {2}```/.exec(got.gate) || [])[1] || '').replace(/^ {2}/gm, '')
  console.log('\n── F-1 · the ship lock cannot be created (.git not writable): fail fast, never spin')
  ok(!!land && !!gateTake, 'captured the land ship script and the gate lock script')
  chmodSync(join(X.W, '.git'), 0o555)
  for (const SHELL of SHELLS) {
    const r = X.exec(SHELL, land, { GRIMOIRE_SHIP_DEADLINE: '20' }, { timeout: 15000, killSignal: 'SIGKILL' })
    ok(r.signal === null && r.ms < 8000 && /^LOCK error: cannot create /m.test(r.out) && r.out.split('\n').length < 20, `${SHELL}: ship returns in ${r.ms} ms with LOCK error, nothing moves`)
    const g = X.exec(SHELL, gateTake, {}, { timeout: 15000, killSignal: 'SIGKILL' })
    ok(g.signal === null && g.ms < 8000 && /LOCK error: cannot create /.test(g.out) && /^LOCK busy/m.test(g.out), `${SHELL}: the gate's lock script returns in ${g.ms} ms (LOCK error, then LOCK busy for the gate's retry rule)`)
  }
  chmodSync(join(X.W, '.git'), 0o755)
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
  const prefix = land.slice(0, land.indexOf('if shiplock ship; then LK=1'))
  const LK = join(X.W, '.git', 'grimoire-ship-api.lock')
  const OCC = join(X.T0, 'occ')
  console.log('\n── F-3 · six waiters on a dead holder\'s lock: one inside at a time')
  for (const SHELL of SHELLS) {
    let violations = 0
    for (let trial = 0; trial < 4; trial++) {
      rmSync(LK, { recursive: true, force: true }); rmSync(`${LK}.brk`, { recursive: true, force: true }); rmSync(OCC, { recursive: true, force: true })
      mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `999999 ${Math.floor(Date.now() / 1000)} ship\n`)
      const body = `${prefix}\nif shiplock ship; then if mkdir "${OCC}" 2>/dev/null; then sleep 0.3; rmdir "${OCC}"; echo OK; else echo VIOLATION; fi; shipunlock; else echo BUSY; fi\n`
      const outs = await Promise.all(Array.from({ length: 6 }, () => new Promise((res) => {
        const p = spawn(SHELL, ['-c', body], { cwd: X.T0, env: { ...process.env, GRIMOIRE_SHIP_LOCK_WAIT: '30', PATH: `${X.BIN}:${process.env.PATH}` } })
        let o = ''
        p.stdout.on('data', (d) => (o += d))
        p.on('close', () => res(o))
      })))
      if (outs.join('').split('\n').includes('VIOLATION')) violations++
    }
    ok(violations === 0, `${SHELL}: 0 of 4 trials with two holders at once`)
  }
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
  const lk = join(X.W, '.git', 'grimoire-ship-api.lock')
  for (let i = 0; i < 40 && !existsSync(join(X.T0, 'hook.log')); i++) await tick(250)
  ok(existsSync(join(X.T0, 'hook.log')) && existsSync(lk), 'the push is in its pre-push hook, under the lock')
  process.kill(-p.pid, 'SIGTERM')
  await tick(3000)
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

console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
