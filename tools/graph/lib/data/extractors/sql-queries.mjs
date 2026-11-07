// grimoire graph · data · extractor: the SQL a project's code sends, read where it calls its database
// client (spec D2's `inferred` kind, the least trusted: it never overrides a declaration; the store it
// deduces is named so). Per file (.ts, .mts, .cts, .tsx; .js, .mjs, .cjs, .jsx; .py; .go; .rs; never a
// .d.ts), read only when its content shows a query call next to SQL text, or a SQL client import,
// through the pinned tree-sitter grammars. It never runs the code and never evaluates what code fills
// in: the statements are read by readers/sql-query.mjs, and only their identifiers kept.
//
// The call sites, per language (the SQL is the first argument that holds SQL text, unless said):
//   TS and JS   a call named query, execute, exec, prepare, raw, unsafe, $queryRaw, $executeRaw (and
//               their Unsafe forms): `db.query(…)`, `knex.raw(…)`, `db.prepare(…)`; a tagged template
//               of one of those names or `sql` / `SQL` (`sql\`…\``, `prisma.$queryRaw\`…\``); a
//               config object's `text` or `sql` (`pool.query({ text: … })`);
//   Go          a method named Query, QueryRow, Exec, Prepare, their Context forms, sqlx's Get, Select,
//               Queryx, QueryRowx, MustExec, NamedExec, NamedQuery (and Context forms): `db.Query(…)`;
//   Python      a method named execute, executemany, executescript, mogrify, asyncpg's fetch,
//               fetchrow, fetchval, pandas' read_sql; SQLAlchemy's text(…): `cursor.execute(…)`;
//   Rust        sqlx's macros query!, query_as! (after its type), query_scalar! (and _unchecked); the
//               functions query, query_as, query_scalar, sql_query (`sqlx::query(…)`); the methods
//               execute, query, query_row, query_map, query_one, query_opt, prepare, prepare_cached,
//               execute_batch, simple_query, batch_execute (rusqlite, postgres).
// SQL text: a string or template literal; a constant of the same file holding one (only what nothing can
// change: a TypeScript `const`, a Go `const`, a Rust `const` or immutable `static`, a Python module-level
// ALL_CAPS name assigned once; never one a parameter or a local of a function around the call shadows); a concatenation;
// a format (Go's fmt.Sprintf, Python's % and .format, an f-string, Rust's format!). Whatever code fills
// in (a template's ${…}, an f-string's {…}, a format verb, a concatenated variable) is a parameter
// (readers/sql-query.mjs PARAM): a table named by one is never a table, and SQL built from variables is
// read only from its literal parts. A text is read only when its first word is a statement's
// (SELECT, INSERT, UPDATE, DELETE, WITH, …): a query builder's fragment (`sql\`${col} = 1\``) is none.
// Test code (the code graph's test paths, each language's own marks) is not read for the model: its
// sites are counted. Bounded: MAX_SITES calls, MAX_STATEMENTS statements and MAX_FACTS names a file; a
// text many calls send (a constant) is read once; one walk down the tree (a call's function, class and
// test status come down with it, never by walking up: a node's parent costs the tree's depth), within
// FILE_MS; the content filter linear in the text.
//
// The clients a file imports (CLIENTS: the architecture's known SQL clients, by module, with the
// dialect each speaks, null for a generic one) are kept with their line, so the store is named by its
// client, and a file importing a driver with no query of its own still says which database the
// repository reaches (a Go main importing lib/pq; a TypeScript module creating the pool).
//
// Facts: { declarations: [], queries: { lang, path, clients: [{ source, dialect, line }], hints:
//   [{ dialect, why, line }] (a Rust type naming the database: PgPool), markers (what the SQL says of
//   its dialect: readers/sql-query.mjs), sites: [Site], fns: [{ name, line, end }], notes, tests } }
//   Site { line, fn: index into fns (-1 at top level), call, statements: [Stmt] (readers/sql-query.mjs) }
// A base's file is not read (graph_changes compares declarations: data/base.mjs).
import { readQueries, isSql, PARAM } from '../readers/sql-query.mjs'
import { named, field, lineOf, endOf, each } from '../readers/code.mjs'
import { SRC, treeLang } from './dynamo-access.mjs'
import { KNOWN, importMatches } from '../../arch.mjs'
import { LANGS, TEST_PATH } from '../../langs.mjs'

const DTS = /\.d\.[cm]?ts$/i
// calls, statements and names (tables, columns, joins, lookups, casts) a file keeps: its facts stay small in graph.db
export const MAX_SITES = 400, MAX_STATEMENTS = 2000, MAX_FACTS = 20000
const familyOf = (lang) => (lang === 'tsx' || lang === 'typescript' || lang === 'javascript' ? 'ts' : lang)

