// ════════════════════════════════════════════════════════════════════════════
//  Tests — the PreToolUse guard (hooks/scripts/guard.mjs)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node hooks/scripts/guard.test.mjs
//
//  Spawns the guard with PreToolUse payloads on stdin and asserts the verdict:
//  deny = exit 2 with one `grimoire guard:` line on stderr, allow = exit 0 and
//  silence. Half the cases are false-positive traps: a guard that cries wolf gets
//  disabled, so the allow cases matter as much as the deny ones.
//
//  Documented choice: a quoted string is data, not a command, so
//  `echo "git push origin main"` is ALLOWED; `bash -c "…"`, `eval`, and $(…) are
//  executed, so their bodies are checked.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const GUARD = path.join(HERE, 'guard.mjs')
const WRAPPER = path.join(HERE, 'guard.sh')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }

// A throwaway project: a git repo on `main` with a feature worktree, so the rules that ask
// git (bare `git push`, `git worktree remove`) see real state.
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-guard-')))
const PROJ = path.join(SANDBOX, 'proj')
mkdirSync(PROJ)
const g = (...a) => execFileSync('git', ['-C', PROJ, ...a], { stdio: 'ignore' })
g('init', '-q', '-b', 'main')
g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
g('worktree', 'add', '-q', '-b', 'feat/x', path.join(PROJ, '.worktrees', 'feat-x'))
const EMPTY = path.join(SANDBOX, 'empty') // a non-git project with its own config
mkdirSync(EMPTY)

function guard(payload, { env = {}, cwd = PROJ, project = cwd, cmd = process.execPath, args = [GUARD] } = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify({ hook_event_name: 'PreToolUse', cwd, ...payload })
  const r = spawnSync(cmd, args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, GRIMOIRE_GUARD_ALLOW: '', ...env },
  })
  return { code: r.status, err: (r.stderr || '').trim() }
}
const bash = (command, o) => guard({ tool_name: 'Bash', tool_input: { command } }, o)
const write = (tool, file, extra = {}, o) => guard({ tool_name: tool, tool_input: tool === 'NotebookEdit' ? { notebook_path: file } : { file_path: file }, ...extra }, o)
const denied = (r) => r.code === 2 && /^grimoire guard: /.test(r.err) && !r.err.includes('\n')
const allowed = (r) => r.code === 0 && r.err === ''
const expectDeny = (r, m) => ok(denied(r), `deny · ${m}${denied(r) ? '' : ` (exit ${r.code}, stderr: ${r.err || '∅'})`}`)
const expectAllow = (r, m) => ok(allowed(r), `allow · ${m}${allowed(r) ? '' : ` (exit ${r.code}, stderr: ${r.err || '∅'})`}`)

