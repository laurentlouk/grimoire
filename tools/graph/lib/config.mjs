// grimoire graph · configuration keys: where the code reads them, where the project declares them, and
// how one key feeds another. Names only: no value of any key is read into the index or an answer.
//
//   reads (code files, at index time, a lexical scan of the source with its comments blanked: lex.mjs)
//     env     process.env.X · process.env['X'] · const { X } = process.env · import.meta.env.X ·
//             Deno.env.get('X') · Bun.env.X · os.environ['X'] · os.environ.get · os.getenv · environ ·
//             django-environ env('X') · pydantic BaseSettings fields (the field name upper-cased,
//             after env_prefix; `Field(env=…)` / `alias=…` / `validation_alias=…` when given) ·
//             `'X' in os.environ` · os.Getenv / os.LookupEnv · Go struct tags env:"X" · System.getenv · @Value("${X}") ·
//             ENV['X'] / ENV.fetch · std::env::var · env!() · clap's env = "X" · getenv / $_ENV / env() ·
//             Environment.GetEnvironmentVariable · ProcessInfo environment · a ConfigService.get of
//             an upper-case name
//     config  ConfigService.get('a.b') (Nest; a key that names a namespace reads all of it) ·
//             Constants.expoConfig.extra.x (Expo: `extra.x`) · @Value("${a.b}") · environment.getProperty ·
//             viper.Get*("a.b") · config('a.b') (Laravel) · Configuration["A:B"] / GetValue<T>("A:B")
//   declarations (names only; each file kind below, and no other file that may hold credentials)
//     .env.example · .env.sample · .env.template (and .env.<x>.example, env-example-<x> …): the names before `=`
//     docker-compose / compose files: `environment:` names · CI workflows (.github/workflows):
//     `env:` names · .gitlab-ci.yml: `variables:` names · app.json: `expo.extra` keys (`extra.x`) ·
//     application.properties / application.yml (Spring): their keys
//     in code: registerAs('ns', () => ({ k: … })) and a Nest config factory (`export default () =>
//     ({ … })`) declare `ns.k`; app.config.ts's `extra: { k: … }` declares `extra.k`
//   mappings (a key set from another, where the syntax states it): `ns.k` ← X for registerAs's
//     `k: process.env.X`; `extra.k` ← X in app.config; `a.b` ← X for a Spring `a.b=${X}`
//
// Stored in the `config` table: repo, path, file_id (NULL for a declaration file the index does not
// parse), node_id (the innermost definition holding the line, else the file), key, kind (env |
// config), role (read | declare | map), src_key (a mapping's source key), via, line.
import path from 'node:path'
import { masked, lineAt, closing, objectLeaves } from './lex.mjs'
import { SECRETISH } from './reach.mjs'
import { skipped } from './project.mjs'

export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/
export const PATH_KEY = /^[A-Za-z_][\w-]{0,99}(?:[.:][\w-]{1,100}){0,12}$/
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/
const kindOfKey = (k) => (ENV_NAME.test(k) ? 'env' : 'config')

