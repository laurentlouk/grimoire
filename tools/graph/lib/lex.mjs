// grimoire graph · lexical helpers for the scans that read a file's text, not its syntax tree: the
// configuration reads (config.mjs) and the hints that tie code to an API contract (contracts.mjs).
//
//   masked(src, family)  the source with every comment blanked (spaces; line breaks kept, so offsets
//                        and lines do not move) and, in Python, every triple-quoted string too (a
//                        docstring is prose). String literals are kept: a key is read from them.
//   lineAt(src)          offset → 1-based line, by binary search over the line starts
//   closing(src, open)   the offset of the bracket closing the one at `open`, strings skipped, or -1
//   objectEntries(src, open) · objectLeaves(src, open)  an object literal's entries, and its leaves by key path
//
// All linear in the input (one pass each, no backtracking regular expression), so a hostile file
// costs its length. masked and lineAt keep their last answer: the indexer asks both scans of a file
// (configOfCode, contractHints) for the same text, one after the other, and pays once.

const HASH = new Set(['python', 'ruby', 'yaml', 'graphql', 'shell'])
const SLASH = new Set(['js', 'go', 'rust', 'jvm', 'c', 'csharp', 'swift', 'php', 'proto'])

let lastMasked = null
export function masked(src, family) {
  if (lastMasked && lastMasked.src === src && lastMasked.family === family) return lastMasked.out
  const out = maskedOnce(src, family)
  lastMasked = { src, family, out }
  return out
}
// One pass, jumping from one character that may open a string or a comment to the next; the text
// between is copied as it is, a comment as blanks (its line breaks kept).
const blankOf = (s) => s.replace(/[^\n\r]/g, ' ')
function maskedOnce(src, family) {
  const hash = HASH.has(family) || family === 'php', slash = SLASH.has(family)
  const parts = []
  let kept = 0 // the text before this offset is in parts
  const blank = (a, b) => { parts.push(src.slice(kept, a), blankOf(src.slice(a, b))); kept = b }
  const special = /["'`/#]/g
  const n = src.length
  let i = 0
  while (i < n) {
    special.lastIndex = i
    const next = special.exec(src)
    if (!next) break
    i = next.index
    const c = src[i]
    // Python's triple-quoted strings: docstrings and prose, blanked whole
    if (family === 'python' && (c === '"' || c === "'") && src[i + 1] === c && src[i + 2] === c) {
      const end = src.indexOf(c + c + c, i + 3)
      const to = end < 0 ? n : end + 3
      blank(i, to); i = to; continue
    }
    if (c === '"' || c === "'" || (c === '`' && family !== 'python')) {
      // a Rust or Go character literal is short; a Rust lifetime (`'a`) has no closing quote
      if (c === "'" && (family === 'rust' || family === 'go')) { const m = /^'(\\.[^']{0,8}|[^\\'\n])'/.exec(src.slice(i, i + 12)); i += m ? m[0].length : 1; continue }
      let j = i + 1
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (src[j] === '\n' && c !== '`') break; j++ }
      i = j + 1; continue
    }
    if (slash && c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const to = e < 0 ? n : e; blank(i, to); i = to; continue }
    if (slash && c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const to = e < 0 ? n : e + 2; blank(i, to); i = to; continue }
    if (hash && c === '#' && !(family === 'ruby' && src[i + 1] === '{')) { const e = src.indexOf('\n', i); const to = e < 0 ? n : e; blank(i, to); i = to; continue }
    i++
  }
  if (!parts.length) return src
  parts.push(src.slice(kept))
  return parts.join('')
}

let lastLines = null
export function lineAt(src) {
  if (lastLines && lastLines.src === src) return lastLines.at
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1)
  const at = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1 } return lo + 1 }
  lastLines = { src, at }
  return at
}

