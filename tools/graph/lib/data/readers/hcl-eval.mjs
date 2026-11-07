// grimoire graph · data · a small evaluator for the HCL readers/hcl.mjs reads (spec D9): what a
// Terraform module and its Terragrunt inputs say once evaluated, as far as the files say it, and
// nothing guessed past that.
//
// Evaluated: literals, lists, objects, string templates (`${…}`, `%{ if }`, `%{ for }`), `var.*` (a
// value set from outside, else the variable's default, conformed to its type: `optional(T, d)`
// attributes filled), `local.*`, `each.key` / `each.value` under `for_each` (a map, or a set of
// strings), `count.index`, an iterator of a `dynamic` block, `for` expressions (list and object
// forms, `if`, `...` grouping), conditionals, the operators, and the functions FNS names (lookup,
// try, can, merge, coalesce, compact, flatten, toset, tolist, concat, contains, format, join…).
// Terragrunt (`terragrunt(…)`): `include` blocks (found through `find_in_parent_folders()`, their
// `inputs` merged shallow, deep or not at all, as `merge_strategy` says, `include.<name>.*` when
// exposed), `read_terragrunt_config()`, `locals`, `inputs`, `terraform { source }`, and the path
// functions (get_terragrunt_dir, get_parent_terragrunt_dir, get_repo_root, path_relative_to_include…),
// all against the repository's own files. A path is a virtual absolute one, rooted at the repository
// (`/infra/prod/root.hcl`): nothing reads the disk, the environment or the network.
//
// UNKNOWN, never guessed: `dependency.*.outputs`, `get_env()`, `run_cmd()`, data sources, another
// resource's or module's attributes, `terraform.workspace`, `path.*`, a file no input holds, any
// function FNS does not name. An Unknown carries why (a sentence), a label (the last name of the
// expression that reached it: `var.env` → env, for a name template) and its text (the expression,
// as readers/hcl.mjs refText writes it: names, never a literal value). It propagates: an operation on
// it is unknown, except a string template, which keeps its known parts around it (a Partial:
// `"${var.env}-orders"` → [Unknown env, "-orders"]).
//
// Where each value comes from: every list and object made here is registered in ORIGIN (its file and
// line, and each member's), and the evaluator's `last` is the origin of the last value it produced,
// so the caller cites the line that states a value, even when it travelled through a variable, a
// merge or a for expression to get there.
//
// Bounded: an evaluation budget (STEPS), a depth cap (DEPTH: nested expressions, locals reading
// locals), a deadline, and a cap on a string's length (STR_MAX). Past any of them: a BudgetError,
// the extractor's to report. A Terraform error (a missing attribute, a wrong type, a cycle) is an
// EvalError: try() and can() catch it, as Terraform does; the extractor turns one that escapes into
// an unknown value, never into a guess.
//
// Secrets: values live in memory, for one evaluation. The caller keeps only what lands in a store's
// model; nothing here writes, logs or returns a value in a note.
import path from 'node:path'
import { refText } from './hcl.mjs'
import { deeperThan } from './json-lines.mjs'

const P = path.posix
export const STEPS = 1_000_000
export const DEPTH = 128
export const EVAL_MS = 10_000
export const STR_MAX = 1 << 20

export class Unknown {
  constructor(why, label = null, origin = null, chain = null) { this.why = why; this.label = label; this.origin = origin; this.chain = chain }
  get text() { return this.origin ?? (this.chain ? refText(this.chain) : this.label ?? '…') }
}
// a string with unknown parts: parts are strings and Unknowns
export class Partial { constructor(parts) { this.parts = parts } }
export class EvalError extends Error {}
export class BudgetError extends Error {}

export const isUnk = (v) => v instanceof Unknown || v instanceof Partial
const firstUnk = (v) => (v instanceof Unknown ? v : v.parts.find((p) => p instanceof Unknown))
const seal = (v) => { const u = firstUnk(v); return new Unknown(u.why, u.label, u.text) }

// A namespace evaluated on demand (var, local, an exposed include, a config read): only what an
// expression reaches is ever evaluated. fetch memoises { v, at }.
export class Lazy {
  constructor(keys, get, at = null) { this.keys = keys; this.get = get; this.at = at; this.memo = new Map(); this.busy = new Set() }
  has(k) { return this.keys().includes(k) }
  fetch(k, ev) {
    if (this.memo.has(k)) { const m = this.memo.get(k); if (m.at) ev.last = m.at; return m.v }
    if (this.busy.has(k)) throw new EvalError(`${k} refers to itself`)
    this.busy.add(k)
    try {
      const v = this.get(k, ev)
      this.memo.set(k, { v, at: ev.last })
      return v
    } finally { this.busy.delete(k) }
  }
}

export const ORIGIN = new WeakMap() // list or object → { path, line, members?: Map(key → origin), items?: [origin] }
export const SET = Symbol('set')
export const obj = () => Object.create(null)
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Unknown) && !(v instanceof Partial) && !(v instanceof Lazy)
export const originOf = (v) => (v !== null && typeof v === 'object' ? ORIGIN.get(v) : undefined)
export const memberAt = (o, k) => { const r = originOf(o); return r?.members?.get(k) ?? (r ? { path: r.path, line: r.line } : null) }
export const itemAt = (a, i) => { const r = originOf(a); return r?.items?.[i] ?? (r ? { path: r.path, line: r.line } : null) }
const asSet = (a) => { a[SET] = true; return a }
const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'list' : v instanceof Lazy || isObj(v) ? 'object' : typeof v)

// A scope: its root (what the bare names var, local, include… mean, and extra functions), the file
// its expressions come from, and the names bound around them (each, count, iterators, for variables),
// chained so an inner one hides an outer one.
export const scopeOf = (root, file) => ({ root, file, names: obj(), ats: obj() })
export function child(sc, names = {}, ats = {}, file = sc.file) {
  const n = Object.create(sc.names), a = Object.create(sc.ats)
  Object.assign(n, names); Object.assign(a, ats)
  return { root: sc.root, file, names: n, ats: a }
}
const at = (sc, n) => ({ path: sc.file, line: n.line })

export class Evaluator {
  constructor({ steps = STEPS, depth = DEPTH, deadline = Date.now() + EVAL_MS } = {}) {
    this.steps = steps; this.max = depth; this.d = 0; this.deadline = deadline; this.last = null
  }
  tick() {
    if (--this.steps < 0) throw new BudgetError('the evaluation ran past its budget of steps')
    if ((this.steps & 1023) === 0 && Date.now() > this.deadline) throw new BudgetError('the evaluation took too long')
  }
  walk(n, sc) {
    this.tick()
    if (++this.d > this.max) { this.d--; throw new BudgetError(`the evaluation nests deeper than ${this.max} levels`) }
    try { return this.ev(n, sc) } finally { this.d-- }
  }
  // a value, never a Lazy namespace (a whole namespace used as a value is evaluated member by member)
  value(n, sc) { return this.mat(this.walk(n, sc)) }
  mat(v) {
    if (!(v instanceof Lazy)) return v
    if (++this.d > this.max) { this.d--; throw new BudgetError(`the evaluation nests deeper than ${this.max} levels`) }
    try {
      const o = obj(), members = new Map()
      for (const k of v.keys()) {
        this.tick()
        let x
        try { x = this.mat(v.fetch(k, this)) } catch (e) { if (!(e instanceof EvalError)) throw e; x = new Unknown(`${k}: not evaluated (${e.message})`, k, k) }
        o[k] = x; members.set(k, this.last)
      }
      ORIGIN.set(o, { ...(v.at || { path: null, line: null }), members })
      if (v.at) this.last = v.at
      return o
    } finally { this.d-- }
  }

