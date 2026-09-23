#!/usr/bin/env node
// grimoire · PreToolUse guard. A seatbelt for unattended agents, not a sandbox.
//
// Reads the PreToolUse payload on stdin ({ tool_name, tool_input, cwd, agent_id?,
// agent_type?, scratchpad_dir? }) and blocks a narrow set of irreversible actions:
//   Bash                  · git push to a protected branch (or --mirror / --all)
//                         · git branch -d/-D and git worktree remove of a protected branch
//                         · recursive rm of /, ~, $HOME, ., .., *, the project's .git, or a
//                           path outside the project (temp dirs excepted)
//   Write/Edit/MultiEdit/ · the project's .claude/settings.json, .claude/settings.local.json,
//   NotebookEdit            .claude/hooks/ and guard.protectedPaths (override: GRIMOIRE_GUARD_ALLOW=1)
//                         · <memoryDir>/ when a named roster agent (not crystallize) writes it
//                         · the same paths in every linked git worktree of the project's repository
//
// Deny = exit 2 with one line on stderr (Claude Code shows it to the agent and skips the call).
// Everything else, including malformed input or config and any internal error, exits 0
// silently: the guard fails open, so it can never wedge a session.
import { readFileSync, realpathSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const DEFAULT_BRANCHES = ['main', 'master', 'trunk', 'develop', 'release/*']
const PROTECTED_FILES = ['.claude/settings.json', '.claude/settings.local.json']
// `.claude/hooks/`, not a root `hooks/`: many app layouts keep source code in a root `hooks/`.
const PROTECTED_DIRS = ['.claude/hooks/']
// Agents that must never write memory: the plugin's scouts and reviewer, plus every repo's
// owning agent from grimoire.config.json. crystallize runs as a generic subagent (or in the
// main session), so an allow-list by agent_type is impossible; a deny-list of known names is.
const ROSTER_AGENTS = [
  'reviewer', 'codebase-scout', 'reference-scout', 'contract-checker', 'tracker-scout', 'design-scout',
  'security-scout', 'perf-scout', 'migration-engineer', 'test-engineer',
]
const FOLD = process.platform === 'darwin' || process.platform === 'win32'

class Deny extends Error {}
const deny = (msg) => { throw new Deny(`grimoire guard: ${msg}`) }

function readJSON(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function loadConfig(projectDir) {
  const raw = readJSON(path.join(projectDir, 'grimoire.config.json'))
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const g = cfg.guard && typeof cfg.guard === 'object' && !Array.isArray(cfg.guard) ? cfg.guard : {}
  const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : null)
  const branches = strs(g.protectedBranches) || [...DEFAULT_BRANCHES]
  if (typeof cfg.baseBranch === 'string' && cfg.baseBranch.trim()) branches.push(cfg.baseBranch.trim().replace(/^origin\//, ''))
  const memoryDir = [g.memoryDir, cfg.memoryDir, 'memory'].find((v) => typeof v === 'string' && v.trim())
  const repoAgents = [
    ...(Array.isArray(cfg.repos) ? cfg.repos.map((r) => r && r.agent) : []),
    ...(Array.isArray(cfg.specialists) ? cfg.specialists.map((sp) => sp && sp.agent) : []),
  ].filter((a) => typeof a === 'string')
  return {
    enabled: g.enabled !== false,
    branches,
    protectedPaths: strs(g.protectedPaths) || [],
    memoryDir: memoryDir.trim().replace(/^\.\//, '').replace(/\/+$/, ''),
    memoryDenied: new Set([...ROSTER_AGENTS, ...repoAgents, ...(strs(g.memoryDeniedAgents) || [])]),
  }
}

// ─────────────────────────────── paths ───────────────────────────────
const norm = (p) => { const r = path.resolve(p); return FOLD ? r.toLowerCase() : r }
const inside = (child, parent) => { const c = norm(child), p = norm(parent); return c !== p && c.startsWith(p.endsWith(path.sep) ? p : p + path.sep) }
const same = (a, b) => norm(a) === norm(b)
const real = (p) => { try { return realpathSync(p) } catch { return path.resolve(p) } }

// ─────────────────────────────── shell tokenizer ───────────────────────────────
// Quote-aware split of a command string into simple commands (arrays of words).
// Quoted text is one literal word; $(…) and `…` bodies are collected and analyzed as
// commands of their own; redirections and heredoc bodies are dropped; # comments skipped.
function parseShell(src) {
  const segments = [], subs = []
  let words = [], word = '', inWord = false, discard = false, heredocs = []
  const flush = () => {
    if (inWord) { if (discard) discard = false; else words.push(word) }
    word = ''; inWord = false
  }
  const endSeg = () => { flush(); if (words.length) segments.push(words); words = [] }
  const capture = (i, open, close) => { // i at first char after the opener; returns [body, next i]
    let depth = 1, j = i, q = null, docs = []
    for (; j < src.length; j++) {
      const ch = src[j]
      if (q) { if (ch === q) q = null; else if (ch === '\\' && q === '"') j++; continue }
      if (ch === '\\') { j++; continue }
      if (open !== close && ch === '<' && src[j + 1] === '<' && src[j + 2] !== '<') { // heredoc: its body is opaque
        const m = /^<<(-?)[ \t]*(['"]?)([^\s'";&|<>()]+)\2/.exec(src.slice(j))
        if (m) { docs.push({ delim: m[3], strip: !!m[1] }); j += m[0].length - 1; continue }
      }
      if (ch === '\n' && docs.length) {
        for (const h of docs) {
          while (j < src.length) {
            const nl = src.indexOf('\n', j + 1), end = nl < 0 ? src.length : nl
            const line = src.slice(j + 1, end)
            j = end
            if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
          }
        }
        docs = []
        continue
      }
      if (open !== close && (ch === "'" || ch === '"')) { q = ch; continue }
      if (open !== close && ch === open) depth++
      else if (ch === close && --depth === 0) break
    }
    return [src.slice(i, j), j + 1]
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\r') { flush(); i++; continue }
    if (c === '\n') {
      endSeg(); i++
      for (const h of heredocs) { // skip heredoc bodies up to their delimiter line
        while (i < src.length) {
          const nl = src.indexOf('\n', i), end = nl < 0 ? src.length : nl
          const line = src.slice(i, end)
          i = nl < 0 ? src.length : nl + 1
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
        }
      }
      heredocs = []
      continue
    }
    if (c === '#' && !inWord) { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '\\') { if (src[i + 1] === '\n') { i += 2; continue } word += src[i + 1] ?? ''; inWord = true; i += 2; continue }
    if (c === "'") { const j = src.indexOf("'", i + 1); const e = j < 0 ? src.length : j; word += src.slice(i + 1, e); inWord = true; i = e + 1; continue }
    if (c === '"') {
      inWord = true; i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1])) { word += src[i + 1]; i += 2; continue }
        if (src[i] === '$' && src[i + 1] === '(') { const [b, n] = capture(i + 2, '(', ')'); subs.push(b); word += '$(…)'; i = n; continue }
        if (src[i] === '`') { const [b, n] = capture(i + 1, '`', '`'); subs.push(b); word += '$(…)'; i = n; continue }
        word += src[i++]
      }
      i++; continue
    }
    if (c === '$' && src[i + 1] === '(') {
      const [b, n] = capture(i + 2, '(', ')')
      if (!b.startsWith('(')) subs.push(b) // $(( … )) is arithmetic, not a command
      word += '$(…)'; inWord = true; i = n; continue
    }
    if (c === '`') { const [b, n] = capture(i + 1, '`', '`'); subs.push(b); word += '$(…)'; inWord = true; i = n; continue }
    if (c === '&' && src[i + 1] === '>') { flush(); i++; continue } // &> is a redirection, handled below
    if (c === '<' || c === '>') {
      if (/^\d+$/.test(word)) { word = ''; inWord = false } else flush()
      let op = ''
      while (i < src.length && '<>&|-'.includes(src[i]) && op.length < 3) { op += src[i]; i++ }
      if (op.startsWith('<<') && !op.startsWith('<<<')) {
        while (src[i] === ' ' || src[i] === '\t') i++
        let d = ''
        while (i < src.length && !' \t\n;&|<>()'.includes(src[i])) { if (src[i] !== "'" && src[i] !== '"' && src[i] !== '\\') d += src[i]; i++ }
        heredocs.push({ delim: d, strip: op.includes('-') })
      } else if (!/&$/.test(op) || !/\d|-/.test(src[i] || '')) {
        discard = true // the next word is the redirection target
      } else {
        while (i < src.length && /[\d-]/.test(src[i])) i++ // >&2, <&-
      }
      continue
    }
    if (';&|()'.includes(c)) { endSeg(); i++; continue }
    word += c; inWord = true; i++
  }
  endSeg()
  return { segments, subs }
}

// ─────────────────────────────── bash rules ───────────────────────────────
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'env', 'xargs', 'timeout', 'stdbuf', 'ionice', 'caffeinate'])
const KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until'])
const ARG_FLAGS = { sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'], env: ['-u', '-C', '-S'], xargs: ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a'], nice: ['-n'], timeout: ['-s', '-k'] }

