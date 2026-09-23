#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  render-logs — read the build loop's decision log, locally, no dependencies
// ════════════════════════════════════════════════════════════════════════════
//
//  node scripts/render-logs.mjs [--dir .grimoire/runs] [--ledgers runs] [--out .grimoire/logs.html]
//                               [--run <runId>] [--version <v>]
//      → one self-contained HTML file (inline CSS + JS, no network), prints its path
//  node scripts/render-logs.mjs prune [--dir .grimoire/runs] [--days 183] [--dry-run]
//      → deletes run dirs older than N days (default: telemetry.retentionDays in
//        grimoire.config.json, else 183 ≈ 6 months). Never touches anything outside --dir.
//
//  Defaults come from grimoire.config.json at the cwd when a flag is absent:
//  --dir ← telemetry.dir (.grimoire/runs) · --days ← telemetry.retentionDays (183) ·
//  --ledgers ← runsDir (runs).
//  node scripts/render-logs.mjs summary [--dir .grimoire/runs] [--version <v>] [--json]
//      → cross-run aggregate per grimoire version / briefsHash, for crystallize
//
//  Input contract: <dir>/<runId>/run.json + events/<8-digit firstSeq>.jsonl chunks (and/or a
//  legacy single events.jsonl), one JSON object per line; merged, deduped by seq (first seen
//  wins), sorted by seq.
//  Unknown event types and fields are tolerated and shown raw; lines that fail to
//  parse are counted and skipped, never fatal.
import { readFileSync, writeFileSync, readdirSync, lstatSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DAY = 86400000

// ── args ──
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

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function config() {
  const c = readJson(resolve('grimoire.config.json'))
  return isObj(c) ? c : {}
}

// ── load ──
function subdirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => {
    try { return lstatSync(join(dir, n)).isDirectory() } catch { return false }
  })
}

// A run dir holds run.json, an events/ chunk dir, or a legacy events.jsonl.
function isRunDir(p) {
  return existsSync(join(p, 'run.json')) || existsSync(join(p, 'events.jsonl'))
    || (() => { try { return lstatSync(join(p, 'events')).isDirectory() } catch { return false } })()
}

// Chunks sorted by name (zero-padded firstSeq), then the legacy single file.
function eventFiles(p) {
  const files = []
  const cd = join(p, 'events')
  try {
    if (lstatSync(cd).isDirectory()) {
      for (const n of readdirSync(cd).filter((n) => n.endsWith('.jsonl')).sort()) {
        try { if (lstatSync(join(cd, n)).isFile()) files.push(join(cd, n)) } catch {}
      }
    }
  } catch {}
  if (existsSync(join(p, 'events.jsonl'))) files.push(join(p, 'events.jsonl'))
  return files
}

export function loadRuns(dir) {
  const runs = []
  for (const name of subdirs(dir)) {
    const p = join(dir, name)
    if (!isRunDir(p)) continue
    const hasRun = existsSync(join(p, 'run.json'))
    const rj = hasRun ? readJson(join(p, 'run.json')) : null
    const run = isObj(rj) ? rj : {}
    const events = []
    const seen = new Set()
    let badLines = 0, duplicates = 0
    for (const file of eventFiles(p)) {
      let text = ''
      try { text = readFileSync(file, 'utf8') } catch { text = '' }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        let ev
        try { ev = JSON.parse(line) } catch { badLines++; continue }
        if (!isObj(ev)) { badLines++; continue }
        const seq = num(ev.seq)
        if (seq !== null) {
          if (seen.has(seq)) { duplicates++; continue } // a retried flush: first seen wins
          seen.add(seq)
        }
        events.push(ev)
      }
    }
    events.sort((a, b) => (num(a.seq) ?? Infinity) - (num(b.seq) ?? Infinity))
    const start = events.find((e) => e.type === 'run.start') || {}
    const meta = { ...(isObj(start.meta) ? start.meta : {}), ...(isObj(run.meta) ? run.meta : {}) }
    let mtime = null
    try { mtime = lstatSync(p).mtime.toISOString() } catch {}
    runs.push({
      runId: String(run.runId ?? name),
      dirName: name,
      project: run.project ?? start.project ?? null,
      meta,
      startedAt: run.startedAt ?? events[0]?.at ?? mtime,
      updatedAt: run.updatedAt ?? events[events.length - 1]?.at ?? mtime,
      status: run.status ?? (events.some((e) => e.type === 'run.end') ? 'drained' : 'running'),
      summary: isObj(run.summary) ? run.summary : null,
      checkpoint: isObj(run.checkpoint) ? run.checkpoint : null,
      badLines,
      duplicates,
      events,
    })
  }
  runs.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
  return runs
}

export function loadLedgers(dir) {
  if (!dir || !existsSync(dir)) return []
  const out = []
  let names = []
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')) } catch {}
  for (const n of names.sort().reverse()) {
    const l = readJson(join(dir, n))
    if (isObj(l)) out.push({ file: n, ...l })
  }
  return out
}

