// grimoire graph · data · Postgres and MySQL DDL, read without a database and without a grammar
// (spec D9): a statement splitter and a tokenizer, then an interpreter for the statements that shape
// a store, replayed in order into the data model's shape (model.mjs). Pure and bounded: one linear
// pass per file to split it, one per statement to tokenize it, caps on sizes, counts and nesting;
// nothing throws past readDdl, and what could not be read is noted by its position, never its text.
//
// ── The lexical layer: the seam any other SQL reader goes through (the SQL a project's code sends) ──
//   splitSql(text, { dialect, max }) → { statements: [{ start, end, line, text }], errors: [{ line, error }] }
//     A statement ends at `;` (or the delimiter a MySQL `DELIMITER` line sets) outside quotes and
//     comments, or at the `--> statement-breakpoint` comment a generator writes between statements.
//     Each dialect's rules: '…' strings ('' doubles a quote; backslashes escape in E'…' and in MySQL),
//     "…" names (a string in MySQL), MySQL backticks, Postgres $$ and $tag$ quoting, `--` comments
//     (MySQL: followed by a blank), `#` (MySQL), /* */ (nested in Postgres; MySQL's /*!NNNNN … */ is
//     code, as MySQL runs it), a psql meta-command line (`\…`) as a statement of its own, a
//     `-- +goose StatementBegin … StatementEnd` block as one statement, and a routine's body kept
//     whole (Postgres' BEGIN ATOMIC … END; MySQL's CREATE TRIGGER, PROCEDURE, FUNCTION or EVENT …
//     BEGIN … END, CASE … END and labels inside). A body that never closes is read again with its
//     `;` ending statements, so one bad routine does not swallow the file. `text` runs from the
//     statement's first code to its last (comments around it left out), `line` is where it starts.
//     dialect: postgres | mysql | sqlite (its […] names) | null (any: Postgres' rules, backticks).
//   lexSql(text, { dialect, line, max }) → { tokens, over }: each { k, v, u, s, e, line, sp }, k: w a
//     word (u its upper case) | q a quoted name (v unquoted) | s a string (v as written) | n a number
//     | p a parameter ($1, and ? in MySQL) | o punctuation or an operator (`::` one); s, e its offsets
//     in `text`, sp: a blank or a comment before it. At most `max` tokens (over: true past them).
//   lines(text, first) → (pos) → its line, for positions that only grow (each newline found once).
//   indexParts(text, dialect) → a CREATE INDEX statement's columns as readDdl keeps them (a name, or
//     an expression's text), or null: the SQLite replay's reading of an expression column.
//
// ── The interpreter ──
//   readDdl([{ path, text }] in order, { dialect, dump }) → { entities, enums, statements, skipped,
//     notes, failed, missing, complete, stopped }
//     entities  model.mjs's declaration shape, sorted by name; each element at the line that created
//               or last changed it (a table: its CREATE, or the last ALTER that changed it); in a
//               dump (`dump: true`), at the line that created it
//     enums     [{ name, values, path, line }] (Postgres' CREATE TYPE … AS ENUM)
//     skipped   [{ path, n, kinds: { 'CREATE POLICY': 2, DO: 1, … } }]: statements that do not shape
//               the store (functions, triggers, policies, grants, COMMENT ON, INSERT, SET, extensions,
//               row level security, a DO block…), counted per file by kind, never read further
//     notes     what was not read or followed, by position (`path:line`), never with the SQL's text
//     complete  every statement that shapes the store was read, against tables it knew
//     stopped   null, or { path, line, error } when a cap stopped the replay (the facts so far kept)
//   Read: CREATE TABLE (columns, types as written, NOT NULL, DEFAULT, inline and table-level PRIMARY
//   KEY, UNIQUE, FOREIGN KEY with its actions, CHECK counted, GENERATED … AS (…) and … AS IDENTITY,
//   serials, IF NOT EXISTS, schema-qualified names; LIKE, INHERITS, PARTITION OF, OF and AS noted and
//   not followed: the table is then stated in part), ALTER TABLE (ADD / DROP / RENAME COLUMN, ALTER
//   COLUMN TYPE, SET / DROP NOT NULL, SET / DROP DEFAULT, ADD / DROP IDENTITY, ADD / DROP / RENAME
//   CONSTRAINT, RENAME TO, SET SCHEMA; MySQL's MODIFY, CHANGE, ADD INDEX / KEY, DROP INDEX / KEY /
//   PRIMARY KEY / FOREIGN KEY, FIRST and AFTER; several actions a statement), DROP TABLE, CREATE
//   [UNIQUE] INDEX (CONCURRENTLY, IF NOT EXISTS, USING, INCLUDE, WHERE partial, an expression column
//   kept as its text), DROP INDEX, ALTER INDEX … RENAME, CREATE TYPE … AS ENUM, ALTER TYPE … ADD VALUE
//   [BEFORE | AFTER], … RENAME VALUE, … RENAME TO, DROP TYPE, CREATE SCHEMA, CREATE / DROP VIEW (a view
//   by name), CREATE / ALTER SEQUENCE … OWNED BY (a serial in a dump: an integer column whose default
//   is its own sequence's nextval is a serial again), MySQL's RENAME TABLE, inline INDEX / KEY /
//   UNIQUE KEY / FULLTEXT, ENUM(…), AUTO_INCREMENT and UNSIGNED, and Postgres' search_path.
//   Names: Postgres folds an unquoted name to lower case and keeps a quoted one, and a table outside
//   `public` is named `schema.table`; MySQL's are kept as written (compared in any case). Types are
//   kept as written (a quoted name unquoted, a schema-qualified type by its own name), compared as
//   model.mjs normType says. In MySQL a unique constraint is a unique index (one engine object):
//   kept as an index, named as MySQL names it; so is an unnamed functional index (functional_index,
//   functional_index_2…), and the index MySQL builds for a foreign key no index or primary key leads
//   with (its index name, else the constraint's, else its first column), marked `implicit: true`, as
//   a dump's KEY on exactly those columns named that way is. A COLLATE or a character set, qualified
//   or not (pg_catalog."C"), is read past wherever a column, a type change or an index column has it.
// bytes a file, statements a replay, tokens and elements a statement, nesting, notes kept; columns,
// indexes (and keys, foreign keys) a table; the work budget (each scan of a table's columns,
// indexes or foreign keys counts what it reads); the time a replay may take
export const LIMITS = { bytes: 8 << 20, statements: 100000, tokens: 200000, depth: 256, items: 5000, notes: 40, columns: 4096, indexes: 4096, work: 50_000_000, ms: 10_000 }

const PG = 'postgres', MY = 'mysql', LITE = 'sqlite'

// ── characters ──
const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 128
const isIdChar = (c) => isIdStart(c) || (c >= 48 && c <= 57) || c === 36
const isDigit = (c) => c >= 48 && c <= 57
const isBlank = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11
const OPCHARS = new Set('+-*/<>=~!@#%^&|?'.split('').map((x) => x.charCodeAt(0)))
const NUMBER = /0[xX][0-9a-fA-F]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?/y
const FRACTION = /\.\d+(?:[eE][+-]?\d+)?/y
const DOLLAR = /\$([A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/y

// The end of a quoted run starting at i (its opening quote), or -1 when it never closes. Each search
// starts past the last, so a run of backslashes or doubled quotes stays linear.
function quoted(text, i, q, backslash) {
  const qc = q.charCodeAt(0)
  let k = i, b = backslash ? i : Infinity, j = i + 1
  for (;;) {
    if (k < j) { k = text.indexOf(q, j); if (k < 0) return -1 }
    if (b < j) { b = text.indexOf('\\', j); if (b < 0) b = Infinity }
    if (b < k) { j = b + 2; continue }
    if (text.charCodeAt(k + 1) === qc) { j = k + 2; continue }
    return k + 1
  }
}
// The end of a block comment starting at i, nested in Postgres, or -1. Linear as quoted() is.
function block(text, i, nested) {
  if (!nested) { const k = text.indexOf('*/', i + 2); return k < 0 ? -1 : k + 2 }
  let depth = 1, j = i + 2, o = -1, c = -1
  for (;;) {
    if (o < j && o !== Infinity) { o = text.indexOf('/*', j); if (o < 0) o = Infinity }
    if (c < j) { c = text.indexOf('*/', j); if (c < 0) return -1 }
    if (o < c) { depth++; j = o + 2 } else { depth--; j = c + 2; if (!depth) return j }
  }
}
const lineEnd = (text, i) => { const k = text.indexOf('\n', i); return k < 0 ? text.length : k }
// MySQL reads `--` as a comment only before a blank or a control character (`--1` is minus minus one)
const dashComment = (text, i, my) => text.charCodeAt(i) === 45 && text.charCodeAt(i + 1) === 45 && (!my || !(text.charCodeAt(i + 2) > 32))
const BREAKPOINT = '--> statement-breakpoint'

// MySQL routines whose BEGIN … END body holds `;`, and the words that decide a CREATE is none of them
const ROUTINES = new Set(['TRIGGER', 'PROCEDURE', 'FUNCTION', 'EVENT'])
const NOT_ROUTINE = new Set(['TABLE', 'INDEX', 'VIEW', 'TYPE', 'SCHEMA', 'DATABASE', 'SEQUENCE', 'USER', 'ROLE', 'TABLESPACE', 'SERVER', 'SPATIAL', 'FULLTEXT', 'UNIQUE', 'TEMPORARY'])
const LOOPS = new Set(['IF', 'LOOP', 'WHILE', 'REPEAT'])

// The statement scanner: onCode(a, b) for each run of code, onEnd(unclosed) at each statement's end
// (unclosed: a routine's body was still open), onMeta(a, b) for a psql meta-command line, onError(at,
// why) for what never closes.
function scan(text, { dialect = null, bodies = true, onCode, onEnd, onMeta, onError }) {
  const my = dialect === MY, pg = !my && dialect !== LITE, lite = dialect === LITE
  const to = text.length
  let i = 0, delim = ';', cond = false, goose = false
  let bol = true, any = false // at a line's start (blanks only so far); any code in this statement
  // a routine's body: the statement's first word, how many words, whether it is a MySQL routine,
  // the BEGIN / CASE depth, an END waiting for the word after it, a BEGIN waiting for ATOMIC
  let first = null, words = 0, routine = false, decided = false, body = 0, pendingEnd = false, atomicNext = false, opened = -1, at = -1
  // a body is still open when its depth, less an END waiting for its word, is not back to 0; a
  // DELIMITER's string ends a statement whatever its body says
  const end = () => { onEnd(delim === ';' && body - (pendingEnd ? 1 : 0) > 0, opened); opened = -1; any = false; first = null; words = 0; routine = decided = pendingEnd = atomicNext = false; body = 0 }
  const word = (w) => {
    words++
    if (pendingEnd) { pendingEnd = false; if (my && LOOPS.has(w)) return; body--; if (w === 'CASE') return } // END IF, END CASE
    if (!first) { first = w; return }
    if (body) { if (w === 'BEGIN' || w === 'CASE') body++; else if (w === 'END') pendingEnd = true; return }
    if (first !== 'CREATE') return
    if (atomicNext) { atomicNext = false; if (w === 'ATOMIC') { body = 1; opened = at; return } }
    if (my && !decided && words < 12) { if (ROUTINES.has(w)) routine = decided = true; else if (NOT_ROUTINE.has(w)) decided = true }
    if (w === 'BEGIN') { if (pg) atomicNext = true; else if (routine) { body = 1; opened = at } }
  }
  while (i < to) {
    const c = text.charCodeAt(i)
    if (c === 10) { i++; bol = true; continue }
    if (isBlank(c)) { i++; continue }
    // a MySQL DELIMITER line, where a statement may start
    if (my && bol && !any && (c === 68 || c === 100)) {
      const d = /^delimiter[ \t]+(\S+)/i.exec(text.slice(i, i + 64))
      if (d) { delim = d[1]; i = lineEnd(text, i); continue }
    }
    // a psql meta-command: the rest of its line
    if (pg && bol && !any && c === 92) { const e = lineEnd(text, i); onMeta(i, e); i = e; continue }
    bol = false
    if (c === 45 && text.startsWith(BREAKPOINT, i)) { if (!goose && delim === ';') end(); i = lineEnd(text, i); continue }
    if (dashComment(text, i, my)) {
      const e = lineEnd(text, i)
      const g = /^--\s*\+goose\s+(statementbegin|statementend)\b/i.exec(text.slice(i, Math.min(e, i + 64)))
      if (g && g[1].toLowerCase() === 'statementbegin') goose = true
      else if (g && goose) { goose = false; end() }
      i = e; continue
    }
    if (my && c === 35) { i = lineEnd(text, i); continue }
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      if (my && text.charCodeAt(i + 2) === 33) { i += 3; while (i < to && isDigit(text.charCodeAt(i))) i++; cond = true; continue } // /*!NNNNN …: code to MySQL
      const e = block(text, i, pg)
      if (e < 0) { onError(i, 'an unterminated comment'); break }
      i = e; continue
    }
    if (cond && c === 42 && text.charCodeAt(i + 1) === 47) { i += 2; cond = false; continue }
    // the statement's end
    if (delim !== ';' ? text.startsWith(delim, i) : c === 59) {
      if (delim === ';') {
        if (goose) { onCode(i, i + 1); i++; continue }
        if (pendingEnd) { pendingEnd = false; body-- }
        if (bodies && body > 0) { onCode(i, i + 1); i++; continue }
      }
      end(); i += delim.length; continue
    }
    any = true
    if (c === 39 || c === 34 || c === 96 || (lite && c === 91)) {
      // E'…' (a word E glued to the quote): backslashes escape in Postgres; in every MySQL string
      const bs = my ? c !== 96 : pg && c === 39 && (text.charCodeAt(i - 1) === 69 || text.charCodeAt(i - 1) === 101) && !(i > 1 && isIdChar(text.charCodeAt(i - 2)))
      const e = c === 91 ? closeBracket(text, i) : quoted(text, i, String.fromCharCode(c), bs)
      if (e < 0) { onError(i, c === 39 || (my && c === 34) ? 'an unterminated string' : 'an unterminated quoted name'); onCode(i, to); break }
      onCode(i, e); i = e; continue
    }
    if (pg && c === 36) {
      DOLLAR.lastIndex = i
      const m = DOLLAR.exec(text)
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length)
        if (close < 0) { onError(i, 'an unterminated dollar-quoted string'); onCode(i, to); break }
        onCode(i, close + m[0].length); i = close + m[0].length; continue
      }
    }
    if (isIdStart(c)) {
      // a word ends at a DELIMITER's string too (END$$ is END, then the delimiter)
      let j = i + 1
      while (j < to && isIdChar(text.charCodeAt(j)) && !(delim !== ';' && text.startsWith(delim, j))) j++
      onCode(i, j)
      if (bodies && (words < 64 || body || pendingEnd)) { at = i; word(text.slice(i, j).toUpperCase()) }
      i = j; continue
    }
    onCode(i, i + 1); i++
  }
  if (pendingEnd) body--
  end()
}
const closeBracket = (text, i) => { const k = text.indexOf(']', i); return k < 0 ? -1 : k + 1 }
// The line of a position, for positions that only grow: each newline is found once in all, so a
// file of one long line costs no more than one of many.
export function lines(text, first = 1) {
  let line = first, next = text.indexOf('\n')
  return (pos) => {
    while (next >= 0 && next < pos) { line++; next = text.indexOf('\n', next + 1) }
    return line
  }
}

