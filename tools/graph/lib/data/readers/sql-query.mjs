// grimoire graph · data · the SQL a project's code sends (SELECT, INSERT, UPDATE, DELETE, their
// RETURNING and ON CONFLICT), read statement by statement without a database and without a grammar
// (spec D9): what each statement names. It sits on readers/ddl.mjs's splitter and tokenizer, the seam
// slice 12 left for it, and is read by extractors/sql-queries.mjs from the string and template
// literals code passes to its query calls. Pure and bounded: one pass to split a text, one per
// statement to tokenize it, then a reader linear in its tokens; caps on bytes, statements, tokens,
// nesting and facts; nothing throws past readQueries. What is not read is noted by its line, never
// its text: a literal may hold a secret, so only identifiers are ever kept, never a value.
//
//   PARAM  the character an embedding reader puts where code fills something in (a template's ${…},
//          an f-string's {…}, a concatenated operand, a format verb): a parameter, never a name.
//   readQueries(text, { dialect, line }) → { statements: [Stmt], notes: [string], markers: [Marker] }
//     dialect: postgres | mysql | sqlite | null (the tokenizer's rules: readers/ddl.mjs); line: the
//     line `text` starts on in its file, so every fact carries the file's line.
//   isSql(text) → the text's first word is a statement's (what a literal must start with to be read)
//
//   Stmt   { line, kind: select | insert | update | delete | truncate | other, verb (other's first
//            word), tables: [{ name, line, role: read | write }], columns: [{ table, name, line, how }],
//            joins: [{ a: { table, columns }, b: { table, columns }, line }], conflict: { table,
//            columns, line } | null, lookups: [{ table, column, how: where | order, line }], casts:
//            [{ table, column, type, line }], unresolved, dynamic, ctes, notes? }
//            how: insert | set | select | where | join | group | having | order | returning | conflict
//            | expr. A table's name drops a `public.` qualifier and keeps any other (`audit.events`).
//   Marker { dialect, marker, line, weak? }   what the SQL itself says of its dialect
//
// What it reads, within one statement:
//   - tables: FROM and JOIN targets (a comma list, nested joins, LATERAL, ONLY), INSERT INTO,
//     REPLACE INTO, UPDATE (and MySQL's joined UPDATE), DELETE FROM (USING, MySQL's DELETE t FROM),
//     TRUNCATE; a CTE's name is no table (its body is read), nor a subquery, a table function or a
//     name built from a parameter (counted as `dynamic`);
//   - columns: qualified by an alias, a table name or `schema.table`, resolved within the statement
//     (a subquery sees the aliases around it); a bare name only where one table can hold it (else
//     counted as `unresolved`); `*` and `t.*` reveal none; an output alias is no column, nor a
//     function's name, a keyword, a typed literal's type or a cast's type;
//   - joins: `a.x = b.y` between two tables (JOIN … ON, an implicit join in WHERE, a correlated
//     subquery), composite ones as one, `USING (x)`; never a foreign key (the store says "from a join");
//   - ON CONFLICT (a, b): a unique key of the target (an expression in it: none, noted); EXCLUDED.x
//     is the target's x; MySQL's ON DUPLICATE KEY UPDATE names columns, no key;
//   - lookups: a column compared for equality (=, IN, = ANY) with a value in WHERE, and the columns
//     of ORDER BY: a lead for an index, never an index;
//   - casts: `x::type`, CAST(x AS type) on a column: the only type the code states.
import { splitSql, lexSql } from './ddl.mjs'
import { sniffDialect } from './sql-dialect.mjs'

export const PARAM = '\u0001'
// bytes a text, statements a text, tokens a statement (past them its first tokens are read), nesting,
// facts a statement (tables, columns and the rest each), notes kept
export const QLIMITS = { bytes: 256 << 10, statements: 200, tokens: 20000, depth: 64, facts: 512, notes: 8 }

// The words a statement may start with: those this reads, and the other SQL statements (counted)
const VERBS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'WITH', 'VALUES', 'TRUNCATE', 'EXPLAIN', 'TABLE'])
const OTHER = new Set(['CREATE', 'ALTER', 'DROP', 'BEGIN', 'COMMIT', 'ROLLBACK', 'START', 'SAVEPOINT', 'RELEASE', 'SET', 'SHOW', 'GRANT', 'REVOKE', 'COPY', 'LOCK', 'CALL', 'DO', 'MERGE', 'UPSERT', 'PRAGMA', 'VACUUM', 'ANALYZE', 'REFRESH', 'LISTEN', 'NOTIFY', 'UNLISTEN', 'DECLARE', 'FETCH', 'CLOSE', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'COMMENT', 'USE', 'ATTACH', 'DETACH', 'REINDEX', 'CLUSTER', 'DISCARD', 'RESET'])
// Words never a column or a table: the structure of a statement, operators spelled as words, literals
const KW = new Set(('SELECT FROM WHERE AND OR NOT NULL TRUE FALSE UNKNOWN IS IN LIKE ILIKE SIMILAR BETWEEN SYMMETRIC ESCAPE EXISTS CASE WHEN THEN ELSE END AS ON USING ' +
  'JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL LATERAL STRAIGHT_JOIN GROUP BY ORDER ASC DESC NULLS FIRST LAST LIMIT OFFSET FETCH NEXT ROWS ROW ONLY TIES HAVING ' +
  'UNION ALL ANY SOME DISTINCT DISTINCTROW INTERSECT EXCEPT MINUS INTO VALUES DEFAULT SET RETURNING CONFLICT DO NOTHING UPDATE DELETE INSERT REPLACE WITH RECURSIVE ' +
  'MATERIALIZED OVER PARTITION RANGE GROUPS UNBOUNDED PRECEDING FOLLOWING CURRENT FILTER WITHIN COLLATE INTERVAL ARRAY CAST FOR SHARE NOWAIT SKIP LOCKED OF ' +
  'KEY NO DUPLICATE CONSTRAINT IGNORE ABORT FAIL ROLLBACK ISNULL NOTNULL REGEXP RLIKE DIV MOD XOR BINARY LEADING TRAILING BOTH SEPARATOR WINDOW QUALIFY TABLESAMPLE ' +
  'ORDINALITY CURRENT_TIMESTAMP CURRENT_DATE CURRENT_TIME LOCALTIME LOCALTIMESTAMP CURRENT_USER SESSION_USER CURRENT_ROLE CURRENT_SCHEMA SYSDATE SQL_CALC_FOUND_ROWS ' +
  'HIGH_PRIORITY LOW_PRIORITY DELAYED QUICK TOP PERCENT TRUNCATE TABLE EXPLAIN ANALYZE VERBOSE').split(' '))
