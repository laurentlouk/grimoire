// grimoire · tests for scripts/version-check.mjs: every change that ships bumps the plugin version.
//   Run:  node scripts/version-check.test.mjs
import { versionVerdict, newer } from './version-check.mjs'

let PASS = 0, FAIL = 0
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); if (s) PASS++; else FAIL++; console.log(`   ${s ? '✓' : '✗ FAIL:'} ${m}${s ? '' : ` (got ${JSON.stringify(a)})`}`) }

eq([newer('0.13.0', '0.12.1'), newer('0.12.10', '0.12.9'), newer('1.0.0', '0.99.99'), newer('0.12.1', '0.12.1'), newer('0.12.0', '0.12.1')], [true, true, true, false, false], 'newer compares numerically, part by part')

eq(versionVerdict({ version: '0.13.0', changelogTop: '## 0.13.0 — the tracker follows the run' }), [], 'a changelog led by the plugin version passes without a base')
eq(versionVerdict({ version: '0.13.0', changelogTop: '## Unreleased — the loop stops redoing what it already did' }),
  ['CHANGELOG.md: the top entry is "## Unreleased — the loop stops redoing what it already did"; it must be "## 0.13.0 — …", the version in .claude-plugin/plugin.json (a change ships with its version)'],
  'an Unreleased entry fails: work ships under its version')
eq(versionVerdict({ version: '0.13.0', changelogTop: null }), ['CHANGELOG.md: no "## <version>" entry; the top one must be "## 0.13.0 — …"'], 'a changelog with no entry fails')

const top = '## 0.13.0 — x'
eq(versionVerdict({ version: '0.12.1', baseVersion: '0.12.1', changed: ['workflows/orchestrate-loop.js', 'docs/notes.md'], changelogTop: '## 0.12.1 — y' }),
  ['.claude-plugin/plugin.json: version 0.12.1 is the base\'s; this change touches workflows/orchestrate-loop.js, so it needs a higher version (and its CHANGELOG.md entry)'],
  'a change to the plugin without a bump fails, naming the first file')
eq(versionVerdict({ version: '0.13.0', baseVersion: '0.12.1', changed: ['workflows/orchestrate-loop.js'], changelogTop: top }), [], 'with a bump it passes')
eq(versionVerdict({ version: '0.12.1', baseVersion: '0.12.1', changed: ['docs/specs/a.md', '.github/workflows/ci.yml'], changelogTop: '## 0.12.1 — y' }), [], 'docs and CI-only changes need no bump')
eq(versionVerdict({ version: '0.12.0', baseVersion: '0.12.1', changed: ['skills/review/SKILL.md'], changelogTop: '## 0.12.0 — y' }),
  ['.claude-plugin/plugin.json: version 0.12.0 is not higher than the base\'s 0.12.1; this change touches skills/review/SKILL.md, so it needs a higher version (and its CHANGELOG.md entry)'],
  'a lower version fails')
eq(versionVerdict({ version: '0.13.0', baseVersion: '0.12.1', changed: [], changelogTop: top }), [], 'nothing changed: nothing to bump')

console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