  ev(n, sc) {
    switch (n.t) {
      case 'lit': this.last = at(sc, n); return n.v
      case 'paren': return this.walk(n.x, sc)
      case 'tpl': return this.template(n, sc)
      case 'tuple': {
        const out = [], items = []
        for (const x of n.items) { this.last = null; out.push(this.value(x, sc)); items.push(this.last ?? at(sc, x)) }
        ORIGIN.set(out, { ...at(sc, n), items })
        this.last = at(sc, n)
        return out
      }
      case 'object': {
        const o = obj(), members = new Map()
        for (const it of n.items) {
          const k = it.key.t === 'lit' ? it.key.v : this.value(it.key, sc)
          if (isUnk(k)) return seal(k) // a key not known: the object is not known
          if (k === null || typeof k === 'object') throw new EvalError('an object key is not a string')
          this.last = null
          const v = this.value(it.value, sc)
          o[String(k)] = v
          members.set(String(k), this.last ?? { path: sc.file, line: it.line })
        }
        ORIGIN.set(o, { ...at(sc, n), members })
        this.last = at(sc, n)
        return o
      }
      case 'var': {
        if (n.name in sc.names) {
          const v = sc.names[n.name]
          this.last = originOf(v) ? { path: originOf(v).path, line: originOf(v).line } : sc.ats[n.name] ?? this.last
          return v
        }
        return sc.root.ns(n.name, n, sc, this)
      }
      case 'get': return this.attr(this.walk(n.x, sc), n.name, n)
      case 'index': {
        const x = this.walk(n.x, sc)
        const k = this.value(n.key, sc)
        return this.index(x, k, n)
      }
      case 'splat': {
        const x = this.value(n.x, sc)
        if (isUnk(x)) return seal(x)
        const list = x === null ? [] : Array.isArray(x) ? x : [x]
        return list.map((el) => {
          let y = el
          for (const op of n.ops) y = op.name ? this.attr(y, op.name, n) : this.index(y, this.value(op.key, sc), n)
          return this.mat(y)
        })
      }
      case 'call': return this.call(n, sc)
      case 'not': {
        const x = this.value(n.x, sc)
        if (isUnk(x)) return seal(x)
        if (typeof x !== 'boolean') throw new EvalError(`! takes a bool, not a ${kind(x)}`)
        this.last = at(sc, n)
        return !x
      }
      case 'neg': {
        const x = num(this.value(n.x, sc))
        if (isUnk(x)) return seal(x)
        this.last = at(sc, n)
        return -x
      }
      case 'bin': return this.binop(n, sc)
      case 'cond': {
        const c = this.value(n.c, sc)
        if (isUnk(c)) return seal(c)
        if (typeof c !== 'boolean') throw new EvalError(`a condition is a bool, not a ${kind(c)}`)
        return this.walk(c ? n.a : n.b, sc)
      }
      case 'for': return this.forExpr(n, sc)
      default: throw new EvalError(`an expression the evaluator does not read (${n.t})`)
    }
  }

  // x.name, an unknown relabelled (its label: the last name reached; its text: the whole path
  // while the path is the one that met it, else where it came from). An error names the attribute as
  // the source writes it (`shown`): a key computed by x[expr] is named by its expression, never by
  // its value, since a note keeps the error.
  attr(x, name, n, shown = `"${name}"`) {
    if (x instanceof Lazy) {
      if (!x.has(name)) throw new EvalError(`no attribute ${shown}`)
      const v = x.fetch(name, this)
      return isUnk(v) ? this.relabel(v, name, n) : v
    }
    if (isUnk(x)) return this.relabel(x, name, n)
    if (isObj(x)) {
      if (!(name in x)) throw new EvalError(`no attribute ${shown}`)
      const v = x[name]
      this.last = memberAt(x, name) ?? this.last
      return isUnk(v) ? this.relabel(v, name, n) : v
    }
    throw new EvalError(`no attribute ${shown} on a ${kind(x)}`)
  }
  relabel(v, label, n) {
    if (v instanceof Partial) return v
    // fresh: met by this very path (its text grows with it), else sealed with where it came from
    const fresh = v.chain ? v.chain === n.x : v.origin === null
    return new Unknown(v.why, label, fresh ? v.origin : v.text, n)
  }
  index(x, k, n) {
    if (isUnk(k)) return seal(k)
    const lit = n.key && n.key.t === 'lit'
    const shown = lit ? `"${n.key.v}"` : n.key ? `[${refText(n.key)}]` : '[…]'
    if (x instanceof Lazy) return this.attr(x, String(k), n, shown)
    if (isUnk(x)) return this.relabel(x, lit && typeof k === 'string' ? k : (x.label ?? null), n)
    if (Array.isArray(x)) {
      if (typeof k !== 'number' || !Number.isInteger(k)) throw new EvalError('a list index is a whole number')
      if (k < 0 || k >= x.length) throw new EvalError('a list index out of range')
      this.last = itemAt(x, k) ?? this.last
      return x[k]
    }
    if (isObj(x)) {
      const key = typeof k === 'number' || typeof k === 'boolean' ? String(k) : k
      if (typeof key !== 'string') throw new EvalError('an object key is a string')
      return this.attr(x, key, n, shown)
    }
    throw new EvalError(`no index into a ${kind(x)}`)
  }