try {
  console.log('\n── git push')
  expectDeny(bash('git push origin main'), 'git push origin main')
  expectDeny(bash('git push origin HEAD:main'), 'git push origin HEAD:main')
  expectDeny(bash('git push origin +main'), 'git push origin +main (forced refspec)')
  expectDeny(bash('git push --force origin master'), 'git push --force origin master')
  expectDeny(bash('git push -f origin develop'), 'git push -f origin develop')
  expectDeny(bash('git push --force-with-lease origin trunk'), 'git push --force-with-lease origin trunk')
  expectDeny(bash('git push origin release/2.4'), 'git push origin release/2.4 (release/* glob)')
  expectDeny(bash('git push --mirror origin'), 'git push --mirror')
  expectDeny(bash('git push origin --delete main'), 'git push origin --delete main')
  expectDeny(bash('git push origin :main'), 'git push origin :main (delete refspec)')
  expectDeny(bash('git push origin feat/x:refs/heads/main'), 'git push origin feat/x:refs/heads/main')
  expectDeny(bash('git push'), 'bare git push while the checkout is on main')
  expectDeny(bash('git push -u origin HEAD'), 'git push -u origin HEAD while on main')
  expectDeny(bash(`git -C ${PROJ} push origin main`), 'git -C <dir> push origin main')
  expectDeny(bash('npm test && git push origin main'), 'push chained after &&')
  expectDeny(bash('bash -c "git push origin main"'), 'bash -c "git push origin main"')
  expectDeny(bash('echo $(git push origin main)'), 'push inside $(…)')
  expectDeny(bash('rtk proxy git push origin main'), 'rtk proxy git push origin main')
  expectAllow(bash('git push origin feat/main-menu'), 'git push origin feat/main-menu (trap: contains "main")')
  expectAllow(bash('git push -u origin feat/x'), 'git push -u origin feat/x')
  expectAllow(bash('git push --force-with-lease origin feat/x'), 'force-push of a feature branch')
  expectAllow(bash('git push', { cwd: path.join(PROJ, '.worktrees', 'feat-x'), project: PROJ }), 'bare git push from the feat/x worktree')
  expectAllow(bash('echo "git push origin main"'), 'echo "git push origin main" (quoted text is data)')
  expectAllow(bash('git log main'), 'git log main')
  expectAllow(bash('git checkout main && git pull origin main'), 'git pull origin main')
  expectAllow(bash('git fetch origin main:main'), 'git fetch origin main:main')

  console.log('\n── git branch / worktree')
  expectDeny(bash('git branch -D main'), 'git branch -D main')
  expectDeny(bash('git branch --delete --force develop'), 'git branch --delete --force develop')
  expectAllow(bash('git branch -D feat/old'), 'git branch -D feat/old')
  expectAllow(bash('git branch -a'), 'git branch -a')
  expectDeny(bash(`git worktree remove --force ${PROJ}`, { cwd: path.join(PROJ, '.worktrees', 'feat-x'), project: PROJ }), 'git worktree remove of the checkout on main')
  expectAllow(bash('git worktree remove .worktrees/feat-x'), 'git worktree remove of a feature worktree')

  console.log('\n── rm -rf')
  expectDeny(bash('rm -rf /'), 'rm -rf /')
  expectDeny(bash('rm -rf ~'), 'rm -rf ~')
  expectDeny(bash('rm -rf $HOME'), 'rm -rf $HOME')
  expectDeny(bash('rm -fr .'), 'rm -fr .')
  expectDeny(bash('rm -r -f ..'), 'rm -r -f ..')
  expectDeny(bash('rm -rf *'), 'rm -rf *')
  expectDeny(bash('rm -rf .git'), "rm -rf .git (the project's history)")
  expectDeny(bash(`rm -rf ${homedir()}/Documents`), 'rm -rf of an absolute path outside the project')
  expectDeny(bash('rm -rf ../../../../../../../../../../etc'), 'rm -rf of a relative path escaping the project')
  expectDeny(bash(`cd ${SANDBOX} && rm -rf proj`), 'cd to the parent, then rm -rf the project')
  expectDeny(bash('sudo rm -Rf -- /usr'), 'sudo rm -Rf -- /usr')
  expectAllow(bash('rm -rf node_modules'), 'rm -rf node_modules')
  expectAllow(bash('rm -rf .worktrees/api--proj-1'), 'rm -rf .worktrees/api--proj-1')
  expectAllow(bash(`rm -rf ${PROJ}/dist build/*`), 'rm -rf of absolute and globbed paths inside the project')
  expectAllow(bash(`rm -rf ${path.join(tmpdir(), 'grimoire-scratch')}`), 'rm -rf inside the temp dir')
  expectAllow(bash('rm -rf "$OUT_DIR"'), 'rm -rf "$OUT_DIR" (unexpanded variable: cannot judge)')
  expectAllow(bash('rm -f /etc/hosts.bak'), 'non-recursive rm is out of scope')
  expectAllow(bash('ls > /dev/null 2>&1; rm -rf build 2>/dev/null'), 'redirection targets are not rm targets')
  expectAllow(bash('git commit -m "$(cat <<\'EOF\'\nwipe: rm -rf / is now refused\nEOF\n)"'), 'heredoc body in a commit message is data')
  expectDeny(bash('git commit -m "$(cat <<\'EOF\'\nFix: don\'t crash (really)\nEOF\n)" && git push origin main'), 'push after a heredoc commit message with an apostrophe')
  expectAllow(bash('git commit -m "$(cat <<\'EOF\'\nFix: don\'t crash\n\ngit push origin main later\nEOF\n)" && git push -u origin feat/y'), 'commit message mentioning a push, then a feature push')
  expectAllow(bash('rm -rf build > /dev/null 2>&1'), 'rm -rf build > /dev/null (target of > is not an rm target)')
  expectAllow(bash('find . -name dist | xargs rm -rf'), 'xargs rm -rf (targets come from stdin: cannot judge)')
  expectDeny(bash('git push origin main 2>&1 | tail -5'), 'push piped into tail')

  console.log('\n── protected paths')
  expectDeny(write('Write', path.join(PROJ, '.worktrees', 'feat-x', '.claude/settings.json')), "a lane's .claude/settings.json")
  expectDeny(write('Write', path.join(PROJ, '.claude/settings.json')), 'Write .claude/settings.json')
  expectDeny(write('Edit', '.claude/settings.local.json'), 'Edit .claude/settings.local.json (relative path)')
  expectDeny(write('MultiEdit', path.join(PROJ, '.claude/hooks/pre.sh')), 'MultiEdit under .claude/hooks/')
  expectAllow(write('Write', path.join(PROJ, 'hooks/useSession.ts')), 'a root hooks/ is app source, not the harness')
  expectAllow(write('Write', path.join(PROJ, '.claude/settings.json'), {}, { env: { GRIMOIRE_GUARD_ALLOW: '1' } }), 'GRIMOIRE_GUARD_ALLOW=1 overrides path rules')
  expectAllow(write('Write', path.join(PROJ, 'src/hooks/useThing.ts')), 'a nested src/hooks/ is not the project hooks/')
  expectAllow(write('Edit', path.join(PROJ, '.claude/agents/api-engineer.md')), 'other .claude files')
  expectAllow(write('Write', path.join(SANDBOX, 'elsewhere', 'hooks', 'x.sh')), 'files outside the project')

  console.log('\n── memory')
  expectDeny(write('Edit', path.join(PROJ, 'memory/harness.md'), { agent_id: 'a1', agent_type: 'grimoire:reviewer' }), 'the reviewer writing memory/')
  expectAllow(write('Edit', path.join(PROJ, 'memory/harness.md'), { agent_id: 'a2', agent_type: 'general-purpose' }), 'a generic subagent (how crystallize is dispatched)')
  expectAllow(write('Edit', path.join(PROJ, 'memory/harness.md')), 'the main session')
  expectAllow(write('Edit', path.join(PROJ, 'memory/harness.md'), { agent_id: 'a3', agent_type: 'crystallize' }), 'an agent named crystallize')
  const LANE = path.join(PROJ, '.worktrees', 'feat-x')
  const OUTER = path.join(SANDBOX, 'outer-wt')
  g('worktree', 'add', '-q', '-b', 'feat/y', OUTER)
  expectDeny(write('Edit', path.join(LANE, 'memory/harness.md'), { agent_id: 'w1', agent_type: 'reviewer' }), 'the reviewer writing memory/ inside a loop lane (.worktrees/)')
  expectDeny(write('Write', path.join(OUTER, 'memory/agents/x.md'), { agent_id: 'w2', agent_type: 'codebase-scout' }), 'a scout writing memory/ in a worktree outside the project')
  expectAllow(write('Edit', path.join(LANE, 'memory/harness.md'), { agent_id: 'w3', agent_type: 'general-purpose' }), 'crystallize (a generic subagent) writing memory/ in its own worktree')
  expectAllow(write('Edit', path.join(LANE, 'src/app.ts'), { agent_id: 'w4', agent_type: 'reviewer' }), 'ordinary files in a lane stay writable')
  const EXT = path.join(SANDBOX, 'external'); mkdirSync(EXT)
  symlinkSync(EXT, path.join(PROJ, '.claude'))
  expectDeny(write('Write', path.join(PROJ, '.claude/settings.json')), '.claude/settings.json when .claude is a symlink out of the repo')
  expectDeny(write('Write', '.claude/settings.json'), 'the same, by a relative path')
  rmSync(path.join(PROJ, '.claude'))
  rmSync(path.join(LANE, 'memory'), { recursive: true, force: true })
  symlinkSync(EXT, path.join(LANE, 'memory'))
  expectDeny(write('Edit', path.join(LANE, 'memory/harness.md'), { agent_id: 'w5', agent_type: 'reviewer' }), "a lane's memory/ symlinked out of the repo")
  mkdirSync(path.join(PROJ, 'memory'), { recursive: true })
  symlinkSync(path.join(PROJ, 'memory'), path.join(PROJ, 'notes'))
  expectDeny(write('Edit', path.join(PROJ, 'notes/harness.md'), { agent_id: 'w6', agent_type: 'reviewer' }), 'a symlink INTO memory/ under another name')

  console.log('\n── config')
  writeFileSync(path.join(EMPTY, 'grimoire.config.json'), JSON.stringify({
    baseBranch: 'origin/staging',
    memoryDir: '.claude/memory',
    repos: [{ name: 'api', agent: 'api-engineer' }],
    guard: { protectedBranches: ['prod'], protectedPaths: ['infra/secrets/', 'Makefile'] },
  }))
  const e = { cwd: EMPTY }
  expectDeny(bash('git push origin staging', e), 'baseBranch origin/staging becomes protected')
  expectDeny(bash('git push origin prod', e), 'guard.protectedBranches')
  expectAllow(bash('git push origin develop', e), 'guard.protectedBranches replaces the defaults')
  expectDeny(write('Write', path.join(EMPTY, 'infra/secrets/key.env'), {}, e), 'guard.protectedPaths directory')
  expectDeny(write('Edit', path.join(EMPTY, 'Makefile'), {}, e), 'guard.protectedPaths file')
  expectDeny(write('Write', path.join(EMPTY, '.claude/memory/agents/api-engineer.md'), { agent_id: 'b', agent_type: 'api-engineer' }, e), 'a repo agent writing the configured memoryDir')
  expectAllow(write('Write', path.join(EMPTY, 'memory/notes.md'), { agent_id: 'b', agent_type: 'api-engineer' }, e), 'memory/ is not the memoryDir here')
  writeFileSync(path.join(EMPTY, 'grimoire.config.json'), JSON.stringify({ guard: { enabled: false } }))
  expectAllow(bash('git push origin main', e), 'guard.enabled: false turns it off')
  writeFileSync(path.join(EMPTY, 'grimoire.config.json'), '{ not json')
  expectDeny(bash('git push origin main', e), 'a malformed config falls back to defaults')

  console.log('\n── robustness')
  expectAllow(guard('not json at all'), 'malformed stdin')
  expectAllow(guard(''), 'empty stdin')
  expectAllow(guard({ tool_name: 'Bash', tool_input: { command: 42 } }), 'non-string command')
  expectAllow(guard({ tool_name: 'Read', tool_input: { file_path: path.join(PROJ, '.claude/settings.json') } }), 'other tools pass through')
  expectAllow(bash('echo "unterminated'), 'unterminated quote')
  const w = bash('git push origin main', { cmd: '/bin/bash', args: [WRAPPER] })
  expectDeny(w, 'guard.sh wrapper propagates the deny exit code')
  const noNodePath = '/usr/bin:/bin'
  const hasNode = spawnSync('/bin/bash', ['-c', 'command -v node'], { env: { PATH: noNodePath } }).status === 0
  if (hasNode) console.log('   · skipped: node is on the minimal PATH, cannot test the no-node branch')
  else expectAllow(bash('git push origin main', { cmd: '/bin/bash', args: [WRAPPER], env: { PATH: noNodePath } }), 'guard.sh fails open silently without node')
} finally {
  rmSync(SANDBOX, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(60)}\n${PASS} passed · ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