export function splitSql(text, { dialect = null, max = LIMITS.statements } = {}) {
  const run = (bodies) => {
    const statements = [], errors = []
    let first = -1, last = -1, open = -1, capped = false
    const lineAt = lines(text)
    const push = (a, b) => {
      if (statements.length >= max) { if (!capped) errors.push({ line: lineAt(a), error: `more than ${max} statements: the rest is not read` }); capped = true; return }
      statements.push({ start: a, end: b, line: lineAt(a), text: text.slice(a, b) })
    }
    scan(text, {
      dialect, bodies,
      onCode: (a, b) => { if (first < 0) first = a; last = b },
      onMeta: (a, b) => push(a, b),
      onEnd: (unclosed, from) => { if (unclosed && open < 0) open = from; if (first >= 0) push(first, last); first = -1 },
      onError: (at, error) => errors.push({ line: lineAt(at), error }),
    })
    return { statements, errors, open }
  }
  const r = run(true)
  if (r.open < 0) return { statements: r.statements, errors: r.errors }
  // a routine's body that never closed: read again, its `;` ending statements
  const again = run(false)
  return { statements: again.statements, errors: [...again.errors, { line: text.slice(0, r.open).split('\n').length, error: 'a routine body never closes: its statements were split at each `;`' }] }
}

export function lexSql(text, { dialect = null, line = 1, max = LIMITS.tokens } = {}) {
  const my = dialect === MY, pg = !my && dialect !== LITE, lite = dialect === LITE
  const tokens = []
  const n = text.length
  let i = 0, sp = false, cond = false, over = false
  const lineAt = lines(text, line)
  // a token at [a, b), on the line `at` (where it starts)
  const push = (k, a, b, v, at = lineAt(a)) => {
    if (tokens.length >= max) { over = true; return }
    const t = { k, v: v ?? text.slice(a, b), s: a, e: b, line: at, sp }
    if (k === 'w') t.u = t.v.toUpperCase()
    tokens.push(t); sp = false
  }
  while (i < n && !over) {
    const c = text.charCodeAt(i)
    if (isBlank(c)) { i++; sp = true; continue }
    if (c === 45 && text.startsWith(BREAKPOINT, i)) { i = lineEnd(text, i); sp = true; continue }
    if (dashComment(text, i, my) || (my && c === 35)) { i = lineEnd(text, i); sp = true; continue }
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      if (my && text.charCodeAt(i + 2) === 33) { i += 3; while (i < n && isDigit(text.charCodeAt(i))) i++; cond = true; sp = true; continue }
      const e = block(text, i, pg)
      i = e < 0 ? n : e; sp = true; continue
    }
    if (cond && c === 42 && text.charCodeAt(i + 1) === 47) { i += 2; cond = false; sp = true; continue }
    if (c === 39 || (my && c === 34)) {
      const e1 = text.charCodeAt(i - 1)
      const bs = my || (pg && (e1 === 69 || e1 === 101) && !(i > 1 && isIdChar(text.charCodeAt(i - 2))))
      const e = quoted(text, i, String.fromCharCode(c), bs), to = e < 0 ? n : e
      // a prefix glued to it (E'…', N'…', X'…', B'…', U&'…', _utf8mb4'…') is part of the string
      const prev = tokens[tokens.length - 1], prev2 = tokens[tokens.length - 2]
      if (prev && prev.e === i && prev.k === 'w' && /^(?:[ENXBenxb]|_\w+)$/.test(prev.v)) { tokens.pop(); sp = prev.sp; push('s', prev.s, to, undefined, prev.line) }
      else if (prev && prev.e === i && prev.k === 'o' && prev.v === '&' && prev2?.k === 'w' && /^[Uu]$/.test(prev2.v) && prev2.e === prev.s) { tokens.pop(); tokens.pop(); sp = prev2.sp; push('s', prev2.s, to, undefined, prev2.line) }
      else push('s', i, to)
      i = to; continue
    }
    if (c === 34 || c === 96 || (lite && c === 91)) {
      const e = c === 91 ? closeBracket(text, i) : quoted(text, i, String.fromCharCode(c), false), to = e < 0 ? n : e
      const q = String.fromCharCode(c === 91 ? 93 : c)
      push('q', i, to, text.slice(i + 1, e < 0 ? n : to - 1).split(q + q).join(q))
      i = to; continue
    }
    if (pg && c === 36) {
      DOLLAR.lastIndex = i
      const m = DOLLAR.exec(text)
      if (m) { const close = text.indexOf(m[0], i + m[0].length), to = close < 0 ? n : close + m[0].length; push('s', i, to); i = to; continue }
      let j = i + 1
      while (j < n && isDigit(text.charCodeAt(j))) j++
      if (j > i + 1) { push('p', i, j); i = j; continue }
    }
    if (isIdStart(c)) { let j = i + 1; while (j < n && isIdChar(text.charCodeAt(j))) j++; push('w', i, j); i = j; continue }
    if (isDigit(c) || (c === 46 && isDigit(text.charCodeAt(i + 1)))) {
      const re = c === 46 ? FRACTION : NUMBER
      re.lastIndex = i
      const r = re.exec(text)
      const j = r ? i + r[0].length : i + 1
      push('n', i, j); i = j; continue
    }
    if (c === 58 && text.charCodeAt(i + 1) === 58) { push('o', i, i + 2); i += 2; continue }
    if (my && c === 63) { push('p', i, i + 1); i++; continue }
    if (OPCHARS.has(c) && !(my && c === 35)) {
      let j = i + 1
      while (j < n && OPCHARS.has(text.charCodeAt(j)) && !dashComment(text, j, my) && !(text.charCodeAt(j) === 47 && text.charCodeAt(j + 1) === 42) && !(my && text.charCodeAt(j) === 35)) j++
      push('o', i, j); i = j; continue
    }
    push('o', i, i + 1); i++
  }
  return { tokens, over }
}
// ── the interpreter ──

// What the interpreter could not read: why, where (never the statement's text).
class Unread extends Error { constructor(why, line) { super(why); this.line = line } }
// A cap, the work budget or the clock reached: the replay stops at the statement (facts so far kept).
class Stop extends Error {}

// A cursor over a statement's tokens, between `i` and `end`.
class Cur {
  constructor(t, src, dialect, i = 0, end = t.length, depth = LIMITS.depth) { Object.assign(this, { t, src, d: dialect, i, end, maxDepth: depth }) }
  get done() { return this.i >= this.end }
  peek(o = 0) { return this.i + o < this.end ? this.t[this.i + o] : null }
  line() { return (this.peek() || this.t[Math.min(this.i, this.t.length) - 1] || { line: 0 }).line }
  is(...words) { for (let j = 0; j < words.length; j++) { const x = this.peek(j); if (!x || x.k !== 'w' || x.u !== words[j]) return false } return true }
  isOp(op, o = 0) { const x = this.peek(o); return !!x && x.k === 'o' && x.v === op }
  isName(o = 0) { const x = this.peek(o); return !!x && (x.k === 'w' || x.k === 'q' || (this.d === MY && x.k === 's' && x.v[0] === '"')) }
  eat(...words) { if (!this.is(...words)) return false; this.i += words.length; return true }
  eatOp(op) { if (!this.isOp(op)) return false; this.i++; return true }
  need(...words) { if (!this.eat(...words)) this.fail(`${words.join(' ')} was expected`) }
  fail(why) { throw new Unread(why, this.line()) }
  sub(a, b) { return new Cur(this.t, this.src, this.d, a, b, this.maxDepth) }
  // a name, folded as the dialect folds it
  name() { if (!this.isName()) this.fail('a name was expected'); return fold(this.t[this.i++], this.d) }
  // a dotted name: its parts, folded
  qname() { const parts = [this.name()]; while (this.isOp('.') && parts.length < 3) { this.i++; parts.push(this.name()) } return parts }
  // from `(` to its `)`: the token range inside it
  group() {
    if (!this.isOp('(')) this.fail('( was expected')
    let depth = 0
    for (let j = this.i; j < this.end; j++) {
      const x = this.t[j]
      if (x.k !== 'o') continue
      if (x.v === '(') { if (++depth > this.maxDepth) throw new Unread('nested too deep', x.line) } else if (x.v === ')' && --depth === 0) { const r = [this.i + 1, j]; this.i = j + 1; return r }
    }
    this.fail('a parenthesis never closes')
  }
  // the ranges between top-level commas of [a, b)
  items(a = this.i, b = this.end) {
    const out = []
    let depth = 0, from = a
    for (let j = a; j < b; j++) {
      const x = this.t[j]
      if (x.k !== 'o') continue
      if (x.v === '(' || x.v === '[') { if (++depth > this.maxDepth) throw new Unread('nested too deep', x.line) } else if (x.v === ')' || x.v === ']') depth--
      else if (x.v === ',' && depth === 0) { out.push([from, j]); from = j + 1; if (out.length > LIMITS.items) throw new Unread(`more than ${LIMITS.items} elements`, x.line) }
    }
    out.push([from, b])
    return out
  }
  // skip to the end of this range, past balanced groups, stopping before a top-level word in `stops`
  until(stops) {
    let depth = 0
    while (!this.done) {
      const x = this.peek()
      if (x.k === 'o' && (x.v === '(' || x.v === '[')) { if (++depth > this.maxDepth) this.fail('nested too deep') } else if (x.k === 'o' && (x.v === ')' || x.v === ']')) depth--
      else if (!depth && x.k === 'w' && stops(this)) break
      this.i++
    }
  }
  // the source text of [a, b), blanks between tokens collapsed to one space
  text(a, b) { let s = ''; for (let j = a; j < b; j++) { const x = this.t[j]; s += (j > a && x.sp ? ' ' : '') + this.src.slice(x.s, x.e) } return s }
}

