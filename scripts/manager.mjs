#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  manager — the briefing: what the team owes, ranked by rules anyone can read
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/manager.mjs brief --items <file> [--sources <file>] [--config grimoire.config.json]
//                                 [--ledger <path>] [--now <iso>] [--root <dir>]
//      → validates the WorkItems, ranks and groups them, writes
//        <root>/.grimoire/manager/briefings/<YYYYMMDD-HHMMSS>.md (UTC), the same text to
//        latest.md, and ledger.json, then prints the briefing's path.
//
//  Input: a JSON array of WorkItems (skills/manager/workitem.schema.json), the scouts'
//  output. The file is refused whole, exit 1, on any invalid item: one line per problem,
//  naming the item's index and field (`items[3].priority: …`), never its value, since ticket
//  text and whatever a scout copied are data that can hold anything. Nothing is written then.
//  null in an optional field reads as absent; a required field is never null. A date or
//  date-time must name a real calendar day and time (2026-02-30T10:00:00Z is refused).
//
//  --sources: what each source's scout reported, written by the skill: a JSON array of
//  {id, status: "ok" | "failed" | "capped", reason?, fix?, count?}. capped: the scout stopped at
//  maxItemsPerSource, so its count shows as "≥ N" · failed: it could not be read; it is listed
//  under "Not checked" with its reason and fix, has no items, and makes the briefing partial.
//  Every source with items needs an entry; the file is refused like the items, and one holding
//  null is refused too (not a list). Without the flag, the sources are the items' sourceIds, all
//  read in full. Either way, a manager.sources id the list does not name is "Not checked: <id>
//  (not reported by the skill)" and makes the briefing partial: a configured source is never
//  silently absent. An ok source whose count is not its number of items shows both, flagged
//  "count mismatch", and is not trusted as complete (what it did not show is not resolved).
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
//                calendar days · not started (backlog, unstarted) and blocking at least
//                manager.urgent.blocksAtLeast (2) open issues, an id the briefing did not read
//                counting as open · started with no activity (the later of lastActivityAt and
//                updatedAt) for at least manager.urgent.stalledDays (5) calendar days. Each rule is a small
//                named function in URGENCY_RULES; each returns the human reason
//                ("priority Urgent", "blocks 3 open issues", "no activity for 6 days") or null.
//    priority    with no priority, a nativePriority label is mapped by manager.priorityLabels
//                (case-insensitive; DEFAULT_PRIORITY_LABELS when the config has none), the same
//                mapping the scout applies; with neither priority nor nativePriority, the most
//                urgent of labels[] that maps. An unknown label is no priority, which ranks last.
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
//  blockers, labels, PR) and `lastBucket`. Against it each listed item is badged **new** (not
//  in it) or **changed** (another hash), and the items gone since, or now completed or
//  canceled, are counted as resolved, not listed. An item a source did not show this run
//  (failed, capped, not read) is neither resolved nor dropped from the ledger. No ledger is
//  the first briefing: nothing is badged. A corrupt or other-version ledger starts over the
//  same way, said once on stderr: only the badges and firstSeenAt are lost.
//
//  .grimoire/manager/.lock (pid, token and time) keeps two briefings apart: a held lock exits 3
//  with "a briefing is in progress"; one older than 30 min (by mtime) is broken, never two
//  runs at once (breakStale). A .lock that is not a file is an error, exit 1.
//
//  Ticket text is untrusted: titles, next steps, names and states are escaped for Markdown
//  and HTML in the briefing, and only an http(s) url becomes a link. So are a source's reason
//  and fix.
//
//  Exit: 0 written · 1 invalid items, sources or config, or a state file that can't be used
//  · 2 usage · 3 a briefing is in progress.
//
//  node scripts/manager.mjs headline [--root <dir>] [--now <iso>] [--config <file>]
//      → one line from <root>/.grimoire/manager/latest.md's front matter, for the SessionStart
//        hook (hooks/scripts/briefing.sh), which puts it in every session:
//        grimoire manager · 2 urgent, 3 ready for AI · 1 new · briefing 5 h old (/grimoire:manager)
//        "first briefing" in place of the new count on the first; the age in min under 1 h, h
//        under 48 h, days after; then "· page <path>" when briefing.html exists, "· partial: <ids>
//        not checked" (front matter notChecked; the first ten, then how many more), and last
//        "· stale, run /grimoire:manager" past manager.schedule's interval (scheduleInterval:
//        24 h with no schedule, or one it can't read). In a linked worktree the main checkout's
//        briefing is read too, where brief writes it, and the newer one wins.
//      It reads files and spawns nothing, and prints ids and counts only, never ticket text: one
//      line, under 10,000 characters, no control characters. No briefing, a corrupt front
//      matter, an unreadable root or any error prints nothing. Always exit 0.
//  Plain Node ≥ 20, no dependencies.
import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, readSync, writeSync, closeSync, lstatSync, statSync, linkSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { resolve, join, dirname, basename, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HOUR = 3600000
const DAY = 86400000
export const SCHEMA_VERSION = 1
export const LOCK_STALE_MIN = 30
export const DEFAULT_URGENT = { priorityAtMost: 2, dueWithinDays: 2, blocksAtLeast: 2, stalledDays: 5 }
// GitHub has no priority field (spec D13): the labels setup offers to create, plus P0–P3 and critical.
export const DEFAULT_PRIORITY_LABELS = { 'priority: urgent': 1, 'priority: high': 2, 'priority: medium': 3, 'priority: low': 4, P0: 1, P1: 2, P2: 3, P3: 4, critical: 1 }
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
// UTC midnight, the day before west of Greenwich); a date-time is an instant. Either must name a
// day that exists and a time on a clock: Date.parse rolls 2026-02-30T10:00:00Z over to March 2.
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/
const realDay = (y, m, d) => { const t = new Date(0); t.setUTCFullYear(y, m - 1, d); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d }
export function parseTime(s) {
  const m = typeof s === 'string' ? DATE.exec(s) : null
  if (!m || !realDay(+m[1], +m[2], +m[3])) return NaN
  if (m[4] === undefined) {
    const t = new Date(+m[1], +m[2] - 1, +m[3])
    return t.getFullYear() === +m[1] ? t.getTime() : NaN // a year before 100 would read as 19xx
  }
  if (+m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59) || (m[7] !== undefined && (+m[7] > 23 || +m[8] > 59))) return NaN
  return Date.parse(s.replace(' ', 'T'))
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
// Every optional field takes null, which reads as absent (the scout is told to leave out, or
// null, what it could not read); a required one never does. "or null" names the field's own type
// only, not an element's or a sub-field's.
const nullable = (check) => (v) => { if (v === null) return null; const r = check(v); return r && [r[0], r[0] ? r[1] : `${r[1]} or null`] }
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
const SOURCE_ID = /^[A-Za-z0-9._-]{1,64}$/
const FIELDS = {
  sourceId: (v) => (typeof v === 'string' && SOURCE_ID.test(v) ? null : fail('expected 1 to 64 letters, digits, ".", "_" or "-"')),
  id: C.nonEmpty,
  key: nullable(C.nonEmpty),
  title: C.nonEmpty,
  url: nullable(C.string),
  kind: C.oneOf(KINDS),
  stateType: C.oneOf(STATE_TYPES),
  nativeState: nullable(C.string),
  priority: nullable((v) => (Number.isInteger(v) && v >= 0 && v <= 4 ? null : fail('expected an integer from 0 to 4'))),
  nativePriority: nullable((v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? null : fail('expected a string or a number'))),
  assignee: nullable(C.string),
  dueAt: nullable(C.date),
  createdAt: nullable(C.date),
  updatedAt: nullable(C.date),
  lastActivityAt: nullable(C.date),
  blockedBy: nullable(C.refs),
  blocks: nullable(C.refs),
  parentOf: nullable(C.refs),
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
  hasAcceptanceCriteria: nullable(C.bool),
  linkedPr: nullable(C.string),
  labels: nullable(C.strings),
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

// ── sources (--sources, the skill's account of what each scout read) ──
const SOURCE_STATUS = ['ok', 'failed', 'capped']
const SOURCE_FIELDS = {
  id: FIELDS.sourceId,
  status: C.oneOf(SOURCE_STATUS),
  reason: nullable(C.string),
  fix: nullable(C.string),
  count: nullable((v) => (Number.isInteger(v) && v >= 0 ? null : fail('expected a whole number, 0 or more'))),
}
// The --sources list's problems, and where it disagrees with the items, one line each ([] when
// valid). Like validate(), each line names an index and a field, never a value.
export function validateSources(list, items) {
  if (!Array.isArray(list)) return ['sources: expected a JSON array of {id, status: "ok" | "failed" | "capped", reason?, fix?, count?}']
  const errors = []
  const index = new Map()
  list.forEach((s, i) => {
    const at = `sources[${i}]`
    if (!isObj(s)) { errors.push(`${at}: expected an object`); return }
    for (const k of ['id', 'status']) if (s[k] === undefined) errors.push(`${at}.${k}: required`)
    for (const k of Object.keys(s)) {
      if (!Object.hasOwn(SOURCE_FIELDS, k)) { errors.push(`${at}.${printable(k)}: unknown field (expected id, status, reason, fix, count)`); continue }
      if (s[k] === undefined) continue
      const r = SOURCE_FIELDS[k](s[k])
      if (r) errors.push(`${at}.${k}${r[0]}: ${r[1]}`)
    }
    if (typeof s.id === 'string') {
      if (index.has(s.id)) errors.push(`${at}: duplicate of sources[${index.get(s.id)}] (the same id)`)
      else index.set(s.id, i)
    }
  })
  if (!Array.isArray(items)) return errors
  const named = new Set()
  items.forEach((it, i) => {
    if (!isObj(it) || typeof it.sourceId !== 'string' || named.has(it.sourceId)) return
    named.add(it.sourceId)
    const j = index.get(it.sourceId)
    if (j === undefined) errors.push(`items[${i}].sourceId: not in --sources (every source with items needs an entry)`)
    else if (isObj(list[j]) && list[j].status === 'failed') errors.push(`sources[${j}]: status failed, but items[${i}] is from this source (a failed source has no items)`)
  })
  return errors
}

// The items' sourceIds as sources, each read in full: what the briefing assumes without --sources.
export const inferSources = (items) => [...new Set(items.filter(isObj).map((it) => it.sourceId))].map((id) => ({ id, status: 'ok' }))

// The briefing's sources, sorted by id: the --sources list (undefined: the items' sourceIds, all
// read), then every manager.sources id it does not name, not checked: a configured source is never
// silently absent. An ok source whose count is not its number of items is flagged mismatch.
// complete: read in full and trusted, so what it did not show is resolved (ok, no mismatch).
const NOT_REPORTED = 'not reported by the skill'
function sourcesOf(all, list, configured = []) {
  const given = list === undefined ? inferSources(all) : list
  const named = new Set(given.map((s) => s.id))
  const missing = configured.filter((id) => !named.has(id)).map((id) => ({ id, status: 'failed', reason: NOT_REPORTED }))
  return [...given, ...missing].map((s) => {
    const items = all.filter((it) => it.sourceId === s.id).length
    const count = s.count ?? items
    const mismatch = s.status === 'ok' && count !== items
    return { id: s.id, status: s.status, items, count, mismatch, complete: s.status === 'ok' && !mismatch, reason: s.reason ?? null, fix: s.fix ?? null }
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// A label in nativePriority, mapped (case-insensitive, trimmed), or null.
function labelPriority(native, labels) {
  if (typeof native !== 'string') return null
  const p = labels.get(native.trim().toLowerCase())
  return p === undefined ? null : p
}
// The most urgent of labels[] that map (1 before 4; 0, no priority, only when nothing else maps),
// or null when none does.
function labelsPriority(list, labels) {
  const mapped = list.map((l) => labelPriority(l, labels)).filter((p) => p !== null)
  if (!mapped.length) return null
  const ranked = mapped.filter((p) => p > 0)
  return ranked.length ? Math.min(...ranked) : 0
}

// A validated WorkItem with its defaults filled in; the input is never mutated. With no
// priority, a nativePriority label maps through manager.priorityLabels, as the scout's would;
// with neither, the most urgent of labels[] that maps.
function normalize(it, labels) {
  return {
    sourceId: it.sourceId, id: it.id, key: it.key ?? it.id, title: it.title, url: it.url ?? null,
    kind: it.kind, stateType: it.stateType, nativeState: it.nativeState ?? null,
    priority: it.priority ?? (it.nativePriority == null ? labelsPriority(it.labels ?? [], labels) : labelPriority(it.nativePriority, labels)) ?? 0,
    nativePriority: it.nativePriority ?? null, assignee: it.assignee || null,
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
      blocksAtLeast: pick('blocksAtLeast', (v) => Number.isInteger(v) && v >= 1, 'a whole number of open issues, 1 or more'),
      stalledDays: pick('stalledDays', (v) => Number.isInteger(v) && v >= 1, 'a whole number of days, 1 or more'),
    },
    priorityLabels: labelMap(m.priorityLabels, warnings),
    sources: configSources(m.sources, warnings),
    warnings,
  }
}

// manager.sources[] → [{ id, category }], read leniently (setup writes it): an entry with no usable
// id is named on stderr and skipped, a repeated id counted once.
function configSources(raw, warnings) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) { warnings.push('manager.sources: expected an array of sources; none is read from the config'); return [] }
  const out = [], seen = new Set()
  raw.forEach((s, i) => {
    if (!isObj(s) || typeof s.id !== 'string' || !SOURCE_ID.test(s.id)) { warnings.push(`manager.sources[${i}]: expected an object with an id of 1 to 64 letters, digits, ".", "_" or "-"; skipped`); return }
    if (seen.has(s.id)) return
    seen.add(s.id)
    out.push({ id: s.id, category: typeof s.category === 'string' ? s.category : null })
  })
  return out
}

// manager.priorityLabels → Map(lower-cased label → 0–4). The config's own map replaces the
// defaults; with none (absent or null), DEFAULT_PRIORITY_LABELS apply.
function labelMap(raw, warnings) {
  let entries = Object.entries(DEFAULT_PRIORITY_LABELS)
  if (raw !== undefined && raw !== null) {
    if (isObj(raw)) entries = Object.entries(raw)
    else warnings.push('manager.priorityLabels: expected an object of label → priority (an integer from 0 to 4); using the defaults')
  }
  const map = new Map()
  for (const [label, p] of entries) {
    if (Number.isInteger(p) && p >= 0 && p <= 4) map.set(label.trim().toLowerCase(), p)
    else warnings.push(`manager.priorityLabels[${JSON.stringify(label.slice(0, 60))}]: expected an integer from 0 to 4; this label is skipped`)
  }
  return map
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
  // Not started work that others wait on. A blocked id this briefing did not read counts as open.
  function blocking(it, ctx) {
    if (it.stateType !== 'backlog' && it.stateType !== 'unstarted') return null
    const open = openRefs([...new Set(it.blocks)], ctx).length
    return open >= ctx.urgent.blocksAtLeast ? `blocks ${plural(open, 'open issue')}` : null
  },
  // Started work gone quiet: calendar days since the later of lastActivityAt and updatedAt; neither,
  // no reading.
  function stalled(it, ctx) {
    const last = Math.max(...[it.lastActivityAt, it.updatedAt].filter((d) => d !== null).map(parseTime))
    if (it.stateType !== 'started' || !Number.isFinite(last)) return null
    const idle = daysFrom(last, ctx.now)
    return idle >= ctx.urgent.stalledDays ? `no activity for ${plural(idle, 'day')}` : null
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
const sourceOfKey = (key) => { const i = key.indexOf(':'); return i < 0 ? key : key.slice(0, i) } // a sourceId has no ":"
export const usableLedger = (l) => isObj(l) && l.schemaVersion === SCHEMA_VERSION && isObj(l.items) && isObj(l.sources)
const entryOf = (seen, key) => (seen && Object.hasOwn(seen, key) && isObj(seen[key]) ? seen[key] : null)
// new: not in the ledger · changed: in it with another hash · null: the same, or the first
// briefing (no ledger to compare with), or an entry with no hash to compare.
function badgeOf(seen, prev, hash) {
  if (!seen) return null
  if (!prev) return 'new'
  return typeof prev.lastHash === 'string' && prev.lastHash !== hash ? 'changed' : null
}

function overallNext(c) {
  const parts = []
  if (c.decide) parts.push(`Decide ${plural(c.decide, 'item')} first: triage, or urgent with no owner.`)
  if (c.do) parts.push(`Do ${plural(c.do, 'urgent item')}.`)
  if (c.ai) parts.push(`${plural(c.ai, 'issue')} ready to hand to AI.`)
  if (!parts.length) parts.push(`Nothing needs you right now${c.waiting ? `; ${c.waiting} waiting on others` : ''}.`)
  return parts.join(' ')
}

// ── the view model ──
// The one function every rendering reads. Pure: same items, config, ledger, now and sources,
// same view. sources is the --sources list, or undefined (left out) to infer it from the items;
// null is refused like anything else that is not a list.
export function view(items, config, ledger, now, sources) {
  const errors = [...validate(items), ...(sources === undefined ? [] : validateSources(sources, items))]
  if (errors.length) throw new Error(`invalid WorkItems or sources:\n${errors.slice(0, MAX_ERRORS).join('\n')}`)
  const t = toMs(now)
  const { urgent, priorityLabels, sources: configured } = managerConfig(config)
  const all = items.map((it) => normalize(it, priorityLabels))
  const states = new Map()
  for (const it of all) for (const ref of new Set([it.id, it.key])) if (!states.has(ref)) states.set(ref, it.stateType)
  const ctx = { now: t, urgent, states }
  // null: no ledger to compare with, the first briefing (or one that starts over)
  const seen = usableLedger(ledger) ? ledger.items : null
  const generatedAt = new Date(t).toISOString()
  const listed = all.filter((it) => OPEN.has(it.stateType)).map((it) => {
    const p = place(it, ctx)
    const prev = entryOf(seen, ledgerKey(it))
    const hash = itemHash(it)
    return {
      // only a safe http(s) url, or null: no rendering of the model can get a javascript: href
      sourceId: it.sourceId, id: it.id, key: it.key, title: it.title, url: safeUrl(it.url), kind: it.kind,
      stateType: it.stateType, nativeState: it.nativeState, priority: it.priority, priorityName: PRIORITY_NAMES[it.priority],
      assignee: it.assignee, dueAt: it.dueAt, createdAt: it.createdAt, project: it.project, labels: it.labels, linkedPr: it.linkedPr,
      repo: repoCheck(it, config), urgent: p.urgent, group: p.group, reasons: p.reasons, nextStep: it.nextStep,
      badge: badgeOf(seen, prev, hash),
      firstSeenAt: prev && Number.isFinite(parseTime(prev.firstSeenAt)) ? prev.firstSeenAt : generatedAt, hash,
    }
  })
  const srcs = sourcesOf(all, sources, configured.map((s) => s.id))
  // Resolved since the last briefing: a ledger item read now as completed or canceled, or missing
  // from a source read in full. Missing from a failed or capped source, or from one whose count
  // does not match its items, is unknown, not resolved.
  const complete = new Set(srcs.filter((s) => s.complete).map((s) => s.id))
  const read = new Map(all.map((it) => [ledgerKey(it), it]))
  let resolved = 0
  if (seen) for (const key of Object.keys(seen)) {
    const it = read.get(key)
    if (it ? !OPEN.has(it.stateType) : complete.has(sourceOfKey(key))) resolved++
  }
  const groups = GROUPS.map((g) => ({ ...g, items: listed.filter((it) => it.group === g.id).sort(compareItems) }))
  const size = (id) => groups.find((g) => g.id === id).items.length
  const counts = {
    total: listed.length, urgent: listed.filter((it) => it.urgent).length,
    decide: size('decide'), do: size('do'), ai: size('ai'), waiting: size('waiting'), notnow: size('notnow'),
    closed: all.length - listed.length,
    new: listed.filter((it) => it.badge === 'new').length, changed: listed.filter((it) => it.badge === 'changed').length, resolved,
  }
  return {
    schemaVersion: SCHEMA_VERSION, generatedAt,
    firstBriefing: seen === null,
    // A source that could not be read makes the briefing partial; a capped one was read, as "≥ N".
    partial: srcs.some((s) => s.status === 'failed'),
    sources: srcs, counts, groups, nextStep: overallNext(counts),
  }
}

// The ledger after this briefing: this run's sources and listed items, earlier sources kept.
// An earlier item this run did not see because its source failed, was capped, did not match its
// count or was not read keeps its entry, so it is neither resolved now nor new when it comes back. items: the
// WorkItems the view was built from (an earlier item read closed is dropped, not kept).
export function nextLedger(v, ledger, items = []) {
  const usable = usableLedger(ledger)
  const sources = Object.create(null) // a source id is the scout's text: "__proto__" stays a key
  if (usable) for (const [id, s] of Object.entries(ledger.sources)) if (isObj(s)) sources[id] = s
  for (const s of v.sources) sources[s.id] = { lastRunAt: v.generatedAt, lastStatus: s.status }
  const out = Object.create(null)
  if (usable) {
    const read = new Set((Array.isArray(items) ? items : []).filter(isObj).map((it) => `${it.sourceId}:${it.id}`))
    const complete = new Set(v.sources.filter((s) => s.complete).map((s) => s.id))
    for (const [key, e] of Object.entries(ledger.items)) if (isObj(e) && !read.has(key) && !complete.has(sourceOfKey(key))) out[key] = e
  }
  for (const g of v.groups) for (const it of g.items) out[ledgerKey(it)] = { firstSeenAt: it.firstSeenAt, lastHash: it.hash, lastBucket: it.group }
  return { schemaVersion: SCHEMA_VERSION, sources, items: out }
}

// ── Markdown ──
// Ticket text on one line, Markdown and HTML inert: bidi controls are dropped (they reorder what a
// reader sees), control characters and newlines become spaces (no text can start a heading or a
// list item), a `scheme://` or `www.` is broken into `scheme[:]//` and `www[.]` (GFM would make it
// a link on its own), &, < and > become entities (no tag, no <autolink>), and the characters that
// make emphasis, code, links or tables are backslashed.
const MAX_TEXT = 200
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g
export function md(s, max = MAX_TEXT) {
  let t = String(s ?? '').replace(BIDI, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').trim()
  const chars = Array.from(t)
  if (chars.length > max) t = `${chars.slice(0, max - 1).join('')}…`
  t = t.replace(/([A-Za-z][A-Za-z0-9+.-]*):\/\//g, '$1[:]//').replace(/\b(www)\./gi, '$1[.]')
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]()|~]/g, '\\$&')
}
// Only an http(s) url is a link, with the characters that could end or break it percent-encoded.
export function safeUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\/\S+$/i.test(u) || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(u)) return null
  return u.replace(/[()<>"'`[\]\\|]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

function itemLines(it) {
  const url = safeUrl(it.url)
  const title = url ? `[${md(it.title)}](${url})` : md(it.title)
  const parts = [`**${md(it.key, 60)}**`, title]
  if (it.urgent) parts.push('**urgent**')
  if (it.badge) parts.push(`**${it.badge}**`)
  parts.push(it.priorityName, md(it.nativeState ?? it.stateType, 60), it.assignee ? md(it.assignee, 60) : 'unassigned')
  if (it.dueAt !== null) parts.push(`due ${localDate(parseTime(it.dueAt))}`)
  if (it.repo) parts.push(`repo ${md(it.repo.name, 60)} (${it.repo.note})`)
  const lines = [`- ${parts.join(' · ')}`, `  - why: ${it.reasons.map((r) => md(r)).join('; ')}`]
  if (it.nextStep) lines.push(`  - next: ${md(it.nextStep)}`)
  return lines
}

// A source in the counts line: its items, "≥ N" when capped, the count it reported beside its items
// on a mismatch (neither presented as complete), or not checked.
function sourceText(s) {
  const what = s.status === 'failed' ? 'not checked' : s.status === 'capped' ? `≥ ${Math.max(s.count, s.items)}`
    : s.mismatch ? `${s.count} reported, ${plural(s.items, 'item')}: count mismatch` : s.items
  return `${md(s.id, 64)} (${what})`
}

export function renderMarkdown(v) {
  const c = v.counts
  const L = [
    '---',
    `generatedAt: ${JSON.stringify(v.generatedAt)}`,
    `firstBriefing: ${JSON.stringify(v.firstBriefing)}`,
    `partial: ${JSON.stringify(v.partial)}`,
    // the sources that could not be read: the headline names them
    `notChecked: ${JSON.stringify(v.sources.filter((s) => s.status === 'failed').map((s) => s.id))}`,
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
      `sources: ${v.sources.length ? v.sources.map(sourceText).join(', ') : 'none'}`].join(' · '),
    '',
    v.firstBriefing
      ? '_First briefing: nothing to compare with yet, so no item is marked new or changed._'
      : `Since the last briefing: ${c.new} new · ${c.changed} changed · ${c.resolved} resolved (closed or gone, not listed)`,
  ]
  const failed = v.sources.filter((s) => s.status === 'failed')
  if (failed.length) {
    L.push('', '## Not checked', '')
    for (const s of failed) L.push(`- Not checked: ${md(s.id, 64)} (${s.reason ? md(s.reason) : 'no reason given'})${s.fix ? `, fix: ${md(s.fix)}` : ''}`)
  }
  for (const g of v.groups) {
    L.push('', `## ${g.title} (${g.items.length})`, '')
    if (!g.items.length) L.push('_Nothing here._')
    for (const it of g.items) L.push(...itemLines(it))
  }
  return `${L.join('\n')}\n`
}

// ── the session headline (`headline`, hooks/scripts/briefing.sh) ──
// One line from latest.md's front matter, injected into every session at its start: so ids and
// counts only, never ticket text, and nothing printed that the front matter's own checks did not
// pass. It reads files and spawns nothing (a hook has 5 s).
const MINUTE = 60000
export const HEADLINE_MAX = 10000
const FRONT_MAX = 1 << 20 // the front matter is read from latest.md's first MiB
const IDS_SHOWN = 10
const PATH_MAX = 4096
// what never goes into the line: control characters, line and paragraph separators, bidi controls
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

// latest.md's front matter → { key: value }, each value the JSON renderMarkdown writes; null when
// the text has none, a line in it is not `key: <JSON>`, or it is never closed.
export function frontMatter(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  if (lines[0] !== '---') return null
  const out = Object.create(null) // a key is the file's text: "__proto__" stays a key
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return out
    const m = /^([A-Za-z][A-Za-z0-9_]*): (.*)$/.exec(lines[i])
    if (!m) return null
    try { out[m[1]] = JSON.parse(m[2]) } catch { return null }
  }
  return null
}

// How often a briefing is due, in ms, from manager.schedule (or its `when` given alone), read
// leniently: a cron line (`0 * * * *` and any fixed minute hourly, `*/15 * * * *` every 15 min,
// `0 */6 * * *` every 6 h, a fixed hour daily), "hourly", "every N minutes | hours | days",
// "weekly". Anything else is 24 h: "daily", "weekdays 08:30" (a weekend reads as stale), no
// schedule, and text it can't read.
export function scheduleInterval(schedule) {
  const when = typeof schedule === 'string' ? schedule : isObj(schedule) && typeof schedule.when === 'string' ? schedule.when : ''
  const s = when.trim().toLowerCase()
  const cron = s.split(/\s+/)
  if (cron.length === 5 && cron.every((f) => /^[\d*,/-]+$/.test(f))) {
    const step = (f) => { const m = /^\*\/(\d+)$/.exec(f); return m && +m[1] > 0 ? +m[1] : null }
    const [min, hour] = cron
    if (hour === '*') return min === '*' ? MINUTE : step(min) ? step(min) * MINUTE : HOUR
    return step(hour) ? step(hour) * HOUR : DAY
  }
  if (/\b(hourly|every hour)\b/.test(s)) return HOUR
  const every = /\bevery (\d+) ?(minutes?|mins?|hours?|hrs?|h|days?|d)\b/.exec(s)
  if (every && +every[1] > 0) return +every[1] * (every[2][0] === 'm' ? MINUTE : every[2][0] === 'd' ? DAY : HOUR)
  if (/\b(weekly|every week)\b/.test(s)) return 7 * DAY
  return DAY
}

// minutes under 1 h, hours under 48 h, days after
const ageText = (ms) => (ms < HOUR ? `${Math.floor(ms / MINUTE)} min` : ms < 48 * HOUR ? `${Math.floor(ms / HOUR)} h` : `${Math.floor(ms / DAY)} days`)
const isCount = (v) => Number.isSafeInteger(v) && v >= 0

// The headline from a parsed front matter, or null when it is not one brief writes (generatedAt
// a real time; counts.urgent, .ai and .new whole numbers; partial and firstBriefing booleans;
// notChecked source ids). Pure. interval: scheduleInterval's; page: briefing.html's path, or null.
export function headline(front, { now, interval = DAY, page = null } = {}) {
  if (!isObj(front) || !isObj(front.counts)) return null
  const c = front.counts
  const generated = parseTime(front.generatedAt)
  const ids = front.notChecked ?? []
  if (!Number.isFinite(generated) || !isCount(c.urgent) || !isCount(c.ai) || (c.new !== undefined && !isCount(c.new))) return null
  if ([front.partial, front.firstBriefing].some((b) => b !== undefined && typeof b !== 'boolean')) return null
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && SOURCE_ID.test(id))) return null
  const age = Math.max(0, toMs(now) - generated) // a briefing from the future (clock skew) is 0 min old
  const parts = ['grimoire manager', `${c.urgent} urgent, ${c.ai} ready for AI`]
  if (front.firstBriefing === true) parts.push('first briefing')
  else if (c.new > 0) parts.push(`${c.new} new`)
  parts.push(`briefing ${ageText(age)} old (/grimoire:manager)`)
  if (typeof page === 'string' && page.length <= PATH_MAX && !UNSAFE.test(page)) parts.push(`page ${page}`)
  if (front.partial === true || ids.length) {
    const more = ids.length > IDS_SHOWN ? ` and ${ids.length - IDS_SHOWN} more` : ''
    parts.push(`partial: ${ids.length ? `${ids.slice(0, IDS_SHOWN).join(', ')}${more}` : 'some sources'} not checked`)
  }
  if (age > interval) parts.push('stale, run /grimoire:manager')
  const line = parts.join(' · ')
  return line.length < HEADLINE_MAX && !UNSAFE.test(line) ? line : null
}