// ── reads in code ──
// [regex, how the key is found (capture index), kind ('env' | 'config' | 'auto'), via]
const K = '([A-Za-z_][A-Za-z0-9_]{0,99})'
const P = '([A-Za-z_][\\w.-]{0,200})' // a dotted path (a `:` starts a default value: `${a.b:x}`)
const PC = '([A-Za-z_][\\w.:-]{0,200})' // .NET's `Section:Key`
const Q = `(['"\`])`
const READS = {
  js: [
    [new RegExp(`\\bprocess\\.env\\.${K}`, 'g'), 1, 'env', 'process.env'],
    [new RegExp(`\\bprocess\\.env\\[\\s*${Q}${K}\\1\\s*\\]`, 'g'), 2, 'env', 'process.env'],
    [new RegExp(`\\bimport\\.meta\\.env\\.${K}`, 'g'), 1, 'env', 'import.meta.env'],
    [new RegExp(`\\bDeno\\.env\\.get\\(\\s*${Q}${K}\\1`, 'g'), 2, 'env', 'Deno.env'],
    [new RegExp(`\\bBun\\.env\\.${K}`, 'g'), 1, 'env', 'Bun.env'],
    [new RegExp(`\\b[\\w$]{0,60}[cC]onfig[\\w$]{0,60}\\s*\\??\\.\\s*get(?:OrThrow)?\\s*(?:<[^<>()\\n]{0,200}>)?\\s*\\(\\s*${Q}${P}\\1`, 'g'), 2, 'auto', 'ConfigService.get'],
    [new RegExp(`\\bConstants\\s*\\.\\s*(?:expoConfig|manifest2?(?:\\s*\\??\\.\\s*extra\\s*\\??\\.\\s*expoClient)?)\\s*\\??\\.\\s*extra\\s*\\??\\.\\s*${K}`, 'g'), 1, 'extra', 'Expo extra'],
  ],
  python: [
    [new RegExp(`\\b(?:os\\.)?environ\\[\\s*${Q}${K}\\1\\s*\\]`, 'g'), 2, 'env', 'os.environ'],
    [new RegExp(`\\b(?:os\\.)?environ\\.(?:get|setdefault|pop)\\(\\s*${Q}${K}\\1`, 'g'), 2, 'env', 'os.environ'],
    [new RegExp(`\\b(?:os\\.)?getenv\\(\\s*${Q}${K}\\1`, 'g'), 2, 'env', 'os.getenv'],
    [new RegExp(`${Q}${K}\\1\\s+(?:not\\s+)?in\\s+(?:os\\.)?environ\\b`, 'g'), 2, 'env', 'os.environ'],
  ],
  go: [
    [new RegExp(`\\bos\\.(?:Getenv|LookupEnv)\\(\\s*"${K}"`, 'g'), 1, 'env', 'os.Getenv'],
    [new RegExp(`\\bviper\\.(?:Get\\w{0,20}|IsSet)\\(\\s*"${P}"`, 'g'), 1, 'auto', 'viper'],
    [new RegExp(`\`[^\`\\n]{0,400}?\\b(?:env|envconfig)\\s*:\\s*"${K}`, 'g'), 1, 'env', 'struct tag'],
  ],
  jvm: [
    [new RegExp(`\\bSystem\\.getenv\\(\\s*"${K}"`, 'g'), 1, 'env', 'System.getenv'],
    [new RegExp(`@Value\\(\\s*"\\\\?\\$\\{${P}(?::[^}"\\n]{0,200})?\\}"`, 'g'), 1, 'auto', '@Value'],
    [new RegExp(`\\b(?:env|environment)\\w{0,40}\\s*\\.\\s*getProperty\\(\\s*"${P}"`, 'gi'), 1, 'auto', 'Environment.getProperty'],
  ],
  ruby: [
    [new RegExp(`\\bENV\\[\\s*${Q}${K}\\1\\s*\\]`, 'g'), 2, 'env', 'ENV'],
    [new RegExp(`\\bENV\\.(?:fetch|key\\?|has_key\\?)\\(\\s*${Q}${K}\\1`, 'g'), 2, 'env', 'ENV'],
  ],
  rust: [
    [new RegExp(`\\b(?:std::)?env::var(?:_os)?\\(\\s*"${K}"`, 'g'), 1, 'env', 'std::env'],
    [new RegExp(`\\b(?:option_)?env!\\(\\s*"${K}"`, 'g'), 1, 'env', 'env!'],
    [new RegExp(`\\bdotenvy?::var\\(\\s*"${K}"`, 'g'), 1, 'env', 'dotenv'],
    [new RegExp(`#\\[\\s*(?:arg|clap|structopt)\\s*\\([^\\]\\n]{0,400}?\\benv\\s*=\\s*"${K}"`, 'g'), 1, 'env', 'clap'],
  ],
  php: [
    [new RegExp(`\\bgetenv\\(\\s*${Q}${K}\\1`, 'g'), 2, 'env', 'getenv'],
    [new RegExp(`\\$_ENV\\[\\s*${Q}${K}\\1`, 'g'), 2, 'env', '$_ENV'],
    [new RegExp(`(?<![>:$\\w])env\\(\\s*${Q}${K}\\1`, 'g'), 2, 'env', 'env()'],
    [new RegExp(`(?<![>:$\\w])config\\(\\s*${Q}${P}\\1`, 'g'), 2, 'auto', 'config()'],
  ],
  csharp: [
    [new RegExp(`\\bEnvironment\\.GetEnvironmentVariable\\(\\s*"${K}"`, 'g'), 1, 'env', 'Environment.GetEnvironmentVariable'],
    [new RegExp(`\\b\\w{0,60}[Cc]onfiguration\\s*\\[\\s*"${PC}"\\s*\\]`, 'g'), 1, 'auto', 'IConfiguration'],
    [new RegExp(`\\.GetValue<[^<>\\n]{1,80}>\\(\\s*"${PC}"`, 'g'), 1, 'auto', 'IConfiguration'],
  ],
  swift: [
    [new RegExp(`\\bProcessInfo\\.processInfo\\.environment\\[\\s*"${K}"\\s*\\]`, 'g'), 1, 'env', 'ProcessInfo'],
  ],
}
const TRIGGER = /env|ENV|Env|onfig|@Value|extra|getenv|environ|BaseSettings|viper|registerAs/