const fold = (x, dialect) => (x.k === 'q' ? x.v : x.k === 's' ? x.v.slice(1, -1) : dialect === PG ? x.v.toLowerCase() : x.v)
const unstring = (x) => {
  if (x.k !== 's') return x.v
  const v = x.v
  if (v[0] === '$') { const t = v.indexOf('$', 1); return v.slice(t + 1, v.length - t - 1) }
  const q = v.indexOf("'"), body = v.slice(q + 1, -1)
  return /^[Ee]$/.test(v.slice(0, q)) ? body.replace(/''/g, "'").replace(/\\(.)/g, '$1') : body.replace(/''/g, "'")
}

// A type's text: the source, a quoted name unquoted, a dotted name by its last part.
function typeText(c, a, b) {
  let s = ''
  for (let j = a; j < b; j++) {
    let x = c.t[j]
    const sp = j > a && x.sp
    if ((x.k === 'w' || x.k === 'q') && c.t[j + 1]?.k === 'o' && c.t[j + 1].v === '.' && j + 2 < b && (c.t[j + 2].k === 'w' || c.t[j + 2].k === 'q')) { j += 2; x = c.t[j] }
    s += (sp ? ' ' : '') + (x.k === 'q' ? x.v : c.src.slice(x.s, x.e))
  }
  return s
}

