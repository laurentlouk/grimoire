// grimoire graph · data · table names as patterns: the names infra declares (an exact name, or a name
// template whose unknown parts are `{label}`: extractors/terraform.mjs) and the names code builds (a
// literal, Rust's `format!`, a template literal, a concatenation: extractors/serde.mjs, ts-types.mjs),
// and when one can name the same table as the other.
//
// A pattern is text whose `{…}` parts are wildcards and whose other characters are literal. A table
// name holds only letters, digits, `_`, `-` and `.` (DynamoDB's rule), so a `{` is never literal:
//   infra  `{env}-{project}-orders`   each {…} an unknown part: one character or more
//   code   `{}-shop-orders`           each {} what the code fills in at run time: any text, even none
//
// Two patterns match when one name can be written by both, and the table's distinctive part is spelt
// by the code: the last word of the table's literal text (a run of letters and digits: `orders` in
// `{env}-{project}-orders`, `Orders` in `Orders`) is matched by the code's literal characters, never by
// one of its wildcards. So `{}-shop-orders` and `test-shop-orders` match `{env}-{project}-orders`;
// `{}-orders` does too (its wildcard may hold `stage-shop`); `{}-{}`, `{}` and `orders` do not; and
// `Orders` matches only `Orders`. Letters compare exactly: no case folding, no plural, no edit distance
// (no fuzzy matching: what the rule states, nothing else). A table whose literal text has no word (a
// name wholly unknown) matches no code name.
//
//   parseName(text)        → [{ lit: string } | { wild: true }], or null for an empty pattern
//   codeName(parts)        → a code pattern from [string | null] (null: a part filled in at run time),
//                            or null when it cannot be a table name (a character no table name holds,
//                            fewer than 3 literal characters, no letter, past 255 characters, more
//                            than MAX_WILD parts filled in)
//   namesMatch(code, table) → true | false  (both patterns, as written; linear in their product)
//   lastWord(table)        → the table's distinctive word, or null
export const MAX_WILD = 4
const NAME_CHARS = /^[A-Za-z0-9_.-]*$/
const WORD = /[A-Za-z0-9]/

export function parseName(text) {
  const s = String(text ?? '')
  const out = []
  let lit = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      const j = s.indexOf('}', i + 1)
      if (j < 0) { lit += s.slice(i); break }
      if (lit) { out.push({ lit }); lit = '' }
      if (!out.length || !out[out.length - 1].wild) out.push({ wild: true })
      i = j
      continue
    }
    lit += s[i]
  }
  if (lit) out.push({ lit })
  return out.length ? out : null
}

export function codeName(parts) {
  let text = '', literal = 0, wild = 0, last = null
  for (const p of parts) {
    if (p === null || p === undefined) { if (last !== 'wild') { text += '{}'; wild++ } last = 'wild'; continue }
    const s = String(p)
    if (!NAME_CHARS.test(s)) return null
    text += s; literal += s.length
    if (s) last = 'lit'
  }
  if (literal < 3 || wild > MAX_WILD || text.length > 255 || !/[A-Za-z]/.test(text)) return null
  return text
}

// The table's last word: [start, end) offsets in its flattened literal characters, or null.
function chars(tokens, side) {
  // one entry per literal character, `{ c }`, and one per wildcard, `{ w: true }`
  const out = []
  for (const t of tokens) {
    if (t.wild) out.push({ w: true })
    else for (const c of t.lit) out.push({ c })
  }
  if (side === 'table') {
    let end = -1
    for (let i = out.length - 1; i >= 0; i--) if (!out[i].w && WORD.test(out[i].c)) { end = i; break }
    if (end < 0) return { list: out, word: null }
    let start = end
    while (start > 0 && !out[start - 1].w && WORD.test(out[start - 1].c)) start--
    for (let i = start; i <= end; i++) out[i].last = true
    return { list: out, word: [start, end + 1] }
  }
  return { list: out, word: null }
}

export function lastWord(table) {
  const tokens = parseName(table)
  if (!tokens) return null
  const { list, word } = chars(tokens, 'table')
  return word ? list.slice(word[0], word[1]).map((x) => x.c).join('') : null
}

export function namesMatch(code, table) {
  const ct = parseName(code), tt = parseName(table)
  if (!ct || !tt) return false
  const q = chars(ct, 'code').list
  const T = chars(tt, 'table')
  if (!T.word) return false
  const p = T.list
  const n = p.length, m = q.length
  // f(i, j): p[i:] and q[j:] can spell one name. A table wildcard is one character or more: it takes
  // one, then any more (`more`); a code wildcard any text. A code wildcard never takes a character of
  // the table's last word.
  const memo = new Map()
  const f = (i, j, more) => {
    const k = (i * (m + 1) + j) * 2 + (more ? 1 : 0)
    if (memo.has(k)) return memo.get(k)
    memo.set(k, false)
    let r = false
    if (i === n && j === m) r = true
    else {
      const a = i < n ? p[i] : null, b = j < m ? q[j] : null
      if (a && a.w) {
        if (more && f(i + 1, j, false)) r = true // the table's wildcard ends
        else if (b && !b.w && f(i, j + 1, true)) r = true // it takes a code character
        else if (b && b.w && (f(i, j + 1, true) || f(i + 1, j, false) || f(i + 1, j + 1, false))) r = true // both are unknown text
      }
      if (!r && b && b.w) {
        if (f(i, j + 1, more)) r = true // the code's wildcard ends (it may hold nothing)
        else if (a && !a.w && !a.last && f(i + 1, j, false)) r = true // it takes a table character, never one of the last word's
      }
      if (!r && a && b && !a.w && !b.w && a.c === b.c && f(i + 1, j + 1, false)) r = true
    }
    memo.set(k, r)
    return r
  }
  return f(0, 0, false)
}