// A code file's reads, declarations and mappings: [{ key, kind, role, srcKey, via, line, src }], src
// the index of the innermost symbol holding the line (-1: the file).
export function configOfCode(lang, family, rel, src, symbols) {
  if (!READS[family] || !TRIGGER.test(src)) return []
  const m = masked(src, family)
  const at = lineAt(src)
  const out = []
  const inner = (line) => { let best = -1; for (let k = 0; k < symbols.length; k++) { const s = symbols[k]; if (s.line <= line && s.endLine >= line && (best < 0 || s.endLine - s.line <= symbols[best].endLine - symbols[best].line)) best = k } return best }
  const reads = [] // { key, kind, via, off }
  const seen = new Set()
  const read = (key, kind, via, off) => {
    if (kind === 'auto') kind = kindOfKey(key)
    if (kind === 'extra') { key = `extra.${key}`; kind = 'config' }
    if (!(kind === 'env' ? ENV_KEY : PATH_KEY).test(key)) return
    const k = `${key}|${off}`
    if (seen.has(k)) return
    seen.add(k)
    reads.push({ key, kind, via, off })
  }
  for (const [re, g, kind, via] of READS[family]) for (const x of m.matchAll(re)) read(x[g], kind, via, x.index)
  if (family === 'js') {
    // `const { A, B: b, C = 1 } = process.env`
    for (const x of m.matchAll(/\{([^{}]{1,2000})\}\s*=\s*process\.env\b/g)) for (const part of x[1].split(',')) { const name = part.trim().split(/[\s:=]/)[0]; if (name) read(name, 'env', 'process.env', x.index) }
  }
  if (family === 'python') {
    if (/\benviron\.Env\b|\bimport environ\b/.test(src)) for (const x of m.matchAll(new RegExp(`\\benv(?:\\.(?:str|bool|int|float|list|tuple|dict|url|db_url|db|cache_url|cache|email_url|search_url|json|path|decimal))?\\(\\s*${Q}${K}\\1`, 'g'))) read(x[2], 'env', 'django-environ', x.index)
    out.push(...pydantic(m, symbols))
  }
  for (const r of reads) { const line = at(r.off); out.push({ key: r.key, kind: r.kind, role: 'read', srcKey: null, via: r.via, line, src: inner(line) }) }
  if (family === 'js') {
    // the leaves of a config object: declared under its namespace, mapped from the env reads in them
    const leavesOf = (open, ns, via) => {
      for (const leaf of objectLeaves(m, open)) {
        const key = [ns, ...leaf.path].filter(Boolean).join('.')
        if (!PATH_KEY.test(key)) continue
        const line = at(leaf.at)
        out.push({ key, kind: 'config', role: 'declare', srcKey: null, via, line, src: inner(line) })
        for (const r of reads) if (r.kind === 'env' && r.off >= leaf.from && r.off < leaf.to) out.push({ key, kind: 'config', role: 'map', srcKey: r.key, via, line: at(r.off), src: inner(at(r.off)) })
      }
    }
    // the object a factory returns: `() => ({ … })`, or the last `return { … }` of `() => { … }`
    const returned = (from) => {
      const f = /^\s*(?:async\s+)?(?:\(\s*\)|function\s*\w*\s*\(\s*\))\s*(?::\s*[\w<>[\]., ]{1,80})?\s*(?:=>)?\s*/.exec(m.slice(from, from + 300))
      if (!f) return -1
      let i = from + f[0].length
      if (m[i] === '(') { i++; while (/\s/.test(m[i] || '')) i++; return m[i] === '{' ? i : -1 }
      if (m[i] !== '{') return -1
      const end = closing(m, i)
      if (end < 0) return -1
      let open = -1
      for (const r of m.slice(i, end).matchAll(/\breturn\s*\(?\s*\{/g)) open = i + r.index + r[0].length - 1
      return open
    }
    for (const x of m.matchAll(/\bregisterAs\s*(?:<[^<>()\n]{0,200}>)?\(\s*(['"])([A-Za-z_][\w-]{0,99})\1\s*,/g)) { const o = returned(x.index + x[0].length); if (o >= 0) leavesOf(o, x[2], 'registerAs') }
    // a Nest config factory, in a config file: `export default () => ({ port: process.env.PORT })`
    if (/config/i.test(rel)) for (const x of m.matchAll(/\bexport\s+default\s+/g)) { const o = returned(x.index + x[0].length); if (o >= 0) leavesOf(o, '', 'config factory') }
    if (/(^|\/)app\.config\.(ts|js|mjs|cjs)$/.test(rel)) for (const x of m.matchAll(/\bextra\s*:\s*\{/g)) leavesOf(x.index + x[0].length - 1, 'extra', 'app.config')
  }
  return out.slice(0, 5000)
}

// pydantic settings: a class deriving from BaseSettings, its annotated fields read from the
// environment by their upper-cased name after env_prefix (`Field(env=…)`, `alias=…` or
// `validation_alias=…` naming another)
function pydantic(m, symbols) {
  const out = []
  const lines = m.split('\n')
  for (let k = 0; k < symbols.length; k++) {
    const s = symbols[k]
    if (s.kind !== 'class') continue
    const head = lines.slice(s.line - 1, s.line + 2).join(' ')
    if (!/^\s*class\s+\w+\s*\([^)]*\bBaseSettings\b/.test(head)) continue
    const body = lines.slice(s.line, s.endLine)
    const first = body.find((l) => l.trim())
    if (!first) continue
    const indent = /^\s*/.exec(first)[0].length
    const prefix = (/\benv_prefix\s*=\s*(['"])([\w-]{0,60})\1/.exec(body.join('\n')) || [])[2] || ''
    body.forEach((l, i) => {
      const f = /^(\s*)([A-Za-z_]\w{0,99})\s*:\s*[^=\s]/.exec(l)
      if (!f || f[1].length !== indent || f[2] === 'model_config') return
      const named = /\b(?:env|validation_alias|alias)\s*=\s*(['"])([A-Za-z_]\w{0,99})\1/.exec(l)
      const key = named ? named[2] : `${prefix}${f[2]}`.toUpperCase()
      if (ENV_KEY.test(key)) out.push({ key, kind: 'env', role: 'read', srcKey: null, via: 'pydantic', line: s.line + 1 + i, src: k })
    })
  }
  return out
}

// ── declarations in files the index does not parse ──
const DECL = [
  // `.env.example`, `.env.local.sample`, `env-example-relational`, `docker.env.template`: never a name
  // with anything after the template word but a dash (`.env.example.local` may be a real copy)
  [/^\.?env(?:[._-]\w+)*?[._-](?:example|sample|template)(?:-[\w-]+)?$|^[\w-]+\.env\.(?:example|sample|template)$/i, 'env template'],
  [/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i, 'compose'],
  [/^\.gitlab-ci\.ya?ml$/i, 'gitlab-ci'],
  [/^app\.json$/, 'app.json'],
  [/^application(-[\w-]+)?\.properties$/, 'application.properties'],
  [/^application(-[\w-]+)?\.ya?ml$/, 'application.yml'],
]
export const DECL_MAX = 1 << 20
// The kind of declaration a file is, or null. A file that may hold credentials is never one, but for
// an env template, whose names (never its values) are read.
export function declKind(rel) {
  const base = path.posix.basename(rel)
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(rel)) return 'workflow'
  for (const [re, kind] of DECL) if (re.test(base)) return kind === 'env template' || !SECRETISH.test(rel) ? kind : null
  return null
}

// The declaration files of a repository's file list (the graph's skips applied).
export function configDeclPaths(rels, project) { return rels.filter((p) => declKind(p) && !skipped(p, project)) }

// YAML read line by line, lexically: [{ line, indent, key, rest, item }]: block scalars' content,
// comments and blank lines skipped. `key` null for a list item without one.
function yamlLines(text) {
  const out = []
  const lines = text.split('\n')
  let block = -1 // the indent of the key a block scalar belongs to: deeper lines are its content
  for (let i = 0; i < lines.length && i < 100_000; i++) {
    const l = lines[i].replace(/\r$/, '')
    if (!l.trim() || /^\s*#/.test(l)) continue
    const indent = /^\s*/.exec(l)[0].length
    if (block >= 0) { if (indent > block) continue; block = -1 }
    if (/^---/.test(l)) { out.push({ line: i + 1, indent: 0, key: null, rest: '', item: false, doc: true }); continue }
    const item = /^(\s*)-\s+(.*)$/.exec(l)
    const body = item ? item[2] : l.trim()
    const kv = /^["']?([A-Za-z_$][\w.$-]{0,200})["']?\s*:(?:\s+(.*)|$)/.exec(body)
    const at = item ? item[1].length + 2 : indent
    out.push({ line: i + 1, indent: at, key: kv ? kv[1] : null, rest: kv ? (kv[2] || '') : body, item: !!item })
    if (kv && /^[|>][-+0-9]*\s*(#.*)?$/.test(kv[2] || '')) block = indent
  }
  return out
}
// the direct children of the entry at k (a mapping's keys, or a list's items)
function childrenOf(ys, k) {
  const out = []
  const base = ys[k].indent
  let level = -1
  for (let j = k + 1; j < ys.length; j++) {
    const y = ys[j]
    if (y.doc || y.indent < base || (y.indent === base && !y.item)) break
    if (level < 0) level = y.indent
    if (y.indent === level) out.push(y)
  }
  return out
}
const placeholders = (s) => [...s.matchAll(/\$\{([A-Za-z_][\w.-]{0,200})(?::[^}]*)?\}/g)].map((x) => x[1])

// A declaration file's names: [{ key, kind, role, srcKey, via, line }]. No value is kept: a line is
// matched for its key only (and a Spring value for its ${placeholders}, which are names).
export function configOfDecl(kind, text) {
  const out = []
  const decl = (key, line, k = 'env') => { if ((k === 'env' ? ENV_KEY : PATH_KEY).test(key)) out.push({ key, kind: k, role: 'declare', srcKey: null, via: kind, line }) }
  if (kind === 'env template') {
    text.split('\n').forEach((l, i) => { const x = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,99})\s*=/.exec(l); if (x) decl(x[1], i + 1) })
    return out
  }
  if (kind === 'app.json') {
    let j = null
    try { j = JSON.parse(text) } catch { return out }
    const extra = j && typeof j === 'object' ? (j.expo && typeof j.expo === 'object' ? j.expo.extra : j.extra) : null
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return out
    const from = Math.max(0, text.indexOf('"extra"'))
    const at = lineAt(text)
    const walk = (o, pre, depth) => {
      for (const k of Object.keys(o).slice(0, 400)) {
        const key = `${pre}.${k}`
        const v = o[k]
        if (v && typeof v === 'object' && !Array.isArray(v) && depth < 4) walk(v, key, depth + 1)
        else { const p = text.indexOf(JSON.stringify(k), from); decl(key, p < 0 ? 1 : at(p), 'config') }
      }
    }
    walk(extra, 'extra', 0)
    return out
  }
  if (kind === 'application.properties') {
    text.split('\n').forEach((l, i) => {
      const x = /^\s*([A-Za-z_][\w.-]{0,200})(?:\[\d+\])?\s*[=:]/.exec(l)
      if (!x || /^\s*[#!]/.test(l)) return
      decl(x[1], i + 1, kindOfKey(x[1]) === 'env' ? 'env' : 'config')
      for (const p of placeholders(l.slice(x[0].length))) if (ENV_NAME.test(p)) out.push({ key: x[1], kind: 'config', role: 'map', srcKey: p, via: kind, line: i + 1 })
    })
    return out
  }
  const ys = yamlLines(text)
  if (kind === 'application.yml') {
    const stack = [] // [indent, key]
    for (const y of ys) {
      if (y.doc) { stack.length = 0; continue }
      if (!y.key || y.item) continue
      while (stack.length && stack[stack.length - 1][0] >= y.indent) stack.pop()
      stack.push([y.indent, y.key])
      if (!y.rest.trim()) continue
      const key = stack.map((s) => s[1]).join('.')
      decl(key, y.line, 'config')
      for (const p of placeholders(y.rest)) if (ENV_NAME.test(p)) out.push({ key, kind: 'config', role: 'map', srcKey: p, via: kind, line: y.line })
    }
    return out
  }
  const section = kind === 'compose' ? 'environment' : kind === 'workflow' ? 'env' : 'variables'
  ys.forEach((y, k) => {
    if (y.key !== section) return
    const inline = /^\[(.*)\]\s*$/.exec(y.rest.trim())
    if (inline) { for (const part of inline[1].split(',')) { const n = /^\s*["']?([A-Za-z_]\w*)/.exec(part); if (n) decl(n[1], y.line) } return }
    if (y.rest.trim()) return // a scalar: `env: ${{ … }}`
    for (const c of childrenOf(ys, k)) {
      if (c.item) { const n = /^["']?([A-Za-z_][A-Za-z0-9_]*)\s*(=|["']?\s*$)/.exec(c.rest); if (n) decl(n[1], c.line) }
      else if (c.key) decl(c.key, c.line)
    }
  })
  return out
}

// ── answers ──
const LISTED = 40, READERS = 25
const where = (g, r) => {
  const n = r.node_id ? g.node(r.node_id) : null
  const inDef = n && n.kind !== 'file' ? `in ${n.qualname}` : r.file_id ? 'at file level' : ''
  return `${g.loc({ repo: r.repo, path: r.path, kind: 'x', line: r.line })}${inDef ? `  ${inDef}` : ''}  ${r.via}${n && n.is_test ? '  test' : ''}`
}
export const hasConfig = (g) => { try { return !!g.one('SELECT 1 FROM config LIMIT 1') } catch { return false } }
export function configRows(g, key, repo = null) {
  return g.q(`SELECT * FROM config WHERE (key = ? OR src_key = ?)${repo ? ' AND repo = ?' : ''} ORDER BY repo, path, line`, key, key, ...(repo ? [repo] : []))
}
// the keys a definition (a file, a type with its members) reads, for graph_impact
export function readsOf(g, hits) {
  const out = []
  const seen = new Set()
  for (const h of hits) {
    const rows = h.kind === 'file'
      ? g.q("SELECT * FROM config WHERE file_id = ? AND role = 'read' ORDER BY line", h.file_id)
      : g.q("SELECT * FROM config WHERE file_id = ? AND role = 'read' AND line BETWEEN ? AND ? ORDER BY line", h.file_id, h.line, h.end_line)
    for (const r of rows) { const k = `${r.key}|${r.line}`; if (!seen.has(k)) { seen.add(k); out.push(r) } }
  }
  return out
}
export function readsLines(g, rows) {
  if (!rows.length) return []
  const keys = [...new Set(rows.map((r) => r.key))]
  return [`Configuration it reads (${keys.length} key(s); graph_config for who else reads them and where they are declared):`,
    ...rows.slice(0, LISTED).map((r) => `  ${r.key}  ${r.kind}  ${g.loc({ repo: r.repo, path: r.path, kind: 'x', line: r.line })}  ${r.via}`),
    ...(rows.length > LISTED ? [`  … ${rows.length - LISTED} more`] : [])]
}

// One key: its readers, declarations, mappings both ways. `keys`: the key's whole closure (the keys it
// feeds and is fed by), for the impact and the mentions.
export function keyAnswer(g, key, repo = null) {
  const rows = configRows(g, key, repo)
  const own = rows.filter((r) => r.key === key)
  if (!own.length && !rows.length) return null
  const kind = (own[0] || {}).kind || (rows.some((r) => r.src_key === key) ? 'env' : kindOfKey(key))
  const out = [`${key}  ${kind === 'env' ? 'environment variable' : 'configuration path'}`]
  const readers = own.filter((r) => r.role === 'read')
  const lst = (title, list, line) => { if (!list.length) return; out.push(`${title} (${list.length}):`); for (const r of list.slice(0, READERS)) out.push(`  ${line(r)}`); if (list.length > READERS) out.push(`  … ${list.length - READERS} more`) }
  lst('Read by', readers, (r) => where(g, r))
  // a namespace read whole (`config.get('auth')`) reads this key too
  const ns = kind === 'config' && key.includes('.') ? key.split('.').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('.')) : []
  const nsReads = ns.flatMap((n) => g.q(`SELECT * FROM config WHERE key = ? AND role = 'read'${repo ? ' AND repo = ?' : ''}`, n, ...(repo ? [repo] : [])))
  lst('Read through its namespace', nsReads, (r) => `${r.key}  ${where(g, r)}`)
  const feeds = rows.filter((r) => r.role === 'map' && r.src_key === key) // X → ns.k
  const fedBy = own.filter((r) => r.role === 'map') // ns.k ← X
  const consumers = []
  if (feeds.length) {
    out.push(`Sets (${new Set(feeds.map((r) => r.key)).size}), where the syntax states it:`)
    for (const k of [...new Set(feeds.map((r) => r.key))]) {
      const f = feeds.find((r) => r.key === k)
      const rd = g.q(`SELECT * FROM config WHERE key = ? AND role = 'read'${repo ? ' AND repo = ?' : ''} ORDER BY repo, path, line`, k, ...(repo ? [repo] : []))
      out.push(`  ${k}  config  ${g.loc({ repo: f.repo, path: f.path, kind: 'x', line: f.line })}  ${f.via}: read by ${rd.length || 'nothing in the index'}`)
      for (const r of rd.slice(0, READERS)) { out.push(`    ${where(g, r)}`); consumers.push(r) }
    }
  }
  if (fedBy.length) {
    out.push(`Set from (${new Set(fedBy.map((r) => r.src_key)).size}):`)
    for (const r of fedBy) {
      const rd = g.q("SELECT count(*) c FROM config WHERE key = ? AND role = 'read'", r.src_key)[0].c
      const dc = g.q("SELECT count(*) c FROM config WHERE key = ? AND role = 'declare'", r.src_key)[0].c
      out.push(`  ${r.src_key}  env  ${g.loc({ repo: r.repo, path: r.path, kind: 'x', line: r.line })}  ${r.via}  (read ${rd}, declared ${dc}: graph_config ${r.src_key})`)
    }
  }
  const decls = own.filter((r) => r.role === 'declare')
  lst('Declared in', decls, (r) => `${g.loc({ repo: r.repo, path: r.path, kind: 'x', line: r.line })}  ${r.via}`)
  if (!decls.length && !fedBy.length) out.push(kind === 'env' ? 'Declared in: nothing the index reads (no env template, compose file, CI workflow or Spring file names it)' : 'Declared in: nothing the index reads')
  if (!readers.length && !nsReads.length && !feeds.length) out.push('Read by: nothing in the index (a script, a container, a tool, a framework reading it by convention or another repository may)')
  return { lines: out, readers: [...readers, ...nsReads, ...consumers], rows: [...rows, ...nsReads] }
}

// The listing: every key (or those matching `query`: a fragment, or a `*` pattern), then the gaps.
export function configList(g, { query = null, kind = null, repo = null, limit = 60 } = {}) {
  const R = repo ? ' AND repo = ?' : '', ra = repo ? [repo] : []
  const all = g.q(`SELECT key, kind, role, src_key, via, repo, path, line FROM config WHERE 1=1${R} ORDER BY key`, ...ra)
  if (!all.length) return 'No configuration key found: no environment read (process.env, os.environ, os.Getenv, System.getenv, ENV, std::env …), no config path read (ConfigService.get, @Value, viper …) and no declaration (.env.example, compose environment, CI env, app.json extra, application.properties) in the indexed repositories.'
  const keys = new Map()
  for (const r of all) {
    if (!keys.has(r.key)) keys.set(r.key, { key: r.key, kind: r.kind, read: [], declare: [], map: [], feeds: new Set() })
    keys.get(r.key)[r.role].push(r)
  }
  for (const r of all) if (r.role === 'map' && r.src_key) { if (!keys.has(r.src_key)) keys.set(r.src_key, { key: r.src_key, kind: 'env', read: [], declare: [], map: [], feeds: new Set() }); keys.get(r.src_key).feeds.add(r.key) }
  // a namespace read covers its keys
  const nsRead = new Set([...keys.values()].filter((k) => k.kind === 'config' && k.read.length).map((k) => k.key))
  const coveredByNs = (k) => k.key.split('.').slice(0, -1).some((_, i, a) => nsRead.has(a.slice(0, i + 1).join('.')))
  let list = [...keys.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  if (kind) list = list.filter((k) => k.kind === kind)
  if (query) {
    const q = String(query)
    const re = q.includes('*') ? new RegExp(`^${q.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i') : null
    list = list.filter((k) => (re ? re.test(k.key) : k.key.toLowerCase().includes(q.toLowerCase())))
    if (!list.length) return `No configuration key matches "${q}" (${keys.size} known: graph_config with no key lists them).`
  }
  const envN = list.filter((k) => k.kind === 'env').length
  const out = [`Configuration keys (${list.length}: ${envN} environment variable(s), ${list.length - envN} config path(s)), read in code and declared in env templates, compose files, CI workflows and app config; names only, never a value:`]
  const decl = (k) => { const v = [...new Set(k.declare.map((d) => d.via))]; return v.length ? ` · declared ${k.declare.length} (${v.join(', ')})` : '' }
  for (const k of list.slice(0, limit)) {
    const fed = [...new Set(k.map.map((r) => r.src_key))]
    out.push(`  ${k.key}  ${k.kind}  read ${k.read.length}${decl(k)}${k.feeds.size ? ` · sets ${[...k.feeds].join(', ')}` : ''}${fed.length ? ` · set from ${fed.join(', ')}` : ''}`)
  }
  if (list.length > limit) out.push(`  … ${list.length - limit} more (narrow with a fragment or a * pattern)`)
  // the gaps
  const undeclared = list.filter((k) => k.read.length && !k.declare.length && !k.map.length)
  const unread = list.filter((k) => !k.read.length && !k.feeds.size && (k.declare.length || k.map.length) && !coveredByNs(k))
  const show = (title, xs, line) => { if (!xs.length) return; out.push(title); for (const k of xs.slice(0, LISTED)) out.push(`  ${line(k)}`); if (xs.length > LISTED) out.push(`  … ${xs.length - LISTED} more`) }
  show(`Read but declared nowhere the index reads (${undeclared.length}): the code needs it and no template, compose file or workflow names it`, undeclared, (k) => `${k.key}  ${k.kind}  ${g.loc({ repo: k.read[0].repo, path: k.read[0].path, kind: 'x', line: k.read[0].line })}${k.read.length > 1 ? ` (+${k.read.length - 1})` : ''}`)
  show(`Declared but read nowhere in the index (${unread.length}): a script, a container, a tool or another repository may read it`, unread, (k) => { const d = k.declare[0] || k.map[0]; return `${k.key}  ${k.kind}  ${g.loc({ repo: d.repo, path: d.path, kind: 'x', line: d.line })}  ${d.via}` })
  return out.join('\n')
}

export function configAnswer(g, { key = null, kind = null, repo = null, limit = 60 } = {}) {
  const k = key ? String(key).trim() : ''
  if (k && !k.includes('*')) {
    const a = keyAnswer(g, k, repo)
    if (a) return a.lines.join('\n')
    // a key named differently in case (`auth.Secret`), or a fragment
  }
  return configList(g, { query: k || null, kind, repo, limit: Math.max(1, Math.min(Number(limit) || 60, 400)) })
}

// The lines of the config index naming one of these keys: a mention there is explained.
export function explainedLines(g, terms) {
  if (!terms.length) return new Set()
  try {
    const ph = terms.map(() => '?').join(',')
    return new Set(g.q(`SELECT repo, path, line FROM config WHERE key IN (${ph}) OR src_key IN (${ph})`, ...terms, ...terms).map((r) => `${r.repo}|${r.path}|${r.line}`))
  } catch { return new Set() }
}
