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
// SQL text: a string or template literal; a constant of the same file holding one; a concatenation;
// a format (Go's fmt.Sprintf, Python's % and .format, an f-string, Rust's format!). Whatever code fills
// in (a template's ${…}, an f-string's {…}, a format verb, a concatenated variable) is a parameter
// (readers/sql-query.mjs PARAM): a table named by one is never a table, and SQL built from variables is
// read only from its literal parts. A text is read only when its first word is a statement's
// (SELECT, INSERT, UPDATE, DELETE, WITH, …): a query builder's fragment (`sql\`${col} = 1\``) is none.
// Test code (the code graph's test paths, each language's own marks) is not read for the model: its
// sites are counted. Bounded: MAX_SITES calls, MAX_STATEMENTS statements and MAX_FACTS names a file; a
// text many calls send (a constant) is read once.
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
const CALL = /(?:\b(?:query|queryRow|execute|exec|prepare|raw|unsafe|sql|SQL|Query|QueryRow|QueryContext|QueryRowContext|Exec|ExecContext|Prepare|PrepareContext|Get|GetContext|Select|SelectContext|Queryx|QueryRowx|MustExec|NamedExec|NamedQuery|executemany|executescript|mogrify|fetch|fetchrow|fetchval|read_sql|text|query_as|query_scalar|query_row|query_map|query_one|query_opt|prepare_cached|execute_batch|simple_query|batch_execute|sql_query)\s*!?\s*(?:<[^>\n]{0,80}>\s*)?[(`])|\$(?:query|execute)Raw/
const SQL_TEXT = /(?:["'`]|r#*")\s*\(?\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b/i
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const CLIENT_TEXT = {
  ts: new RegExp(`(?:\\bfrom|\\brequire\\s*\\(|\\bimport\\s*\\(?)\\s*["'\`](?:${CLIENTS.map((c) => esc(c.source)).join('|')})(?:/[^"'\`\\n]*)?["'\`]`),
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
      return f ? f.map((s) => ({ ...s, text: s.text.replace(/%%|%[-+# 0]*\d*(?:\.\d+)?[a-zA-Z]/g, (m) => (m === '%%' ? '%' : PARAM)) })) : null
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

// the function holding a node, as each language names it, and whether it is test code
const FN_TYPES = { ts: /^(?:function_declaration|generator_function_declaration|method_definition|arrow_function|function_expression|function|generator_function)$/, go: /^(?:function_declaration|method_declaration)$/, python: /^function_definition$/, rust: /^function_item$/ }
function enclosing(n, fam) {
  for (let p = n.parent; p; p = p.parent) {
    if (!FN_TYPES[fam].test(p.type)) continue
    let name = null
    if (fam === 'ts') {
      if (p.type === 'function_declaration' || p.type === 'generator_function_declaration') name = field(p, 'name')?.text
      else if (p.type === 'method_definition') name = `${owner(p, /^(?:class_declaration|abstract_class_declaration|class)$/) || '(class)'}.${field(p, 'name')?.text || '(method)'}`
      else {
        const h = p.parent
        if (h?.type === 'variable_declarator') name = field(h, 'name')?.text
        else if (h?.type === 'pair') name = field(h, 'key')?.text
        else if (h && (h.type === 'public_field_definition' || h.type === 'field_definition')) name = `${owner(h, /^(?:class_declaration|abstract_class_declaration|class)$/) || '(class)'}.${(field(h, 'name') || field(h, 'property'))?.text}`
        else if (h?.type === 'export_statement') name = '(default)'
        else continue // a callback belongs to the function around it
      }
    } else if (fam === 'go') {
      name = field(p, 'name')?.text || '(func)'
      if (p.type === 'method_declaration') { let recv = null; each(field(p, 'receiver') || p, (x) => { if (!recv && x.type === 'type_identifier') recv = x.text; return !recv }); if (recv) name = `${recv}.${name}` }
    } else if (fam === 'python') { const cls = owner(p, /^class_definition$/, /^function_definition$/); name = `${cls ? `${cls}.` : ''}${field(p, 'name')?.text || '(function)'}` }
    else { const impl = implOf(p); name = `${impl ? `${impl}::` : ''}${field(p, 'name')?.text || '(fn)'}` }
    return { node: p, name: (name || '(function)').slice(0, 120) }
  }
  return null
}
const owner = (n, re, stop = null) => { for (let p = n.parent; p; p = p.parent) { if (stop && stop.test(p.type)) return null; if (re.test(p.type)) return field(p, 'name')?.text || null } return null }
const implOf = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === 'impl_item') { const t = field(p, 'type'); return t ? t.text.replace(/<[\s\S]*$/, '') : null } return null }
// test code: a test function (Go's TestX, Python's test_x and TestX classes, Rust's #[test] and #[cfg(test)] modules)
function isTestFn(n, fam, name) {
  if (fam === 'go') return /^(?:Test|Benchmark|Example|Fuzz)/.test(name.split('.').pop())
  if (fam === 'python') return /^test/.test(name.split('.').pop()) || /(?:^|\.)Test/.test(name)
  if (fam === 'rust') {
    for (let p = n; p; p = p.parent) {
      if (p.type !== 'function_item' && p.type !== 'mod_item') continue
      for (let s = p.previousNamedSibling; s && s.type === 'attribute_item'; s = s.previousNamedSibling) if (/\b(?:test|cfg\s*\(\s*test\s*\))/.test(s.text)) return true
    }
  }
  return false
}
const TEST_FILE = { ts: /\.(?:test|spec)\.[cm]?[jt]sx?$/i, go: /_test\.go$/i, python: /(?:^|\/)(?:test_[^/]*|[^/]*_test|conftest)\.py$/i, rust: /(?:^|\/)tests\// }

// The SQL text an argument holds, by language → { text, line } | null
const SEGS = { ts: tsSegs, go: goSegs, python: pySegs, rust: rsSegs }

export function readQueryFile(tree, lang, file) {
  const fam = familyOf(lang)
  const root = tree.rootNode
  const out = { lang: fam, path: file, clients: [], hints: [], markers: [], sites: [], fns: [], notes: [], tests: 0 }
  const note = (s) => { if (out.notes.length < 8 && !out.notes.includes(s)) out.notes.push(s) }
  // the clients it imports, through the code graph's own import reading (lib/langs.mjs)
  const spec = LANGS[lang]?.spec
  const seenClient = new Set()
  each(root, (n) => {
    const read = spec?.imports?.[n.type]
    if (!read) return true
    let list = []
    try { list = read(n) || [] } catch {}
    for (const im of list) {
      const c = im && im.source ? clientOf(im.source) : null
      if (c && !seenClient.has(im.source) && out.clients.length < 16) { seenClient.add(im.source); out.clients.push({ source: im.source, dialect: c.dialect, line: lineOf(n) }) }
    }
    return n.type !== 'import_statement' && n.type !== 'use_declaration' && n.type !== 'import_declaration'
  })
  if (fam === 'rust' && out.clients.some((c) => importMatches(c.source, 'sqlx'))) {
    const text = root.text
    for (const [dialect, re] of RS_HINTS) { const m = re.exec(text); if (m) out.hints.push({ dialect, why: m[0], line: text.slice(0, m.index).split('\n').length }) }
  }
  // the file's string constants a call may name (module level)
  const consts = new Map()
  for (const top of named(root)) {
    let decl = top
    if (decl.type === 'export_statement') decl = field(decl, 'declaration') || named(decl)[0]
    if (!decl) continue
    if (fam === 'ts' && (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration')) { for (const v of named(decl)) if (v.type === 'variable_declarator' && field(v, 'name')?.type === 'identifier' && field(v, 'value')) consts.set(field(v, 'name').text, field(v, 'value')) }
    else if (fam === 'go' && (decl.type === 'const_declaration' || decl.type === 'var_declaration')) each(decl, (s) => { if (s.type !== 'const_spec' && s.type !== 'var_spec') return true; const names = named(s).filter((x) => x.type === 'identifier'); const vals = field(s, 'value') ? named(field(s, 'value')) : []; names.forEach((nm, i) => { if (vals[i]) consts.set(nm.text, vals[i]) }); return false })
    else if (fam === 'python' && decl.type === 'expression_statement') { const a = named(decl)[0]; if (a?.type === 'assignment' && field(a, 'left')?.type === 'identifier' && field(a, 'right')) consts.set(field(a, 'left').text, field(a, 'right')) }
    else if (fam === 'rust' && (decl.type === 'const_item' || decl.type === 'static_item') && field(decl, 'name') && field(decl, 'value')) consts.set(field(decl, 'name').text, field(decl, 'value'))
  }
  const fileTest = TEST_PATH.test(file) || TEST_FILE[fam].test(file)
  const fnAt = new Map()
  let statements = 0, facts = 0
  const read = new Map() // a text many calls send (a constant) is read once
  const size = (s) => s.tables.length + s.columns.length + s.joins.length + s.lookups.length + s.casts.length
  const site = (call, arg, name) => {
    if (out.sites.length >= MAX_SITES || statements >= MAX_STATEMENTS || facts >= MAX_FACTS) return false
    const seg = arg ? SEGS[fam](arg, consts) : null
    const sql = assemble(seg)
    if (!sql || !isSql(sql.text)) return false
    const e = enclosing(call, fam)
    if (fileTest || (e && isTestFn(e.node, fam, e.name)) || (fam === 'rust' && isTestFn(call, fam, ''))) { out.tests++; return true }
    let f = -1
    if (e) {
      const k = `${lineOf(e.node)}\0${e.name}`
      if (!fnAt.has(k)) { fnAt.set(k, out.fns.length); out.fns.push({ name: e.name, line: lineOf(e.node), end: endOf(e.node) }) }
      f = fnAt.get(k)
    }
    const k = `${sql.line}\0${sql.text}`
    if (!read.has(k)) read.set(k, readQueries(sql.text, { dialect: fileDialect, line: sql.line }))
    const r = read.get(k)
    for (const n of r.notes) note(n)
    for (const m of r.markers) if (!out.markers.some((x) => x.dialect === m.dialect && !!x.weak === !!m.weak)) out.markers.push(m)
    const sts = []
    for (const s of r.statements) { if (statements >= MAX_STATEMENTS || facts >= MAX_FACTS) break; sts.push(s); statements++; facts += size(s) }
    out.sites.push({ line: lineOf(call), fn: f, call: name, statements: sts })
    return true
  }
  // the dialect the file's own clients speak, for the tokenizer's rules
  const ds = [...new Set(out.clients.map((c) => c.dialect).filter(Boolean))]
  const fileDialect = ds.length === 1 ? ds[0] : null
  const firstSql = (args) => { for (const a of args) { const s = assemble(SEGS[fam](a, consts)); if (s && isSql(s.text)) return a } return null }
  each(root, (n) => {
    if (out.sites.length >= MAX_SITES || statements >= MAX_STATEMENTS) return false
    if (fam === 'ts' && n.type === 'call_expression') {
      const fn = field(n, 'function'), args = field(n, 'arguments')
      const name = fn ? (fn.type === 'identifier' ? fn.text : fn.type === 'member_expression' ? field(fn, 'property')?.text : null) : null
      if (!name || !args) return true
      if (args.type === 'template_string') { if (TS_TAGS.has(name)) site(n, args, name); return true }
      if (!TS_CALLS.has(name)) return true
      const list = named(args)
      // pool.query({ text: '…', values }): the config's text
      const cfg = list[0]?.type === 'object' ? named(list[0]).find((p) => p.type === 'pair' && /^(?:text|sql)$/.test(field(p, 'key')?.text?.replace(/['"]/g, '') || '')) : null
      site(n, cfg ? field(cfg, 'value') : firstSql(list), name)
    } else if (fam === 'go' && n.type === 'call_expression') {
      const fn = field(n, 'function')
      const name = fn?.type === 'selector_expression' ? field(fn, 'field')?.text : null
      if (name && GO_CALLS.has(name)) site(n, firstSql(named(field(n, 'arguments') || n)), name)
    } else if (fam === 'python' && n.type === 'call') {
      const fn = field(n, 'function')
      const name = fn?.type === 'attribute' ? field(fn, 'attribute')?.text : fn?.type === 'identifier' ? fn.text : null
      if (name && (PY_CALLS.has(name) || (name === 'text' && fn.type === 'identifier'))) site(n, positional(n)[0] || null, name)
    } else if (fam === 'rust' && n.type === 'macro_invocation') {
      const name = (field(n, 'macro')?.text || '').split('::').pop()
      if (!RS_MACROS.has(name)) return true
      const tt = named(n).find((c) => c.type === 'token_tree')
      const lit = tt ? named(tt).find((c) => c.type === 'string_literal' || c.type === 'raw_string_literal' || (c.type === 'identifier' && consts.has(c.text))) : null
      site(n, lit || null, `${name}!`)
      return false
    } else if (fam === 'rust' && n.type === 'call_expression') {
      let fn = field(n, 'function')
      if (fn?.type === 'generic_function') fn = field(fn, 'function')
      const name = fn ? (fn.type === 'field_expression' ? field(fn, 'field')?.text : fn.text.split('::').pop()) : null
      if (name && ((fn.type === 'field_expression' && RS_METHODS.has(name)) || (fn.type !== 'field_expression' && RS_FNS.has(name)))) site(n, firstSql(named(field(n, 'arguments') || n)), name)
    }
    return true
  })
  if (out.sites.length >= MAX_SITES) note(`more than ${MAX_SITES} query calls: the first ${MAX_SITES} read`)
  if (statements >= MAX_STATEMENTS) note(`more than ${MAX_STATEMENTS} statements: the first ${MAX_STATEMENTS} read`)
  if (facts >= MAX_FACTS) note(`more than ${MAX_FACTS} names read: the statements after them not kept`)
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