const INT_SERIAL = { integer: 'serial', int: 'serial', int4: 'serial', serial: 'serial', serial4: 'serial', bigint: 'bigserial', int8: 'bigserial', bigserial: 'bigserial', serial8: 'bigserial', smallint: 'smallserial', int2: 'smallserial', smallserial: 'smallserial', serial2: 'smallserial' }
const SERIALS = { serial: 'integer', serial4: 'integer', bigserial: 'bigint', serial8: 'bigint', smallserial: 'smallint', serial2: 'smallint' }
const ACTIONS = new Set(['CASCADE', 'RESTRICT'])
// a Postgres name as it must be written: quoted unless it reads back the same unquoted
const ident = (s) => (/^[a-z_][a-z0-9_$]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`)

// words that end a column's type (or a default) at the top level
const COL_STOPS = new Set(['CONSTRAINT', 'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'GENERATED', 'COLLATE', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'COMMENT', 'ON', 'KEY', 'AS', 'VISIBLE', 'INVISIBLE', 'STORAGE', 'COMPRESSION', 'SRID', 'COLUMN_FORMAT', 'ENGINE_ATTRIBUTE', 'SECONDARY_ENGINE_ATTRIBUTE', 'DEFERRABLE', 'INITIALLY', 'FIRST', 'AFTER', 'CHARSET', 'USING'])
const typeStop = (c) => { const u = c.peek().u; return (COL_STOPS.has(u) && !(u === 'NOT' && !c.is('NOT', 'NULL') && !c.is('NOT', 'DEFERRABLE'))) || c.is('CHARACTER', 'SET') }
const DEFAULT_STOPS = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'GENERATED', 'COLLATE', 'AUTO_INCREMENT', 'COMMENT', 'KEY', 'VISIBLE', 'INVISIBLE', 'STORAGE', 'COMPRESSION', 'DEFERRABLE', 'INITIALLY', 'FIRST', 'AFTER'])
const defaultStop = (c) => DEFAULT_STOPS.has(c.peek().u) || c.is('NOT', 'NULL') || c.is('NOT', 'DEFERRABLE') || c.is('NULL') || c.is('ON', 'UPDATE')

// An element changed by a later statement is placed on that statement's line, as the SQLite replay
// places it, unless the text is a dump: there each element stays where its CREATE states it (a dump
// adds its keys and defaults in ALTERs after all its tables).
const moved = (db, x, at) => { if (!db.dump) x.at = at }

export function readDdl(files, { dialect = PG, dump = false, limits: given = LIMITS } = {}) {
  const limits = { ...LIMITS, ...given }
  const db = { dialect, dump, limits, work: 0, schema: dialect === PG ? 'public' : null, tables: new Map(), views: new Map(), enums: new Map(), seqs: new Map(), indexOwner: new Map(), refsTo: new Map(), pgNext: new Map() }
  const notes = [], skipped = []
  const deadline = Date.now() + limits.ms
  let statements = 0, failed = 0, missing = 0, stopped = null, total = 0, dropped = 0
  const note = (s) => { if (notes.length < limits.notes) notes.push(s); else dropped++ }
  run: for (const f of files) {
    if (f.text.length > limits.bytes) { stopped = { path: f.path, line: 1, error: `larger than ${limits.bytes >> 20} MB: not read` }; break }
    const split = splitSql(f.text, { dialect, max: limits.statements - total })
    for (const e of split.errors) { note(`${f.path}:${e.line}: ${e.error}`); failed++ }
    const kinds = new Map()
    for (const st of split.statements) {
      if (++total > limits.statements) { stopped = { path: f.path, line: st.line, error: `more than ${limits.statements} statements: the replay stops here` }; break run }
      if (Date.now() > deadline) { stopped = { path: f.path, line: st.line, error: 'the replay took more than its time: it stops here' }; break run }
      const at = { path: f.path, line: st.line }
      let r
      try { r = statement(db, st, at, limits, note) } catch (e) {
        if (e instanceof Stop) { stopped = { path: f.path, line: st.line, error: e.message }; break run }
        r = { failed: e instanceof Unread ? e : new Unread('it could not be read', st.line), kind: null }
      }
      if (r.skipped) { kinds.set(r.skipped, (kinds.get(r.skipped) || 0) + 1); continue }
      if (r.failed) { failed++; note(`${f.path}:${st.line}: ${r.kind ? `${r.kind} ` : 'a statement '}not read (${r.failed.message}${r.failed.line && r.failed.line !== st.line ? `, at line ${r.failed.line}` : ''})`); continue }
      if (r.missing) { missing++; note(`${f.path}:${st.line}: ${r.kind} ${r.missing}: no earlier statement creates it (not applied)`); continue }
      if (r.applied) statements++
    }
    if (kinds.size) {
      const n = [...kinds.values()].reduce((a, b) => a + b, 0)
      skipped.push({ path: f.path, n, kinds: Object.fromEntries([...kinds].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) })
    }
  }
  if (dropped) notes.push(`… and ${dropped} more note${dropped === 1 ? '' : 's'}`)
  return { ...modelOf(db), statements, skipped, notes, failed, missing, complete: !failed && !missing && !stopped, stopped }
}

// A statement's kind, as a label made of keywords only (never a name it holds).
const OBJECTS = new Set(['TABLE', 'INDEX', 'VIEW', 'SEQUENCE', 'TYPE', 'SCHEMA', 'DATABASE', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'POLICY', 'EXTENSION', 'ROLE', 'USER', 'GROUP', 'DOMAIN', 'PUBLICATION', 'SUBSCRIPTION', 'RULE', 'AGGREGATE', 'CAST', 'OPERATOR', 'COLLATION', 'CONVERSION', 'LANGUAGE', 'SERVER', 'STATISTICS', 'TABLESPACE', 'EVENT', 'MATERIALIZED', 'FOREIGN', 'TEXT', 'DEFAULT', 'ACCESS', 'TRANSFORM', 'LOGFILE', 'SPATIAL', 'RESOURCE', 'INSTANCE', 'OWNED', 'LARGE', 'SYSTEM', 'ROUTINE', 'PRIVILEGES'])
const MODIFIERS = new Set(['OR', 'REPLACE', 'GLOBAL', 'LOCAL', 'TEMP', 'TEMPORARY', 'UNLOGGED', 'UNIQUE', 'RECURSIVE', 'TRUSTED', 'PROCEDURAL', 'CONSTRAINT', 'IF', 'EXISTS', 'NOT', 'ONLINE', 'OFFLINE', 'FULLTEXT', 'AGGREGATE'])
// the statements' first words a label may name (anything else is `other`: a label never echoes a word it does not know)
const VERBS = new Set(['INSERT', 'UPDATE', 'DELETE', 'SELECT', 'SET', 'GRANT', 'REVOKE', 'DO', 'BEGIN', 'COMMIT', 'ROLLBACK', 'START', 'END', 'LOCK', 'UNLOCK', 'ANALYZE', 'VACUUM', 'REFRESH', 'TRUNCATE', 'CALL', 'USE', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'CLUSTER', 'REINDEX', 'CHECKPOINT', 'DISCARD', 'NOTIFY', 'LISTEN', 'UNLISTEN', 'IMPORT', 'COPY', 'SAVEPOINT', 'RELEASE', 'SECURITY', 'WITH', 'VALUES', 'EXPLAIN', 'RESET', 'SHOW', 'LOAD', 'REPLACE', 'FLUSH', 'OPTIMIZE', 'RENAME', 'ABORT', 'DECLARE', 'FETCH', 'MOVE', 'CLOSE', 'PERFORM', 'SOURCE', 'HANDLER', 'KILL', 'PURGE', 'CHECKSUM', 'REPAIR', 'INSTALL', 'UNINSTALL', 'CHANGE', 'STOP', 'RESTART', 'SHUTDOWN', 'TABLE', 'MERGE'])
const SECOND = { MATERIALIZED: 'VIEW', FOREIGN: ['TABLE', 'DATA'], EVENT: 'TRIGGER', DEFAULT: 'PRIVILEGES', TEXT: 'SEARCH', OWNED: 'BY', LARGE: 'OBJECT', ACCESS: 'METHOD' }
function label(c) {
  const w = c.peek()
  if (!w) return 'other'
  if (w.k !== 'w') return 'other'
  const verb = w.u
  if (verb === 'COMMENT') return 'COMMENT ON'
  if (verb !== 'CREATE' && verb !== 'ALTER' && verb !== 'DROP') return VERBS.has(verb) ? verb : 'other'
  let j = 1
  // MySQL's DEFINER = …, ALGORITHM = …, SQL SECURITY …: skipped up to the object's word
  for (let k = 0; k < 16; k++) {
    const x = c.peek(j)
    if (!x) break
    if (x.k === 'w' && OBJECTS.has(x.u)) break
    if (x.k === 'w' && (MODIFIERS.has(x.u) || x.u === 'DEFINER' || x.u === 'ALGORITHM' || x.u === 'SQL' || x.u === 'SECURITY' || x.u === 'INVOKER' || x.u === 'MERGE' || x.u === 'UNDEFINED' || x.u === 'TEMPTABLE' || x.u === 'CURRENT_USER')) { j++; continue }
    if (x.k !== 'w') { j++; continue }
    return verb
  }
  const o = c.peek(j)
  if (!o || o.k !== 'w' || !OBJECTS.has(o.u)) return verb
  const two = SECOND[o.u], n2 = c.peek(j + 1)
  const temp = verb === 'CREATE' && o.u === 'TABLE' && [...Array(j).keys()].some((k) => /^TEMP(ORARY)?$/.test(c.peek(k)?.u || ''))
  return `${verb}${temp ? ' TEMPORARY' : ''} ${o.u}${two && n2?.k === 'w' && (Array.isArray(two) ? two.includes(n2.u) : two === n2.u) ? ` ${n2.u}` : ''}`
}

function statement(db, st, at, limits, note) {
  if (st.text.charCodeAt(0) === 92) return { skipped: 'psql meta-command' }
  const head = lexSql(st.text, { dialect: db.dialect, line: st.line, max: 24 })
  const h = new Cur(head.tokens, st.text, db.dialect)
  const kind = label(h)
  const MODEL = /^(?:CREATE (?:TABLE|INDEX|TYPE|SCHEMA|DATABASE|VIEW|MATERIALIZED VIEW|SEQUENCE)|ALTER (?:TABLE|TYPE|INDEX|SEQUENCE|VIEW|MATERIALIZED VIEW)|DROP (?:TABLE|INDEX|TYPE|VIEW|MATERIALIZED VIEW|SEQUENCE|SCHEMA)|RENAME|SET)$/
  if (!MODEL.test(kind)) return { skipped: kind }
  if (kind === 'RENAME' && !(db.dialect === MY && h.is('RENAME', 'TABLE'))) return { skipped: kind }
  if (kind === 'SET') {
    // Postgres' search_path decides the schema of an unqualified name; the statement itself shapes nothing
    if (db.dialect === PG && h.is('SET') && (h.is('SET', 'SEARCH_PATH') || h.is('SET', 'LOCAL', 'SEARCH_PATH') || h.is('SET', 'SESSION', 'SEARCH_PATH'))) {
      const lx = lexSql(st.text, { dialect: db.dialect, line: st.line, max: 64 }).tokens
      const names = lx.slice(2).filter((x) => (x.k === 'w' && !['SEARCH_PATH', 'TO', 'LOCAL', 'SESSION', 'DEFAULT'].includes(x.u)) || x.k === 'q' || x.k === 's').map((x) => (x.k === 's' ? unstring(x) : fold(x, PG)))
      const first = names.find((x) => x && x !== '$user')
      if (first) db.schema = first
    }
    return { skipped: kind }
  }
  const lx = lexSql(st.text, { dialect: db.dialect, line: st.line, max: limits.tokens })
  if (lx.over) return { failed: new Unread(`more than ${limits.tokens} tokens`, st.line), kind }
  const c = new Cur(lx.tokens, st.text, db.dialect, 0, lx.tokens.length, limits.depth)
  const ctx = { at, note, db }
  try {
    const r = interpret(db, c, kind, ctx)
    return typeof r === 'string' ? { skipped: r } : r?.missing ? { missing: r.missing, kind } : { applied: true }
  } catch (e) {
    if (e instanceof Unread) return { failed: e, kind }
    throw e
  }
}

function interpret(db, c, kind, ctx) {
  const verb = c.peek().u
  c.i++
  if (verb === 'RENAME') return renameTables(db, c, ctx)
  // modifiers up to the object
  let temp = false, unique = false, fulltext = false
  for (let k = 0; k < 16 && !c.done; k++) {
    const x = c.peek()
    if (x.k === 'w' && (x.u === 'TEMP' || x.u === 'TEMPORARY')) { temp = true; c.i++; continue }
    if (x.k === 'w' && x.u === 'UNIQUE') { unique = true; c.i++; continue }
    if (x.k === 'w' && (x.u === 'FULLTEXT' || x.u === 'SPATIAL')) { fulltext = true; c.i++; continue }
    if (x.k === 'w' && x.u === 'MATERIALIZED') { c.i++; continue } // a materialized view is a view by name
    if (c.eat('OR', 'REPLACE')) continue
    if (x.k === 'w' && (x.u === 'GLOBAL' || x.u === 'LOCAL' || x.u === 'UNLOGGED' || x.u === 'RECURSIVE' || x.u === 'ONLINE' || x.u === 'OFFLINE')) { c.i++; continue }
    if (x.k === 'w' && (x.u === 'DEFINER' || x.u === 'ALGORITHM')) { c.i++; c.eatOp('='); while (!c.done && !(c.peek().k === 'w' && (OBJECTS.has(c.peek().u) || c.peek().u === 'SQL'))) c.i++; continue }
    if (c.eat('SQL', 'SECURITY')) { c.i++; continue }
    break
  }
  const obj = c.peek()?.u
  c.i++
  if (verb === 'CREATE') {
    if (obj === 'TABLE') return temp ? 'CREATE TEMPORARY TABLE' : createTable(db, c, ctx)
    if (obj === 'INDEX') return createIndex(db, c, ctx, unique, fulltext)
    if (obj === 'TYPE') return createType(db, c, ctx)
    if (obj === 'SCHEMA' || obj === 'DATABASE') return { applied: true } // a namespace: no element of its own
    if (obj === 'VIEW') return temp ? 'CREATE TEMPORARY VIEW' : createView(db, c, ctx)
    if (obj === 'SEQUENCE') return temp ? 'CREATE TEMPORARY SEQUENCE' : createSequence(db, c, ctx)
  }
  if (verb === 'ALTER') {
    if (obj === 'TABLE') return alterTable(db, c, ctx)
    if (obj === 'TYPE') return alterType(db, c, ctx)
    if (obj === 'INDEX') return alterIndex(db, c, ctx)
    if (obj === 'SEQUENCE') return alterSequence(db, c, ctx)
    if (obj === 'VIEW') return alterView(db, c, ctx)
  }
  if (verb === 'DROP') {
    if (obj === 'TABLE') return dropTables(db, c, ctx)
    if (obj === 'INDEX') return dropIndex(db, c, ctx)
    if (obj === 'TYPE') return dropTypes(db, c, ctx)
    if (obj === 'VIEW') return dropViews(db, c, ctx)
    if (obj === 'SEQUENCE') return dropSequences(db, c, ctx)
    if (obj === 'SCHEMA') return dropSchema(db, c, ctx)
  }
  return kind
}

// ── names ──
// A table's state: { key, q, at, cols (in order), colIx Map(name as compared → column), pk, uniques,
// ix Map(name as compared → index), ixNext, implicit Set (MySQL's foreign-key indexes), fks Set,
// checks, seqs Set (the sequences its columns own), part }. Every lookup by name is one map read; the
// foreign keys pointing at a table are kept by its key (db.refsTo), so a drop or a rename touches
// what it changes, never every table. What is not O(1) is charged to the work budget (cost).
const qual = (db, parts) => { const p = parts.slice(-2); return p.length === 2 ? { schema: p[0], name: p[1] } : { schema: db.schema, name: p[0] } }
const keyOf = (q) => (q.schema ? `${q.schema}.${q.name}` : q.name)
const shown = (db, q) => (!q.schema || (db.dialect === PG && q.schema === 'public') ? q.name : `${q.schema}.${q.name}`)
// a name as compared: MySQL's in any case, Postgres' as folded
const cmp = (db, s) => (db.dialect === MY ? String(s).toLowerCase() : String(s))
const tkey = (db, q) => cmp(db, keyOf(q))
const same = (db, a, b) => cmp(db, a) === cmp(db, b)
function findIn(db, map, q) {
  const v = map.get(tkey(db, q))
  if (v) return v
  if (db.dialect === PG && q.schema !== 'public' && !q.explicit) return map.get(`public.${q.name}`) || null
  return null
}
const tableOf = (db, parts) => { const q = qual(db, parts); q.explicit = parts.length > 1; return { q, t: findIn(db, db.tables, q) } }
const colOf = (db, t, name) => t.colIx.get(cmp(db, name)) || null
const ixOf = (db, t, name) => t.ix.get(cmp(db, name)) || null
const loc = (ctx, line) => ({ path: ctx.at.path, line: line ?? ctx.at.line })
const cost = (db, n) => { db.work += n; if (db.work > db.limits.work) throw new Stop('the replay took more than its work budget: it stops here') }

function newTable(db, q, at) { return { key: tkey(db, q), q, at, cols: [], colIx: new Map(), pk: null, uniques: [], ix: new Map(), ixNext: new Map(), implicit: new Set(), fks: new Set(), checks: [], seqs: new Set(), part: false, n: { fk: 0 } } }

// a column joins its table, placed as MySQL's FIRST / AFTER say, else last
function placeCol(db, t, col, how) {
  if (t.cols.length >= db.limits.columns) throw new Stop(`a table of more than ${db.limits.columns} columns: the replay stops here`)
  if (how.first) { cost(db, t.cols.length); t.cols.unshift(col) }
  else if (how.after) {
    const prev = colOf(db, t, how.after)
    if (!prev) throw new Unread('AFTER names a column the table does not have', col.at.line)
    cost(db, t.cols.length)
    t.cols.splice(t.cols.indexOf(prev) + 1, 0, col)
  } else t.cols.push(col)
  t.colIx.set(cmp(db, col.name), col)
  delete col.first; delete col.after
}
function unplaceCol(db, t, col) { cost(db, t.cols.length); t.cols.splice(t.cols.indexOf(col), 1); t.colIx.delete(cmp(db, col.name)) }

function addIndex(db, t, ix) {
  if (t.ix.size >= db.limits.indexes) throw new Stop(`a table of more than ${db.limits.indexes} indexes: the replay stops here`)
  t.ix.set(cmp(db, ix.name), ix)
  if (db.dialect === PG) db.indexOwner.set(`${t.q.schema}.${ix.name}`, t)
  // MySQL drops the index it made for a foreign key once another index serves it (a dump states
  // the indexes there are: none goes)
  if (db.dialect === MY && !db.dump && !ix.implicit && t.implicit.size) for (const i of [...t.implicit]) if (leads(db, ix.columns, i.implicit.columns)) removeIndex(db, t, i)
}
function removeIndex(db, t, ix) {
  t.ix.delete(cmp(db, ix.name))
  t.implicit.delete(ix)
  if (db.dialect === PG) db.indexOwner.delete(`${t.q.schema}.${ix.name}`)
}
// a name not yet taken: base, else base_2, base_3… (as MySQL names a second index of a column)
function freshIndexName(db, t, base) {
  if (!t.ix.has(cmp(db, base))) return base
  const b = cmp(db, base)
  let k = t.ixNext.get(b) || 2
  while (t.ix.has(cmp(db, `${base}_${k}`))) k++
  t.ixNext.set(b, k + 1)
  return `${base}_${k}`
}
// does an index on `cols` lead with `need`, in order?
const leads = (db, cols, need) => need.length <= cols.length && need.every((c, i) => same(db, c, cols[i]))

const refsOf = (db, key) => { let s = db.refsTo.get(key); if (!s) db.refsTo.set(key, (s = new Set())); return s }
function addFkTo(db, t, f) { t.fks.add(f); refsOf(db, f.to).add(f) }
function removeFk(db, f) {
  f.from.fks.delete(f)
  db.refsTo.get(f.to)?.delete(f)
  // the index MySQL made for it stays, an index like any other
  for (const i of f.from.implicit) if (i.implicit === f) { i.implicit = null; f.from.implicit.delete(i) }
}

// ── CREATE TABLE ──
function createTable(db, c, ctx) {
  const ifNot = c.eat('IF', 'NOT', 'EXISTS')
  const { q, t: old } = tableOf(db, c.qname())
  if (old || findIn(db, db.views, q)) { if (ifNot) return 'CREATE TABLE IF NOT EXISTS (it exists)'; c.fail('the table already exists') }
  const t = newTable(db, q, loc(ctx))
  const shownName = shown(db, q)
  if (c.eat('PARTITION', 'OF')) { t.part = true; ctx.note(`${ctx.at.path}:${ctx.at.line}: ${shownName} is a partition of another table (PARTITION OF): its columns are not followed`) }
  else if (c.is('OF')) { t.part = true; ctx.note(`${ctx.at.path}:${ctx.at.line}: ${shownName} is a typed table (OF): its columns are not followed`) }
  else if (c.is('AS') || c.is('LIKE') || c.is('SELECT')) { t.part = true; ctx.note(`${ctx.at.path}:${ctx.at.line}: ${shownName} is created ${c.is('LIKE') ? 'like another table (LIKE)' : 'from a query (AS)'}: its columns are not followed`) }
  else if (c.isOp('(')) {
    const [a, b] = c.group()
    const inner = c.sub(a, b)
    // the columns first, then the table's constraints and indexes (which may come before them)
    const els = inner.items().map(([x, y]) => inner.sub(x, y))
    const isColumn = (e) => !(e.is('CONSTRAINT') || e.is('PRIMARY', 'KEY') || e.is('UNIQUE') || e.is('FOREIGN', 'KEY') || e.is('CHECK') || (e.is('EXCLUDE') && (e.isOp('(', 1) || e.is('EXCLUDE', 'USING'))) || e.is('LIKE') || (db.dialect === MY && (e.is('INDEX') || e.is('KEY') || e.is('FULLTEXT') || e.is('SPATIAL'))))
    const cols = els.map((e) => !e.done && isColumn(e))
    els.forEach((e, k) => cols[k] && element(db, t, e, ctx, shownName))
    els.forEach((e, k) => !cols[k] && element(db, t, e, ctx, shownName))
    for (let j = c.i; j < c.end; j++) if (c.t[j].k === 'w' && c.t[j].u === 'INHERITS') { t.part = true; ctx.note(`${ctx.at.path}:${ctx.at.line}: ${shownName} inherits another table's columns (INHERITS): not followed`); break }
  } else c.fail('( was expected')
  fkIndexes(db, t)
  db.tables.set(t.key, t)
  return { applied: true }
}