// The main checkout of the linked worktree at dir, from files only: its .git is a file naming the
// worktree's git dir, whose commondir names the shared .git. null for a plain checkout, a
// submodule (no commondir) or no git: the same answer stateRoot gets from git.
export function mainCheckout(dir) {
  try {
    const dotgit = join(dir, '.git')
    if (!statSync(dotgit).isFile()) return null
    const m = /^gitdir: *(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'))
    if (!m) return null
    const gitdir = resolve(dir, m[1])
    const common = resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim())
    return basename(common) === '.git' ? dirname(common) : null
  } catch { return null }
}

const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }
// A regular file's first max bytes, or null. Checked before it is opened: a FIFO would block.
function readHead(file, max) {
  try {
    const st = statSync(file)
    if (!st.isFile()) return null
    const fd = openSync(file, 'r')
    try {
      const buf = Buffer.alloc(Math.min(st.size, max))
      return buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8')
    } finally { closeSync(fd) }
  } catch { return null }
}

// `headline`: prints the line, or nothing. Never an error and never stderr, so the hook only ever
// adds the line: a bad --now, no briefing, a corrupt one, an unreadable root, anything thrown.
function headlineMain(args) {
  try {
    const now = args.now === undefined ? Date.now() : typeof args.now === 'string' ? Date.parse(args.now) : NaN
    if (!Number.isFinite(now)) return 0
    const root = resolve(typeof args.root === 'string' ? args.root : process.cwd())
    // brief writes to the main checkout; a session in a linked worktree reads it, and its own too
    // (a brief run with --root there): the newer briefing wins.
    const roots = [...new Set([root, mainCheckout(root)].filter(Boolean))]
    // The schedule: --config, else the project's grimoire.config.json, else the main checkout's.
    // A config that is missing, unreadable or not JSON is no schedule: 24 h.
    const configFile = typeof args.config === 'string' ? resolve(args.config) : roots.map((r) => join(r, 'grimoire.config.json')).find(isFile)
    const config = configFile && isFile(configFile) ? readJson(configFile) : null
    const interval = scheduleInterval(isObj(config) && isObj(config.manager) ? config.manager.schedule : null)
    let best = null
    for (const r of roots) {
      const dir = join(r, '.grimoire', 'manager')
      const front = frontMatter(readHead(join(dir, 'latest.md'), FRONT_MAX))
      const page = join(dir, 'briefing.html')
      const line = front && headline(front, { now, interval, page: isFile(page) ? page : null })
      if (line && (!best || parseTime(front.generatedAt) > best.at)) best = { line, at: parseTime(front.generatedAt) }
    }
    if (best) process.stdout.write(`${best.line}\n`)
  } catch { /* silent: the session starts without a headline */ }
  return 0
}

