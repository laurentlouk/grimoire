// grimoire graph · data · where each member of a JSON text starts, so a fact read from a JSON file
// (a snapshot, a template) cites its line. One linear pass; JSON.parse still reads the values.
//
//   jsonLines(text) → Map(key → line), key = pathKey('tables', 'books', 'columns', 'id') for an
//   object member (the line of its key), pathKey('ddl', 3) for an array element (where it starts).
export const pathKey = (...path) => path.join('\u0000')

export function jsonLines(text) {
  const out = new Map()
  const frames = [] // one per open container: { arr, slot } — slot: the current member's key or index
  const path = () => frames.map((f) => f.slot)
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
      if (top && !top.arr && expectKey) { top.slot = JSON.parse(text.slice(i, j + 1)); out.set(pathKey(...path()), line); expectKey = false }
      else if (top && top.arr) out.set(pathKey(...path()), line)
      i = j
      continue
    }
    // a value starts here: an array element's line, then into it when it is a container
    if (top && top.arr) out.set(pathKey(...path()), line)
    if (c === '{') { frames.push({ arr: false, slot: null }); expectKey = true; continue }
    if (c === '[') { frames.push({ arr: true, slot: 0 }); continue }
    while (i + 1 < n && !/[\s,\]}]/.test(text[i + 1])) i++ // a number, true, false or null
  }
  return out
}