// ── aggregate ──

export function finalTokens(run) {
  const end = [...run.events].reverse().find((e) => e.type === 'run.end')
  const toks = run.events.map((e) => num(e.tok)).filter((t) => t !== null)
  return num(end?.tokens) ?? num(run.summary?.totalOutputTokens) ?? (toks.length ? Math.max(...toks) : null)
}

function runFacts(run) {
  const ev = run.events
  const taskRepo = {}
  const tasks = new Set()
  for (const e of ev) {
    if (e.task != null && e.repo != null && ['route', 'dispatch', 'settle'].includes(e.type)) taskRepo[e.task] = e.repo
    if (e.task != null && ['dispatch', 'settle'].includes(e.type)) tasks.add(String(e.task))
  }
  // first-round pass: per (task, per-task stage), the reviews at the lowest round all PASS
  const firstRound = {}
  for (const e of ev) {
    if (e.type !== 'review' || e.task == null || e.stage === 'terminal') continue
    const k = `${e.task}|${e.stage}`
    const r = num(e.round) ?? 0
    const f = firstRound[k]
    if (!f || r < f.round) firstRound[k] = { round: r, pass: e.verdict === 'PASS' }
    else if (r === f.round) f.pass = f.pass && e.verdict === 'PASS'
  }
  const fr = Object.values(firstRound)
  // repos whose terminal review failed
  const termFail = new Set()
  for (const e of ev) {
    if (e.type === 'terminal' && e.repo != null && e.verdict !== 'PASS') termFail.add(e.repo)
    if (e.type === 'review' && e.stage === 'terminal' && e.verdict === 'FAIL') {
      const repo = e.repo ?? taskRepo[e.task]
      if (repo != null) termFail.add(repo)
    }
  }
  // verify overturns, attributed to the persona(s) whose gating findings were checked
  const overturned = {}
  for (const e of ev) {
    if (e.type !== 'verify') continue
    let who = e.persona
    if (who == null) {
      const ps = [...new Set(ev.filter((r) => r.type === 'review' && r.task === e.task && r.stage === e.stage
        && (num(r.round) ?? 0) === (num(e.round) ?? 0) && (num(r.gating) ?? 0) > 0).map((r) => r.persona))]
      who = ps.length === 1 ? ps[0] : ps.length ? `${e.stage} panel (${ps.join('+')})` : `${e.stage} (persona unknown)`
    }
    const o = (overturned[who] ||= { overturned: 0, checked: 0 })
    o.overturned += num(e.overturned) ?? 0
    o.checked += (num(e.overturned) ?? 0) + (num(e.confirmed) ?? 0)
  }
  const fixes = {}
  for (const e of ev) if (e.type === 'fix') fixes[e.model ?? 'unknown'] = (fixes[e.model ?? 'unknown'] || 0) + 1
  const escal = {}
  for (const e of ev) if (e.type === 'escalate') { const k = `${e.from ?? '?'}→${e.to ?? '?'}`; escal[k] = (escal[k] || 0) + 1 }
  const guards = ev.filter((e) => e.type === 'guard' && e.decision === 'PASS')
  return {
    tasks: tasks.size,
    firstRound: { passed: fr.filter((f) => f.pass).length, total: fr.length },
    fixes,
    escal,
    guardPass: guards.length,
    guardReflagged: guards.filter((g) => termFail.has(g.repo ?? taskRepo[g.task])).length,
    overturned,
    replans: ev.filter((e) => e.type === 'replan').length,
    halted: run.status === 'halted' || ev.some((e) => e.type === 'halt'),
    tokens: finalTokens(run),
  }
}

const addInto = (dst, src) => { for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] || 0) + v }

