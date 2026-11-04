// policy-counterfactual: the engine's own router, evaluated over recorded runs.
//  Run:  node scripts/policy-counterfactual.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRouter, rulesOf, counterfactualRun, report } from './policy-counterfactual.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)})`}`)

const router = loadRouter()
ok(typeof router.classifyPolicy === 'function' && router.POLICIES.join() === 'fast,balanced,strict', 'the router block of the engine loads on its own')
eq(rulesOf(router, { fastMaxFiles: 1, strictTags: 'bad' }).fastMaxFiles, 1, '{policies} keys apply over the defaults')
eq(rulesOf(router, { strictTags: 'bad' }).strictTags, ['infra'], 'a malformed key keeps its default')

const dir = mkdtempSync(join(tmpdir(), 'grim-cf-'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
mkdirSync(join(dir, 'r1'))
writeFileSync(join(dir, 'r1', 'landed.jsonl'), [
  { id: 'P-1', files: ['README.md — document it'] },
  { id: 'P-2', files: ['src/auth/login.ts'] },
  { id: 'P-3', files: ['src/a.ts'] },
].map((d) => JSON.stringify(d)).join('\n'))
const R = (task, model, reason = 'x') => ({ type: 'route', task, repo: 'api', agent: 'backend-engineer', model, reason })
const run = {
  runId: 'r1',
  events: [
    R('P-1', 'sonnet'), R('P-2', 'sonnet'), R('P-3', 'haiku'), R('P-4', 'sonnet'),
    { type: 'review', task: 'P-3', stage: 'quality', persona: 'Adversarial QA & Integrity', verdict: 'FAIL', gating: 1, round: 0 },
    { type: 'fix', task: 'P-3', stage: 'quality', round: 1 },
    { type: 'review', task: 'P-3', stage: 'quality', persona: 'Adversarial QA & Integrity', verdict: 'PASS', gating: 0, round: 1 },
    { type: 'review', task: 'P-1', stage: 'quality', persona: 'Eventing & Data-Integrity Engineer', verdict: 'PASS', gating: 0, round: 0 },
  ],
}
const rows = counterfactualRun(run, join(dir, 'r1'), { router, rules: rulesOf(router, {}), tagsOf: () => ['backend'], migrationAgents: ['migration-engineer'] })
const by = Object.fromEntries(rows.map((t) => [t.id, t]))
eq(['P-1', 'P-2', 'P-3', 'P-4'].map((id) => by[id].auto), ['fast', 'strict', 'fast', 'balanced'], 'docs → fast · auth → strict · small haiku → fast · never landed (no files) → balanced')
eq(by['P-3'].skippedIfFast, 1, 'FAST would have skipped the re-review round')
eq(by['P-1'].skippedIfFast, 1, '…and the per-task data-integrity lens')
const out = report(rows.map((t) => ({ run: 'r1', ...t })))
eq(out.mix, { fast: 2, strict: 1, balanced: 1 }, 'the mix')
eq(out.misroutes.map((m) => [m.id, m.why]), [['P-3', ['round-0 FAIL (quality:Adversarial QA & Integrity)']]], 'a FAST pick with a recorded round-0 FAIL is a misroute to look at')

// declared files (0.18.0 on): the router sees the declared footprint, not declared + changed
mkdirSync(join(dir, 'r2'))
writeFileSync(join(dir, 'r2', 'landed.jsonl'), [
  { id: 'D-1', files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], declared: ['src/a.ts'] },
  { id: 'D-2', files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'] },
].map((d) => JSON.stringify(d)).join('\n'))
const rows2 = counterfactualRun({ runId: 'r2', events: [R('D-1', 'sonnet'), R('D-2', 'sonnet')] }, join(dir, 'r2'), { router, rules: rulesOf(router, {}), tagsOf: () => ['backend'], migrationAgents: ['migration-engineer'] })
eq(rows2.map((t) => [t.id, t.auto, t.declared]), [['D-1', 'fast', true], ['D-2', 'balanced', false]], 'a record with `declared` routes on it; an older one on declared + changed files')
eq(report(rows2).declaredCoverage, 1, 'declaredCoverage counts the tasks routed on declared files')

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