  template(n, sc) {
    if (n.single) return this.walk(n.parts[0].x, sc)
    const out = []
    const size = { n: 0 }
    this.render(n.parts, sc, out, size)
    this.last = at(sc, n)
    return joinParts(out)
  }
  render(list, sc, out, size) {
    for (const p of list) {
      this.tick()
      if (typeof p === 'string') { this.put(p, out, size); continue }
      if (p.t === 'interp') { this.put(this.value(p.x, sc), out, size); continue }
      if (p.t === 'if') {
        const c = this.value(p.cond, sc)
        if (isUnk(c)) { out.push(seal(c)); continue }
        if (typeof c !== 'boolean') throw new EvalError(`a template condition is a bool, not a ${kind(c)}`)
        this.render(c ? p.then : (p.else || []), sc, out, size)
        continue
      }
      if (p.t === 'for') {
        const coll = this.value(p.coll, sc)
        if (isUnk(coll)) { out.push(seal(coll)); continue }
        for (const [k, v, a] of this.entries(coll)) this.render(p.body, child(sc, { ...(p.k ? { [p.k]: k } : {}), [p.v]: v }, { [p.v]: a }), out, size)
      }
    }
  }
  put(v, out, size) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const s = String(v)
      if ((size.n += s.length) > STR_MAX) throw new BudgetError(`a string past ${STR_MAX >> 10} KB`)
      out.push(s)
      return
    }
    if (v instanceof Unknown) { out.push(seal(v)); return }
    if (v instanceof Partial) { for (const q of v.parts) this.put(q, out, size); return }
    if (v === null) throw new EvalError('a null in a string template')
    throw new EvalError(`a ${kind(v)} in a string template`)
  }

  // the members of a collection, in Terraform's order: [key, value, origin]
  entries(coll) {
    coll = this.mat(coll)
    if (Array.isArray(coll)) return coll.map((v, i) => [coll[SET] ? v : i, v, itemAt(coll, i)])
    if (isObj(coll)) return Object.keys(coll).sort(cmp).map((k) => [k, coll[k], memberAt(coll, k)])
    throw new EvalError(`a for takes a list, a set, a map or an object, not a ${kind(coll)}`)
  }
  forExpr(n, sc) {
    const coll = this.value(n.coll, sc)
    if (isUnk(coll)) return seal(coll)
    const tuple = n.kind === 'tuple'
    const out = tuple ? [] : obj(), items = [], members = new Map()
    for (const [k, v, a] of this.entries(coll)) {
      this.tick()
      const s2 = child(sc, { ...(n.k ? { [n.k]: k } : {}), [n.v]: v }, { [n.v]: a, ...(n.k ? { [n.k]: a } : {}) })
      if (n.cond) {
        const c = this.value(n.cond, s2)
        if (isUnk(c)) return seal(c)
        if (typeof c !== 'boolean') throw new EvalError(`a for's if is a bool, not a ${kind(c)}`)
        if (!c) continue
      }
      this.last = null
      if (tuple) { out.push(this.value(n.value, s2)); items.push(this.last ?? at(sc, n.value)); continue }
      const key = this.value(n.key, s2)
      if (isUnk(key)) return seal(key)
      if (key === null || typeof key === 'object') throw new EvalError('a for expression\'s key is a string')
      const kk = String(key)
      this.last = null
      const val = this.value(n.value, s2)
      if (!this.last) this.last = at(sc, n.value)
      if (n.group) { if (!(kk in out)) { out[kk] = []; members.set(kk, this.last) } out[kk].push(val) } else {
        if (kk in out) throw new EvalError('a for expression made two items with one key (group them with ...)')
        out[kk] = val; members.set(kk, this.last)
      }
    }
    ORIGIN.set(out, { ...at(sc, n), ...(tuple ? { items } : { members }) })
    this.last = at(sc, n)
    return out
  }

  binop(n, sc) {
    const { op } = n
    const l = this.value(n.l, sc), r = this.value(n.r, sc)
    this.last = at(sc, n)
    if (op === '&&' || op === '||') {
      if (op === '&&' && (l === false || r === false)) return false
      if (op === '||' && (l === true || r === true)) return true
      if (isUnk(l)) return seal(l)
      if (isUnk(r)) return seal(r)
      if (typeof l !== 'boolean' || typeof r !== 'boolean') throw new EvalError(`${op} takes bools`)
      return op === '&&' ? l && r : l || r
    }
    if (isUnk(l)) return seal(l)
    if (isUnk(r)) return seal(r)
    if (op === '==' || op === '!=') {
      const eq = this.equal(l, r)
      if (isUnk(eq)) return eq
      return op === '==' ? eq : !eq
    }
    const a = num(l), b = num(r)
    if (typeof a !== 'number' || typeof b !== 'number') throw new EvalError(`${op} takes numbers`)
    switch (op) {
      case '<': return a < b
      case '>': return a > b
      case '<=': return a <= b
      case '>=': return a >= b
      case '+': return a + b
      case '-': return a - b
      case '*': return a * b
      case '/': if (b === 0) throw new EvalError('a division by zero'); return a / b
      case '%': if (b === 0) throw new EvalError('a division by zero'); return a % b
    }
    throw new EvalError(`an unknown operator ${op}`)
  }
  // equal, not equal, or unknown when an unknown part decides it
  equal(a, b, d = 0) {
    this.tick()
    deepest(d)
    if (isUnk(a)) return seal(a)
    if (isUnk(b)) return seal(b)
    a = this.mat(a); b = this.mat(b)
    if (a === b) return true
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      let unk = null
      for (let i = 0; i < a.length; i++) { const e = this.equal(a[i], b[i], d + 1); if (e === false) return false; if (isUnk(e)) unk = e }
      return unk || true
    }
    if (isObj(a) && isObj(b)) {
      const ka = Object.keys(a), kb = Object.keys(b)
      if (ka.length !== kb.length || ka.some((k) => !(k in b))) return false
      let unk = null
      for (const k of ka) { const e = this.equal(a[k], b[k], d + 1); if (e === false) return false; if (isUnk(e)) unk = e }
      return unk || true
    }
    return false
  }

  call(n, sc) {
    const name = n.name
    if (LAZY[name]) return LAZY[name].call(this, n, sc)
    const fn = sc.root.fns?.[name] ?? FNS[name]
    if (!fn) return new Unknown(`${name}(): a function the evaluator does not run`, name, `${name}(…)`)
    let args = [], ats = []
    for (const a of n.args) { args.push(this.value(a, sc)); ats.push(this.last) }
    if (n.expand) {
      const last = args.pop(); ats.pop()
      if (isUnk(last)) return seal(last)
      if (!Array.isArray(last)) throw new EvalError(`${name}(…): only a list expands into arguments`)
      last.forEach((v, i) => { args.push(v); ats.push(itemAt(last, i)) })
    }
    if (!fn.unknowns) { const u = args.find(isUnk); if (u) return seal(u) }
    this.last = at(sc, n)
    return fn.call(this, args, { n, sc, ats })
  }
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const num = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v)

// joined parts: a string when all are known, else a Partial (neighbouring strings merged)
function joinParts(parts) {
  if (parts.every((p) => typeof p === 'string')) return parts.join('')
  const out = []
  for (const p of parts) { if (typeof p === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] += p; else out.push(p) }
  return new Partial(out)
}
// a deep scan for an unknown inside a value (bounded by the evaluator's budget)
function hasUnk(ev, v, d = 0) {
  ev.tick()
  deepest(d)
  if (isUnk(v)) return v
  if (Array.isArray(v)) { for (const x of v) { const u = hasUnk(ev, x, d + 1); if (u) return u } }
  else if (isObj(v)) { for (const k in v) { const u = hasUnk(ev, v[k], d + 1); if (u) return u } }
  return null
}
// A value nested deeper than any table declaration nests (one from outside, say): refused, rather
// than walked until the stack runs out
export const VALUE_DEPTH = 256
const JSON_DEPTH = 200
const deepest = (d) => { if (d > VALUE_DEPTH) throw new BudgetError(`a value nests deeper than ${VALUE_DEPTH} levels`) }
const listArg = (fn, v) => { if (!Array.isArray(v)) throw new EvalError(`${fn}() takes a list, not a ${kind(v)}`); return v }
const strArg = (fn, v) => { if (typeof v === 'number' || typeof v === 'boolean') return String(v); if (typeof v !== 'string') throw new EvalError(`${fn}() takes a string, not a ${kind(v)}`); return v }
const keyOfValue = (v) => (typeof v === 'string' ? `s${v}` : JSON.stringify(v))
function listOut(list, ats) { ORIGIN.set(list, { path: null, line: null, items: ats }); return list }

// try() and can() see their arguments' errors, so they evaluate them themselves
const LAZY = {
  try(n, sc) {
    for (const a of n.args) {
      try { return this.value(a, sc) } catch (e) { if (!(e instanceof EvalError)) throw e }
    }
    throw new EvalError('try(): no argument could be evaluated')
  },
  can(n, sc) {
    try {
      const v = this.value(n.args[0], sc)
      this.last = at(sc, n)
      return isUnk(v) ? seal(v) : true
    } catch (e) { if (!(e instanceof EvalError)) throw e; this.last = at(sc, n); return false }
  },
}

