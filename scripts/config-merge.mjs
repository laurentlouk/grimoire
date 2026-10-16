#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  config-merge — the setup re-run's diff, and a write of only what is approved
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/config-merge.mjs --current <file> --proposed <file>
//                                [--approve <path>]… [--write [--out <file>]] [--json]
//      → prints what the proposal would add, change or keep in the current file.
//        Without --write nothing is written. With --write, the merged file goes to
//        --current's path (or --out), atomically (temp file + rename), 2-space JSON with a
//        trailing newline; when the merge equals the current file, nothing is touched.
//
//  For grimoire.config.json and .claude/settings.json (any JSON object, really):
//    ADDED     a key the current file lacks. Applied by --write.
//    CHANGED   a key both files hold with different values. Applied only when an
//              --approve names its path exactly as printed (quote it: zsh globs on `[`),
//              e.g. --approve 'guard.protectedBranches' --approve 'repos[api].gate'.
//              A declined change is still a difference, so the next run lists it again.
//    KEPT      a key only the current file has. Always kept.
//    unchanged equal values: not printed, counted; --json lists their paths. An item both
//              sides of a set (below) hold is neither listed nor counted.
//  Objects merge key by key; the user's keys keep their order and added keys are appended.
//  Arrays are values, compared whole, except:
//    keyed     repos[] by `name`, specialists[] by `agent`, hooks.<Event>[] by `matcher`
//              (absent = ""): an entry is a unit (added or kept whole), a matched one is
//              merged key by key, `repos[api].gate`. The current order stays; added entries
//              append. Entries without their key, or with a duplicate one, make the array a
//              value again.
//    sets      permissions.allow / deny / ask / additionalDirectories and each hook group's
//              hooks[]: the user's items stay, in order, and proposed items not already there
//              (deep equality) are appended once. Nothing in them is ever CHANGED, so a
//              re-run never drops a rule the user added and never adds one twice.
//    atomic    repos[].gate, requireHook and extraKnownMarketplaces.<name>.source compare
//              whole like a value: their fields only make sense together.
//
//  A missing current file means everything is ADDED (first-time setup). Invalid JSON, or a
//  top level that is not an object, in either file: exit 1 with one line naming the file,
//  nothing written. An --approve that names no CHANGED path warns on stderr and is ignored.
//  Secret-looking values (any string under a key matching token|secret|password|apikey|
//  api_key) print as «redacted», in the text and the --json output alike; numbers and
//  booleans are not secrets (maxOutputTokens stays visible). The written file is unaffected.
//
//  Plain Node ≥ 20, no dependencies. The guard hook refuses agent Write/Edit calls on
//  .claude/settings.json; this script is how the setup skill writes it, after the user's yes.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, chmodSync, realpathSync, rmSync } from 'node:fs'
import { resolve, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REDACTED = '«redacted»'
const SECRET = /token|secret|password|apikey|api_key/i

// Path patterns: `.` between keys, `*` any one key, `[]` any keyed entry.
const tokens = (p) => p.replace(/\[\]/g, '.[]').split('.').filter(Boolean)
export const RULES = {
  keyed: [
    { pattern: tokens('repos'), id: (e) => (typeof e.name === 'string' ? e.name : null) },
    { pattern: tokens('specialists'), id: (e) => (typeof e.agent === 'string' ? e.agent : null) },
    { pattern: tokens('hooks.*'), id: (e) => (e.matcher === undefined ? '' : typeof e.matcher === 'string' ? e.matcher : null) },
  ],
  sets: ['permissions.allow', 'permissions.deny', 'permissions.ask', 'permissions.additionalDirectories', 'hooks.*[].hooks'].map(tokens),
  atomic: ['repos[].gate', 'requireHook', 'extraKnownMarketplaces.*.source'].map(tokens),
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
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
const isSet = (segs) => RULES.sets.some((p) => matches(p, segs))
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

// Every string under a secret-looking key, at any depth, becomes «redacted».
export function redact(v, hidden = false) {
  if (Array.isArray(v)) return v.map((x) => redact(x, hidden))
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) put(o, k, redact(v[k], hidden || SECRET.test(k))); return o }
  return hidden && typeof v === 'string' ? REDACTED : v
}
const shown = (segs, v) => redact(v, segs.some((g) => g.k !== undefined && SECRET.test(g.k)))

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
    if (isSet(segs)) return mergeSet(cur, prop, segs, ctx)
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

function mergeSet(cur, prop, segs, ctx) {
  const s = [...segs, { item: true }]
  for (const x of cur) if (!prop.some((y) => deepEqual(x, y))) ctx.kept.push({ segs: s, value: x })
  const out = [...cur]
  for (const y of prop) if (!out.some((x) => deepEqual(x, y))) { ctx.added.push({ segs: s, value: y }); out.push(y) }
  return out
}