// ── files, lock ──
function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  try { renameSync(tmp, file) } catch (e) { rmSync(tmp, { force: true }); throw e }
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

// A .lock that is not a regular file (a directory, a symlink): nothing a briefing wrote, so it is
// never broken, and main reports it on one line.
export class LockError extends Error {}

// This run's token when it now holds the lock; null when a fresh one is held by another run. The
// token, not the pid, says whose a lock is: a pid is reused, and two callers in one process share
// it. beforeBreak is a test seam: it runs once a stale lock is judged, before it is broken.
export function acquireLock(lock, { staleMs = LOCK_STALE_MIN * 60000, beforeBreak = null } = {}) {
  mkdirSync(dirname(lock), { recursive: true })
  const token = `${process.pid}-${randomBytes(8).toString('hex')}`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(lock, 'wx')
      try { writeSync(fd, `${JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() })}\n`) } finally { closeSync(fd) }
      return token
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    let st
    try { st = lstatSync(lock) } catch { continue } // released meanwhile: try again
    if (!st.isFile()) throw new LockError(`${lock} is ${st.isDirectory() ? 'a directory' : 'not a regular file'}, not a briefing's lock: remove it by hand, then run again`)
    if (Date.now() - st.mtimeMs <= staleMs) return null
    if (beforeBreak) beforeBreak()
    if (!breakStale(lock, st, staleMs)) return null // stale: its run died
  }
  return null
}