// ── the clients: a module, the dialect it speaks (null: any) ──
const KNOWN_DIALECT = { postgres: 'postgres', mysql: 'mysql', sqlite: 'sqlite', 'sql-db': null }
export const CLIENTS = [
  ...KNOWN.filter((k) => k.id in KNOWN_DIALECT).flatMap((k) => k.imports.map((source) => ({ source, dialect: KNOWN_DIALECT[k.id] }))),
  ...['database/sql', 'github.com/jmoiron/sqlx'].map((source) => ({ source, dialect: null })),
  ...['tokio_postgres', 'slonik', 'sqlx::postgres', 'drizzle-orm/node-postgres', 'drizzle-orm/postgres-js', 'drizzle-orm/neon-http', 'drizzle-orm/neon-serverless', 'drizzle-orm/vercel-postgres', 'drizzle-orm/pg-core'].map((source) => ({ source, dialect: 'postgres' })),
  ...['@planetscale/database', 'aiomysql', 'mysql.connector', 'sqlx::mysql', 'drizzle-orm/mysql2', 'drizzle-orm/mysql-core', 'drizzle-orm/planetscale-serverless'].map((source) => ({ source, dialect: 'mysql' })),
  ...['modernc.org/sqlite', '@libsql/client', 'aiosqlite', 'bun:sqlite', 'expo-sqlite', 'sqlx::sqlite', 'drizzle-orm/better-sqlite3', 'drizzle-orm/libsql', 'drizzle-orm/sqlite-core', 'drizzle-orm/bun-sqlite', 'drizzle-orm/d1', 'drizzle-orm/expo-sqlite'].map((source) => ({ source, dialect: 'sqlite' })),
]
// the client an import names: the most specific pattern matching it (drizzle-orm/node-postgres over drizzle-orm)
export function clientOf(source) {
  let best = null
  for (const c of CLIENTS) if (importMatches(source, c.source) && (!best || c.source.length > best.source.length)) best = c
  return best
}
// a Rust type naming the database a sqlx pool or row reaches
const RS_HINTS = [['postgres', /\b(?:PgPool|PgPoolOptions|PgConnection|PgRow|PgConnectOptions)\b|\bsqlx::Postgres\b/], ['mysql', /\b(?:MySqlPool|MySqlPoolOptions|MySqlConnection|MySqlRow)\b|\bsqlx::MySql\b/], ['sqlite', /\b(?:SqlitePool|SqlitePoolOptions|SqliteConnection|SqliteRow)\b|\bsqlx::Sqlite\b/]]