// The clauses of a SELECT block, at its top level, and the words that end a FROM list
const CLAUSES = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'WINDOW', 'QUALIFY', 'ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'FOR', 'INTO', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'RETURNING', 'SET'])
const JOINS = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'STRAIGHT_JOIN', 'SEMI', 'ANTI', 'ASOF'])
const SETOPS = new Set(['UNION', 'INTERSECT', 'EXCEPT', 'MINUS'])
// a word before a string is that literal's type (DATE '2020-01-01'), never a column
const UNITS = new Set(['MICROSECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'SECOND_MICROSECOND', 'MINUTE_SECOND', 'HOUR_MINUTE', 'DAY_HOUR', 'YEAR_MONTH', 'DAY_SECOND', 'DAY_MINUTE', 'HOUR_SECOND'])

const lower = (s) => String(s).toLowerCase()
const isOp = (x, v) => !!x && x.k === 'o' && x.v === v
const isWord = (x, u) => !!x && x.k === 'w' && x.u === u
// a name a column or a table may have: a word that is no keyword, or a quoted name
const isName = (x) => !!x && ((x.k === 'w' && !KW.has(x.u)) || x.k === 'q')
const isParam = (x) => !!x && x.k === 'p'
const isValue = (x) => !!x && (x.k === 'p' || x.k === 's' || x.k === 'n' || (x.k === 'w' && (x.u === 'TRUE' || x.u === 'FALSE')))

// Is this text SQL, by its first word (past blanks, comments and opening parentheses)?
export function isSql(text) {
  const { tokens } = lexSql(String(text).slice(0, 4096), { max: 8 })
  const w = tokens.find((t) => !isOp(t, '('))
  return !!w && w.k === 'w' && (VERBS.has(w.u) || OTHER.has(w.u))
}

// ── parameters ──
// The tokens as the reader takes them: every parameter one `p` token, whatever its style (`?`, `?1`,
// `$1`, `$name`, `:name`, `@name`, `%s`, `%(name)s`, PARAM), and a name glued to a parameter
// (`t_${x}`, `${schema}.users`) one dynamic parameter: a table or a column named by code, never read
// as one. Operators glued to a parameter (`=?`, `=@x`) are split from it.
function params(tokens) {
  const out = []
  const P = (from, extra = {}) => ({ k: 'p', v: '?', s: from.s, e: from.e, line: from.line, sp: from.sp, ...extra })
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], next = tokens[i + 1]
    const glued = (x) => !!x && !x.sp
    if (t.k === 'q' && t.v.includes(PARAM)) { out.push(P(t, { dyn: true })); continue }
    if (t.k !== 'o') { out.push(t); continue }
    // `:name` (never `::`, never after a name it is glued to)
    if (t.v === ':' && next && glued(next) && next.k === 'w' && !(out.length && glued(t) && /^[wqn]$/.test(out[out.length - 1].k))) { out.push(P(t)); i++; continue }
    // `$name` where the dialect's tokenizer did not take it (MySQL, SQLite)
    if (t.v === '$' && next && glued(next) && (next.k === 'w' || next.k === 'n')) { out.push(P(t)); i++; continue }
    if (!/[?@%\u0001]/.test(t.v)) { out.push(t); continue }
    // an operator run: split at each `?` and PARAM; a trailing `@` or `%` heads a parameter
    let buf = '', first = true
    const flush = () => { if (buf) { out.push({ ...t, v: buf, sp: first ? t.sp : false }); first = false; buf = '' } }
    const v = t.v
    for (let c = 0; c < v.length; c++) {
      const ch = v[c]
      if (ch === '?' || ch === PARAM) { flush(); out.push({ ...P(t), sp: first ? t.sp : false }); first = false; continue }
      if (c === v.length - 1 && ch === '@' && next && glued(next) && next.k === 'w') { flush(); out.push({ ...P(t), sp: first ? t.sp : false }); first = false; i++; continue }
      if (c === v.length - 1 && ch === '%' && next && glued(next)) {
        if (next.k === 'w' && /^[sdifbrx]$/.test(next.v)) { flush(); out.push({ ...P(t), sp: first ? t.sp : false }); first = false; i++; continue }
        // %(name)s
        const n2 = tokens[i + 2], n3 = tokens[i + 3], n4 = tokens[i + 4]
        if (isOp(next, '(') && n2 && n2.k === 'w' && isOp(n3, ')') && n4 && glued(n4) && n4.k === 'w' && /^[sdifbrx]$/.test(n4.v)) { flush(); out.push({ ...P(t), sp: first ? t.sp : false }); first = false; i += 4; continue }
      }
      buf += ch
    }
    flush()
    // `?1`: the number glued to it is the parameter's
    if (out.length && out[out.length - 1].k === 'p' && next && glued(next) && next.k === 'n') i++
  }
  // a name glued to a parameter, either side, or through a `.`: one dynamic parameter
  const merged = []
  for (let i = 0; i < out.length; i++) {
    const t = out[i]
    const part = (x) => !!x && (x.k === 'w' || x.k === 'q' || x.k === 'p' || x.k === 'n' || isOp(x, '.'))
    if (!part(t)) { merged.push(t); continue }
    let j = i + 1
    while (j < out.length && !out[j].sp && part(out[j])) j++
    const run = out.slice(i, j)
    if (run.length > 1 && run.some((x) => x.k === 'p') && run.some((x) => x.k !== 'p' && x.k !== 'n')) merged.push(P(t, { dyn: true }))
    else merged.push(...run)
    i = j - 1
  }
  return merged
}

// ── the reader ──
// Each `(` paired with its `)` (the statement's end when it never closes), in one pass.
function pairs(t) {
  const match = new Int32Array(t.length).fill(-1), stack = []
  for (let i = 0; i < t.length; i++) {
    if (isOp(t[i], '(')) stack.push(i)
    else if (isOp(t[i], ')') && stack.length) match[stack.pop()] = i
  }
  for (const i of stack) match[i] = t.length
  return match
}

class Scope {
  constructor(parent = null) { this.parent = parent; this.refs = []; this.alias = new Map(); this.ctes = new Set() }
  add(ref, names) { this.refs.push(ref); for (const n of names) if (n && !this.alias.has(lower(n))) this.alias.set(lower(n), ref); return ref }
  find(name) { for (let s = this; s; s = s.parent) { const r = s.alias.get(lower(name)); if (r) return r } return null }
  cte(name) { for (let s = this; s; s = s.parent) if (s.ctes.has(lower(name))) return true; return false }
  // the one source a bare column can come from: the nearest scope's, when it has exactly one
  single() { for (let s = this; s; s = s.parent) if (s.refs.length) return s.refs.length === 1 ? s.refs[0] : 'ambiguous'; return null }
}

