// grimoire · tests for scripts/private-names.mjs: the tripwire that keeps a private project's names
// out of the repository, checked here against a synthetic deny list (made-up words), then the real
// list against the real tree.
//   Run:  node scripts/private-names.test.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { DENY, JOINED_MIN, MAX_BYTES, MESSAGE, denyEntry, matcher, scanText, scanTree, report, sha256hex } from './private-names.mjs'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) PASS++; else FAIL++; console.log(`   ${c ? '✓' : '✗ FAIL:'} ${m}`) }
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); if (s) PASS++; else FAIL++; console.log(`   ${s ? '✓' : '✗ FAIL:'} ${m}${s ? '' : ` (got ${JSON.stringify(a)})`}`) }

// A synthetic list: a long made-up name (joined forms hit too) and a short made-up key (whole token only).
const LONG = 'zorblax', SHORT = 'zub'
const SYN = [denyEntry(LONG), denyEntry(SHORT)]
ok(SYN.every((d) => !JSON.stringify(d).includes(LONG) && !JSON.stringify(d).includes(SHORT)), 'a deny entry holds a hash and a length, never the word')

{
  const m = matcher(SYN)
  const hit = (s) => scanText(s, m).length > 0
  ok(hit('the zorblax repo') && hit('Zorblax') && hit('ZORBLAX_TOKEN'), 'the long name hits as a word, in any case')
  ok(hit('repositories/zorblax-app') && hit('zorblax-engineer'), 'a hyphenated form hits: the hyphen splits tokens')
  ok(hit('const zorblaxApp = 1') && hit('ZorblaxEngineer') && hit('myzorblaxthing') && hit('zorblax2'), 'a joined form hits: the long name inside a longer token (camelCase, glued, with digits)')
  ok(!hit('zorbla x') && !hit('zorbl-ax') && !hit('zorblex'), 'a near miss does not hit')
  ok(hit('team ZUB') && hit('ZUB-12') && hit("teams: ['zub', 'ops']"), 'the short key hits as a whole token, a ticket key included')
  ok(!hit('zubat') && !hit('suburb zubzub') && !hit('azub') && !hit('ZUB2'), 'the short key never hits inside a longer token')
  eq(scanText('first line\nsecond line\nthird zorblaxApp\nfourth\nZUB fifth\nsixth', m), [3, 5], 'the hits are reported by 1-based line')
  eq(scanText('zorblax zorblax ZUB', m), [1], 'a line with several hits is reported once')
  ok(SYN[0].length >= JOINED_MIN && SYN[1].length < JOINED_MIN, `joined forms are checked from ${JOINED_MIN} letters, so a 3-letter key is whole-token only`)
}

{
  // A temp repository: hits in tracked text files only, by file and line, never naming the word.
  const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-private-names-'))
  try {
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
    git('init', '-q')
    writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nThe hub runs zorblaxEngineer.\n')
    writeFileSync(path.join(dir, 'config.json'), '{\n  "scope": {\n    "teams": ["ZUB", "OPS"]\n  }\n}\n')
    writeFileSync(path.join(dir, 'clean.txt'), 'nothing here but a suburb\n')
    writeFileSync(path.join(dir, 'image.bin'), Buffer.concat([Buffer.from([0x89, 0x50, 0, 0]), Buffer.from(' zorblax ')]))
    writeFileSync(path.join(dir, 'big.log'), 'zorblax\n' + 'x'.repeat(MAX_BYTES))
    writeFileSync(path.join(dir, 'untracked.md'), 'zorblax\n')
    git('add', 'notes.md', 'config.json', 'clean.txt', 'image.bin', 'big.log')
    const hits = scanTree(dir, SYN)
    eq(hits, [{ file: 'config.json', line: 3 }, { file: 'notes.md', line: 3 }], 'a temp repo: the tracked text files that hold a name, by line; a binary, a file over the size cap and an untracked file are skipped')
    const lines = report(hits)
    eq(lines, [`config.json:3: ${MESSAGE}`, `notes.md:3: ${MESSAGE}`], 'each hit is reported as its file and line')
    ok(lines.every((l) => !/zorblax|zub/i.test(l)), 'a report never names the matched word')
    eq(scanTree(dir, SYN, ['notes.md', 'gone.md']), [{ file: 'notes.md', line: 3 }], 'a listed file that is missing is skipped')
    eq(scanTree(path.join(dir, 'no-such-dir'), SYN), null, 'a directory git cannot list gives null, never an empty pass')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

{
  // The real list, against the real tree.
  ok(DENY.length === 3 && DENY.every((d) => /^[0-9a-f]{64}$/.test(d.hash) && Number.isInteger(d.length)), 'the frozen list is three SHA-256 hashes with their lengths')
  ok(DENY.some((d) => d.length < JOINED_MIN), 'it holds a short key, kept whole-token only')
  ok(!DENY.some((d) => d.hash === sha256hex(LONG) || d.hash === sha256hex(SHORT)), 'the synthetic words are not on the real list')
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const hits = scanTree(root)
  ok(Array.isArray(hits) && hits.length === 0, `the repository's tracked files hold no name on the list${hits?.length ? ': ' + report(hits).slice(0, 5).join('; ') : ''}`)
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