function element(db, t, e, ctx, shownName) {
  if (e.done) e.fail('an empty element')
  let cname = null
  if (e.eat('CONSTRAINT')) { if (!(e.is('PRIMARY') || e.is('UNIQUE') || e.is('FOREIGN') || e.is('CHECK') || e.is('EXCLUDE'))) cname = e.name() }
  if (constraint(db, t, e, cname, ctx)) return
  if (cname) e.fail('a constraint was expected')
  if (e.is('LIKE')) { t.part = true; ctx.note(`${ctx.at.path}:${ctx.at.line}: ${shownName} copies another table's columns (LIKE): not followed`); return }
  if (db.dialect === MY && (e.is('INDEX') || e.is('KEY') || e.is('FULLTEXT') || e.is('SPATIAL'))) { mysqlIndex(db, t, e, ctx, false); return }
  const col = column(db, t, e, ctx)
  if (colOf(db, t, col.name)) e.fail('a column is defined twice')
  placeCol(db, t, col, {})
  afterColumn(db, t, col, ctx)
}

// A column definition: { name, type, notNull, def, generated, identity, at } (+ what it states
// inline: pk, unique, refs, position), read up to the end of `e`.
function column(db, t, e, ctx) {
  const tok = e.peek()
  const name = e.name()
  const a = e.i
  e.until(typeStop)
  if (e.i === a) e.fail('a type was expected')
  const col = { name, type: typeText(e, a, e.i), notNull: false, def: null, generated: null, identity: null, at: loc(ctx, tok.line), inline: [] }
  if (db.dialect === PG && SERIALS[lowType(col.type)]) col.serial = true
  let cname = null
  while (!e.done) {
    const line = e.line()
    if (e.eat('CONSTRAINT')) { cname = e.name(); continue }
    if (e.eat('NOT', 'NULL')) { col.notNull = true; continue }
    if (e.eat('NULL')) { col.notNull = false; continue }
    if (e.eat('DEFAULT')) { col.def = defaultOf(e); continue }
    if (e.eat('PRIMARY', 'KEY') || (db.dialect === MY && e.eat('KEY'))) { col.inline.push({ kind: 'pk', name: cname, line }); cname = null; e.eat('ASC') || e.eat('DESC'); continue }
    if (e.eat('UNIQUE')) { e.eat('KEY') || e.eat('INDEX'); nullsDistinct(e); col.inline.push({ kind: 'unique', name: cname, line }); cname = null; continue }
    if (e.eat('REFERENCES')) { col.inline.push({ kind: 'fk', name: cname, ref: references(db, e), line }); cname = null; continue }
    if (e.eat('CHECK')) { e.group(); e.eat('NO', 'INHERIT'); e.eat('NOT', 'ENFORCED') || e.eat('ENFORCED'); col.inline.push({ kind: 'check', name: cname, line }); cname = null; continue }
    if (e.eat('GENERATED')) {
      if (e.eat('ALWAYS') || e.eat('BY', 'DEFAULT')) { /* the kind of identity or generation */ }
      e.need('AS')
      if (e.eat('IDENTITY')) { col.identity = true; col.notNull = true; if (e.isOp('(')) e.group(); continue }
      e.group()
      col.generated = e.eat('STORED') ? 'stored' : (e.eat('VIRTUAL'), 'virtual') // virtual unless stored (Postgres 18, MySQL)
      continue
    }
    if (db.dialect === MY && e.eat('AS')) { e.group(); col.generated = e.eat('STORED') ? 'stored' : (e.eat('VIRTUAL'), 'virtual'); continue }
    if (e.eat('COLLATE')) { collation(e); continue }
    if (e.eat('AUTO_INCREMENT') || e.eat('AUTOINCREMENT')) { col.autoIncrement = true; continue }
    if (e.eat('COMMENT')) { e.i++; continue }
    if (e.eat('ON', 'UPDATE')) { e.i++; if (e.isOp('(')) e.group(); continue }
    if (e.eat('CHARACTER', 'SET') || e.eat('CHARSET')) { collation(e); continue }
    if (e.eat('VISIBLE') || e.eat('INVISIBLE')) continue
    if (e.eat('STORAGE') || e.eat('COMPRESSION') || e.eat('COLUMN_FORMAT') || e.eat('SRID')) { e.i++; continue }
    if (e.eat('ENGINE_ATTRIBUTE') || e.eat('SECONDARY_ENGINE_ATTRIBUTE')) { e.eatOp('='); e.i++; continue }
    if (deferrable(e)) continue
    if (e.eat('FIRST')) { col.first = true; continue }
    if (e.eat('AFTER')) { col.after = e.name(); continue }
    e.fail('an unexpected word in a column definition')
  }
  return col
}
// A collation's or a character set's name, qualified or not (pg_catalog."C", utf8mb4_bin, 'latin1')
function collation(e) {
  if (!e.isName() && e.peek()?.k !== 's') e.fail('a collation was expected')
  e.i++
  for (let k = 0; k < 2 && e.isOp('.') && e.isName(1); k++) e.i += 2
}

// After a column joins its table: a serial's sequence, and what the column states inline.
function afterColumn(db, t, col, ctx) {
  if (col.serial) {
    const seq = { schema: t.q.schema, name: `${t.q.name}_${col.name}_seq` }
    own(db, t, keyOf(seq), seq, col.name)
    col.def = `nextval('${[seq.schema, seq.name].map(ident).join('.').replace(/'/g, "''")}'::regclass)`
    col.notNull = true
  }
  for (const x of col.inline) {
    const at = loc(ctx, x.line)
    if (x.kind === 'pk') setPk(db, t, [col.name], x.name, at, ctx)
    else if (x.kind === 'unique') addUnique(db, t, [col.name], x.name, at)
    else if (x.kind === 'fk') addFk(db, t, [col.name], x.ref, x.name, null, at)
    else if (x.kind === 'check') t.checks.push({ name: x.name || `${t.q.name}_${col.name}_check` })
  }
  delete col.inline
}
// a sequence owned by a table's column (a serial's, or one OWNED BY says)
function own(db, t, key, q, column) {
  const s = db.seqs.get(key) || { q, owner: null }
  if (s.owner && s.owner.table !== t) s.owner.table.seqs.delete(key)
  s.owner = { table: t, column }
  db.seqs.set(key, s)
  t.seqs.add(key)
}

function defaultOf(e) {
  if (e.is('NULL') && !e.isOp('::', 1)) { e.i++; return null }
  if (e.is('NULL') && e.isOp('::', 1)) { e.i += 2; e.until(defaultStop); return null }
  const a = e.i
  e.until(defaultStop)
  if (e.i === a) e.fail('a default was expected')
  return e.text(a, e.i)
}
function nullsDistinct(e) { if (e.eat('NULLS', 'NOT', 'DISTINCT') || e.eat('NULLS', 'DISTINCT')) return true; return false }
function deferrable(e) { if (e.eat('DEFERRABLE') || e.eat('NOT', 'DEFERRABLE')) return true; if (e.eat('INITIALLY')) { e.i++; return true } if (e.eat('NOT', 'VALID')) return true; if (e.eat('NO', 'INHERIT')) return true; return false }

// REFERENCES t [(cols)] [MATCH …] [ON DELETE a] [ON UPDATE a]
function references(db, e) {
  const parts = e.qname()
  const q = qual(db, parts); q.explicit = parts.length > 1
  const toColumns = e.isOp('(') ? nameList(db, e) : []
  if (e.eat('MATCH')) e.i++
  let onDelete = 'no action', onUpdate = 'no action'
  for (let k = 0; k < 4; k++) {
    if (e.eat('ON', 'DELETE')) onDelete = action(db, e)
    else if (e.eat('ON', 'UPDATE')) onUpdate = action(db, e)
    else break
  }
  deferrable(e); deferrable(e)
  return { q, toColumns, onDelete, onUpdate }
}
function action(db, e) {
  const x = e.peek()
  if (x && x.k === 'w' && ACTIONS.has(x.u)) { e.i++; return x.u.toLowerCase() }
  if (e.eat('NO', 'ACTION')) return 'no action'
  if (e.eat('SET', 'NULL') || e.eat('SET', 'DEFAULT')) { const u = e.t[e.i - 1].u; if (e.isOp('(')) e.group(); return `set ${u.toLowerCase()}` }
  e.fail('a referential action was expected')
}
// (a, b DESC, c(10)) → the names; a functional part ((expr)) as its text
function nameList(db, e) {
  const [a, b] = e.group()
  const s = e.sub(a, b)
  return s.items().map(([x, y]) => partOf(db, s, x, y, false))
}
// One part of a key or an index: a column's name, or an expression's text.
function partOf(db, c, a, b, index) {
  if (a >= b) throw new Unread('an empty column', c.t[Math.max(0, a - 1)]?.line)
  // a COLLATE at the top level (its name qualified or not), and the operator class or order after
  // it, are no part of the column
  let end = b
  for (let j = a + 1, depth = 0; j < b; j++) {
    const z = c.t[j]
    if (z.k === 'o' && z.v === '(') depth++
    else if (z.k === 'o' && z.v === ')') depth--
    else if (!depth && z.k === 'w' && z.u === 'COLLATE') { end = j; break }
  }
  // trailing modifiers: ASC, DESC, NULLS FIRST/LAST, an operator class
  for (let k = 0; k < 6 && end > a + 1; k++) {
    const x = c.t[end - 1], y = c.t[end - 2]
    if (x.k === 'w' && (x.u === 'ASC' || x.u === 'DESC')) { end--; continue }
    if (x.k === 'w' && (x.u === 'FIRST' || x.u === 'LAST') && y.k === 'w' && y.u === 'NULLS') { end -= 2; continue }
    break
  }
  const x = c.t[a], y = end > a + 1 ? c.t[a + 1] : null
  const isName = x.k === 'w' || x.k === 'q'
  // a plain column: alone, or with an operator class (a word) after it, or (MySQL) a prefix length
  if (isName && (!y || (end === a + 2 && y.k === 'w') || (db.dialect === MY && y.k === 'o' && y.v === '(' && end === a + 4 && c.t[a + 2].k === 'n'))) return fold(x, db.dialect)
  if (!index && isName) return fold(x, db.dialect)
  // an expression: its text, without one outer pair of parentheses
  let s = a, t = end
  if (c.t[s].k === 'o' && c.t[s].v === '(' && c.t[t - 1].k === 'o' && c.t[t - 1].v === ')') {
    let depth = 0, outer = true
    for (let j = s; j < t; j++) { const z = c.t[j]; if (z.k !== 'o') continue; if (z.v === '(') depth++; else if (z.v === ')' && --depth === 0 && j < t - 1) { outer = false; break } }
    if (outer) { s++; t-- }
  }
  return c.text(s, t)
}
const isExpr = (col) => /[()\s]/.test(col)

// A table-level constraint (or ADD …): true when `e` holds one.
function constraint(db, t, e, name, ctx) {
  const line = e.line(), at = loc(ctx, line)
  if (e.eat('PRIMARY', 'KEY')) {
    if (db.dialect === MY && e.eat('USING')) e.i++
    if (e.eat('USING', 'INDEX')) { usingIndex(db, t, e, name, 'pk', at, ctx); return true }
    setPk(db, t, nameList(db, e), name, at, ctx); return true
  }
  if (e.eat('UNIQUE')) {
    nullsDistinct(e)
    if (e.eat('USING', 'INDEX')) { usingIndex(db, t, e, name, 'unique', at, ctx); return true }
    if (db.dialect === MY) { e.eat('KEY') || e.eat('INDEX'); const ix = !e.isOp('(') && !e.is('USING') ? e.name() : null; if (e.eat('USING')) e.i++; addUnique(db, t, nameList(db, e), ix || name, at); return true }
    addUnique(db, t, nameList(db, e), name, at); return true
  }
  if (e.eat('FOREIGN', 'KEY')) {
    const ix = db.dialect === MY && !e.isOp('(') ? e.name() : null
    const cols = nameList(db, e)
    e.need('REFERENCES')
    addFk(db, t, cols, references(db, e), name, ix, at)
    return true
  }
  if (e.eat('CHECK')) { e.group(); t.checks.push({ name: name || `${t.q.name}_check${t.checks.length ? t.checks.length : ''}` }); while (!e.done) { if (!deferrable(e) && !e.eat('ENFORCED') && !e.eat('NOT', 'ENFORCED')) e.fail('an unexpected word after a check') } return true }
  if (e.is('EXCLUDE') && (e.isOp('(', 1) || e.is('EXCLUDE', 'USING'))) { e.i = e.end; t.checks.push({ name: name || `${t.q.name}_excl` }); return true }
  return false
}