// Breaks a stale lock without ever taking a live one. Two runs can judge one lock stale; had the
// slower simply unlinked it, it would delete the lock the faster had just taken. So the lock is
// moved to a name only this attempt uses, and unlinked only when what was moved is the file judged
// stale (the same inode, still old). Anything else is a live lock: it goes back where it was
// (link, so a lock a third run took meanwhile stands). true: the path is free to try again;
// false: a live lock holds it.
function breakStale(lock, judged, staleMs) {
  const aside = `${lock}.stale-${process.pid}-${randomBytes(4).toString('hex')}`
  try { renameSync(lock, aside) } catch (e) { if (e.code === 'ENOENT') return true; throw e } // already broken
  let st = null
  try { st = lstatSync(aside) } catch { /* gone: nothing to put back */ }
  if (!st || (st.ino === judged.ino && Date.now() - st.mtimeMs > staleMs)) { rmSync(aside, { force: true }); return true }
  try { linkSync(aside, lock) } catch { /* a third run holds the path: its lock stands */ }
  rmSync(aside, { force: true })
  return false
}

export function releaseLock(lock, token) {
  const held = readJson(lock)
  if (token && isObj(held) && held.token === token) rmSync(lock, { force: true })
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
      // split at the first "=" only: --items=/dir/a=b.json is the file /dir/a=b.json
      const eq = a.indexOf('=')
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq)
      const inline = eq < 0 ? undefined : a.slice(eq + 1)
      if (inline !== undefined) out[k] = inline
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