// Terraform's functions the evaluator runs: pure ones, over the values alone. `this` is the
// evaluator; ats are the arguments' origins. A function marked `unknowns` sees unknown arguments
// (the others are unknown when one argument is).
const fn = (f, unknowns = false) => Object.assign(f, { unknowns })
export const FNS = {
  lookup: fn(function ([m, k, ...d], { ats }) {
    if (!isObj(m)) throw new EvalError(`lookup() takes a map, not a ${kind(m)}`)
    if (typeof k !== 'string') throw new EvalError('lookup() takes a string key')
    if (k in m) { this.last = memberAt(m, k) ?? this.last; return m[k] }
    if (d.length) { this.last = ats[2] ?? this.last; return d[0] }
    throw new EvalError('lookup(): the key is not in the map, and there is no default')
  }),
  merge: fn(function (ms) {
    const o = obj(), members = new Map()
    for (const m of ms) {
      if (m === null) continue
      if (!isObj(m)) throw new EvalError(`merge() takes maps or objects, not a ${kind(m)}`)
      for (const k of Object.keys(m)) { this.tick(); o[k] = m[k]; members.set(k, memberAt(m, k)) }
    }
    ORIGIN.set(o, { ...this.last, members })
    return o
  }),
  coalesce: fn(function (vs, { ats }) {
    for (let i = 0; i < vs.length; i++) {
      if (isUnk(vs[i])) return seal(vs[i]) // it may be null or empty: what comes after it is not known to win
      if (vs[i] !== null && vs[i] !== '') { this.last = ats[i] ?? this.last; return vs[i] }
    }
    throw new EvalError('coalesce(): no argument that is not null or empty')
  }, true),
  compact: fn(function ([l]) {
    listArg('compact', l)
    const u = hasUnk(this, l); if (u) return seal(u)
    const out = [], ats = []
    l.forEach((v, i) => { if (v !== null && v !== '') { out.push(v); ats.push(itemAt(l, i)) } })
    return listOut(out, ats)
  }),
  flatten: fn(function ([l]) {
    listArg('flatten', l)
    const out = [], ats = []
    const walk = (x, a, d) => {
      this.tick()
      deepest(d)
      if (isUnk(x)) throw x
      if (Array.isArray(x)) x.forEach((y, i) => walk(y, itemAt(x, i), d + 1))
      else { out.push(x); ats.push(a) }
    }
    try { l.forEach((y, i) => walk(y, itemAt(l, i), 1)) } catch (e) { if (e instanceof Unknown || e instanceof Partial) return seal(e); throw e }
    return listOut(out, ats)
  }),
  toset: fn(function ([l]) {
    listArg('toset', l)
    const u = hasUnk(this, l); if (u) return seal(u)
    const seen = new Map()
    l.forEach((v, i) => { this.tick(); const k = keyOfValue(v); if (!seen.has(k)) seen.set(k, [v, itemAt(l, i)]) })
    let pairs = [...seen.values()]
    if (pairs.every(([v]) => typeof v === 'string')) pairs = pairs.sort((a, b) => cmp(a[0], b[0]))
    return asSet(listOut(pairs.map(([v]) => v), pairs.map(([, a]) => a)))
  }),
  tolist: fn(function ([l]) { listArg('tolist', l); return listOut([...l], l.map((_, i) => itemAt(l, i))) }),
  tomap: fn(function ([m]) { if (!isObj(m)) throw new EvalError('tomap() takes an object'); return FNS.merge.call(this, [m]) }),
  concat: fn(function (ls) {
    const out = [], ats = []
    for (const l of ls) { listArg('concat', l); l.forEach((v, i) => { this.tick(); out.push(v); ats.push(itemAt(l, i)) }) }
    return listOut(out, ats)
  }),
  contains: fn(function ([l, v]) {
    listArg('contains', l)
    let unk = null
    for (const x of l) { const e = this.equal(x, v); if (e === true) return true; if (isUnk(e)) unk = e }
    return unk || false
  }),
  length: fn(function ([x]) {
    if (Array.isArray(x)) return x.length
    if (isObj(x)) return Object.keys(x).length
    if (typeof x === 'string') return [...x].length
    throw new EvalError(`length() of a ${kind(x)}`)
  }),
  keys: fn(function ([m]) { if (!isObj(m)) throw new EvalError('keys() takes a map'); const ks = Object.keys(m).sort(cmp); return listOut(ks, ks.map((k) => memberAt(m, k))) }),
  values: fn(function ([m]) { if (!isObj(m)) throw new EvalError('values() takes a map'); const ks = Object.keys(m).sort(cmp); return listOut(ks.map((k) => m[k]), ks.map((k) => memberAt(m, k))) }),
  distinct: fn(function ([l]) {
    listArg('distinct', l)
    const u = hasUnk(this, l); if (u) return seal(u)
    const seen = new Set(), out = [], ats = []
    l.forEach((v, i) => { const k = keyOfValue(v); if (!seen.has(k)) { seen.add(k); out.push(v); ats.push(itemAt(l, i)) } })
    return listOut(out, ats)
  }),
  element: fn(function ([l, i]) {
    listArg('element', l)
    if (!l.length) throw new EvalError('element() of an empty list')
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) throw new EvalError('element() takes a whole number')
    this.last = itemAt(l, i % l.length) ?? this.last
    return l[i % l.length]
  }),
  zipmap: fn(function ([ks, vs]) {
    listArg('zipmap', ks); listArg('zipmap', vs)
    if (ks.length !== vs.length) throw new EvalError('zipmap() takes two lists of one length')
    const o = obj(), members = new Map()
    ks.forEach((k, i) => { const key = strArg('zipmap', k); o[key] = vs[i]; members.set(key, itemAt(vs, i)) })
    ORIGIN.set(o, { ...this.last, members })
    return o
  }),
  lower: fn(function ([s]) { return strArg('lower', s).toLowerCase() }),
  upper: fn(function ([s]) { return strArg('upper', s).toUpperCase() }),
  trimspace: fn(function ([s]) { return strArg('trimspace', s).trim() }),
  startswith: fn(function ([s, p]) { return strArg('startswith', s).startsWith(strArg('startswith', p)) }),
  endswith: fn(function ([s, p]) { return strArg('endswith', s).endsWith(strArg('endswith', p)) }),
  replace: fn(function ([s, sub, rep]) {
    s = strArg('replace', s); sub = strArg('replace', sub); rep = strArg('replace', rep)
    if (sub.length > 1 && sub.startsWith('/') && sub.endsWith('/')) return new Unknown('replace() with a regular expression: not evaluated', 'replace', 'replace(…)')
    if (!sub) return s
    let count = 0
    for (let i = s.indexOf(sub); i >= 0; i = s.indexOf(sub, i + sub.length)) count++
    if (s.length + count * (rep.length - sub.length) > STR_MAX) throw new BudgetError(`a string past ${STR_MAX >> 10} KB`) // before the engine builds it
    return s.split(sub).join(rep)
  }),
  split: fn(function ([sep, s]) { const parts = strArg('split', s).split(strArg('split', sep)); return listOut(parts, parts.map(() => this.last)) }),
  join: fn(function ([sep, l]) {
    if (isUnk(sep)) return seal(sep)
    if (isUnk(l)) return seal(l)
    sep = strArg('join', sep); listArg('join', l)
    const out = [], size = { n: 0 }
    l.forEach((v, i) => { if (i) this.put(sep, out, size); this.put(v, out, size) })
    return joinParts(out)
  }, true),
  format: fn(function ([f, ...args]) {
    if (isUnk(f)) return seal(f)
    f = strArg('format', f)
    const out = [], size = { n: 0 }
    let a = 0, run = ''
    for (let i = 0; i < f.length; i++) {
      const c = f[i]
      if (c !== '%') { run += c; continue }
      const v = f[i + 1]
      if (v === '%') { run += '%'; i++; continue }
      if (v !== 's' && v !== 'v' && v !== 'd') return new Unknown(`format(): the verb %${v ?? ''} is not read`, 'format', 'format(…)')
      if (run) { this.put(run, out, size); run = '' }
      if (a >= args.length) throw new EvalError('format(): too few arguments')
      const x = args[a++]
      if (v === 'd' && !isUnk(x) && typeof num(x) !== 'number') throw new EvalError('format(): %d takes a number')
      this.put(v === 'd' && !isUnk(x) ? Math.trunc(num(x)) : x, out, size)
      i++
    }
    if (run) this.put(run, out, size)
    return joinParts(out)
  }, true),
  tostring: fn(function ([v]) { if (v === null) return null; if (typeof v === 'object') throw new EvalError(`tostring() of a ${kind(v)}`); return String(v) }),
  tonumber: fn(function ([v]) { if (v === null) return null; const x = num(v); if (typeof x !== 'number') throw new EvalError('tonumber(): not a number'); return x }),
  tobool: fn(function ([v]) { if (v === null || typeof v === 'boolean') return v; if (v === 'true' || v === 'false') return v === 'true'; throw new EvalError('tobool(): not a bool') }),
  jsondecode: fn(function ([s]) {
    s = strArg('jsondecode', s)
    if (deeperThan(s, JSON_DEPTH) >= 0) throw new EvalError(`jsondecode(): the JSON nests deeper than ${JSON_DEPTH} levels`)
    let v
    try { v = JSON.parse(s) } catch { throw new EvalError('jsondecode(): not JSON') }
    const conv = (x, d) => {
      this.tick()
      if (d > JSON_DEPTH) throw new EvalError(`jsondecode(): the JSON nests deeper than ${JSON_DEPTH} levels`)
      if (Array.isArray(x)) return x.map((y) => conv(y, d + 1))
      if (x && typeof x === 'object') { const o = obj(); for (const k of Object.keys(x)) o[k] = conv(x[k], d + 1); return o }
      return x
    }
    return conv(v, 0)
  }),
  dirname: fn(function ([p]) { return P.dirname(strArg('dirname', p)) }),
  basename: fn(function ([p]) { return P.basename(strArg('basename', p)) }),
}

