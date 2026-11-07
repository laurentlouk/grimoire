// grimoire graph · data · a JSON or YAML file as the extractors read it: its documents, each value
// with the line where each member starts (readers/json-lines.mjs for JSON, readers/yaml.mjs for
// YAML), so a fact cites its line whichever the file's syntax.
//
//   DOC: the files read so (.json, .yaml, .yml, .template)
//   documents(text, file, ctx) → [{ value, lines: Map(pathKey → line), line }]
//     JSON by its extension, a .template by its first character ({ or [ is JSON), the rest YAML,
//     through ctx.yaml(text) (the index's parser, or the base's, parsed aside: data/base.mjs). A
//     leading byte order mark is dropped; JSON nested past json-lines.mjs MAX_DEPTH is refused, and JSON
//     that does not parse says at which line only (parseJson: never a text of the file).
//   at(doc, ...path) → { line }: the member's line, else its nearest ancestor's, else the document's
import { jsonLines, pathKey, parseJson } from './json-lines.mjs'
import { lineAt } from './yaml.mjs'

export const DOC = /\.(?:json|ya?ml|template)$/i

export const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) // a byte order mark is no part of the text

export function documents(text, file, ctx = {}) {
  text = stripBom(text)
  const json = /\.json$/i.test(file) || (/\.template$/i.test(file) && /^\s*[[{]/.test(text))
  if (json) {
    const lines = jsonLines(text) // first: it refuses a text nested past its cap, before JSON.parse walks it
    return [{ value: parseJson(text), lines, line: 1 }] // an error says where, never what the file holds there
  }
  if (typeof ctx.yaml !== 'function') throw new Error('no YAML reader: the pinned YAML grammar did not load')
  return ctx.yaml(text)
}

export const at = (doc, ...path) => ({ line: lineAt(doc.lines, path, doc.line) ?? doc.line })
export { pathKey }
