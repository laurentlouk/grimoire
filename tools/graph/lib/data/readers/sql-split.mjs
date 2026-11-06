// grimoire graph · data · splitting SQL text into statements, in one linear pass, without a parser.
//
//   blank(text)  the same text, same length and same lines, with comments and string literals
//                turned into spaces: what is left is code (identifiers keep their quotes)
//   split(text)  [{ line, text }]: one entry per statement, `line` where its first code starts.
//                A statement ends at a `;` in code, or at Drizzle's `--> statement-breakpoint`
//                comment; a trigger's body (CREATE TRIGGER … BEGIN … END) keeps its `;`. Text
//                with no code left (comments only) is no statement.
//   hasDDL(text) whether a statement creates or alters a table or an index: what tells a migration
//                from a seed or a query file
//
// SQLite's lexical rules: '…' strings ('' escapes a quote), "…", `…` and […] identifiers, -- and
// /* */ comments. Postgres dollar quoting is not read here (its migrations are not replayed).

const BREAKPOINT = /--> statement-breakpoint/g
const TRIGGER = /^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i
const DDL = /^(?:CREATE\s+(?:(?:TEMP|TEMPORARY|VIRTUAL)\s+)?TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/i

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
  const cuts = []
  for (let i = code.indexOf(';'); i >= 0; i = code.indexOf(';', i + 1)) cuts.push([i, 'semi'])
  for (const m of text.matchAll(BREAKPOINT)) if (code[m.index] === ' ') cuts.push([m.index, 'break'])
  cuts.sort((a, b) => a[0] - b[0])
  cuts.push([text.length, 'end'])
  const out = []
  let start = 0, line = 1, scanned = 0
  // positions only grow, so the newlines are counted once in all
  const lineAt = (pos) => { for (let k = text.indexOf('\n', scanned); k >= 0 && k < pos; k = text.indexOf('\n', k + 1)) { line++; scanned = k + 1 } return line }
  for (const [at, kind] of cuts) {
    if (at < start) continue
    const body = code.slice(start, at)
    const lead = body.search(/\S/)
    if (kind === 'semi' && lead >= 0 && TRIGGER.test(body.slice(lead)) && !/\bEND\s*$/i.test(body)) continue // inside a trigger's body
    if (lead >= 0) {
      const s = start + lead
      const end = start + body.trimEnd().length
      out.push({ line: lineAt(s), text: text.slice(s, end) })
    }
    start = at + 1
  }
  return out
}

export const hasDDL = (text) => split(text).some((s) => DDL.test(s.text))