export function aggregate(runs) {
  const groups = new Map()
  for (const run of runs) {
    const version = run.meta.grimoireVersion ?? 'unknown'
    const briefsHash = run.meta.briefsHash ?? 'unknown'
    const key = `${version}\u0000${briefsHash}`
    if (!groups.has(key)) groups.set(key, {
      version, briefsHash, runs: 0, runIds: [], tasks: 0,
      firstRound: { passed: 0, total: 0 }, firstRoundPassRate: null,
      fixRoundsByModel: {}, guardPass: 0, guardPassReflagged: 0, overturnedByPersona: {},
      escalations: 0, escalationsByPath: {}, replans: 0, halts: 0,
      tokensPerRun: { avg: null, max: null, values: [] }, skippedLines: 0,
    })
    const g = groups.get(key)
    const f = runFacts(run)
    g.runs++
    g.runIds.push(run.runId)
    g.tasks += f.tasks
    g.firstRound.passed += f.firstRound.passed
    g.firstRound.total += f.firstRound.total
    addInto(g.fixRoundsByModel, f.fixes)
    addInto(g.escalationsByPath, f.escal)
    g.escalations += Object.values(f.escal).reduce((a, b) => a + b, 0)
    g.guardPass += f.guardPass
    g.guardPassReflagged += f.guardReflagged
    for (const [p, o] of Object.entries(f.overturned)) {
      const d = (g.overturnedByPersona[p] ||= { overturned: 0, checked: 0 })
      d.overturned += o.overturned
      d.checked += o.checked
    }
    g.replans += f.replans
    g.halts += f.halted ? 1 : 0
    if (f.tokens !== null) g.tokensPerRun.values.push(f.tokens)
    g.skippedLines += run.badLines
  }
  const out = [...groups.values()]
  for (const g of out) {
    g.firstRoundPassRate = g.firstRound.total ? g.firstRound.passed / g.firstRound.total : null
    const v = g.tokensPerRun.values
    if (v.length) { g.tokensPerRun.avg = Math.round(v.reduce((a, b) => a + b, 0) / v.length); g.tokensPerRun.max = Math.max(...v) }
  }
  const unk = (v) => (v === 'unknown' ? 1 : 0) // runs without meta sort last
  out.sort((a, b) => unk(a.version) - unk(b.version) || b.version.localeCompare(a.version, undefined, { numeric: true }) || a.briefsHash.localeCompare(b.briefsHash))
  return out
}

