// grimoire graph · data · a JSON or YAML file as the extractors read it: its documents, each value
// with the line where each member starts (readers/json-lines.mjs for JSON, readers/yaml.mjs for
// YAML), so a fact cites its line whichever the file's syntax.
//
//   DOC: the files read so (.json, .yaml, .yml, .template)
//   documents(text, file, ctx) → [{ value, lines: Map(pathKey → line), line }]
//     JSON by its extension, a .template by its first character ({ or [ is JSON), the rest YAML,
//     through ctx.yaml(text) (the index's parser, or the base's, parsed aside: data/base.mjs).
//   at(doc, ...path) → { line }: the member's line, else its nearest ancestor's, else the document's
import { jsonLines, pathKey } from './json-lines.mjs'
import { lineAt } from './yaml.mjs'

export const DOC = /\.(?:json|ya?ml|template)$/i

export function documents(text, file, ctx = {}) {
  const json = /\.json$/i.test(file) || (/\.template$/i.test(file) && /^\s*[[{]/.test(text))
  if (json) {
    let value
    try { value = JSON.parse(text) } catch (e) { throw new Error(`not JSON: ${String(e.message).split('\n')[0]}`) }
    return [{ value, lines: jsonLines(text), line: 1 }]
  }
  if (typeof ctx.yaml !== 'function') throw new Error('no YAML reader here: the parser runtime is not installed')
  return ctx.yaml(text)
}

export const at = (doc, ...path) => ({ line: lineAt(doc.lines, path, doc.line) ?? doc.line })
export { pathKey }
