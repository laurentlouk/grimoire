// grimoire graph · data · the names an ORM derives from a class or an association by convention, never
// guessed past its own rules: Active Record's default inflections (its plural and singular rules, the
// irregular and uncountable words it ships with), its underscore and camelize, and the snake_case the
// Python and Java ORMs name columns by. A project's own inflections (an initializer adding a rule) are
// code and not run: a table a name derived so does not match stays unmatched, and is said so.
const PLURALS = [
  [/$/, 's'], [/s$/i, 's'], [/^(ax|test)is$/i, '$1es'], [/(octop|vir)us$/i, '$1i'], [/(octop|vir)i$/i, '$1i'],
  [/(alias|status)$/i, '$1es'], [/(bu)s$/i, '$1ses'], [/(buffal|tomat)o$/i, '$1oes'], [/([ti])um$/i, '$1a'],
  [/([ti])a$/i, '$1a'], [/sis$/i, 'ses'], [/(?:([^f])fe|([lr])f)$/i, '$1$2ves'], [/(hive)$/i, '$1s'],
  [/([^aeiouy]|qu)y$/i, '$1ies'], [/(x|ch|ss|sh)$/i, '$1es'], [/(matr|vert|ind)(?:ix|ex)$/i, '$1ices'],
  [/^(m|l)ouse$/i, '$1ice'], [/^(m|l)ice$/i, '$1ice'], [/^(ox)$/i, '$1en'], [/^(oxen)$/i, '$1'], [/(quiz)$/i, '$1zes'],
].reverse() // the last rule defined is tried first
const SINGULARS = [
  [/s$/i, ''], [/(ss)$/i, '$1'], [/(n)ews$/i, '$1ews'], [/([ti])a$/i, '$1um'],
  [/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$/i, '$1sis'], [/(^analy)(sis|ses)$/i, '$1sis'],
  [/([^f])ves$/i, '$1fe'], [/(hive)s$/i, '$1'], [/(tive)s$/i, '$1'], [/([lr])ves$/i, '$1f'], [/([^aeiouy]|qu)ies$/i, '$1y'],
  [/(s)eries$/i, '$1eries'], [/(m)ovies$/i, '$1ovie'], [/(x|ch|ss|sh)es$/i, '$1'], [/^(m|l)ice$/i, '$1ouse'],
  [/(bus)(es)?$/i, '$1'], [/(o)es$/i, '$1'], [/(shoe)s$/i, '$1'], [/(cris|test)(is|es)$/i, '$1is'], [/^(a)x[ie]s$/i, '$1xis'],
  [/(octop|vir)(us|i)$/i, '$1us'], [/(alias|status)(es)?$/i, '$1'], [/^(ox)en/i, '$1'], [/(vert|ind)ices$/i, '$1ex'],
  [/(matr)ices$/i, '$1ix'], [/(quiz)zes$/i, '$1'], [/(database)s$/i, '$1'],
].reverse()
const IRREGULAR = [['person', 'people'], ['man', 'men'], ['child', 'children'], ['sex', 'sexes'], ['move', 'moves'], ['zombie', 'zombies']]
const UNCOUNTABLE = ['equipment', 'information', 'rice', 'money', 'species', 'series', 'fish', 'sheep', 'jeans', 'police']
const uncountable = (w) => UNCOUNTABLE.some((u) => new RegExp(`\\b${u}$`, 'i').test(w))
function inflect(word, rules, irregular) {
  const w = String(word)
  if (!w || uncountable(w)) return w
  for (const [from, to] of irregular) {
    const m = new RegExp(`(${from[0]})${from.slice(1)}$`, 'i').exec(w)
    if (m) return w.slice(0, m.index) + m[1] + to.slice(1)
  }
  for (const [re, to] of rules) if (re.test(w)) return w.replace(re, (...g) => to.replace(/\$(\d)/g, (_, i) => g[Number(i)] ?? ''))
  return w
}
export const pluralize = (w) => inflect(w, PLURALS, IRREGULAR.map(([s, p]) => [s, p]).concat(IRREGULAR.map(([, p]) => [p, p])))
export const singularize = (w) => inflect(w, SINGULARS, IRREGULAR.map(([s, p]) => [p, s]).concat(IRREGULAR.map(([s]) => [s, s])))
// `Blog::HTMLPost` → `blog/html_post`
export const underscore = (s) => String(s).replace(/::/g, '/').replace(/([A-Z\d]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase()
// `blog/post_tag` → `Blog::PostTag`
export const camelize = (s) => String(s).split('/').map((p) => p.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join('')).join('::')
export const demodulize = (s) => String(s).split('::').pop()
// Active Record's table for a class name: its last part, underscored, pluralized
export const tableize = (cls) => pluralize(underscore(demodulize(cls)))
// snake_case, as a Python or Java naming strategy writes a column (`createdAt` → `created_at`)
export const snake = (s) => String(s).replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
