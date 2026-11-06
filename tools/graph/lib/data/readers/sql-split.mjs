// grimoire graph · data · splitting SQL text into statements, in one linear pass, without a parser.
//
//   blank(text)  the same text, same length and same lines, with comments and string literals
//                turned into spaces: what is left is code (identifiers keep their quotes)
//   split(text)  [{ line, text }]: one entry per statement, `line` where its first code starts.
//                A statement ends at a `;` in code, or at Drizzle's `--> statement-breakpoint`
//                comment. A trigger whose header is followed by BEGIN (SQLite's form) keeps the
//                `;` of its body until the END that closes it (a CASE … END inside does not); one
//                without BEGIN (Postgres' EXECUTE FUNCTION, MySQL's single statement) ends at its
//                `;`. Text with no code left (comments only) is no statement. One pass over the
//                text's words: linear, however long the file.
//   schemaLevel(text)  2 when a statement creates or alters a table or an index (what finds a
//                migration folder), 1 when the schema statements are others only (DROP, CREATE
//                VIEW or TRIGGER…: such a file belongs to a folder once found), 0 when there is
//                none (a seed, a query file)
//
// SQLite's lexical rules: '…' strings ('' escapes a quote), "…", `…` and […] identifiers, -- and
// /* */ comments. Postgres dollar quoting is not read here (its migrations are not replayed).

const BREAKPOINT = /--> statement-breakpoint/g
const TOKEN = /"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][\w$]*|;/g // what decides where a statement ends
const DDL = /^(?:CREATE\s+(?:(?:TEMP|TEMPORARY|VIRTUAL)\s+)?TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/i
const SCHEMA = /^(?:CREATE|DROP|ALTER)\b/i

export function blank(text) {
  const out = []
  let from = 0, i = 0
  const n = text.length
  const gap = (a, b) => { out.push(text.slice(from, a), text.slice(a, b).replace(/[^\n]/g, ' ')); from = b }
  while (i < n) {
    const c = text[i]
    if (c === '-' && text[i + 1] === '-') { let j = text.indexOf('\n', i); if (j < 0) j = n; gap(i, j); i = j; continue }
    if (c === '/' && text[i + 1] === '*') { let j = text.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; gap(i, j); i = j; continue }
    if (c === "'") {
      let j = i + 1
      for (;;) { j = text.indexOf("'", j); if (j < 0) { j = n; break } if (text[j + 1] === "'") { j += 2; continue } j++; break }
      gap(i + 1, Math.max(i + 1, j - 1)); i = j; continue
    }
    const close = c === '"' ? '"' : c === '`' ? '`' : c === '[' ? ']' : null
    if (close) { const j = text.indexOf(close, i + 1); i = j < 0 ? n : j + 1; continue }
    i++
  }
  out.push(text.slice(from))
  return out.join('')
}

export function split(text) {
  const code = blank(text)
  const breaks = [...text.matchAll(BREAKPOINT)].map((m) => m.index).filter((i) => code[i] === ' ')
  const out = []
  let start = 0, line = 1, scanned = 0, b = 0
  // positions only grow, so the newlines are counted once in all
  const lineAt = (pos) => { for (let k = text.indexOf('\n', scanned); k >= 0 && k < pos; k = text.indexOf('\n', k + 1)) { line++; scanned = k + 1 } return line }
  // The statement being read: its first words (CREATE [TEMP] TRIGGER?), whether its BEGIN … END
  // body is open, the CASE … END depth inside that body, and whether the body's END was seen.
  let words = [], trigger = false, body = false, depth = 0, closed = false
  const cut = (at) => {
    const seg = code.slice(start, at)
    const lead = seg.search(/\S/)
    if (lead >= 0) out.push({ line: lineAt(start + lead), text: text.slice(start + lead, start + seg.trimEnd().length) })
    start = at + 1
    words = []; trigger = body = closed = false; depth = 0
  }
  for (const m of code.matchAll(TOKEN)) {
    while (b < breaks.length && breaks[b] < m.index) cut(breaks[b++])
    const t = m[0]
    if (t === ';') { if (!body || closed) cut(m.index); continue }
    if (/^["`[]/.test(t)) continue // a quoted identifier: never a keyword
    const w = t.toUpperCase()
    if (words.length < 3) { words.push(w); trigger = words[0] === 'CREATE' && (words[1] === 'TRIGGER' || (/^TEMP(ORARY)?$/.test(words[1]) && words[2] === 'TRIGGER')) }
    else if (trigger && !body) body = w === 'BEGIN'
    else if (body && !closed) { if (w === 'CASE') depth++; else if (w === 'END') { if (depth) depth--; else closed = true } }
  }
  while (b < breaks.length) cut(breaks[b++])
  cut(text.length)
  return out
}

export function schemaLevel(text) {
  let level = 0
  for (const s of split(text)) { if (DDL.test(s.text)) return 2; if (SCHEMA.test(s.text)) level = 1 }
  return level
}