class Reader {
  constructor(t, dialect) {
    this.t = t; this.d = dialect; this.m = pairs(t)
    this.st = { tables: [], columns: [], joins: [], conflict: null, lookups: [], casts: [], unresolved: 0, dynamic: 0, ctes: 0, notes: [] }
    this.seen = new Set()
    this.ids = new Map()
    this.deep = false
  }
  note(text) { if (this.st.notes.length < QLIMITS.notes && !this.st.notes.includes(text)) this.st.notes.push(text) }
  // the end of a group opened at i, within [.., b)
  close(i, b) { const m = this.m[i]; return m < 0 || m > b ? b : m }
  // a name as written: a quoted one as it is, a word folded as Postgres folds it
  nm(x) { return x.k === 'q' ? x.v : this.d === 'postgres' ? lower(x.v) : x.v }
  // ── facts, deduplicated within the statement and capped ──
  push(list, key, fact) { if (this.seen.has(key) || this.st[list].length >= QLIMITS.facts) return; this.seen.add(key); this.st[list].push(fact) }
  table(ref) { if (ref.kind === 'table') this.push('tables', `t|${lower(ref.name)}|${ref.role}`, { name: ref.name, line: ref.line, role: ref.role }) }
  column(ref, name, line, how) { this.push('columns', `c|${lower(ref.name)}|${lower(name)}|${how}`, { table: ref.name, name, line, how }) }
  lookup(ref, name, line, how) { this.push('lookups', `l|${lower(ref.name)}|${lower(name)}|${how}`, { table: ref.name, column: name, how, line }) }
  cast(ref, name, type, line) { this.push('casts', `x|${lower(ref.name)}|${lower(name)}|${type}`, { table: ref.name, column: name, type, line }) }

  // ── a statement, from its first word ──
  statement(a, b, scope, depth) {
    const t = this.t
    if (depth > QLIMITS.depth) { this.deep = true; return null }
    while (a < b && isOp(t[a], '(') && this.close(a, b) === b - 1) { a++; b-- } // (SELECT …)
    if (a >= b) return null
    const w = t[a]
    if (isOp(w, '(')) return this.select(a, b, scope, depth)
    if (w.k !== 'w') return null
    switch (w.u) {
      case 'WITH': return this.with(a, b, scope, depth)
      case 'SELECT': case 'VALUES': case 'TABLE': return this.select(a, b, scope, depth)
      case 'INSERT': case 'REPLACE': return this.insert(a, b, scope, depth)
      case 'UPDATE': return this.update(a, b, scope, depth)
      case 'DELETE': return this.delete(a, b, scope, depth)
      case 'TRUNCATE': return this.truncate(a, b, scope)
      case 'EXPLAIN': { let i = a + 1; while (i < b && t[i].k === 'w' && !VERBS.has(t[i].u)) i++; if (isOp(t[i], '(')) i = this.close(i, b) + 1; return i < b ? this.statement(i, b, scope, depth) : 'other' }
      default: return null
    }
  }

  // WITH [RECURSIVE] name [(columns)] AS [[NOT] MATERIALIZED] (body), … main
  with(a, b, scope, depth) {
    const t = this.t
    const s = new Scope(scope)
    let i = a + 1
    const recursive = isWord(t[i], 'RECURSIVE')
    if (recursive) i++
    while (i < b) {
      if (!isName(t[i]) && !(t[i].k === 'w')) break
      const name = t[i].v
      i++
      if (isOp(t[i], '(')) i = this.close(i, b) + 1
      if (!isWord(t[i], 'AS')) break
      i++
      if (isWord(t[i], 'NOT')) i++
      if (isWord(t[i], 'MATERIALIZED')) i++
      if (!isOp(t[i], '(')) break
      const end = this.close(i, b)
      if (recursive) s.ctes.add(lower(name))
      this.statement(i + 1, end, new Scope(s), depth + 1)
      s.ctes.add(lower(name))
      this.st.ctes++
      i = end + 1
      if (isOp(t[i], ',')) { i++; continue }
      break
    }
    return i < b ? this.statement(i, b, s, depth) : 'select'
  }

  // the top-level positions of [a, b): each word in `words` (upper case) at depth 0, in order
  tops(a, b, words) {
    const t = this.t, out = []
    for (let i = a; i < b; i++) {
      const x = t[i]
      if (isOp(x, '(')) { i = this.close(i, b); continue }
      if (x.k === 'w' && words.has(x.u)) out.push(i)
    }
    return out
  }
  // [a, b) split at its top-level commas
  items(a, b) {
    const t = this.t, out = []
    let from = a
    for (let i = a; i < b; i++) {
      if (isOp(t[i], '(')) { i = this.close(i, b); continue }
      if (isOp(t[i], ',')) { out.push([from, i]); from = i + 1 }
    }
    out.push([from, b])
    return out.filter(([x, y]) => y > x)
  }

  // a query expression: blocks joined by UNION, INTERSECT, EXCEPT; an ORDER BY or LIMIT after the
  // last block belongs to it
  select(a, b, scope, depth) {
    const t = this.t
    const cuts = this.tops(a, b, SETOPS)
    let from = a
    for (const c of [...cuts, b]) {
      let s = from
      while (s < c && isOp(t[s], '(')) {
        const e = this.close(s, c)
        if (e >= c - 1) { this.statement(s + 1, e, scope, depth + 1); s = c; break }
        // (SELECT …) ORDER BY …: the group, then the rest as a block's tail
        this.statement(s + 1, e, scope, depth + 1); s = e + 1
      }
      if (s < c) this.block(s, c, scope, depth)
      from = c + 1
      while (from < b && t[from].k === 'w' && (t[from].u === 'ALL' || t[from].u === 'DISTINCT')) from++
    }
    return 'select'
  }

  // One SELECT block: its FROM read first (its aliases), then its select list, WHERE, GROUP BY,
  // HAVING, ORDER BY.
  block(a, b, parent, depth) {
    const t = this.t
    const scope = new Scope(parent)
    if (isWord(t[a], 'VALUES')) { this.expr(a + 1, b, scope, { how: 'expr' }, depth); return }
    if (isWord(t[a], 'TABLE')) { const r = this.factor(a + 1, b, scope, 'read', depth); return void r }
    if (!isWord(t[a], 'SELECT')) { this.expr(a, b, scope, { how: 'expr' }, depth); return }
    // (never the FROM of IS [NOT] DISTINCT FROM)
    const marks = this.tops(a + 1, b, CLAUSES).filter((i) => !(t[i].u === 'FROM' && isWord(t[i - 1], 'DISTINCT')))
    const at = (u) => marks.find((i) => t[i].u === u)
    const end = (i) => { const n = marks.find((j) => j > i); return n === undefined ? b : n }
    const from = at('FROM')
    if (from !== undefined) this.from(from + 1, end(from), scope, 'read', depth)
    // the select list: each item's alias is an output name, never a column
    const aliases = new Set()
    let s = a + 1
    while (s < b && t[s].k === 'w' && (t[s].u === 'DISTINCT' || t[s].u === 'ALL' || t[s].u === 'DISTINCTROW' || t[s].u === 'SQL_CALC_FOUND_ROWS' || t[s].u === 'HIGH_PRIORITY' || t[s].u === 'STRAIGHT_JOIN')) {
      if (t[s].u === 'DISTINCT' && isWord(t[s + 1], 'ON') && isOp(t[s + 2], '(')) { const e = this.close(s + 2, b); this.expr(s + 3, e, scope, { how: 'select' }, depth + 1); s = e + 1; continue }
      s++
    }
    if (isWord(t[s], 'TOP')) { s++; if (isOp(t[s], '(')) s = this.close(s, b) + 1; else s++ }
    const listEnd = marks.length ? marks[0] : b
    this.list(s, listEnd, scope, 'select', aliases, depth)
    for (const i of marks) {
      const e = end(i)
      switch (t[i].u) {
        case 'WHERE': this.expr(i + 1, e, scope, { how: 'where', pred: 'where' }, depth); break
        case 'GROUP': this.expr(i + 1 + (isWord(t[i + 1], 'BY') ? 1 : 0), e, scope, { how: 'group', aliases }, depth); break
        case 'HAVING': this.expr(i + 1, e, scope, { how: 'having', aliases }, depth); break
        case 'QUALIFY': this.expr(i + 1, e, scope, { how: 'expr', aliases }, depth); break
        case 'ORDER': this.expr(i + 1 + (isWord(t[i + 1], 'BY') ? 1 : 0), e, scope, { how: 'order', aliases, order: true }, depth); break
        case 'WINDOW': this.expr(i + 1, e, scope, { how: 'expr', aliases }, depth); break
        default: break // LIMIT, OFFSET, FETCH, FOR …, INTO (a variable)
      }
    }
  }

