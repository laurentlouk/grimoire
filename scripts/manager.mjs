#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  manager — the briefing: what the team owes, ranked by rules anyone can read
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/manager.mjs brief --items <file> [--config grimoire.config.json]
//                                 [--ledger <path>] [--now <iso>] [--root <dir>]
//      → validates the WorkItems, ranks and groups them, writes
//        <root>/.grimoire/manager/briefings/<YYYYMMDD-HHMMSS>.md (UTC), the same text to
//        latest.md, and ledger.json, then prints the briefing's path.
//
//  Input: a JSON array of WorkItems (skills/manager/workitem.schema.json), the scouts'
//  output. The file is refused whole, exit 1, on any invalid item: one line per problem,
//  naming the item's index and field (`items[3].priority: …`), never its value, since ticket
//  text and whatever a scout copied are data that can hold anything. Nothing is written then.
//
//  Defaults: --root ← the main checkout when the cwd is in a git work tree (as render-logs
//  does, so every linked worktree shares one ledger), else the cwd · --config ←
//  grimoire.config.json in the cwd (missing: default thresholds) · --ledger ←
//  <root>/.grimoire/manager/ledger.json · --now ← the clock.
//
//  Every rule is computed from the fields and one `now`, in the machine's time zone, so a
//  briefing is reproducible from its input (D3, D7 of the manager spec):
//    urgent      1 ≤ priority ≤ manager.urgent.priorityAtMost (2) · the SLA breaches within
//                24 h or has · due today, overdue, or due within manager.urgent.dueWithinDays (2)
//                calendar days. Each rule is a small named function in URGENCY_RULES; each
//                returns the human reason ("priority Urgent", "due in 1 day") or null.
//    groups      Decide: triage, or urgent with no assignee · Do: any other urgent item ·
//                Hand to AI: an issue with acceptance criteria, unassigned, nothing open
//                blocking it, no linked PR, no sub-issues (AI_CHECKS; the repo check is a seam,
//                repoCheck) · Waiting on others: the scout's reading (bucketHint "waiting") ·
//                Not now: the rest. completed and canceled items are counted, not listed.
//    bucketHint  the model's reading. It moves an item only between the non-urgent groups
//                (Hand to AI, Waiting on others, Not now): it never makes an item urgent, never
//                moves one out of Decide or Do, and never makes an issue ready for AI.
//    order       within a group: urgent, priority (no priority last), due date (none last),
//                oldest created (none last), id.
//  view() builds the one view model every rendering reads (Markdown here; the page and the
//  panel in later slices), so they never disagree.
//
//  The ledger (`schemaVersion` 1) keeps per source `lastRunAt`/`lastStatus` and per item
//  (`<sourceId>:<id>`) `firstSeenAt`, `lastHash` (state, priority, assignee, due date,
//  blockers, labels, PR) and `lastBucket`. A missing, corrupt or other-version ledger starts
//  over: only firstSeenAt is lost.
//
//  .grimoire/manager/.lock (pid and time) keeps two briefings apart: a held lock exits 3 with
//  "a briefing is in progress"; one older than 30 min (by mtime) is broken.
//
//  Ticket text is untrusted: titles, next steps, names and states are escaped for Markdown
//  and HTML in the briefing, and only an http(s) url becomes a link.
//
//  Exit: 0 written · 1 invalid items or config · 2 usage · 3 a briefing is in progress.
//  Plain Node ≥ 20, no dependencies.
import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, writeSync, closeSync, statSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { resolve, join, dirname, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HOUR = 3600000
const DAY = 86400000
export const SCHEMA_VERSION = 1
export const LOCK_STALE_MIN = 30
export const DEFAULT_URGENT = { priorityAtMost: 2, dueWithinDays: 2 }
const SLA_WINDOW = 24 * HOUR

export const GROUPS = [
  { id: 'decide', title: 'Decide' },
  { id: 'do', title: 'Do' },
  { id: 'ai', title: 'Hand to AI' },
  { id: 'waiting', title: 'Waiting on others' },
  { id: 'notnow', title: 'Not now' },
]
// The groups a bucketHint may move an item into, and only out of the non-urgent ones. "ai" is
// left out: an issue is ready for AI by AI_CHECKS alone, and a ready issue is there already.
const HINT_FROM = new Set(['ai', 'waiting', 'notnow'])
const HINT_TO = new Set(['waiting', 'notnow'])
const OPEN = new Set(['triage', 'backlog', 'unstarted', 'started'])
const STATE_TYPES = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']
const KINDS = ['issue', 'pr', 'run']
const HINTS = GROUPS.map((g) => g.id)
export const PRIORITY_NAMES = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── time ──
// A date-only value is a calendar day in the machine's time zone (Date.parse would read it as
// UTC midnight, the day before west of Greenwich); a date-time is an instant.
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
export function parseTime(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return NaN
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!d) return Date.parse(s.replace(' ', 'T'))
  const t = new Date(+d[1], +d[2] - 1, +d[3])
  return t.getFullYear() === +d[1] && t.getMonth() === +d[2] - 1 && t.getDate() === +d[3] ? t.getTime() : NaN
}
const dayStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
// Whole calendar days from now's day to ms's day (Math.round absorbs a DST day of 23 or 25 h).
const daysFrom = (now, ms) => Math.round((dayStart(ms) - dayStart(now)) / DAY)
const pad = (n, w = 2) => String(n).padStart(w, '0')
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function localIso(ms) {
  const d = new Date(ms), off = -d.getTimezoneOffset()
  return `${localDate(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}${off === 0 ? 'Z' : `${off > 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`}`
}
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) // YYYYMMDD-HHMMSS, UTC
function toMs(now) {
  const t = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN
  if (!Number.isFinite(t)) throw new Error('now: expected a Date, a time in ms or an ISO date-time')
  return t
}