// ── types: a variable's `type`, read (never evaluated) and applied to its value ──
const PRIMS = new Set(['string', 'number', 'bool', 'any'])
export function typeOf(n) {
  if (!n) return { k: 'any' }
  if (n.t === 'var') return { k: PRIMS.has(n.name) ? n.name : 'any' }
  if (n.t === 'call') {
    const a = n.args
    if (n.name === 'list' || n.name === 'set' || n.name === 'map') return { k: n.name, of: typeOf(a[0]) }
    if (n.name === 'object' && a[0]?.t === 'object') {
      const attrs = new Map()
      for (const it of a[0].items) {
        if (it.key.t !== 'lit') continue
        const v = it.value
        if (v.t === 'call' && v.name === 'optional') attrs.set(String(it.key.v), { type: typeOf(v.args[0]), optional: true, def: v.args[1] ?? null })
        else attrs.set(String(it.key.v), { type: typeOf(v), optional: false, def: null })
      }
      return { k: 'object', attrs }
    }
    if (n.name === 'tuple' && a[0]?.t === 'tuple') return { k: 'tuple', items: a[0].items.map(typeOf) }
  }
  return { k: 'any' }
}
// a value conformed to a type, as Terraform converts it: an object's attributes it does not declare
// dropped, the optional ones it lacks filled with their default (or null), a set made a set
export function conform(ev, v, T, sc) {
  ev.tick()
  if (isUnk(v) || v === null || T.k === 'any') return v
  v = ev.mat(v)
  switch (T.k) {
    case 'string': return typeof v === 'number' || typeof v === 'boolean' ? String(v) : v
    case 'number': return num(v)
    case 'bool': return v === 'true' ? true : v === 'false' ? false : v
    case 'list': case 'set': {
      if (!Array.isArray(v)) return v
      const out = v.map((x) => conform(ev, x, T.of, sc))
      listOut(out, v.map((_, i) => itemAt(v, i)))
      return T.k === 'set' ? FNS.toset.call(ev, [out]) : out
    }
    case 'tuple': {
      if (!Array.isArray(v)) return v
      return listOut(v.map((x, i) => (T.items[i] ? conform(ev, x, T.items[i], sc) : x)), v.map((_, i) => itemAt(v, i)))
    }
    case 'map': {
      if (!isObj(v)) return v
      const o = obj(), members = new Map()
      for (const k of Object.keys(v)) { o[k] = conform(ev, v[k], T.of, sc); members.set(k, memberAt(v, k)) }
      ORIGIN.set(o, { ...(originOf(v) || {}), members })
      return o
    }
    case 'object': {
      if (!isObj(v)) return v
      const o = obj(), members = new Map()
      for (const [k, a] of T.attrs) {
        if (k in v) { o[k] = conform(ev, v[k], a.type, sc); members.set(k, memberAt(v, k)) } else if (a.optional) o[k] = a.def ? conform(ev, ev.value(a.def, sc), a.type, sc) : null
      }
      ORIGIN.set(o, { ...(originOf(v) || {}), members })
      return o
    }
  }
  return v
}

// ── Terraform: a module, the .tf files of one folder ──
// files: [{ path, body }] → { variables: Map(name → { def, type, path, line }), locals: Map(name →
// { expr, path, line }), resources: [{ type, name, block, path }], calls: module blocks }
export function readModule(files) {
  const variables = new Map(), locals = new Map(), resources = [], calls = []
  for (const { path: file, body } of files) {
    for (const it of body.items) {
      if (it.t !== 'block') continue
      if (it.type === 'variable' && it.labels.length === 1) {
        const a = attrs(it.body)
        variables.set(it.labels[0], { def: a.get('default')?.expr ?? null, type: a.get('type')?.expr ?? null, path: file, line: it.line })
      } else if (it.type === 'locals') {
        for (const x of it.body.items) if (x.t === 'attr') locals.set(x.name, { expr: x.expr, path: file, line: x.line })
      } else if (it.type === 'resource' && it.labels.length === 2) resources.push({ type: it.labels[0], name: it.labels[1], block: it, path: file })
      else if (it.type === 'module' && it.labels.length === 1) calls.push({ name: it.labels[0], block: it, path: file })
    }
  }
  return { variables, locals, resources, calls }
}
export const attrs = (body) => new Map(body.items.filter((x) => x.t === 'attr').map((x) => [x.name, x]))