function strip(words) { // drop assignments, keywords and wrapper commands; return the real argv
  let w = [...words]
  for (let guard = 0; guard < 20 && w.length; guard++) {
    const h = w[0]
    if (KEYWORDS.has(h) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(h)) { w.shift(); continue }
    const base = path.basename(h)
    if (base === 'rtk') { w.shift(); if (w[0] === 'proxy') w.shift(); continue }
    if (WRAPPERS.has(base)) {
      w.shift()
      const takes = ARG_FLAGS[base] || []
      while (w.length && (w[0].startsWith('-') || (base === 'env' && /^[A-Za-z_]\w*=/.test(w[0])))) {
        const f = w.shift()
        if (takes.includes(f)) w.shift()
      }
      if (base === 'timeout' && w.length && /^\d/.test(w[0])) w.shift()
      continue
    }
    break
  }
  if (w.length) w[0] = path.basename(w[0])
  return w
}

function branchMatcher(patterns) {
  const res = patterns.map((p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'))
  return (b) => typeof b === 'string' && res.some((r) => r.test(b))
}

function git(dir, args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

const GIT_GLOBAL_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path'])
const PUSH_ARG = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

function checkGit(argv, cwd, ctx) {
  let i = 1, dir = cwd
  while (i < argv.length && argv[i].startsWith('-')) {
    const f = argv[i++]
    if (f === '-C' && i < argv.length) { dir = path.isAbsolute(argv[i]) ? argv[i] : dir ? path.resolve(dir, argv[i]) : null; i++ } else if (GIT_GLOBAL_ARG.has(f)) i++
  }
  const sub = argv[i], args = argv.slice(i + 1)
  const isProt = ctx.isProtected
  const how = 'run it yourself outside the agent, or edit guard.protectedBranches in grimoire.config.json'
  if (sub === 'push') {
    const pos = []
    let mirror = false, all = false
    for (let k = 0; k < args.length; k++) {
      const a = args[k]
      if (a === '--') { pos.push(...args.slice(k + 1)); break }
      if (a === '--mirror') mirror = true
      else if (a === '--all' || a === '--branches') all = true
      else if (PUSH_ARG.has(a)) k++
      else if (!a.startsWith('-')) pos.push(a)
    }
    if (mirror) deny(`git push --mirror rewrites every remote ref, protected branches included; ${how}.`)
    if (all) deny(`git push --all pushes protected branches too; push the feature branch by name, or ${how}.`)
    const refspecs = pos.slice(1)
    const current = () => (dir ? git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']) : null)
    if (!refspecs.length) {
      const b = current()
      if (isProt(b)) deny(`git push from protected branch '${b}' (no refspec pushes the current branch); ${how}.`)
      return
    }
    for (const spec of refspecs) {
      if (spec.includes('$')) continue
      let dst = spec.replace(/^\+/, '')
      if (dst.includes(':')) dst = dst.slice(dst.lastIndexOf(':') + 1)
      dst = dst.replace(/^refs\/heads\//, '')
      if (dst === 'HEAD' || dst === '@') dst = current()
      if (isProt(dst)) deny(`git push to protected branch '${dst}'; open a PR from a feature branch, or ${how}.`)
    }
    return
  }
  if (sub === 'branch') {
    const del = args.some((a) => a === '--delete' || /^-[a-zA-Z]*[dD]/.test(a))
    if (!del) return
    for (const a of args) if (!a.startsWith('-') && isProt(a.replace(/^refs\/heads\//, ''))) deny(`git branch delete of protected branch '${a}'; ${how}.`)
    return
  }
  if (sub === 'worktree' && args[0] === 'remove') {
    const target = args.slice(1).find((a) => !a.startsWith('-'))
    if (!target || !dir || target.includes('$')) return
    const list = git(dir, ['worktree', 'list', '--porcelain'])
    if (!list) return
    const want = real(path.resolve(dir, target))
    for (const block of list.split(/\n\s*\n/)) {
      const wt = /^worktree (.+)$/m.exec(block), br = /^branch refs\/heads\/(.+)$/m.exec(block)
      if (wt && br && same(real(wt[1]), want) && isProt(br[1])) deny(`git worktree remove of the checkout holding protected branch '${br[1]}'; ${how}.`)
    }
  }
}

const TRIVIAL = new Set(['/', '/*', '~', '~/', '~/*', '$HOME', '${HOME}', '$HOME/', '${HOME}/', '$HOME/*', '${HOME}/*', '.', './', './*', '..', '../', '../*', '*', '.*', '.[!.]*'])

function checkRm(argv, cwd, ctx) {
  let recursive = false
  const targets = []
  let opts = true
  for (const a of argv.slice(1)) {
    if (opts && a === '--') { opts = false; continue }
    if (opts && a.startsWith('--')) { if (a === '--recursive') recursive = true; continue }
    if (opts && /^-[a-zA-Z]+$/.test(a)) { if (/[rR]/.test(a)) recursive = true; continue }
    targets.push(a)
  }
  if (!recursive) return
  const how = 'run it yourself outside the agent if it is really intended'
  const home = process.env.HOME || homedir()
  for (const raw of targets) {
    const t = raw.length > 1 ? raw.replace(/\/+$/, '') || '/' : raw
    if (TRIVIAL.has(raw) || TRIVIAL.has(t)) deny(`recursive rm of '${raw}' is refused; ${how}.`)
    let p = t.replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME\}?(?=\/|$)/, home)
    if (/[$`]/.test(p) || p.includes('$(…)')) continue // unexpanded variable: cannot judge, allow
    if (!path.isAbsolute(p)) { if (!cwd) continue; p = path.resolve(cwd, p) }
    const probe = path.basename(p) === '*' ? path.dirname(p) : p // dir/* empties dir
    const proj = ctx.projectDir
    if (probe === path.parse(probe).root) deny(`recursive rm of the filesystem root ('${raw}'); ${how}.`)
    if (same(probe, path.join(proj, '.git'))) deny(`recursive rm of the project's .git; ${how}.`)
    if (inside(probe, proj)) continue
    if (same(probe, proj) || inside(proj, probe)) deny(`recursive rm of the project directory or one of its parents ('${raw}'); ${how}.`)
    if (ctx.tmpRoots.some((r) => inside(probe, r))) continue
    deny(`recursive rm outside the project ('${raw}' → ${probe}); ${how}.`)
  }
}

function checkBash(command, cwd, ctx, depth = 0) {
  if (typeof command !== 'string' || depth > 4) return
  const { segments, subs } = parseShell(command)
  let dir = cwd
  for (const seg of segments) {
    const argv = strip(seg)
    if (!argv.length) continue
    const cmd = argv[0]
    if (cmd === 'cd' || cmd === 'pushd') {
      const d = argv.slice(1).find((a) => !a.startsWith('-'))
      if (!d || d === '~') dir = process.env.HOME || homedir()
      else if (/[$`]/.test(d) || d.includes('$(…)')) dir = null
      else {
        const e = d.replace(/^~(?=\/)/, process.env.HOME || homedir())
        dir = path.isAbsolute(e) ? e : dir ? path.resolve(dir, e) : null
      }
      continue
    }
    if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(cmd)) {
      const k = argv.findIndex((a, n) => n > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
      if (k > 0 && argv[k + 1]) checkBash(argv[k + 1], dir, ctx, depth + 1)
      continue
    }
    if (cmd === 'eval') { checkBash(argv.slice(1).join(' '), dir, ctx, depth + 1); continue }
    if (cmd === 'git') checkGit(argv, dir, ctx)
    else if (cmd === 'rm') checkRm(argv, dir, ctx)
  }
  for (const s of subs) checkBash(s, dir, ctx, depth + 1)
}

// ─────────────────────────────── write rules ───────────────────────────────
// Where the rules apply. A write is judged as a path inside the project AND as a path inside
// whichever checkout of the project's repository holds it (a loop lane under .worktrees/, a
// session worktree anywhere), both by its literal path and by its real path. A symlinked
// component can therefore never hide a protected path: if ANY reading of the path is protected,
// the write is denied.
const isCheckout = (dir, ctx) => ctx.commonDir && existsSync(path.join(dir, '.git')) && git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']) === ctx.commonDir
function targets(abs, ctx) {
  const out = []
  const add = (root, p) => { if (inside(p, root) && !out.some(([r, q]) => same(r, root) && same(q, p))) out.push([root, p]) }
  add(ctx.projectDir, abs) // literal, as typed
  for (let d = path.dirname(abs); ; d = path.dirname(d)) { // literal ancestors: the checkout by path
    if (isCheckout(d, ctx)) { add(d, abs); break }
    if (path.dirname(d) === d) break
  }
  let d = path.dirname(abs)
  while (!existsSync(d)) { const up = path.dirname(d); if (up === d) return out; d = up }
  const absReal = path.join(real(d), path.relative(d, abs)) // real path: the checkout it lands in
  add(real(ctx.projectDir), absReal)
  const top = ctx.commonDir && git(real(d), ['rev-parse', '--show-toplevel'])
  if (top && isCheckout(top, ctx)) add(real(top), absReal)
  return out
}

function checkWrite(file, cwd, ctx, input) {
  if (typeof file !== 'string' || !file) return
  const abs = path.resolve(cwd || ctx.projectDir, file.replace(/^~(?=\/)/, process.env.HOME || homedir()))
  for (const [root, p] of targets(abs, ctx)) checkRules(path.relative(root, p).split(path.sep).join('/'), ctx, input)
}

function checkRules(relPath, ctx, input) {
  const rel = FOLD ? relPath.toLowerCase() : relPath
  const f = (s) => (FOLD ? s.toLowerCase() : s)
  const under = (dir) => { const d = f(dir.replace(/^\.\//, '').replace(/\/+$/, '')); return rel === d || rel.startsWith(d + '/') }
  const allow = process.env.GRIMOIRE_GUARD_ALLOW === '1'
  const how = 'make this change yourself, or set GRIMOIRE_GUARD_ALLOW=1 in the session environment'
  if (!allow) {
    if (PROTECTED_FILES.some((p) => rel === f(p))) deny(`writes to ${rel} are refused (agent permissions live there); ${how}.`)
    if (PROTECTED_DIRS.some(under)) deny(`writes under hooks/ are refused (the guard itself lives there); ${how}.`)
    for (const p of ctx.protectedPaths) if (p.endsWith('/') ? under(p) : rel === f(p.replace(/^\.\//, '')) || under(p)) deny(`writes to ${rel} are refused (guard.protectedPaths); ${how}.`)
  }
  const agentType = typeof input.agent_type === 'string' ? input.agent_type.replace(/^.*:/, '') : ''
  if (!allow && agentType && !/crystalliz/i.test(agentType) && ctx.memoryDenied.has(agentType) && under(ctx.memoryDir + '/')) {
    deny(`agent '${agentType}' may not write ${rel}: memory is written only by the crystallize step after a PR; report the fact in your result instead, or set GRIMOIRE_GUARD_ALLOW=1.`)
  }
}

// ─────────────────────────────── main ───────────────────────────────
function main() {
  let input
  try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { return 0 }
  if (!input || typeof input !== 'object') return 0
  const cwd = typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : process.cwd()
  const envDir = process.env.CLAUDE_PROJECT_DIR
  const projectDir = envDir && path.isAbsolute(envDir) ? envDir : cwd
  const cfg = loadConfig(projectDir)
  if (!cfg.enabled) return 0
  const tmpRoots = [tmpdir(), '/tmp', '/private/tmp', '/var/tmp', '/private/var/folders', process.env.TMPDIR, input.scratchpad_dir]
    .filter((p) => typeof p === 'string' && path.isAbsolute(p))
  const commonDir = git(projectDir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const ctx = { projectDir, commonDir, isProtected: branchMatcher(cfg.branches), protectedPaths: cfg.protectedPaths, memoryDir: cfg.memoryDir, memoryDenied: cfg.memoryDenied, tmpRoots }
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}
  try {
    switch (input.tool_name) {
      case 'Bash': checkBash(ti.command, cwd, ctx); break
      case 'Write': case 'Edit': case 'MultiEdit': checkWrite(ti.file_path, cwd, ctx, input); break
      case 'NotebookEdit': checkWrite(ti.notebook_path || ti.file_path, cwd, ctx, input); break
    }
  } catch (e) {
    if (e instanceof Deny) { process.stderr.write(e.message.replace(/\s*\n\s*/g, ' ') + '\n'); return 2 }
    return 0
  }
  return 0
}

let code = 0
try { code = main() } catch { code = 0 }
process.exit(code)