  // A select list (or RETURNING's): each item read, `*` and `t.*` revealing nothing, its alias kept.
  list(a, b, scope, how, aliases, depth) {
    const t = this.t
    for (const [s, e] of this.items(a, b)) {
      let x = e
      const last = t[e - 1], before = t[e - 2]
      if (e - s >= 2 && isName(last) && isWord(before, 'AS')) { aliases.add(lower(last.v)); x = e - 2 }
      else if (e - s >= 2 && isName(last) && before && !isOp(before, '.') && (before.k === 'q' || before.k === 's' || before.k === 'n' || before.k === 'p' || isOp(before, ')') || (before.k === 'w' && (!KW.has(before.u) || before.u === 'END' || before.u === 'NULL' || before.u === 'TRUE' || before.u === 'FALSE')))) { aliases.add(lower(last.v)); x = e - 1 }
      this.expr(s, x, scope, { how }, depth)
    }
  }

  // ── FROM: tables, joins, aliases ──
  // A from list into `scope`: each table factor, then the ON conditions read once every alias is known.
  from(a, b, scope, role, depth) {
    const t = this.t
    const ons = []
    let i = a, prev = null, last = null, first = true
    // a join word, never a function of that name (LEFT(x, 3))
    const joinWord = (k) => t[k].k === 'w' && JOINS.has(t[k].u) && !isOp(t[k + 1], '(')
    while (i < b) {
      const x = t[i]
      if (isOp(x, ',')) { i++; continue }
      if (joinWord(i)) { i++; continue }
      if (isWord(x, 'ON')) {
        let e = i + 1
        for (; e < b; e++) { if (isOp(t[e], '(')) { e = this.close(e, b); continue } if (isOp(t[e], ',') || joinWord(e)) break }
        ons.push([i + 1, e])
        i = e
        continue
      }
      if (isWord(x, 'USING') && isOp(t[i + 1], '(')) {
        // JOIN b USING (x): x is a column of both sides, and the join is on it
        const e = this.close(i + 1, b)
        const cols = this.items(i + 2, e).filter(([s, f]) => f === s + 1 && isName(t[s])).map(([s]) => t[s])
        if (prev && last) {
          for (const c of cols) { if (prev.kind === 'table') this.column(prev, this.nm(c), c.line, 'join'); if (last.kind === 'table') this.column(last, this.nm(c), c.line, 'join') }
          if (prev.kind === 'table' && last.kind === 'table' && cols.length) this.join({ ref: prev, cols: cols.map((c) => this.nm(c)) }, { ref: last, cols: cols.map((c) => this.nm(c)) }, x.line)
        }
        i = e + 1
        continue
      }
      const r = this.factor(i, b, scope, first ? role : 'read', depth)
      if (!r) { i++; continue }
      if (r.ref) { prev = last; last = r.ref }
      first = false
      i = r.end
    }
    for (const [s, e] of ons) this.expr(s, e, scope, { how: 'join', pred: 'on' }, depth)
  }
  // One table factor at i: a table, a subquery, a table function, a nested join, a parameter; its
  // alias. → { ref, end } | null
  factor(i, b, scope, role, depth) {
    const t = this.t
    while (i < b && t[i].k === 'w' && (t[i].u === 'LATERAL' || t[i].u === 'ONLY')) i++
    if (i >= b) return null
    const x = t[i]
    let ref = null, end = i + 1, names = []
    if (isOp(x, '(')) {
      const e = this.close(i, b)
      const inner = t[i + 1]
      if (inner && ((inner.k === 'w' && (inner.u === 'SELECT' || inner.u === 'WITH' || inner.u === 'VALUES')) || isOp(inner, '('))) {
        if (depth + 1 > QLIMITS.depth) this.deep = true
        else this.statement(i + 1, e, new Scope(scope), depth + 1)
        ref = scope.add({ kind: 'sub' }, [])
      } else if (depth + 1 > QLIMITS.depth) this.deep = true
      else this.from(i + 1, e, scope, role, depth + 1) // (a JOIN b ON …)
      end = e + 1
    } else if (isParam(x)) {
      this.st.dynamic++
      ref = scope.add({ kind: 'dyn' }, [])
    } else if (isName(x)) {
      const parts = [x]
      let j = i + 1
      while (isOp(t[j], '.') && (isName(t[j + 1]) || (t[j + 1] && t[j + 1].k === 'w')) && parts.length < 4) { parts.push(t[j + 1]); j += 2 }
      if (isOp(t[j], '.') && isParam(t[j + 1])) { this.st.dynamic++; return { ref: scope.add({ kind: 'dyn' }, []), end: j + 2 } }
      end = j
      if (isOp(t[j], '(')) {
        // a table function (generate_series, unnest, json_to_recordset): its arguments read, no table
        const e = this.close(j, b)
        this.expr(j + 1, e, scope, { how: 'expr' }, depth + 1)
        ref = scope.add({ kind: 'func' }, [])
        end = e + 1
      } else {
        const ns = parts.map((p) => this.nm(p))
        if (ns.length > 1 && lower(ns[0]) === 'public') ns.shift()
        const name = ns.join('.')
        if (ns.length === 1 && scope.cte(name)) ref = { kind: 'cte', name }
        else { ref = { kind: 'table', name, line: x.line, role }; this.table(ref) }
        names = [name, ns[ns.length - 1]]
      }
    } else return null
    // MySQL's index hints, Postgres' TABLESAMPLE: read past
    let k = end
    if (isWord(t[k], 'AS')) k++
    if (isName(t[k]) && !(t[k].k === 'w' && (JOINS.has(t[k].u) || CLAUSES.has(t[k].u) || t[k].u === 'USE' || t[k].u === 'FORCE' || t[k].u === 'TABLESAMPLE'))) {
      names = [t[k].v, ...(ref.kind === 'table' || ref.kind === 'cte' ? names : [])]
      k++
      if (isOp(t[k], '(')) k = this.close(k, b) + 1 // a column alias list
    }
    while (t[k] && t[k].k === 'w' && (t[k].u === 'USE' || t[k].u === 'FORCE' || t[k].u === 'IGNORE') && t[k + 1] && t[k + 1].k === 'w' && (t[k + 1].u === 'INDEX' || t[k + 1].u === 'KEY')) {
      k += 2
      if (isWord(t[k], 'FOR')) { k++; while (t[k] && t[k].k === 'w' && !isOp(t[k], '(')) k++ }
      if (isOp(t[k], '(')) k = this.close(k, b) + 1
    }
    if (isWord(t[k], 'TABLESAMPLE')) { k++; while (t[k] && t[k].k === 'w') k++; if (isOp(t[k], '(')) k = this.close(k, b) + 1 }
    if (ref.kind === 'table' || ref.kind === 'cte') { if (!scope.refs.includes(ref)) scope.add(ref, names) }
    else for (const n of names) if (!scope.alias.has(lower(n))) scope.alias.set(lower(n), ref)
    return { ref, end: k }
  }

