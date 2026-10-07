// Run-durability v0.9.1 · the follow-ups of issue #14: the minor findings of the last review rounds
// of 0.9.0. Each case failed (or could not be shown) before its fix:
//   U-1  a ship whose `gh pr view` (or `gh pr list`) failed treated the PR as a draft: it pushed and
//        rewrote the description of a PR that may have been ready; a halt then claimed "pushed"
//   U-2  the repo's laneSetup ran unbounded in the ship worktree, under the lock
//   U-3  a gate whose pre-push hook ran past the gate lock's stale age lost the lock to a ship
//   U-4  a title, summary or halt reason saying "Closes #99" closed #99 when the PR merged
//   U-5  `SOC-2 …`, `GPT-4 …`, `Q3-2026 …` keyed every project that starts with them on one run
//        branch; "Auth rewrite — PROJ-700" did not key as PROJ-700; two owners' /projects/7 shared `7`;
//        a marker of another wording was taken without a word
//   U-6  the journal's mutex was broken on a 5-s timer alone (live holders too); GRIMOIRE_LOCK_STALE=0
//        broke live locks at once; without `date +%s` the wait never ended; a run directory with a
//        backslash in its path lost landed.jsonl's dedupe (`awk -v`)
//   U-7  a task a replan invented was absorbed from the checkpoint only: another machine redid it
//   U-8  a local checkpoint behind a newer marker kept its counters, with no way to take the marker's
//   U-9  the final flush carried at most 8 landed details: the rest never reached landed.jsonl
//   U-10 the ship lock's wait never ended without `date +%s`
// The scripts run for real in bash, zsh and dash (those installed) against a temp git sandbox with a
// fake gh. Integrate's re-ask and the dispatches after the run returns are in run-durability-delivery-fix.

import { run, by, happy, T, impl, BLOCKED, QUIET, PR_URL, RUN_BRANCH, body, heredocs, unb64, sandbox, getScripts, scriptOf, realRepo, SHELLS, spawn, spawnSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync, join, tick } from './support/script-harness.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