const USAGE = [
  'usage: node scripts/manager.mjs brief --items <file> [--sources <file>] [--config grimoire.config.json] [--ledger <path>] [--now <iso>] [--root <dir>]',
  '       node scripts/manager.mjs headline [--root <dir>] [--now <iso>] [--config <file>]',
].join('\n')

// Reads a JSON file the user or a scout wrote. Node's parse error can quote the source, so the
// message names the file only.
function readInput(file, what) {
  let raw
  try { raw = readFileSync(file, 'utf8') } catch (e) { return { error: `${what} ${file}: ${e.code === 'ENOENT' ? 'not found' : `cannot read (${e.code || 'error'})`}` } }
  try { return { value: JSON.parse(raw) } } catch { return { error: `${what} ${file}: invalid JSON` } }
}

// The previous ledger, or null to start over. A missing one is the first briefing, silently; one
// that can't be used (unreadable, invalid JSON, another schemaVersion, another shape) is said once
// on stderr. Starting over loses only the badges and firstSeenAt, never the briefing.
const RESET = 'starting over, so no item is marked new or changed and none counted resolved this run'
function readLedger(file) {
  let raw
  try { raw = readFileSync(file, 'utf8') } catch (e) {
    if (e.code !== 'ENOENT') console.error(`ledger ${file}: cannot be read (${e.code || 'error'}); ${RESET}`)
    return null
  }
  let value
  try { value = JSON.parse(raw) } catch { console.error(`ledger ${file}: not valid JSON; ${RESET}`); return null }
  if (usableLedger(value)) return value
  const why = isObj(value) && value.schemaVersion !== SCHEMA_VERSION
    ? `schemaVersion ${Number.isInteger(value.schemaVersion) ? value.schemaVersion : '(missing)'}, this script reads ${SCHEMA_VERSION}`
    : 'not a ledger this script writes'
  console.error(`ledger ${file}: ${why}; ${RESET}`)
  return null
}