function setPk(db, t, parts, name, at, ctx) {
  if (t.pk) throw new Unread('a second primary key', at.line)
  for (const p of parts) { const col = colOf(db, t, p); if (!col) throw new Unread('a key names a column the table does not have', at.line); col.notNull = true }
  t.pk = { name: name || (db.dialect === MY ? 'PRIMARY' : `${t.q.name}_pkey`), parts: parts.map((p) => colOf(db, t, p).name), at }
}
function addUnique(db, t, parts, name, at) {
  for (const p of parts) if (!isExpr(p) && !colOf(db, t, p)) throw new Unread('a key names a column the table does not have', at.line)
  const cols = parts.map((p) => colOf(db, t, p)?.name ?? p)
  if (db.dialect === MY) { addIndex(db, t, { name: freshIndexName(db, t, name || (isExpr(cols[0]) ? 'functional_index' : cols[0])), unique: true, columns: cols, partial: false, at }); return }
  if (t.uniques.length >= db.limits.indexes) throw new Stop(`a table of more than ${db.limits.indexes} indexes: the replay stops here`)
  t.uniques.push({ name: name || `${t.q.name}_${cols.join('_')}_key`, parts: cols, at })
}
// name: the constraint's, ix: MySQL's FOREIGN KEY index_name (the index it makes when none serves)
function addFk(db, t, cols, ref, name, ix, at) {
  for (const p of cols) if (!colOf(db, t, p)) throw new Unread('a foreign key names a column the table does not have', at.line)
  if (t.fks.size >= db.limits.indexes) throw new Stop(`a table of more than ${db.limits.indexes} foreign keys: the replay stops here`)
  t.n.fk++
  const columns = cols.map((p) => colOf(db, t, p).name)
  addFkTo(db, t, { from: t, name: name || (db.dialect === MY ? `${t.q.name}_ibfk_${t.n.fk}` : `${t.q.name}_${columns.join('_')}_fkey`), ixName: ix || name || null, columns, to: tkey(db, ref.q), toQ: ref.q, toColumns: ref.toColumns, onDelete: ref.onDelete, onUpdate: ref.onUpdate, at })
}
// MySQL: a foreign key no index (nor the primary key) leads with gets one of its own, named by its
// index name, else its constraint's, else its first column (run once a statement has added all it adds)
function fkIndexes(db, t) {
  if (db.dialect !== MY || !t.fks.size) return
  cost(db, t.fks.size * (t.ix.size + 1))
  for (const f of t.fks) {
    if (t.pk && leads(db, t.pk.parts, f.columns)) continue
    let served = null
    for (const i of t.ix.values()) if (!i.fulltext && leads(db, i.columns, f.columns)) { served = i; break }
    // a dump lists the index MySQL made as a KEY of its own: the one named by the key (or its first
    // column) on exactly its columns is that index
    if (served && db.dump && !served.unique && !served.implicit && served.columns.length === f.columns.length && (same(db, served.name, f.ixName || '') || same(db, served.name, f.columns[0]))) { served.implicit = f; t.implicit.add(served) }
    if (!served) {
      const ix = { name: freshIndexName(db, t, f.ixName || f.columns[0]), unique: false, columns: [...f.columns], partial: false, at: f.at, implicit: f }
      addIndex(db, t, ix)
      t.implicit.add(ix)
    }
  }
}
// Postgres: ADD CONSTRAINT x UNIQUE / PRIMARY KEY USING INDEX i (the index becomes the constraint's)
function usingIndex(db, t, e, name, kind, at, ctx) {
  const parts = e.qname()
  const ix = ixOf(db, t, parts[parts.length - 1])
  if (!ix) throw new Unread('USING INDEX names an index the table does not have', at.line)
  removeIndex(db, t, ix)
  if (kind === 'pk') setPk(db, t, ix.columns, name || ix.name, at, ctx)
  else addUnique(db, t, ix.columns, name || ix.name, at)
}

// MySQL: INDEX | KEY | FULLTEXT [INDEX|KEY] | SPATIAL … [name] [USING x] (cols)
function mysqlIndex(db, t, e, ctx, unique) {
  const line = e.line()
  const fulltext = e.eat('FULLTEXT') || e.eat('SPATIAL')
  e.eat('INDEX') || e.eat('KEY')
  const name = !e.isOp('(') && !e.is('USING') ? e.name() : null
  if (e.eat('USING')) e.i++
  const [a, b] = e.group()
  const s = e.sub(a, b)
  const columns = s.items().map(([x, y]) => partOf(db, s, x, y, true))
  // an unnamed index is named by its first column, or `functional_index` when that is an expression
  addIndex(db, t, { name: freshIndexName(db, t, name || (isExpr(columns[0]) ? 'functional_index' : columns[0])), unique, columns, partial: false, at: loc(ctx, line), ...(fulltext ? { fulltext: true } : {}) })
}

