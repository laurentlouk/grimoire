// grimoire graph · routes, at index time: one parsed file → the routes it declares and the places it
// names one. Two kinds:
//   http     a method + a path template → a handler (Express, Koa, Hono, Fastify, NestJS, Next.js
//            route files and pages/api, Expo API routes, FastAPI, Flask, Django urls.py, Spring,
//            Go net/http, gin, echo, chi, gorilla/mux, Rails config/routes.rb)
//   screen   an app's navigation route → its screen (Expo Router files, React Navigation screens)
// A declaration's path is kept as written (a route path template is no secret), its prefixes as the
// syntax states them: a router created in the file, a group, a mount (`app.use('/api', r)`,
// `include_router(x, prefix=…)`, `r.Group("/api")` passed to a function) is recorded here and
// composed per repository in route-graph.mjs; a prefix the code computes is `{…}`, never guessed.
//
// A call site naming a route (a string that is a URL path: `'/users/me'`, `` `/a/${id}` ``,
// `'/a/' + slug`, a `{ pathname }`, a screen's name given to `navigate`) is kept as a ref whose
// literal segments are hashed (sha1, 12 hex digits): the index never holds a literal that is not a
// route's own path, so matching compares hashes, and an answer shows the route's template, never
// the call's text. A query string, a fragment, a scheme and a host are dropped before anything is
// read; a part the code fills in is one unknown segment, a leading one an unknown prefix.
import { createHash } from 'node:crypto'
import path from 'node:path'
import { familyOf } from './langs.mjs'

export const UNKNOWN = '{…}'
const MAX_REFS = 2000, MAX_ROUTES = 2000
export const hashSeg = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12)

const named = (n) => { const out = []; for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i)); return out }
const field = (n, f) => (n ? n.childForFieldName(f) : null)
const line = (n) => n.startPosition.row + 1
const hasToken = (n, tok) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (!c.isNamed && c.type === tok) return true } return false }

