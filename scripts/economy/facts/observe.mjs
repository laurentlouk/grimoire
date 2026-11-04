// grimoire · economy · facts · observe: what a finished dispatch or session shows about its
// environment. Each shell command is split into segments, and each segment is classified by INTENT
// (run the interpreter, run the tests, build or check, use the package tool, fetch from a host, probe
// the VCS) and FORM (how it was spelled: `python -m pytest`, `/opt/env/bin/python -m pytest`,
// `cd tests && python runtests.py`). Its outcome is read off the output as an environmental error
// class (`module_missing`, `command_missing`, `connection_refused`, ...) or a sign that tests ran.
// Nothing here names a path, a repository or a harness: the words that name intents are a
// vocabulary, and `observeCalls` returns everything the fact families need from one session.
//
// Ported from microsoft/TokenEconomizer, tokeneconomizer/microskills/observe.py (commit 1deb887,
// Apache-2.0), with `strip_rtk_prefix` from tokeneconomizer/trace/calls.py. Left out: the
// experiments' narrower vocabularies (PYTHON_GIT, NODE_WEB) — the plugin reads every repository with
// GENERIC, so builds and checks are an intent of their own and every edited file counts — and the
// transcript loaders: the input is grimoire's call list (`transcript.mjs` `readTranscript().calls`),
// where Claude Code records each call's directory. Windows drive spellings are compared as the source
// does, only when the platform's separator is a backslash.
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { editedFiles } from './lifecycle.mjs'

const set = (...xs) => new Set(xs)
const union = (...ss) => new Set(ss.flatMap((s) => [...s]))

// ---- the vocabulary: what counts as an interpreter, a runner, a package tool, a fetcher, a probe ----
const PY_INTERPRETERS = set('python', 'python2', 'python3', 'pypy', 'pypy3')
const NODE_INTERPRETERS = set('node', 'nodejs', 'deno', 'bun', 'tsx', 'ts-node')
const PY_RUNNERS = set('pytest', 'py.test', 'tox', 'nox', 'nosetests', 'trial')
const NODE_RUNNERS = set('jest', 'vitest', 'mocha', 'playwright', 'cypress', 'ava', 'karma')
const PY_PACKAGE = set('pip', 'pip3', 'conda', 'mamba', 'poetry', 'pipenv', 'uv', 'apt', 'apt-get')
const NODE_PACKAGE = set('npm', 'yarn', 'pnpm', 'corepack', 'apt', 'apt-get')

/** The plugin's vocabulary: every ecosystem at once, since a repository a person works in may mix them. */
export const GENERIC = Object.freeze({
  name: 'generic',
  interpreters: union(PY_INTERPRETERS, NODE_INTERPRETERS, set('ruby', 'perl', 'php', 'Rscript', 'julia', 'lua', 'elixir')),
  canonicalInterpreter: 'python', // how a shebang-run script is spelled as a form
  runnerHeads: union(PY_RUNNERS, NODE_RUNNERS, set('rspec', 'phpunit', 'ctest', 'bats')),
  runnerScripts: ['runtests.py', 'bin/test', 'bin/doctest', 'manage.py'], // scripts that ARE the runner when an interpreter runs them
  runnerModules: set('pytest', 'unittest', 'nose', 'django', 'tox', 'nox'), // `<interpreter> -m <module>` runners
  packageTools: union(PY_PACKAGE, NODE_PACKAGE, set('gem', 'bundle', 'composer', 'cargo', 'go', 'mvn', 'gradle', 'dotnet', 'brew', 'rustup', 'pyenv', 'nvm', 'asdf')),
  fetchHeads: set('curl', 'wget'),
  envProbeHeads: set('which', 'command', 'type', 'whereis'),
  // tools whose `<tool> test` runs the tests
  taskHeads: set('make', 'npm', 'yarn', 'pnpm', 'cargo', 'go', 'mvn', 'gradle', 'gradlew', 'dotnet', 'mix', 'swift', 'rake'),
  // executables that build, compile, lint or type-check (the `run_build` intent)
  buildHeads: set('make', 'cmake', 'ninja', 'bazel', 'tsc', 'eslint', 'prettier', 'ruff', 'flake8', 'pylint', 'mypy', 'pyright', 'black', 'isort', 'golangci-lint', 'gcc', 'g++', 'clang', 'javac', 'webpack', 'vite'),
})
// `<tool> build`, `npm run lint`, ...: what counts as building or checking
const BUILD_SUBS = set('build', 'check', 'compile', 'lint', 'vet', 'typecheck', 'type-check', 'clippy', 'package', 'verify', 'fmt', 'format')
const RUN_SCRIPT_HEADS = set('npm', 'yarn', 'pnpm', 'bun')
const GIT_FETCH_SUBS = set('fetch', 'clone', 'pull', 'ls-remote')
const GIT_PROBE_SUBS = set('remote', 'branch', 'tag', 'fsck', 'stash', 'show-ref', 'for-each-ref')
const PREFIX_HEADS = set('sudo', 'env', 'time', 'exec', 'nice', 'nohup', 'timeout')
// segments that neither add evidence nor rewrite the output a call returns
const PASSTHROUGH = set('cd', 'echo', 'head', 'tail', 'cat', 'sort', 'uniq', 'tee', 'true', 'printf', 'less', 'more')
const RUN_INTENTS = set('run_interpreter', 'run_tests', 'run_build', 'package_tool', 'fetch_remote')