  // ── expressions ──
  // A name chain at i: `a`, `a.b`, `a.b.c`, `a.*` → { parts: [token], end, star }
  chain(i, b) {
    const t = this.t, parts = [t[i]]
    let j = i + 1, star = false
    while (j + 1 <= b && isOp(t[j], '.')) {
      const n = t[j + 1]
      if (n && (n.k === 'w' || n.k === 'q') && parts.length < 4) { parts.push(n); j += 2; continue }
      if (n && n.k === 'o' && n.v === '*') { star = true; j += 2 }
      break
    }
    return { parts, end: j, star }
  }
  // The table a column name is of, within the scope: → { ref, name } (ref a table) | null
  resolve(parts, scope, count = true) {
    const name = this.nm(parts[parts.length - 1])
    if (parts.length === 1) {
      const r = scope.single()
      if (r === 'ambiguous' || r === null) { if (count) this.st.unresolved++; return null }
      return r.kind === 'table' ? { ref: r, name } : null
    }
    const qual = parts.slice(0, -1).map((p) => this.nm(p))
    if (qual.length > 1 && lower(qual[0]) === 'public') qual.shift()
    const r = scope.find(qual.join('.')) || (qual.length > 1 ? scope.find(qual[qual.length - 1]) : null)
    if (!r) { if (count) this.st.unresolved++; return null }
    if (r.kind === 'excluded') return r.target ? { ref: r.target, name } : null
    return r.kind === 'table' ? { ref: r, name } : null
  }
  // A cast's type at i (after `::` or CAST's AS) → { type, end }
  type(i, b) {
    const t = this.t, words = []
    let j = i
    while (j < b && (t[j].k === 'w' || t[j].k === 'q')) {
      words.push(lower(t[j].v))
      j++
      if (isOp(t[j], '.') && t[j + 1] && (t[j + 1].k === 'w' || t[j + 1].k === 'q')) { words.length = 0; j++; continue } // pg_catalog.int4: its own name
      break
    }
    if (!words.length) return { type: null, end: i }
    // the words a type name runs on with: double precision, character varying, … with time zone
    for (;;) {
      const u = t[j] && t[j].k === 'w' ? t[j].u : null
      if (u === 'PRECISION' || u === 'VARYING') { words.push(lower(u)); j++; continue }
      if ((u === 'WITH' || u === 'WITHOUT') && isWord(t[j + 1], 'TIME') && isWord(t[j + 2], 'ZONE')) { words.push(lower(u), 'time', 'zone'); j += 3; continue }
      break
    }
    let type = words.join(' ')
    if (isOp(t[j], '(')) { const e = this.close(j, b); let args = ''; for (let k = j + 1; k < e && args.length < 32; k++) args += t[k].k === 'n' || isOp(t[k], ',') ? t[k].v : ''; type += `(${args})`; j = e + 1 }
    while (isOp(t[j], '[')) { while (j < b && !isOp(t[j], ']')) j++; j++; type += '[]' }
    return { type: type.slice(0, 64), end: j }
  }