// ── CREATE INDEX ──
function createIndex(db, c, ctx, unique, fulltext) {
  c.eat('CONCURRENTLY')
  const ifNot = c.eat('IF', 'NOT', 'EXISTS')
  let iname = null
  if (!c.is('ON') && !c.is('USING')) { const p = c.qname(); iname = p[p.length - 1] }
  if (db.dialect === MY && c.eat('USING')) c.i++
  c.need('ON'); c.eat('ONLY')
  const parts = c.qname()
  const { q, t } = tableOf(db, parts)
  if (!t) return { missing: shown(db, q) }
  if (c.eat('USING')) c.i++
  const [a, b] = c.group()
  const s = c.sub(a, b)
  const columns = s.items().map(([x, y]) => partOf(db, s, x, y, true))
  let partial = false
  for (let depth = 0; !c.done; c.i++) { const x = c.peek(); if (x.k === 'o' && x.v === '(') depth++; else if (x.k === 'o' && x.v === ')') depth--; else if (!depth && x.k === 'w' && x.u === 'WHERE') { partial = true; break } }
  const name = iname || (db.dialect === MY ? freshIndexName(db, t, isExpr(columns[0]) ? 'functional_index' : columns[0]) : pgIndexName(db, t, columns))
  if (ixOf(db, t, name) || (db.dialect === PG && db.indexOwner.has(`${t.q.schema}.${name}`))) { if (ifNot) return 'CREATE INDEX IF NOT EXISTS (it exists)'; c.fail('the index already exists') }
  addIndex(db, t, { name, unique: unique && !fulltext, columns, partial, at: loc(ctx), ...(fulltext ? { fulltext: true } : {}) })
  return { applied: true }
}
// Postgres' name for an unnamed index: <table>_<columns>_idx (an expression by its function's name,
// else `expr`), a number on a clash
function pgIndexName(db, t, columns) {
  const part = (x) => (/^[\w$]+$/.test(x) ? x : /^([A-Za-z_][\w$]*)\s*\(/.exec(x)?.[1].toLowerCase() ?? 'expr')
  const base = `${t.q.name}_${columns.map(part).join('_')}_idx`.slice(0, 63)
  const has = (n) => db.indexOwner.has(`${t.q.schema}.${n}`)
  if (!has(base)) return base
  const k0 = `${t.q.schema}.${base}`
  let k = db.pgNext.get(k0) || 1, name
  while (has((name = `${base.slice(0, 62 - String(k).length)}${k}`))) k++
  db.pgNext.set(k0, k + 1)
  return name
}

// ── ALTER TABLE ──
const NO_MODEL = /^(?:ENABLE|DISABLE|FORCE|NO|OWNER|CLUSTER|SET|RESET|INHERIT|OF|NOT|REPLICA|ATTACH|DETACH|VALIDATE|ENGINE|AUTO_INCREMENT|DEFAULT|CHARSET|CHARACTER|COLLATE|CONVERT|COMMENT|ALGORITHM|LOCK|ORDER|ROW_FORMAT|KEY_BLOCK_SIZE|STATS_PERSISTENT|STATS_AUTO_RECALC|STATS_SAMPLE_PAGES|TABLESPACE|DISCARD|IMPORT|PACK_KEYS|CHECKSUM|DELAY_KEY_WRITE|MAX_ROWS|MIN_ROWS|INSERT_METHOD|AVG_ROW_LENGTH|COMPRESSION|ENCRYPTION|UNION|PARTITION|REMOVE|COALESCE|REORGANIZE|EXCHANGE|ANALYZE|OPTIMIZE|REBUILD|REPAIR|TRUNCATE|UPGRADE|WITH|WITHOUT)$/
const KEYWORDS = new Set(['ENABLE', 'DISABLE', 'FORCE', 'NO', 'ROW', 'LEVEL', 'SECURITY', 'OWNER', 'TO', 'TRIGGER', 'RULE', 'CLUSTER', 'ON', 'SET', 'WITHOUT', 'LOGGED', 'UNLOGGED', 'TABLESPACE', 'INHERIT', 'REPLICA', 'IDENTITY', 'ATTACH', 'DETACH', 'PARTITION', 'VALIDATE', 'CONSTRAINT', 'ALTER', 'ENGINE', 'AUTO_INCREMENT', 'DEFAULT', 'CHARSET', 'CHARACTER', 'CONVERT', 'COMMENT', 'ALGORITHM', 'LOCK', 'RESET', 'KEYS', 'ACCESS', 'METHOD', 'OF', 'NOT', 'ALL', 'ALWAYS', 'COLLATE', 'ORDER', 'BY'])
const actionLabel = (a) => { const w = []; for (let j = a.i; j < a.end && w.length < 4; j++) { const x = a.t[j]; if (x.k !== 'w' || !KEYWORDS.has(x.u)) break; w.push(x.u) } return `ALTER TABLE … ${w.join(' ') || 'options'}` }

function alterTable(db, c, ctx) {
  const ifExists = c.eat('IF', 'EXISTS')
  c.eat('ONLY')
  const parts = c.qname()
  c.eatOp('*')
  const { q, t } = tableOf(db, parts)
  if (!t) return ifExists ? 'ALTER TABLE IF EXISTS (no such table)' : { missing: shown(db, q) }
  let changed = false, label = null
  for (const [a, b] of c.items()) {
    const r = alterAction(db, t, c.sub(a, b), ctx)
    if (r === true) changed = true
    else label ||= r
  }
  if (!changed) return label || 'ALTER TABLE … options'
  fkIndexes(db, t)
  moved(db, t, loc(ctx))
  return { applied: true }
}

// One action: true when it changed the model, else the label it is skipped under.
function alterAction(db, t, a, ctx) {
  if (a.done) a.fail('an empty action')
  const line = a.line(), at = loc(ctx, line)
  if (a.eat('ADD')) {
    if (a.is('PARTITION')) return actionLabel(a.sub(a.i - 1, a.end))
    const col = a.eat('COLUMN')
    const ifNot = a.eat('IF', 'NOT', 'EXISTS')
    if (!col) {
      let name = null
      const save = a.i
      if (a.eat('CONSTRAINT')) { if (!(a.is('PRIMARY') || a.is('UNIQUE') || a.is('FOREIGN') || a.is('CHECK') || a.is('EXCLUDE'))) name = a.name() }
      if (constraint(db, t, a, name, ctx)) return true
      if (name) a.fail('a constraint was expected')
      a.i = save
      if (db.dialect === MY && (a.is('INDEX') || a.is('KEY') || a.is('FULLTEXT') || a.is('SPATIAL'))) { mysqlIndex(db, t, a, ctx, false); return true }
    }
    if (db.dialect === MY && a.isOp('(')) {
      const [x, y] = a.group()
      const s = a.sub(x, y)
      for (const [u, v] of s.items()) addColumn(db, t, s.sub(u, v), ctx, false)
      return true
    }
    return addColumn(db, t, a, ctx, ifNot)
  }
  if (a.eat('DROP')) {
    if (a.eat('CONSTRAINT')) { const ifE = a.eat('IF', 'EXISTS'); return dropConstraint(db, t, a.name(), ifE, at, ctx) }
    if (db.dialect === MY && a.eat('PRIMARY', 'KEY')) { if (!t.pk) a.fail('the table has no primary key'); t.pk = null; return true }
    if (db.dialect === MY && a.eat('FOREIGN', 'KEY')) return dropConstraint(db, t, a.name(), false, at, ctx)
    if (db.dialect === MY && (a.eat('INDEX') || a.eat('KEY'))) { const ix = ixOf(db, t, a.name()); if (!ix) a.fail('no such index'); removeIndex(db, t, ix); return true }
    if (db.dialect === MY && a.eat('CHECK')) return dropConstraint(db, t, a.name(), false, at, ctx)
    if (a.is('DEFAULT') || a.is('PARTITION')) return actionLabel(a.sub(a.i - 1, a.end))
    a.eat('COLUMN')
    const ifE = a.eat('IF', 'EXISTS')
    const name = a.name()
    a.eat('CASCADE') || a.eat('RESTRICT')
    const col = colOf(db, t, name)
    if (!col) { if (ifE) return 'ALTER TABLE … DROP COLUMN IF EXISTS'; a.fail('no such column') }
    dropColumn(db, t, col)
    return true
  }
  if (a.is('ALTER') && !a.is('ALTER', 'CONSTRAINT') && !(db.dialect === MY && a.is('ALTER', 'INDEX'))) {
    a.eat('ALTER'); a.eat('COLUMN')
    const col = colOf(db, t, a.name())
    if (!col) a.fail('no such column')
    return alterColumn(db, t, col, a, at, ctx)
  }
  if (db.dialect === MY && (a.is('MODIFY') || a.is('CHANGE'))) {
    const change = a.eat('CHANGE'); a.eat('MODIFY'); a.eat('COLUMN')
    const old = change ? a.name() : null
    const save = a.i
    const oldCol = colOf(db, t, change ? old : a.name())
    if (!oldCol) a.fail('no such column')
    a.i = save
    const col = column(db, t, a, ctx)
    if (change && !same(db, old, col.name)) { if (colOf(db, t, col.name)) a.fail('the column already exists'); renameColumn(db, t, oldCol, col.name) }
    // MODIFY and CHANGE restate the column whole: what they leave out is gone
    Object.assign(oldCol, { name: col.name, type: col.type, notNull: col.notNull || (t.pk?.parts.some((p) => same(db, p, col.name)) ?? false), def: col.def, generated: col.generated, identity: null, autoIncrement: col.autoIncrement })
    moved(db, oldCol, col.at)
    if (col.first || col.after) { unplaceCol(db, t, oldCol); placeCol(db, t, oldCol, col) }
    oldCol.inline = col.inline
    afterColumn(db, t, oldCol, ctx)
    return true
  }
  if (a.eat('RENAME')) {
    if (a.eat('CONSTRAINT')) {
      const from = a.name(); a.need('TO'); const to = a.name()
      cost(db, t.fks.size + t.uniques.length + t.checks.length)
      const k = [t.pk, ...t.uniques, ...t.fks, ...t.checks].find((x) => x && same(db, x.name, from))
      if (!k) a.fail('no such constraint')
      k.name = to
      return true
    }
    if (a.eat('INDEX') || a.eat('KEY')) { const from = a.name(); a.need('TO'); const to = a.name(); const ix = ixOf(db, t, from); if (!ix) a.fail('no such index'); removeIndex(db, t, ix); ix.name = to; addIndex(db, t, ix); return true }
    // RENAME TO t2 (MySQL: RENAME AS t2, RENAME t2); else a column: RENAME [COLUMN] a TO b
    const column = a.is('COLUMN') || (a.peek(1)?.k === 'w' && a.peek(1).u === 'TO')
    if (a.eat('TO') || a.eat('AS') || !column) {
      const parts = a.qname()
      renameTable(db, t, parts.length > 1 ? qual(db, parts) : { schema: t.q.schema, name: parts[0] })
      return true
    }
    a.eat('COLUMN')
    const from = a.name(); a.need('TO'); const to = a.name()
    const col = colOf(db, t, from)
    if (!col) a.fail('no such column')
    if (colOf(db, t, to) && colOf(db, t, to) !== col) a.fail('the column already exists')
    renameColumn(db, t, col, to)
    moved(db, col, at)
    return true
  }
  if (a.eat('SET', 'SCHEMA')) { renameTable(db, t, { schema: a.name(), name: t.q.name }); return true }
  const w = a.peek()
  if (w && w.k === 'w' && NO_MODEL.test(w.u)) return actionLabel(a)
  a.fail('an unexpected action')
}

function addColumn(db, t, a, ctx, ifNot) {
  const col = column(db, t, a, ctx)
  if (colOf(db, t, col.name)) { if (ifNot) return 'ALTER TABLE … ADD COLUMN IF NOT EXISTS (it exists)'; a.fail('the column already exists') }
  placeCol(db, t, col, col)
  afterColumn(db, t, col, ctx)
  return true
}

function alterColumn(db, t, col, a, at, ctx) {
  if (a.eat('SET', 'DATA', 'TYPE') || a.eat('TYPE')) {
    const s = a.i
    a.until((c) => c.is('USING') || c.is('COLLATE'))
    if (a.i === s) a.fail('a type was expected')
    col.type = typeText(a, s, a.i)
    col.serial = false
    a.i = a.end
    moved(db, col, at)
    return true
  }
  if (a.eat('SET', 'NOT', 'NULL')) { col.notNull = true; moved(db, col, at); return true }
  if (a.eat('DROP', 'NOT', 'NULL')) { if (t.pk?.parts.includes(col.name)) a.fail('a primary key column stays not null'); col.notNull = false; moved(db, col, at); return true }
  if (a.eat('SET', 'DEFAULT')) { col.def = defaultOf(a); moved(db, col, at); return true }
  if (a.eat('DROP', 'DEFAULT')) { col.def = null; moved(db, col, at); return true }
  if (a.eat('ADD', 'GENERATED')) { a.eat('ALWAYS') || a.eat('BY', 'DEFAULT'); a.need('AS', 'IDENTITY'); col.identity = true; col.notNull = true; moved(db, col, at); return true }
  if (a.eat('DROP', 'IDENTITY')) { col.identity = null; moved(db, col, at); return true }
  if (a.eat('DROP', 'EXPRESSION')) { col.generated = null; moved(db, col, at); return true }
  if (a.is('SET') || a.is('RESET') || a.is('RESTART')) return actionLabel(a)
  a.fail('an unexpected column change')
}

function dropColumn(db, t, col) {
  unplaceCol(db, t, col)
  const has = (list) => list.some((p) => same(db, p, col.name))
  cost(db, t.ix.size + t.uniques.length + t.fks.size)
  if (db.dialect === MY) {
    for (const i of [...t.ix.values()]) { i.columns = i.columns.filter((p) => !same(db, p, col.name)); if (!i.columns.length) removeIndex(db, t, i) }
    if (t.pk) { t.pk.parts = t.pk.parts.filter((p) => !same(db, p, col.name)); if (!t.pk.parts.length) t.pk = null }
  } else {
    if (t.pk && has(t.pk.parts)) t.pk = null
    t.uniques = t.uniques.filter((u) => !has(u.parts))
    for (const i of [...t.ix.values()]) if (has(i.columns)) removeIndex(db, t, i)
  }
  for (const f of [...t.fks]) if (has(f.columns)) removeFk(db, f)
  // foreign keys elsewhere that pointed at it go with it (Postgres does so with CASCADE and refuses
  // the statement without it: the engine accepted the migrations, so either way they are gone)
  const refs = db.refsTo.get(t.key)
  if (refs) { cost(db, refs.size); for (const f of [...refs]) if (f.toColumns.length ? has(f.toColumns) : t.pk === null) removeFk(db, f) }
  for (const k of t.seqs) { const s = db.seqs.get(k); if (s && same(db, s.owner.column, col.name)) { db.seqs.delete(k); t.seqs.delete(k) } }
}
function renameColumn(db, t, col, to) {
  const from = col.name
  const r = (p) => (same(db, p, from) ? to : p)
  t.colIx.delete(cmp(db, from))
  col.name = to
  t.colIx.set(cmp(db, to), col)
  cost(db, t.ix.size + t.uniques.length + t.fks.size)
  if (t.pk) t.pk.parts = t.pk.parts.map(r)
  for (const u of t.uniques) u.parts = u.parts.map(r)
  for (const i of t.ix.values()) i.columns = i.columns.map(r)
  for (const f of t.fks) f.columns = f.columns.map(r)
  const refs = db.refsTo.get(t.key)
  if (refs) { cost(db, refs.size); for (const f of refs) f.toColumns = f.toColumns.map(r) }
  for (const k of t.seqs) { const s = db.seqs.get(k); if (s && same(db, s.owner.column, from)) s.owner.column = to }
}
function renameTable(db, t, q) {
  const old = t.key, key = tkey(db, q)
  const other = db.tables.get(key)
  if (other && other !== t) throw new Unread('a table of that name exists', t.at.line)
  const moveIx = db.dialect === PG && q.schema !== t.q.schema
  if (moveIx) for (const i of t.ix.values()) db.indexOwner.delete(`${t.q.schema}.${i.name}`)
  db.tables.delete(old)
  t.q = { schema: q.schema, name: q.name }
  t.key = key
  db.tables.set(key, t)
  if (moveIx) for (const i of t.ix.values()) db.indexOwner.set(`${t.q.schema}.${i.name}`, t)
  // the foreign keys that pointed at its old name follow it
  const refs = db.refsTo.get(old)
  if (refs && old !== key) {
    cost(db, refs.size)
    const into = refsOf(db, key)
    for (const f of refs) { f.to = key; f.toQ = t.q; into.add(f) }
    db.refsTo.delete(old)
  }
}

function dropConstraint(db, t, name, ifExists, at, ctx) {
  if (t.pk && same(db, t.pk.name, name)) { t.pk = null; return true }
  cost(db, t.uniques.length + t.fks.size + t.checks.length)
  const u = t.uniques.findIndex((x) => same(db, x.name, name))
  if (u >= 0) { t.uniques.splice(u, 1); return true }
  for (const f of t.fks) if (same(db, f.name, name)) { removeFk(db, f); return true }
  const k = t.checks.findIndex((x) => x.name && same(db, x.name, name))
  if (k >= 0) { t.checks.splice(k, 1); return true }
  if (db.dialect === MY) { const i = ixOf(db, t, name); if (i?.unique) { removeIndex(db, t, i); return true } }
  if (!ifExists) ctx.note(`${at.path}:${at.line}: ${shown(db, t.q)} has no constraint ${name} to drop (a check, or one an unread statement made): nothing changed`)
  return 'ALTER TABLE … DROP CONSTRAINT (unknown)'
}

// ── DROP ──
function dropTable(db, t) {
  db.tables.delete(t.key)
  for (const f of [...t.fks]) removeFk(db, f)
  const refs = db.refsTo.get(t.key)
  if (refs) { cost(db, refs.size); for (const f of [...refs]) removeFk(db, f); db.refsTo.delete(t.key) }
  if (db.dialect === PG) for (const i of t.ix.values()) db.indexOwner.delete(`${t.q.schema}.${i.name}`)
  for (const k of t.seqs) db.seqs.delete(k)
}
function dropTables(db, c, ctx) {
  const ifE = c.eat('IF', 'EXISTS')
  const names = []
  for (const [a, b] of c.items()) { const s = c.sub(a, b); names.push(s.qname()) }
  let changed = false
  for (const parts of names) {
    const { q, t } = tableOf(db, parts)
    if (!t) { if (ifE) continue; return { missing: shown(db, q) } }
    dropTable(db, t)
    changed = true
  }
  return changed ? { applied: true } : 'DROP TABLE IF EXISTS (no such table)'
}
function dropIndex(db, c, ctx) {
  c.eat('CONCURRENTLY')
  const ifE = c.eat('IF', 'EXISTS')
  if (db.dialect === MY) {
    const name = c.name(); c.need('ON')
    const { q, t } = tableOf(db, c.qname())
    if (!t) return { missing: shown(db, q) }
    const ix = ixOf(db, t, name)
    if (!ix) c.fail('no such index')
    removeIndex(db, t, ix)
    return { applied: true }
  }
  let changed = false
  for (const [a, b] of c.items()) {
    const s = c.sub(a, b)
    const parts = s.qname()
    const q = qual(db, parts)
    const t = db.indexOwner.get(keyOf(q)) || (parts.length === 1 && q.schema !== 'public' ? db.indexOwner.get(`public.${q.name}`) : null)
    const ix = t && ixOf(db, t, q.name)
    if (!ix) { if (ifE) continue; return { missing: q.name } }
    removeIndex(db, t, ix)
    changed = true
  }
  return changed ? { applied: true } : 'DROP INDEX IF EXISTS (no such index)'
}
function dropViews(db, c, ctx) {
  const ifE = c.eat('IF', 'EXISTS')
  let changed = false
  for (const [a, b] of c.items()) {
    const s = c.sub(a, b)
    const q = qual(db, s.qname())
    const v = findIn(db, db.views, q)
    if (!v) { if (ifE) continue; return { missing: shown(db, q) } }
    db.views.delete(v.key)
    changed = true
  }
  return changed ? { applied: true } : 'DROP VIEW IF EXISTS (no such view)'
}
function dropTypes(db, c, ctx) {
  const ifE = c.eat('IF', 'EXISTS')
  let changed = false
  for (const [a, b] of c.items()) {
    const s = c.sub(a, b)
    const en = findIn(db, db.enums, qual(db, s.qname()))
    if (!en) { if (ifE) continue; return 'DROP TYPE' }
    db.enums.delete(en.key)
    changed = true
  }
  return changed ? { applied: true } : 'DROP TYPE IF EXISTS (no such type)'
}
function dropSequences(db, c, ctx) {
  c.eat('IF', 'EXISTS')
  for (const [a, b] of c.items()) {
    const s = c.sub(a, b)
    const k = keyOf(qual(db, s.qname()))
    db.seqs.get(k)?.owner?.table.seqs.delete(k)
    db.seqs.delete(k)
  }
  return { applied: true }
}
function dropSchema(db, c, ctx) {
  c.eat('IF', 'EXISTS')
  const gone = new Set()
  for (const [a, b] of c.items()) { const s = c.sub(a, b); gone.add(s.name()) }
  cost(db, db.tables.size + db.views.size + db.enums.size + db.seqs.size)
  for (const t of [...db.tables.values()]) if (gone.has(t.q.schema)) dropTable(db, t)
  for (const m of [db.views, db.enums, db.seqs]) for (const [k, v] of [...m]) if (gone.has(v.q?.schema)) m.delete(k)
  return { applied: true }
}

// MySQL: RENAME TABLE a TO b [, c TO d]
function renameTables(db, c, ctx) {
  c.need('TABLE')
  for (const [a, b] of c.items()) {
    const s = c.sub(a, b)
    const from = s.qname(); s.need('TO'); const to = qual(db, s.qname())
    const { q, t } = tableOf(db, from)
    if (t) renameTable(db, t, to)
    else { const v = findIn(db, db.views, q); if (!v) return { missing: shown(db, q) }; db.views.delete(v.key); v.q = to; v.key = tkey(db, to); db.views.set(v.key, v) }
  }
  return { applied: true }
}

// ── types ──
function createType(db, c, ctx) {
  const q = qual(db, c.qname())
  if (!c.eat('AS', 'ENUM')) return 'CREATE TYPE'
  const [a, b] = c.group()
  const values = []
  for (let j = a; j < b; j++) { const x = c.t[j]; if (x.k === 's') values.push(unstring(x)); else if (!(x.k === 'o' && x.v === ',')) throw new Unread('an enum value was expected', x.line) }
  if (findIn(db, db.enums, q)) c.fail('the type already exists')
  db.enums.set(tkey(db, q), { key: tkey(db, q), q, values, at: loc(ctx) })
  return { applied: true }
}
function alterType(db, c, ctx) {
  const q = qual(db, c.qname())
  const en = findIn(db, db.enums, q)
  if (c.eat('ADD', 'VALUE')) {
    if (!en) return { missing: shown(db, q) }
    const ifNot = c.eat('IF', 'NOT', 'EXISTS')
    const v = c.peek(); if (!v || v.k !== 's') c.fail('a value was expected'); c.i++
    const value = unstring(v)
    cost(db, en.values.length)
    if (en.values.includes(value)) { if (ifNot) return 'ALTER TYPE … ADD VALUE IF NOT EXISTS (it exists)'; c.fail('the value exists') }
    let at = en.values.length
    if (c.eat('BEFORE') || c.eat('AFTER')) {
      const after = c.t[c.i - 1].u === 'AFTER'
      const r = c.peek(); if (!r || r.k !== 's') c.fail('a value was expected'); c.i++
      const i = en.values.indexOf(unstring(r)); if (i < 0) c.fail('no such value')
      at = after ? i + 1 : i
    }
    en.values.splice(at, 0, value)
    moved(db, en, loc(ctx))
    return { applied: true }
  }
  if (c.eat('RENAME', 'VALUE')) {
    if (!en) return { missing: shown(db, q) }
    const a = c.peek(); c.i++; c.need('TO'); const b = c.peek(); c.i++
    if (a?.k !== 's' || b?.k !== 's') c.fail('a value was expected')
    cost(db, en.values.length)
    const i = en.values.indexOf(unstring(a)); if (i < 0) c.fail('no such value')
    en.values[i] = unstring(b); moved(db, en, loc(ctx))
    return { applied: true }
  }
  if (c.eat('RENAME', 'TO')) {
    if (!en) return 'ALTER TYPE … RENAME TO'
    const to = { schema: en.q.schema, name: c.name() }
    db.enums.delete(en.key)
    // the columns of that type follow it
    for (const t of db.tables.values()) {
      cost(db, t.cols.length)
      for (const col of t.cols) { const m = /^(.*?)((?:\[\])*)$/.exec(col.type); if (same(db, m[1], en.q.name) || m[1] === shown(db, en.q)) col.type = `${to.name}${m[2]}` }
    }
    en.q = to; en.key = tkey(db, to); moved(db, en, loc(ctx))
    db.enums.set(en.key, en)
    return { applied: true }
  }
  return 'ALTER TYPE'
}

// ── views, indexes, sequences ──
function createView(db, c, ctx) {
  c.eat('IF', 'NOT', 'EXISTS')
  const q = qual(db, c.qname())
  const v = { key: tkey(db, q), q, at: loc(ctx) }
  if (findIn(db, db.tables, q)) c.fail('a table of that name exists')
  db.views.set(v.key, v)
  return { applied: true }
}
function alterView(db, c, ctx) {
  c.eat('IF', 'EXISTS')
  const q = qual(db, c.qname())
  if (!c.eat('RENAME', 'TO')) return 'ALTER VIEW'
  const v = findIn(db, db.views, q)
  if (!v) return { missing: shown(db, q) }
  db.views.delete(v.key); v.q = { schema: v.q.schema, name: c.name() }; v.key = tkey(db, v.q); v.at = loc(ctx); db.views.set(v.key, v)
  return { applied: true }
}
function alterIndex(db, c, ctx) {
  c.eat('IF', 'EXISTS')
  const parts = c.qname()
  if (!c.eat('RENAME', 'TO')) return 'ALTER INDEX'
  const q = qual(db, parts), to = c.name()
  const t = db.indexOwner.get(keyOf(q)) || (parts.length === 1 && q.schema !== 'public' ? db.indexOwner.get(`public.${q.name}`) : null)
  if (!t) return { missing: q.name }
  const ix = ixOf(db, t, q.name)
  if (!ix) return 'ALTER INDEX … RENAME (a constraint\'s index)'
  removeIndex(db, t, ix); ix.name = to; addIndex(db, t, ix)
  return { applied: true }
}
function createSequence(db, c, ctx) {
  c.eat('IF', 'NOT', 'EXISTS')
  const q = qual(db, c.qname())
  const k = keyOf(q)
  if (!db.seqs.has(k)) db.seqs.set(k, { q, owner: null })
  ownedBy(db, c, k)
  return { applied: true }
}
function alterSequence(db, c, ctx) {
  c.eat('IF', 'EXISTS')
  const k = keyOf(qual(db, c.qname()))
  if (!db.seqs.has(k)) return 'ALTER SEQUENCE'
  return ownedBy(db, c, k) ? { applied: true } : 'ALTER SEQUENCE'
}
function ownedBy(db, c, k) {
  for (; !c.done; c.i++) {
    if (!c.is('OWNED', 'BY')) continue
    c.i += 2
    const s = db.seqs.get(k)
    if (c.eat('NONE')) { s.owner?.table.seqs.delete(k); s.owner = null; return true }
    const parts = c.qname()
    if (parts.length < 2) c.fail('a column was expected')
    const { t } = tableOf(db, parts.slice(0, -1))
    if (t) own(db, t, k, s.q, parts[parts.length - 1])
    else { s.owner?.table.seqs.delete(k); s.owner = null }
    return true
  }
  return false
}

// The parts of a CREATE INDEX statement's column list, as readDdl keeps them: a column's name, an
// expression's text (the SQLite replay's, whose PRAGMA leaves an expression unnamed). Null when the
// statement is not read.
export function indexParts(text, dialect) {
  try {
    const lx = lexSql(text, { dialect, max: LIMITS.tokens })
    if (lx.over) return null
    const c = new Cur(lx.tokens, text, dialect)
    while (!c.done && !c.isOp('(')) c.i++
    const [a, b] = c.group()
    const s = c.sub(a, b)
    return s.items().map(([x, y]) => partOf({ dialect }, s, x, y, true))
  } catch { return null }
}

// ── the model ──
const NEXTVAL = /^nextval\('((?:[^']|'')+)'(?:::regclass)?\)$/i
const lowType = (t) => String(t).trim().toLowerCase().replace(/\s+/g, ' ')
function modelOf(db) {
  const entities = []
  for (const t of db.tables.values()) {
    const at = (x) => ({ path: x.at.path, line: x.at.line })
    const fields = t.cols.map((col) => {
      let type = col.type, def = col.def
      // a serial: an integer column whose default is the nextval of the sequence it owns (as a dump
      // writes one); one written as a serial whose default was set or dropped since is the integer
      // it stands for
      const written = db.dialect === PG ? SERIALS[lowType(type)] : null
      const m = db.dialect === PG && def ? NEXTVAL.exec(def) : null
      let owned = false
      if (m) {
        const lx = lexSql(m[1].replace(/''/g, "'"), { dialect: PG, max: 8 }).tokens
        const parts = lx.filter((x) => x.k === 'w' || x.k === 'q').map((x) => fold(x, PG))
        const s = parts.length ? db.seqs.get(keyOf(qual(db, parts))) || (parts.length === 1 ? db.seqs.get(`public.${parts[0]}`) : null) : null
        owned = !!s && s.owner?.table === t && same(db, s.owner.column, col.name)
      }
      if (owned && INT_SERIAL[lowType(type)]) { if (!written) type = INT_SERIAL[lowType(type)]; def = null }
      else if (written) type = written
      return { name: col.name, type, nullable: !col.notNull, default: col.identity || col.generated ? null : def, generated: col.generated ?? null, ...at(col) }
    })
    const keys = []
    if (t.pk) keys.push({ role: 'primary', parts: t.pk.parts, ...at(t.pk) })
    for (const u of t.uniques) keys.push({ role: 'unique', parts: u.parts, ...at(u) })
    const indexes = [...t.ix.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((i) => ({ name: i.name, unique: i.unique, columns: i.columns, partial: i.partial, ...(i.implicit ? { implicit: true } : {}), ...at(i) }))
    const relations = [...t.fks].map((f) => {
      const target = db.tables.get(f.to)
      return { columns: f.columns, to: target ? shown(db, target.q) : shown(db, f.toQ), toColumns: f.toColumns.length ? f.toColumns : target?.pk?.parts ?? [], onDelete: f.onDelete, onUpdate: f.onUpdate, ...at(f) }
    })
    entities.push({ name: shown(db, t.q), kind: 'table', ...at(t), fields, keys, indexes, relations, ...(t.part ? { part: true } : {}) })
  }
  for (const v of db.views.values()) entities.push({ name: shown(db, v.q), kind: 'view', path: v.at.path, line: v.at.line, fields: [], keys: [], indexes: [], relations: [] })
  entities.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const enums = [...db.enums.values()].map((e) => ({ name: shown(db, e.q), values: [...e.values], path: e.at.path, line: e.at.line })).sort((a, b) => (a.name < b.name ? -1 : 1))
  return { entities, enums }
}