function main(argv) {
  const args = parseArgs(argv)
  const cmd = args._[0]
  if (cmd === 'headline') return headlineMain(args)
  if (cmd !== 'brief') { console.error(cmd ? `unknown command: ${cmd} (expected brief or headline)\n${USAGE}` : USAGE); return 2 }
  if (typeof args.items !== 'string') { console.error(`brief needs --items <file>\n${USAGE}`); return 2 }
  if (args.sources !== undefined && typeof args.sources !== 'string') { console.error(`--sources needs a file\n${USAGE}`); return 2 }
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
  let sources // undefined: no --sources; a file holding null is refused below, like any non-array
  if (typeof args.sources === 'string') {
    const s = readInput(resolve(args.sources), 'sources')
    if (s.error) { console.error(s.error); return 1 }
    sources = s.value
  }
  const errors = [...validate(input.value), ...(sources === undefined ? [] : validateSources(sources, input.value))]
  if (errors.length) {
    console.error(`refusing the WorkItems in ${resolve(args.items)}${sources === undefined ? '' : ` with the sources in ${resolve(args.sources)}`}:`)
    for (const e of errors.slice(0, MAX_ERRORS)) console.error(`  ${e}`)
    if (errors.length > MAX_ERRORS) console.error(`  … and ${errors.length - MAX_ERRORS} more`)
    return 1
  }

  const dir = join(root, '.grimoire', 'manager')
  const ledgerFile = resolve(typeof args.ledger === 'string' ? args.ledger : join(dir, 'ledger.json'))
  const lock = join(dir, '.lock')
  let token
  try { token = acquireLock(lock) } catch (e) {
    if (e instanceof LockError) { console.error(e.message); return 1 }
    throw e
  }
  if (!token) {
    const held = readJson(lock)
    const who = isObj(held) && Number.isInteger(held.pid) ? ` (pid ${held.pid})` : ''
    console.error(`a briefing is in progress${who}: ${lock} is held; it is broken once it is ${LOCK_STALE_MIN} min old`)
    return 3
  }
  try {
    const ledger = readLedger(ledgerFile)
    const v = view(input.value, config, ledger, now, sources)
    const text = renderMarkdown(v)
    const file = join(dir, 'briefings', `${stamp(now)}.md`)
    writeAtomic(file, text)
    writeAtomic(join(dir, 'latest.md'), text)
    writeAtomic(ledgerFile, `${JSON.stringify(nextLedger(v, ledger, input.value), null, 2)}\n`)
    console.log(file)
    return 0
  } finally {
    releaseLock(lock, token)
  }
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (isMain()) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (e) {
    // a state file the script can't read or write (a directory where a file goes, a read-only
    // disk): one line, not a stack trace
    console.error(`manager: ${String(e && e.message ? e.message : e).split('\n')[0]}`)
    process.exitCode = 1
  }
}