// ── what a file holds that this reads (registry.mjs inspect: bit 64) ──
// Run on every source file at index time, so linear whatever the text: no two repetitions that can
// match the same blanks (`\s*!?\s*` backtracks quadratically over a run of blanks): an optional part
// that repeats ends with a mark of its own (`(?:\s*!)?\s*`, `(?:\s*\()?\s*`).
const CALL = /(?:\b(?:query|queryRow|execute|exec|prepare|raw|unsafe|sql|SQL|Query|QueryRow|QueryContext|QueryRowContext|Exec|ExecContext|Prepare|PrepareContext|Get|GetContext|Select|SelectContext|Queryx|QueryRowx|MustExec|NamedExec|NamedQuery|executemany|executescript|mogrify|fetch|fetchrow|fetchval|read_sql|text|query_as|query_scalar|query_row|query_map|query_one|query_opt|prepare_cached|execute_batch|simple_query|batch_execute|sql_query)(?:\s*!)?\s*(?:<[^>\n]{0,80}>\s*)?[(`])|\$(?:query|execute)Raw/
const SQL_TEXT = /(?:["'`]|r#{0,8}")(?:\s*\()?\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b/i
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const CLIENT_TEXT = {
  ts: new RegExp(`(?:\\bfrom|\\brequire\\s*\\(|\\bimport(?:\\s*\\()?)\\s*["'\`](?:${CLIENTS.map((c) => esc(c.source)).join('|')})(?:/[^"'\`\\n]*)?["'\`]`),
  go: new RegExp(`"(?:${CLIENTS.filter((c) => c.source.includes('/') || c.source === 'database/sql').map((c) => esc(c.source)).join('|')})(?:/[^"\\n]*)?"`),
  python: new RegExp(`^[ \\t]*(?:from|import)[ \\t]+(?:${CLIENTS.map((c) => esc(c.source)).join('|')})\\b`, 'm'),
  rust: new RegExp(`\\buse[ \\t]+(?:${CLIENTS.filter((c) => !c.source.includes('/')).map((c) => esc(c.source.split('::')[0])).join('|')})::|\\bextern[ \\t]+crate[ \\t]+(?:sqlx|rusqlite|postgres|tokio_postgres|mysql|diesel)\\b`),
}
export const queryLevel = (p, text) => {
  const l = treeLang(p)
  if (!l) return 0
  return (CALL.test(text) && SQL_TEXT.test(text)) || CLIENT_TEXT[familyOf(l)].test(text) ? 64 : 0
}

// ── SQL text, as written: segments { text, row } assembled so each statement keeps its file line ──
// An escape as the SQL sees it, never adding a line (a line break escaped is a blank)
const ESCAPED = { n: ' ', t: ' ', r: ' ', 0: ' ', b: ' ', f: ' ', v: ' ' }
const unescape = (s) => s.replace(/\\(?:u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|([\s\S]))/g, (m, c) => (c === undefined ? ' ' : c === '\n' ? '\n' : ESCAPED[c] ?? c))
const rowOf = (n) => n.startPosition.row
function assemble(segs) {
  if (!segs || !segs.length || segs.every((s) => s.text === PARAM)) return null
  const first = segs[0].row
  let text = '', row = first
  for (const s of segs) {
    if (s.row > row) { text += '\n'.repeat(s.row - row); row = s.row }
    text += s.text
    for (let i = s.text.indexOf('\n'); i >= 0; i = s.text.indexOf('\n', i + 1)) row++
  }
  return { text, line: first + 1 }
}
const hole = (n) => [{ text: PARAM, row: rowOf(n) }]

// TS and JS
function tsSegs(n, consts, depth = 0) {
  if (!n || depth > 32) return null
  switch (n.type) {
    case 'string': return named(n).length ? named(n).map((c) => ({ text: c.type === 'escape_sequence' ? unescape(c.text) : c.text, row: rowOf(c) })) : [{ text: '', row: rowOf(n) }]
    case 'template_string': return named(n).map((c) => (c.type === 'template_substitution' ? { text: PARAM + '\n'.repeat((c.text.match(/\n/g) || []).length), row: rowOf(c) } : { text: c.type === 'escape_sequence' ? unescape(c.text) : c.text, row: rowOf(c) }))
    case 'parenthesized_expression': case 'as_expression': case 'satisfies_expression': case 'non_null_expression': return tsSegs(named(n)[0], consts, depth + 1)
    case 'binary_expression': {
      if (field(n, 'operator')?.type !== '+') return null
      const a = tsSegs(field(n, 'left'), consts, depth + 1), b = tsSegs(field(n, 'right'), consts, depth + 1)
      return a || b ? [...(a || hole(field(n, 'left'))), ...(b || hole(field(n, 'right')))] : null
    }
    case 'identifier': { const c = consts.get(n.text); return c ? tsSegs(c, consts, depth + 1) : null }
    default: return null
  }
}
// Go
function goSegs(n, consts, depth = 0) {
  if (!n || depth > 32) return null
  switch (n.type) {
    case 'interpreted_string_literal': return [{ text: unescape(n.text.slice(1, -1)), row: rowOf(n) }]
    case 'raw_string_literal': return [{ text: n.text.slice(1, -1), row: rowOf(n) }]
    case 'parenthesized_expression': return goSegs(named(n)[0], consts, depth + 1)
    case 'binary_expression': {
      if (field(n, 'operator')?.type !== '+') return null
      const a = goSegs(field(n, 'left'), consts, depth + 1), b = goSegs(field(n, 'right'), consts, depth + 1)
      return a || b ? [...(a || hole(field(n, 'left'))), ...(b || hole(field(n, 'right')))] : null
    }
    case 'identifier': { const c = consts.get(n.text); return c ? goSegs(c, consts, depth + 1) : null }
    case 'call_expression': {
      // fmt.Sprintf("… %s …", x): each verb a parameter (%% a percent sign)
      if (!/^fmt\.Sprintf$/.test(field(n, 'function')?.text || '')) return null
      const f = goSegs(named(field(n, 'arguments') || n)[0], consts, depth + 1)
      return f ? f.map((s) => ({ ...s, text: s.text.replace(/%%|%[-+# 0]{0,8}\d{0,8}(?:\.\d{0,8})?[a-zA-Z]/g, (m) => (m === '%%' ? '%' : PARAM)) })) : null
    }
    default: return null
  }
}
// Python
function pySegs(n, consts, depth = 0) {
  if (!n || depth > 32) return null
  switch (n.type) {
    case 'string': {
      const start = named(n).find((c) => c.type === 'string_start')?.text || ''
      const prefix = start.replace(/['"]/g, '').toLowerCase()
      if (prefix.includes('b')) return null
      const raw = prefix.includes('r')
      const out = []
      for (const c of named(n)) {
        if (c.type === 'string_content') out.push({ text: raw ? c.text : unescape(c.text), row: rowOf(c) })
        else if (c.type === 'escape_sequence') out.push({ text: unescape(c.text), row: rowOf(c) })
        else if (c.type === 'interpolation') out.push({ text: PARAM + '\n'.repeat((c.text.match(/\n/g) || []).length), row: rowOf(c) })
      }
      return out.length ? out : [{ text: '', row: rowOf(n) }]
    }
    case 'concatenated_string': { const out = []; for (const s of named(n)) { const p = pySegs(s, consts, depth + 1); if (!p) return null; out.push(...p) } return out }
    case 'parenthesized_expression': return pySegs(named(n)[0], consts, depth + 1)
    case 'binary_operator': {
      const op = field(n, 'operator')?.type
      if (op === '%') return pySegs(field(n, 'left'), consts, depth + 1) // its %s verbs: parameters to the reader
      if (op !== '+') return null
      const a = pySegs(field(n, 'left'), consts, depth + 1), b = pySegs(field(n, 'right'), consts, depth + 1)
      return a || b ? [...(a || hole(field(n, 'left'))), ...(b || hole(field(n, 'right')))] : null
    }
    case 'call': {
      // "…{}…".format(x): each field a parameter; text("…") (SQLAlchemy): its argument
      const fn = field(n, 'function')
      if (fn?.type === 'attribute' && field(fn, 'attribute')?.text === 'format') { const s = pySegs(field(fn, 'object'), consts, depth + 1); return s ? s.map((x) => ({ ...x, text: x.text.replace(/\{\{|\}\}|\{[^{}]*\}/g, (m) => (m === '{{' ? '{' : m === '}}' ? '}' : PARAM)) })) : null }
      if (fn && /^(?:text|sql\.SQL|SQL)$/.test(fn.text)) return pySegs(positional(n)[0], consts, depth + 1)
      return null
    }
    case 'identifier': { const c = consts.get(n.text); return c ? pySegs(c, consts, depth + 1) : null }
    default: return null
  }
}
const positional = (call) => named(field(call, 'arguments') || call).filter((a) => a.type !== 'keyword_argument' && a.type !== 'comment')
// Rust
function rsSegs(n, consts, depth = 0) {
  if (!n || depth > 32) return null
  switch (n.type) {
    case 'string_literal': return /^b/.test(n.text) ? null : [{ text: unescape(n.text.slice(1, -1)), row: rowOf(n) }]
    case 'raw_string_literal': { if (/^br/.test(n.text)) return null; const m = /^r(#*)"([\s\S]*)"\1$/.exec(n.text); return m ? [{ text: m[2], row: rowOf(n) }] : null }
    case 'reference_expression': return rsSegs(field(n, 'value'), consts, depth + 1)
    case 'parenthesized_expression': return rsSegs(named(n)[0], consts, depth + 1)
    case 'identifier': { const c = consts.get(n.text); return c ? rsSegs(c, consts, depth + 1) : null }
    case 'macro_invocation': {
      // format!("… {} …", x): each field a parameter; concat!("a", "b"); indoc!("…")
      const name = (field(n, 'macro')?.text || '').split('::').pop()
      const tt = named(n).find((c) => c.type === 'token_tree')
      const lits = tt ? named(tt).filter((c) => c.type === 'string_literal' || c.type === 'raw_string_literal') : []
      if (/^(?:format|formatdoc)$/.test(name) && lits[0]) { const s = rsSegs(lits[0], consts, depth + 1); return s ? s.map((x) => ({ ...x, text: x.text.replace(/\{\{|\}\}|\{[^{}]*\}/g, (m) => (m === '{{' ? '{' : m === '}}' ? '}' : PARAM)) })) : null }
      if (/^(?:concat|indoc)$/.test(name) && lits.length) return lits.flatMap((l) => rsSegs(l, consts, depth + 1) || [])
      return null
    }
    default: return null
  }
}

// ── the call sites ──
const TS_CALLS = new Set(['query', 'execute', 'exec', 'prepare', 'raw', 'unsafe', '$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'])
const TS_TAGS = new Set([...TS_CALLS, 'sql', 'SQL'])
const GO_CALLS = new Set(['Query', 'QueryRow', 'QueryContext', 'QueryRowContext', 'Exec', 'ExecContext', 'Prepare', 'PrepareContext', 'Get', 'GetContext', 'Select', 'SelectContext', 'Queryx', 'QueryRowx', 'QueryxContext', 'QueryRowxContext', 'MustExec', 'MustExecContext', 'NamedExec', 'NamedExecContext', 'NamedQuery', 'NamedQueryContext', 'Preparex', 'PreparexContext'])
const PY_CALLS = new Set(['execute', 'executemany', 'executescript', 'mogrify', 'fetch', 'fetchrow', 'fetchval', 'read_sql', 'read_sql_query'])
const RS_MACROS = new Set(['query', 'query_as', 'query_scalar', 'query_unchecked', 'query_as_unchecked', 'query_scalar_unchecked'])
const RS_FNS = new Set(['query', 'query_as', 'query_scalar', 'sql_query', 'query_with', 'query_as_with'])
const RS_METHODS = new Set(['execute', 'query', 'query_row', 'query_map', 'query_one', 'query_opt', 'prepare', 'prepare_cached', 'execute_batch', 'simple_query', 'batch_execute'])


// ── one walk down the tree ──
// Each node is visited once, with what holds it: its function (named as each language names it), its
// class or impl, whether it is test code, and the scopes of the functions around it (the names their
// parameters and locals bind). Nothing ever walks up from a node (a parent costs the tree's depth
// each time): a call's function, class and test status come down with the walk.
export const FILE_MS = 10_000 // a file's read stops past this (said), as a replay does
const FN = { ts: /^(?:function_declaration|generator_function_declaration|method_definition|arrow_function|function_expression|function|generator_function)$/, go: /^(?:function_declaration|method_declaration|func_literal)$/, python: /^(?:function_definition|lambda)$/, rust: /^(?:function_item|closure_expression)$/ }
const CLASS = { ts: /^(?:class_declaration|abstract_class_declaration|class)$/, python: /^class_definition$/ }
const TEST_ATTR = /\b(?:test|cfg\s*\(\s*test\s*\))/
const TEST_FILE = { ts: /\.(?:test|spec)\.[cm]?[jt]sx?$/i, go: /_test\.go$/i, python: /(?:^|\/)(?:test_[^/]*|[^/]*_test|conftest)\.py$/i, rust: /(?:^|\/)tests\// }
const isTestName = (fam, name) => (fam === 'go' ? /^(?:Test|Benchmark|Example|Fuzz)/.test(name.split('.').pop()) : fam === 'python' ? /^test/.test(name.split('.').pop()) || /(?:^|\.)Test/.test(name) : false)

// The function a function-like node is, as its language names it (`parent`: what holds it, known
// from the walk) → its name, or null for a callback, which belongs to the function around it
function fnName(n, parent, fam, ctx) {
  if (fam === 'ts') {
    if (n.type === 'function_declaration' || n.type === 'generator_function_declaration') return field(n, 'name')?.text || '(function)'
    if (n.type === 'method_definition') return `${ctx.cls || '(class)'}.${field(n, 'name')?.text || '(method)'}`
    if (parent?.type === 'variable_declarator') return field(parent, 'name')?.text || null
    if (parent?.type === 'pair') return field(parent, 'key')?.text || null
    if (parent && (parent.type === 'public_field_definition' || parent.type === 'field_definition')) return `${ctx.cls || '(class)'}.${(field(parent, 'name') || field(parent, 'property'))?.text}`
    if (parent?.type === 'export_statement') return '(default)'
    return null
  }
  if (fam === 'go') {
    if (n.type === 'func_literal') return null
    let name = field(n, 'name')?.text || '(func)'
    if (n.type === 'method_declaration') { let recv = null; each(field(n, 'receiver') || n, (x) => { if (!recv && x.type === 'type_identifier') recv = x.text; return !recv }); if (recv) name = `${recv}.${name}` }
    return name
  }
  if (fam === 'python') return n.type === 'lambda' ? null : `${ctx.pyCls ? `${ctx.pyCls}.` : ''}${field(n, 'name')?.text || '(function)'}`
  return n.type === 'closure_expression' ? null : `${ctx.impl ? `${ctx.impl}::` : ''}${field(n, 'name')?.text || '(fn)'}`
}

// The names a declaration binds in the function around it (a parameter, a local): each identifier
// of its pattern, never one of a type, a default value, an attribute or a member. Bounded.
const BINDS = {
  ts: { variable_declarator: 'name', required_parameter: 'pattern', optional_parameter: 'pattern', formal_parameters: null, catch_clause: 'parameter' },
  go: { parameter_declaration: null, variadic_parameter_declaration: null, short_var_declaration: 'left', var_spec: null, const_spec: null, range_clause: 'left' },
  python: { parameters: null, lambda_parameters: null, assignment: 'left', augmented_assignment: 'left', for_statement: 'left', as_pattern_target: null },
  rust: { parameter: 'pattern', let_declaration: 'pattern', closure_parameters: null },
}
const NOT_A_BINDING = /^(?:type_annotation|type|.*_type|type_identifier|attribute|member_expression|subscript|subscript_expression|field_expression|call|call_expression|string|template_string|number|integer|float|true|false|none|null)$/
function bound(n, fam, out) {
  const f = BINDS[fam][n.type]
  if (f === undefined) return
  // the part that binds: a field, or (null) the node itself, its value fields left out
  const root = f ? field(n, f) : n
  if (!root) return
  const stack = [root]
  for (let k = 0; stack.length && k < 256; k++) {
    const x = stack.pop()
    if (x.type === 'identifier' || x.type === 'shorthand_property_identifier_pattern') { out.add(x.text); continue }
    if (NOT_A_BINDING.test(x.type)) continue
    for (const c of x.namedChildren) {
      // never a default value (`= 1`, `a: number = 2`), never a short var's or a spec's value
      if (c === field(x, 'value') || c === field(x, 'right') || c === field(x, 'default') || c === field(x, 'type')) continue
      stack.push(c)
    }
  }
}

// A file's string constants a call may name, kept only where nothing can change them: TypeScript's
// `const`, Go's `const`, Rust's `const` and immutable `static`, Python's module-level ALL_CAPS names
// assigned once; never a `let`, a `var`, a Go `var`, a lowercase Python name (code may reassign them)
function constsOf(root, fam) {
  const consts = new Map(), twice = new Set()
  for (const top of root.namedChildren) {
    let decl = top
    if (decl.type === 'export_statement') decl = field(decl, 'declaration') || decl.namedChildren[0]
    if (!decl) continue
    if (fam === 'ts' && decl.type === 'lexical_declaration' && field(decl, 'kind')?.text === 'const') { for (const v of decl.namedChildren) if (v.type === 'variable_declarator' && field(v, 'name')?.type === 'identifier' && field(v, 'value')) consts.set(field(v, 'name').text, field(v, 'value')) }
    else if (fam === 'go' && decl.type === 'const_declaration') each(decl, (s) => { if (s.type !== 'const_spec') return true; const names = s.namedChildren.filter((x) => x.type === 'identifier'); const vals = field(s, 'value') ? field(s, 'value').namedChildren : []; names.forEach((nm, i) => { if (vals[i]) consts.set(nm.text, vals[i]) }); return false })
    else if (fam === 'python' && decl.type === 'expression_statement') {
      const a = decl.namedChildren[0]
      if ((a?.type === 'assignment' || a?.type === 'augmented_assignment') && field(a, 'left')?.type === 'identifier') {
        const name = field(a, 'left').text
        if (consts.has(name) || a.type === 'augmented_assignment') twice.add(name)
        if (/^[A-Z][A-Z0-9_]*$/.test(name) && a.type === 'assignment' && field(a, 'right')) consts.set(name, field(a, 'right'))
      }
    } else if (fam === 'rust' && (decl.type === 'const_item' || (decl.type === 'static_item' && !decl.namedChildren.some((c) => c.type === 'mutable_specifier'))) && field(decl, 'name') && field(decl, 'value')) consts.set(field(decl, 'name').text, field(decl, 'value'))
  }
  for (const n of twice) consts.delete(n)
  return consts
}

// The SQL text an argument holds, by language → { text, line } | null
const SEGS = { ts: tsSegs, go: goSegs, python: pySegs, rust: rsSegs }

export function readQueryFile(tree, lang, file, { ms = FILE_MS } = {}) {
  const fam = familyOf(lang)
  const root = tree.rootNode
  const out = { lang: fam, path: file, clients: [], hints: [], markers: [], sites: [], fns: [], notes: [], tests: 0 }
  const note = (s) => { if (out.notes.length < 8 && !out.notes.includes(s)) out.notes.push(s) }
  const spec = LANGS[lang]?.spec
  const seenClient = new Set()
  const consts = constsOf(root, fam)
  const fileTest = TEST_PATH.test(file) || TEST_FILE[fam].test(file)
  let statements = 0, facts = 0
  const read = new Map() // a text many calls send (a constant) is read once
  const size = (s) => s.tables.length + s.columns.length + s.joins.length + s.lookups.length + s.casts.length
  const deadline = Date.now() + ms
  let steps = 0, stopped = false
  const late = () => (++steps & 4095) === 0 && Date.now() > deadline
  // the clients it imports, through the code graph's own import reading (lib/langs.mjs), first: the
  // dialect they speak sets the tokenizer's rules
  each(root, (n) => {
    if (stopped || (late() && (stopped = true))) return false
    const imp = spec?.imports?.[n.type]
    if (!imp) return true
    let list = []
    try { list = imp(n) || [] } catch {}
    for (const im of list) {
      const c = im && im.source ? clientOf(im.source) : null
      if (c && !seenClient.has(im.source) && out.clients.length < 16) { seenClient.add(im.source); out.clients.push({ source: im.source, dialect: c.dialect, line: lineOf(n) }) }
    }
    return n.type !== 'import_statement' && n.type !== 'use_declaration' && n.type !== 'import_declaration'
  })
  const ds = [...new Set(out.clients.map((c) => c.dialect).filter(Boolean))]
  const fileDialect = ds.length === 1 ? ds[0] : null
  const shadowed = [] // [site, the constants it inlined, its scope]: checked once every scope is known
  // the SQL text an argument holds, recording the constants it inlines
  const sqlOf = (arg, used) => (arg ? assemble(SEGS[fam](arg, { get: (k) => { const v = consts.get(k); if (v) used.add(k); return v } })) : null)
  const site = (call, arg, name, ctx) => {
    if (out.sites.length >= MAX_SITES || statements >= MAX_STATEMENTS || facts >= MAX_FACTS) return false
    const used = new Set()
    const sql = sqlOf(arg, used)
    if (!sql || !isSql(sql.text)) return false
    if (fileTest || ctx.test) { out.tests++; return true }
    const k = `${sql.line}\0${sql.text}`
    if (!read.has(k)) read.set(k, readQueries(sql.text, { dialect: fileDialect, line: sql.line }))
    const r = read.get(k)
    if (!r.statements.length) return false // prose, or no statement it reads
    for (const n of r.notes) note(n)
    for (const m of r.markers) if (!out.markers.some((x) => x.dialect === m.dialect && !!x.weak === !!m.weak)) out.markers.push(m)
    const sts = []
    for (const s of r.statements) { if (statements >= MAX_STATEMENTS || facts >= MAX_FACTS) break; sts.push(s); statements++; facts += size(s) }
    let f = -1
    if (ctx.fn) {
      if (ctx.fn.idx < 0) { ctx.fn.idx = out.fns.length; out.fns.push({ name: ctx.fn.name, line: ctx.fn.line, end: ctx.fn.end }) }
      f = ctx.fn.idx
    }
    const s = { line: lineOf(call), fn: f, call: name, statements: sts }
    out.sites.push(s)
    if (used.size) shadowed.push([s, used, ctx.scope])
    return true
  }
  const firstSql = (args) => { for (const a of args) { const s = sqlOf(a, new Set()); if (s && isSql(s.text)) return a } return null }
  // the call sites, by language
  const visit = (n, ctx) => {
    if (fam === 'ts' && n.type === 'call_expression') {
      const fn = field(n, 'function'), args = field(n, 'arguments')
      const name = fn ? (fn.type === 'identifier' ? fn.text : fn.type === 'member_expression' ? field(fn, 'property')?.text : null) : null
      if (!name || !args) return
      if (args.type === 'template_string') { if (TS_TAGS.has(name)) site(n, args, name, ctx); return }
      if (!TS_CALLS.has(name)) return
      const list = args.namedChildren
      // pool.query({ text: '…', values }): the config's text
      const cfg = list[0]?.type === 'object' ? list[0].namedChildren.find((p) => p.type === 'pair' && /^(?:text|sql)$/.test(field(p, 'key')?.text?.replace(/['"]/g, '') || '')) : null
      site(n, cfg ? field(cfg, 'value') : firstSql(list), name, ctx)
    } else if (fam === 'go' && n.type === 'call_expression') {
      const fn = field(n, 'function')
      const name = fn?.type === 'selector_expression' ? field(fn, 'field')?.text : null
      if (name && GO_CALLS.has(name)) site(n, firstSql((field(n, 'arguments') || n).namedChildren), name, ctx)
    } else if (fam === 'python' && n.type === 'call') {
      const fn = field(n, 'function')
      const name = fn?.type === 'attribute' ? field(fn, 'attribute')?.text : fn?.type === 'identifier' ? fn.text : null
      if (name && (PY_CALLS.has(name) || (name === 'text' && fn.type === 'identifier'))) site(n, positional(n)[0] || null, name, ctx)
    } else if (fam === 'rust' && n.type === 'macro_invocation') {
      const name = (field(n, 'macro')?.text || '').split('::').pop()
      if (!RS_MACROS.has(name)) return
      const tt = n.namedChildren.find((c) => c.type === 'token_tree')
      const lit = tt ? tt.namedChildren.find((c) => c.type === 'string_literal' || c.type === 'raw_string_literal' || (c.type === 'identifier' && consts.has(c.text))) : null
      site(n, lit || null, `${name}!`, ctx)
    } else if (fam === 'rust' && n.type === 'call_expression') {
      let fn = field(n, 'function')
      if (fn?.type === 'generic_function') fn = field(fn, 'function')
      const name = fn ? (fn.type === 'field_expression' ? field(fn, 'field')?.text : fn.text.split('::').pop()) : null
      if (name && ((fn.type === 'field_expression' && RS_METHODS.has(name)) || (fn.type !== 'field_expression' && RS_FNS.has(name)))) site(n, firstSql((field(n, 'arguments') || n).namedChildren), name, ctx)
    }
  }
  // the walk: [node, its context, what holds it]
  const top = { fn: null, cls: null, pyCls: null, impl: null, test: false, scope: null }
  const stack = stopped ? [] : [[root, top, null]]
  while (stack.length) {
    if (late()) { stopped = true; break }
    const [n, ctx, parent] = stack.pop()
    // what a declaration binds, in the function around it (never at the top level: those are the constants)
    if (ctx.scope) bound(n, fam, ctx.scope.names)
    if (out.sites.length < MAX_SITES && statements < MAX_STATEMENTS && facts < MAX_FACTS) visit(n, ctx)
    // the context its children get
    let c = ctx
    if (FN[fam].test(n.type)) {
      const name = fnName(n, parent, fam, ctx)
      const scope = { names: new Set(), up: ctx.scope }
      c = name !== null
        ? { ...ctx, fn: { name: name.slice(0, 120), line: lineOf(n), end: endOf(n), idx: -1 }, scope, test: ctx.test || isTestName(fam, name), pyCls: null }
        : { ...ctx, scope, pyCls: fam === 'python' ? null : ctx.pyCls }
      if (fam === 'ts' && n.type === 'arrow_function' && field(n, 'parameter')) scope.names.add(field(n, 'parameter').text)
    } else if (CLASS[fam]?.test(n.type)) {
      const name = field(n, 'name')?.text || '(class)'
      c = fam === 'python' ? { ...ctx, pyCls: name, test: ctx.test || /^Test/.test(name) } : { ...ctx, cls: name }
    } else if (fam === 'rust' && n.type === 'impl_item') {
      const t = field(n, 'type')
      c = { ...ctx, impl: t ? t.text.replace(/<[\s\S]*$/, '') : null }
    }
    // children, in source order on the stack; Rust's attributes mark the item after them as test code
    const kids = n.namedChildren
    let attrTest = false
    const pushes = []
    for (const k of kids) {
      if (fam === 'rust' && k.type === 'attribute_item') { if (TEST_ATTR.test(k.text)) attrTest = true; pushes.push([k, c, n]); continue }
      pushes.push([k, attrTest && (k.type === 'function_item' || k.type === 'mod_item') ? { ...c, test: true } : c, n])
      attrTest = false
    }
    for (let i = pushes.length - 1; i >= 0; i--) stack.push(pushes[i])
  }
  if (stopped) note(`the file took more than ${ms / 1000} s to read: the calls after that not read`)
  // a constant a function's parameter or local shadows is not the one the call sends: its site is dropped
  if (shadowed.length) {
    const drop = new Set()
    for (const [s, used, scope] of shadowed) for (let sc = scope; sc; sc = sc.up) if ([...used].some((u) => sc.names.has(u))) { drop.add(s); break }
    if (drop.size) out.sites = out.sites.filter((s) => !drop.has(s))
  }
  if (fam === 'rust' && out.clients.some((c) => importMatches(c.source, 'sqlx'))) {
    const text = root.text
    for (const [dialect, re] of RS_HINTS) { const m = re.exec(text); if (m) out.hints.push({ dialect, why: m[0], line: text.slice(0, m.index).split('\n').length }) }
  }
  if (out.sites.length >= MAX_SITES) note(`more than ${MAX_SITES} query calls: the first ${MAX_SITES} read`)
  if (statements >= MAX_STATEMENTS) note(`more than ${MAX_STATEMENTS} statements: the first ${MAX_STATEMENTS} read`)
  if (facts >= MAX_FACTS) note(`more than ${MAX_FACTS} names read: the statements after them not kept`)
  // a function that holds no site kept after the drop: renumber
  const keep = [...new Set(out.sites.map((s) => s.fn).filter((f) => f >= 0))].sort((a, b) => a - b)
  if (keep.length !== out.fns.length) { const at = new Map(keep.map((f, i) => [f, i])); out.fns = keep.map((f) => out.fns[f]); for (const s of out.sites) if (s.fn >= 0) s.fn = at.get(s.fn) }
  return out
}

export default {
  id: 'sql-queries',
  version: 1,
  kind: 'inferred',
  scope: 'file',
  tree: true,
  wants: (p) => SRC.test(p) && !DTS.test(p),
  level: queryLevel,
  discover: (info) => [...info].filter(([p, i]) => SRC.test(p) && !DTS.test(p) && (i.ddl & 64)).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    // a base's file is not read: graph_changes compares declarations, never the inferred model (data/base.mjs)
    if (ctx.aside) return { declarations: [] }
    const lang = treeLang(file)
    const tree = ctx.tree(lang, text)
    try {
      const q = readQueryFile(tree, lang, file)
      return q.sites.length || q.clients.length || q.tests ? { declarations: [], queries: q } : { declarations: [] }
    } finally { tree.delete?.() }
  },
}
