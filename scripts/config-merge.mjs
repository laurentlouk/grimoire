#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  config-merge — the setup re-run's diff, and a write of only what is approved
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/config-merge.mjs --current <file> --proposed <file>
//                                [--approve <path>]… [--write [--out <file>]] [--json]
//      → prints what the proposal would add, change or keep in the current file, naming both
//        by absolute path (and a symlink's target). Without --write nothing is written. With
//        --write, the merged file goes to --current's path (or --out), atomically (temp file
//        with the file's mode, then rename), 2-space JSON with a trailing newline; a symlink,
//        live or dangling, is written through, never replaced; when the merge equals the
//        current file, nothing is touched.
//
//  For grimoire.config.json and .claude/settings.json (any JSON object, really):
//    ADDED     a key the current file lacks. Applied by --write.
//    CHANGED   a key both files hold with different values. Applied only when an
//              --approve names its path exactly as printed. The printed hint is shell-quoted
//              (zsh globs on `[`), e.g. --approve 'guard.protectedBranches' --approve
//              'repos[api].gate'. A declined change is still a difference, so the next run
//              lists it again.
//    KEPT      a key only the current file has. Always kept.
//    unchanged equal values: not printed, counted; --json lists their paths. An item both
//              sides of a set (below) hold is neither listed nor counted.
//  Objects merge key by key; the user's keys keep their order and added keys are appended.
//  Arrays are values, compared whole, except:
//    keyed     repos[] by `name`, specialists[] by `agent`, hooks.<Event>[] by `matcher`
//              (absent = ""): an entry is a unit (added or kept whole), a matched one is
//              merged key by key, `repos[api].gate`. The current order stays; added entries
//              append. Entries without their key, or with a duplicate one, make the array a
//              value again. An added repos[] entry on the path of another entry is warned about
//              on stderr (a renamed repo would otherwise be kept twice).
//    sets      permissions.allow / deny / ask / additionalDirectories and each hook group's
//              hooks[]: the user's items stay, in order, and proposed items not already there
//              are appended once (deep equality; a hook is the same hook when its type and
//              command are, so a user's entry with a timeout is KEPT, not duplicated). Nothing
//              in them is ever CHANGED, so a re-run never drops a rule the user added and
//              never adds one twice.
//    atomic    repos[].gate, requireHook and extraKnownMarketplaces.<name>.source compare
//              whole like a value: their fields only make sense together.
//
//  A missing current file means everything is ADDED (first-time setup). Invalid JSON, or a
//  top level that is not an object, in either file: exit 1 with one line naming the file and,
//  for invalid JSON, the line and column only (Node's own message quotes the source, and the
//  source can hold a token); nothing written. An --approve that names no CHANGED path warns on
//  stderr and is ignored.
//
//  Secrets never reach the output, text or --json (the written file is unaffected):
//    • every string under an `env` key, at any depth, whatever its name;
//    • every string under a key named like a secret: token, secret, passw, pwd, api key,
//      private or access key, auth, credential, bearer, cookie, session id/key/token, dsn,
//      signature, a `key`/`pat` suffix (STRIPE_KEY, GITHUB_PAT, sshKey). Numbers and booleans
//      are not secrets, so maxOutputTokens stays visible;
//    • inside any other string, with the rest kept: `token=`/`api-key:`/`Authorization:`-style
//      pairs, `Bearer …`, URL credentials (`://user:pass@`), known token formats (sk_, pk_,
//      ghp_, github_pat_, xoxb-, AKIA…).
//  They print as «redacted».
//
//  Plain Node ≥ 20, no dependencies. The guard hook closes .claude/settings.json to agents'
//  Write and Edit calls, and setup does not route around it: for that file the setup skill
//  prints this script's --write command and the user runs it.
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, lstatSync, chmodSync, realpathSync, readlinkSync, rmSync } from 'node:fs'
import { resolve, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

export const REDACTED = '«redacted»'

// Path patterns: `.` between keys, `*` any one key, `[]` any keyed entry.
const tokens = (p) => p.replace(/\[\]/g, '.[]').split('.').filter(Boolean)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
export const RULES = {
  keyed: [
    { pattern: tokens('repos'), id: (e) => (typeof e.name === 'string' ? e.name : null) },
    { pattern: tokens('specialists'), id: (e) => (typeof e.agent === 'string' ? e.agent : null) },
    { pattern: tokens('hooks.*'), id: (e) => (e.matcher === undefined ? '' : typeof e.matcher === 'string' ? e.matcher : null) },
  ],
  sets: [
    ...['permissions.allow', 'permissions.deny', 'permissions.ask', 'permissions.additionalDirectories'].map((p) => ({ pattern: tokens(p), key: null })),
    { pattern: tokens('hooks.*[].hooks'), key: (e) => (isObj(e) && typeof e.type === 'string' && typeof e.command === 'string' ? JSON.stringify([e.type, e.command]) : null) },
  ],
  atomic: ['repos[].gate', 'requireHook', 'extraKnownMarketplaces.*.source'].map(tokens),
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
// A key such as "__proto__" from JSON.parse is an own property; plain assignment would not be.
const put = (o, k, v) => { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); return o }

export function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (isObj(a)) {
    if (!isObj(b)) return false
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => own(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

// segs: { k } an object key, { id } a keyed entry, { item: true } a set item.
const matches = (pattern, segs) => pattern.length === segs.length
  && pattern.every((t, i) => (t === '[]' ? segs[i].id !== undefined : segs[i].k !== undefined && (t === '*' || t === segs[i].k)))
const keyedRule = (segs) => RULES.keyed.find((r) => matches(r.pattern, segs))
const setRule = (segs) => RULES.sets.find((r) => matches(r.pattern, segs))
const isAtomic = (segs) => RULES.atomic.some((p) => matches(p, segs))

export function formatPath(segs) {
  let s = ''
  for (const g of segs) {
    if (g.k !== undefined) s += /^[^.[\]"\s]+$/.test(g.k) ? (s ? '.' : '') + g.k : `[${JSON.stringify(g.k)}]`
    else if (g.id !== undefined) s += /^[^[\]"]+$/.test(g.id) ? `[${g.id}]` : `[${JSON.stringify(g.id)}]`
    else s += '[]'
  }
  return s
}

// One single-quoted shell word: a ' closes the quote, is escaped, and reopens it.
export const shellQuote = (s) => `'${String(s).replace(/'/g, `'"'"'`)}'`

// ── secrets ──
// Session keys are matched by their id/key/token suffix only: SessionStart is a hook event.
const SECRET_KEY = /token|secret|passw|pwd|api[-_]?key|private[-_]?key|access[-_]?key|auth|credential|bearer|cookie|session[-_]?(?:id|key|token)|^session$|dsn|signature|(?:^|[-_])(?:key|pat)$/i
const CAMEL_KEY = /[a-z0-9](?:Key|Pat|PAT)$/ // sshKey, signingKey; not "monkey"
const ENV = /^env$/i
export const isSecretKey = (k) => SECRET_KEY.test(k) || CAMEL_KEY.test(k)
const hides = (k) => ENV.test(k) || isSecretKey(k)
const VALUE = `[^\\s"'\`,;&)]+`
const MASKS = [
  // a name=value or name: value pair, a scheme word included: token=…, "x-api-key: …", Authorization: Bearer …
  [new RegExp(`((?:authorization|token|secret|api[-_]?key|passw(?:or)?d|pwd)["']?\\s*[=:]\\s*["']?)(?:(?:bearer|basic)\\s+)?${VALUE}`, 'gi'), `$1${REDACTED}`],
  [new RegExp(`\\b(bearer)\\s+${VALUE}`, 'gi'), `$1 ${REDACTED}`],
  [/(:\/\/)[^\s/@"'`]+@/g, `$1${REDACTED}@`], // URL credentials
  [/\b(?:sk|pk|rk|ghp|gho|ghs|ghu|ghr|github_pat|xox[abpr])[-_][\w-]{8,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
]
// Masks the secrets a string carries, keeping the rest of it.
export const mask = (s) => MASKS.reduce((t, [re, to]) => t.replace(re, to), s)

// The printable form of a value: every string under an env or secret-looking key becomes
// «redacted», any other string is masked; keys are masked too.
export function redact(v, hidden = false) {
  if (Array.isArray(v)) return v.map((x) => redact(x, hidden))
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) put(o, mask(k), redact(v[k], hidden || hides(k))); return o }
  if (typeof v === 'string') return hidden ? REDACTED : mask(v)
  return v
}
const shown = (segs, v) => redact(v, segs.some((g) => g.k !== undefined && hides(g.k)))

// ── the merge ──
function walk(cur, prop, segs, ctx) {
  // The root always descends, so an equal file lists its top-level keys as unchanged.
  if (segs.length && deepEqual(cur, prop)) { ctx.unchanged.push({ segs }); return cur }
  if (isObj(cur) && isObj(prop) && !isAtomic(segs)) {
    const out = {}
    for (const k of Object.keys(cur)) {
      const s = [...segs, { k }]
      if (own(prop, k)) put(out, k, walk(cur[k], prop[k], s, ctx))
      else { ctx.kept.push({ segs: s, value: cur[k] }); put(out, k, cur[k]) }
    }
    for (const k of Object.keys(prop)) if (!own(cur, k)) { ctx.added.push({ segs: [...segs, { k }], value: prop[k] }); put(out, k, prop[k]) }
    return out
  }
  if (Array.isArray(cur) && Array.isArray(prop)) {
    const rule = keyedRule(segs)
    const merged = rule && mergeKeyed(cur, prop, segs, rule, ctx)
    if (merged) return merged
    const set = setRule(segs)
    if (set) return mergeSet(cur, prop, segs, set, ctx)
  }
  const path = formatPath(segs)
  const approved = ctx.approve.has(path)
  ctx.changed.push({ segs, current: cur, proposed: prop, approved })
  return approved ? prop : cur
}

function mergeKeyed(cur, prop, segs, rule, ctx) {
  const ids = (xs) => xs.map((e) => (isObj(e) ? rule.id(e) : null))
  const ci = ids(cur), pi = ids(prop)
  const unique = (xs) => new Set(xs).size === xs.length
  if ([...ci, ...pi].includes(null) || !unique(ci) || !unique(pi)) return null // not keyable: a value
  const byId = new Map(prop.map((e, i) => [pi[i], e]))
  const out = cur.map((e, i) => {
    const s = [...segs, { id: ci[i] }]
    if (byId.has(ci[i])) return walk(e, byId.get(ci[i]), s, ctx)
    ctx.kept.push({ segs: s, value: e })
    return e
  })
  prop.forEach((e, i) => { if (!ci.includes(pi[i])) { ctx.added.push({ segs: [...segs, { id: pi[i] }], value: e }); out.push(e) } })
  return out
}

function mergeSet(cur, prop, segs, rule, ctx) {
  const s = [...segs, { item: true }]
  const key = rule.key || (() => null)
  const alike = (x, y) => deepEqual(x, y) || (key(x) !== null && key(x) === key(y))
  for (const x of cur) if (!prop.some((y) => deepEqual(x, y))) ctx.kept.push({ segs: s, value: x })
  const out = [...cur]
  for (const y of prop) if (!out.some((x) => alike(x, y))) { ctx.added.push({ segs: s, value: y }); out.push(y) }
  return out
}

// An added repos[] entry on the path of another one is most likely a renamed repo.
function repoPathWarnings(ctx, merged) {
  const norm = (p) => (typeof p === 'string' ? p.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '') : null)
  const adds = ctx.added.filter((e) => e.segs.length === 2 && e.segs[0].k === 'repos' && e.segs[1].id !== undefined)
  if (!adds.length || !Array.isArray(merged.repos)) return []
  const addedIds = new Set(adds.map((e) => e.segs[1].id))
  const out = []
  for (const a of adds) {
    const p = norm(a.value.path)
    if (!p) continue
    for (const other of merged.repos) {
      if (!isObj(other) || addedIds.has(other.name) || norm(other.path) !== p) continue
      out.push(`${formatPath(a.segs)} (added) has the same path as ${formatPath([{ k: 'repos' }, { id: other.name }])} (${p}): a renamed repo? Both entries would be kept`)
    }
  }
  return out
}

// planMerge(current, proposed, approve) → { merged, added, changed, kept, unchanged, ignoredApprovals, warnings }.
// Pure: the inputs are not mutated, values in the lists are the raw (unredacted) ones.
export function planMerge(current, proposed, approve = []) {
  const ctx = { approve: new Set(approve), added: [], changed: [], kept: [], unchanged: [] }
  const merged = walk(structuredClone(current), structuredClone(proposed), [], ctx)
  const at = (e) => formatPath(e.segs)
  const changedPaths = new Set(ctx.changed.map(at))
  const label = (p) => (ctx.added.some((e) => at(e) === p) ? 'added' : ctx.kept.some((e) => at(e) === p) ? 'only in the current file' : ctx.unchanged.some((e) => at(e) === p) ? 'unchanged' : null)
  return {
    merged,
    added: ctx.added.map((e) => ({ path: at(e), value: e.value, segs: e.segs })),
    changed: ctx.changed.map((e) => ({ path: at(e), current: e.current, proposed: e.proposed, approved: e.approved, segs: e.segs })),
    kept: ctx.kept.map((e) => ({ path: at(e), value: e.value, segs: e.segs })),
    unchanged: ctx.unchanged.map(at),
    ignoredApprovals: [...new Set(approve)].filter((p) => !changedPaths.has(p)).map((path) => ({ path, why: label(path) })),
    warnings: repoPathWarnings(ctx, merged),
  }
}

// The printable view of a plan: secrets redacted and masked, no internal fields.
export function view(plan) {
  return {
    added: plan.added.map((e) => ({ path: mask(e.path), value: shown(e.segs, e.value) })),
    changed: plan.changed.map((e) => ({ path: mask(e.path), current: shown(e.segs, e.current), proposed: shown(e.segs, e.proposed), approved: e.approved })),
    kept: plan.kept.map((e) => ({ path: mask(e.path), value: shown(e.segs, e.value) })),
    unchanged: plan.unchanged.map(mask),
    ignoredApprovals: plan.ignoredApprovals.map((e) => mask(e.path)),
    warnings: plan.warnings.map(mask),
  }
}

const named = (abs, linksTo) => mask(abs) + (linksTo ? ` (symlink → ${mask(linksTo)})` : '')

export function renderText(plan, { current, currentLinksTo = null, proposed, proposedLinksTo = null, currentExists = true, write = false, written = null, writtenLinksTo = null } = {}) {
  const v = view(plan)
  const j = (x) => JSON.stringify(x)
  const out = [`config-merge: ${named(current, currentLinksTo)} ← ${named(proposed, proposedLinksTo)}${currentExists ? '' : ' (no current file: everything is added)'}`]
  for (const e of v.added) out.push(`  ADDED    ${e.path}  ${j(e.value)}`)
  for (const e of v.changed) out.push(`  CHANGED  ${e.path}  ${j(e.current)} → ${j(e.proposed)}  ${e.approved ? '(approved)' : `(kept: needs --approve ${shellQuote(e.path)})`}`)
  for (const e of v.kept) out.push(`  KEPT     ${e.path}  ${j(e.value)}  (only in the current file)`)
  out.push(`${v.added.length} added · ${v.changed.length} changed (${v.changed.filter((e) => e.approved).length} approved) · ${v.kept.length} kept · ${v.unchanged.length} unchanged`)
  if (!write) out.push('nothing written: dry run (add --write to apply the added keys and the approved changes)')
  else if (written) out.push(`wrote ${named(written, writtenLinksTo)}`)
  else out.push(`nothing to write: ${named(current, currentLinksTo)} already holds the merged result`)
  return out.join('\n') + '\n'
}

// Where a JSON parse failed, as an offset, found by a small RFC 8259 scanner: Node's message
// can quote the source, which may hold a secret. null when the scanner finds no error.
export function jsonErrorAt(s) {
  let i = 0
  const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const fail = () => { throw { at: i } }
  const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i])) i++ }
  const str = () => {
    i++
    while (i < s.length) {
      const c = s[i]
      if (c === '"') { i++; return }
      if (c === '\\') {
        const n = s[i + 1]
        if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) i += 6
        else if (n !== undefined && '"\\/bfnrt'.includes(n)) i += 2
        else { i++; fail() }
      } else if (c < ' ') fail()
      else i++
    }
    fail()
  }
  const word = (w) => { if (!s.startsWith(w, i)) fail(); i += w.length } // a bad literal is pointed at by its first letter
  const value = () => {
    ws()
    const c = s[i]
    if (c === '{') {
      i++; ws()
      if (s[i] === '}') { i++; return }
      for (;;) {
        ws(); if (s[i] !== '"') fail(); str(); ws(); if (s[i] !== ':') fail(); i++; value(); ws()
        if (s[i] === ',') { i++; continue }
        if (s[i] === '}') { i++; return }
        fail()
      }
    }
    if (c === '[') {
      i++; ws()
      if (s[i] === ']') { i++; return }
      for (;;) {
        value(); ws()
        if (s[i] === ',') { i++; continue }
        if (s[i] === ']') { i++; return }
        fail()
      }
    }
    if (c === '"') return str()
    if (c === 't') return word('true')
    if (c === 'f') return word('false')
    if (c === 'n') return word('null')
    NUM.lastIndex = i
    if (NUM.exec(s)) { i = NUM.lastIndex; return }
    fail()
  }
  try { value(); ws(); if (i < s.length) fail(); return null } catch (e) { return e && typeof e.at === 'number' ? e.at : null }
}

const lineCol = (s, at) => { const before = s.slice(0, at); const nl = before.lastIndexOf('\n'); return [before.split('\n').length, at - nl] }

// ── CLI ──
const USAGE = 'usage: config-merge.mjs --current <file> --proposed <file> [--approve <path>]… [--write [--out <file>]] [--json]'

function die(msg) {
  process.stderr.write(`config-merge: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const a = { approve: [], write: false, json: false }
  const takes = new Set(['current', 'proposed', 'approve', 'out'])
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-h' || argv[i] === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0) }
    const m = /^--([\w-]+)(?:=(.*))?$/s.exec(argv[i])
    if (!m) die(`unexpected argument ${JSON.stringify(mask(argv[i]))}\n${USAGE}`)
    const [, k, inline] = m
    if (k === 'write' || k === 'json') { a[k] = true; continue }
    if (!takes.has(k)) die(`unknown option --${k}\n${USAGE}`)
    const v = inline !== undefined ? inline : argv[++i]
    if (v === undefined) die(`--${k} needs a value\n${USAGE}`)
    if (k === 'approve') a.approve.push(v)
    else a[k] = v
  }
  if (!a.current) die(`--current is required\n${USAGE}`)
  if (!a.proposed) die(`--proposed is required\n${USAGE}`)
  return a
}

// The file a path finally names: a symlink chain is followed even when its end does not exist
// yet (a dangling link is written through, like a live one).
function followLinks(p) {
  for (let hops = 0; hops < 40; hops++) {
    let st
    try { st = lstatSync(p) } catch { return p }
    if (!st.isSymbolicLink()) return realpathSync(p)
    p = resolve(dirname(p), readlinkSync(p))
  }
  throw Object.assign(new Error('too many symlinks'), { code: 'ELOOP' })
}

// → { abs, linksTo }: the absolute path, and where it points when it is a symlink.
function describe(file) {
  const abs = resolve(file)
  try { return { abs, linksTo: lstatSync(abs).isSymbolicLink() ? followLinks(abs) : null } } catch { return { abs, linksTo: null } }
}

// → { exists, value }; exits 1 naming the file on a read or parse failure.
function load(abs, { optional }) {
  let raw
  try { raw = readFileSync(abs, 'utf8') } catch (e) {
    if (e.code === 'ENOENT' && optional) return { exists: false, value: {} }
    die(`${mask(abs)}: ${e.code === 'ENOENT' ? 'not found' : `cannot read (${e.code || 'error'})`}`)
  }
  let value
  try { value = JSON.parse(raw) } catch {
    const at = jsonErrorAt(raw)
    die(`${mask(abs)}: invalid JSON${at === null ? '' : ` at line ${lineCol(raw, at).join(', column ')}`}`)
  }
  if (!isObj(value)) die(`${mask(abs)}: the top level must be a JSON object`)
  return { exists: true, value }
}

// Temp file in the target's directory, created with the file's mode and never over another
// file, then renamed onto it: a reader never sees half a file. Any failure is one line.
function writeAtomic(abs, text) {
  let tmp = null
  try {
    const target = followLinks(abs)
    let mode = 0o666, existed = false
    try { mode = statSync(target).mode & 0o7777; existed = true } catch {}
    mkdirSync(dirname(target), { recursive: true })
    tmp = join(dirname(target), `.${basename(target)}.config-merge-${process.pid}-${randomBytes(4).toString('hex')}.tmp`)
    writeFileSync(tmp, text, { mode, flag: 'wx' })
    if (existed) chmodSync(tmp, mode) // the umask may have narrowed it
    renameSync(tmp, target)
  } catch (e) {
    if (tmp) rmSync(tmp, { force: true })
    die(`${mask(abs)}: cannot write (${e.code || 'error'})`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cur = describe(args.current), prop = describe(args.proposed)
  const current = load(cur.abs, { optional: true })
  const proposed = load(prop.abs, { optional: false })
  const plan = planMerge(current.value, proposed.value, args.approve)
  const shownPlan = view(plan)
  plan.ignoredApprovals.forEach(({ why }, i) => {
    process.stderr.write(`config-merge: --approve ${shellQuote(shownPlan.ignoredApprovals[i])} is not a changed key${why ? ` (it is ${why})` : ''}; ignored\n`)
  })
  for (const w of shownPlan.warnings) process.stderr.write(`config-merge: warning: ${w}\n`)
  if (args.out && !args.write) process.stderr.write('config-merge: --out is ignored without --write\n')
  let written = null
  if (args.write) {
    const target = args.out ? describe(args.out) : cur
    const untouched = target.abs === cur.abs && current.exists && deepEqual(plan.merged, current.value)
    if (!untouched) { writeAtomic(target.abs, JSON.stringify(plan.merged, null, 2) + '\n'); written = target }
  }
  if (args.json) {
    process.stdout.write(JSON.stringify({
      current: mask(cur.abs), proposed: mask(prop.abs), currentExists: current.exists, currentLinksTo: cur.linksTo && mask(cur.linksTo),
      ...shownPlan, written: written && mask(written.abs),
    }, null, 2) + '\n')
  } else {
    process.stdout.write(renderText(plan, {
      current: cur.abs, currentLinksTo: cur.linksTo, proposed: prop.abs, proposedLinksTo: prop.linksTo, currentExists: current.exists,
      write: args.write, written: written && written.abs, writtenLinksTo: written && written.linksTo,
    }))
  }
}

// Through a symlinked directory or file, argv[1] is the link and import.meta.url the real file.
const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) main()