const PAIR = { '(': ')', '[': ']', '{': '}' }
// The offset of the bracket that closes the one at `open` (strings skipped; comments must be masked).
export function closing(src, open, cap = src.length) {
  const stack = [PAIR[src[open]]]
  const end = Math.min(src.length, cap)
  for (let i = open + 1; i < end; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') { let j = i + 1; while (j < end && src[j] !== c) { if (src[j] === '\\') j++; j++ } i = j; continue }
    if (PAIR[c]) stack.push(PAIR[c])
    else if (c === ')' || c === ']' || c === '}') { if (stack.pop() !== c) return -1; if (!stack.length) return i }
  }
  return -1
}

// An object literal's own entries: [{ key, at (the key's offset), kind, from, to (the value's span,
// or the method's) }]. kind: `pair` (`key: value`, a key an identifier or a quoted name), `method`
// (`key(…) {…}`) or `shorthand` (`{ key }`); a spread or a computed key is no entry. Capped.
const KEYNAME = /^[A-Za-z_$][\w$-]*$/
export function objectEntries(src, open, { max = 400 } = {}) {
  const out = []
  const to = closing(src, open)
  if (to < 0) return out
  // the end of an expression starting at j: the next comma or the object's end, at this depth
  const exprEnd = (j) => {
    let d = 0
    while (j < to) {
      const ch = src[j]
      if (ch === '"' || ch === "'" || ch === '`') { let k = j + 1; while (k < to && src[k] !== ch) { if (src[k] === '\\') k++; k++ } j = k + 1; continue }
      if (PAIR[ch]) d++
      else if (ch === ')' || ch === ']' || ch === '}') { if (d === 0) break; d-- }
      else if (ch === ',' && d === 0) break
      j++
    }
    return j
  }
  let i = open + 1
  while (i < to && out.length < max) {
    while (i < to && (src[i] === ',' || /\s/.test(src[i]))) i++
    if (i >= to) break
    let key = null
    const at = i, c = src[i]
    if (c === '"' || c === "'") { const j = src.indexOf(c, i + 1); if (j < 0 || j > to) break; key = src.slice(i + 1, j); i = j + 1 }
    else { const m = /^(?:async\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)/.exec(src.slice(i, i + 160)); if (m) { key = m[1]; i += m[0].length } }
    while (i < to && /[ \t]/.test(src[i])) i++
    const named = key !== null && KEYNAME.test(key)
    if (named && src[i] === ':') {
      i++
      while (i < to && /\s/.test(src[i])) i++
      const e = exprEnd(i)
      out.push({ key, at, kind: 'pair', from: i, to: e })
      i = e + 1; continue
    }
    if (named && src[i] === '(' && c !== '"' && c !== "'") { const e = exprEnd(i); out.push({ key, at, kind: 'method', from: i, to: e }); i = e + 1; continue }
    if (named && c !== '"' && c !== "'" && (src[i] === ',' || /\s/.test(src[i] || ' ') || i >= to)) {
      let j = i; while (j < to && /\s/.test(src[j])) j++
      if (j >= to || src[j] === ',') { out.push({ key, at, kind: 'shorthand', from: at, to: i }); i = j + 1; continue }
    }
    i = exprEnd(i) + 1 // a spread, a computed key: skipped
  }
  return out
}
// An object literal's leaves: [{ path: ['jwt', 'secret'], at, from, to }]: a pair whose value is
// itself an object literal is walked into (its key joins the path), any other pair is a leaf.
export function objectLeaves(src, open, { maxDepth = 6, max = 400 } = {}) {
  const out = []
  const walk = (o, path) => {
    for (const e of objectEntries(src, o)) {
      if (out.length >= max) return
      if (e.kind !== 'pair') continue
      if (src[e.from] === '{' && path.length < maxDepth) walk(e.from, [...path, e.key])
      else out.push({ path: [...path, e.key], at: e.at, from: e.from, to: e.to })
    }
  }
  walk(open, [])
  return out
}

// snake_case → camelCase, as graphene and strawberry name a field
export const camel = (s) => s.replace(/_+([a-z0-9])/g, (_, c) => c.toUpperCase())