  // An expression range: columns, subqueries, casts, and the predicates that make joins and lookups.
  // ctx { how, pred: where | on, aliases, order }
  expr(a, b, scope, ctx, depth) {
    const t = this.t
    if (depth > QLIMITS.depth) { this.deep = true; return }
    const pairs = [] // column = column, for the joins of this range
    for (let i = a; i < b;) {
      const x = t[i]
      if (isOp(x, '(')) {
        const e = this.close(i, b)
        const inner = t[i + 1]
        if (depth + 1 > QLIMITS.depth) this.deep = true
        else if (inner && inner.k === 'w' && (inner.u === 'SELECT' || inner.u === 'WITH' || inner.u === 'VALUES')) this.statement(i + 1, e, new Scope(scope), depth + 1)
        else this.expr(i + 1, e, scope, ctx, depth + 1) // a group: (a = $1 OR b = $2) still compares
        i = e + 1
        continue
      }
      if (x.k === 'p') { if (x.dyn) this.st.dynamic++; i++; continue }
      if (isOp(x, '::')) { i = this.type(i + 1, b).end; continue }
      if (x.k === 'w') {
        const u = x.u
        if ((u === 'CAST' || u === 'TRY_CAST' || u === 'CONVERT') && isOp(t[i + 1], '(')) { i = this.castCall(i + 1, b, scope, ctx, depth, u === 'CONVERT'); continue }
        if (u === 'EXTRACT' && isOp(t[i + 1], '(')) { const e = this.close(i + 1, b); this.expr(i + 3, e, scope, { how: ctx.how }, depth + 1); i = e + 1; continue }
        if (u === 'INTERVAL') { i++; if (t[i] && (t[i].k === 's' || t[i].k === 'n' || t[i].k === 'p')) i++; if (t[i] && t[i].k === 'w' && UNITS.has(t[i].u)) i++; continue }
        if (u === 'AT' && isWord(t[i + 1], 'TIME') && isWord(t[i + 2], 'ZONE')) { i += 3; continue }
        if (t[i + 1] && t[i + 1].k === 's' && !KW.has(u)) { i += 2; continue } // DATE '2024-01-01'
        if (KW.has(u)) { i++; continue }
      }
      if (x.k === 'w' || x.k === 'q') {
        const c = this.chain(i, b)
        let end = c.end
        if (isOp(t[end], '(')) {
          // a function: its name is none of the columns; its arguments are read
          const e = this.close(end, b)
          this.expr(end + 1, e, scope, ctx.pred ? { ...ctx, pred: null } : ctx, depth + 1) // lower(email) = $1 is no column lookup
          i = e + 1
          continue
        }
        if (c.star) { i = end; continue }
        if (c.parts.length === 1 && ctx.aliases && ctx.aliases.has(lower(x.v))) { i = end; continue }
        const col = this.resolve(c.parts, scope)
        if (col) this.column(col.ref, col.name, x.line, ctx.how)
        if (isOp(t[end], '::')) { const ty = this.type(end + 1, b); if (col && ty.type) this.cast(col.ref, col.name, ty.type, x.line); end = ty.end }
        if (col) {
          if (ctx.order) this.lookup(col.ref, col.name, x.line, 'order')
          // = another column: a join; = a value, IN (…), = ANY (…): a lookup
          const op = t[end], rhs = t[end + 1]
          if (ctx.pred && isOp(op, '=') && rhs && ((rhs.k === 'w' && !KW.has(rhs.u)) || rhs.k === 'q')) {
            const d = this.chain(end + 1, b)
            if (!isOp(t[d.end], '(') && !d.star) { const other = this.resolve(d.parts, scope, false); if (other && other.ref !== col.ref) pairs.push([col, other, x.line]) }
          } else if (ctx.pred === 'where') {
            const eqValue = isOp(op, '=') && (isValue(rhs) || isWord(rhs, 'ANY') || isWord(rhs, 'SOME') || (isOp(rhs, '(') && isValue(t[end + 2])))
            const inList = isWord(op, 'IN') && isOp(rhs, '(')
            if (eqValue || inList) this.lookup(col.ref, col.name, x.line, 'where')
          }
          // a value = this column
          if (ctx.pred === 'where' && isOp(t[i - 1], '=') && isValue(t[i - 2])) this.lookup(col.ref, col.name, x.line, 'where')
        }
        i = end
        continue
      }
      i++
    }
    // the pairs between two sources, grouped: one join per pair of aliases, its columns in order
    const by = new Map()
    for (const [p, q, line] of pairs) {
      const [ip, iq] = [this.id(p.ref), this.id(q.ref)]
      const k = ip < iq ? `${ip}|${iq}` : `${iq}|${ip}`
      if (!by.has(k)) by.set(k, { a: { ref: p.ref, cols: [] }, b: { ref: q.ref, cols: [] }, line })
      const g = by.get(k)
      if (g.a.cols.length >= 16) continue
      const [ca, cb] = g.a.ref === p.ref ? [p.name, q.name] : [q.name, p.name]
      if (g.a.cols.some((c, n) => lower(c) === lower(ca) && lower(g.b.cols[n]) === lower(cb))) continue
      g.a.cols.push(ca); g.b.cols.push(cb)
    }
    for (const g of by.values()) this.join(g.a, g.b, g.line)
  }
  // an alias's identity (two aliases of one table are two sources)
  id(ref) { if (!this.ids.has(ref)) this.ids.set(ref, this.ids.size); return this.ids.get(ref) }
  join(a, b, line) {
    if (a.ref.kind !== 'table' || b.ref.kind !== 'table') return
    const key = `j|${lower(a.ref.name)}(${a.cols.map(lower)})|${lower(b.ref.name)}(${b.cols.map(lower)})`
    const rev = `j|${lower(b.ref.name)}(${b.cols.map(lower)})|${lower(a.ref.name)}(${a.cols.map(lower)})`
    if (this.seen.has(rev)) return
    this.push('joins', key, { a: { table: a.ref.name, columns: a.cols }, b: { table: b.ref.name, columns: b.cols }, line })
  }
  // CAST(x AS type), CONVERT(x, type): the column cast, the type never read as a column
  castCall(i, b, scope, ctx, depth, convert) {
    const t = this.t
    const e = this.close(i, b)
    let k = -1
    for (let j = i + 1; j < e; j++) { if (isOp(t[j], '(')) { j = this.close(j, e); continue } if (convert ? isOp(t[j], ',') || isWord(t[j], 'USING') : isWord(t[j], 'AS')) { k = j; break } }
    if (convert && k >= 0 && isWord(t[k], 'USING')) k = -1 - k // CONVERT(x USING charset): no type
    const stop = k < -1 ? -1 - k : k < 0 ? e : k
    if (k < -1) k = -1
    if (stop === i + 2 && (t[i + 1].k === 'w' || t[i + 1].k === 'q') && !KW.has(t[i + 1].u)) {
      const col = this.resolve([t[i + 1]], scope)
      if (col) { this.column(col.ref, col.name, t[i + 1].line, ctx.how); if (k >= 0) { const ty = this.type(k + 1, e); if (ty.type) this.cast(col.ref, col.name, ty.type, t[i + 1].line) } }
    } else if (stop - i - 1 >= 3 && isOp(t[i + 2], '.') && stop === i + 4) {
      const col = this.resolve([t[i + 1], t[i + 3]], scope)
      if (col) { this.column(col.ref, col.name, t[i + 1].line, ctx.how); if (k >= 0) { const ty = this.type(k + 1, e); if (ty.type) this.cast(col.ref, col.name, ty.type, t[i + 1].line) } }
    } else this.expr(i + 1, stop, scope, { ...ctx, pred: null }, depth + 1)
    return e + 1
  }