// ── validation (skills/manager/workitem.schema.json, by hand: no dependency) ──
// Each check returns null, or [subpath, message]. Messages never carry the value.
const fail = (msg, at = '') => [at, msg]
const nullable = (check) => (v) => { if (v === null) return null; const r = check(v); return r && [r[0], `${r[1]} or null`] }
const C = {
  string: (v) => (typeof v === 'string' ? null : fail('expected a string')),
  nonEmpty: (v) => (typeof v === 'string' && v.length > 0 ? null : fail('expected a non-empty string')),
  oneOf: (list) => (v) => (list.includes(v) ? null : fail(`expected one of ${list.join(', ')}`)),
  bool: (v) => (typeof v === 'boolean' ? null : fail('expected true or false')),
  date: (v) => (Number.isFinite(parseTime(v)) ? null : fail('expected an ISO date (YYYY-MM-DD) or date-time')),
  refs: (v) => {
    if (!Array.isArray(v)) return fail('expected an array of ids')
    for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string' || !v[i]) return fail('expected a non-empty string', `[${i}]`)
    return null
  },
  strings: (v) => {
    if (!Array.isArray(v)) return fail('expected an array of strings')
    for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return fail('expected a string', `[${i}]`)
    return null
  },
}
const PROJECT = { id: C.string, name: C.string, sliced: C.bool }
const FIELDS = {
  sourceId: (v) => (typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? null : fail('expected 1 to 64 letters, digits, ".", "_" or "-"')),
  id: C.nonEmpty,
  key: C.nonEmpty,
  title: C.nonEmpty,
  url: nullable(C.string),
  kind: C.oneOf(KINDS),
  stateType: C.oneOf(STATE_TYPES),
  nativeState: nullable(C.string),
  priority: (v) => (Number.isInteger(v) && v >= 0 && v <= 4 ? null : fail('expected an integer from 0 to 4')),
  nativePriority: nullable((v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? null : fail('expected a string or a number'))),
  assignee: nullable(C.string),
  dueAt: nullable(C.date),
  createdAt: nullable(C.date),
  updatedAt: nullable(C.date),
  lastActivityAt: nullable(C.date),
  blockedBy: C.refs,
  blocks: C.refs,
  parentOf: C.refs,
  project: nullable((v) => {
    if (!isObj(v)) return fail('expected an object')
    for (const k of Object.keys(v)) {
      if (!Object.hasOwn(PROJECT, k)) return fail('unknown field', `.${printable(k)}`)
      const r = PROJECT[k](v[k])
      if (r) return [`.${k}${r[0]}`, r[1]]
    }
    return null
  }),
  repo: nullable(C.string),
  slaAt: nullable(C.date),
  hasAcceptanceCriteria: C.bool,
  linkedPr: nullable(C.string),
  labels: C.strings,
  bucketHint: nullable(C.oneOf(HINTS)),
  nextStep: nullable(C.string),
}
const REQUIRED = ['sourceId', 'id', 'title', 'kind', 'stateType']
// A field name is the scout's, not the ticket's, but it is still printed only when it looks like one.
const printable = (k) => (/^[A-Za-z0-9_$-]{1,40}$/.test(k) ? k : '<a field with an unprintable name>')
const MAX_ERRORS = 20

