// grimoire · economy · loopguard · shell-edits: the files a shell command writes, which an edit-tool
// counter does not see (`sed -i`, `perl -pi`, a redirect or `tee` into a source file, an inline Python
// script that writes the file back, `patch` / `git apply`, `apply_patch` fed a patch on stdin,
// `git checkout -- <file>`). Output captures and scratch paths are not edits.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/loopguard/shell_edits.py (commit 1deb887,
// Apache-2.0), with Python's shlex in non-POSIX punctuation mode (`tokens` below) ported alongside so
// quoting reads the same. One difference: a `#` inside a word ends it and comments out the rest of the
// line, where shlex glues the word to the next line's first one.
import { basename } from './state.mjs'

const HEREDOC_START = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/
const OPS = new Set(['&&', '||', ';', ';;', '|', '|&', '&', '\n', '(', ')'])
const OUT = new Set(['>', '>>', '>|', '&>', '&>>']) // redirects that write their operand
const SKIP_OPERAND = new Set(['<', '<<', '<<<', '<&', '>&', '<>']) // input, heredoc tags, fd duplication
// Redirect and `tee` targets count only when they look like source: `> out.log` captures output.
const SOURCE_FILE = /\.(?:py|pyi|pyx|pxd|js|jsx|mjs|cjs|ts|tsx|rs|go|java|kt|kts|scala|c|cc|cpp|cxx|h|hh|hpp|rb|php|cs|swift|m|mm|sh|bash|zsh|lua|jl|ex|exs|erl|hs|ml|clj|sql|toml|ya?ml|json|cfg|ini|conf|md|rst|html?|css|scss|vue|svelte|xml|gradle|properties|in)$/i
const PYTHON = /(?:^|[\s/;&|(])python\d?(?:\.\d+)?\b/
const PY_OPEN_LIT = /open\(\s*(['"])([^'"\n]+)\1\s*,\s*(['"])([^'"]*)\3/g
const PY_OPEN_VAR = /open\(\s*([A-Za-z_]\w*)\s*,\s*(['"])([^'"]*)\2/g
const PY_WRITE_PATH_LIT = /(?:pathlib\.)?Path\(\s*(['"])([^'"\n]+)\1\s*\)\.write_(?:text|bytes)\(/g
const PY_WRITE_PATH_VAR = /\b([A-Za-z_]\w*)\.write_(?:text|bytes)\(/g
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const notScratch = (p) => !!p && !/^\/(?:dev|proc|tmp)\//.test(p)
const unquote = (t) => (t.length >= 2 && t[0] === t[t.length - 1] && (t[0] === "'" || t[0] === '"') ? t.slice(1, -1) : t)

function splitHeredocs(cmd) {
  const shell = [], bodies = []
  let tag = null, body = []
  for (const line of cmd.split('\n')) {
    if (tag !== null) {
      if (line.trim() === tag) { bodies.push(body.join('\n')); tag = null; body = [] } else body.push(line)
      continue
    }
    shell.push(line)
    const m = HEREDOC_START.exec(line)
    if (m) tag = m[2]
  }
  if (tag !== null) bodies.push(body.join('\n'))
  return [shell.join('\n'), bodies]
}

/**
 * Shell words and operators, as Python's `shlex.shlex(text, posix=False, punctuation_chars="();<>|&\n")`
 * with whitespace " \t\r" and whitespace_split: a run of punctuation is one token, a quoted word
 * keeps its quotes and ends at its closing quote, `#` starts a comment to the end of the line.
 * Throws on an unbalanced quote.
 */
export function tokens(text) {
  const PUNCT = '();<>|&\n', WS = ' \t\r', QUOTES = `'"`
  const out = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (WS.includes(c)) { i++; continue }
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; i++; continue } // the newline goes with the comment
    if (PUNCT.includes(c)) { let j = i; while (j < text.length && PUNCT.includes(text[j])) j++; out.push(text.slice(i, j)); i = j; continue }
    if (QUOTES.includes(c)) {
      const end = text.indexOf(c, i + 1)
      if (end < 0) throw new Error('No closing quotation')
      out.push(text.slice(i, end + 1)); i = end + 1; continue
    }
    let j = i
    while (j < text.length && !WS.includes(text[j]) && !PUNCT.includes(text[j]) && text[j] !== '#') j++
    out.push(text.slice(i, j)); i = j
  }
  return out
}

function commands(shell) {
  let streams
  try { streams = [tokens(shell)] } catch {
    streams = [] // one bad line must not hide the others
    for (const line of shell.split('\n')) { try { streams.push([...tokens(line), '\n']) } catch {} }
  }
  const cmds = [], writes = []
  for (const toks of streams) {
    let cur = []
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (OPS.has(t)) { if (cur.length) cmds.push(cur); cur = [] }
      else if (OUT.has(t) || SKIP_OPERAND.has(t)) {
        if (cur.length && /^\d+$/.test(cur[cur.length - 1])) cur.pop() // `2>`: the fd number is no operand
        if (OUT.has(t) && i + 1 < toks.length && !OPS.has(toks[i + 1])) writes.push(unquote(toks[i + 1]))
        i++
      } else cur.push(unquote(t))
    }
    if (cur.length) cmds.push(cur)
  }
  return [cmds, writes]
}

// File operands of an in-place editor (`sed -i`, `perl -pi`), or [] when it does not edit in place.
function inplaceFiles(toks, inplaceFlag, scriptFlag) {
  if (!toks.slice(1).some(inplaceFlag)) return []
  const files = []
  let haveScript = false, skip = false
  for (const t of toks.slice(1)) {
    if (skip) { skip = false; haveScript = true; continue }
    if (!t || t.startsWith('-')) { if (t && scriptFlag(t)) skip = true; continue }
    if (!haveScript) { haveScript = true; continue } // the first operand is the script
    files.push(t)
  }
  return files
}

// The paths an inline Python script writes; "(script)" for a write whose path cannot be resolved.
function pyWrites(text) {
  const out = []
  for (const m of text.matchAll(PY_OPEN_LIT)) if (/[wax+]/.test(m[4])) out.push(m[2])
  const vars = [...text.matchAll(PY_OPEN_VAR)].filter((m) => /[wax+]/.test(m[3])).map((m) => m[1])
  for (const m of text.matchAll(PY_WRITE_PATH_LIT)) out.push(m[2])
  vars.push(...[...text.matchAll(PY_WRITE_PATH_VAR)].map((m) => m[1]))
  for (const v of [...new Set(vars)]) {
    const found = [...text.matchAll(new RegExp(`\\b${esc(v)}\\s*=\\s*(?:(?:pathlib\\.)?Path\\(\\s*)?(['"])([^'"\\n]+)\\1`, 'g'))].map((m) => m[2])
    const loop = new RegExp(`\\bfor\\s+${esc(v)}\\s+in\\s+[\\[(]([^\\])]*)[\\])]`).exec(text)
    if (loop) found.push(...[...loop[1].matchAll(/['"]([^'"\n]+)['"]/g)].map((m) => m[1]))
    out.push(...(found.length ? found : ['(script)']))
  }
  return out
}

/** The basenames of the files a shell command writes, in order, without repeats. */
export function shellEditTargets(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) return []
  const [shell, bodies] = splitHeredocs(cmd)
  const [cmds, writes] = commands(shell)
  const found = writes.filter((w) => SOURCE_FILE.test(w))
  for (let toks of cmds) {
    while (toks.length && (['sudo', 'command', 'env', 'time', 'nohup'].includes(toks[0]) || /^\w+=/.test(toks[0]))) toks = toks.slice(1)
    if (!toks.length) continue
    const head = toks[0].split('/').pop()
    if (head === 'sed') found.push(...inplaceFiles(toks, (t) => /^(?:-[a-zA-Z]*i|--in-place)/.test(t), (t) => ['-e', '-f', '--expression', '--file'].includes(t)))
    else if (head === 'perl') found.push(...inplaceFiles(toks, (t) => /^-[a-zA-Z]*i/.test(t), (t) => /^-[a-zA-Z]*e$/.test(t)))
    else if (head === 'tee') found.push(...toks.slice(1).filter((t) => !t.startsWith('-') && SOURCE_FILE.test(t)))
    else if (head === 'apply_patch') {
      const named = [...[...bodies, toks.slice(1).join(' ')].join('\n').matchAll(PATCH_FILE)].map((m) => m[1])
      found.push(...(named.length ? named : ['(patch)']))
    } else if (head === 'patch' || (head === 'git' && toks[1] === 'apply')) found.push('(patch)')
    else if (head === 'git' && toks.length > 2 && (toks[1] === 'checkout' || toks[1] === 'restore')) {
      const rest = toks.includes('--') ? toks.slice(toks.indexOf('--') + 1) : toks[1] === 'restore' ? toks.slice(2) : []
      found.push(...rest.filter((t) => !t.startsWith('-')))
    }
  }
  if (PYTHON.test(shell)) found.push(...pyWrites([shell, ...bodies].join('\n')))
  const names = found.filter((p) => p.startsWith('(') || notScratch(p)).map((p) => (p.startsWith('(') ? p : basename(p)))
  return [...new Set(names.filter(Boolean))]
}