// The scope a module's expressions are evaluated in. values: Map(name → { v, at }), what the caller
// sets (Terragrunt inputs, tfvars, a module block's arguments); a variable not set takes its default.
export function moduleScope(mod, values, { dir = '.' } = {}) {
  const root = { fns: null }
  const sc = scopeOf(root, null)
  const vars = new Lazy(() => [...mod.variables.keys()], (name, ev) => {
    const d = mod.variables.get(name)
    const vsc = child(sc, {}, {}, d.path)
    let v
    if (values.has(name)) { const x = values.get(name); v = x.v; ev.last = x.at ?? { path: d.path, line: d.line } }
    else if (d.def) v = ev.value(d.def, vsc)
    else { ev.last = { path: d.path, line: d.line }; return new Unknown(`var.${name}: no value is set (no default, no tfvars, no input)`, name, `var.${name}`) }
    const keep = ev.last
    const out = d.type ? conform(ev, v, typeOf(d.type), vsc) : v
    ev.last = keep
    return out
  })
  const locals = new Lazy(() => [...mod.locals.keys()], (name, ev) => { const l = mod.locals.get(name); return ev.value(l.expr, child(sc, {}, {}, l.path)) })
  root.ns = (name, n, s, ev) => {
    switch (name) {
      case 'var': return vars
      case 'local': return locals
      case 'each': case 'count': throw new EvalError(`${name} is set only inside a resource with ${name === 'each' ? 'for_each' : 'count'}`)
      case 'path': return new Unknown('path.*: a path on the machine that runs it', 'path', null, n)
      case 'terraform': return new Unknown('terraform.*: the workspace it runs in', 'terraform', null, n)
      case 'data': return new Unknown('a data source, read only when it runs', 'data', null, n)
      case 'module': return new Unknown("another module's output, known only once it is applied", 'module', null, n)
      case 'self': return new Unknown('self: known only once it is applied', 'self', null, n)
      default: return new Unknown(`${name}: another resource's attribute, known only once it is applied`, name, null, n)
    }
  }
  return { scope: sc, dir }
}

// A resource's instances: [{ key, scope, at }] (one per for_each key or count index, or one), or
// { unknown } when for_each or count is not known, or { error }.
export function instancesOf(res, sc, ev) {
  const a = attrs(res.block.body)
  const rsc = child(sc, {}, {}, res.path)
  if (a.has('for_each')) {
    let v
    try { v = ev.value(a.get('for_each').expr, rsc) } catch (e) { if (e instanceof EvalError) return { error: `for_each: ${e.message}` }; throw e }
    if (isUnk(v)) return { unknown: seal(v) }
    if (isObj(v)) return { list: Object.keys(v).sort(cmp).map((k) => { const each = obj(); each.key = k; each.value = v[k]; const m = memberAt(v, k); ORIGIN.set(each, { ...(m || {}), members: new Map([['key', m], ['value', m]]) }); return { key: k, scope: child(rsc, { each }), at: m } }) }
    if (Array.isArray(v) && v[SET]) {
      if (!v.every((x) => typeof x === 'string')) return { error: 'for_each: a set holds strings only' }
      return { list: v.map((k, i) => { const each = obj(); each.key = k; each.value = k; const m = itemAt(v, i); ORIGIN.set(each, { ...(m || {}), members: new Map([['key', m], ['value', m]]) }); return { key: k, scope: child(rsc, { each }), at: m } }) }
    }
    return { error: `for_each takes a map or a set (toset()), not a ${kind(v)}` }
  }
  if (a.has('count')) {
    let v
    try { v = num(ev.value(a.get('count').expr, rsc)) } catch (e) { if (e instanceof EvalError) return { error: `count: ${e.message}` }; throw e }
    if (isUnk(v)) return { unknown: seal(v) }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { error: 'count is a whole number' }
    if (v > 10_000) return { error: 'count past 10 000' }
    return { list: Array.from({ length: v }, (_, i) => { const count = obj(); count.index = i; return { key: i, scope: child(rsc, { count }), at: null } }) }
  }
  return { list: [{ key: null, scope: rsc, at: null }] }
}

// An attribute of a body, evaluated: { has, v, at, line }; an error that escapes it is an unknown
// value saying why (never a guess).
export function attrOf(body, name, sc, ev) {
  const x = body.items.find((i) => i.t === 'attr' && i.name === name)
  if (!x) return { has: false, v: null, at: null, line: null }
  ev.last = null
  try {
    const v = ev.value(x.expr, sc)
    return { has: true, v, at: ev.last, line: x.line }
  } catch (e) {
    if (!(e instanceof EvalError)) throw e
    return { has: true, v: new Unknown(`${name}: not evaluated (${e.message})`, name, refText(x.expr)), at: null, line: x.line }
  }
}
// The blocks of a type in a body, static and `dynamic` ones expanded: [{ body, scope, line, at }],
// and the unknowns met (a dynamic block whose for_each is not known: how many blocks it makes is not
// known either).
export function blocksOf(body, type, sc, ev) {
  const list = [], unknown = []
  for (const it of body.items) {
    if (it.t !== 'block') continue
    if (it.type === type) { list.push({ body: it.body, scope: sc, line: it.line, at: null }); continue }
    if (it.type !== 'dynamic' || it.labels[0] !== type) continue
    const a = attrs(it.body)
    const content = it.body.items.find((x) => x.t === 'block' && x.type === 'content')
    if (!content || !a.has('for_each')) continue
    const iter = a.get('iterator')?.expr.t === 'var' ? a.get('iterator').expr.name : type
    let coll
    try { coll = ev.value(a.get('for_each').expr, sc) } catch (e) {
      if (!(e instanceof EvalError)) throw e
      unknown.push(new Unknown(`dynamic "${type}": its for_each is not evaluated (${e.message})`, type, refText(a.get('for_each').expr))); continue
    }
    if (isUnk(coll)) { unknown.push(seal(coll)); continue }
    if (coll === null) continue
    let members
    try { members = ev.entries(coll) } catch (e) {
      if (!(e instanceof EvalError)) throw e
      unknown.push(new Unknown(`dynamic "${type}": ${e.message}`, type, refText(a.get('for_each').expr))); continue
    }
    for (const [k, v, m] of members) {
      ev.tick()
      const o = obj(); o.key = k; o.value = v
      ORIGIN.set(o, { ...(m || { path: sc.file, line: it.line }), members: new Map([['key', m], ['value', m]]) })
      list.push({ body: content.body, scope: child(sc, { [iter]: o }), line: it.line, at: m, dynamic: true })
    }
  }
  return { list, unknown }
}

