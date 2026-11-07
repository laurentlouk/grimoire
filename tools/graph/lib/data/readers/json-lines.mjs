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
      if (top && !top.arr && expectKey) { top.slot = JSON.parse(text.slice(i, j + 1)); out.set(keyOf(top), line); expectKey = false }
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
