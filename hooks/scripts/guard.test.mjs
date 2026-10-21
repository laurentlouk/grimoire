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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
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

function guard(payload, { env = {}, cwd = PROJ, project = cwd, cmd = process.execPath, args = [GUARD], timeout } = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify({ hook_event_name: 'PreToolUse', cwd, ...payload })
  const r = spawnSync(cmd, args, {
    input,
    timeout,
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
  expectDeny(bash(`builtin cd ${SANDBOX} && rm -rf proj`), 'builtin cd to the parent, then rm -rf the project')
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
  if (process.platform === 'darwin') expectDeny(write('Write', path.join(PROJ, '.claude/settings.json'), {}, { project: PROJ.replace(/proj$/, 'Proj') }), 'CLAUDE_PROJECT_DIR in another letter case (case-insensitive macOS volume)')
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
  { // an untracked config on the main checkout still binds a linked worktree that has none
    const WT = path.join(PROJ, '.worktrees', 'feat-x')
    writeFileSync(path.join(PROJ, 'grimoire.config.json'), JSON.stringify({ guard: { protectedBranches: ['prod'] } }))
    const w = { cwd: WT }
    expectDeny(bash('git push origin prod', w), "a worktree with no config reads the main checkout's guard.protectedBranches")
    writeFileSync(path.join(WT, 'grimoire.config.json'), JSON.stringify({ guard: { protectedBranches: ['qa'] } }))
    expectDeny(bash('git push origin qa', w), "the worktree's own file layers over the main one")
    expectAllow(bash('git push origin prod', w), 'an array the worktree sets replaces the main one whole')
    rmSync(path.join(WT, 'grimoire.config.json')); rmSync(path.join(PROJ, 'grimoire.config.json'))
  }

  console.log('\n── mcp tools (read-only agents)')
  // Connector tool names are opaque per account (`mcp__<server>__<tool>`, the server id holding
  // `_`, `-` and digits), so the rule reads the tool part after the last `__`, split into words
  // on `_`, `-` and camelCase; the first known verb decides (a read allows, a write denies).
  const mcp = (tool, agentType, o) => guard({ tool_name: tool, tool_input: { id: 'ODY-1' }, ...(agentType === undefined ? {} : { agent_id: 'm1', agent_type: agentType }) }, o)
  const expectReadOnly = (r, agent, tool, m, verb) => {
    const line = denied(r) && r.err.includes(`'${agent}'`) && r.err.includes(tool) && /read-only/.test(r.err) && /report the proposed write in your result/.test(r.err) &&
      (verb === undefined || r.err.includes(`'${verb}' names a write`))
    ok(line, `deny · ${m}${line ? '' : ` (exit ${r.code}, stderr: ${r.err || '∅'})`}`)
  }
  const first = mcp('mcp__abc__save_issue', 'grimoire:tracker-scout')
  ok(first.code === 2 && first.err === "grimoire guard: agent 'tracker-scout' may not call mcp__abc__save_issue: the plugin's scouts and reviewer are read-only and 'save' names a write; report the proposed write in your result (the main session applies writes), or set GRIMOIRE_GUARD_ALLOW=1.",
    `deny · the exact line for a namespaced tracker-scout's save_issue (exit ${first.code}, stderr: ${first.err || '∅'})`)
  expectReadOnly(mcp('mcp__abc__create_comment', 'grimoire:tracker-scout'), 'tracker-scout', 'mcp__abc__create_comment', 'tracker-scout · create_comment')
  expectReadOnly(mcp('mcp__x__send_message', 'reviewer'), 'reviewer', 'mcp__x__send_message', 'reviewer · send_message')
  expectReadOnly(mcp('mcp__055f8362-1877-48fa__save_issue', 'tracker-scout'), 'tracker-scout', 'mcp__055f8362-1877-48fa__save_issue', 'a server id with dashes and digits')
  expectReadOnly(mcp('mcp__claude_ai_Linear__update_issue', 'grimoire:tracker-scout'), 'tracker-scout', 'mcp__claude_ai_Linear__update_issue', 'a server id with underscores')
  expectReadOnly(mcp('mcp__hub__github__create_issue', 'tracker-scout'), 'tracker-scout', 'mcp__hub__github__create_issue', 'a server id holding `__` (an aggregator): the tool follows the last `__`')
  expectReadOnly(mcp('mcp__abc__Delete_Comment', 'design-scout'), 'design-scout', 'mcp__abc__Delete_Comment', 'the verb in another letter case')
  for (const [agent, tool, verb] of [['codebase-scout', 'reply_to_thread', 'reply'], ['reference-scout', 'forward', 'forward'], ['contract-checker', 'merge_diff', 'merge'], ['security-scout', 'set_status', 'set'], ['perf-scout', 'add_label', 'add'], ['tracker-scout', 'remove_label', 'remove'], ['tracker-scout', 'mark_notification', 'mark']]) {
    expectReadOnly(mcp(`mcp__srv__${tool}`, agent), agent, `mcp__srv__${tool}`, `${agent} · ${tool}`, verb)
  }
  // The first known verb decides, wherever it sits: a vendor prefix (`slack_`) is not a verb.
  for (const [tool, verb] of [['slack_send_message', 'send'], ['slack_schedule_message', 'schedule'], ['slack_update_canvas', 'update'], ['slack_add_reaction', 'add'],
    ['share_issue', 'share'], ['submit_diff_review', 'submit'], ['resolve_diff_thread', 'resolve'], ['retire_issue_label', 'retire'], ['createJiraIssue', 'create'],
    ['trash_message', 'trash'], ['label_message', 'label'], ['respond_to_event', 'respond'], ['exec', 'exec'], ['execute_sentry_tool', 'execute'],
    ['run_scheduled_task', 'run'], ['issue_upsert', 'upsert'], ['SAVE_ISSUE', 'save'],
    // lifecycle and state verbs: a session, a deployment, a cache, a key
    ['pause_project', 'pause'], ['unpause_project', 'unpause'], ['stop_session', 'stop'], ['kill_session_command', 'kill'],
    ['activate_kms_signing_key', 'activate'], ['invalidate_by_tags', 'invalidate'], ['record_events', 'record'], ['stage_redirects', 'stage'],
    ['generate_route', 'generate'], ['start_session', 'start'], ['sync_with_base_branch', 'sync'],
    // `verify` is no verb on purpose, so the first known one is `upload`: a check of an upload reads as a write
    ['verify_upload', 'upload']]) {
    expectReadOnly(mcp(`mcp__srv-1__${tool}`, 'tracker-scout'), 'tracker-scout', `mcp__srv-1__${tool}`, `tracker-scout · ${tool} ('${verb}' decides)`, verb)
  }
  expectAllow(mcp('mcp__abc__list_issues', 'grimoire:tracker-scout'), 'tracker-scout · list_issues')
  expectAllow(mcp('mcp__abc__get_issue', 'grimoire:tracker-scout'), 'tracker-scout · get_issue')
  expectAllow(mcp('mcp__plugin_grimoire_graph__graph_search', 'grimoire:codebase-scout'), 'codebase-scout · the graph server (underscores in the server id)')
  expectAllow(mcp('mcp__055f8362-1877-48fa__get_issue', 'tracker-scout'), 'a dashed server id with a read tool')
  expectAllow(mcp('mcp__save_service__list_items', 'tracker-scout'), 'a write verb in the server id is not the tool (trap)')
  expectAllow(mcp('mcp__abc__list_saved_views', 'tracker-scout'), "'saved' is not a verb, and 'list' comes first (trap)")
  expectAllow(mcp('mcp__abc__settings_get', 'tracker-scout'), "'settings' is not 'set', and 'get' reads (trap)")
  expectAllow(mcp('mcp__abc__address_lookup', 'tracker-scout'), "'address' is not 'add', and 'lookup' reads (trap)")
  for (const [tool, why] of [['get_label', "'get' comes before 'label'"], ['list_issue_labels', "'labels' is not 'label'"], ['forwarding_rules_list', "'forwarding' is not 'forward'"],
    ['slack_read_channel', "'read' after a vendor prefix"], ['slack_search_public', "'search' after a vendor prefix"], ['getJiraIssue', 'camelCase read'],
    ['graph_search', "'search' reads"], ['graph_index', 'no known verb: fails open'], ['list_task_runs', "'list' comes first, and 'runs' is not 'run'"],
    ['get_link', "'get' comes before 'link'"], ['issue_cert', "'issue' is no verb on purpose: fails open"]]) {
    expectAllow(mcp(`mcp__srv-1__${tool}`, 'tracker-scout'), `tracker-scout · ${tool} (${why})`)
  }
  expectAllow(mcp('mcp__abc__save_issue'), 'the main session (no agent_type) · save_issue')
  expectAllow(mcp('mcp__abc__save_issue', 'general-purpose'), 'a generic subagent · save_issue')
  expectAllow(mcp('mcp__abc__save_issue', 'api-engineer'), 'a repo agent · save_issue')
  expectAllow(mcp('mcp__abc__save_issue', 'grimoire:migration-engineer'), 'migration-engineer (an implementer) · save_issue')
  expectAllow(mcp('mcp__abc__create_comment', 'test-engineer'), 'test-engineer (an implementer) · create_comment')
  expectAllow(mcp('save_issue', 'tracker-scout'), 'a non-MCP tool named like a write passes through')
  expectAllow(guard({ tool_name: 'Read', tool_input: { file_path: path.join(PROJ, 'README.md') }, agent_id: 'm2', agent_type: 'tracker-scout' }), 'a scout · Read, unchanged')
  expectAllow(guard({ tool_name: 'Bash', tool_input: { command: 'git log main' }, agent_id: 'm3', agent_type: 'tracker-scout' }), 'a scout · Bash, unchanged')
  expectDeny(guard({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, agent_id: 'm4', agent_type: 'tracker-scout' }), 'a scout · a protected push, still denied by the Bash rule')
  writeFileSync(path.join(EMPTY, 'grimoire.config.json'), JSON.stringify({ repos: [{ name: 'api', agent: 'api-engineer' }] }))
  expectAllow(mcp('mcp__abc__save_issue', 'api-engineer', e), 'a repo agent the config names (memory-denied, never MCP-denied) · save_issue')
  expectReadOnly(mcp('mcp__abc__save_issue', 'tracker-scout', e), 'tracker-scout', 'mcp__abc__save_issue', 'tracker-scout · save_issue under a project config')
  // A project's own agent (no namespace) may share a plugin agent's bare name; the config naming it
  // exempts it. The plugin's own agent (`grimoire:reviewer`) stays bound regardless.
  expectReadOnly(mcp('mcp__a__create_pull_request_review', 'reviewer'), 'reviewer', 'mcp__a__create_pull_request_review', 'reviewer · create_pull_request_review with no config naming a reviewer', 'create')
  expectReadOnly(mcp('mcp__a__create_pull_request_review', 'grimoire:reviewer'), 'reviewer', 'mcp__a__create_pull_request_review', 'grimoire:reviewer · the same call with no such config', 'create')
  writeFileSync(path.join(EMPTY, 'grimoire.config.json'), JSON.stringify({ repos: [{ name: 'x', agent: 'reviewer' }] }))
  expectAllow(mcp('mcp__a__create_pull_request_review', 'reviewer', e), "a repo agent the config names 'reviewer' is never read-only")
  expectReadOnly(mcp('mcp__a__create_pull_request_review', 'grimoire:reviewer', e), 'reviewer', 'mcp__a__create_pull_request_review', "the plugin's grimoire:reviewer stays bound when a repo agent shares its name", 'create')
  expectReadOnly(mcp('mcp__a__save_issue', 'tracker-scout', e), 'tracker-scout', 'mcp__a__save_issue', 'the other read-only agents stay bound under that config', 'save')
  writeFileSync(path.join(EMPTY, 'grimoire.config.json'), JSON.stringify({ specialists: [{ agent: 'tracker-scout', repos: ['x'] }] }))
  expectAllow(mcp('mcp__a__save_issue', 'tracker-scout', e), "a specialist the config names 'tracker-scout' is never read-only")
  writeFileSync(path.join(EMPTY, 'grimoire.config.json'), JSON.stringify({ guard: { enabled: false } }))
  expectAllow(mcp('mcp__abc__save_issue', 'tracker-scout', e), 'guard.enabled: false allows the scout\'s write')
  expectAllow(mcp('mcp__abc__save_issue', 'grimoire:tracker-scout', { env: { GRIMOIRE_GUARD_ALLOW: '1' } }), 'GRIMOIRE_GUARD_ALLOW=1 allows the scout\'s write')
  expectAllow(guard('{"tool_name":"mcp__abc__save_issue","agent_type":"tracker-scout"'), 'malformed stdin on an MCP call')
  expectAllow(guard({ tool_name: 'mcp__abc__save_issue', agent_type: 42 }), 'a non-string agent_type')
  expectReadOnly(guard({ tool_name: 'mcp__abc__save_issue', tool_input: 'nope', agent_type: 'tracker-scout', cwd: 7 }), 'tracker-scout', 'mcp__abc__save_issue', 'a non-object tool_input and a non-string cwd: the tool name is still judged')
  expectAllow(mcp('mcp__save_issue', 'tracker-scout'), 'no tool part after the server id')
  expectAllow(mcp('mcp__abc__', 'tracker-scout'), 'an empty tool part')
  expectReadOnly(mcp('mcp__a__save_issue__', 'tracker-scout'), 'tracker-scout', 'mcp__a__save_issue__', 'a trailing `__` does not empty the tool part', 'save')
  expectReadOnly(mcp('mcp__a__create__', 'tracker-scout'), 'tracker-scout', 'mcp__a__create__', 'a trailing `__` after a bare verb', 'create')
  // A pathological name must not stall the hook (5 s timeout in hooks.json): the tool part is capped.
  for (const [tool, verdict, m] of [[`mcp__a__${'A'.repeat(100000)}`, allowed, '100k capitals (no verb in the first 64)'],
    [`mcp__a__save_${'A'.repeat(100000)}`, denied, "100k capitals after 'save_'"], [`mcp__a__save${'_'.repeat(100000)}`, denied, '100k trailing underscores']]) {
    const t0 = Date.now(), r = mcp(tool, 'tracker-scout', { timeout: 5000 }), ms = Date.now() - t0
    ok(verdict(r) && ms < 2000, `${verdict === allowed ? 'allow' : 'deny'} · ${m}, in ${ms} ms (exit ${r.code})`)
  }
  // The rule only runs on calls hooks.json routes to the guard (Claude Code matchers are regexes).
  const pre = JSON.parse(readFileSync(path.join(HERE, '..', 'hooks.json'), 'utf8')).hooks.PreToolUse.find((h) => /guard\.sh/.test(JSON.stringify(h.hooks)))
  const routes = (t) => new RegExp(`^(?:${pre.matcher})$`).test(t)
  ok(['mcp__abc__save_issue', 'mcp__055f8362-1877-48fa__save_issue', 'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].every(routes) && !routes('Read') && !routes('Glob'),
    `hooks.json routes mcp__* calls and the write tools to the guard, not Read (matcher: ${pre.matcher})`)

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