// A tfvars file's values: Map(name → { v, at }). Its attributes are literal values (Terraform takes
// nothing else there): a reference or a function is not evaluated (unknown).
export function tfvarsValues(file, body, ev) {
  const root = { fns: null, ns: (name, n) => { throw new EvalError(`${name}: a tfvars file holds values, not references`) } }
  const sc = scopeOf(root, file)
  const out = new Map()
  for (const x of body.items) {
    if (x.t !== 'attr') continue
    ev.last = null
    try { const v = ev.value(x.expr, sc); out.set(x.name, { v, at: ev.last ?? { path: file, line: x.line } }) } catch (e) {
      if (!(e instanceof EvalError)) throw e
      out.set(x.name, { v: new Unknown(`${x.name}: not evaluated (${e.message})`, x.name, x.name), at: { path: file, line: x.line } })
    }
  }
  return out
}
// A JSON value with each member's line (lines: readers/json-lines.mjs jsonLines, keyed by pathKey).
export function jsonValues(file, value, lines, keyOf, ev) {
  const walk = (x, p) => {
    ev.tick()
    const line = lines.get(keyOf(...p)) ?? 1
    if (Array.isArray(x)) { const out = x.map((y, i) => walk(y, [...p, i])); ORIGIN.set(out, { path: file, line, items: x.map((_, i) => ({ path: file, line: lines.get(keyOf(...p, i)) ?? line })) }); return out }
    if (x && typeof x === 'object') {
      const o = obj(), members = new Map()
      for (const k of Object.keys(x)) { o[k] = walk(x[k], [...p, k]); members.set(k, { path: file, line: lines.get(keyOf(...p, k)) ?? line }) }
      ORIGIN.set(o, { path: file, line, members })
      return o
    }
    return x
  }
  const out = new Map()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const k of Object.keys(value)) out.set(k, { v: walk(value[k], [k]), at: { path: file, line: lines.get(keyOf(k)) ?? 1 } })
  return out
}

// ── Terragrunt: a configuration (terragrunt.hcl), its includes, inputs and module source ──
// fsx: { has(path), body(path) → parsed body (throws when it does not parse) }, repository-relative
// paths. A virtual absolute path (/a/b) is the repository's a/b.
export const repoPath = (p) => P.normalize(p.replace(/^\/+/, '') || '.')
const virt = (dir) => (dir === '.' ? '/' : `/${dir}`)