// The WorkItems' problems, one line each ([] when valid).
export function validate(items) {
  if (!Array.isArray(items)) return ['items: expected a JSON array of WorkItems (skills/manager/workitem.schema.json)']
  const errors = []
  const seen = new Map()
  items.forEach((it, i) => {
    const at = `items[${i}]`
    if (!isObj(it)) { errors.push(`${at}: expected an object`); return }
    for (const k of REQUIRED) if (it[k] === undefined) errors.push(`${at}.${k}: required`)
    for (const k of Object.keys(it)) {
      if (!Object.hasOwn(FIELDS, k)) { errors.push(`${at}.${printable(k)}: unknown field (see skills/manager/workitem.schema.json)`); continue }
      if (it[k] === undefined) continue
      const r = FIELDS[k](it[k])
      if (r) errors.push(`${at}.${k}${r[0]}: ${r[1]}`)
    }
    if (typeof it.sourceId === 'string' && typeof it.id === 'string') {
      const key = `${it.sourceId}\u0000${it.id}`
      if (seen.has(key)) errors.push(`${at}: duplicate of items[${seen.get(key)}] (the same sourceId and id)`)
      else seen.set(key, i)
    }
  })
  return errors
}

// A validated WorkItem with its defaults filled in; the input is never mutated.
function normalize(it) {
  return {
    sourceId: it.sourceId, id: it.id, key: it.key ?? it.id, title: it.title, url: it.url ?? null,
    kind: it.kind, stateType: it.stateType, nativeState: it.nativeState ?? null,
    priority: it.priority ?? 0, nativePriority: it.nativePriority ?? null, assignee: it.assignee || null,
    dueAt: it.dueAt ?? null, createdAt: it.createdAt ?? null, updatedAt: it.updatedAt ?? null, lastActivityAt: it.lastActivityAt ?? null,
    blockedBy: [...(it.blockedBy ?? [])], blocks: [...(it.blocks ?? [])], parentOf: [...(it.parentOf ?? [])],
    project: it.project ? { ...it.project } : null, repo: it.repo ?? null, slaAt: it.slaAt ?? null,
    hasAcceptanceCriteria: it.hasAcceptanceCriteria ?? null, linkedPr: it.linkedPr || null, labels: [...(it.labels ?? [])],
    bucketHint: it.bucketHint ?? null, nextStep: it.nextStep ?? null,
  }
}

// ── config ──
export function managerConfig(config) {
  const m = isObj(config) && isObj(config.manager) ? config.manager : {}
  const u = isObj(m.urgent) ? m.urgent : {}
  const warnings = []
  const pick = (k, good, what) => {
    if (u[k] === undefined) return DEFAULT_URGENT[k]
    if (good(u[k])) return u[k]
    warnings.push(`manager.urgent.${k}: expected ${what}; using ${DEFAULT_URGENT[k]}`)
    return DEFAULT_URGENT[k]
  }
  return {
    urgent: {
      priorityAtMost: pick('priorityAtMost', (v) => Number.isInteger(v) && v >= 0 && v <= 4, 'an integer from 0 to 4'),
      dueWithinDays: pick('dueWithinDays', (v) => Number.isInteger(v) && v >= 0, 'a whole number of days, 0 or more'),
    },
    warnings,
  }
}