// ── literals ──
const STRINGS_LIST = () => [...STRINGS]
const STRINGS = new Set(['string', 'template_string', 'interpreted_string_literal', 'raw_string_literal', 'string_literal', 'line_string_literal', 'verbatim_string_literal', 'interpolated_string_expression', 'encapsed_string'])
const INTERP = /interpolat|substitution/
// a string node's content, each part the code fills in as \0; null when the node is no string
export function strContent(n) {
  if (!n || !STRINGS.has(n.type)) return null
  const src = n.text, from = n.startIndex
  let out = '', at = 0
  const visit = (p) => { for (const c of named(p)) { if (INTERP.test(c.type)) { out += src.slice(at, c.startIndex - from) + '\0'; at = c.endIndex - from } else if (!/^string_(fragment|content)$/.test(c.type)) visit(c) } }
  visit(n)
  out += src.slice(at)
  // strip the delimiters: a prefix (f, r, b, @, $), then the quotes
  const m = /^([A-Za-z@$]{0,3})("""|'''|"|'|`)/.exec(out)
  if (m) { out = out.slice(m[0].length); if (out.endsWith(m[2])) out = out.slice(0, -m[2].length) }
  return { text: out, dyn: out.includes('\0') }
}
// A literal's text when nothing in it is filled in by code (declarations); else null
const lit = (n) => { const c = strContent(n); return c && !c.dyn ? c.text : null }
// A path as a declaration states it: a literal, a template or a concatenation with `{…}` for what
// code fills in; anything else (a constant, a call) is `{…}` whole
function pathOf(n) {
  if (!n) return UNKNOWN
  const c = strContent(n)
  if (c) return c.text.replace(/\0+/g, UNKNOWN)
  if (n.type === 'binary_expression' || n.type === 'binary_operator') { const parts = concat(n); if (parts) return parts.map((p) => (p === null ? UNKNOWN : p)).join('') }
  return UNKNOWN
}
// a `+` concatenation's operands, left to right: a string's text, null for anything else; null
// when the node is no concatenation holding a string
function concat(n) {
  if (!(n.type === 'binary_expression' || n.type === 'binary_operator') || !hasToken(n, '+')) return null
  const out = []
  const flat = (x) => {
    if ((x.type === 'binary_expression' || x.type === 'binary_operator') && hasToken(x, '+')) { flat(field(x, 'left') || x.namedChild(0)); flat(field(x, 'right') || x.namedChild(1)); return }
    if (x.type === 'parenthesized_expression' && x.namedChildCount === 1) return flat(x.namedChild(0))
    const c = strContent(x)
    out.push(c ? c.text : null)
  }
  flat(n)
  return out.some((p) => typeof p === 'string') ? out : null
}

// ── a URL path as code names it → hashed tokens ──
// text: the literal's content, \0 for each part code fills in. inCall: the string is a client call's
// URL argument (a path without a leading slash is then relative to a base: an unknown prefix).
const URL_CHARS = /^[A-Za-z0-9\-._~!$&'()*+,;=:@%[\]{}\0/]*$/
export function urlPattern(text, { inCall = false } = {}) {
  if (!text || text.length > 400) return null
  let s = text
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/.exec(s)
  if (scheme) { if (!/^https?:/i.test(s) && !/^\0/.test(s)) return null; s = s.slice(scheme[0].length) || '/' }
  const cut = s.search(/[?#]/)
  if (cut >= 0) s = s.slice(0, cut)
  let lead = false
  if (s.startsWith('\0')) { lead = true; s = s.replace(/^\0+/, '') }
  if (!s.startsWith('/')) {
    // a path relative to a client's base URL (`api.get('users/me')`): only as a call's URL argument
    if (lead || scheme || !inCall || !s.includes('/')) return null
    lead = true
  }
  if (!URL_CHARS.test(s) || s.includes('//') || s.includes('..') || s.startsWith('/*')) return null
  const segs = s.split('/').filter(Boolean)
  if (!segs.length || segs.length > 16) return null
  const toks = []
  let lits = 0
  for (const g of segs) {
    if (g.length > 100) return null
    if (g.includes('\0') || /^(:[\w-]+\??|\{[^}]*\}|\[[^\]]*\]|<[^>]*>|\*)$/.test(g) || /%[a-zA-Z]/.test(g)) toks.push('*')
    else { if (/\p{L}/u.test(g)) lits++; toks.push(hashSeg(g)) }
  }
  if (!lits) return null
  return { toks, lead }
}
// A screen's name given to navigation (React Navigation): `Profile`, `user-detail`
const SCREEN_NAME = /^[A-Za-z][\w-]{0,80}$/

// ── per-family vocabulary ──
const HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const VERB_OF = (name) => { const l = String(name || '').toLowerCase(); return l === 'del' ? 'DELETE' : HTTP_VERBS.includes(l) ? l.toUpperCase() : null }
const JS_SERVER = /^(express|koa|@koa\/router|koa-router|hono|hono\/.+|fastify|polka|restify|elysia|@hono\/.+|router)$/
const JS_ROUTE_VERBS = new Set([...HTTP_VERBS, 'del', 'all'])
const JS_HANDLERISH = new Set(['identifier', 'member_expression', 'arrow_function', 'function_expression', 'function', 'call_expression'])
const GO_SERVER = /(gin-gonic\/gin|labstack\/echo|go-chi\/chi|gorilla\/mux|gofiber\/fiber|^net\/http$)/
const GO_ROUTE = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'Any', 'Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'Connect', 'Trace', 'Handle', 'HandleFunc', 'Method', 'MethodFunc', 'Match'])
const GO_HANDLERISH = new Set(['identifier', 'selector_expression', 'func_literal', 'call_expression'])
const NAV_RECV = /(^|[^a-z])(router|navigation|navigator|nav|navigationRef|navRef)$|useRouter\(\)|useNavigation\(\)/i
const NAV_CALLS = new Set(['push', 'replace', 'navigate', 'prefetch', 'dismissTo', 'jumpTo', 'reset', 'popTo'])
const FETCHES = new Set(['fetch', '$fetch', 'ofetch', 'useFetch', 'request', 'ky', 'got', 'superagent', 'axios'])
const NEXT_FILES = /^(page|layout|loading|error|not-found|template|default|global-error|head|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)$/
const SCREEN_PLATFORM = /\.(web|ios|android|native)$/
const SCANNED = new Set([...STRINGS_LIST(), 'call_expression', 'call', 'method_invocation', 'jsx_self_closing_element', 'jsx_opening_element', 'binary_expression', 'binary_operator'])
const SKIP = new Set(['import_statement', 'import_declaration', 'import_from_statement', 'import_spec_list', 'import_spec', 'comment', 'line_comment', 'block_comment'])
// what a walk of strings alone visits (a file gateOf finds no keyword in)
const CALLS = new Set(['call_expression', 'call', 'method_invocation'])
const SCAN_ONLY = [...STRINGS_LIST(), 'binary_expression', 'binary_operator', ...CALLS, ...SKIP]

// The callee of a call: { name, recv: receiver node | null }
const calleeMemo = new WeakMap()
function callee(n) {
  if (calleeMemo.has(n)) return calleeMemo.get(n)
  const c = calleeOf(n)
  calleeMemo.set(n, c)
  return c
}
function calleeOf(n) {
  if (n.type === 'call' && field(n, 'method')) return { name: field(n, 'method').text, recv: field(n, 'receiver') } // Ruby
  const f = field(n, 'function') || (n.type === 'method_invocation' ? n : null)
  if (!f) return null
  if (n.type === 'method_invocation') return { name: field(n, 'name')?.text, recv: field(n, 'object') }
  if (f.type === 'identifier') return { name: f.text, recv: null }
  if (f.type === 'member_expression') return { name: field(f, 'property')?.text, recv: field(f, 'object') }
  if (f.type === 'attribute') return { name: field(f, 'attribute')?.text, recv: field(f, 'object') }
  if (f.type === 'selector_expression') return { name: field(f, 'field')?.text, recv: field(f, 'operand') }
  return { name: null, recv: null }
}
const argsOf = (n) => { const a = field(n, 'arguments'); return a ? named(a).filter((x) => !/comment/.test(x.type)) : [] }
const kwarg = (args, k) => { const a = args.find((x) => x.type === 'keyword_argument' && field(x, 'name')?.text === k); return a ? field(a, 'value') : null }
const positional = (args) => args.filter((x) => x.type !== 'keyword_argument' && x.type !== 'list_splat' && x.type !== 'dictionary_splat')
const pairVal = (obj, k) => { if (!obj) return null; for (const p of named(obj)) if (p.type === 'pair' && (field(p, 'key')?.text === k || lit(field(p, 'key')) === k)) return field(p, 'value'); return null }
// a middleware or handler as named in code: an identifier, a member path, a call by its callee
function nameText(n) {
  if (!n) return null
  if (/^(identifier|property_identifier|field_identifier|constant|type_identifier)$/.test(n.type)) return n.text
  if (/^(member_expression|attribute|selector_expression|field_access|scoped_identifier|scope_resolution)$/.test(n.type) && /^[\p{L}\p{N}_$.:]+$/u.test(n.text.replace(/\s+/g, ''))) return n.text.replace(/\s+/g, '').slice(0, 80)
  if (/^(call_expression|call|method_invocation)$/.test(n.type)) { const c = field(n, 'function'); const t = nameText(c || field(n, 'name')); return t ? `${t}(…)` : null }
  if (n.type === 'list' || n.type === 'array') return null
  return null
}
// `Depends(x)` → x, `require('./a')` never
const handlerRef = (n) => {
  if (!n) return null
  if (/^(identifier|constant)$/.test(n.type)) return { name: n.text, qual: '' }
  if (/^(member_expression|attribute|selector_expression|field_access)$/.test(n.type)) {
    const t = n.text.replace(/\s+/g, '')
    if (!/^[\p{L}\p{N}_$.]+$/u.test(t)) return null
    const i = t.lastIndexOf('.')
    return { name: t.slice(i + 1), qual: t.slice(0, i) }
  }
  if (/^(call_expression|call)$/.test(n.type)) {
    const c = callee(n)
    // `asyncHandler(fn)`, `X.as_view()`: the function or class it wraps
    if (c && c.name === 'as_view' && c.recv) return handlerRef(c.recv)
    const a = positional(argsOf(n))
    if (a.length === 1 && /^(identifier|member_expression|attribute)$/.test(a[0].type)) return handlerRef(a[0])
  }
  return null
}

// ── the walk ──
// Scopes: the file (id 0) and each function; a router variable is `v:<scope>:<name>`, a function's
// parameter `p:<line of the function>:<index>`, a name the file imports `i:<name>`, anything else
// `g:<name>` (a global, or a value of unknown origin).
const FN = {
  js: new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'function', 'generator_function_declaration']),
  python: new Set(['function_definition', 'lambda']),
  go: new Set(['function_declaration', 'method_declaration', 'func_literal']),
}
function paramNames(fn) {
  const ps = field(fn, 'parameters') || (fn.type === 'arrow_function' ? field(fn, 'parameter') : null)
  if (!ps) return []
  if (ps.type === 'identifier') return [ps.text]
  return named(ps).filter((p) => !/comment/.test(p.type)).map((p) => {
    if (p.type === 'identifier') return p.text
    const f = field(p, 'pattern') || field(p, 'name') || field(p, 'left')
    if (f && f.type === 'identifier') return f.text
    const id = named(p).find((c) => c.type === 'identifier')
    return id ? id.text : null
  })
}
const paramType = (fn, i) => { const ps = field(fn, 'parameters'); const p = ps ? named(ps).filter((x) => !/comment/.test(x.type))[i] : null; return p ? (field(p, 'type')?.text || '') : '' }
const ROUTER_TYPE = /\b(gin\.(Engine|RouterGroup|IRouter|IRoutes)|echo\.(Echo|Group)|chi\.(Router|Mux)|mux\.Router|http\.ServeMux|fiber\.(App|Router)|Router|Express|Application|FastifyInstance|Hono|APIRouter|FastAPI|Flask|Blueprint)\b/

// A cheap look at a file's text before its tree is walked: false when the walk can find nothing (no
// declaration, mount or router of its family, no string holding a `/` outside an import, no screen
// named to navigation). Conservative: a file it passes may still hold nothing.
// what a string's opening quote follows when the string is an import's path (never a call site)
const IMPORT_BEFORE = /(?:\bfrom\s*|\b(?:require|require_relative|import|load|include)\s*\(?\s*|\bjest\.(?:mock|requireActual)\(\s*)$/
const IMPORT_LINE = { go: /^\s*(?:import\s+)?(?:[\w.]+\s+)?"[^"\n]*"\s*$/, c: /^\s*#\s*(?:include|import)\b/ }
// a string a call site's URL can be: its text up to its first `/` is a scheme, URL characters or what
// code fills in (`{…}`, `${…}`); a string with a space before its first slash (prose) is none
const SLASH_STRING = /['"](?:[A-Za-z0-9\-._~!$&()*+,;=:@%[\]]|\{[^}\n]*\})*\/|`(?:[^`\s\\]|\\.|\$\{[^}\n]*\})*\//g
const WALK_WORDS = {
  js: [/\b(?:Hono|Elysia|OpenAPIHono|Router|KoaRouter|express|koa|fastify|polka|restify|basePath|setGlobalPrefix|Controller|navigate|jumpTo)\b|['"]router['"]|<\s*(?:[\w$]+\s*\.\s*)*Screen\b|\bscreen\s*=|create\w*Navigator|module\.exports\s*=|export\s+default\s+[\w$\u0080-￿]+\s*(?:;|$)/m,
    /\b(?:app|router|server|fastify|routes)\s*\??\.\s*(?:get|post|put|patch|delete|del|all|head|options|route|use|register)\s*\(|(?:router|navigation|navigator|nav|navigationref|navref|\))\s*\??\.\s*(?:push|replace|navigate|prefetch|dismissto|jumpto|reset|popto)\b/i],
  python: [/@[\w.]+\.(?:get|post|put|patch|delete|head|options|route|api_route)\b|\b(?:FastAPI|Flask|Quart|Sanic|Starlette|APIRouter|Blueprint|DefaultRouter|SimpleRouter|include_router|register_blueprint|mount|add_url_rule|add_api_route|ROOT_URLCONF|basePath)\b/],
  go: [/gin-gonic|labstack\/echo|go-chi|gorilla\/mux|gofiber|net\/http|\b(?:Group|PathPrefix|Subrouter|With|Methods|HandleFunc|Handle|Mount|Route|Use)\s*\(|\b(?:gin|echo|chi|mux|fiber|http)\.|Router|Express|Application|FastifyInstance|Hono|APIRouter|FastAPI|Flask|Blueprint/],
  jvm: [/@(?:RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b/],
}
// 2: a keyword of its family (the walk reads declarations and call sites), 1: only a string with a
// slash (the walk reads its strings alone: with no keyword, no declaration can be there), 0: nothing
function gateOf(lang, relPath, text) {
  const family = familyOf(lang)
  if (WALK_WORDS[family] && WALK_WORDS[family].some((re) => re.test(text))) return 2
  if (family === 'python' && path.posix.basename(relPath) === 'urls.py') return 2
  // a string with a slash that is no import's path
  const re = new RegExp(SLASH_STRING.source, 'g'), line = IMPORT_LINE[family]
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index
    if (IMPORT_BEFORE.test(text.slice(Math.max(0, at - 40), at))) continue
    if (line) { const from = text.lastIndexOf('\n', at) + 1, to = text.indexOf('\n', at); if (line.test(text.slice(from, to < 0 ? text.length : to))) continue }
    return 1
  }
  return 0
}
export const mayHoldRoutes = (lang, relPath, text) => gateOf(lang, relPath, text) > 0

// src: the file's text, when the caller has it: a file gateOf rules out is not walked, and one holding
// only strings with a slash has its strings read alone.
export function extractRoutes(tree, lang, relPath, { symbols = [], imports = [] } = {}, src = null) {
  const family = familyOf(lang)
  const out = { routes: [], scopes: [], mounts: [], refs: [], meta: {} }
  const consumed = new Set() // string nodes a declaration reads: never a call site
  const fileBase = path.posix.basename(relPath).replace(/\.[^.]+$/, '')
  const importSources = imports.map((i) => i.source)
  const imported = new Set(imports.flatMap((i) => [...(i.names || []).map((n) => String(n).split('=')[0]), i.alias].filter(Boolean)))
  const serverFile = family === 'js' ? importSources.some((s) => JS_SERVER.test(s)) : family === 'go' ? importSources.some((s) => GO_SERVER.test(s) && !/^net\/http$/.test(s)) || importSources.includes('net/http') : false
  const echoFile = family === 'go' && importSources.some((s) => /labstack\/echo/.test(s))
  const isRoutesRb = family === 'ruby' && /(^|\/)config\/routes(\.rb$|\/[^/]+\.rb$)/.test(relPath)
  const isUrlsPy = family === 'python' && fileBase === 'urls'

  // the innermost callable symbol holding a line (a ref's source), else -1 (the file)
  const srcAt = (ln) => {
    let best = -1
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.line <= ln && s.endLine >= ln && (best < 0 || s.endLine - s.line < symbols[best].endLine - symbols[best].line)) best = i
    }
    return best
  }
  // a route on a router of this file also runs the middleware that router (and the groups it is
  // made from) registered before it with `use` / `Use`, as Express and gin apply them in order
  const usesOf = (key) => { const out2 = []; for (let k = key, d = 0; k && d < 8; d++) { const s = out.scopes.find((x) => x.key === k); if (!s) break; out2.unshift(...s.uses); k = s.parent } return out2 }
  const addRoute = (r) => { if (out.routes.length < MAX_ROUTES) out.routes.push({ kind: 'http', handler: null, handlerLine: null, router: null, ...r, middleware: [...new Set([...(r.router ? usesOf(r.router) : []), ...(r.middleware || [])])] }) }

  // file-based routes first (the path is the file's)
  fileRoutes(tree, lang, relPath, out, addRoute)

  if (isRoutesRb) { railsRoutes(tree.rootNode, addRoute, consumed); return finish(out) }
  const gate = src === null ? 2 : gateOf(lang, relPath, src)
  if (!gate) return finish(out)
  const stringsOnly = gate === 1

  let scopeSeq = 0
  const root = { id: 0, vars: new Map(), params: [], line: 0, parent: null, node: tree.rootNode }
  const lookup = (name, sc) => {
    for (let s = sc; s; s = s.parent) {
      if (s.vars.has(name)) return s.vars.get(name)
      const i = s.params.indexOf(name)
      if (i >= 0) return `p:${s.line}:${i}`
    }
    return imported.has(name) ? `i:${name}` : `g:${name}`
  }
  const scopeOf = (key) => out.scopes.find((s) => s.key === key)
  const isRouterKey = (key) => !!scopeOf(key)
  // the router a receiver expression stands for: { key, prefix (a chain's own path), mw }
  const recvRouter = (n, sc) => {
    if (!n) return null
    if (n.type === 'identifier') return { key: lookup(n.text, sc), prefix: '', mw: [] }
    if (n.type === 'member_expression' || n.type === 'attribute' || n.type === 'selector_expression') return { key: `g:${n.text.replace(/\s+/g, '')}`, prefix: '', mw: [] }
    if (n.type === 'call_expression' || n.type === 'call') {
      const c = callee(n)
      if (!c || !c.recv) return null
      const base = recvRouter(c.recv, sc)
      if (!base) return null
      const a = argsOf(n)
      if (c.name === 'route' && a.length === 1 && strContent(a[0])) { consumed.add(a[0].id); return { ...base, prefix: base.prefix + pathOf(a[0]), chain: true } } // Express `.route('/x')`
      if (JS_ROUTE_VERBS.has(c.name) && base.chain) return base // `.route('/x').get(h).post(h2)`
      if (c.name === 'With' && family === 'go') return { ...base, mw: [...base.mw, ...a.map(nameText).filter(Boolean)] } // chi `r.With(mw).Get(…)`
      return null
    }
    return null
  }
  // A router created by an expression: a scope record, or null
  const routerExpr = (n, sc) => {
    if (!n) return null
    if (n.type === 'await_expression' || n.type === 'parenthesized_expression') return routerExpr(n.namedChild(0), sc)
    if (n.type === 'new_expression') {
      const ctor = field(n, 'constructor')?.text
      const a = argsOf(n)
      if (/^(Hono|Elysia|OpenAPIHono)$/.test(ctor)) return { factory: 'app', prefix: '' }
      if (/^(Router|KoaRouter)$/.test(ctor)) { const pre = pairVal(a[0], 'prefix'); if (pre) consumed.add(pre.id); return { factory: 'router', prefix: pre ? pathOf(pre) : '' } }
      return null
    }
    if (!/^(call_expression|call)$/.test(n.type)) return null
    const c = callee(n)
    if (!c || !c.name) return null
    const a = argsOf(n)
    const recvText = c.recv ? c.recv.text : ''
    if (family === 'js') {
      if (!c.recv && /^(express|fastify|Fastify|polka|restify)$/.test(c.name)) return { factory: 'app', prefix: '' }
      if ((c.name === 'Router' && (!c.recv || /^(express|koa)$/i.test(recvText)))) { const pre = pairVal(a[0], 'prefix'); if (pre) consumed.add(pre.id); return { factory: 'router', prefix: pre ? pathOf(pre) : '' } }
      if (c.name === 'basePath' && c.recv && a[0] && strContent(a[0])) { consumed.add(a[0].id); const r = recvRouter(c.recv, sc); return r ? { parent: r.key, prefix: pathOf(a[0]) } : null }
      return null
    }
    if (family === 'python') {
      if (/^(FastAPI|Flask|Quart|Sanic|Starlette)$/.test(c.name)) return { factory: 'app', prefix: '' }
      if (c.name === 'APIRouter') { const p = kwarg(a, 'prefix'); if (p) consumed.add(p.id); return { factory: 'router', prefix: p ? pathOf(p) : '' } }
      if (c.name === 'Blueprint') { const p = kwarg(a, 'url_prefix'); if (p) consumed.add(p.id); return { factory: 'router', prefix: p ? pathOf(p) : '' } }
      if (/^(DefaultRouter|SimpleRouter)$/.test(c.name)) return { factory: 'router', prefix: '', drf: true }
      return null
    }
    if (family === 'go') {
      if (/^(gin\.(Default|New)|echo\.New|chi\.(NewRouter|NewMux)|mux\.NewRouter|http\.NewServeMux|fiber\.New)$/.test(`${recvText}.${c.name}`)) return { factory: 'app', prefix: '' }
      if ((c.name === 'Group' || c.name === 'PathPrefix') && c.recv && a[0] && strContent(a[0])) {
        consumed.add(a[0].id)
        const r = recvRouter(c.recv, sc)
        return r ? { parent: r.key, prefix: r.prefix + pathOf(a[0]), uses: a.slice(1).map(nameText).filter(Boolean) } : null
      }
      if (c.name === 'Subrouter' && c.recv) return routerExpr(c.recv, sc)
      if (c.name === 'With' && c.recv) { const r = recvRouter(c.recv, sc); return r ? { parent: r.key, prefix: '', uses: a.map(nameText).filter(Boolean) } : null }
      return null
    }
    return null
  }
  const declareVar = (name, n, sc, at) => {
    const r = routerExpr(n, sc)
    if (!r) return
    const key = `v:${sc.id}:${name}`
    sc.vars.set(name, key)
    out.scopes.push({ key, parent: r.parent || null, prefix: r.prefix || '', factory: r.factory || null, line: at, uses: r.uses || [], ...(r.drf ? { drf: true } : {}) })
  }
  // an anonymous router (`r.Group("/x")` passed as an argument): a scope of its own
  const anonRouter = (n, sc) => {
    const r = routerExpr(n, sc)
    if (!r) return null
    const key = `a:${n.startIndex}`
    out.scopes.push({ key, parent: r.parent || null, prefix: r.prefix || '', factory: r.factory || null, line: line(n), uses: r.uses || [] })
    return key
  }

  const walk = (n, sc) => {
    const t = n.type
    if (SKIP.has(t)) return
    let inner = sc
    if (FN[family] && FN[family].has(t)) {
      inner = { id: ++scopeSeq, vars: new Map(), params: paramNames(n).map((x) => x || ''), line: line(n), parent: sc, node: n }
    }
    // declarations of router variables
    if (family === 'js' && t === 'variable_declarator' && field(n, 'name')?.type === 'identifier') declareVar(field(n, 'name').text, field(n, 'value'), sc, line(n))
    else if (family === 'js' && t === 'assignment_expression' && field(n, 'left')?.type === 'identifier') declareVar(field(n, 'left').text, field(n, 'right'), sc, line(n))
    else if (family === 'python' && t === 'assignment' && field(n, 'left')?.type === 'identifier') {
      declareVar(field(n, 'left').text, field(n, 'right'), sc, line(n))
      if (field(n, 'left').text === 'ROOT_URLCONF' && lit(field(n, 'right'))) out.meta.rootUrlconf = lit(field(n, 'right')) // Django settings: the URLconf served at /
    }
    else if (family === 'go' && (t === 'short_var_declaration' || t === 'assignment_statement' || t === 'var_spec')) {
      const ls = t === 'var_spec' ? [field(n, 'name')] : named(field(n, 'left') || n)
      const rs = t === 'var_spec' ? named(field(n, 'value') || n) : named(field(n, 'right') || n)
      ls.forEach((l, i) => { if (l && l.type === 'identifier' && rs[i]) declareVar(l.text, rs[i], sc, line(n)) })
    }
    // `export default router`, `module.exports = router`: the router another file mounts by default
    if (family === 'js' && t === 'export_statement' && hasToken(n, 'default') && field(n, 'value')?.type === 'identifier') out.meta.defaultExport = lookup(field(n, 'value').text, sc)
    if (family === 'js' && t === 'assignment_expression' && field(n, 'left')?.text === 'module.exports' && field(n, 'right')?.type === 'identifier') out.meta.defaultExport = lookup(field(n, 'right').text, sc)

    if (family === 'js' && t === 'call_expression') jsCall(n, sc)
    else if (family === 'python' && t === 'decorated_definition') pyDecorated(n, sc)
    else if (family === 'python' && t === 'call') pyCall(n, sc)
    else if (family === 'go' && t === 'call_expression') goCall(n, sc, inner)
    else if (family === 'jvm' && t === 'class_declaration') springClass(n)
    else if (family === 'js' && (t === 'class_declaration' || t === 'abstract_class_declaration')) nestClass(n)
    else if (family === 'js' && (t === 'jsx_self_closing_element' || t === 'jsx_opening_element')) jsxElement(n)
    if (scanNode(n, t)) return
    for (let i = 0, k = n.namedChildCount; i < k; i++) walk(n.namedChild(i), inner)
  }

  // ── JavaScript / TypeScript ──
  const jsCall = (n, sc) => {
    const c = callee(n)
    if (!c || !c.name) return
    const a = argsOf(n)
    if (/^create\w*Navigator$/.test(c.name) && a[0]?.type === 'object') return navigatorConfig(a[0])
    if (c.name === 'setGlobalPrefix' && a[0]) { out.meta.globalPrefix = pathOf(a[0]); if (strContent(a[0])) consumed.add(a[0].id); return }
    if (!c.recv) return callMounts(n, sc, a, c)
    const r = recvRouter(c.recv, sc)
    if (!r) return callMounts(n, sc, a, c)
    const routerish = isRouterKey(r.key) || serverFile || /^(app|router|server|fastify|routes)$/i.test(c.recv.text)
    // Fastify's object form: `fastify.route({ method, url, handler })`
    if (c.name === 'route' && a.length === 1 && a[0].type === 'object' && routerish) {
      const url = pairVal(a[0], 'url') || pairVal(a[0], 'path'), m = pairVal(a[0], 'method'), h = pairVal(a[0], 'handler')
      if (!url || !h) return
      consumed.add(url.id)
      const methods = m ? (m.type === 'array' ? named(m).map(lit) : [lit(m)]).filter(Boolean).map((x) => x.toUpperCase()) : ['ANY']
      if (m) for (const x of m.type === 'array' ? named(m) : [m]) consumed.add(x.id)
      addRoute({ method: methods.join(','), path: r.prefix + pathOf(url), router: r.key, framework: 'fastify', handler: handlerRef(h), middleware: [pairVal(a[0], 'preHandler'), pairVal(a[0], 'onRequest')].filter(Boolean).flatMap((x) => (x.type === 'array' ? named(x) : [x])).map(nameText).filter(Boolean), line: line(n) })
      return
    }
    // mounts: `app.use('/api', router)`, Hono's `app.route('/x', sub)`, Fastify's `register(plugin, { prefix })`
    if ((c.name === 'use' || (c.name === 'route' && a.length === 2)) && a.length >= 2 && strContent(a[0]) && routerish) {
      consumed.add(a[0].id)
      const prefix = pathOf(a[0])
      for (const x of a.slice(1)) { const ch = childRef(x, sc); if (ch) out.mounts.push({ parent: r.key, prefix: r.prefix + prefix, child: ch, line: line(n) }) }
      return
    }
    if (c.name === 'use' && a.length >= 1 && isRouterKey(r.key)) {
      for (const x of a) { const ch = childRef(x, sc); if (ch && ch.var && isRouterKey(ch.var)) out.mounts.push({ parent: r.key, prefix: r.prefix, child: ch, line: line(n) }); else { const nm = nameText(x); if (nm) scopeOf(r.key).uses.push(nm) } }
      return
    }
    if (c.name === 'register' && a.length >= 1 && routerish) {
      const pre = pairVal(a[1], 'prefix')
      if (pre && strContent(pre)) consumed.add(pre.id)
      const ch = childRef(a[0], sc, true)
      if (ch) out.mounts.push({ parent: r.key, prefix: r.prefix + (pre ? pathOf(pre) : ''), child: ch, line: line(n) })
      return
    }
    if (!JS_ROUTE_VERBS.has(c.name)) return callMounts(n, sc, a, c)
    // a route: `router.get('/x', mw…, handler)`, or a `.route('/x')` chain's `.get(handler)`
    const paths = r.chain ? [null] : a[0] && (strContent(a[0]) || a[0].type === 'template_string') ? [a[0]] : a[0] && a[0].type === 'array' && named(a[0]).every(strContent) ? named(a[0]) : null
    if (!paths) return
    const rest = r.chain ? a : a.slice(1)
    const last = rest[rest.length - 1]
    if (!last || !JS_HANDLERISH.has(last.type) || !routerish) return
    for (const p of paths) {
      if (p) consumed.add(p.id)
      addRoute({ method: c.name === 'all' ? 'ANY' : VERB_OF(c.name), path: r.prefix + (p ? pathOf(p) : ''), router: r.key, framework: 'node', handler: handlerRef(last), middleware: [...r.mw, ...rest.slice(0, -1).map(nameText).filter(Boolean)], line: line(n) })
    }
  }
  // what a mount names as its child: a router variable, an imported router, a same-file function
  // (its first parameter is the router: `register(fn)`)
  const childRef = (x, sc, fnParam = false) => {
    if (!x) return null
    if (x.type === 'identifier') {
      const k = lookup(x.text, sc)
      if (k.startsWith('v:') || k.startsWith('a:')) return { var: k }
      if (k.startsWith('i:')) return { import: x.text, attr: null }
      if (fnParam) { const s = symbols.find((y) => y.name === x.text && /function|method/.test(y.kind)); if (s) return { var: `p:${s.line}:0` } }
      return null
    }
    if ((x.type === 'member_expression' || x.type === 'attribute') && (field(x, 'object')?.type === 'identifier')) {
      const o = field(x, 'object').text, p = (field(x, 'property') || field(x, 'attribute')).text
      if (lookup(o, sc).startsWith('i:')) return { import: o, attr: p }
    }
    return null
  }
  // a call passing a router as an argument: `registerRoutes(app)`, `ArticlesRegister(v1.Group("/x"))`:
  // the callee's parameter at that index serves under that router
  const callMounts = (n, sc, a, c) => {
    if (!out.scopes.length && family !== 'go') return // no router in this file to pass
    a.forEach((x, i) => {
      let key = null
      const xt = x.type
      if (xt === 'identifier') { const k = lookup(x.text, sc); if (isRouterKey(k) || (k.startsWith('p:') && family === 'go' && ROUTER_TYPE.test(paramTypeOf(k, sc)))) key = k }
      else if (xt === 'call_expression' && family === 'go' && /\.(Group|PathPrefix|With)\(/.test(x.text)) key = anonRouter(x, sc)
      if (key) out.mounts.push({ parent: key, prefix: '', child: { call: c.name, qual: c.recv ? c.recv.text.replace(/\s+/g, '').slice(0, 80) : '', index: i, src: srcAt(line(n)) }, line: line(n) })
    })
  }
  // NestJS: `@Controller('users')` on the class, `@Get(':id')` on each method
  const NEST_VERBS = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS', All: 'ANY' }
  const decoratorsOf = (n) => { const ds = named(n).filter((c) => c.type === 'decorator'); if (n.parent?.type === 'export_statement') ds.push(...named(n.parent).filter((c) => c.type === 'decorator')); return ds }
  const decoName = (d) => { const e = d.namedChild(0); if (!e) return null; return e.type === 'call_expression' ? nameText(field(e, 'function')) : nameText(e) }
  const decoArgs = (d) => { const e = d.namedChild(0); return e && e.type === 'call_expression' ? argsOf(e) : [] }
  const nestPaths = (arg) => {
    if (!arg) return ['']
    if (strContent(arg)) { consumed.add(arg.id); return [pathOf(arg)] }
    if (arg.type === 'array') return named(arg).map((x) => { if (strContent(x)) consumed.add(x.id); return pathOf(x) })
    if (arg.type === 'object') { const p = pairVal(arg, 'path'); if (p && strContent(p)) consumed.add(p.id); return p ? nestPaths(p) : [''] }
    return [UNKNOWN]
  }
  const nestClass = (n) => {
    const ds = decoratorsOf(n)
    const ctl = ds.find((d) => decoName(d) === 'Controller')
    if (!ctl) return
    const prefixes = nestPaths(decoArgs(ctl)[0])
    const classMw = ds.filter((d) => /^Use(Guards|Interceptors|Pipes|Filters)$/.test(decoName(d) || '')).flatMap((d) => decoArgs(d).map(nameText).filter(Boolean))
    const body = field(n, 'body')
    if (!body) return
    let pending = []
    for (const m of named(body)) {
      if (m.type === 'decorator') { pending.push(m); continue }
      if (m.type === 'method_definition') {
        const verb = pending.find((d) => NEST_VERBS[decoName(d)])
        if (verb) {
          const mw = [...classMw, ...pending.filter((d) => /^Use(Guards|Interceptors|Pipes|Filters)$/.test(decoName(d) || '')).flatMap((d) => decoArgs(d).map(nameText).filter(Boolean))]
          for (const pre of prefixes) for (const p of nestPaths(decoArgs(verb)[0])) addRoute({ method: NEST_VERBS[decoName(verb)], path: joinPath(pre, p), framework: 'nestjs', handler: { name: field(m, 'name')?.text, qual: '' }, handlerLine: line(m), middleware: mw, line: line(verb), router: 'nest' })
        }
      }
      pending = []
    }
  }
  // React Navigation: `<Stack.Screen name="Profile" component={ProfileScreen} />`; Expo Router's
  // `<Link href=…>` and `<Redirect href=…>` are call sites
  const attrs = (n) => { const m = new Map(); for (const a of named(n)) if (a.type === 'jsx_attribute') { const k = a.namedChild(0)?.text; let v = a.namedChild(1); if (v && v.type === 'jsx_expression') v = v.namedChild(0); m.set(k, v) } return m }
  const jsxElement = (n) => {
    const nm = field(n, 'name')?.text || ''
    const at = attrs(n)
    if (/(^|\.)Screen$/.test(nm) && at.get('name') && lit(at.get('name')) !== null) {
      const name = lit(at.get('name'))
      consumed.add(at.get('name').id)
      addRoute({ kind: 'screen', method: null, path: name, framework: 'react-navigation', handler: handlerRef(at.get('component')), line: line(n), router: 'nav' })
    }
  }
  const navigatorConfig = (obj) => {
    const screens = pairVal(obj, 'screens') || obj
    for (const p of named(screens)) {
      if (p.type !== 'pair') continue
      const k = field(p, 'key'), v = field(p, 'value')
      const name = k.type === 'property_identifier' || k.type === 'identifier' ? k.text : lit(k)
      if (!name || !SCREEN_NAME.test(name)) continue
      const comp = v && v.type === 'object' ? pairVal(v, 'screen') : v
      if (!comp || !/^(identifier|member_expression)$/.test(comp.type)) continue
      if (strContent(k)) consumed.add(k.id)
      addRoute({ kind: 'screen', method: null, path: name, framework: 'react-navigation', handler: handlerRef(comp), line: line(p), router: 'nav' })
    }
  }

  // ── Python ──
  const PY_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'route', 'api_route'])
  const pyDecorated = (n, sc) => {
    const def = field(n, 'definition')
    if (!def || def.type !== 'function_definition') return
    const decos = named(n).filter((d) => d.type === 'decorator')
    const others = []
    const routes = []
    for (const d of decos) {
      const e = d.namedChild(0)
      const c = e && e.type === 'call' ? callee(e) : null
      if (c && c.recv && PY_VERBS.has(c.name)) {
        const a = argsOf(e), pos = positional(a)
        const p = pos[0] || kwarg(a, 'path') || kwarg(a, 'rule')
        if (!p || !strContent(p)) { others.push(nameText(e)); continue }
        consumed.add(p.id)
        const r = recvRouter(c.recv, sc) || { key: `g:${c.recv.text}`, prefix: '' }
        let method = VERB_OF(c.name)
        if (!method) { const ms = kwarg(a, 'methods'); method = ms && ms.type === 'list' ? named(ms).map(lit).filter(Boolean).map((x) => x.toUpperCase()).join(',') : c.name === 'route' ? 'GET' : 'ANY'; if (ms) for (const x of named(ms)) consumed.add(x.id) }
        const deps = kwarg(a, 'dependencies')
        const mw = deps && deps.type === 'list' ? named(deps).map((x) => (x.type === 'call' && /^(Depends|Security)$/.test(callee(x)?.name || '') ? nameText(positional(argsOf(x))[0]) : nameText(x))).filter(Boolean) : []
        routes.push({ method, path: r.prefix + pathOf(p), router: r.key, framework: 'python', handler: { name: field(def, 'name')?.text, qual: '' }, handlerLine: line(def), middleware: mw, line: line(d) })
      } else others.push(nameText(e))
    }
    for (const r of routes) addRoute({ ...r, middleware: [...r.middleware, ...others.filter(Boolean)] })
  }
  const pyCall = (n, sc) => {
    const c = callee(n)
    if (!c || !c.name) return
    const a = argsOf(n), pos = positional(a)
    if (isUrlsPy && !c.recv && /^(path|re_path|url)$/.test(c.name) && pos[0] && strContent(pos[0])) {
      consumed.add(pos[0].id)
      let p = pathOf(pos[0])
      if (c.name !== 'path') p = regexPath(p)
      const view = pos[1]
      const inc = view && view.type === 'call' && callee(view)?.name === 'include' ? positional(argsOf(view))[0] : null
      if (inc) {
        let child = null
        if (strContent(inc)) { consumed.add(inc.id); child = { module: lit(inc) } }
        else if (inc.type === 'attribute' && field(inc, 'object')?.type === 'identifier') { const o = field(inc, 'object').text; const k = lookup(o, sc); child = k.startsWith('v:') ? { var: k } : k.startsWith('i:') ? { import: o, attr: null } : null }
        else if (inc.type === 'identifier') { const k = lookup(inc.text, sc); child = k.startsWith('i:') ? { import: inc.text, attr: null } : null }
        if (child) out.mounts.push({ parent: 'django', prefix: '/' + p, child, line: line(n) })
        return
      }
      addRoute({ method: 'ANY', path: '/' + p, router: 'django', framework: 'django', handler: handlerRef(view), line: line(n) })
      return
    }
    if (!c.recv) return callMounts(n, sc, a, c)
    const r = recvRouter(c.recv, sc)
    if (!r) return
    if (c.name === 'include_router' || c.name === 'register_blueprint' || c.name === 'mount') {
      const pre = kwarg(a, c.name === 'register_blueprint' ? 'url_prefix' : 'prefix') || (c.name === 'mount' ? pos[0] : null)
      if (pre && strContent(pre)) consumed.add(pre.id)
      const ch = childRef(c.name === 'mount' ? pos[1] : pos[0], sc)
      if (ch) out.mounts.push({ parent: r.key, prefix: r.prefix + (pre ? pathOf(pre) : ''), child: ch, line: line(n) })
      return
    }
    if ((c.name === 'add_url_rule' || c.name === 'add_api_route') && pos[0] && strContent(pos[0])) {
      consumed.add(pos[0].id)
      const view = kwarg(a, c.name === 'add_url_rule' ? 'view_func' : 'endpoint') || (c.name === 'add_url_rule' ? pos[2] : pos[1])
      const ms = kwarg(a, 'methods')
      if (ms) for (const x of named(ms)) consumed.add(x.id)
      addRoute({ method: ms && ms.type === 'list' ? named(ms).map(lit).filter(Boolean).map((x) => x.toUpperCase()).join(',') : 'GET', path: r.prefix + pathOf(pos[0]), router: r.key, framework: 'python', handler: handlerRef(view), line: line(n) })
      return
    }
    // Django REST framework: `router.register(r'articles', ArticleViewSet)` → its list and detail routes
    if (c.name === 'register' && scopeOf(r.key)?.drf && pos[0] && strContent(pos[0])) {
      consumed.add(pos[0].id)
      const p = pathOf(pos[0]).replace(/^\^|\$$/g, '').replace(/\/$/, '')
      for (const q of [`/${p}/`, `/${p}/{pk}/`]) addRoute({ method: 'ANY', path: q, router: r.key, framework: 'django', handler: handlerRef(pos[1]), line: line(n) })
    }
  }

  // ── Go ──
  const goCall = (n, sc, inner) => {
    const c = callee(n)
    if (!c || !c.name) return
    const a = argsOf(n)
    if (!c.recv) return callMounts(n, sc, a, c)
    // gorilla `.HandleFunc(…).Methods("GET")`: walked before the route it narrows, kept for it
    if (c.name === 'Methods' && c.recv.type === 'call_expression' && a.length && a.every((x) => VERB_OF(lit(x)))) { methodsFor.set(c.recv.startIndex, a.map((x) => VERB_OF(lit(x))).join(',')); for (const x of a) consumed.add(x.id); return }
    const r = recvRouter(c.recv, sc)
    const routerish = r && (isRouterKey(r.key) || (r.key.startsWith('p:') && ROUTER_TYPE.test(paramTypeOf(r.key, sc))) || serverFile || c.recv.text === 'http')
    // chi `r.Route("/x", func(r chi.Router) {…})`, `r.Group(func(r chi.Router) {…})`: the closure's parameter
    if (r && routerish && (c.name === 'Route' || c.name === 'Group') && a.length >= 1) {
      const fn = a[a.length - 1]
      if (fn.type === 'func_literal') {
        const pre = c.name === 'Route' && strContent(a[0]) ? (consumed.add(a[0].id), pathOf(a[0])) : ''
        out.scopes.push({ key: `p:${line(fn)}:0`, parent: r.key, prefix: r.prefix + pre, factory: null, line: line(n), uses: [] })
        return
      }
    }
    if (r && routerish && c.name === 'Mount' && a.length === 2 && strContent(a[0])) {
      consumed.add(a[0].id)
      const ch = childRef(a[1], sc)
      if (ch) out.mounts.push({ parent: r.key, prefix: r.prefix + pathOf(a[0]), child: ch, line: line(n) })
      return
    }
    if (r && routerish && c.name === 'Use' && isRouterKey(r.key)) { scopeOf(r.key).uses.push(...a.map(nameText).filter(Boolean)); return }
    if (r && routerish && GO_ROUTE.has(c.name) && a.length >= 2) {
      let i = 0, method = VERB_OF(c.name) || (c.name === 'Any' ? 'ANY' : null)
      if ((c.name === 'Handle' || c.name === 'Method' || c.name === 'MethodFunc' || c.name === 'Match') && VERB_OF(lit(a[0])) && a.length >= 3) { method = VERB_OF(lit(a[0])); consumed.add(a[0].id); i = 1 }
      const p = a[i]
      if (!p || !(strContent(p) || p.type === 'binary_expression')) return callMounts(n, sc, a, c)
      const rest = a.slice(i + 1)
      if (!rest.length || !GO_HANDLERISH.has(rest[echoFile ? 0 : rest.length - 1].type)) return
      consumed.add(p.id)
      let pth = pathOf(p)
      // net/http's own patterns: "GET /items/{id}", a host before the path
      const m = /^([A-Z]+)\s+(.*)$/.exec(pth)
      if (m && VERB_OF(m[1])) { method = VERB_OF(m[1]); pth = m[2] }
      if (!pth.startsWith('/') && !pth.startsWith(UNKNOWN)) pth = pth.includes('/') ? pth.slice(pth.indexOf('/')) : pth
      const h = echoFile ? rest[0] : rest[rest.length - 1]
      const mw = echoFile ? rest.slice(1) : rest.slice(0, -1)
      addRoute({ method: methodsFor.get(n.startIndex) || method || 'ANY', path: r.prefix + pth, router: r.key, framework: 'go', handler: handlerRef(h), middleware: [...r.mw, ...mw.map(nameText).filter(Boolean)], line: line(n) })
      return
    }
    callMounts(n, sc, a, c)
  }
  const methodsFor = new Map()
  const paramTypeOf = (key, sc) => {
    const [, ln, i] = key.split(':')
    for (let s = sc; s; s = s.parent) if (String(s.line) === ln && s.node) return paramType(s.node, Number(i))
    return ''
  }

  // ── Java: Spring ──
  const SPRING = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH', RequestMapping: null }
  const annotations = (n) => { const m = named(n).find((c) => c.type === 'modifiers'); return m ? named(m).filter((c) => /annotation/.test(c.type)) : [] }
  const annoName = (a) => field(a, 'name')?.text
  const annoPaths = (a) => {
    const args = field(a, 'arguments')
    if (!args) return ['']
    const vals = named(args)
    const pick = vals.find((v) => v.type === 'element_value_pair' && /^(value|path)$/.test(field(v, 'key')?.text))
    const v = pick ? field(pick, 'value') : vals.find((x) => x.type !== 'element_value_pair')
    if (!v) return ['']
    const one = (x) => { if (strContent(x)) { consumed.add(x.id); return pathOf(x) } return UNKNOWN }
    return v.type === 'element_value_array_initializer' ? named(v).map(one) : [one(v)]
  }
  const annoMethods = (a) => {
    const args = field(a, 'arguments')
    const pair = args && named(args).find((v) => v.type === 'element_value_pair' && field(v, 'key')?.text === 'method')
    if (!pair) return null
    const v = field(pair, 'value')
    return (v.type === 'element_value_array_initializer' ? named(v) : [v]).map((x) => x.text.split('.').pop()).filter((x) => VERB_OF(x)).join(',') || null
  }
  const springClass = (n) => {
    const as = annotations(n)
    const ctl = as.some((a) => /^(RestController|Controller)$/.test(annoName(a)))
    const map = as.find((a) => annoName(a) === 'RequestMapping')
    const prefixes = map ? annoPaths(map) : ['']
    const body = field(n, 'body')
    if (!body) return
    for (const m of named(body)) {
      if (m.type !== 'method_declaration') continue
      const ms = annotations(m)
      const hit = ms.find((a) => annoName(a) in SPRING)
      if (!hit || (!ctl && !map)) continue
      const method = SPRING[annoName(hit)] || annoMethods(hit) || 'ANY'
      const mw = ms.filter((a) => a !== hit && !/^(ResponseBody|ResponseStatus|Override|Transactional)$/.test(annoName(a))).map(annoName).filter(Boolean)
      for (const pre of prefixes) for (const p of annoPaths(hit)) addRoute({ method, path: joinPath(pre, p), framework: 'spring', handler: { name: field(m, 'name')?.text, qual: '' }, handlerLine: line(m), middleware: mw, line: line(hit), router: 'spring' })
    }
  }

  // ── call sites ──
  const refs = []
  const addRef = (r) => { if (refs.length < MAX_REFS) refs.push(r) }
  const ctxOf = (n) => {
    // climb from the string (or concatenation) to what it is given to
    let x = n, key = null, objMethod = null
    for (let k = 0; k < 4 && x.parent; k++) {
      const p = x.parent
      if (p.type === 'pair' || p.type === 'keyword_argument') {
        key = (field(p, 'key') || field(p, 'name'))?.text
        if (!/^(pathname|url|path|href|uri|to)$/.test(key || '')) return { kind: 'any' }
        x = p.parent
        // a request object stating its method beside its URL: `{ method: 'GET', url: '/a' }`
        const m = x && x.type === 'object' ? pairVal(x, 'method') : null
        if (m && VERB_OF(lit(m))) objMethod = VERB_OF(lit(m))
        continue
      }
      if (p.type === 'jsx_expression' || p.type === 'parenthesized_expression') { x = p; continue }
      if (p.type === 'jsx_attribute') {
        const attr = p.namedChild(0)?.text, el = p.parent && field(p.parent, 'name')?.text
        return { kind: attr === 'href' && /^(Link|Redirect)$|\.Link$/.test(el || '') ? 'screen' : 'any' }
      }
      if (p.type === 'arguments' || p.type === 'argument_list') {
        const call = p.parent, c = callee(call)
        if (!c || !c.name) return { kind: objMethod ? 'http' : 'any', method: objMethod, inCall: false }
        const recvText = c.recv ? c.recv.text.replace(/\s+/g, '') : ''
        const verb = VERB_OF(c.name)
        if (verb && !key) return { kind: 'http', method: verb, inCall: true }
        if (/^(get|post|put|patch|delete)For(Object|Entity|Location)$/.test(c.name)) return { kind: 'http', method: c.name.replace(/For.*$/, '').toUpperCase(), inCall: true }
        if (FETCHES.has(c.name) || c.name === 'NewRequest' || c.name === 'NewRequestWithContext') {
          const args = argsOf(call)
          let method = null
          for (const y of args) { const v = lit(y); if (v && VERB_OF(v) && v === v.toUpperCase()) method = VERB_OF(v); else if (/^http\.Method[A-Z]/.test(y.text)) method = VERB_OF(y.text.slice(11)); else if (y.type === 'object') { const m = pairVal(y, 'method'); if (m && VERB_OF(lit(m))) method = VERB_OF(lit(m)) } }
          return { kind: 'http', method, inCall: true }
        }
        if ((c.name === 'uri' || c.name === 'url') && c.recv && /^(call_expression|method_invocation)$/.test(c.recv.type)) { const v = VERB_OF(callee(c.recv)?.name); return { kind: 'http', method: v, inCall: true } }
        if (NAV_CALLS.has(c.name) && (NAV_RECV.test(recvText) || c.name === 'navigate')) return { kind: 'screen', inCall: false }
        return { kind: objMethod ? 'http' : 'any', method: objMethod, inCall: false }
      }
      return { kind: objMethod ? 'http' : 'any', method: objMethod }
    }
    return { kind: objMethod ? 'http' : 'any', method: objMethod }
  }
  const seenRef = new Set()
  // one node, in the same walk as the declarations (after them, so their strings are consumed
  // first): true when its subtree holds nothing more to read (a string, a concatenation, an import)
  // no `/` in a node's text: no URL in it (the file's text, when the caller gave it)
  const slashless = (n) => { if (src === null) return false; const k = src.indexOf('/', n.startIndex); return k < 0 || k >= n.endIndex }
  const scanNode = (n, t) => {
    if (!SCANNED.has(t)) return false // `type` is a call into the grammar: asked once per node
    if (STRINGS.has(t) && slashless(n)) return true // a string is read whole: nothing in it to read
    if (t === 'call_expression' || t === 'call' || t === 'method_invocation') {
      const c = callee(n)
      if (c && /^(require|import|require_relative|include)$/.test(c.name || '') && !c.recv) return true
      // a screen's name given to navigation: `navigation.navigate('Profile')`, `{ screen: 'X' }`, `{ name: 'X' }`
      if (family === 'js' && c && NAV_CALLS.has(c.name) && (NAV_RECV.test(c.recv ? c.recv.text.replace(/\s+/g, '') : '') || c.name === 'navigate' || c.name === 'jumpTo')) {
        const names = []
        const a = argsOf(n)
        if (a[0] && lit(a[0]) !== null) names.push(a[0])
        const deep = (o, d = 0) => { if (!o || d > 3) return; if (o.type === 'object') for (const p of named(o)) { if (p.type !== 'pair') continue; const k = field(p, 'key')?.text, v = field(p, 'value'); if ((k === 'screen' || k === 'name') && v && lit(v) !== null) names.push(v); else deep(v, d + 1) } else if (o.type === 'array') for (const e of named(o)) deep(e, d + 1) }
        for (const x of a) deep(x)
        for (const v of names) {
          const s = lit(v)
          if (!SCREEN_NAME.test(s)) continue
          consumed.add(v.id)
          addRef({ kind: 'screen', named: 1, toks: [hashSeg(s)], lead: false, method: null, line: line(v), src: srcAt(line(v)) })
        }
      }
    }
    if (family === 'js' && (t === 'jsx_self_closing_element' || t === 'jsx_opening_element')) {
      const at = attrs(n), sc = at.get('screen')
      if (sc && lit(sc) !== null && SCREEN_NAME.test(lit(sc))) { consumed.add(sc.id); addRef({ kind: 'screen', named: 1, toks: [hashSeg(lit(sc))], lead: false, method: null, line: line(sc), src: srcAt(line(sc)) }) }
    }
    const parts = t === 'binary_expression' || t === 'binary_operator' ? concat(n) : null
    if (parts) {
      const text = parts.map((p) => (p === null ? '\0' : p)).join('')
      let any = false
      const mark = (x) => { if (STRINGS.has(x.type)) { if (consumed.has(x.id)) any = true; consumed.add(x.id) } for (const c of named(x)) mark(c) }
      mark(n)
      if (!any) emit(n, text)
      return true
    }
    const sc = STRINGS.has(t) ? strContent(n) : null
    if (sc) { if (!consumed.has(n.id)) emit(n, sc.text); return true }
    return false
  }
  const emit = (n, text) => {
    if (!text.includes('/') || !urlPattern(text, { inCall: true })) return // climb only for what may be a URL
    const ctx = ctxOf(n)
    const u = urlPattern(text, { inCall: !!ctx.inCall })
    if (!u) return
    const k = `${line(n)}|${u.toks.join('/')}`
    if (seenRef.has(k)) return
    seenRef.add(k)
    addRef({ kind: ctx.kind, named: 0, toks: u.toks, lead: u.lead, method: ctx.method || null, line: line(n), src: srcAt(line(n)) })
  }
  if (stringsOnly) {
    // the strings, concatenations and calls the walk would reach, found by the grammar in one pass
    // (in tree order: a node a scan consumed whole, or an import or a comment, skips what it holds)
    let skipTo = -1
    const loader = /(?:require_relative|require|import|include)\b/y
    for (const x of tree.rootNode.descendantsOfType(SCAN_ONLY)) {
      if (x.startIndex < skipTo || !x.isNamed) continue
      const t = x.type
      if (SKIP.has(t)) { skipTo = x.endIndex; continue }
      if (CALLS.has(t)) { loader.lastIndex = x.startIndex; if (!loader.test(src)) continue } // only a loader's call is read here (its strings skipped)
      else if (slashless(x)) { skipTo = x.endIndex; continue }
      if (scanNode(x, t)) skipTo = x.endIndex
    }
  } else walk(tree.rootNode, root)
  out.refs = refs
  return finish(out)
}

function finish(out) {
  return out.routes.length || out.refs.length || out.scopes.length || out.mounts.length || Object.keys(out.meta).length ? out : null
}

// Two path parts joined: one slash between them, none doubled; `''` + `''` is `/`
export function joinPath(a, b) {
  a = a || ''; b = b || ''
  if (!a) return b.startsWith('/') || b.startsWith(UNKNOWN) || !b ? b || '/' : `/${b}`
  if (!b) return a.startsWith('/') || a.startsWith(UNKNOWN) ? a : `/${a}`
  const x = a.startsWith('/') || a.startsWith(UNKNOWN) ? a : `/${a}`
  return `${x.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`
}

// A Django `re_path` regex, read as a template: anchors dropped, a named group `{name}`, any other
// group `{…}`; what is not a plain path stays `{…}`
function regexPath(re) {
  let s = re.replace(/^\^/, '').replace(/\$$/, '')
  s = s.replace(/\(\?P<(\w+)>(?:[^()]|\([^()]*\))*\)/g, '{$1}').replace(/\((?:[^()]|\([^()]*\))*\)/g, UNKNOWN).replace(/\\\./g, '.').replace(/\/\?$/, '/')
  return /[\\^$|+*?[\]]/.test(s) ? s.replace(/[^/]*[\\^$|+*?[\]][^/]*/g, UNKNOWN) : s
}

// ── file-based routes: Next.js App Router route files, pages/api, Expo Router screens and API routes ──
function exportsOf(tree) {
  const out = { verbs: [], default: null }
  for (const s of named(tree.rootNode)) {
    if (s.type !== 'export_statement') continue
    const d = field(s, 'declaration'), v = field(s, 'value')
    if (hasToken(s, 'default')) { out.default = d ? { name: field(d, 'name')?.text || null, line: line(d) } : v && v.type === 'identifier' ? { name: v.text, line: null } : { name: null, line: line(s) }; continue }
    if (!d) { for (const sp of named(s).filter((x) => x.type === 'export_clause').flatMap(named)) { const nm = field(sp, 'alias')?.text || field(sp, 'name')?.text; if (VERB_OF(nm) && nm === nm.toUpperCase()) out.verbs.push({ verb: nm, name: field(sp, 'name')?.text, line: line(sp) }) } continue }
    if (d.type === 'function_declaration' && VERB_OF(field(d, 'name')?.text) && field(d, 'name').text === field(d, 'name').text.toUpperCase()) out.verbs.push({ verb: field(d, 'name').text, name: field(d, 'name').text, line: line(d) })
    if (d.type === 'lexical_declaration') for (const vd of named(d)) { const nm = field(vd, 'name')?.text; if (nm && VERB_OF(nm) && nm === nm.toUpperCase()) out.verbs.push({ verb: nm, name: nm, line: line(vd) }) }
  }
  return out
}
// a folder segment as a route's: `[id]` a parameter, `[...slug]` the rest, `(group)` and `@slot` nothing
const fileSegs = (segs) => segs.filter((g) => !/^\(.*\)$/.test(g) && !g.startsWith('@'))
function fileRoutes(tree, lang, rel, out, addRoute) {
  if (familyOf(lang) !== 'js') return
  const m = /^(?:(.*?)\/)?app\/(.+)$/.exec(rel)
  const parts = rel.split('/')
  const file = parts[parts.length - 1].replace(/\.(tsx|ts|jsx|js|mjs|cjs|mts)$/, '')
  if (m && /^(tsx|ts|jsx|js|mjs|mts)$/.test(rel.split('.').pop())) {
    const under = m[2].split('/').slice(0, -1)
    if (under.some((g) => g.startsWith('_') || g === 'node_modules')) return
    const root = m[1] ? `${m[1]}/app` : 'app'
    if (file === 'route') { // Next.js App Router
      const ex = exportsOf(tree)
      const p = '/' + fileSegs(under).join('/')
      for (const v of ex.verbs) addRoute({ method: v.verb, path: p, framework: 'nextjs', handler: { name: v.name, qual: '' }, handlerLine: v.line, line: v.line, router: 'file' })
      return
    }
    if (NEXT_FILES.test(file)) return
    const base = file.replace(SCREEN_PLATFORM, '')
    if (base.endsWith('+api')) { // Expo API routes
      const ex = exportsOf(tree)
      const p = '/' + [...fileSegs(under), base.replace(/\+api$/, '')].filter((g) => g !== 'index').join('/')
      for (const v of ex.verbs) addRoute({ method: v.verb, path: p, framework: 'expo-router', handler: { name: v.name, qual: '' }, handlerLine: v.line, line: v.line, router: 'file', appRoot: root })
      return
    }
    if (base.startsWith('_') || base.startsWith('+')) return // a layout, +not-found, +html, +native-intent
    const ex = exportsOf(tree)
    if (!ex.default) return
    const segs = fileSegs([...under, base])
    if (segs[segs.length - 1] === 'index') segs.pop()
    addRoute({ kind: 'screen', method: null, path: '/' + segs.join('/'), framework: 'expo-router', handler: ex.default.name ? { name: ex.default.name, qual: '' } : null, handlerLine: ex.default.line, line: ex.default.line || 1, router: 'file', appRoot: root })
    return
  }
  const pa = /^(?:.*?\/)?pages\/api\/(.+)$/.exec(rel)
  if (pa) {
    const ex = exportsOf(tree)
    if (!ex.default) return
    const segs = pa[1].replace(/\.(tsx|ts|jsx|js|mjs)$/, '').split('/')
    if (segs[segs.length - 1] === 'index') segs.pop()
    addRoute({ method: 'ANY', path: '/' + ['api', ...segs].join('/'), framework: 'nextjs', handler: ex.default.name ? { name: ex.default.name, qual: '' } : null, handlerLine: ex.default.line, line: ex.default.line || 1, router: 'file' })
  }
}

// ── Rails: config/routes.rb ──
const singular = (s) => (/ies$/.test(s) ? s.replace(/ies$/, 'y') : /(ss|sh|ch|x|z)es$/.test(s) ? s.replace(/es$/, '') : s.replace(/s$/, ''))
const RES_ACTIONS = [['index', 'GET', ''], ['create', 'POST', ''], ['new', 'GET', '/new'], ['edit', 'GET', '/:id/edit'], ['show', 'GET', '/:id'], ['update', 'PATCH,PUT', '/:id'], ['destroy', 'DELETE', '/:id']]
const RES1_ACTIONS = [['create', 'POST', ''], ['new', 'GET', '/new'], ['edit', 'GET', '/edit'], ['show', 'GET', ''], ['update', 'PATCH,PUT', ''], ['destroy', 'DELETE', '']]
function railsRoutes(rootNode, addRoute, consumed) {
  const sym = (n) => (n && n.type === 'simple_symbol' ? n.text.slice(1) : n && n.type === 'string' ? lit(n) : null)
  const opt = (args, k) => { for (const a of args) if (a.type === 'pair') { const key = field(a, 'key'); const kt = key.type === 'hash_key_symbol' ? key.text : sym(key); if (kt === k) return field(a, 'value') } return null }
  const symList = (v) => (!v ? null : v.type === 'array' ? named(v).map(sym).filter(Boolean) : [sym(v)].filter(Boolean))
  const handlerOf = (to, ctx) => { const s = to ? lit(to) : null; if (!s || !s.includes('#')) return null; const [c, a] = s.split('#'); return { name: a, qual: [ctx.module, c].filter(Boolean).join('/'), rails: true } }
  const visit = (n, ctx) => {
    if (n.type === 'call' && !field(n, 'receiver')) {
      const m = field(n, 'method')?.text
      const args = field(n, 'arguments') ? named(field(n, 'arguments')) : []
      const block = field(n, 'block')
      const blockBody = block ? (field(block, 'body') || block) : null
      for (const a of args) for (const s of [a, ...(a.type === 'pair' ? [field(a, 'key'), field(a, 'value')] : [])]) if (s && s.type === 'string') consumed.add(s.id)
      if (m === 'namespace' && args[0]) { const nm = sym(args[0]); if (blockBody) visit(blockBody, { ...ctx, prefix: joinPath(ctx.prefix, nm), module: [ctx.module, nm].filter(Boolean).join('/') }); return }
      if (m === 'scope') {
        const p = args[0] && args[0].type !== 'pair' ? sym(args[0]) : lit(opt(args, 'path') || {}) || null
        const mod = sym(opt(args, 'module'))
        if (blockBody) visit(blockBody, { ...ctx, prefix: p ? joinPath(ctx.prefix, p) : ctx.prefix, module: mod ? [ctx.module, mod].filter(Boolean).join('/') : ctx.module })
        return
      }
      if ((m === 'member' || m === 'collection') && ctx.resource && blockBody) { visit(blockBody, { ...ctx, prefix: m === 'member' ? ctx.resource.member : ctx.resource.collection, controller: ctx.resource.controller, member: true }); return }
      if (m === 'resources' || m === 'resource') {
        for (const a of args.filter((x) => x.type !== 'pair')) {
          const nm = sym(a)
          if (!nm) continue
          const only = symList(opt(args, 'only')), except = symList(opt(args, 'except')) || []
          const ctl = sym(opt(args, 'controller')) || (m === 'resources' ? nm : `${nm}s`)
          const base = joinPath(ctx.prefix, sym(opt(args, 'path')) || nm)
          const acts = (m === 'resources' ? RES_ACTIONS : RES1_ACTIONS).filter(([act]) => (!only || only.includes(act)) && !except.includes(act))
          for (const [act, verb, suf] of acts) addRoute({ method: verb, path: base + suf, framework: 'rails', handler: { name: act, qual: [ctx.module, ctl].filter(Boolean).join('/'), rails: true }, line: line(n), router: 'rails' })
          if (blockBody) {
            const one = m === 'resources' ? `${base}/:${singular(nm)}_id` : base
            visit(blockBody, { ...ctx, prefix: one, resource: { member: m === 'resources' ? `${base}/:id` : base, collection: base, controller: [ctx.module, ctl].filter(Boolean).join('/') } })
          }
        }
        return
      }
      if (m === 'root') {
        const to = args[0] && args[0].type === 'string' ? args[0] : opt(args, 'to')
        addRoute({ method: 'GET', path: ctx.prefix || '/', framework: 'rails', handler: handlerOf(to, ctx), line: line(n), router: 'rails' })
        return
      }
      if (/^(get|post|put|patch|delete|match)$/.test(m || '') && args.length) {
        let p = null, to = opt(args, 'to')
        const first = args[0]
        if (first.type === 'pair' && field(first, 'key').type === 'string') { p = lit(field(first, 'key')); to = field(first, 'value') }
        else p = sym(first)
        if (p === null) return
        let handler = handlerOf(to, ctx)
        if (!handler && ctx.member && first.type === 'simple_symbol') handler = { name: p, qual: ctx.controller, rails: true }
        else if (!handler) { const action = sym(opt(args, 'action')), ctl = sym(opt(args, 'controller')); if (action && ctl) handler = { name: action, qual: [ctx.module, ctl].filter(Boolean).join('/'), rails: true } }
        const via = m === 'match' ? (symList(opt(args, 'via')) || ['any']).map((x) => x.toUpperCase()).join(',') : m.toUpperCase()
        addRoute({ method: via === 'ALL' ? 'ANY' : via, path: joinPath(ctx.prefix, p), framework: 'rails', handler, line: line(n), router: 'rails' })
        return
      }
    }
    for (const c of named(n)) visit(c, ctx)
  }
  visit(rootNode, { prefix: '', module: '', resource: null })
}
