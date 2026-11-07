// grimoire graph · data · where each member of a JSON text starts, so a fact read from a JSON file
// (a snapshot, a template) cites its line. One linear pass; JSON.parse still reads the values.
//
//   jsonLines(text) → Map(key → line), key = pathKey('tables', 'books', 'columns', 'id') for an
//   object member (the line of its key), pathKey('ddl', 3) for an array element (where it starts).
// Each container keeps its own key, so a member's key is built once from its parent's (linear in the
// text, not in its depth). A text nested deeper than MAX_DEPTH is refused (an error the caller
// catches): no table declaration nests so, and a key per level would grow with the depth.
export const pathKey = (...path) => path.join('\u0000')
export const MAX_DEPTH = 200

export function jsonLines(text) {
  const out = new Map()
  const frames = [] // one per open container: { arr, slot, key } — slot: the current member's key or index; key: the container's own
  const keyOf = (f) => (f.key === null ? String(f.slot) : `${f.key}\u0000${f.slot}`)
  let line = 1, expectKey = false
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = text[i]
    if (c === '\n') { line++; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === ':') continue
    const top = frames[frames.length - 1]
    if (c === ',') { if (top && top.arr) top.slot++; else expectKey = true; continue }
    if (c === '}' || c === ']') { frames.pop(); expectKey = false; continue }
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      if (top && !top.arr && expectKey) {
        try { top.slot = JSON.parse(text.slice(i, j + 1)) } catch { throw new Error(`not valid JSON at line ${line}`) } // never the engine's message: it quotes the text
        out.set(keyOf(top), line); expectKey = false
      }
      else if (top && top.arr) out.set(keyOf(top), line)
      i = j
      continue
    }
    // a value starts here: an array element's line, then into it when it is a container
    if (top && top.arr) out.set(keyOf(top), line)
    if (c === '{' || c === '[') {
      if (frames.length >= MAX_DEPTH) throw new Error(`the JSON nests deeper than ${MAX_DEPTH} levels at line ${line}: not read`)
      frames.push({ arr: c === '[', slot: c === '[' ? 0 : null, key: top ? keyOf(top) : null })
      expectKey = c === '{'
      continue
    }
    while (i + 1 < n && !/[\s,\]}]/.test(text[i + 1])) i++ // a number, true, false or null
  }
  return out
}

// A JSON text read, or an error that says only where it breaks: "not valid JSON at line N". The
// engine's own message quotes the characters around the error, and a file may hold a secret there,
// so no text of the file is ever in the error (it is stored with the job, shown by graph_data and
// graph_status). A text nested past MAX_DEPTH is refused first, as jsonLines refuses it.
export function parseJson(text) {
  const deep = deeperThan(text, MAX_DEPTH)
  if (deep >= 0) throw new Error(`the JSON nests deeper than ${MAX_DEPTH} levels at line ${lineOfOffset(text, deep)}: not read`)
  try { return JSON.parse(text) } catch {
    const at = jsonErrorAt(text)
    throw new Error(at < 0 ? 'not valid JSON' : `not valid JSON at line ${lineOfOffset(text, at)}`)
  }
}
export const lineOfOffset = (text, at) => { let n = 1; for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) n++; return n }
// where brackets outside strings first nest deeper than max, or -1 (one pass)
export function deeperThan(t, max) {
  let d = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '"') { i++; while (i < t.length && t[i] !== '"') i += t[i] === '\\' ? 2 : 1; continue }
    if (c === '[' || c === '{') { if (++d > max) return i } else if (c === ']' || c === '}') d--
  }
  return -1
}
// Where a text stops being JSON (RFC 8259): its offset, or -1. One pass, no recursion.
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const HEX4 = /[0-9a-fA-F]{4}/y
export function jsonErrorAt(t) {
  const n = t.length, stack = []
  let i = 0, state = 'value'
  const ws = () => { while (i < n && (t[i] === ' ' || t[i] === '\t' || t[i] === '\n' || t[i] === '\r')) i++ }
  const str = () => { // at a quote: true when the string closes, i past it
    i++
    while (i < n) {
      const c = t.charCodeAt(i)
      if (c === 34) { i++; return true }
      if (c < 32) return false
      if (c === 92) {
        const e = t[i + 1]
        if (e && '"\\/bfnrt'.includes(e)) { i += 2; continue }
        HEX4.lastIndex = i + 2
        if (e === 'u' && HEX4.test(t)) { i += 6; continue }
        return false
      }
      i++
    }
    return false
  }
  for (;;) {
    ws()
    if (state === 'value') {
      if (i >= n) return i
      const c = t[i]
      if (c === '{' || c === '[') {
        stack.push(c); i++; ws()
        if (t[i] === (c === '{' ? '}' : ']')) { stack.pop(); i++; state = 'after' } else state = c === '{' ? 'key' : 'value'
        continue
      }
      if (c === '"') { const s = i; if (!str()) return s; state = 'after'; continue }
      if (t.startsWith('true', i) || t.startsWith('null', i)) { i += 4; state = 'after'; continue }
      if (t.startsWith('false', i)) { i += 5; state = 'after'; continue }
      NUM.lastIndex = i
      if (NUM.test(t)) { i = NUM.lastIndex; state = 'after'; continue }
      return i
    }
    if (state === 'key') {
      const s = i
      if (t[i] !== '"' || !str()) return s
      ws()
      if (t[i] !== ':') return i
      i++; state = 'value'; continue
    }
    // after a value: a comma, its container's close, or the end of the text
    if (!stack.length) return i < n ? i : -1
    const top = stack[stack.length - 1], c = t[i]
    if (c === ',') { i++; state = top === '{' ? 'key' : 'value'; continue }
    if (c === (top === '{' ? '}' : ']')) { stack.pop(); i++; continue }
    return i
  }
}
