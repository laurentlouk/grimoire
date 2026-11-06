// grimoire graph · data · which SQL dialect a set of migration files is written in, read off the SQL
// itself when no config states it. Only code counts (comments and string literals are blanked
// first). A dialect is named only when the markers agree: markers of two dialects, or none, leave it
// unknown, since replaying SQL in the wrong dialect would misread it silently, and a gap is better.
//
//   sniffDialect([{ path, text }]) → { dialect, marker, path, line }   the first marker seen
//                                  | { dialect: null, reason }
//
// Backtick identifiers are a weak marker: MySQL's, but SQLite accepts them and Drizzle writes them
// for SQLite. They name MySQL only when no other marker is present.
import { blank } from './sql-split.mjs'

const MARKERS = [
  ['sqlite', 'AUTOINCREMENT', /\bAUTOINCREMENT\b/i],
  ['sqlite', 'WITHOUT ROWID', /\bWITHOUT\s+ROWID\b/i],
  ['sqlite', 'PRAGMA', /^\s*PRAGMA\b|;\s*PRAGMA\b/im],
  ['sqlite', 'STRICT', /\)\s*STRICT\b/i],
  ['postgres', 'SERIAL', /\b(?:BIG|SMALL)?SERIAL\b/i],
  ['postgres', '::', /::/],
  ['postgres', '$$', /\$\w*\$/],
  ['postgres', 'JSONB', /\bJSONB\b/i],
  ['postgres', 'TIMESTAMPTZ', /\bTIMESTAMPTZ\b/i],
  ['postgres', 'CREATE EXTENSION', /\bCREATE\s+EXTENSION\b/i],
  ['postgres', 'GENERATED … AS IDENTITY', /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i],
  ['mysql', 'ENGINE=', /\bENGINE\s*=/i],
  ['mysql', 'AUTO_INCREMENT', /\bAUTO_INCREMENT\b/i],
  ['mysql', 'UNSIGNED', /\bUNSIGNED\b/i],
  ['mysql', 'backtick identifiers', /`/, 'weak'],
]

export function sniffDialect(files) {
  const strong = new Map(), weak = new Map() // dialect → its first marker { marker, path, line, at }
  files.forEach((f, fi) => {
    const code = blank(f.text)
    for (const [dialect, marker, re, strength] of MARKERS) {
      const m = re.exec(code)
      if (!m) continue
      const into = strength === 'weak' ? weak : strong
      const at = fi * 1e12 + m.index
      if (into.has(dialect) && into.get(dialect).at <= at) continue
      into.set(dialect, { marker, path: f.path, line: code.slice(0, m.index + m[0].search(/\S|$/)).split('\n').length, at })
    }
  })
  const seen = strong.size ? strong : weak
  if (seen.size === 1) { const [[dialect, { marker, path, line }]] = seen; return { dialect, marker, path, line } }
  if (!seen.size) return { dialect: null, reason: 'no dialect marker in the SQL' }
  const order = [...new Set(MARKERS.map((m) => m[0]))].filter((d) => seen.has(d))
  return { dialect: null, reason: `conflicting dialect markers: ${order.map((d) => { const s = seen.get(d); return `${d} (${s.marker} at ${s.path}:${s.line})` }).join(', ')}` }
}