// ── rules ──
// Urgency, from the fields only. Each rule: (item, ctx) → its reason, or null. ctx is
// { now, urgent: the thresholds, states: id/key → stateType of every item read }.
export const URGENCY_RULES = [
  function priority(it, ctx) {
    return it.priority >= 1 && it.priority <= ctx.urgent.priorityAtMost ? `priority ${PRIORITY_NAMES[it.priority]}` : null
  },
  function sla(it, ctx) {
    if (it.slaAt === null) return null
    const left = parseTime(it.slaAt) - ctx.now
    if (left <= 0) return 'SLA breached'
    return left <= SLA_WINDOW ? `SLA breaches in ${Math.ceil(left / HOUR)} h` : null
  },
  function due(it, ctx) {
    if (it.dueAt === null) return null
    const d = daysFrom(ctx.now, parseTime(it.dueAt))
    if (d < 0) return `overdue by ${plural(-d, 'day')}`
    if (d === 0) return 'due today'
    return d <= ctx.urgent.dueWithinDays ? `due in ${plural(d, 'day')}` : null
  },
]

// A reference is open unless it names an item read in this briefing whose state is closed.
const openRefs = (refs, ctx) => refs.filter((r) => !['completed', 'canceled'].includes(ctx.states.get(r)))

// Ready for AI (spec D8, v0): each check returns why the issue is not ready, or null.
export const AI_CHECKS = [
  function anIssue(it) { return it.kind === 'issue' ? null : `a ${it.kind}, not an issue` },
  // absent: the scout did not read the description, which is not the same as none
  function criteria(it) { return it.hasAcceptanceCriteria === true ? null : it.hasAcceptanceCriteria === false ? 'no acceptance criteria' : 'acceptance criteria not checked' },
  function unblocked(it, ctx) { const open = openRefs(it.blockedBy, ctx); return open.length ? `blocked by ${open.join(', ')}` : null },
  function unassigned(it) { return it.assignee ? `assigned to ${it.assignee}` : null },
  function noPr(it) { return it.linkedPr ? 'has a linked PR' : null },
  function notParent(it) { return it.parentOf.length ? `parent of ${plural(it.parentOf.length, 'issue')}` : null },
]
const READY = 'ready for AI: acceptance criteria, unassigned, not blocked, no linked PR, no sub-issues'

// The repo-availability check (spec D8: the path exists, is a git work tree, a submodule is
// initialised) comes with the launch step. Until then a repo reads as not checked, and nothing
// is held back on it.
export function repoCheck(it, config) { // eslint-disable-line no-unused-vars
  return it.repo ? { name: it.repo, available: null, note: 'availability not checked yet' } : null
}

function place(it, ctx) {
  const urgency = URGENCY_RULES.map((rule) => rule(it, ctx)).filter(Boolean)
  const urgent = urgency.length > 0
  const notReady = AI_CHECKS.map((check) => check(it, ctx)).filter(Boolean)
  let group, reasons
  if (it.stateType === 'triage') [group, reasons] = ['decide', ['in triage', ...urgency]]
  else if (urgent && !it.assignee) [group, reasons] = ['decide', [...urgency, 'unassigned']]
  else if (urgent) [group, reasons] = ['do', urgency]
  else if (!notReady.length) [group, reasons] = ['ai', [READY]]
  else [group, reasons] = ['notnow', ['not urgent', `not ready for AI: ${notReady.join(', ')}`]]
  const hint = it.bucketHint
  if (!urgent && HINT_FROM.has(group) && HINT_TO.has(hint) && hint !== group) {
    group = hint
    reasons = ['not urgent', hint === 'waiting' ? 'waiting on others, as the scout reads it' : 'parked, as the scout reads it']
  }
  return { urgent, group, reasons }
}