let PASS = 0
let FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)
const section = (t) => console.log(`\n── ${t}`)
const which = (t) => spawnSync('/bin/sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim()
const { cksum, b64 } = new Function(`${body.slice(body.indexOf('const B64_CHARS'), body.indexOf('// A heredoc that lands as a decoded file'))}\nreturn { cksum, b64 }`)()
const TMP = mkdtempSync(join(tmpdir(), 'grim-fu-'))
let tmpN = 0
const fresh = (tag = 'd') => { const d = join(TMP, `${tag}-${++tmpN}`); mkdirSync(d, { recursive: true }); return d }
const ZW = '​'
// a `date` that cannot tell the time in seconds (some minimal systems): every other format still works
const NODATE = fresh('nodate')
writeFileSync(join(NODATE, 'date'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = +%s ] && exit 1; done\nexec ${which('date')} "$@"\n`)
chmodSync(join(NODATE, 'date'), 0o755)

// ══════════════ U-1 · an unreadable PR is UNKNOWN: nothing pushed, rewritten or claimed ══════════════
for (const SHELL of SHELLS) {
  section(`U-1a · [${SHELL}] gh pr view fails (HTTP 502) on a PR that is in fact ready`)
  const X = sandbox()
  const c1 = X.commit('c1')
  const land = scriptOf((await getScripts(X, c1)).land)
  X.pr.set('url', 'https://github.com/x/y/pull/9'); X.pr.set('draft', 'false'); X.pr.set('body', 'the gate\'s final description\n'); X.pr.set('failview', '1')
  let out = X.exec(SHELL, land).out
  ok(/^UNKNOWN url=https:\/\/github\.com\/x\/y\/pull\/9: the PR could not be read/m.test(out) && /^PUSH skipped unknown=1$/m.test(out) && /^PR ok=1 url=\S+ action=unknown$/m.test(out), 'UNKNOWN; PUSH skipped; the PR step does nothing')
  ok(X.origin() === '' && !X.pr.ops().some((o) => o === 'edit' || o === 'create') && X.pr.body() === 'the gate\'s final description\n', 'nothing reached origin; the description is the gate\'s, untouched')
  X.done()

  section(`U-1b · [${SHELL}] gh pr list fails: the PR may exist (and be ready) — unknown too, never a new draft`)
  const Y = sandbox()
  const d1 = Y.commit('c1')
  const land2 = scriptOf((await getScripts(Y, d1)).land)
  Y.pr.set('url', 'https://github.com/x/y/pull/9'); Y.pr.set('draft', 'false'); Y.pr.set('faillist', '1')
  out = Y.exec(SHELL, land2).out
  ok(/^UNKNOWN url=: /m.test(out) && /^PUSH skipped unknown=1$/m.test(out) && Y.origin() === '' && !Y.pr.ops().includes('create'), 'unknown: no push, no `gh pr create` next to a PR that may be ready')
  Y.pr.set('faillist', '')
  out = Y.exec(SHELL, land2).out
  ok(/^READY url=/m.test(out) && !/^UNKNOWN/m.test(out) && Y.origin() === '', 'control: once gh answers, the ready PR is seen as ready (nothing pushed either)')
  rmSync(join(Y.GH, 'draft')); Y.pr.set('draft', 'true')
  out = Y.exec(SHELL, land2).out
  ok(/^PUSH ok=1 remote=/m.test(out) && /action=edited/m.test(out) && Y.origin() === d1, 'control: a readable draft is pushed and described as before')
  Y.done()
}
{
  const r = await run('U-1c · the engine: an UNKNOWN receipt is a skip, not a failed push — the next ship retries, nothing is disabled', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })],
    by({ 'impl:PROJ-2': impl('bbbbbbb', 'aaaaaaa'), 'ship:api#1': { pushed: false, unknown: true, prUrl: PR_URL } }), { args: { ...QUIET, builtinEnvChecks: false } })
  ok(r.logs.some((l) => /ship:api#1: api's PR https:\/\/github\.com\/x\/y\/pull\/7 could not be read \(gh failed\) — it may be out of draft, so nothing was pushed or rewritten; the next ship retries/.test(l)), 'logged as unknown')
  ok(r.labels.includes('ship:api#2') && !r.result.shipped.api.disabled && r.result.shipped.api.pushedHead === 'bbbbbbb', 'the next landing ships; incremental delivery stays on')
}
for (const SHELL of SHELLS) {
  section(`U-1d · [${SHELL}] a halt ship that cannot read its PR posts no status comment (each variant claims something)`)
  const X = sandbox()
  const c1 = X.commit('c1')
  let hp = ''
  await run('', [T('PROJ-1'), T('PROJ-2', { dependsOn: ['PROJ-1'] })], by({ 'impl:PROJ-1': impl(c1.slice(0, 7)), 'impl:PROJ-2': BLOCKED, 'replan#1': { decision: 'HALT', reason: 'stuck', learnings: [] }, 'ship:api#1': { pushed: false, failedStep: 'push' }, 'ship:api#halt': (p) => { hp = p; return { pushed: false } } }), { args: { ...QUIET, repos: realRepo(X.W), builtinEnvChecks: false } })
  X.pr.set('url', 'https://github.com/x/y/pull/9'); X.pr.set('draft', 'true'); X.pr.set('failview', '1')
  const out = X.exec(SHELL, scriptOf(hp)).out
  ok(/^UNKNOWN /m.test(out) && /^PUSH skipped unknown=1$/m.test(out) && !/^COMMENT/m.test(out) && X.pr.comments().length === 0 && X.origin() === '', 'no push, no comment, no COMMENT line (not a failed comment either)')
  X.done()
}

// ══════════════ U-2 · the lane setup in the ship worktree is bounded ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const land = scriptOf((await getScripts(X, c1, { repos: realRepo(X.W, { laneSetup: 'sleep 3071; touch <lane>/never' }) })).land)
  section('U-2 · a laneSetup that hangs is cut with the rest of the script (to: its own group, never past the deadline)')
  ok(land.includes(`to 180 sh -c 'sleep 3071; touch ${X.W}/.worktrees/ship-api/never'`), 'the setup runs under `to`, at most 180 s, with <lane> substituted')
  for (const SHELL of SHELLS) {
    rmSync(join(X.W, '.worktrees'), { recursive: true, force: true }); X.sh('git worktree prune', X.W)
    const r = X.exec(SHELL, land, { GRIMOIRE_SHIP_DEADLINE: '2' }, { timeout: 30000, killSignal: 'SIGKILL' })
    const left = spawnSync('sh', ['-c', 'pgrep -f "sleep 307[1]" || true'], { encoding: 'utf8' }).stdout.trim() // [1]: never this shell's own command line
    ok(r.signal === null && r.ms < 10000 && left === '' && !existsSync(join(X.W, '.worktrees', 'ship-api', 'never')), `${SHELL}: returned in ${r.ms} ms with a 2-s deadline; the setup was killed, nothing of it left running`)
  }
  spawnSync('pkill', ['-f', 'sleep 307[1]'])
  X.done()
}

// ══════════════ U-3 · the gate's push keeps its lock alive while its pre-push hook runs ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const got = await getScripts(X, c1)
  const take = ((/Before you push, take this repo's SHIP LOCK[\s\S]*?```bash\n([\s\S]*?)\n {2}```/.exec(got.gate) || [])[1] || '').replace(/^ {2}/gm, '')
  const push = ((/Push the final head[\s\S]*?```bash\n([\s\S]*?)\n {2}```/.exec(got.gate) || [])[1] || '').replace(/^ {2}/gm, '')
  section('U-3 · the gate pushes under a heartbeat that renews its lock, and stops with the push')
  ok(!!take && push.includes(`git -C ${X.W} push -u origin ${RUN_BRANCH}; RC=$?`) && push.includes('echo "PUSH exit=$RC"'), 'the gate prompt hands the push over as one script, ending in PUSH exit=<code>')
  mkdirSync(join(X.T0, 'hooks'))
  writeFileSync(join(X.T0, 'hooks', 'pre-push'), '#!/bin/sh\nsleep 2\nexit 0\n')
  chmodSync(join(X.T0, 'hooks', 'pre-push'), 0o755)
  X.sh(`git config core.hooksPath ${join(X.T0, 'hooks')}`, X.W)
  const OWN = join(X.W, '.git', 'grimoire-ship-api.lock', 'owner')
  const epoch = () => Number((readFileSync(OWN, 'utf8').trim().split(' ') || [])[1])
  for (const SHELL of SHELLS) {
    ok(/^LOCK ok \//m.test(X.exec(SHELL, take, { GRIMOIRE_SHIP_LOCK_WAIT: '1' }).out), `${SHELL}: the gate takes the lock`)
    const old = Math.floor(Date.now() / 1000) - 1100 // 1100 s old: a ship would take it over 100 s from now
    writeFileSync(OWN, `1 ${old} gate\n`)
    X.sh(`git push -q origin ${c1}:refs/heads/x-${SHELL} 2>/dev/null; git commit -q --allow-empty -m more-${SHELL}`, X.W)
    const r = X.exec(SHELL, push, { GRIMOIRE_GATE_LOCK_BEAT: '1' })
    ok(/^PUSH exit=0$/m.test(r.out) && X.origin() === X.sh('git rev-parse HEAD', X.W), `${SHELL}: pushed (exit 0) through a 2-s pre-push hook`)
    ok(epoch() > old + 1000 && / gate$/.test(readFileSync(OWN, 'utf8').trim()), `${SHELL}: its lock's age was renewed while the hook ran (still the gate's)`)
    writeFileSync(OWN, `1 ${old} gate\n`)
    await tick(1600)
    ok(epoch() === old, `${SHELL}: the heartbeat stopped with the push (nothing renews it afterwards)`)
    rmSync(join(X.W, '.git', 'grimoire-ship-api.lock'), { recursive: true, force: true })
  }
  X.done()
}

// ══════════════ U-4 · free text never closes an issue ══════════════
{
  const summary = 'Fixes #99 and closes acme/site#5; resolves https://github.com/acme/site/issues/7. Fixed: #8. A fix for #10 stays as written.'
  const r = await run('U-4 · a title, a summary and a halt reason with closing keywords: only the engine\'s own `Closes #4` closes anything', [T('#4', { title: 'Fix #12 crash on login' }), T('#6', { dependsOn: ['#4'] })],
    by({ 'impl:#4': impl('aaaaaaa', '0000000', summary), 'impl:#6': BLOCKED, 'replan#1': { decision: 'HALT', reason: 'stuck: closes #13 first', learnings: [] } }), { args: { ...QUIET, builtinEnvChecks: false } })
  const hb = heredocs(r.prompt('ship:api#halt'))[0] || ''
  ok(hb.includes('- Closes #4 — F​ix #12 crash on login'), 'the landed line: the engine\'s `Closes #4`, the title\'s "Fix #12" defused')
  ok(hb.includes(`F${ZW}ixes #99`) && hb.includes(`c${ZW}loses acme/site#5`) && hb.includes(`r${ZW}esolves https://github.com/acme/site/issues/7`) && hb.includes(`F${ZW}ixed: #8`) && hb.includes('A fix for #10'), 'the summary: every keyword before a reference defused, "a fix for #10" (no keyword form) left as written')
  ok(hb.includes(`stuck: c${ZW}loses #13 first`), 'the halt reason too')
  const plain = hb.replace(/- Closes #4 /, '')
  ok(!/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b\s*:?\s*([\w.-]+\/[\w.-]+)?#\d/i.test(plain) && !/\bresolves https:/i.test(plain), 'no closing keyword is left before a reference anywhere else in the body')
  const g = await run('', [T('#4', { title: 'Fix #12 crash on login' })], by({ 'impl:#4': impl('aaaaaaa', '0000000', summary) }), { args: { ...QUIET, builtinEnvChecks: false }, quiet: true })
  const gp = g.prompt('gate:api')
  ok(gp.includes(`F${ZW}ix #12 crash on login`) && gp.includes(`F${ZW}ixes #99`) && !gp.includes('Fixes #99'), 'the gate, which writes the final body, gets them defused too')
}

// ══════════════ U-5 · the run branch key ══════════════
{
  section('U-5a · projectKey: names, versions and periods are no keys; a key at the end after a separator is; project URLs carry their owner')
  const a = body.indexOf('const fnv1a'), b = body.indexOf('const PROJECT_KEY')
  const { projectKey, keyToken } = new Function(`${body.slice(a, b)}\nreturn { projectKey, keyToken }`)()
  const cases = [
    ['SOC-2 compliance audit', 'SOC-2 compliance audit', 'soc-2-compliance-audit'],
    ['GPT-4 integration', 'GPT-4 integration', 'gpt-4-integration'],
    ['COVID-19 vaccination tracker', 'COVID-19 vaccination tracker', 'covid-19-vaccination-tracker'],
    ['Q3-2026 roadmap', 'Q3-2026 roadmap', 'q3-2026-roadmap'],
    ['AES-256 encryption at rest', 'AES-256 encryption at rest', 'aes-256-encryption-at-rest'],
    ['FY26-3 planning', 'FY26-3 planning', 'fy26-3-planning'],
    ['Auth rewrite — PROJ-700', 'PROJ-700', 'proj-700'],
    ['Auth rewrite: PROJ-700', 'PROJ-700', 'proj-700'],
    ['Auth rewrite - PROJ-700', 'PROJ-700', 'proj-700'],
    ['Auth rewrite PROJ-700', 'Auth rewrite PROJ-700', 'auth-rewrite-proj-700'],
    ['Ship it — SOC-2', 'Ship it — SOC-2', 'ship-it-soc-2'],
    ['WEB-12 checkout', 'WEB-12', 'web-12'],
    ['PROJ-700 Points: earn and show points', 'PROJ-700', 'proj-700'],
    ['https://github.com/orgs/acme/projects/7', 'acme/projects/7', 'acme-projects-7'],
    ['https://github.com/orgs/other/projects/7/views/2', 'other/projects/7', 'other-projects-7'],
    ['https://github.com/users/me/projects/12', 'me/projects/12', 'me-projects-12'],
    ['https://gitlab.com/groups/acme/web/-/epics/7', 'acme/web/epics/7', 'acme-web-epics-7'],
    ['Q3 billing rework — see https://github.com/acme/site/issues/44', 'acme/site#44', 'acme-site-44'],
  ]
  for (const [text, key, token] of cases) eq([projectKey(text), keyToken(text)], [key, token], JSON.stringify(text))

  const mk = (extra) => { const t = b64(JSON.stringify({ version: 2, runId: 'run-k', project: 'PROJ-700', repo: 'api', runBranch: RUN_BRANCH, attempt: 1, lastSeq: 5, landedTasks: [['PROJ-1', 'aaaaaaa']], ...extra }), 0); return { prState: [{ repo: 'api', url: PR_URL, state: 'OPEN', isDraft: true, marker: t, len: t.length, sum: cksum(t) }], reconcile: [{ id: 'PROJ-1', repo: 'api', sha: 'aaaaaaa', onBranch: true, inBase: 'no' }], runBranches: [{ repo: 'api', local: 'aaaaaaa', remote: 'aaaaaaa', sync: 'same', fetch: 'ok' }] } }
  const r = await run('U-5b · a marker written for another wording of the same key (its `text`): used, and said before anything lands', [T('PROJ-1'), T('PROJ-2')], happy, { args: QUIET, index: mk({ text: 'PROJ-700 Points: earn and show points' }) })
  ok(r.result.resumedLanded.map((x) => x.id).join() === 'PROJ-1' && r.logs.some((l) => /the state marker in https:\/\/github\.com\/x\/y\/pull\/7 was written for "PROJ-700 Points: earn and show points" — not this project's text, but the same key \(PROJ-700\) and run branch, so its state is used\. If that is another project, relaunch with \{runBranch\} set/.test(l)), 'absorbed, with a warning that names the other wording')
  const same = await run('', [T('PROJ-1'), T('PROJ-2')], happy, { args: { ...QUIET, project: 'PROJ-700 Points: earn and show points' }, index: mk({ text: 'PROJ-700 Points: earn and show points' }), quiet: true })
  ok(!same.logs.some((l) => /not this project's text/.test(l)), 'control: the same wording → no warning')
  const old = await run('', [T('PROJ-1'), T('PROJ-2')], happy, { args: { ...QUIET, project: 'PROJ-700 Points: earn and show points' }, index: mk({}), quiet: true })
  ok(!old.logs.some((l) => /not this project's text/.test(l)) && old.result.resumedLanded.length === 1, 'control: a 0.9.0 marker (the key, no text) → no warning, nothing to compare')
  const ships = []
  await run('', [T('PROJ-1')], by({ 'ship:api#1': (p) => { ships.push(p); return happy('ship:api#1', p) } }), { args: { ...QUIET, project: 'PROJ-700 Points: earn and show points' }, quiet: true })
  const line = (heredocs(ships[0] || '')[0] || '').split('\n').find((l) => l.startsWith('<!-- grimoire:state ')) || ''
  const st = JSON.parse(unb64((/v1 (\S+) -->/.exec(line) || [])[1] || 'e30='))
  eq([st.project, st.text], ['PROJ-700', 'PROJ-700 Points: earn and show points'], 'a run writes the key and, when they differ, its wording')
}

// ══════════════ U-6 · the journal lock ══════════════
const tel = fresh('tel')
const journals = []
const landedWriter = (label, p) => {
  if (label.startsWith('journal#')) {
    journals.push(p)
    const [l, rj, ld] = heredocs(p)
    return { runDir: `${tel}/run-u`, lines: l.trim().split('\n').length, bytes: Buffer.byteLength(l), runJson: 'ok', runJsonBytes: Buffer.byteLength(rj), landed: ld ? ld.trim().split('\n').length : 0 }
  }
  return happy(label)
}
await run('', Array.from({ length: 3 }, (_, k) => T(`PROJ-${k + 1}`)), landedWriter, { args: { ...QUIET, runId: 'run-u', telemetry: { dir: tel, flushEvery: 3 } } })
const DIR0 = `${tel}/run-u`
const retarget = (p, to) => scriptOf(p).replaceAll(`DIR='${DIR0}'`, `DIR='${to.replace(/'/g, `'\\''`)}'`)
const script = journals.find((p) => scriptOf(p).includes(`DIR='${DIR0}'`)) || ''
const runAsync = (shell, s, extraEnv = {}) => new Promise((res) => {
  const t0 = Date.now()
  const c = spawn(shell, ['-c', s], { env: { ...process.env, ...extraEnv } })
  let out = ''
  const kill = setTimeout(() => c.kill('SIGKILL'), 40000)
  c.stdout.on('data', (d) => (out += d))
  c.on('close', () => { clearTimeout(kill); res({ out, s: (Date.now() - t0) / 1000 }) })
})
{
  ok(!!script, 'U-6 · captured a journal script')
  const instr = (D, LOG) => retarget(script, D).replace('PREV=$(sed', `echo "in $$" >> '${LOG}'; sleep 0.05; echo "out $$" >> '${LOG}'\nPREV=$(sed`)
  const depth = (LOG) => { let d = 0, max = 0; for (const l of (existsSync(LOG) ? readFileSync(LOG, 'utf8') : '').trim().split('\n').filter(Boolean)) { d += l.startsWith('in') ? 1 : -1; max = Math.max(max, d) } return max }
  for (const [what, plant, trials] of [['a dead pid', '99999\n', 6], ['no pid (its writer killed between mkdir and writing it)', null, 2]]) {
    section(`U-6a · 16 writers at once, a stale .lock.brk with ${what} planted, ${trials} trials: never two inside, nothing left`)
    let overlaps = 0, litter = 0, entered = 0
    for (let i = 0; i < trials; i++) {
      const D = fresh('mx'), LOG = join(D, 'cs.log')
      mkdirSync(join(D, '.lock.brk')); if (plant) writeFileSync(join(D, '.lock.brk', 'pid'), plant)
      await Promise.all(Array.from({ length: 16 }, (_, k) => runAsync(which(SHELLS[(i + k) % SHELLS.length]), instr(D, LOG))))
      if (depth(LOG) > 1) overlaps++
      if (existsSync(join(D, '.lock')) || existsSync(join(D, '.lock.brk'))) litter++
      entered += (existsSync(LOG) ? readFileSync(LOG, 'utf8') : '').split('\n').filter((l) => l.startsWith('in')).length
    }
    eq({ overlaps, litter }, { overlaps: 0, litter: 0 }, `${trials} trials × 16 writers (${SHELLS.join('/')}): no overlap, no lock or mutex left`)
    ok(entered === trials * 16, `every writer got in (${entered}/${trials * 16})`)
  }
  section('U-6b · a mutex held by a live writer is never broken, however long it is held')
  {
    const D = fresh('mx')
    const holder = spawn('sleep', ['30'])
    mkdirSync(join(D, '.lock.brk')); writeFileSync(join(D, '.lock.brk', 'pid'), `${holder.pid}\n`)
    const w = runAsync(which(SHELLS[0]), retarget(script, D), { GRIMOIRE_LOCK_STALE: '2' })
    await tick(7000)
    ok(existsSync(join(D, '.lock.brk')) && readFileSync(join(D, '.lock.brk', 'pid'), 'utf8').trim() === String(holder.pid), 'after 7 s (past the old 5-s timer) the live holder still has it')
    const gone = new Promise((res) => holder.once('exit', res))
    holder.kill(); await gone
    const { out } = await w
    ok(/^RUNJSON ok$/m.test(out), 'its holder gone, the writer breaks it at once and writes')
  }
  section('U-6c · GRIMOIRE_LOCK_STALE=0 is 1: a lock held by a live pid is not broken at once (timed in counted naps: whole-second clocks blur 0 and 1)')
  for (const shell of SHELLS) {
    const D = fresh('lk')
    const holder = spawn('sleep', ['30'])
    mkdirSync(join(D, '.lock')); writeFileSync(join(D, '.lock', 'pid'), `${holder.pid}\n`)
    const { out, s } = await runAsync(which(shell), retarget(script, D), { GRIMOIRE_LOCK_STALE: '0', PATH: `${NODATE}:${process.env.PATH}` })
    holder.kill()
    ok(/^RUNJSON ok$/m.test(out) && s >= 0.9 && s < 5, `${shell}: broken after ${s.toFixed(1)} s (20 naps: the 1-s floor), written`)
  }
  section('U-6d · without `date +%s` the wait still ends: the naps are counted')
  for (const shell of SHELLS) {
    const D = fresh('lk')
    const holder = spawn('sleep', ['60'])
    mkdirSync(join(D, '.lock')); writeFileSync(join(D, '.lock', 'pid'), `${holder.pid}\n`)
    const { out, s } = await runAsync(which(shell), retarget(script, D), { GRIMOIRE_LOCK_STALE: '1', PATH: `${NODATE}:${process.env.PATH}` })
    holder.kill()
    ok(/^RUNJSON ok$/m.test(out) && s < 15, `${shell}: the live holder's lock broken by counted naps, written in ${s.toFixed(1)} s (it waited forever)`)
  }
  section('U-6e · a run directory with a backslash in its path: landed.jsonl still holds each task once')
  const withLanded = journals.filter((p) => heredocs(p).length > 2)
  for (const shell of SHELLS) {
    const D = fresh('back\\slash')
    for (const p of [...withLanded, ...withLanded]) spawnSync(which(shell), ['-c', retarget(p, D)], { encoding: 'utf8' })
    const ids = readFileSync(join(D, 'landed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id)
    ok(ids.length === 3 && new Set(ids).size === 3, `${shell}: ${ids.length} lines for 3 tasks, each once (awk reads the path from ENVIRON, not -v)`)
  }
}

// ══════════════ U-7 · a task a replan invented, from the marker ══════════════
{
  const tok = (runId) => b64(JSON.stringify({ version: 2, runId, project: 'PROJ-700', repo: 'api', runBranch: RUN_BRANCH, attempt: 1, lastSeq: 9, landedTasks: [['PROJ-1', 'aaaaaaa'], ['1.2', 'bbbbbbb'], ['#9', 'bbbbbbb']], replan: ['1.2', '#9'] }), 0)
  const index = (runId) => ({ prState: [{ repo: 'api', url: PR_URL, state: 'OPEN', isDraft: true, marker: tok(runId), len: tok(runId).length, sum: cksum(tok(runId)) }], reconcile: ['PROJ-1', '1.2', '#9'].map((id) => ({ id, repo: 'api', sha: id === 'PROJ-1' ? 'aaaaaaa' : 'bbbbbbb', onBranch: true, inBase: 'no' })), runBranches: [{ repo: 'api', local: 'bbbbbbb', remote: 'bbbbbbb', sync: 'same', fetch: 'ok' }] })
  const same = await run('U-7a · another machine, the marker alone: the replan\'s task is absorbed when the marker is this runId\'s', [T('PROJ-1')], happy, { args: { ...QUIET, runId: 'run-r' }, index: index('run-r') })
  eq(same.result.resumedLanded.map((x) => x.id).sort(), ['1.2', 'PROJ-1'], 'PROJ-1 and 1.2 absorbed; #9 (it reads as an issue reference) never')
  const other = await run('U-7b · a marker of another runId: its replan tasks are not taken', [T('PROJ-1')], happy, { args: { ...QUIET, runId: 'run-r' }, index: index('run-other') })
  eq(other.result.resumedLanded.map((x) => x.id), ['PROJ-1'], 'only the project\'s issue')
  const ships = []
  await run('U-7c · the marker a run writes lists the replan tasks it holds', [T('PROJ-1'), T('PROJ-2')],
    by({ 'impl:PROJ-2': impl('ccccccc', 'bbbbbbb'), 'ship:api#1': (p) => { ships.push(p); return { pushed: true, remoteHead: 'ccccccc', prUrl: PR_URL, draft: true } } }),
    { args: { ...QUIET, runId: 'run-r', resumeState: { version: 2, runId: 'run-r', attempt: 1, lastSeq: 9, landedTasks: [{ id: 'PROJ-1', repo: 'api', headSha: 'aaaaaaa' }, { id: '1.2', repo: 'api', headSha: 'bbbbbbb', replan: true }] } }, index: { reconcile: [{ id: 'PROJ-1', repo: 'api', sha: 'aaaaaaa', onBranch: true, inBase: 'no' }, { id: '1.2', repo: 'api', sha: 'bbbbbbb', onBranch: true, inBase: 'no' }], runBranches: [{ repo: 'api', local: 'bbbbbbb', remote: 'bbbbbbb', sync: 'same', fetch: 'ok' }] }, quiet: true })
  const line = (heredocs(ships[0] || '')[0] || '').split('\n').find((l) => l.startsWith('<!-- grimoire:state ')) || ''
  const st = JSON.parse(unb64((/v1 (\S+) -->/.exec(line) || [])[1] || 'e30='))
  eq(st.replan, ['1.2'], 'the marker: replan ["1.2"]')
}

// ══════════════ U-8 · a newer marker's counters, when asked ══════════════
{
  const local = { version: 2, attempt: 1, lastSeq: 3, replansUsed: 0, landedTasks: [] }
  const tok = b64(JSON.stringify({ version: 2, runId: 'run-n', project: 'PROJ-700', repo: 'api', runBranch: RUN_BRANCH, attempt: 900, lastSeq: 4000, replansUsed: 2, landedTasks: [] }), 0)
  const index = { prState: [{ repo: 'api', url: PR_URL, state: 'OPEN', isDraft: true, marker: tok, len: tok.length, sum: cksum(tok) }], runBranches: [{ repo: 'api', local: 'bbbbbbb', remote: 'bbbbbbb', sync: 'same', fetch: 'ok' }] }
  const off = await run('U-8a · by default the local checkpoint\'s counters stay, and the log says how to take the marker\'s', [T('PROJ-1')], by({ 'impl:PROJ-1': BLOCKED }), { args: { ...QUIET, maxReplans: 2, resumeState: local }, index })
  ok(off.labels.includes('replan#1') && off.logs.some((l) => /the counters stay the resumeState's \(this machine's run\.json may be behind another machine's: if that run is yours, relaunch with \{trustNewerMarker: true\}/.test(l)), 'a replan runs; the log names {trustNewerMarker: true}')
  const on = await run('U-8b · {trustNewerMarker: true}: the higher of each counter is taken', [T('PROJ-1')], by({ 'impl:PROJ-1': BLOCKED }), { args: { ...QUIET, maxReplans: 2, resumeState: local, trustNewerMarker: true }, index })
  ok(!on.labels.includes('replan#1') && /exhausted replan budget \(2\)/.test((on.result.halt || {}).reason || '') && on.logs.some((l) => /trustNewerMarker: the higher of each counter is taken/.test(l)), 'the 2 replans the other machine spent count: no replan, the budget is exhausted')
}

// ══════════════ U-9 · the end of a run writes every landed detail ══════════════
{
  journals.length = 0
  const D = fresh('tel9')
  // the writer confirms no landed delta until the run is over (a receipt it kept losing): 12 details are unconfirmed at the end
  const confirmed = new Set()
  const r = await run('U-9 · 12 landed details still unconfirmed at the end: the final chunk carries 8, the rest follow until each is confirmed', Array.from({ length: 12 }, (_, k) => T(`PROJ-${k + 1}`)),
    (label, p) => {
      if (!label.startsWith('journal#')) return happy(label)
      const res = landedWriter(label, p)
      const ended = heredocs(p)[0].includes('"type":"run.end"') || heredocs(p)[0].includes('"type":"landed.flush"')
      if (ended) for (const l of (heredocs(p)[2] || '').trim().split('\n').filter(Boolean)) confirmed.add(JSON.parse(l).id)
      return ended ? res : { ...res, landed: 0 }
    }, { args: { ...QUIET, runId: 'run-9', telemetry: { dir: D, flushEvery: 1000 } } })
  ok(confirmed.size === 12, `${confirmed.size} of 12 details confirmed by the end (the final chunk alone carried 8)`)
  const events = journals.flatMap((p) => heredocs(p)[0].trim().split('\n').map((l) => JSON.parse(l).type))
  ok(events.includes('run.end') && events.indexOf('landed.flush') > events.indexOf('run.end'), 'a `landed.flush` chunk after run.end carried the rest')
  ok(r.result.telemetry.journal && r.result.telemetry.journal.lost === 0, 'no chunk lost')
}

// ══════════════ U-10 · the ship lock's wait ends without `date +%s` ══════════════
{
  const X = sandbox()
  const c1 = X.commit('c1')
  const land = scriptOf((await getScripts(X, c1)).land)
  const prefix = land.slice(0, land.indexOf('if shiplock ship; then LK=1'))
  section('U-10 · a ship lock held by a live ship, and no `date +%s`: LOCK busy after the wait, counted in 1-s sleeps')
  for (const SHELL of SHELLS) {
    const holder = spawn('sleep', ['60'])
    const LK = join(X.W, '.git', 'grimoire-ship-api.lock')
    rmSync(LK, { recursive: true, force: true }); mkdirSync(LK, { recursive: true }); writeFileSync(join(LK, 'owner'), `${holder.pid} ${Math.floor(Date.now() / 1000)} ship\n`)
    const r = X.exec(SHELL, `${prefix}\nif shiplock ship; then echo GOT; shipunlock; fi`, { GRIMOIRE_SHIP_LOCK_WAIT: '2', PATH: `${NODATE}:${X.BIN}:${process.env.PATH}` }, { timeout: 20000, killSignal: 'SIGKILL' })
    holder.kill()
    ok(r.signal === null && /^LOCK busy: held by ship /m.test(r.out) && r.ms < 8000, `${SHELL}: LOCK busy in ${r.ms} ms (it waited forever)`)
  }
  X.done()
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n${PASS} passed · ${FAIL} failed`)
if (FAIL) process.exit(1)