  // ── the statements that write ──
  // the target of an INSERT, UPDATE, DELETE or TRUNCATE at i: a table, or a parameter → { ref, end }
  target(i, b, scope) {
    const t = this.t
    while (t[i] && t[i].k === 'w' && (t[i].u === 'ONLY' || t[i].u === 'TABLE')) i++
    if (isParam(t[i])) { this.st.dynamic++; return { ref: { kind: 'dyn' }, end: i + 1 } }
    if (!isName(t[i])) return null
    const c = this.chain(i, b)
    if (isOp(t[c.end], '.') && isParam(t[c.end + 1])) { this.st.dynamic++; return { ref: { kind: 'dyn' }, end: c.end + 2 } }
    const ns = c.parts.map((p) => this.nm(p))
    if (ns.length > 1 && lower(ns[0]) === 'public') ns.shift()
    const name = ns.join('.')
    const ref = { kind: 'table', name, line: t[i].line, role: 'write' }
    this.table(ref)
    let k = c.end, alias = null
    if (isWord(t[k], 'AS') && isName(t[k + 1])) { alias = t[k + 1].v; k += 2 } else if (isName(t[k]) && !(t[k].k === 'w' && (CLAUSES.has(t[k].u) || t[k].u === 'DEFAULT'))) { alias = t[k].v; k++ }
    scope.add(ref, [alias, name, ns[ns.length - 1]])
    return { ref, end: k }
  }
  // SET a = …, b = …, (c, d) = (…): each left side a column of `target` (or of the alias it names)
  sets(a, b, scope, target, depth) {
    const t = this.t
    for (const [s, e] of this.items(a, b)) {
      let eq = -1
      for (let j = s; j < e; j++) { if (isOp(t[j], '(')) { j = this.close(j, e); continue } if (isOp(t[j], '=')) { eq = j; break } }
      if (eq < 0) { this.expr(s, e, scope, { how: 'expr' }, depth); continue }
      const lhs = isOp(t[s], '(') ? this.items(s + 1, this.close(s, eq)).filter(([x, y]) => y > x).map(([x, y]) => [x, y]) : [[s, eq]]
      for (const [x, y] of lhs) {
        if (!isName(t[x])) continue
        const c = this.chain(x, y)
        const col = c.parts.length === 1 ? (target && target.kind === 'table' ? { ref: target, name: this.nm(t[x]) } : null) : this.resolve(c.parts, scope)
        if (col) this.column(col.ref, col.name, t[x].line, 'set')
      }
      this.expr(eq + 1, e, scope, { how: 'expr' }, depth)
    }
  }
  insert(a, b, outer, depth) {
    const t = this.t
    let i = a + 1
    while (i < b && t[i].k === 'w' && ['OR', 'IGNORE', 'INTO', 'LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'REPLACE', 'ABORT', 'FAIL', 'ROLLBACK'].includes(t[i].u)) i++
    const scope = new Scope(outer)
    const tg = this.target(i, b, scope)
    if (!tg) return 'insert'
    i = tg.end
    const ref = tg.ref
    // the column list
    if (isOp(t[i], '(') && !(t[i + 1] && t[i + 1].k === 'w' && (t[i + 1].u === 'SELECT' || t[i + 1].u === 'WITH'))) {
      const e = this.close(i, b)
      for (const [s, f] of this.items(i + 1, e)) if (isName(t[s]) && ref.kind === 'table') { const c = this.chain(s, f); this.column(ref, this.nm(c.parts[c.parts.length - 1]), t[s].line, 'insert') }
      i = e + 1
    }
    // where the source ends: ON CONFLICT, ON DUPLICATE KEY UPDATE, RETURNING
    const marks = this.tops(i, b, new Set(['ON', 'RETURNING']))
    const tail = marks.find((k) => t[k].u === 'RETURNING' || isWord(t[k + 1], 'CONFLICT') || isWord(t[k + 1], 'DUPLICATE'))
    const srcEnd = tail === undefined ? b : tail
    // the source sees the statement's CTEs, never the target
    if (isWord(t[i], 'VALUES') || isWord(t[i], 'VALUE')) this.expr(i + 1, srcEnd, new Scope(outer), { how: 'expr' }, depth)
    else if (isWord(t[i], 'SET')) this.sets(i + 1, srcEnd, scope, ref, depth)
    else if (isWord(t[i], 'DEFAULT')) { /* DEFAULT VALUES */ }
    else if (i < srcEnd) this.statement(i, srcEnd, new Scope(outer), depth + 1)
    if (tail === undefined) return 'insert'
    const excluded = { kind: 'excluded', target: ref.kind === 'table' ? ref : null }
    const up = new Scope(outer)
    if (ref.kind === 'table') up.add(ref, [...scope.alias.entries()].filter(([, r]) => r === ref).map(([n]) => n))
    up.alias.set('excluded', excluded)
    const rest = marks.filter((k) => k >= tail && (t[k].u === 'RETURNING' || isWord(t[k + 1], 'CONFLICT') || isWord(t[k + 1], 'DUPLICATE')))
    for (let n = 0; n < rest.length; n++) {
      const k = rest[n], e = n + 1 < rest.length ? rest[n + 1] : b
      if (t[k].u === 'RETURNING') { this.list(k + 1, e, up, 'returning', new Set(), depth); continue }
      if (isWord(t[k + 1], 'CONFLICT')) this.conflict(k + 2, e, up, ref, depth)
      else if (isWord(t[k + 1], 'DUPLICATE')) {
        // ON DUPLICATE KEY UPDATE a = VALUES(a): columns, no key (the engine picks which unique key)
        let j = k + 2
        while (j < e && t[j].k === 'w' && (t[j].u === 'KEY' || t[j].u === 'UPDATE')) j++
        this.sets(j, e, up, ref, depth)
      }
    }
    return 'insert'
  }
  // ON CONFLICT [(a, b) [WHERE …] | ON CONSTRAINT name] DO NOTHING | DO UPDATE SET … [WHERE …]
  conflict(i, e, scope, ref, depth) {
    const t = this.t
    if (isOp(t[i], '(')) {
      const c = this.close(i, e)
      const items = this.items(i + 1, c)
      const cols = items.filter(([s, f]) => isName(t[s]) && (f === s + 1 || (f > s + 1 && t[s + 1].k === 'w' && (t[s + 1].u === 'COLLATE' || !KW.has(t[s + 1].u)) && f <= s + 3))).map(([s]) => t[s])
      if (ref.kind === 'table') {
        for (const x of cols) this.column(ref, this.nm(x), x.line, 'conflict')
        if (cols.length === items.length && cols.length && !this.st.conflict) this.st.conflict = { table: ref.name, columns: cols.map((x) => this.nm(x)), line: t[i].line }
        else if (cols.length !== items.length) this.note(`line ${t[i].line}: an ON CONFLICT target holding an expression: no unique key read`)
      }
      i = c + 1
      if (isWord(t[i], 'WHERE')) { let j = i + 1; while (j < e && !isWord(t[j], 'DO')) { if (isOp(t[j], '(')) j = this.close(j, e); j++ } this.expr(i + 1, j, scope, { how: 'expr' }, depth); i = j }
    } else if (isWord(t[i], 'ON') && isWord(t[i + 1], 'CONSTRAINT')) { this.note(`line ${t[i].line}: an ON CONFLICT on a named constraint: its columns are not in the statement`); i += 3 }
    if (isWord(t[i], 'DO') && isWord(t[i + 1], 'UPDATE') && isWord(t[i + 2], 'SET')) {
      const w = this.tops(i + 3, e, new Set(['WHERE']))[0]
      this.sets(i + 3, w === undefined ? e : w, scope, ref, depth)
      if (w !== undefined) this.expr(w + 1, e, scope, { how: 'where', pred: 'where' }, depth)
    }
  }
  update(a, b, outer, depth) {
    const t = this.t
    let i = a + 1
    while (i < b && t[i].k === 'w' && (t[i].u === 'ONLY' || t[i].u === 'LOW_PRIORITY' || t[i].u === 'IGNORE' || (t[i].u === 'OR' && t[i + 1] && t[i + 1].k === 'w'))) i += t[i].u === 'OR' ? 2 : 1
    const marks = this.tops(i, b, new Set(['SET', 'FROM', 'WHERE', 'RETURNING', 'ORDER', 'LIMIT']))
    const set = marks.find((k) => t[k].u === 'SET')
    if (set === undefined) return 'update'
    const scope = new Scope(outer)
    // the target, and MySQL's joined tables before SET
    const tg = this.target(i, set, scope)
    if (tg && tg.end < set) this.from(tg.end, set, scope, 'read', depth)
    const end = (k) => { const n = marks.find((j) => j > k); return n === undefined ? b : n }
    const fromAt = marks.find((k) => k > set && t[k].u === 'FROM')
    if (fromAt !== undefined) this.from(fromAt + 1, end(fromAt), scope, 'read', depth)
    this.sets(set + 1, end(set), scope, tg ? tg.ref : null, depth)
    for (const k of marks.filter((x) => x > set)) {
      if (t[k].u === 'WHERE') this.expr(k + 1, end(k), scope, { how: 'where', pred: 'where' }, depth)
      else if (t[k].u === 'RETURNING') this.list(k + 1, end(k), scope, 'returning', new Set(), depth)
      else if (t[k].u === 'ORDER') this.expr(k + 1 + (isWord(t[k + 1], 'BY') ? 1 : 0), end(k), scope, { how: 'order', order: true }, depth)
    }
    return 'update'
  }
  delete(a, b, outer, depth) {
    const t = this.t
    let i = a + 1
    while (i < b && t[i].k === 'w' && (t[i].u === 'LOW_PRIORITY' || t[i].u === 'QUICK' || t[i].u === 'IGNORE')) i++
    const scope = new Scope(outer)
    const marks = this.tops(i, b, new Set(['FROM', 'USING', 'WHERE', 'RETURNING', 'ORDER', 'LIMIT']))
    const end = (k) => { const n = marks.find((j) => j > k); return n === undefined ? b : n }
    const fromAt = marks.find((k) => t[k].u === 'FROM')
    if (fromAt === undefined) return 'delete'
    if (fromAt === i) {
      // DELETE FROM t [AS a] [USING …]: the first table written
      const tg = this.target(i + 1, end(fromAt), scope)
      if (tg && tg.end < end(fromAt)) this.from(tg.end, end(fromAt), scope, 'read', depth) // MySQL: DELETE FROM t1 USING …
    } else {
      // MySQL: DELETE t1 FROM t1 JOIN t2 …: the names before FROM are the tables written
      this.from(fromAt + 1, end(fromAt), scope, 'read', depth)
      for (const [s] of this.items(i, fromAt)) {
        if (!isName(t[s])) continue
        const r = scope.find(this.nm(t[s]))
        if (r && r.kind === 'table' && r.role !== 'write') { r.role = 'write'; this.table(r) }
      }
    }
    for (const k of marks.filter((x) => x > fromAt)) {
      if (t[k].u === 'USING') this.from(k + 1, end(k), scope, 'read', depth)
      else if (t[k].u === 'WHERE') this.expr(k + 1, end(k), scope, { how: 'where', pred: 'where' }, depth)
      else if (t[k].u === 'RETURNING') this.list(k + 1, end(k), scope, 'returning', new Set(), depth)
      else if (t[k].u === 'ORDER') this.expr(k + 1 + (isWord(t[k + 1], 'BY') ? 1 : 0), end(k), scope, { how: 'order', order: true }, depth)
    }
    return 'delete'
  }
  truncate(a, b, outer) {
    const scope = new Scope(outer)
    for (const [s, e] of this.items(a + 1, b)) this.target(s, e, scope)
    return 'truncate'
  }
}

// What the SQL itself says of its dialect, beyond the DDL sniffer's markers (readers/sql-dialect.mjs):
// a cast `::`, ILIKE, `$1` (weak: SQLite takes it too), MySQL's ON DUPLICATE KEY and INSERT IGNORE,
// SQLite's INSERT OR …; backticks are MySQL's, weakly.
function markers(t, src, out) {
  const add = (dialect, marker, line, weak = false) => { if (!out.some((m) => m.dialect === dialect && !!m.weak === weak)) out.push({ dialect, marker, line, ...(weak ? { weak: true } : {}) }) }
  for (let i = 0; i < t.length; i++) {
    const x = t[i]
    if (isOp(x, '::')) add('postgres', '::', x.line)
    else if (isWord(x, 'ILIKE')) add('postgres', 'ILIKE', x.line)
    else if (x.k === 'p' && /^\$\d/.test(src.slice(x.s, x.e))) add('postgres', '$1 parameters', x.line, true)
    else if (isWord(x, 'ON') && isWord(t[i + 1], 'DUPLICATE') && isWord(t[i + 2], 'KEY')) add('mysql', 'ON DUPLICATE KEY', x.line)
    else if (isWord(x, 'INSERT') && isWord(t[i + 1], 'IGNORE')) add('mysql', 'INSERT IGNORE', x.line)
    else if (isWord(x, 'INSERT') && isWord(t[i + 1], 'OR') && t[i + 2] && t[i + 2].k === 'w') add('sqlite', `INSERT OR ${t[i + 2].u}`, x.line)
    else if (x.k === 'q' && src[x.s] === '`') add('mysql', 'backtick identifiers', x.line, true)
  }
}

export function readQueries(text, { dialect = null, line = 1 } = {}) {
  const out = { statements: [], notes: [], markers: [] }
  const note = (s) => { if (out.notes.length < QLIMITS.notes && !out.notes.includes(s)) out.notes.push(s) }
  text = String(text ?? '')
  if (text.length > QLIMITS.bytes) { note(`line ${line}: a SQL text of more than ${QLIMITS.bytes >> 10} KB: not read`); return out }
  const { statements, errors } = splitSql(text, { dialect, max: QLIMITS.statements })
  for (const e of errors) note(`line ${e.line + line - 1}: ${e.error}`)
  // the DDL sniffer's markers (JSONB, SERIAL, AUTOINCREMENT…), on the text's code
  const sniff = sniffDialect([{ path: '', text }])
  if (sniff.dialect) out.markers.push({ dialect: sniff.dialect, marker: sniff.marker, line: sniff.line + line - 1 })
  for (const s of statements) {
    const at = s.line + line - 1
    const { tokens, over } = lexSql(s.text, { dialect, line: at, max: QLIMITS.tokens })
    if (over) note(`line ${at}: a statement of more than ${QLIMITS.tokens} tokens: its first ${QLIMITS.tokens} read`)
    const t = params(tokens)
    markers(t, s.text, out.markers)
    const first = t.find((x) => !isOp(x, '('))
    if (!first || first.k !== 'w') continue
    if (!VERBS.has(first.u)) { if (OTHER.has(first.u)) out.statements.push({ line: at, kind: 'other', verb: first.u, tables: [], columns: [], joins: [], conflict: null, lookups: [], casts: [], unresolved: 0, dynamic: 0, ctes: 0 }); continue }
    const r = new Reader(t, dialect)
    let kind = null
    try { kind = r.statement(0, t.length, new Scope(), 0) } catch { note(`line ${at}: a statement that could not be read`) }
    if (r.deep) r.note(`line ${at}: nested deeper than ${QLIMITS.depth}: the inner part not read`)
    const st = { line: at, kind: kind || 'other', ...(kind ? {} : { verb: first.u }), ...r.st }
    if (!st.notes.length) delete st.notes
    out.statements.push(st)
  }
  return out
}