// ── order ──
const ID = new Intl.Collator('en', { numeric: true })
const rankPriority = (p) => (p >= 1 && p <= 4 ? p : 5) // no priority ranks last
const timeOr = (s) => { const t = s === null ? NaN : parseTime(s); return Number.isFinite(t) ? t : Infinity }
const num = (a, b) => (a === b ? 0 : a < b ? -1 : 1)
export function compareItems(a, b) {
  return num(b.urgent ? 1 : 0, a.urgent ? 1 : 0)
    || num(rankPriority(a.priority), rankPriority(b.priority))
    || num(timeOr(a.dueAt), timeOr(b.dueAt))
    || num(timeOr(a.createdAt), timeOr(b.createdAt))
    || ID.compare(a.id, b.id)
    || ID.compare(a.sourceId, b.sourceId)
}

// What the ledger compares between runs (spec D10): a change here is a "changed" badge later.
export function itemHash(it) {
  const facts = [it.stateType, it.nativeState, it.priority, it.assignee, it.dueAt, [...it.blockedBy].sort(), [...it.labels].sort(), it.linkedPr]
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16)
}
const ledgerKey = (it) => `${it.sourceId}:${it.id}`
const usableLedger = (l) => isObj(l) && l.schemaVersion === SCHEMA_VERSION && isObj(l.items) && isObj(l.sources)

function overallNext(c) {
  const parts = []
  if (c.decide) parts.push(`Decide ${plural(c.decide, 'item')} first: triage, or urgent with no owner.`)
  if (c.do) parts.push(`Do ${plural(c.do, 'urgent item')}.`)
  if (c.ai) parts.push(`${plural(c.ai, 'issue')} ready to hand to AI.`)
  if (!parts.length) parts.push(`Nothing needs you right now${c.waiting ? `; ${c.waiting} waiting on others` : ''}.`)
  return parts.join(' ')
}

// ── the view model ──
// The one function every rendering reads. Pure: same items, config, ledger and now, same view.
export function view(items, config, ledger, now) {
  const errors = validate(items)
  if (errors.length) throw new Error(`invalid WorkItems:\n${errors.slice(0, MAX_ERRORS).join('\n')}`)
  const t = toMs(now)
  const { urgent } = managerConfig(config)
  const all = items.map(normalize)
  const states = new Map()
  for (const it of all) for (const ref of new Set([it.id, it.key])) if (!states.has(ref)) states.set(ref, it.stateType)
  const ctx = { now: t, urgent, states }
  const seen = usableLedger(ledger) ? ledger.items : {}
  const generatedAt = new Date(t).toISOString()
  const listed = all.filter((it) => OPEN.has(it.stateType)).map((it) => {
    const p = place(it, ctx)
    const prev = isObj(seen[ledgerKey(it)]) ? seen[ledgerKey(it)] : null
    return {
      sourceId: it.sourceId, id: it.id, key: it.key, title: it.title, url: it.url, kind: it.kind,
      stateType: it.stateType, nativeState: it.nativeState, priority: it.priority, priorityName: PRIORITY_NAMES[it.priority],
      assignee: it.assignee, dueAt: it.dueAt, createdAt: it.createdAt, project: it.project, labels: it.labels, linkedPr: it.linkedPr,
      repo: repoCheck(it, config), urgent: p.urgent, group: p.group, reasons: p.reasons, nextStep: it.nextStep,
      firstSeenAt: prev && typeof prev.firstSeenAt === 'string' ? prev.firstSeenAt : generatedAt, hash: itemHash(it),
    }
  })
  const groups = GROUPS.map((g) => ({ ...g, items: listed.filter((it) => it.group === g.id).sort(compareItems) }))
  const size = (id) => groups.find((g) => g.id === id).items.length
  const counts = {
    total: listed.length, urgent: listed.filter((it) => it.urgent).length,
    decide: size('decide'), do: size('do'), ai: size('ai'), waiting: size('waiting'), notnow: size('notnow'),
    closed: all.length - listed.length,
  }
  const sources = [...new Set(all.map((it) => it.sourceId))].sort().map((id) => ({ id, items: all.filter((it) => it.sourceId === id).length, status: 'ok' }))
  return {
    schemaVersion: SCHEMA_VERSION, generatedAt,
    // A source the scouts could not read is reported in a later slice; v0 has every item it was given.
    partial: sources.some((s) => s.status !== 'ok'),
    sources, counts, groups, nextStep: overallNext(counts),
  }
}