export class Terragrunt {
  // file: this configuration; cfg: the configuration being run (whose folder the path functions
  // answer for: the child, even inside an included file); includeDir: the folder of the include
  // being read (for get_parent_terragrunt_dir, path_relative_to_include)
  constructor(file, fsx, ev, { cfg = file, includeDir = null, top = true } = {}) {
    this.file = file; this.fsx = fsx; this.ev = ev; this.cfg = cfg; this.includeDir = includeDir; this.top = top
    this.notes = []
    this.body = fsx.body(file)
    this.root = { ns: (name, n, s, e) => this.ns(name, n, e), fns: this.functions() }
    this.sc = scopeOf(this.root, file)
    this.localAttrs = new Map()
    for (const it of this.body.items) if (it.t === 'block' && it.type === 'locals') for (const x of it.body.items) if (x.t === 'attr') this.localAttrs.set(x.name, x)
    this.locals = new Lazy(() => [...this.localAttrs.keys()], (name, e) => e.value(this.localAttrs.get(name).expr, this.sc), { path: file, line: 1 })
    this._includes = null
  }
  get dir() { return P.dirname(this.cfg) }
  ns(name, n, ev) {
    switch (name) {
      case 'local': return this.locals
      case 'include': return this.includeNs()
      case 'dependency': return new Lazy(() => this.blockNames('dependency'), (k) => new Unknown(`dependency.${k}: another configuration's output, known only once it is applied`, k))
      case 'feature': case 'values': return new Unknown(`${name}.*: set when it runs`, name, null, n)
      default: throw new EvalError(`${name} is not defined in a Terragrunt configuration`)
    }
  }
  blockNames(type) { return this.body.items.filter((x) => x.t === 'block' && x.type === type && x.labels.length).map((x) => x.labels[0]) }
  topAttr(name) { return this.body.items.find((x) => x.t === 'attr' && x.name === name) || null }
  // what include.<name> or read_terragrunt_config() exposes: locals, inputs, the other attributes
  view() {
    const names = () => ['locals', ...this.body.items.filter((x) => x.t === 'attr').map((x) => x.name), ...(this.blockNames('dependency').length ? ['dependency'] : [])]
    return new Lazy(names, (k, ev) => (k === 'locals' ? this.locals : k === 'dependency' ? this.ns('dependency', null, ev) : ev.value(this.topAttr(k).expr, this.sc)), { path: this.file, line: 1 })
  }
  // this configuration's include blocks, each read (only the configuration being run includes: an
  // include inside an included file is not followed, as Terragrunt does not)
  includes() {
    if (this._includes) return this._includes
    this._includes = []
    for (const it of this.body.items) {
      if (it.t !== 'block' || it.type !== 'include') continue
      const name = it.labels[0] ?? ''
      const a = attrs(it.body)
      const inc = { name, line: it.line, expose: false, strategy: 'shallow', cfg: null, unknown: null }
      this._includes.push(inc)
      if (!this.top) { this.notes.push(`${this.file}:${it.line}: an include inside an included file is not followed`); continue }
      const flag = (k, d) => { if (!a.has(k)) return d; try { return this.ev.value(a.get(k).expr, this.sc) } catch (e) { if (e instanceof EvalError) return d; throw e } }
      inc.expose = flag('expose', false) === true
      const st = flag('merge_strategy', 'shallow')
      inc.strategy = typeof st === 'string' ? st : 'shallow'
      if (!a.has('path')) { inc.unknown = new Unknown(`include "${name}": it has no path`, name); continue }
      let p
      try { p = this.ev.value(a.get('path').expr, this.sc) } catch (e) { if (!(e instanceof EvalError)) throw e; p = new Unknown(`include "${name}": its path is not evaluated (${e.message})`, name) }
      if (isUnk(p)) { inc.unknown = seal(p); continue }
      if (typeof p !== 'string') { inc.unknown = new Unknown(`include "${name}": its path is not a string`, name); continue }
      const file = repoPath(p.startsWith('/') ? p : P.join(P.dirname(this.file), p))
      if (!this.fsx.has(file)) { inc.unknown = new Unknown(`include "${name}": its path ${said(a.get('path').expr)} names no HCL file of the repository`, name); continue }
      try { inc.cfg = new Terragrunt(file, this.fsx, this.ev, { cfg: this.cfg, includeDir: P.dirname(file), top: false }) } catch (e) {
        if (e instanceof EvalError || e instanceof BudgetError) throw e
        inc.unknown = new Unknown(`include "${name}": ${file} does not parse (${String(e.message).split('\n')[0]})`, name)
      }
    }
    return this._includes
  }
  includeNs() {
    const exposed = () => this.includes().filter((i) => i.expose)
    return new Lazy(() => exposed().map((i) => i.name), (k) => { const i = exposed().find((x) => x.name === k); return i.cfg ? i.cfg.view() : i.unknown })
  }
  // the inputs, merged with each include's as Terragrunt merges them (pkg/config/include.go
  // handleInclude): bottom-up, the last include's under the configuration's, then each earlier one's
  // under that, so the configuration wins over every include and a later include over an earlier
  // one; each step as that include's merge_strategy says: `shallow` (the default) replaces whole
  // top-level inputs, `deep` merges maps key by key and appends lists, the include's items first
  // (mergo.Merge WithAppendSlice, WithOverride), the configuration's scalars winning; `no_merge`
  // takes nothing. → { v: object | Unknown, notes }
  inputs() {
    const ev = this.ev
    const own = this.topAttr('inputs')
    let acc = obj()
    if (own) acc = attrValue(ev, own, this.sc)
    else ORIGIN.set(acc, { path: this.file, line: 1, members: new Map() })
    if (isUnk(acc)) return { v: acc, notes: this.notes }
    if (!isObj(acc)) return { v: new Unknown('inputs is not an object', 'inputs'), notes: this.notes }
    const incs = this.includes()
    for (let i = incs.length - 1; i >= 0; i--) {
      const inc = incs[i]
      if (inc.strategy === 'no_merge') continue
      if (inc.unknown) { this.notes.push(`${inc.unknown.why}: its inputs, if any, are not known`); continue }
      const theirs = inc.cfg.topAttr('inputs')
      if (!theirs) continue
      const v = attrValue(ev, theirs, inc.cfg.sc)
      if (isUnk(v)) { this.notes.push(`include "${inc.name}": its inputs are not known (${seal(v).why})`); continue }
      if (!isObj(v)) continue
      acc = mergeInto(v, acc, inc.strategy === 'deep', ev)
    }
    return { v: acc, notes: this.notes }
  }
  // the module this configuration runs: terraform { source }, its own or an include's: { v, at }
  source() {
    const find = (cfg) => {
      for (const it of cfg.body.items) {
        if (it.t !== 'block' || it.type !== 'terraform') continue
        const s = attrs(it.body).get('source')
        if (s) return { v: attrValue(this.ev, s, cfg.sc), at: { path: cfg.file, line: s.line } }
      }
      return null
    }
    const mine = find(this)
    if (mine) return mine
    for (const inc of [...this.includes()].reverse()) { // a later include over an earlier one, as inputs merge
      if (inc.strategy === 'no_merge') continue
      if (inc.unknown) continue
      const s = find(inc.cfg)
      if (s) return s
    }
    return null
  }
  functions() {
    const self = this
    const unknown = (why, label) => new Unknown(why, label, `${label}(…)`)
    const F = {
      find_in_parent_folders: fn(function ([name = 'terragrunt.hcl', ...fallback], { n }) {
        name = strArg('find_in_parent_folders', name)
        for (let d = P.dirname(self.dir); self.dir !== '.'; d = P.dirname(d)) {
          const p = repoPath(P.join(d, name))
          if (self.fsx.has(p)) return `/${p}`
          if (d === '.' || d === '/' || d === '') break
        }
        if (fallback.length) return fallback[0]
        return unknown(`find_in_parent_folders(${n.args.length ? said(n.args[0]) : ''}): no such file above ${self.dir} among the repository's HCL files`, 'find_in_parent_folders')
      }),
      get_terragrunt_dir: fn(function () { return virt(self.dir) }),
      get_original_terragrunt_dir: fn(function () { return virt(self.dir) }),
      get_parent_terragrunt_dir: fn(function () { return virt(self.includeDir ?? self.dir) }),
      get_repo_root: fn(function () { return '/' }),
      get_path_from_repo_root: fn(function () { return self.dir }),
      get_path_to_repo_root: fn(function () { return P.relative(virt(self.dir), '/') || '.' }),
      path_relative_to_include: fn(function () { return self.includeDir ? (P.relative(virt(self.includeDir), virt(self.dir)) || '.') : '.' }),
      path_relative_from_include: fn(function () { return self.includeDir ? (P.relative(virt(self.dir), virt(self.includeDir)) || '.') : '.' }),
      read_terragrunt_config: fn(function ([p, ...fallback], { n }) {
        p = strArg('read_terragrunt_config', p)
        const file = repoPath(p.startsWith('/') ? p : P.join(P.dirname(self.file), p))
        if (!self.fsx.has(file)) return fallback.length ? fallback[0] : unknown(`read_terragrunt_config(${said(n.args[0])}): it names no HCL file of the repository`, 'read_terragrunt_config')
        let c
        try { c = new Terragrunt(file, self.fsx, self.ev, { cfg: file, top: false }) } catch (e) {
          if (e instanceof BudgetError) throw e
          return unknown(`read_terragrunt_config(): ${file} does not parse`, 'read_terragrunt_config')
        }
        return c.view()
      }),
      // an environment variable named by a literal is that name (and labels a name template); one
      // named by an expression is that expression, never its value
      get_env: fn(function ([name], { n }) {
        const a = n.args[0], lit = a && a.t === 'lit' && typeof name === 'string'
        const text = `get_env(${lit ? JSON.stringify(name.slice(0, 60)) : a ? refText(a) : ''})`
        return new Unknown(`${text}: the environment it runs in`, lit ? name.slice(0, 60) : 'get_env', text)
      }, true),
    }
    return F
  }
}
// an attribute's value; an error that escapes it is unknown, saying why
function attrValue(ev, x, sc) {
  ev.last = null
  try { return ev.value(x.expr, sc) } catch (e) {
    if (!(e instanceof EvalError)) throw e
    return new Unknown(`${x.name}: not evaluated (${e.message})`, x.name, refText(x.expr))
  }
}
// b over a (b wins), shallow, or deep: nested objects merged key by key, lists appended (a's items,
// then b's), any other value b's; origins kept
function mergeInto(a, b, deep, ev = null, d = 0) {
  ev?.tick()
  deepest(d)
  const o = obj(), members = new Map()
  for (const k of Object.keys(a)) { o[k] = a[k]; members.set(k, memberAt(a, k)) }
  for (const k of Object.keys(b)) {
    if (deep && isObj(o[k]) && isObj(b[k])) o[k] = mergeInto(o[k], b[k], true, ev, d + 1)
    else if (deep && Array.isArray(o[k]) && Array.isArray(b[k])) o[k] = listOut([...o[k], ...b[k]], [...o[k].map((_, i) => itemAt(o[k], i)), ...b[k].map((_, i) => itemAt(b[k], i))])
    else o[k] = b[k]
    members.set(k, memberAt(b, k))
  }
  ORIGIN.set(o, { ...(originOf(b) || {}), members })
  return o
}
// an argument or a path as the source writes it: a literal as written, else its expression (never a
// value it evaluates to: a note keeps it)
const said = (x) => (!x ? '' : x.t === 'lit' ? JSON.stringify(String(x.v).slice(0, 80)) : refText(x))

// A module source address: a folder of this repository ({ dir }), or out of reach ({ remote }: a
// git, registry or other remote address, kept without credentials or a query; { outside }: a path
// that leaves the repository).
export function moduleDir(source, fromDir) {
  if (/^(?:\.\.?\/|\/)/.test(source) || source === '.' || source === '..') {
    const local = source.replace(/\?.*$/, '')
    const dir = local.startsWith('/') ? repoPath(local) : P.normalize(P.join(fromDir, local))
    if (dir === '..' || dir.startsWith('../')) return { outside: true }
    return { dir: dir.replace(/\/+$/, '') || '.' }
  }
  return { remote: safeAddress(source) }
}
// an address as it can be shown: no user or password in it, no query string
export function safeAddress(s) {
  const a = String(s).slice(0, 400).replace(/\?.*$/s, '')
  const pre = /^(?:[a-z0-9.+-]+::)?(?:[a-z][a-z0-9.+-]*:\/\/)?/i.exec(a)[0] // a forced getter (git::), a scheme
  let rest = a.slice(pre.length)
  const slash = rest.indexOf('/')
  const at = (slash < 0 ? rest : rest.slice(0, slash)).lastIndexOf('@') // a password may hold an @: the last one ends it
  if (at >= 0) rest = rest.slice(at + 1)
  return (pre + rest).slice(0, 160)
}