// planMerge(current, proposed, approve) → { merged, added, changed, kept, unchanged, ignoredApprovals }.
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
  }
}

// The printable view of a plan: secrets redacted, no internal fields.
export function view(plan) {
  return {
    added: plan.added.map((e) => ({ path: e.path, value: shown(e.segs, e.value) })),
    changed: plan.changed.map((e) => ({ path: e.path, current: shown(e.segs, e.current), proposed: shown(e.segs, e.proposed), approved: e.approved })),
    kept: plan.kept.map((e) => ({ path: e.path, value: shown(e.segs, e.value) })),
    unchanged: plan.unchanged,
    ignoredApprovals: plan.ignoredApprovals.map((e) => e.path),
  }
}

export function renderText(plan, { current, proposed, currentExists = true, write = false, written = null } = {}) {
  const v = view(plan)
  const j = (x) => JSON.stringify(x)
  const out = [`config-merge: ${current} ← ${proposed}${currentExists ? '' : ' (no current file: everything is added)'}`]
  for (const e of v.added) out.push(`  ADDED    ${e.path}  ${j(e.value)}`)
  for (const e of v.changed) out.push(`  CHANGED  ${e.path}  ${j(e.current)} → ${j(e.proposed)}  ${e.approved ? '(approved)' : `(kept: needs --approve '${e.path}')`}`)
  for (const e of v.kept) out.push(`  KEPT     ${e.path}  ${j(e.value)}  (only in the current file)`)
  out.push(`${v.added.length} added · ${v.changed.length} changed (${v.changed.filter((e) => e.approved).length} approved) · ${v.kept.length} kept · ${v.unchanged.length} unchanged`)
  if (!write) out.push('nothing written: dry run (add --write to apply the added keys and the approved changes)')
  else if (written) out.push(`wrote ${written}`)
  else out.push(`nothing to write: ${current} already holds the merged result`)
  return out.join('\n') + '\n'
}

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
    if (!m) die(`unexpected argument ${JSON.stringify(argv[i])}\n${USAGE}`)
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

// → { exists, value }; exits 1 naming the file on a read or parse failure.
function load(file, { optional }) {
  let raw
  try { raw = readFileSync(file, 'utf8') } catch (e) {
    if (e.code === 'ENOENT' && optional) return { exists: false, value: {} }
    die(`${file}: ${e.code === 'ENOENT' ? 'not found' : `cannot read (${e.code || e.message})`}`)
  }
  let value
  try { value = JSON.parse(raw) } catch (e) { die(`${file}: invalid JSON (${e.message.split('\n')[0]})`) }
  if (!isObj(value)) die(`${file}: the top level must be a JSON object`)
  return { exists: true, value }
}

// Temp file in the target's directory, then rename: a reader never sees half a file. A
// symlinked target is written through to the file it points at; an existing file keeps its mode.
function writeAtomic(file, text) {
  let target = resolve(file)
  if (existsSync(target)) target = realpathSync(target)
  mkdirSync(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.${basename(target)}.config-merge-${process.pid}.tmp`)
  try {
    writeFileSync(tmp, text)
    if (existsSync(target)) chmodSync(tmp, statSync(target).mode & 0o7777)
    renameSync(tmp, target)
  } catch (e) {
    rmSync(tmp, { force: true })
    die(`${file}: cannot write (${e.code || e.message})`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cur = load(args.current, { optional: true })
  const prop = load(args.proposed, { optional: false })
  const plan = planMerge(cur.value, prop.value, args.approve)
  for (const { path, why } of plan.ignoredApprovals) {
    process.stderr.write(`config-merge: --approve '${path}' is not a changed key${why ? ` (it is ${why})` : ''}; ignored\n`)
  }
  if (args.out && !args.write) process.stderr.write('config-merge: --out is ignored without --write\n')
  let written = null
  if (args.write) {
    const target = args.out || args.current
    const untouched = target === args.current && cur.exists && deepEqual(plan.merged, cur.value)
    if (!untouched) { writeAtomic(target, JSON.stringify(plan.merged, null, 2) + '\n'); written = target }
  }
  const meta = { current: args.current, proposed: args.proposed, currentExists: cur.exists, write: args.write, written }
  if (args.json) {
    process.stdout.write(JSON.stringify({ current: args.current, proposed: args.proposed, currentExists: cur.exists, ...view(plan), written }, null, 2) + '\n')
  } else {
    process.stdout.write(renderText(plan, meta))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