const ACTIVATE_RE = /^(?:source|\.)\s+\S*activate\s+([\w.-]+)\s*$/
const CD_RE = /^cd\s+(['"]?)([^\s;&|'"]+)\1\s*$/
const CD_FAILED_RE = /\bcd: [^\n]*: (?:No such file or directory|Not a directory)/
const CONDA_ACTIVATE_RE = /^(?:conda|mamba)\s+activate\s+([\w.-]+)\s*$/
const CONDA_RUN_RE = /^(?:conda|mamba)\s+run\s+(?:--no-capture-output\s+|--live-stream\s+)*(?:-n|--name)\s+([\w.-]+)\s+/
const TOOL_RUN_RE = /^(poetry|pipenv|uv|npx|bundle|yarn|pnpm)\s+(?:run|exec)\s+/
const NPX_RE = /^npx\s+(?:(?:--yes|-y|--no-install|--no)\s+)*/
const INTERP_VERSIONED_RE = /^(?:python|node)\d(?:\.\d+)?$/
const ENV_ASSIGN_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/
const ASSIGN_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/
const WRAP_RE = /^\/bin\/(?:ba)?sh\s+-l?c\s+([\s\S]*)$/
const HEREDOC_RE = /<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g
const URL_HOST_RE = /https?:\/\/([^/\s'"`]+)/g
// rtk rewrites `cmd` to `rtk cmd` or `rtk proxy cmd`; a bare `rtk`, or a word that merely starts with
// the letters, is not the wrapper (the source's one definition, so classifiers cannot disagree)
const RTK_PREFIX_RE = /^rtk\s+(?:proxy\s+)?(?=\S)/

// Error classes an ENVIRONMENT produces (as opposed to the code under test). Order matters: the first
// match names the class.
const ERROR_CLASSES = [
  ['module_missing', /ModuleNotFoundError|No module named|Cannot find module|ERR_MODULE_NOT_FOUND/i],
  ['command_missing', /command not found|: not found\b|is not recognized/i],
  // the interpreter started, but the script it was told to run is not where it looked
  ['script_missing', /can't open file .*No such file or directory/i],
  ['permission_denied', /Permission denied|EACCES/i],
  ['usage_error', /^usage:|unrecognized arguments|no such option|error: argument|unknown option/im],
  ['connection_refused', /Connection refused|Failed to connect to|couldn't connect to|Could not connect|ECONNREFUSED/i],
  ['name_resolution', /Could not resolve host|Temporary failure in name resolution|Name or service not known|getaddrinfo|nodename nor servname|ENOTFOUND/i],
  ['unreachable', /Network is unreachable|No route to host|Connection timed out|Operation timed out|timed out after|ETIMEDOUT/i],
]
const ERROR_RX = new Map(ERROR_CLASSES)
export const NETWORK_ERRORS = set('connection_refused', 'name_resolution', 'unreachable')
export const FORM_ERRORS = set('module_missing', 'command_missing', 'script_missing', 'usage_error', 'permission_denied')

// What "the probe returned something" looks like, per VCS probe kind. Deliberately narrow, so the
// output of an unrelated segment in a compound command cannot masquerade as a hit.
const PROBE_HIT = {
  remote: /^\S+\s+\S+\s+\((?:fetch|push)\)\s*$/m,
  branch: /^\s*remotes\/\S+/m,
  tag: /^v?\d+(?:\.\d+)+(?:[a-z]+\d*|\.post\d+|-\S+)?\s*$/m,
  fsck: /^(?:unreachable|dangling)\s+(?:commit|tree|blob|tag)\s+[0-9a-f]{7,}/m,
  stash: /^stash@\{\d+\}/m,
  refs: /^[0-9a-f]{7,}\s+refs\//m,
}

const words = (s) => String(s).split(/\s+/).filter(Boolean) // Python's str.split()
const lstripDotSlash = (s) => s.replace(/^[./]+/, '') // Python's s.lstrip("./")
const tail = (p) => p.split('/').pop() // the last path component of an executable
// a URL's host, never its userinfo: `https://x-access-token:<token>@github.com/…` is github.com
const hostsOf = (s) => [...s.matchAll(URL_HOST_RE)].map((m) => m[1].replace(/^[^@]*@/, '')).filter(Boolean)
const stripParens = (s) => s.trim().replace(/^[()]+|[()]+$/g, '').trim()

/** `rtk pytest -q` → `pytest -q`; anything else unchanged. */
export const stripRtkPrefix = (command) => String(command ?? '').trimStart().replace(RTK_PREFIX_RE, '')

/** Strip an agent's `/bin/bash -lc "<cmd>"` wrapper, if present. */
export function unwrap(cmd) {
  cmd = cmd || ''
  const m = WRAP_RE.exec(cmd.trim())
  if (!m) return cmd
  let inner = m[1].trim()
  if (inner.length >= 2 && inner[0] === inner[inner.length - 1] && (inner[0] === '"' || inner[0] === "'")) {
    const q = inner[0]
    inner = inner.slice(1, -1)
    if (q === '"') inner = inner.replaceAll('\\"', '"').replaceAll('\\$', '$').replaceAll('\\\\', '\\')
  }
  return inner
}

/** Simple segments of a shell command, split on && || ; | and newlines outside quotes. Heredoc bodies
 * are elided first, so their contents are never mistaken for commands. */
export function segments(cmd) {
  cmd = (cmd || '').replace(HEREDOC_RE, (m) => `${m.split('\n', 1)[0]} <heredoc>`)
  const out = []
  let buf = '', q = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) {
      buf += c
      if (c === q) q = null
      else if (c === '\\' && i + 1 < cmd.length) { buf += cmd[i + 1]; i++ }
    } else if (c === '"' || c === "'") { q = c; buf += c }
    else if (c === '\n' || c === ';' || c === '|' || (c === '&' && cmd.slice(i, i + 2) === '&&')) {
      out.push(buf); buf = ''
      if (cmd.slice(i, i + 2) === '&&' || cmd.slice(i, i + 2) === '||') i++
    } else buf += c
  }
  out.push(buf)
  return out.map(stripParens).filter(Boolean)
}

const observation = (call, intent, form, head, prefix, segment, hosts = [], probe = null) => ({
  call, intent, form, head, prefix, segment, hosts: [...hosts], probe, outcome: null,
  labels: [], labelErr: false, loaded: false, testsRan: false,
  env: false, // typed with `VAR=value` before it, which its form leaves out
})

/** The repository a directory belongs to: the nearest directory at or above `start` that holds a
 * `.git` (a directory, or a worktree's file); null when there is none on disk, or `start` itself is
 * gone (a removed checkout must not borrow an enclosing repository). */
export function repositoryTop(start) {
  if (!start || !path.isAbsolute(start)) return null
  try { if (!statSync(start).isDirectory()) return null } catch { return null }
  let d = normpath(path.normalize(start))
  for (;;) {
    if (existsSync(path.join(d, '.git'))) return d
    const up = path.dirname(d)
    if (up === d) return null
    d = up
  }
}

// posixpath.normpath: `path.posix.normalize` also keeps a trailing slash, which normpath drops
function normpath(p) {
  const n = path.posix.normalize(p)
  return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n
}

const DRIVE_RE = /^\/([A-Za-z])(?=\/|$)|^([A-Za-z]):(?=\/|$)/
// `p` with forward slashes and a Windows drive spelled `c:`; a POSIX path is returned as it is
function shellPath(p) {
  if (path.sep !== '\\') return p
  p = p.replaceAll('\\', '/')
  const m = DRIVE_RE.exec(p)
  return m ? (m[1] || m[2]).toLowerCase() + ':' + p.slice(m[0].length) : p
}
const shellIsAbs = (p) => p.startsWith('/') || (path.sep === '\\' && /^[a-z]:(\/|$)/.test(p))

/** Where `cd target` from `cur` lands, relative to the directory the session started in ('' for that
 * directory itself); null when it leaves it or cannot be told (`~`, `$VAR`, `-`, an absolute path
 * with no known start). A session started in a subdirectory of its repository (`top`) that changes up
 * to the repository's top runs what a session started there runs: `cd <top> && pytest` is the plain
 * `pytest`, not a form spelled with one machine's path. Any other directory above the start is taken
 * as typed. */
export function cdTarget(cur, target, root = null, top = null) {
  if (!target || '~$-'.includes(target[0])) return null
  target = shellPath(target)
  cur = shellPath(cur || '.')
  let rel
  if (shellIsAbs(target)) {
    if (!root) return null
    rel = path.posix.relative(normpath(shellPath(root)), normpath(target)) || '.'
  } else rel = normpath(path.posix.join(cur, target))
  if (rel === '.') return ''
  if (rel === '..' || rel.startsWith('../')) {
    if (!(top && root)) return null
    const at = normpath(path.posix.join(shellPath(root), rel))
    return at === normpath(shellPath(top)) ? '' : null
  }
  return rel
}

/**
 * Observations for one shell command (possibly compound). A `cd` and an activation carry across the
 * segments of one command: `source activate X && python ...` is one form, and so is `cd tests &&
 * python runtests.py`. `cwd` is the directory the command started in, relative to the one the session
 * started in (`root`, absolute when known): a shell that keeps its directory between calls runs a bare
 * `python runtests.py` in `tests/` after an earlier `cd tests`. `top` is the repository `root` lies in
 * (`repositoryTop`). Prefixes that do not change what runs are stripped first: rtk (`rtk `,
 * `rtk proxy `), `VAR=value` (recorded as `env`), `sudo`, `env`, `time`, `exec`, `nice`, `nohup`,
 * `timeout N`.
 */
export function classifyCommand(cmd, { call = 0, cwd = '', root = null, top = null } = {}) {
  const vocab = GENERIC
  const obs = []
  let carried = ''
  let here = cwd || ''
  let cd = here ? `cd ${here} &&` : ''
  for (let seg of segments(unwrap(cmd))) {
    // Transparent wrappers first: `K=V rtk pytest`, `rtk K=V pytest` and `rtk proxy pytest` are all a
    // pytest run; a first-token vocabulary that did not remove them would form no fact at all.
    const typed = seg.trim()
    seg = typed.replace(ENV_ASSIGN_RE, '').trim()
    let assigned = seg !== typed
    const unwrapped = stripRtkPrefix(seg).trim()
    seg = unwrapped.replace(ENV_ASSIGN_RE, '').trim()
    assigned = assigned || seg !== unwrapped
    if (!seg) continue
    // A directory change is part of how the rest of the command runs: carried, as an activation is.
    let m = CD_RE.exec(seg)
    if (m) {
      const there = here !== null ? cdTarget(here, m[2], root, top) : null
      if (there === null) { here = null; cd = `cd ${m[2]} &&` } else { here = there; cd = there ? `cd ${there} &&` : '' }
      continue
    }
    m = ACTIVATE_RE.exec(seg) || CONDA_ACTIVATE_RE.exec(seg)
    if (m) {
      carried = seg.startsWith('conda') || seg.startsWith('mamba') ? `conda activate ${m[1]} &&` : `source activate ${m[1]} &&`
      continue
    }
    let prefix = [cd, carried].filter(Boolean).join(' ')
    let body = seg
    const addPrefix = (p) => { prefix = (prefix ? prefix + ' ' : '') + p }
    m = CONDA_RUN_RE.exec(body)
    if (m) { addPrefix(`conda run -n ${m[1]}`); body = body.slice(m[0].length) }
    m = TOOL_RUN_RE.exec(body)
    if (m) { addPrefix(`${m[1]} run`); body = body.slice(m[0].length) } else {
      m = NPX_RE.exec(body)
      if (m && m[0].length > 0) { addPrefix('npx'); body = body.slice(m[0].length) }
    }
    let toks = words(body)
    while (toks.length && (PREFIX_HEADS.has(toks[0]) || ASSIGN_TOKEN_RE.test(toks[0]))) {
      if (ASSIGN_TOKEN_RE.test(toks[0])) { assigned = true; toks = toks.slice(1) } // `env VAR=value cmd`
      else toks = toks.slice(toks[0] === 'timeout' ? 2 : 1) // `timeout N` consumes its argument
    }
    if (!toks.length) continue
    const head = toks[0]
    const o = classify(head, tail(head), toks.slice(1), body, prefix, seg, call, vocab)
    if (o) { o.env = assigned; obs.push(o) }
  }
  return obs
}

function runnerScript(rest, vocab) {
  for (const t of rest) {
    if (t.startsWith('-')) continue
    for (const s of vocab.runnerScripts) if (t === s || t.endsWith('/' + s) || t.endsWith(s)) return t.startsWith('./') ? lstripDotSlash(t) : t
    return null
  }
  return null
}

function classify(head, base, rest, body, prefix, seg, call, vocab) {
  const form = (expr) => (prefix ? `${prefix} ${expr}`.trim() : expr)
  const obs = (intent, f, extra = []) => observation(call, intent, f, head, prefix, seg, ...extra)
  if (vocab.interpreters.has(base) || INTERP_VERSIONED_RE.test(base)) {
    if (rest.length && rest.every((t) => ['--version', '-V', '-VV', '-v'].includes(t))) return obs('probe_env', form(head))
    const mi = rest.indexOf('-m')
    if (mi >= 0) {
      const mod = mi + 1 < rest.length ? rest[mi + 1] : ''
      if (vocab.runnerModules.has(mod)) return obs('run_tests', form(`${head} -m ${mod}`))
    }
    const script = runnerScript(rest, vocab)
    if (script && (script !== 'manage.py' || rest.includes('test'))) return obs('run_tests', form(`${head} ${script}`))
    return obs('run_interpreter', form(head))
  }
  if (vocab.runnerHeads.has(base)) return obs('run_tests', form(head))
  for (const s of vocab.runnerScripts) {
    if (head === s || head.endsWith('/' + s) || head === './' + s) {
      if (s === 'manage.py' && !rest.includes('test')) break
      // a script run through its shebang is the interpreter running it: `./tests/runtests.py` and
      // `python tests/runtests.py` pool
      return obs('run_tests', form(`${vocab.canonicalInterpreter} ${lstripDotSlash(head)}`))
    }
  }
  if (vocab.taskHeads.has(base) && rest[0] === 'test') return obs('run_tests', form(`${base} test`))
  if (RUN_SCRIPT_HEADS.has(base) && rest.length > 1 && rest[0] === 'run') {
    const script = rest[1]
    const kind = script.split(':', 1)[0]
    if (kind === 'test') return obs('run_tests', form(`${base} run ${script}`))
    if (BUILD_SUBS.has(kind)) return obs('run_build', form(`${base} run ${script}`))
  }
  if (vocab.taskHeads.has(base) && rest.length && BUILD_SUBS.has(rest[0])) return obs('run_build', form(`${base} ${rest[0]}`))
  if (vocab.buildHeads.has(base)) return obs('run_build', form(base))
  if (vocab.envProbeHeads.has(base)) return obs('probe_env', form(base))
  if (vocab.fetchHeads.has(base)) return obs('fetch_remote', form(base), [hostsOf(body)])
  if (base === 'git' && rest.length) {
    const sub = rest[0]
    if (GIT_FETCH_SUBS.has(sub)) return obs('fetch_remote', form(`git ${sub}`), [hostsOf(body)])
    if (GIT_PROBE_SUBS.has(sub)) {
      const kind = probeKind(sub, rest.slice(1))
      if (kind) return obs('probe_vcs_refs', form(`git ${sub}`), [[], kind])
    }
    return null
  }
  if (vocab.packageTools.has(base)) {
    if (/^(?:pip|npm|yarn|pnpm)/.test(base) && ['install', 'download', 'add', 'ci'].includes(rest[0])) return obs('fetch_remote', form(`${base} ${rest[0]}`), [hostsOf(body)])
    return obs('package_tool', form(base))
  }
  return null
}

function probeKind(sub, args) {
  const a = new Set(args)
  if (sub === 'remote') return 'remote'
  if (sub === 'branch' && ['-a', '-r', '--all', '--remotes', '-ar', '-ra'].some((x) => a.has(x))) return 'branch'
  if (sub === 'tag' && a.has('--contains')) return 'tag' // a plain `git tag` lists PAST tags too
  if (sub === 'fsck') return 'fsck'
  if (sub === 'stash' && args[0] === 'list') return 'stash'
  if (sub === 'show-ref' || sub === 'for-each-ref') return 'refs'
  return null
}

/** The environmental error class an output shows, or null. */
export function errorClass(output) {
  for (const [name, rx] of ERROR_CLASSES) if (rx.test(output || '')) return name
  return null
}

// Claude Code starts a failed command's result with `Exit code N`: only that line is a hint, not a
// mention of an exit code anywhere in a successful command's output.
const exitCodeHint = (output) => { const m = /^\s*exit code[:=\s]+(\d+)/i.exec(output || ''); return m ? Number(m[1]) : null }

// The runner could not load a test label. Read off the output rather than the exit code: agents pipe
// test runs through `| tail`.
const LABEL_ERR_RE = /Failed to import test module|unittest\.loader\._FailedTest|ERROR: (?:file or directory )?not found|no tests ran|module '[\w.]+' has no attribute/i
const NO_MODULE_RE = /No module named ['"]?([\w.]+)/g

/** Did the runner fail to load one of these labels? Either it says so, or the module it cannot import
 * is the label's own (`tests` for `tests.app`); a missing `pytest` is not. */
export function labelFailed(labels, out) {
  if (LABEL_ERR_RE.test(out || '')) return true
  const heads = new Set(labels.map((lab) => lab.split(/[./:]/)[0]))
  return [...(out || '').matchAll(NO_MODULE_RE)].some((m) => heads.has(m[1].split('.')[0]))
}

// ... and positive evidence that it loaded: tests actually ran. Output an agent filtered away proves
// nothing either way.
const LOADED_RE = /\bRan [1-9]\d* tests?\b|\b[1-9]\d* (?:passed|failed|passing|failing)\b|\bcollected [1-9]\d* items?\b/
// other runners' summaries: Go's `ok  pkg 0.01s` and `--- PASS`, Rust's `test result:`, RSpec's
// `3 examples, 0 failures`, .NET's `Passed!`, Maven's `Tests run: 3`
const LOADED_GENERIC_RE = /^ok\s+\S+\s+[\d.]+s\b|^--- (?:PASS|FAIL)\b|\btest result: (?:ok|FAILED)\b|\b[1-9]\d* examples?, \d+ failures?\b|\b(?:Passed|Failed)!\s+-|\bTests run: [1-9]\d*/m
// code asking for an environment variable by name, and the ways a command sets one
const ENV_NEED_RE = /environment variable\s+['"`]?([A-Z][A-Z0-9_]{2,})/g
const ENV_PREFIX_RE = /(?:^|[\s;&(])(?:export\s+)?([A-Z][A-Z0-9_]{2,})=(['"]?)([\w.\-/:]+)\2/g
const ENV_INCODE_RE = /os\.environ(?:\.setdefault\(\s*|\[\s*)['"]([A-Z][A-Z0-9_]{2,})['"]\s*(?:,|\]\s*=)\s*['"]([\w.\-/:]+)['"]/g
const FAILED_RE = /Traceback \(most recent call last\)|^\w*Error\b|\b[Ee]xit [Cc]ode[:=\s]+[1-9]/m
const LABEL_TOKEN_RE = /^[A-Za-z_][\w.\-/]*(?:::[\w.\-[\]]+)*$/

/** The test labels a runner observation was given: positional arguments after the runner's own token
 * that look like a module, a path or a test id. A plain name right after an option is that option's
 * value (`-k name`), not a label. */
export function testLabels(o) {
  const toks = words(o.segment)
  const last = words(o.form).pop() ?? ''
  let start = toks.findIndex((t) => t === last || lstripDotSlash(t) === last || t.endsWith('/' + last))
  start = start < 0 ? toks.length : start + 1
  const out = []
  let skip = false, prev = ''
  for (const t of toks.slice(start)) {
    if (skip) { skip = false; prev = t; continue }
    if (['>', '>>', '2>', '<', '|'].includes(t) || /^(?:2>|>|<|\|)/.test(t)) {
      skip = ['>', '>>', '2>', '<'].includes(t)
      prev = t
      continue
    }
    const structured = ['.', '::', '/'].some((c) => t.includes(c))
    const afterOption = prev.startsWith('-') && !prev.includes('=')
    if (!t.startsWith('-') && LABEL_TOKEN_RE.test(t) && (structured || !afterOption)) out.push(t)
    prev = t
  }
  return out
}

/** ['sep', '::'] or ['strip', prefix] when label `b` is label `a` rewritten into the shape the runner
 * loads, else null. A label naming something that does not exist matches neither. */
export function labelRule(a, b) {
  if (a.includes('::') && !b.includes('::')) {
    const da = a.replaceAll('::', '.')
    if (b === da || da.startsWith(b + '.') || b.startsWith(da + '.')) return ['sep', '::']
  }
  for (const sep of ['.', '/']) {
    if (!a.includes(sep)) continue
    const p = a.split(sep, 1)[0] + sep
    const rest = a.slice(p.length)
    if (rest && !b.startsWith(p) && (b === rest || rest.startsWith(b + sep) || b.startsWith(rest + sep))) return ['strip', p]
  }
  return null
}

// A value an environment fact may keep, and show in every later session's context: never a secret.
// A name that reads like one, or a value that is not a short plain word or path (a URL, which can
// carry credentials, included), is kept as REDACTED: the fact still says the variable is needed.
export const REDACTED = '<redacted>'
const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|PWD|CRED|AUTH|URL|URI|DSN|PRIVATE|SESSION|COOKIE|CERT|SIGN/i
// A value shaped like a token is one, whatever its name: a known prefix, or a long run of letters and
// digits with no path or dotted-name separator.
const TOKEN_VALUE = /^(?:gh[pousr]_|github_pat_|glpat-|sk[-_]|pk_|rk_|xox[abpr]-|AKIA|ASIA|AIza|ya29\.|eyJ)|^(?=[^./]*\d)(?=[^./]*[A-Za-z])[A-Za-z0-9_-]{20,}$/
export const safeEnvValue = (name, value) => (!SECRET_NAME.test(name) && /^[A-Za-z0-9._/-]{1,64}$/.test(value) && !TOKEN_VALUE.test(value) ? value : REDACTED)

// What one call says about environment variables: those its output asks for, and those its command
// sets (inline, exported or in the code it runs).
function envCall(cmd, out, success) {
  const sets = {}
  for (const m of cmd.matchAll(ENV_PREFIX_RE)) sets[m[1]] = safeEnvValue(m[1], m[3])
  for (const m of cmd.matchAll(ENV_INCODE_RE)) sets[m[1]] = safeEnvValue(m[1], m[2])
  const need = [...new Set([...(out || '').matchAll(ENV_NEED_RE)].map((m) => m[1]))].sort()
  return { need, sets, ok: !!success && !FAILED_RE.test(out || '') }
}

/** Did this run show that the way the command was CALLED fails here? Not when the runner started and
 * rejected what it was given: a label it could not load, or an option it does not take, is a mistake
 * in the arguments. */
export function formFailed(o) {
  if (!FORM_ERRORS.has(o.outcome) || o.labelErr) return false
  return !(o.intent === 'run_tests' && o.outcome === 'usage_error')
}

/** Did this run show the form works? A test run must show tests running: one whose output was
 * filtered away, or that stopped before any test, proves nothing. */
export const formWorked = (o) => o.outcome === 'ran' && (o.intent !== 'run_tests' || o.testsRan)

/** A form with no activation prefix and no explicit path is bare. */
export function isBare(form) {
  const head = form ? (words(form)[0] ?? '') : ''
  return !head.includes('/') && !form.includes(' activate ') && !form.includes(' run ') &&
    !['conda run', 'poetry run', 'pipenv run', 'uv run', 'npx '].some((p) => form.startsWith(p))
}

function errorLine(out, err) {
  const m = ERROR_RX.get(err).exec(out || '')
  if (!m) return ''
  const start = out.lastIndexOf('\n', m.index - 1) + 1
  const end = out.indexOf('\n', m.index + m[0].length)
  return out.slice(start, end >= 0 ? end : undefined)
}

/** Did the call succeed? An `exit code N` in its output wins (Claude Code prefixes a failed Bash
 * result with `Exit code N`); else the call's own `exitCode`; else `ok` (false when the tool reported
 * an error). */
function succeeded(c, out) {
  const hint = exitCodeHint(out)
  if (hint !== null) return hint === 0
  return Number.isInteger(c.exitCode) ? c.exitCode === 0 : c.ok !== false
}

/**
 * One finished dispatch or session's digest: `{ obs, edited, nCalls, env }` — the observations with
 * their outcomes, the edited files (basenames, sorted), the call count, and what each call said about
 * environment variables. `calls` is grimoire's call list: `{ name, input, result, ok, cwd, exitCode? }`.
 *
 * Outcome attribution inside a compound command is heuristic and conservative: an infrastructure
 * error goes to the segment whose executable the error names, else to the last relevant segment; a
 * call that succeeded marks every relevant segment as having run; a failed call with no
 * infrastructure error marks only the first relevant segment as having run and leaves the others
 * unknown (an `&&` chain may not have reached them).
 */
export function observeCalls(calls) {
  const vocab = GENERIC
  calls = Array.isArray(calls) ? calls : []
  const cwds = calls.map((c) => (typeof c?.cwd === 'string' && c.cwd ? c.cwd : null))
  const root = cwds.find(Boolean) ?? null
  const top = repositoryTop(root)
  const obsAll = [], env = []
  calls.forEach((c, idx) => {
    const tool = String(c?.name ?? '').toLowerCase()
    if (!['shell', 'bash', 'stop_bash'].includes(tool)) return
    const input = c.input && typeof c.input === 'object' ? c.input : {}
    const cmd = String(input.command || input.cmd || '')
    const out = typeof c.result === 'string' ? c.result : ''
    if (CD_FAILED_RE.test(out)) return // stopped at its `cd`: nothing after it ran
    let here = ''
    if (root && cwds[idx]) here = cdTarget('', cwds[idx], root, top)
    // started outside the session's directory: its own `cd`s are taken as typed
    const obs = here === null ? classifyCommand(cmd, { call: idx }) : classifyCommand(cmd, { call: idx, cwd: here, root, top })
    const success = succeeded(c, out)
    const ec = envCall(cmd, out, success)
    if (ec.need.length || Object.keys(ec.sets).length) env.push({ ...ec, call: idx })
    if (!obs.length) return
    for (const o of obs) {
      if (o.intent !== 'run_tests') continue
      o.labels = testLabels(o)
      o.labelErr = o.labels.length > 0 && labelFailed(o.labels, out)
      o.loaded = o.labels.length > 0 && !o.labelErr && LOADED_RE.test(out)
      o.testsRan = LOADED_RE.test(out) || LOADED_GENERIC_RE.test(out)
    }
    // Pass-through segments (a leading `cd`, a trailing `| head`) neither add evidence nor pollute the
    // output, so they do not break a call's homogeneity; filters that rewrite content (grep, sed) do.
    const nSeg = segments(unwrap(cmd)).filter((sg) => !PASSTHROUGH.has(tail(words(sg)[0] ?? ''))).length
    const homogeneous = nSeg === obs.length && new Set(obs.map((o) => o.intent)).size === 1
    const err = errorClass(out)
    if (FORM_ERRORS.has(err) || NETWORK_ERRORS.has(err)) {
      const targets = obs.filter((o) => RUN_INTENTS.has(o.intent))
      let named = targets.filter((o) => o.head && (out.includes(o.head) || errorLine(out, err).includes(tail(o.head))))
      if (NETWORK_ERRORS.has(err)) {
        const fetches = targets.filter((o) => o.intent === 'fetch_remote')
        named = fetches.filter((o) => !o.hosts.length || o.hosts.some((h) => out.includes(h)))
        if (!named.length) named = fetches
      }
      const chosen = named.length ? named : success ? [] : targets.slice(-1)
      for (const o of chosen) o.outcome = err
      if (success) for (const o of obs) if (o.outcome === null) o.outcome = 'ran'
    } else if (success) {
      for (const o of obs) o.outcome = 'ran'
    } else {
      let first = true
      for (const o of obs) {
        if (RUN_INTENTS.has(o.intent)) { o.outcome = first ? 'ran' : null; first = false } else o.outcome = o.intent !== 'probe_vcs_refs' ? 'ran' : null
      }
    }
    for (const o of obs) {
      if (o.intent === 'probe_vcs_refs') {
        // judged only when every segment of the call is a probe: another segment's output would
        // otherwise be read as the probe's
        o.outcome = !homogeneous ? null : PROBE_HIT[o.probe].test(out) ? 'hit' : success ? 'empty' : null
      }
      // Reachability needs a homogeneous call that exited 0 with real output and no network error:
      // a compound command's exit code and output belong to its last segment, not to the fetch.
      if (o.intent === 'fetch_remote' && o.outcome === 'ran' && (!homogeneous || !success || !out.trim() || NETWORK_ERRORS.has(err))) o.outcome = null
    }
    obsAll.push(...obs)
  })
  const edited = [...editedFiles(calls.map((c) => [String(c?.name ?? '').toLowerCase(), c?.input && typeof c.input === 'object' ? c.input : {}]))].sort()
  return { obs: obsAll, edited, nCalls: calls.length, env }
}