function summaryText(groups, runs, dir) {
  const skipped = runs.reduce((a, r) => a + r.badLines, 0)
  const pct = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`)
  const kv = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'
  const lines = [`grimoire runs: ${runs.length} in ${dir}${skipped ? ` (${skipped} malformed line${skipped > 1 ? 's' : ''} skipped)` : ''}`]
  if (!runs.length) lines.push('no runs found')
  for (const g of groups) {
    lines.push('', `version ${g.version} · briefs ${g.briefsHash}`)
    lines.push(`  runs ${g.runs} · tasks ${g.tasks} · first-round pass ${pct(g.firstRoundPassRate)} (${g.firstRound.passed}/${g.firstRound.total})`)
    lines.push(`  fix rounds by model: ${kv(g.fixRoundsByModel)}`)
    lines.push(`  guard PASS ${g.guardPass} · later re-flagged by terminal ${g.guardPassReflagged}`)
    lines.push(`  overturned by verify: ${Object.entries(g.overturnedByPersona).map(([p, o]) => `${p} ${o.overturned}/${o.checked}`).join(', ') || 'none'}`)
    lines.push(`  escalations ${g.escalations}${g.escalations ? ` (${kv(g.escalationsByPath)})` : ''} · replans ${g.replans} · halts ${g.halts}`)
    lines.push(`  tokens/run: avg ${g.tokensPerRun.avg ?? 'n/a'} · max ${g.tokensPerRun.max ?? 'n/a'}`)
  }
  return lines.join('\n')
}

// ── prune ──
function safeDir(dir) {
  const abs = resolve(dir)
  const inside = (root) => { const rel = relative(resolve(root), abs); return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) }
  if (abs === resolve('/') || abs === resolve(homedir())) return `refusing to prune ${abs}: it is / or $HOME`
  // Inside the cwd, or inside the main checkout when the cwd is one of its linked worktrees.
  if (!inside(process.cwd()) && !inside(stateRoot())) return `refusing to prune ${abs}: it must be inside the current directory (${resolve(process.cwd())}) or its main checkout, and not the directory itself`
  return null
}

function prune(dir, days, dryRun) {
  const refusal = safeDir(dir)
  if (refusal) { console.error(refusal); process.exit(2) }
  const abs = resolve(dir)
  const cutoff = Date.now() - days * DAY
  const removed = []
  for (const name of subdirs(abs)) {
    const p = join(abs, name)
    if (!isRunDir(p)) continue // not a run dir
    const rj = readJson(join(p, 'run.json'))
    let t = Date.parse(isObj(rj) ? rj.startedAt : '')
    if (!Number.isFinite(t)) { try { t = lstatSync(p).mtimeMs } catch { continue } }
    if (t >= cutoff) continue
    if (!dryRun) rmSync(p, { recursive: true, force: true })
    removed.push({ name, startedAt: new Date(t).toISOString() })
  }
  const verb = dryRun ? 'would remove' : 'removed'
  for (const r of removed) console.log(`${verb} ${join(dir, r.name)} (started ${r.startedAt})`)
  console.log(`${verb} ${removed.length} run${removed.length === 1 ? '' : 's'} older than ${days} days from ${dir}`)
}

// ── render ──
const CSS = `
:root{--bg:#fbfbfa;--fg:#1d1d1b;--mut:#6b6a66;--card:#fff;--line:#e3e2de;--acc:#5b4bd6;--ok:#1f7a3f;--bad:#b3261e;--warn:#9a6700;--chip:#f0efeb;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#e8e6e1;--mut:#9b9a95;--card:#1f1f1d;--line:#34332f;--acc:#a79bff;--ok:#5cc47f;--bad:#ff8a80;--warn:#e0b44c;--chip:#2a2a27}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
header h1{font-size:16px;margin:0 8px 0 0}header label{display:flex;gap:6px;align-items:center;color:var(--mut);font-size:12px}
select,input{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 8px;max-width:100%}
main{padding:16px;max-width:1200px;margin:0 auto}section{margin:0 0 22px}h2{font-size:15px;margin:0 0 8px}h3{font-size:13px;margin:0 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.stat b{display:block;font-size:20px}.stat span{color:var(--mut);font-size:12px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.tag{background:var(--chip);border-radius:999px;padding:2px 9px;font-size:12px;font-family:var(--mono);overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:2px 10px;font-size:12px}
.chip.on{background:var(--acc);border-color:var(--acc);color:#fff}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600;font-size:12px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.txt{overflow-wrap:anywhere;min-width:220px}td.mono{font-family:var(--mono);font-size:12px;white-space:nowrap}
.PASS,.DONE,.drained,.answered{color:var(--ok)}.FAIL,.halted,.HALT,.BLOCKED,.FAILED,.GATE_FAILED{color:var(--bad)}.RE_REVIEW,.REVISE,.running,.NEEDS_ATTENTION{color:var(--warn)}
.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.lane .task{border-top:1px solid var(--line);padding:6px 0;cursor:pointer}.lane .task:hover{color:var(--acc)}
details{border:1px solid var(--line);border-radius:8px;margin:6px 0;background:var(--card)}summary{cursor:pointer;padding:8px 10px;font-weight:600;overflow-wrap:anywhere}
details ol{margin:0;padding:0 10px 10px 30px}details li{margin:3px 0;overflow-wrap:anywhere}.k{font-family:var(--mono);font-size:12px;color:var(--mut)}
.muted{color:var(--mut)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);font-size:12px;margin:0}.empty{color:var(--mut);padding:8px 0}
`

// Runs in the browser. Builds every node with textContent/append: data never reaches innerHTML.
function client() {
  const D = JSON.parse(document.getElementById('grimoire-data').textContent)
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else el.setAttribute(k, String(v))
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c))
    return el
  }
  const STATUS = ['PASS', 'FAIL', 'DONE', 'drained', 'halted', 'running', 'HALT', 'REVISE', 'RE_REVIEW', 'BLOCKED', 'FAILED', 'GATE_FAILED', 'NEEDS_ATTENTION', 'answered']
  const cls = (v) => (STATUS.includes(String(v)) ? String(v) : null)
  const s = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v))
  const list = (v) => (Array.isArray(v) ? v.map(s).join('; ') : s(v))
  const BASE = ['seq', 'type', 'tok', 'at']
  const rest = (e) => { const o = {}; for (const k of Object.keys(e)) if (!BASE.includes(k)) o[k] = e[k]; return JSON.stringify(o) }
  const SUM = {
    'run.start': (e) => `${s(e.mode)} · repos: ${list(e.repos)}`,
    route: (e) => `${s(e.agent)} × ${s(e.model)}${e.fallback ? ' (fallback)' : ''} — ${s(e.reason)}`,
    dispatch: (e) => `${s(e.agent)} × ${s(e.model)} · ${s(e.lane)} · cycle ${s(e.cycle)}`,
    precheck: (e) => `${s(e.verdict)}${Array.isArray(e.problems) && e.problems.length ? ': ' + list(e.problems) : ''}`,
    review: (e) => `${s(e.stage)} · ${s(e.persona)} → ${s(e.verdict)} (gating ${s(e.gating)}, advisory ${s(e.advisory)}, round ${s(e.round)})`,
    verify: (e) => `${s(e.stage)} r${s(e.round)}: ${s(e.confirmed)} confirmed, ${s(e.overturned)} overturned${Array.isArray(e.reasons) && e.reasons.length ? ' — ' + list(e.reasons) : ''}`,
    fix: (e) => `${s(e.stage)} r${s(e.round)} · ${s(e.model)} · ${s(e.findings)} finding(s)`,
    escalate: (e) => `${s(e.from)} → ${s(e.to)}: ${s(e.reason)}`,
    guard: (e) => `${s(e.stage)} r${s(e.round)} → ${s(e.decision)}: ${s(e.reason)}`,
    resolve: (e) => `${s(e.scout)} ${e.answered ? 'answered' : 'unanswered'}: ${s(e.question)}`,
    integrate: (e) => s(e.status),
    settle: (e) => `${s(e.repo)} → ${s(e.status)}`,
    replan: (e) => `#${s(e.n)} ${s(e.decision)}: ${s(e.reason)} (requeued ${s(e.requeued)})${Array.isArray(e.learnings) && e.learnings.length ? ' · learnings: ' + list(e.learnings) : ''}`,
    terminal: (e) => `${s(e.repo)} → ${s(e.verdict)}`,
    gate: (e) => `${s(e.repo)} → ${s(e.status)}${e.applies === false ? ' (not applicable)' : ''}${e.prUrl ? ' · ' + s(e.prUrl) : ''}`,
    claim: (e) => `${s(e.action)} by ${s(e.by)}`,
    budget: (e) => `${s(e.spent)} / ${s(e.cap)} → ${s(e.action)}`,
    halt: (e) => s(e.reason),
    'run.end': (e) => `${s(e.status)} · done ${s(e.done)} · failed ${s(e.failed)} · blocked ${s(e.blocked)} · PRs ${s(e.prs)} · tokens ${s(e.tokens)}`,
  }
  const summarize = (e) => { try { return SUM[e.type] ? SUM[e.type](e) : rest(e) } catch { return rest(e) } }
  const verdictOf = (e) => e.verdict ?? e.decision ?? e.status ?? null

  const st = { run: D.initialRun, version: D.initialVersion || '', briefs: '', types: new Set(), q: '', task: null }
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')
  const byVersion = (r) => (!st.version || (r.meta.grimoireVersion ?? 'unknown') === st.version) && (!st.briefs || (r.meta.briefsHash ?? 'unknown') === st.briefs)
  const runs = () => D.runs.filter(byVersion)
  const current = () => runs().find((r) => r.runId === st.run) || runs()[0] || null

  const uniq = (a) => [...new Set(a)]
  const opt = (value, label, sel) => h('option', { value, selected: sel ? 'selected' : null }, label)
  function header() {
    const vs = uniq(D.runs.map((r) => r.meta.grimoireVersion ?? 'unknown'))
    const bs = uniq(D.runs.map((r) => r.meta.briefsHash ?? 'unknown'))
    const cur = current()
    return h('header', null,
      h('h1', null, 'grimoire run log'),
      h('label', null, 'run', h('select', { onchange: (ev) => { st.run = ev.target.value; st.task = null; render() } },
        runs().map((r) => opt(r.runId, `${r.runId}${r.project ? ' · ' + r.project : ''} · ${r.status}`, cur && r.runId === cur.runId)))),
      h('label', null, 'version', h('select', { onchange: (ev) => { st.version = ev.target.value; render() } },
        opt('', 'all', !st.version), vs.map((v) => opt(v, v, v === st.version)))),
      h('label', null, 'briefs', h('select', { onchange: (ev) => { st.briefs = ev.target.value; render() } },
        opt('', 'all', !st.briefs), bs.map((v) => opt(v, v, v === st.briefs)))),
      h('span', { class: 'muted' }, `generated ${D.generatedAt}`))
  }

  const stat = (label, value, c) => h('div', { class: 'card stat' }, h('b', { class: cls(c) }, value), h('span', null, label))
  function overview(r) {
    const ev = r.events
    const end = [...ev].reverse().find((e) => e.type === 'run.end') || {}
    const sm = r.summary || {}
    const count = (t) => ev.filter((e) => e.type === t).length
    const settles = ev.filter((e) => e.type === 'settle')
    const done = end.done ?? sm.done ?? settles.filter((e) => e.status === 'DONE').length
    const failed = end.failed ?? (Array.isArray(sm.needsAttention) ? sm.needsAttention.length : sm.needsAttention)
    const blocked = end.blocked ?? (Array.isArray(sm.blocked) ? sm.blocked.length : sm.blocked)
    const prUrls = uniq([...(Array.isArray(sm.prs) ? sm.prs.map((p) => (typeof p === 'string' ? p : p && (p.url || p.prUrl))) : []),
      ...ev.filter((e) => e.type === 'gate' && e.prUrl).map((e) => e.prUrl)].filter(Boolean).map(String))
    const halt = ev.find((e) => e.type === 'halt')
    return h('section', null,
      h('h2', null, 'Overview'),
      h('div', { class: 'tags' }, h('span', { class: 'tag' }, `run ${r.runId}`), r.project ? h('span', { class: 'tag' }, `project ${s(r.project)}`) : null,
        Object.entries(r.meta).map(([k, v]) => h('span', { class: 'tag' }, `${k} ${s(v)}`)),
        h('span', { class: 'tag' }, `started ${s(r.startedAt)}`), h('span', { class: 'tag' }, `updated ${s(r.updatedAt)}`)),
      h('div', { class: 'grid' },
        stat('status', s(r.status), r.status), stat('output tokens', fmt(D.tokens[r.runId])),
        stat('done', s(done ?? '—')), stat('failed / attention', s(failed ?? '—')), stat('blocked', s(blocked ?? '—')),
        stat('PRs', s(end.prs ?? prUrls.length)), stat('replans', s(count('replan'))), stat('events', s(ev.length))),
      prUrls.length ? h('div', { class: 'tags' }, prUrls.map((u) => h('span', { class: 'tag' }, u))) : null,
      halt || sm.halt ? h('p', { class: 'FAIL' }, `halt: ${s(halt ? halt.reason : sm.halt.reason ?? sm.halt)}`) : null,
      r.checkpoint ? checkpoint(r.checkpoint) : null,
      isObj(sm.telemetry) ? kvBlock('Telemetry (run summary)', sm.telemetry) : null,
      r.badLines ? h('p', { class: 'muted' }, `${r.badLines} malformed event line(s) skipped`) : null,
      r.duplicates ? h('p', { class: 'muted' }, `${r.duplicates} duplicate seq line(s) from retried flushes ignored`) : null)
  }

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  function kvBlock(title, o) {
    return h('div', { class: 'card', style: 'margin-top:8px' }, h('h3', null, title),
      h('div', { class: 'scroll' }, h('table', null, h('tbody', null, Object.entries(o).map(([k, v]) =>
        h('tr', null, h('th', null, k), h('td', { class: 'txt' }, s(v))))))))
  }
  function checkpoint(c) {
    const n = (v) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : s(v ?? '—'))
    const fixes = isObj(c.fixRounds) ? Object.entries(c.fixRounds).map(([t, k]) => `${t} ${s(k)}`).join(', ') : ''
    return h('div', { class: 'card', style: 'margin-top:8px' }, h('h3', null, 'Checkpoint'),
      h('div', { class: 'grid' }, stat('replans used', s(c.replansUsed ?? '—')), stat('output tokens spent', fmt(c.outputTokensSpent)),
        stat('last seq', s(c.lastSeq ?? '—')), stat('landed', n(c.landed)), stat('pending', n(c.pending)), stat('learnings', n(c.learnings))),
      fixes ? h('p', null, h('span', { class: 'muted' }, 'fix rounds: '), fixes) : null,
      Array.isArray(c.pending) && c.pending.length ? h('p', null, h('span', { class: 'muted' }, 'pending: '), c.pending.map(s).join(', ')) : null,
      Array.isArray(c.learnings) && c.learnings.length ? h('ul', null, c.learnings.map((l) => h('li', null, s(l)))) : null)
  }

  function timeline(r) {
    const types = uniq(r.events.map((e) => s(e.type)))
    const q = st.q.toLowerCase()
    const rows = r.events.filter((e) => (!st.types.size || st.types.has(s(e.type)))
      && (!q || JSON.stringify(e).toLowerCase().includes(q)))
    return h('section', null,
      h('h2', null, `Timeline (${rows.length} / ${r.events.length})`),
      h('div', { class: 'chips' }, types.map((t) => h('button', { class: 'chip' + (st.types.has(t) ? ' on' : ''), type: 'button',
        onclick: () => { st.types.has(t) ? st.types.delete(t) : st.types.add(t); render() } }, t)),
      st.types.size ? h('button', { class: 'chip', type: 'button', onclick: () => { st.types.clear(); render() } }, 'clear') : null),
      h('input', { type: 'search', placeholder: 'search events…', value: st.q, id: 'q', 'aria-label': 'search events',
        oninput: (ev) => { st.q = ev.target.value; render(); const i = document.getElementById('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length) } }),
      h('div', { class: 'scroll card', style: 'margin-top:8px;padding:0' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { class: 'num' }, 'seq'), h('th', null, 'type'), h('th', null, 'task'), h('th', null, 'summary'), h('th', { class: 'num' }, 'tokens'))),
        h('tbody', null, rows.length ? rows.map((e) => h('tr', { title: s(e.at) },
          h('td', { class: 'num' }, s(e.seq)), h('td', { class: 'mono ' + (cls(verdictOf(e)) || '') }, s(e.type)),
          h('td', { class: 'mono' }, e.task != null ? h('a', { href: '#task', onclick: (ev) => { ev.preventDefault(); st.task = s(e.task); render(); const d = document.getElementById('drill'); if (d) d.scrollIntoView() } }, s(e.task)) : ''),
          h('td', { class: 'txt' }, summarize(e)), h('td', { class: 'num' }, fmt(e.tok))))
          : h('tr', null, h('td', { colspan: 5, class: 'empty' }, 'no events match'))))))
  }

  function taskIndex(r) {
    const tasks = new Map()
    for (const e of r.events) {
      if (e.task == null) continue
      const id = s(e.task)
      if (!tasks.has(id)) tasks.set(id, { id, repo: null, events: [] })
      const t = tasks.get(id)
      t.events.push(e)
      if (e.repo != null) t.repo = s(e.repo)
    }
    return [...tasks.values()]
  }
  const lastOf = (t, type) => [...t.events].reverse().find((e) => e.type === type)

  function drill(r, tasks) {
    return h('section', { id: 'drill' },
      h('h2', null, 'Per-task drill-down'),
      tasks.length ? tasks.map((t) => {
        const route = lastOf(t, 'route'), settle = lastOf(t, 'settle')
        return h('details', { open: st.task === t.id ? 'open' : null },
          h('summary', null, `${t.id}`, h('span', { class: 'muted' }, ` · ${t.repo ?? '?'}${route ? ` · ${s(route.agent)} × ${s(route.model)}` : ''} · `),
            h('span', { class: cls(settle && settle.status) }, settle ? s(settle.status) : 'unsettled')),
          h('ol', null, t.events.map((e) => h('li', null, h('span', { class: 'k' }, `#${s(e.seq)} ${s(e.type)} `),
            h('span', { class: cls(verdictOf(e)) }, summarize(e))))))
      }) : h('p', { class: 'empty' }, 'no task events in this run'))
  }

  function lanes(r, tasks) {
    const start = r.events.find((e) => e.type === 'run.start') || {}
    const repos = uniq([...(Array.isArray(start.repos) ? start.repos.map((x) => s(x && x.name ? x.name : x)) : []), ...tasks.map((t) => t.repo ?? '?')])
    return h('section', null,
      h('h2', null, 'By repository'),
      h('div', { class: 'lanes' }, repos.map((repo) => {
        const term = [...r.events].reverse().find((e) => e.type === 'terminal' && s(e.repo) === repo)
        const gate = [...r.events].reverse().find((e) => e.type === 'gate' && s(e.repo) === repo)
        const mine = tasks.filter((t) => (t.repo ?? '?') === repo)
        return h('div', { class: 'card lane' },
          h('h3', null, repo),
          h('div', { class: 'muted' }, 'terminal ', h('span', { class: cls(term && term.verdict) }, term ? s(term.verdict) : '—'),
            ' · gate ', h('span', { class: cls(gate && gate.status) }, gate ? s(gate.status) : '—')),
          mine.length ? mine.map((t) => {
            const settle = lastOf(t, 'settle'), route = lastOf(t, 'route')
            const n = (type) => t.events.filter((e) => e.type === type).length
            return h('div', { class: 'task', role: 'button', tabindex: 0, onclick: () => { st.task = t.id; render(); const d = document.getElementById('drill'); if (d) d.scrollIntoView() } },
              h('b', null, t.id), ' ', h('span', { class: cls(settle && settle.status) }, settle ? s(settle.status) : 'unsettled'),
              h('div', { class: 'muted' }, `${route ? `${s(route.agent)} × ${s(route.model)} · ` : ''}${n('review')} reviews · ${n('fix')} fixes · ${n('escalate')} escalations`))
          }) : h('p', { class: 'empty' }, 'no tasks'))
      })))
  }

  function aggregatePanel() {
    const groups = D.aggregate.filter((g) => (!st.version || g.version === st.version) && (!st.briefs || g.briefsHash === st.briefs))
    const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
    const kv = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || '—'
    const cols = [
      ['version', (g) => g.version], ['briefs', (g) => g.briefsHash], ['runs', (g) => g.runs], ['tasks', (g) => g.tasks],
      ['1st-round pass', (g) => `${pct(g.firstRoundPassRate)} (${g.firstRound.passed}/${g.firstRound.total})`],
      ['fix rounds by model', (g) => kv(g.fixRoundsByModel)],
      ['guard PASS → terminal FAIL', (g) => `${g.guardPassReflagged} / ${g.guardPass}`],
      ['overturned by verify', (g) => Object.entries(g.overturnedByPersona).map(([p, o]) => `${p} ${o.overturned}/${o.checked}`).join(', ') || '—'],
      ['escalations', (g) => `${g.escalations}${g.escalations ? ` (${kv(g.escalationsByPath)})` : ''}`],
      ['replans', (g) => g.replans], ['halts', (g) => g.halts],
      ['tokens/run avg · max', (g) => `${fmt(g.tokensPerRun.avg)} · ${fmt(g.tokensPerRun.max)}`],
    ]
    return h('section', null,
      h('h2', null, 'Across runs, by version'),
      h('div', { class: 'scroll card', style: 'padding:0' }, h('table', null,
        h('thead', null, h('tr', null, cols.map(([c]) => h('th', null, c)))),
        h('tbody', null, groups.length ? groups.map((g) => h('tr', null, cols.map(([, f]) => h('td', { class: 'txt', style: 'min-width:0' }, s(f(g))))))
          : h('tr', null, h('td', { colspan: cols.length, class: 'empty' }, 'no runs'))))))
  }

  function ledgers() {
    if (!D.ledgers.length) return null
    const n = (v) => (Array.isArray(v) ? v.length : v == null ? '—' : s(v))
    return h('section', null,
      h('h2', null, `Committed run ledgers (${D.ledgers.length})`),
      h('div', { class: 'scroll card', style: 'padding:0' }, h('table', null,
        h('thead', null, h('tr', null, ['file', 'project', 'version', 'done', 'attention', 'PRs', 'replans', 'halt', 'learnings'].map((c) => h('th', null, c)))),
        h('tbody', null, D.ledgers.map((l) => h('tr', null,
          h('td', { class: 'mono' }, s(l.file)), h('td', null, s(l.project)), h('td', null, s(l.meta && l.meta.grimoireVersion)),
          h('td', null, n(l.done)), h('td', null, n(l.needsAttention)), h('td', null, n(l.prs)), h('td', null, n(l.replans)),
          h('td', { class: l.halt ? 'FAIL' : null }, l.halt ? s(l.halt.reason ?? l.halt) : '—'),
          h('td', { class: 'txt' }, Array.isArray(l.learnings) ? l.learnings.map(s).join(' · ') : s(l.learnings))))))))
  }

  function render() {
    const r = current()
    const main = h('main', null)
    if (r) {
      st.run = r.runId
      const tasks = taskIndex(r)
      main.append(overview(r), timeline(r), drill(r, tasks), lanes(r, tasks))
    } else main.append(h('section', null, h('h2', null, 'No runs'), h('p', { class: 'empty' }, 'no telemetry runs match the filters')))
    main.append(aggregatePanel())
    const lg = ledgers()
    if (lg) main.append(lg)
    document.body.replaceChildren(header(), main)
  }
  render()
}

function renderHtml({ runs, ledgers, groups, initialRun, initialVersion }) {
  const tokens = {}
  for (const r of runs) tokens[r.runId] = finalTokens(r)
  const data = { generatedAt: new Date().toISOString(), initialRun, initialVersion, runs, ledgers, aggregate: groups, tokens }
  // Every "<" becomes <, so no data string can close the <script> element.
  const blob = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const js = `(${client.toString()})()`.replace(/<\//g, '<\\/')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'">
<title>grimoire run log</title><style>${CSS}</style></head>
<body><noscript>This page needs JavaScript to render the run log.</noscript>
<script type="application/json" id="grimoire-data">${blob}</script>
<script>${js}</script>
</body></html>
`
}

// The decision journal lives in the MAIN checkout: a relative --dir (or telemetry.dir) resolves
// there from any linked git worktree, as the loop's journal writer does, so every worktree and
// crystallize's own worktree see the same runs. Outside git, it resolves against the cwd.
function stateRoot() {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })
  const common = r.status === 0 ? r.stdout.trim() : ''
  return common.endsWith(`${sep}.git`) ? dirname(common) : process.cwd()
}

// ── main ──
function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0] || 'render'
  const cfg = config()
  const tcfg = isObj(cfg.telemetry) ? cfg.telemetry : {}
  const absDir = resolve(stateRoot(), typeof args.dir === 'string' ? args.dir : typeof tcfg.dir === 'string' && tcfg.dir ? tcfg.dir : '.grimoire/runs')
  const shown = relative(process.cwd(), absDir)
  const dir = shown && !shown.startsWith('..') && !isAbsolute(shown) ? shown : absDir // as typed when under the cwd
  const version = typeof args.version === 'string' ? args.version : null

  if (cmd === 'prune') {
    const days = Number(args.days ?? tcfg.retentionDays ?? 183)
    if (!Number.isFinite(days) || days < 0) { console.error(`invalid --days: ${args.days}`); process.exit(2) }
    return prune(dir, days, !!args['dry-run'])
  }

  let runs = loadRuns(resolve(dir))
  if (version) runs = runs.filter((r) => (r.meta.grimoireVersion ?? 'unknown') === version)
  const groups = aggregate(runs)

  if (cmd === 'summary') {
    if (args.json) console.log(JSON.stringify({ dir, runs: runs.length, skippedLines: runs.reduce((a, r) => a + r.badLines, 0), groups }, null, 2))
    else console.log(summaryText(groups, runs, dir))
    return
  }
  if (cmd !== 'render') { console.error(`unknown command: ${cmd} (expected render, summary or prune)`); process.exit(2) }

  const ledgers = loadLedgers(resolve(typeof args.ledgers === 'string' ? args.ledgers : typeof cfg.runsDir === 'string' && cfg.runsDir ? cfg.runsDir : 'runs'))
  const out = resolve(typeof args.out === 'string' ? args.out : join(stateRoot(), '.grimoire/logs.html'))
  const initialRun = typeof args.run === 'string' ? args.run : runs[0]?.runId ?? null
  if (typeof args.run === 'string' && !runs.some((r) => r.runId === args.run)) console.error(`warning: run ${args.run} not found in ${dir}; opening the newest`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, renderHtml({ runs, ledgers, groups, initialRun, initialVersion: version }))
  console.log(out)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