// The ledger after this briefing: this run's sources and listed items, earlier sources kept.
export function nextLedger(v, ledger) {
  const sources = {}
  if (usableLedger(ledger)) for (const [id, s] of Object.entries(ledger.sources)) if (isObj(s)) sources[id] = s
  for (const s of v.sources) sources[s.id] = { lastRunAt: v.generatedAt, lastStatus: s.status }
  const items = {}
  for (const g of v.groups) for (const it of g.items) items[ledgerKey(it)] = { firstSeenAt: it.firstSeenAt, lastHash: it.hash, lastBucket: it.group }
  return { schemaVersion: SCHEMA_VERSION, sources, items }
}

// ── Markdown ──
// Ticket text on one line, Markdown and HTML inert: control characters and newlines become
// spaces (no text can start a heading or a list item), &, < and > become entities (no tag, no
// autolink), and the characters that make emphasis, code, links or tables are backslashed.
const MAX_TEXT = 200
export function md(s, max = MAX_TEXT) {
  let t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').trim()
  const chars = Array.from(t)
  if (chars.length > max) t = `${chars.slice(0, max - 1).join('')}…`
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]()|~]/g, '\\$&')
}
// Only an http(s) url is a link, with the characters that could end or break it percent-encoded.
export function safeUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\/\S+$/i.test(u) || /[\u0000-\u001f\u007f]/.test(u)) return null
  return u.replace(/[()<>"'`[\]\\|]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

function itemLines(it) {
  const url = safeUrl(it.url)
  const title = url ? `[${md(it.title)}](${url})` : md(it.title)
  const parts = [`**${md(it.key, 60)}**`, title]
  if (it.urgent) parts.push('**urgent**')
  parts.push(it.priorityName, md(it.nativeState ?? it.stateType, 60), it.assignee ? md(it.assignee, 60) : 'unassigned')
  if (it.dueAt !== null) parts.push(`due ${localDate(parseTime(it.dueAt))}`)
  if (it.repo) parts.push(`repo ${md(it.repo.name, 60)} (${it.repo.note})`)
  const lines = [`- ${parts.join(' · ')}`, `  - why: ${it.reasons.map((r) => md(r)).join('; ')}`]
  if (it.nextStep) lines.push(`  - next: ${md(it.nextStep)}`)
  return lines
}

export function renderMarkdown(v) {
  const c = v.counts
  const L = [
    '---',
    `generatedAt: ${JSON.stringify(v.generatedAt)}`,
    `partial: ${JSON.stringify(v.partial)}`,
    `sources: ${JSON.stringify(v.sources.map((s) => s.id))}`,
    `counts: ${JSON.stringify(c)}`,
    '---',
    '',
    `# Briefing · ${localIso(Date.parse(v.generatedAt))}`,
    '',
    `**Next step:** ${md(v.nextStep, 400)}`,
    '',
    [`${c.urgent} urgent`, `${c.decide} to decide`, `${c.do} to do`, `${c.ai} ready for AI`, `${c.waiting} waiting`, `${c.notnow} not now`,
      ...(c.closed ? [`${c.closed} closed, not listed`] : []),
      `sources: ${v.sources.length ? v.sources.map((s) => `${s.id} (${s.items})`).join(', ') : 'none'}`].join(' · '),
  ]
  for (const g of v.groups) {
    L.push('', `## ${g.title} (${g.items.length})`, '')
    if (!g.items.length) L.push('_Nothing here._')
    for (const it of g.items) L.push(...itemLines(it))
  }
  return `${L.join('\n')}\n`
}

// ── files, lock ──
function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

// true when this process now holds the lock; false when a fresh one is held by another run.
function acquire(lock) {
  mkdirSync(dirname(lock), { recursive: true })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(lock, 'wx')
      try { writeSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`) } finally { closeSync(fd) }
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      let age
      try { age = Date.now() - statSync(lock).mtimeMs } catch { continue } // released meanwhile: try again
      if (age <= LOCK_STALE_MIN * 60000) return false
      rmSync(lock, { force: true }) // stale: its run died
    }
  }
  return false
}
function release(lock) {
  const held = readJson(lock)
  if (isObj(held) && held.pid === process.pid) rmSync(lock, { force: true })
}

// The main checkout when the cwd is inside a git work tree (render-logs' stateRoot), else the cwd.
function stateRoot() {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })
  const common = r.status === 0 ? r.stdout.trim() : ''
  return common.endsWith(`${sep}.git`) ? dirname(common) : process.cwd()
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2)
      if (inline !== undefined) out[k] = inline
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

const USAGE = 'usage: node scripts/manager.mjs brief --items <file> [--config grimoire.config.json] [--ledger <path>] [--now <iso>] [--root <dir>]'

// Reads a JSON file the user or a scout wrote. Node's parse error can quote the source, so the
// message names the file only.
function readInput(file, what) {
  let raw
  try { raw = readFileSync(file, 'utf8') } catch (e) { return { error: `${what} ${file}: ${e.code === 'ENOENT' ? 'not found' : `cannot read (${e.code || 'error'})`}` } }
  try { return { value: JSON.parse(raw) } } catch { return { error: `${what} ${file}: invalid JSON` } }
}

function main(argv) {
  const args = parseArgs(argv)
  const cmd = args._[0]
  if (cmd !== 'brief') { console.error(cmd ? `unknown command: ${cmd} (expected brief)\n${USAGE}` : USAGE); return 2 }
  if (typeof args.items !== 'string') { console.error(`brief needs --items <file>\n${USAGE}`); return 2 }
  const now = args.now === undefined ? Date.now() : typeof args.now === 'string' ? Date.parse(args.now) : NaN
  if (!Number.isFinite(now)) { console.error(`--now: expected an ISO date-time\n${USAGE}`); return 2 }
  const root = resolve(typeof args.root === 'string' ? args.root : stateRoot())

  const configFile = resolve(typeof args.config === 'string' ? args.config : 'grimoire.config.json')
  let config = {}
  if (existsSync(configFile)) {
    const c = readInput(configFile, 'config')
    if (c.error) { console.error(c.error); return 1 }
    if (!isObj(c.value)) { console.error(`config ${configFile}: the top level must be a JSON object`); return 1 }
    config = c.value
  } else if (typeof args.config === 'string') console.error(`config ${configFile}: not found; using the default thresholds`)
  const mc = managerConfig(config)
  for (const w of mc.warnings) console.error(w)

  const input = readInput(resolve(args.items), 'items')
  if (input.error) { console.error(input.error); return 1 }
  const errors = validate(input.value)
  if (errors.length) {
    console.error(`refusing the WorkItems in ${resolve(args.items)}:`)
    for (const e of errors.slice(0, MAX_ERRORS)) console.error(`  ${e}`)
    if (errors.length > MAX_ERRORS) console.error(`  … and ${errors.length - MAX_ERRORS} more`)
    return 1
  }

  const dir = join(root, '.grimoire', 'manager')
  const ledgerFile = resolve(typeof args.ledger === 'string' ? args.ledger : join(dir, 'ledger.json'))
  const lock = join(dir, '.lock')
  if (!acquire(lock)) {
    const held = readJson(lock)
    const who = isObj(held) && Number.isInteger(held.pid) ? ` (pid ${held.pid})` : ''
    console.error(`a briefing is in progress${who}: ${lock} is held; it is broken once it is ${LOCK_STALE_MIN} min old`)
    return 3
  }
  try {
    const ledger = readJson(ledgerFile)
    const v = view(input.value, config, ledger, now)
    const text = renderMarkdown(v)
    const file = join(dir, 'briefings', `${stamp(now)}.md`)
    writeAtomic(file, text)
    writeAtomic(join(dir, 'latest.md'), text)
    writeAtomic(ledgerFile, `${JSON.stringify(nextLedger(v, ledger), null, 2)}\n`)
    console.log(file)
    return 0
  } finally {
    release(lock)
  }
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) process.exitCode = main(process.argv.slice(2))
