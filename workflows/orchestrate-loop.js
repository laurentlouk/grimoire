/**
 *  orchestrate-loop — the unattended build LOOP (implement ⇄ review, adaptive, learning)
 *
 *  ENGINE ONLY. This file holds what must be computed: the dependsOn scheduler, worktree
 *  lanes + serialized integration, the three adaptation rungs (resolve · fix · replan), the
 *  review-scope split, the terminal wave (sweep → gate → PR), the learning phase (ledger →
 *  crystallize), JSON schemas, telemetry. Everything an AGENT READS lives in Markdown next
 *  to it — `briefs/<name>.md` (one per dispatch kind) and `personas/<id>.md` (review
 *  lenses) — and each dispatch is a short dynamic header + "read your brief". That keeps
 *  this file readable and lets `crystallize` patch the prose after a PR.
 *
 *  Stack-agnostic: every repo, agent, gate command, tracker and path comes from `args`.
 *  Nothing about a particular product, language or CI system is baked in here.
 *
 *  Design notes, diagrams and the full config reference: workflows/README.md
 *  Tests (stubbed runtime, ms):                          workflows/tests/*.test.mjs
 */

export const meta = {
  name: 'orchestrate-loop',
  description:
    'OPTIONAL adaptive build LOOP: run the `implement` ⇄ `review` half of the design pipeline unattended over a FULL tracker project from `to-issues` — dispatching one owning agent per repo (implement) and a diverse-lens review panel SPLIT BY SCOPE: per task, spec review + a build-safety core (adversarial QA, + data-integrity on backend/infra repos) gates whether dependents may build on the change; once per repo, AT PROJECT END (one final wave, all repos in parallel), a TERMINAL quality sweep (SRE · human-interface · a11y · privacy · store review) reviews the whole integrated run branch, then the repo\'s own gate command + PR — the expensive gates are paid exactly ONCE, on the final tree, never while implementation runs. Scheduling is CONTINUOUS and dependsOn-driven, straight from the tickets: an issue dispatches the MOMENT everything blocking it has landed — no wave barrier, so a slow task in one repo never idles ready dependents elsewhere — parallel across repos AND within a repo when declared files are disjoint (worktree lanes merged by a serialized integrate step, up to maxPerRepo in flight); ready order is slice, then transitive downstream unlocked (critical path), never a barrier. Parsing is two-phase so any project size fits — a lightweight slice INDEX up front, then per-cycle just-in-time hydration; issues already done/canceled in the tracker are absorbed, so re-invoking resumes. The first review of a stage is always its full panel; after a fix, a cheap GUARD verifies the fix diff against the blocking findings and either passes the stage (no panel re-run) or triggers a full re-review. When failures leave work blocked it RE-PLANS from the current state (A* from where we are, not a restart) — failures become learning. Emits per-step start/finish + output-token telemetry so a stuck step is visible. LEARNS across runs: loads harness + per-agent memory and prior run ledgers at start, pastes each agent\'s memory into its brief, writes a run ledger at the end, and — after the PRs — runs the `crystallize` skill once to patch/create skills, add memory facts and sync docs in ONE reviewable PR. REQUIRES the design half\'s three artifacts — {specPath} (roast), {planPath} (to-plan), {project} (to-issues) — plus {repos} (the repo/agent/gate config), and refuses to start when any is missing. Stops at PRs — merge and deploy stay manual.',
  whenToUse:
    'After the FULL design half has run (`roast` → spec, `to-plan` → plan, `to-issues` → slice-tagged issues): execute the WHOLE project start to finish with your repo agents (implement + scoped review panel: per-task build-safety core, per-repo terminal sweep), scheduled by the tickets\' own dependsOn links — parallel where the tickets allow, waiting where they block — instead of running `implement`/`review` by hand. When failures leave work blocked it adaptively re-plans from the current state rather than looping the original plan. The design half stays interactive, and its three artifacts are REQUIRED inputs ({specPath, planPath, project}), alongside {repos}. PREVIEWS BY DEFAULT — pass {execute:true} to dispatch implementers. Heavy mode; stops at PRs.',
  phases: [
    { title: 'Parse plan', detail: 'verify the design artifacts, then phase A: the whole project as a lightweight slice INDEX; each dispatch cycle hydrates just-in-time' },
    { title: 'Implement', detail: 'owning repo agent builds each task (+ fix loop on review FAIL)' },
    { title: 'Spec review', detail: 'Spec Hawk: does the diff do EXACTLY what the task says' },
    { title: 'Quality review', detail: 'per-task build-safety core (adversarial QA, + data-integrity on backend/infra repos), in parallel' },
    { title: 'Terminal review', detail: 'once per repo AT PROJECT END (one final wave, repos in parallel): SRE · human-interface · a11y · privacy · store review sweep the whole integrated run branch, then the repo gate + PR' },
    { title: 'Replan', detail: 'when failures leave work blocked, re-run A* from the current state → revised tasks or HALT' },
    { title: 'Final pass', detail: 'the optional cross-repo contract check' },
    { title: 'Crystallize', detail: 'execute runs only: write the run ledger, then — when PRs exist — the crystallize skill turns the PRs + review threads + ledger into skill patches, memory facts and doc syncs, in ONE PR for review' },
  ],
}

// ═══════════════════════════════ config ═══════════════════════════════
// Adaptation + safety bounds. Keep them small: this runs UNATTENDED, so the
// budgets are the backstop against a task/goal that never CONVERGES, and the
// per-agent timeout is the backstop against one that HANGS.
const DEFAULT_MAX_FIX_ATTEMPTS = 3 // fix rung: fixes per review stage before it returns FAIL (letting the slice replan). Override with {maxFixAttempts:N}.
const DEFAULT_MAX_REPLANS = 3 // replan rung: how many times a failed slice may re-plan from the current state before we HALT
const DEFAULT_MAX_CONTEXT_RESOLVES = 2 // resolve rung (cheapest): NEEDS_CONTEXT answers fetched from a read-only scout before the question is allowed to escalate to a replan. Override with {maxContextResolves:N}; 0 disables.
const DEFAULT_AGENT_TIMEOUT_MIN = 40 // per-agent wall-clock backstop (minutes). Must exceed the longest legit single-agent op so it fires only on a true hang. Override with {agentTimeoutMin:N}; 0 disables. A repo may raise it for ITS dispatches with {repos:[{timeoutMin:N}]} — e.g. a repo whose gate queues for a machine-global lock.
const DEFAULT_MAX_PER_REPO = 3 // within-repo parallelism: how many of a repo's tasks may be IN FLIGHT at once. Whether a ready task actually joins is decided at dispatch by declared-file overlap against the repo's running tasks — disjoint files → parallel worktree lanes, any overlap or an undeclared footprint → held until the conflict clears. {maxPerRepo:1} restores strict serialization.

// Paths. All overridable through args — a skill installed with `npx skills add` lands under
// `.claude/skills/<name>/`, so the brief/persona directories must be able to follow it.
const DEFAULT_RUNS_DIR = 'runs' // run ledgers, one JSON per execute run — the harness's episodic memory
const DEFAULT_MEMORY_DIR = '.claude/memory' // harness.md + agents/<agent>.md — curated facts
const DEFAULT_BRIEFS_DIR = 'workflows/briefs'
const DEFAULT_PERSONAS_DIR = 'workflows/personas'
const DEFAULT_WORKTREE_DIR = '.worktrees' // parallel lanes live here, one git worktree per task
const DEFAULT_REPO_ROOT = 'repositories' // a repo with no explicit `path` is `<root>/<name>`

// Assigned once args are parsed (below); every prompt builder reads them at call time.
let MEMORY_DIR = DEFAULT_MEMORY_DIR
let RUNS_DIR = DEFAULT_RUNS_DIR
let BRIEFS_DIR = DEFAULT_BRIEFS_DIR
let PERSONAS_DIR = DEFAULT_PERSONAS_DIR
let WORKTREE_DIR = DEFAULT_WORKTREE_DIR
const DEFAULT_BASE_BRANCH = 'origin/main' // the integration branch every lane, range and sweep diffs against
let BASE_BRANCH = DEFAULT_BASE_BRANCH

// repo name → { name, path, agent, tags, gate, prBy, timeoutMin, laneSetup }
let repoConfig = new Map()
const repoCfg = (repo) => repoConfig.get(repo) || null
const agentFor = (repo) => (repoCfg(repo) || {}).agent || null
const repoPath = (repo) => (repoCfg(repo) || {}).path || `${DEFAULT_REPO_ROOT}/${repo}`
const tagsOf = (repo) => (repoCfg(repo) || {}).tags || []
const gateOf = (repo) => (repoCfg(repo) || {}).gate || null
// Who opens this repo's PR: the terminal GATE dispatch (default when the repo has a gate)
// or the implementer, per ticket, as it goes (default when it does not).
const prByGate = (repo) => ((repoCfg(repo) || {}).prBy || (gateOf(repo) ? 'gate' : 'implementer')) === 'gate'
const repoTimeout = (repo) => {
  const v = (repoCfg(repo) || {}).timeoutMin
  return Number.isFinite(v) && v > 0 ? v : undefined
}

// Filled by the harness-context loader (execute runs); read by every brief builder below.
let agentMemory = {} // agent name → verbatim entries of <memoryDir>/agents/<agent>.md
let harnessMemory = '' // verbatim entries of <memoryDir>/harness.md
let priorLearnings = [] // learnings from earlier ledgers of this project / these repos

// ═══════════════════════════ REVIEW_PANEL ═══════════════════════════════
// The diverse-lens review panel. All run as a read-only reviewer — the lens differs by
// persona, not by agent type. This table is STRUCTURE only (what the scheduler needs to
// pick a panel); each persona's lens text is `personas/<id>.md`, read by the reviewer.
// `stage` is the SCOPE split: 'spec' per task (fidelity) · 'quality' per task (the
// build-safety core a dependent would inherit) · 'terminal' once per repo at project end
// (polish/compliance over the integrated branch).
// `appliesTo` matches on the repo's TAGS (`args.repos[].tags`), never on repo names — that
// is what makes the panel portable across stacks. '*' means every repo.
const REVIEW_PANEL = [
  { id: 'spec-hawk', name: 'Spec Hawk', stage: 'spec', appliesTo: '*' },
  { id: 'reliability-sre', name: 'Reliability & Release SRE', stage: 'terminal', appliesTo: '*' },
  { id: 'data-integrity', name: 'Eventing & Data-Integrity Engineer', stage: 'quality', appliesTo: ['backend', 'infra'] },
  { id: 'break-it', name: 'Adversarial QA & Integrity', stage: 'quality', appliesTo: '*' },
  { id: 'hig', name: 'Human Interface Reviewer', stage: 'terminal', appliesTo: ['mobile', 'web'] },
  { id: 'accessibility', name: 'Accessibility Lead', stage: 'terminal', appliesTo: ['mobile', 'web'] },
  { id: 'privacy', name: 'Privacy Engineer', stage: 'terminal', appliesTo: '*' },
  { id: 'app-store', name: 'App Store Reviewer', stage: 'terminal', appliesTo: ['mobile'] },
]

// ═══════════════════════════════ schemas ═══════════════════════════════
// Structured I/O contracts. Every agent is forced to return one of these, so the
// script never parses free text. TASK_ITEM_SCHEMA is shared by the planner AND the
// replanner — a revised plan is executable by the exact same machinery.
// What the harness-context loader returns: the memory stores verbatim + prior ledger learnings.
const HARNESS_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    harnessMemory: { type: 'string', description: 'entries of the harness memory file, verbatim (empty string if the file is missing)' },
    agentMemory: {
      type: 'object',
      description: 'agent name → verbatim entries of <memoryDir>/agents/<agent>.md, for each agent named in the prompt',
      additionalProperties: { type: 'string' },
    },
    priorLearnings: { type: 'array', items: { type: 'string' }, description: 'deduplicated `learnings` from earlier run ledgers for the same project or touching the same repos — newest first, at most 20' },
    priorLedgers: { type: 'array', items: { type: 'string' }, description: 'paths of the ledgers read' },
  },
  required: ['harnessMemory', 'agentMemory', 'priorLearnings', 'priorLedgers'],
}
const LEDGER_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'the ledger file written, e.g. runs/2026-09-17-PROJ-600.json' },
    branch: { type: 'string', description: 'the branch the ledger was committed on' },
  },
  required: ['path', 'branch'],
}
const CRYSTALLIZE_SCHEMA = {
  type: 'object',
  properties: {
    reports: { type: 'array', items: { type: 'string' }, description: 'report paths written' },
    skillsCreated: { type: 'array', items: { type: 'string' } },
    skillsPatched: { type: 'array', items: { type: 'string' } },
    memoryEntriesAdded: { type: 'integer' },
    docsSynced: { type: 'array', items: { type: 'string' } },
    prUrl: { type: 'string', description: 'the PR carrying every change (empty string if nothing was written)' },
    summary: { type: 'string', description: 'one screen for the human: what was created/patched and from which signal' },
  },
  required: ['reports', 'skillsCreated', 'skillsPatched', 'memoryEntriesAdded', 'docsSynced', 'prUrl', 'summary'],
}

const TASK_ITEM_SCHEMA = {
  type: 'object',
  required: ['id', 'repo', 'agent', 'slice', 'order', 'taskText', 'deferred'],
  properties: {
    id: { type: 'string', description: 'the tracker issue identifier EXACTLY as listed (e.g. PROJ-123) — the scheduler matches dependsOn/landed work on this, so it must equal the ticket id. A plan-style slice.task id (e.g. 1.2) is allowed ONLY for a replan-invented task that has no tracker issue.' },
    ticket: { type: 'string', description: 'the tracker issue id, or NO_TICKET' },
    repo: { type: 'string', description: 'the owning repo — one of the configured repo names' },
    agent: { type: 'string', description: 'the owning repo agent — one of the configured agent names' },
    model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'per-task build tier for the impl/fix agents; DEFAULTS TO opus when unset — only set a lower tier to intentionally downgrade a trivial task' },
    branch: { type: 'string' },
    slice: { type: 'integer', description: 'the vertical slice this task belongs to (0 = a thin shared enabler; 1, 2, … = increments of value, smallest-valuable-first)' },
    sliceLabel: { type: 'string', description: "the slice's value statement, e.g. 'user earns and sees points'" },
    order: { type: 'integer', description: 'execution order WITHIN its repo, INSIDE its slice (topological)' },
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'tracker ids that BLOCK this task — the scheduler will not run it until every one has landed' },
    taskText: { type: 'string', description: 'the full task steps, verbatim from the issue (or, for a replanned task, self-contained steps an implementer can run unattended)' },
    specExcerpt: { type: 'string' },
    files: { type: 'array', items: { type: 'string' }, description: '"path — what to change"' },
    successCriteria: { type: 'string' },
    deferred: { type: 'boolean', description: 'true if blocked on a deploy or another repo (cannot run unattended)' },
    deferredReason: { type: 'string' },
  },
}

// Phase A output: the WHOLE project as a lightweight slice index — ids, repos, states,
// dependsOn links, titles; never bodies (that is what lets a project of any size fit).
// `inputProblems` is the verification channel: the indexer checks the design artifacts
// FIRST, and any problem it reports aborts the run unstarted.
const INDEX_ISSUE_SCHEMA = {
  type: 'object',
  required: ['id', 'repo', 'state'],
  properties: {
    id: { type: 'string', description: 'the tracker identifier, e.g. PROJ-123' },
    title: { type: 'string' },
    repo: { type: 'string', description: 'the owning repo — one of the configured repo names' },
    state: {
      type: 'string',
      enum: ['todo', 'started', 'done', 'canceled'],
      description: 'bucketed tracker state — done/canceled issues are ABSORBED (count as landed dependencies, never re-implemented)',
    },
    dependsOn: { type: 'array', items: { type: 'string' }, description: "tracker ids of the issues that BLOCK this one (its 'blocked by' relations)" },
  },
}
const SLICE_INDEX_SCHEMA = {
  type: 'object',
  required: ['slices', 'hookProblems'],
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slice', 'issues'],
        properties: {
          slice: { type: 'integer', description: '0 = thin enabler; 1+ = value slices in order' },
          sliceLabel: { type: 'string', description: "the slice's value statement" },
          issues: { type: 'array', items: INDEX_ISSUE_SCHEMA },
        },
      },
    },
    inputProblems: {
      type: 'array',
      items: { type: 'string' },
      description:
        'set (with slices: []) when a design artifact fails verification — the spec or plan file missing/empty, or the tracker project unresolvable / without slice-tagged issues. One entry per problem, naming the artifact and the fix (e.g. "specPath: docs/specs/x.md does not exist — run roast first").',
    },
    hookProblems: {
      type: 'array',
      items: { type: 'string' },
      description:
        'one entry per FAILED required-hook check (empty array when all pass, and ALWAYS an empty array when the prompt did not ask you to probe). Name the check and the fix verbatim as instructed. Independent of the slice index — still return the full index.',
    },
  },
}

// Phase B (hydration) output: ONE dispatch cycle's issues flattened into executable tasks.
// `inputProblems` here reports an issue↔spec/plan contradiction found while hydrating.
const TASK_LIST_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: { type: 'array', items: TASK_ITEM_SCHEMA },
    inputProblems: {
      type: 'array',
      items: { type: 'string' },
      description:
        'set when hydration hits something that must stop the run — an issue that contradicts the plan/spec, or a listed issue that cannot be fetched. One entry per problem, naming the issue and the conflict; never silently pick a side.',
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    // The review range. Workflow scripts have no shell, so these SHAs are the ONLY way the
    // script can tell the panel what to look at — without them every reviewer burns its
    // budget rediscovering the diff and, worse, ends up reading the whole branch while
    // being asked a task-scoped question.
    commits: { type: 'array', items: { type: 'string' }, description: 'the commit SHAs you created, OLDEST FIRST — SHAs, not messages (the review panel is handed exactly this range)' },
    baseSha: { type: 'string', description: 'git merge-base <base branch> HEAD — where this branch left the integration branch (the brief names it)' },
    headSha: { type: 'string', description: 'git rev-parse HEAD after your last commit' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'string' },
    question: { type: 'string', description: 'set only when status is NEEDS_CONTEXT' },
    prUrl: { type: 'string' },
  },
}

// A read-only scout's attempt at a NEEDS_CONTEXT question. `answered` is deliberately
// strict: the scout must have ESTABLISHED the answer from what is in the tree, because a
// confidently-wrong answer here ships a wrong implementation (worse than escalating).
const RESOLVE_SCHEMA = {
  type: 'object',
  required: ['answered'],
  properties: {
    answered: { type: 'boolean', description: 'true ONLY if the answer is established from the repos / schemas / contracts / config / git history — never from assumption or inference about intent' },
    answer: { type: 'string', description: 'required when answered=true: the concrete answer plus where it was found (path:line)' },
    whyNot: { type: 'string', description: 'required when answered=false: why the codebase cannot settle this (e.g. it is a product/UX call, a priority, a cost trade-off, or a decision not yet made)' },
  },
}

// Reviewer output. NOTE the severity contract the script enforces on top of this: only
// `blocker`/`major` gate a task. `minor`/`nit` are collected, reported, and dropped — they
// never trigger a rework round. See runReviewStage.
const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          issue: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

// The guard's verdict on a quality fix. Binary ON PURPOSE: either the fix is verified
// (PASS — the panel is not re-run) or the panel looks again (RE_REVIEW). There is no
// "here are more findings" channel — finding NEW defects is the panel's job, not the
// guard's, and a third option would quietly turn the guard into a one-person panel.
const GUARD_SCHEMA = {
  type: 'object',
  required: ['decision', 'reason'],
  properties: {
    decision: { type: 'string', enum: ['PASS', 'RE_REVIEW'] },
    reason: {
      type: 'string',
      description: 'PASS: how each blocking finding was verified fixed in the diff. RE_REVIEW: which finding is unresolved, or what the fix touched that fresh panel eyes must see.',
    },
  },
}

// The integration step's verdict: a reviewed lane branch either merged into the repo
// run branch or it did not. CONFLICT is a first-class outcome, not an error — the
// scheduler routes it to the replanner (a reviewed diff is never silently rewritten).
const INTEGRATE_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['MERGED', 'CONFLICT', 'ERROR'] },
    detail: { type: 'string', description: 'CONFLICT: the conflicting paths. ERROR: what failed.' },
    headSha: { type: 'string', description: 'MERGED: git rev-parse HEAD of the run branch after the merge' },
  },
}

// Replanner output: a decision to REVISE the remaining plan (A* from the current
// state) or HALT, plus the durable learning(s) the failure taught us.
const REPLAN_SCHEMA = {
  type: 'object',
  required: ['decision', 'reason', 'learnings'],
  properties: {
    decision: { type: 'string', enum: ['REVISE', 'HALT'] },
    reason: { type: 'string', description: 'why REVISE (what the revised path fixes) or why HALT (what blocks us) — short prose ONLY, never a serialized task list' },
    learnings: { type: 'array', items: { type: 'string' }, description: 'durable lesson(s) from this failure, carried into any later replan' },
    tasks: { type: 'array', items: TASK_ITEM_SCHEMA, description: 'the revised REMAINING task list — REQUIRED and non-empty when decision=REVISE, as structured array items HERE (never inlined into reason); only work still to do — never DONE tasks' },
  },
}

// ═══════════════════════════ prompt builders ═══════════════════════════
// Parsing is TWO-PHASE so a FULL project fits: phase A returns a lightweight slice
// INDEX (no bodies), phase B hydrates one cycle of ready issues at a time, just-in-time.
// The design artifacts are verified once, in phase A.
// The harness-context LOADER — scripts cannot read files, so one cheap agent returns the
// memory stores verbatim plus the learnings of earlier ledgers. Read-only.
function harnessContextPrompt(project, repos, agents) {
  return `Load the harness context for an automated build run of tracker project ${project} touching repos: ${repos.join(', ') || '(unknown yet)'}. Read-only; return the structured object.
1. Read \`${MEMORY_DIR}/harness.md\` and, for each of ${agents.join(', ')}, \`${MEMORY_DIR}/agents/<agent>.md\`. Return each file's ENTRIES verbatim (drop the leading HTML comment header and a literal "(no entries yet)" placeholder — return "" for those). Do not summarize or reword entries.
2. List \`${RUNS_DIR}/*.json\` (if the directory exists). Read, newest first, the ledgers whose \`project\` equals ${project} OR whose \`repos\` intersect the list above — at most 8 files. Collect their \`learnings\` arrays, deduplicate (case-insensitive, trimmed), keep newest first, cap at 20, return as priorLearnings and the paths read as priorLedgers.
Missing files/dirs are normal on a fresh harness — return empty values, never an error.`
}
// The "## Your memory" block pasted at the top of every brief, per agent.
function memoryBlock(agent) {
  if (!agent) return ''
  const entries = (agentMemory[agent] || '').trim()
  return `## Your memory (\`${MEMORY_DIR}/agents/${agent}.md\` — curated facts from earlier PRs; binding unless the task contradicts them, then report the contradiction; you never write it)
${entries || '(no entries yet)'}

`
}
// Every dispatch = dynamic header (values only) + this pointer to its Markdown brief.
// Orchestrator-level dispatches (hydrate, replan) get the HARNESS memory — facts about the
// whole pipeline — the way repo agents get their own store.
const harnessBlock = () => (harnessMemory.trim() ? `## Harness memory (\`${MEMORY_DIR}/harness.md\` — facts about this pipeline; you never write it)\n${harnessMemory.trim()}\n\n` : '')
const brief = (name) => `## Brief\nYour FIRST action: Read \`${BRIEFS_DIR}/${name}.md\` — it is the binding rest of this brief (rules, definition of done, how to decide). The header below holds only what is specific to THIS dispatch.\n\n`
const artifacts = () => `Design artifacts (in the orchestrating workspace, NOT inside a cloned repo): spec \`${specPath}\` · plan \`${planPath}\`.`
const ticketTag = (task) => `[${task.ticket || 'NO_TICKET'}]`

// The run LEDGER writer — deterministic content, one cheap agent to put it on disk + push.
function ledgerPrompt(payload) {
  return `${brief('ledger')}- Base branch: \`${BASE_BRANCH}\`
- Branch: \`harness/run-<date>-${payload.projectSlug}\` (date = \`date +%F\`)
- File: \`${RUNS_DIR}/<date>-${payload.projectSlug}.json\`
- Commit message: \`[NO_TICKET] harness: run ledger ${payload.project} <date>\`

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\``
}
// The CRYSTALLIZE dispatch — the harness learning step, once per run, over every PR opened.
function crystallizePrompt({ project, prs, ledger, learnings, contextQuestions, advisoryNotes, halt }) {
  return `${brief('crystallize')}- Tracker project: ${project}
- Ledger branch: \`${ledger.branch}\` · ledger file: \`${ledger.path}\`
- Brief/persona prose this run used: \`${BRIEFS_DIR}/\` · \`${PERSONAS_DIR}/\` · memory: \`${MEMORY_DIR}/\`
- PRs opened by this run:
${prs.map((p) => `  - ${p.repo} — ${p.pr} (task ${p.id})`).join('\n')}
- Learnings the replanner recorded:
${learnings.length ? learnings.map((l) => `  - ${l}`).join('\n') : '  - (none)'}
- NEEDS_CONTEXT questions implementers asked (candidate roast misses):
${contextQuestions.length ? contextQuestions.map((q) => `  - [${q.task}] ${q.question} (answered by ${q.resolvedBy || 'escalation'})`).join('\n') : '  - (none)'}
- Advisory (minor/nit) findings not reworked: ${advisoryNotes.length}
- ${halt ? `The run HALTED: ${halt.reason}` : 'The run drained the project.'}
- PR title: \`[NO_TICKET] crystallize: ${project} — ${prs.length} PR(s)\``
}

// Phase A: the slice index. The required-hook probe is DYNAMIC (execute runs only).
function indexPrompt(project, specPath, planPath, hook) {
  const repoList = [...repoConfig.values()].map((r) => `${r.name} (${r.path})`).join(' · ')
  return `${brief('index')}- Approved spec (\`roast\`): ${specPath}
- Plan (\`to-plan\`): ${planPath}
- Slice-tagged issues (\`to-issues\`): tracker project / parent ticket ${project}
- Repos in this run — map every issue onto exactly one of these names: ${repoList}

${hook ? `## Also VERIFY the required hook — the run refuses to EXECUTE without it
Every agent this run dispatches is an in-process subagent of the session you run in, so it
inherits the session's tool hooks. Run these read-only checks in Bash and report each FAILED one in
"hookProblems" with the fix text given; return an empty array when both pass. Do NOT stop on
failure — still return the slice index.
1. Installed and working: \`${hook.check}\` must succeed. Fix: "${hook.fix}".
2. Registered for this session: the exact string \`${hook.name}\` must appear under
   hooks.PreToolUse in your user settings (~/.claude/settings.json) or in this project's
   .claude/settings.json / .claude/settings.local.json (check with grep). Fix: "${hook.fix}".
   Hooks load only at session start, so a hook added mid-session does not count.` : `Return "hookProblems": [] — this run does not probe for a required hook.`}`
}

// Phase B: hydrate ONE cycle's ready issues — full bodies for these only.
function hydratePrompt(project, issues, learnings) {
  return `${harnessBlock()}${brief('hydrate')}${artifacts()} Tracker project ${project}.

## Fetch the FULL bodies of exactly these issues — no others
${issues.map((i) => `- ${i.id} (${i.repo}, slice ${i.slice ?? 0})${i.title ? ` — ${i.title}` : ''}`).join('\n')}

## The repos and their owning agents — set \`repo\`/\`agent\` from this table
${[...repoConfig.values()].map((r) => `- ${r.name} → agent \`${r.agent}\` (checkout \`${r.path}\`)`).join('\n')}
${
    learnings.length
      ? `\n## Learnings from earlier work in this run — fold them into taskText where relevant, so this work does not repeat a failure:\n${learnings.map((l) => `- ${l}`).join('\n')}\n`
      : ''
  }`
}

function implPrompt(task, fixFindings, resolved) {
  const agent = task.agent || agentFor(task.repo)
  const cfg = repoCfg(task.repo) || {}
  const path = repoPath(task.repo)
  const lane =
    task.lane === 'worktree'
      ? `- **PARALLEL LANE — your own worktree, never the shared checkout.** Lane: \`${WORKTREE_DIR}/${wtName(task)}\` on branch \`${task.laneBranch}\`; run branch \`${task.runBranch}\`. If the worktree already exists, keep working in it. Otherwise create it:
  \`\`\`bash
  git -C ${path} fetch origin
  git -C ${path} rev-parse --verify --quiet ${task.runBranch} && git -C ${path} worktree add ${WORKTREE_DIR}/${wtName(task)} -b ${task.laneBranch} ${task.runBranch} || git -C ${path} worktree add ${WORKTREE_DIR}/${wtName(task)} -b ${task.laneBranch} ${BASE_BRANCH}
  \`\`\`${cfg.laneSetup ? `\n  Lane setup for this repo: ${cfg.laneSetup.replace(/<lane>/g, `${WORKTREE_DIR}/${wtName(task)}`)}` : ''}
  Commit to \`${task.laneBranch}\` ONLY — no merge into \`${task.runBranch}\`, no push, no PR (this overrides the PR rule in the brief).
`
      : ''
  const gate = gateOf(task.repo)
  const gated = prByGate(task.repo)
    ? `- GATED REPO: the PR is opened by the gate dispatch at PROJECT END. Do NOT run \`gh pr create\` here${gate && gate.run ? `, and do NOT run the repo gate (\`${gate.run}\`)` : ''}; commit everything and return.\n`
    : ''
  let out = `${memoryBlock(agent)}${brief('implement')}## Task (${task.id} · ${task.ticket || 'NO_TICKET'}) — from the plan, verbatim
${task.taskText}

## Where it fits
${task.specExcerpt || '(see the spec/plan)'}
${artifacts()}

## Files
${(task.files || []).map((f) => '- ' + f).join('\n')}

## Success criteria
${task.successCriteria || '(tests pass + the steps above)'}

## This dispatch
- Repo: ${path}; branch ${task.branch || '(create the feature branch off ${BASE_BRANCH})'}; PR title tag ${ticketTag(task)}.
${lane}${gated}- Return the structured status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED) with baseSha · commits · headSha.`
  // Answers the resolver already fetched for THIS task, carried into every later dispatch
  // so a re-dispatched implementer never re-asks what has been settled.
  if (resolved && resolved.length)
    out += `

## ✔ Answers to the question(s) you returned earlier — established fact, do not re-ask:
${resolved.map((r) => `- **Q:** ${r.question}\n  **A:** ${r.answer}`).join('\n')}`
  if (fixFindings && fixFindings.length)
    out += `

## ↻ The review panel rejected the previous attempt — fix every item, then re-confirm:
${fixFindings.map((f) => `- [${f.severity}${f.persona ? ` · ${f.persona}` : ''}] ${f.file || '?'}:${f.line || '?'} — ${f.issue}`).join('\n')}`
  return out
}

// Brief for the read-only scout that tries to answer a NEEDS_CONTEXT question.
function resolvePrompt(task, question) {
  return `${brief('resolve')}A build agent working in \`${repoPath(task.repo)}\` stopped and returned ONE question. ${artifacts()}

## The question
${question}

## Its task — CONTEXT ONLY. Do NOT implement any of it, do not modify anything.
${task.taskText}
${(task.files || []).length ? `Files it was pointed at:\n${(task.files || []).map((f) => '- ' + f).join('\n')}` : ''}`
}

// The ONE generic gate dispatch: run the repo's own gate command (when it applies), then
// open the repo's PR. Runs once, at PROJECT END, on the final reviewed tree.
// `hits` = the paths this RUN touched that match `gate.when.pathsMatching`; an empty list
// with a `when` condition configured means the gate command does NOT apply this run.
function gatePrompt(task, gate, hits) {
  const cond = gate && gate.when && Array.isArray(gate.when.pathsMatching) && gate.when.pathsMatching.length
  const applies = !!(gate && gate.run) && (!cond || hits.length > 0)
  const cmdLine = gate && gate.run ? `\`${gate.run}\`` : '(this repo has no gate command)'
  return `${memoryBlock(agentFor(task.repo))}${brief('gate')}- Repo: ${repoPath(task.repo)} · branch ${task.branch || '(the feature branch)'} · ticket ${task.ticket || 'NO_TICKET'} (PR title tag ${ticketTag(task)})
- Gate command: **${applies ? 'APPLIES' : 'does NOT apply'}** — ${cmdLine}${
    applies
      ? `${cond ? `\n- It applies because this run touched ${hits.slice(0, 12).map((h) => `\`${h}\``).join(', ')}${hits.length > 12 ? ` (+${hits.length - 12} more)` : ''}.` : ''}${gate.note ? `\n- Before you run it: ${gate.note}` : ''}
- Run it ONCE, in the FOREGROUND:
  \`\`\`bash
  ${gate.run}
  \`\`\`${gate.stamp ? `\n- Green means \`${gate.stamp}\` == \`git rev-parse 'HEAD^{tree}'\` — the stamp is a TREE HASH, so any later commit invalidates it.` : ''}`
      : cond
        ? ` This branch touches NO path matching ${gate.when.pathsMatching.map((p) => `\`${p}\``).join(', ')}, so there is nothing for it to certify. Do **NOT** run it.`
        : ' There is no gate command for this repo — go straight to the PR.'
  }
- Then \`gh pr create\` with the ticket in the title, using a literal absolute \`cd /path/to/checkout && …\`.`
}

function reviewPrompt(task, mode, persona, range) {
  return `${memoryBlock('reviewer')}${brief('review')}You are reviewing as: **${persona.name}** — your lens is \`${PERSONAS_DIR}/${persona.id}.md\` (read it). Mode: **${mode}**.

Repo: ${repoPath(task.repo)} (branch ${task.branch || '(feature branch)'}). ${artifacts()}
Task (verbatim):
${task.taskText}

Spec excerpt:
${task.specExcerpt || '(see the spec/plan)'}

${rangeBlock(task, range)}`
}

// The review GUARD — verifies a fix against the exact findings that gated.
function guardPrompt(task, gate, fix, fixFrom, range) {
  const r = range || {}
  const path = repoPath(task.repo)
  return `${brief('guard')}Task ${task.id} in \`${path}\` (branch ${task.branch || '(feature branch)'}).

## The blocking findings the fix had to address
${gate.map((f) => `- [${f.severity}${f.persona ? ` · ${f.persona}` : ''}] ${f.file || '?'}:${f.line || '?'} — ${f.issue}`).join('\n')}

## The fix (implementer's summary — verify it, never trust it)
${fix.summary || '(no summary given)'}

## The fix diff
${
    fixFrom && r.headSha
      ? `\`\`\`bash
git -C ${path} diff ${fixFrom}..${r.headSha}        # ← the fix you are judging
\`\`\`
${r.firstSha ? `Whole-task context when you need it: \`git -C ${path} diff ${r.firstSha}^..${r.headSha}\`` : ''}`
      : `The implementer did not report usable SHAs — establish the fix commits yourself before judging:
\`\`\`bash
git -C ${path} log --oneline ${BASE_BRANCH}..HEAD
\`\`\``
  }`
}

// The INTEGRATION step for a parallel lane — mechanical merge, serialized per repo.
function integratePrompt(task) {
  const path = repoPath(task.repo)
  return `${brief('integrate')}Task ${task.id} in \`${path}\`: lane \`${task.laneBranch}\` → run branch \`${task.runBranch}\`.
1. \`git -C ${path} rev-parse --verify --quiet ${task.runBranch}\` — if missing: \`git -C ${path} branch ${task.runBranch} ${BASE_BRANCH}\`.
2. \`git -C ${path} checkout ${task.runBranch}\` then \`git -C ${path} merge --no-ff ${task.laneBranch}\`.
3. Conflict → \`git -C ${path} merge --abort\`, return CONFLICT with the paths.
4. Success → \`git -C ${path} worktree remove --force ${WORKTREE_DIR}/${wtName(task)}\`, \`git -C ${path} branch -D ${task.laneBranch}\`, return MERGED with headSha = \`git -C ${path} rev-parse HEAD\`.`
}

// The re-planner — A* from the CURRENT state when the scheduler is stuck.
function replanPrompt({ goal, done, failures, blocked, learnings, replanNo, maxReplans }) {
  return `${harnessBlock()}${brief('replan')}Replan ${replanNo}/${maxReplans}.

## Goal
${goal}
${artifacts()}

## The repos and their owning agents
${[...repoConfig.values()].map((r) => `- ${r.name} → agent \`${r.agent}\``).join('\n')}

## Already DONE (immutable — never re-emit these)
${done.length ? done.map((d) => `- ${d.id} (${d.repo}) ${d.status} — ${d.summary || ''}`).join('\n') : '- (nothing landed yet)'}

## What FAILED (the reason to replan)
${failures.map((f) => `- ${f.id} (${f.repo}) → ${f.status}\n${f.detail}`).join('\n')}

## Still BLOCKED behind those failures (index level — do NOT re-emit; they run on their own once unblocked)
${(blocked || []).length ? blocked.map((b) => `- ${b.id} (${b.repo}) slice ${b.slice}${(b.dependsOn || []).length ? ` — blocked on: ${b.dependsOn.join(', ')}` : ''}`).join('\n') : '(none — the failures are the only open work)'}

## Learnings carried (earlier replans + prior runs)
${learnings.length ? learnings.map((l) => `- ${l}`).join('\n') : '- (none yet)'}`
}

// ═══════════════════════════════ helpers ═══════════════════════════════
function deferredSummary(list) {
  return list.map((t) => ({ id: t.id, repo: t.repo, reason: t.deferredReason }))
}

// A persona applies to a repo when its `appliesTo` is '*' or intersects the repo's TAGS.
function panelFor(repo, stage) {
  const tags = tagsOf(repo)
  return REVIEW_PANEL.filter(
    (p) => p.stage === stage && (p.appliesTo === '*' || (Array.isArray(p.appliesTo) && p.appliesTo.some((t) => tags.includes(t)))),
  )
}

// ── the gate condition: decided from what the RUN touched, not one task ──
// A gate hook/script typically inspects the WHOLE branch (`git diff origin/main...HEAD`),
// and this workflow lands every task of a repo on ONE run branch. So `gate.when.pathsMatching`
// is evaluated against everything the run recorded for that repo — planned `files` plus the
// `filesChanged` every implementer and every fix actually reported — and only at the terminal
// slot, once the repo's work is complete.
//
// Containment, not exact prefix — deliberately loose: `files` entries arrive as
// "path — what to change", paths may carry a `./` or a repo prefix, and a false POSITIVE costs
// one gate run while a false NEGATIVE gets the PR blocked by the repo's own hook. Err toward
// running the gate.
const touchedByRepo = new Map() // repo → Set of every path this run touched there
function recordTouched(task, result) {
  if (!task || !task.repo) return
  if (!touchedByRepo.has(task.repo)) touchedByRepo.set(task.repo, new Set())
  const set = touchedByRepo.get(task.repo)
  for (const f of task.files || []) set.add(String(f))
  for (const f of (result && result.filesChanged) || []) set.add(String(f))
}
function gateHits(repo) {
  const gate = gateOf(repo)
  const patterns = gate && gate.when && Array.isArray(gate.when.pathsMatching) ? gate.when.pathsMatching : null
  if (!patterns || !patterns.length) return []
  const touched = [...(touchedByRepo.get(repo) || [])]
  return touched
    .filter((s) => {
      const v = String(s || '').toLowerCase()
      return patterns.some((p) => v.includes(String(p).toLowerCase()))
    })
    // a `files` entry arrives as "path — what to change"; report just the path
    .map((s) => String(s).split(' — ')[0].trim())
}

// ── parallel-lane helpers: file footprints + naming ──
// `files` entries arrive as "path — what to change"; compare on the normalized path part.
// A task with NO declared files has an unknown footprint and never shares its repo.
function fileKey(s) {
  return String(s || '').split(' — ')[0].trim().toLowerCase().replace(/^\.\//, '')
}
function filesOf(t) {
  return (t.files || []).map(fileKey).filter(Boolean)
}
function wtName(t) {
  return `${t.repo}--${String(t.id).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

// ── the review range: tell the panel exactly what to judge ──
// A workflow script has no shell, so the range can only come from the implementer's own
// structured return. Anything that is not a plausible SHA is DISCARDED and we fall back to
// "reviewer, find the diff yourself" — a non-compliant agent must degrade, never hand the
// panel a bogus range.
const SHA_RE = /^[0-9a-f]{7,40}$/
const asSha = (v) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return SHA_RE.test(s) ? s : null
}

// Fold an implementer result into the range. `prev` pins the task's ORIGIN (base + first
// commit) so a fix dispatch only ever advances HEAD — the panel keeps reviewing the whole
// task, including its fixes, and never narrows to just the last fix.
function reviewRange(impl, prev) {
  const commits = (((impl && impl.commits) || []).map(asSha)).filter(Boolean)
  return {
    baseSha: (prev && prev.baseSha) || asSha(impl && impl.baseSha),
    firstSha: (prev && prev.firstSha) || commits[0] || null,
    headSha: asSha(impl && impl.headSha) || commits[commits.length - 1] || (prev && prev.headSha) || null,
  }
}

function rangeBlock(task, range) {
  const r = range || {}
  const path = repoPath(task.repo)
  if (!r.firstSha || !r.headSha)
    return `## The diff to judge
The implementer did not report usable commit SHAs, so establish the range yourself before reviewing:
\`\`\`bash
git -C ${path} log --oneline ${BASE_BRANCH}..HEAD
\`\`\`
Read the ACTUAL diff — do not trust a summary of it.`
  const from = `${r.firstSha}^`
  return `## The exact diff to judge — it is handed to you, do not go hunting for it
\`\`\`bash
git -C ${path} diff ${from}..${r.headSha}        # ← THIS is the change you are judging
git -C ${path} log --oneline ${from}..${r.headSha}
\`\`\`
${
    r.baseSha && r.baseSha !== r.firstSha
      ? `Commits before \`${r.firstSha}\` on this branch (back to the branch point \`${r.baseSha}\`) belong to EARLIER tasks. They are context, not your subject — do not re-report findings against them.\n`
      : ''
  }Read surrounding files freely for context, but your verdict is about the range above. Do not trust a summary of it.`
}

// The severity contract: blocker/major GATE a task, minor/nit ride along as advisory.
// A fix round costs a full implementation dispatch, so this predicate is what stops a
// naming nit from buying one.
const GATING_SEVERITY = new Set(['blocker', 'major'])
const isGating = (f) => GATING_SEVERITY.has(String((f && f.severity) || '').toLowerCase())

// Turn a failed task result into a compact, actionable brief for the re-planner.
function failureDetail(r) {
  if (r.status === 'NEEDS_CONTEXT') return `  question: ${r.impl?.question || '(unspecified)'}`
  if (r.status === 'DIED')
    return '  the implementer agent died without returning a result — a terminal API error (spend limit / outage) or a user skip, NOT a judgement on the task itself; safe to requeue once the dispatches succeed again'
  // Checked BEFORE r.review: a GATE_FAILED result carries a PASSING review, so the review
  // summary would report success on a task that never shipped.
  if (r.status === 'GATE_FAILED')
    return `  the repo gate / PR failed AFTER the review panel passed — the gate caught something review did not, or it could not run:\n    ${r.gate ? `${r.gate.status}: ${r.gate.summary || r.gate.concerns || '(no detail)'}` : 'the gate dispatch died or timed out'}`
  if (r.status === 'TERMINAL_REVIEW_FAILED') {
    const blocking = ((r.review && r.review.findings) || []).filter(isGating)
    return (
      `  the repo-level TERMINAL quality sweep failed on the integrated run branch AFTER every per-task review passed — it gates the repo's PR:\n    ${r.review ? r.review.summary || '(no summary)' : 'the sweep dispatch died'}` +
      (blocking.length ? '\n' + blocking.map((f) => `    [${f.severity}${f.persona ? ' · ' + f.persona : ''}] ${f.file || '?'}:${f.line || '?'} — ${f.issue}`).join('\n') : '')
    )
  }
  if (r.status === 'MERGE_CONFLICT')
    return `  the lane branch passed the full review panel but did NOT merge into the repo run branch (its worktree + branch were left in place for inspection):\n    ${r.integrate ? `${r.integrate.status}: ${r.integrate.detail || '(no detail)'}` : 'the integrate dispatch died or timed out'}`
  if (r.review) {
    const blocking = (r.review.findings || []).filter(isGating)
    const head = `  ${r.review.summary || ''}`
    if (!blocking.length) return head
    return head + '\n' + blocking.map((f) => `    [${f.severity}${f.persona ? ' · ' + f.persona : ''}] ${f.file || '?'}:${f.line || '?'} — ${f.issue}`).join('\n')
  }
  if (r.impl?.concerns) return `  concerns: ${r.impl.concerns}`
  if (r.error) return `  error: ${r.error}`
  return '  (no detail captured)'
}

// ── telemetry — the "is it stuck? how expensive?" instrumentation ──
// budget.spent() is the ONLY usage counter a workflow script gets: it is
// cumulative OUTPUT tokens for the whole turn (shared across the main loop and
// every workflow). We snapshot it around a step to get that step's output-token
// delta. It is accurate for SEQUENTIAL steps (parse, replan, contract) and for a
// whole slice wrapped as one block; per-agent deltas INSIDE a parallel block are
// not separable, so we never print those — we print block totals + start/finish
// markers.
const telemetry = []
let stepNo = 0
const spentTokens = () => {
  try {
    return budget.spent()
  } catch (e) {
    return null // budget unavailable in this environment — degrade to markers only
  }
}
function fmtTok(n) {
  if (n == null) return 'n/a'
  const a = Math.abs(n)
  if (a >= 1000000) return (n / 1000000).toFixed(2) + 'M'
  if (a >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
// Wrap a SEQUENTIAL step (or a whole slice) so it announces start + finish and
// reports the OUTPUT tokens it consumed plus the running cumulative.
async function step(label, thunk) {
  const n = ++stepNo
  const before = spentTokens()
  log(`▶ [${n}] ${label} — running…`)
  const result = await thunk()
  const after = spentTokens()
  const delta = before != null && after != null ? after - before : null
  telemetry.push({ step: n, label, outputTokens: delta, cumulativeOutputTokens: after })
  log(`✓ [${n}] ${label} — done · ${delta != null ? '+' + fmtTok(delta) + ' output tok' : 'tokens n/a'}${after != null ? ` · ${fmtTok(after)} total` : ''}`)
  return result
}

// ═══════════════════════ 0 · obtain the task DAG ═══════════════════════
phase('Parse plan')

// Normalize args — it may arrive as an object or a JSON STRING (a footgun that silently
// dropped flags). A bare string can never satisfy the input gate below, so it is mapped to
// {planPath} only to make the resulting missing-inputs error name what else is required.
let opts = args
if (typeof opts === 'string') {
  const s = opts.trim()
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      opts = JSON.parse(s)
    } catch (e) {
      opts = {}
    }
  } else {
    opts = { planPath: s }
  }
}
opts = opts || {}

// SAFETY: execution is OPT-IN. Without {execute:true} we only parse + preview (no
// implementers, no commits, no PRs) — so bad/missing args fail SAFE, never destructive.
const execute = opts.execute === true
// Explicit escape hatch for the required-hook gate (only meaningful when one is configured).
const skipHookCheck = opts.skipHookCheck === true
// Outer-loop bound: how many times a failed slice may re-plan before we HALT.
const MAX_REPLANS = Number.isInteger(opts.maxReplans) && opts.maxReplans >= 0 ? opts.maxReplans : DEFAULT_MAX_REPLANS
// Inner-loop bound: fixes per review stage before it returns FAIL and the slice can replan.
const MAX_FIX_ATTEMPTS = Number.isInteger(opts.maxFixAttempts) && opts.maxFixAttempts >= 0 ? opts.maxFixAttempts : DEFAULT_MAX_FIX_ATTEMPTS
// Cheapest loop: scout-answered NEEDS_CONTEXT questions per implementer dispatch.
const MAX_CONTEXT_RESOLVES =
  Number.isInteger(opts.maxContextResolves) && opts.maxContextResolves >= 0 ? opts.maxContextResolves : DEFAULT_MAX_CONTEXT_RESOLVES
// Per-agent HANG backstop (see withTimeout). Feature-detected, so it never regresses a run.
const AGENT_TIMEOUT_MIN = Number.isFinite(opts.agentTimeoutMin) && opts.agentTimeoutMin >= 0 ? opts.agentTimeoutMin : DEFAULT_AGENT_TIMEOUT_MIN
// Within-repo parallelism cap: tasks in flight per repo.
const MAX_PER_REPO = Number.isInteger(opts.maxPerRepo) && opts.maxPerRepo >= 1 ? opts.maxPerRepo : DEFAULT_MAX_PER_REPO

// Paths — defaults are the repo layout, but a skill installed under .claude/skills/ can
// point the brief/persona directories at wherever it landed.
const dirOpt = (v, d) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : d)
MEMORY_DIR = dirOpt(opts.memoryDir, DEFAULT_MEMORY_DIR)
RUNS_DIR = dirOpt(opts.runsDir, DEFAULT_RUNS_DIR)
BRIEFS_DIR = dirOpt(opts.briefsDir, DEFAULT_BRIEFS_DIR)
PERSONAS_DIR = dirOpt(opts.personasDir, DEFAULT_PERSONAS_DIR)
WORKTREE_DIR = dirOpt(opts.worktreeDir, DEFAULT_WORKTREE_DIR)
BASE_BRANCH = typeof opts.baseBranch === 'string' && opts.baseBranch.trim() ? opts.baseBranch.trim() : DEFAULT_BASE_BRANCH

// The required-hook gate is OFF by default: {requireHook:{name, check, fix?}} turns it on.
const requireHook =
  opts.requireHook && typeof opts.requireHook === 'object' && typeof opts.requireHook.name === 'string' && typeof opts.requireHook.check === 'string'
    ? {
        name: opts.requireHook.name,
        check: opts.requireHook.check,
        fix: typeof opts.requireHook.fix === 'string' && opts.requireHook.fix.trim() ? opts.requireHook.fix.trim() : `install the tool and register the \`${opts.requireHook.name}\` PreToolUse hook, then restart the session`,
      }
    : null

// ── repo configuration: the ONLY place a stack enters this workflow ──
// [{ name, path?, agent, tags?, gate?, prBy?, timeoutMin?, laneSetup? }]
const repoList = Array.isArray(opts.repos)
  ? opts.repos
      .filter((r) => r && typeof r.name === 'string' && r.name.trim() && typeof r.agent === 'string' && r.agent.trim())
      .map((r) => ({
        name: r.name.trim(),
        path: dirOpt(r.path, `${DEFAULT_REPO_ROOT}/${r.name.trim()}`),
        agent: r.agent.trim(),
        tags: Array.isArray(r.tags) ? r.tags.filter((t) => typeof t === 'string') : [],
        gate: r.gate && typeof r.gate === 'object' ? r.gate : null,
        prBy: r.prBy === 'gate' || r.prBy === 'implementer' ? r.prBy : undefined,
        timeoutMin: Number.isFinite(r.timeoutMin) ? r.timeoutMin : undefined,
        laneSetup: typeof r.laneSetup === 'string' ? r.laneSetup : undefined,
      }))
  : []
repoConfig = new Map(repoList.map((r) => [r.name, r]))
// Teach the schemas which repos/agents exist, so an agent cannot invent one.
if (repoList.length) {
  const names = repoList.map((r) => r.name)
  const agents = [...new Set(repoList.map((r) => r.agent))]
  TASK_ITEM_SCHEMA.properties.repo.enum = names
  TASK_ITEM_SCHEMA.properties.agent.enum = agents
  INDEX_ISSUE_SCHEMA.properties.repo.enum = names
}

// Race an agent() against a wall-clock timer. If the timer wins we resolve to
// null — the SAME value the runtime already returns when a subagent dies — so
// every existing `if (!x)` / null-filter routes a HANG into the fix/replan
// machinery instead of blocking the step forever. Feature-detected: with no
// real timer (or {agentTimeoutMin:0}) it returns the promise untouched. The
// timer uses no Date/Math.random, so resume + result-caching are unaffected.
function withTimeout(promise, ms, label, mins) {
  if (!(ms > 0) || typeof setTimeout !== 'function') return promise
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => {
      if (settled) return
      settled = true
      if (typeof clearTimeout === 'function') clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      // The EFFECTIVE minutes, not the global — a step with a longer allowance
      // must not report the global number and send someone hunting for a
      // timeout that never fired at that value.
      log(`⏳ [timeout] ${label} exceeded ${mins}m — treating as died (routes to fix/replan)`)
      done(null)
    }, ms)
    promise.then((v) => done(v), () => done(null))
  })
}
// Every agent dispatch goes through this so the hang backstop is uniform, except
// where a step has a documented longer floor: pass `timeoutMin` to raise it for
// THAT dispatch only. `timeoutMin` is stripped before agent() sees it — the
// runtime's opts schema is closed, so an unknown key would be a validation error.
// A globally disabled backstop ({agentTimeoutMin:0}) stays disabled: an override
// may only lengthen a live timer, never resurrect one the caller turned off.
const agentT = (prompt, o) => {
  const { timeoutMin, ...rest } = o || {}
  const mins = AGENT_TIMEOUT_MIN > 0 && Number.isFinite(timeoutMin) && timeoutMin > AGENT_TIMEOUT_MIN ? timeoutMin : AGENT_TIMEOUT_MIN
  return withTimeout(agent(prompt, rest), mins * 60 * 1000, rest.label || 'agent', mins)
}

// ── the pipeline-input gate: no design artifacts, no run ──
// This loop is the BUILD half of the pipeline. It only builds what the design half
// actually produced, so its three artifacts are REQUIRED — there are no fallback
// sources (a pre-extracted {tasks:[...]} or a bare plan file would bypass roast):
//   roast     → the approved spec         {specPath: "docs/specs/<file>.md"}
//   to-plan   → the plan                  {planPath: "docs/plans/<file>.md"}
//   to-issues → the slice-tagged issues   {project:  "<tracker project or parent ticket>"}
// plus {repos} — without it the loop knows no checkout, no agent and no gate.
// Presence is checked HERE, before anything is dispatched. Existence/shape is
// verified by the index agent (a workflow script has no filesystem access), whose
// `inputProblems` abort the run before any implementer runs.
const specPath = typeof opts.specPath === 'string' && opts.specPath.trim() ? opts.specPath.trim() : null
const planPath = typeof opts.planPath === 'string' && opts.planPath.trim() ? opts.planPath.trim() : null
const project =
  (typeof opts.project === 'string' && opts.project.trim()) || (typeof opts.ticket === 'string' && opts.ticket.trim()) || null
const missingInputs = [
  !specPath && 'specPath — the approved spec from `roast` (docs/specs/<file>.md)',
  !planPath && 'planPath — the plan from `to-plan` (docs/plans/<file>.md)',
  !project && 'project — the slice-tagged tracker project / parent ticket from `to-issues`',
  !repoList.length && 'repos — [{name, path?, agent, tags?, gate?, prBy?}] for every repo this project touches',
].filter(Boolean)
if (missingInputs.length) {
  log(`⛔ not started — missing input(s): ${missingInputs.map((m) => m.split(' — ')[0]).join(', ')}`)
  return {
    error: 'missing_pipeline_inputs',
    missing: missingInputs,
    note: 'NOT STARTED — no agents dispatched. This workflow builds only what the design half produced: run the missing skill(s), then re-invoke with {specPath, planPath, project, repos} (+ {execute:true} to run).',
  }
}

// A short, human-readable reference to the goal — handed to the re-planner.
const goalRef = `${project} — spec: ${specPath} · plan: ${planPath}`

// ── phase A: the slice INDEX (lightweight — no issue bodies) ──
// One agent cannot absorb a full project in a single structured return (taskText is the
// full issue body verbatim), so the indexer only verifies the artifacts and lists every
// issue's id/repo/state/dependsOn — the scheduler hydrates each cycle just-in-time.
const index = await step('verify design artifacts + slice index (whole project)', () =>
  agentT(indexPrompt(project, specPath, planPath, execute && !skipHookCheck ? requireHook : null), {
    label: 'parse-index',
    phase: 'Parse plan',
    model: 'opus',
    schema: SLICE_INDEX_SCHEMA,
  }),
)
if (!index) return { error: 'parse_failed', note: `Could not index ${project} (spec ${specPath} · plan ${planPath})` }
if (Array.isArray(index.inputProblems) && index.inputProblems.length) {
  log(`⛔ not started — design artifact(s) failed verification: ${index.inputProblems.join(' · ')}`)
  return {
    error: 'invalid_pipeline_inputs',
    problems: index.inputProblems,
    note: 'NOT STARTED — no implementers dispatched. Fix the named artifact(s) (re-run roast / to-plan / to-issues), then re-invoke.',
  }
}

// The required-hook gate. Probed only when one is CONFIGURED and this run can act on it
// (execute, no override): the indexer checked the session it runs in — the same process
// every implementer / reviewer / scout below runs in — so a missing hook means the WHOLE
// run would be dispatched without it. Refuse.
if (execute && requireHook && !skipHookCheck) {
  const hookProblems = Array.isArray(index.hookProblems) ? index.hookProblems : []
  if (hookProblems.length) {
    log(`⛔ not started — required hook missing: ${hookProblems.join(' · ')}`)
    return {
      error: 'required_hook_missing',
      problems: hookProblems,
      note: `NOT STARTED — no implementers dispatched. Every dispatched agent inherits this session's tool hooks, so the loop only executes from a session where \`${requireHook.name}\` is installed and registered (hooks load at session start). Fix the named check(s), restart the session and re-invoke, or pass {skipHookCheck:true} to run without it on purpose.`,
    }
  }
  log(`✓ required hook verified — ${requireHook.name} installed and registered`)
} else if (execute && requireHook) {
  log(`⚠ skipHookCheck=true — ${requireHook.name} NOT verified, running unverified on purpose`)
}

// Issues already done/canceled in the tracker are ABSORBED: they count as landed
// dependencies and are never re-implemented — re-invoking a partially-landed
// project (an earlier run, a human, a halt) RESUMES instead of redoing.
const isSettled = (s) => s === 'done' || s === 'canceled'
const alreadyDone = []
const pendingIndex = [] // {id, title, repo, state, dependsOn, slice, sliceLabel} still to run
for (const s of [...(index.slices || [])].sort((a, b) => (a.slice ?? 0) - (b.slice ?? 0))) {
  for (const i of s.issues || []) {
    const entry = { ...i, slice: s.slice ?? 0, sliceLabel: s.sliceLabel || '' }
    if (isSettled(i.state)) alreadyDone.push({ id: i.id, repo: i.repo, slice: entry.slice, state: i.state })
    else pendingIndex.push(entry)
  }
}
const alreadyDoneIds = new Set(alreadyDone.map((d) => d.id))
const inProject = new Set([...pendingIndex.map((i) => i.id), ...alreadyDoneIds])
log(
  `${pendingIndex.length} issue(s) to run across ${new Set(pendingIndex.map((i) => i.slice)).size} slice(s) · ${alreadyDone.length} already done/canceled (absorbed) · ` +
    `mode=${execute ? 'EXECUTE' : 'PREVIEW (no implementers)'} · scheduling=dependsOn-driven · maxPerRepo=${MAX_PER_REPO} (disjoint-file lanes) · maxReplans=${MAX_REPLANS} · maxFixAttempts=${MAX_FIX_ATTEMPTS} · maxContextResolves=${MAX_CONTEXT_RESOLVES} · agentTimeout=${AGENT_TIMEOUT_MIN ? AGENT_TIMEOUT_MIN + 'm' : 'off'}`,
)
if (pendingIndex.length === 0) {
  return { done: [], needsAttention: [], alreadyDone, note: 'Nothing to run — every issue in the project is already done or canceled.' }
}

// DEFAULT = PREVIEW: stop after the index and show the dependency DAG + the review panel
// each repo would draw. Implementers run ONLY when {execute:true} was explicitly passed —
// so a forgotten or malformed flag can never trigger a real run (it fails safe to a preview).
if (!execute) {
  const startable = (i) => (i.dependsOn || []).every((d) => alreadyDoneIds.has(d) || !inProject.has(d))
  const planView = [...new Set(pendingIndex.map((i) => i.slice))].sort((a, b) => a - b).map((sliceNum) => {
    const issues = pendingIndex.filter((i) => i.slice === sliceNum)
    return {
      slice: sliceNum,
      label: issues.find((i) => i.sliceLabel)?.sliceLabel || '',
      issues: issues.map((i) => ({ id: i.id, repo: i.repo, state: i.state, title: i.title || '', dependsOn: i.dependsOn || [], startable: startable(i) })),
    }
  })
  const reviewPanels = Object.fromEntries(
    [...new Set(pendingIndex.map((i) => i.repo))].map((repo) => [repo, { spec: panelFor(repo, 'spec').map((p) => p.name), quality: panelFor(repo, 'quality').map((p) => p.name), terminal: panelFor(repo, 'terminal').map((p) => p.name) }]),
  )
  const repoView = Object.fromEntries(
    repoList.map((r) => [r.name, { path: r.path, agent: r.agent, tags: r.tags, gate: r.gate ? r.gate.run || '(no command)' : null, prBy: prByGate(r.name) ? 'gate' : 'implementer' }]),
  )
  return { preview: true, note: 'PREVIEW ONLY — index level (no hydration), no implementers ran. Scheduling is dependsOn-driven: "startable" issues run first, in parallel across repos AND within a repo when their declared files are disjoint (worktree lanes, up to maxPerRepo). Re-invoke with {execute:true} to dispatch.', inputs: { specPath, planPath, project }, repos: repoView, plan: planView, reviewPanels, alreadyDone, maxPerRepo: MAX_PER_REPO, maxReplans: MAX_REPLANS, maxFixAttempts: MAX_FIX_ATTEMPTS, maxContextResolves: MAX_CONTEXT_RESOLVES, agentTimeoutMin: AGENT_TIMEOUT_MIN }
}

// ═══════════════════════ 1 · per-task lifecycle ═══════════════════════
// implement → spec review (Spec Hawk) → quality core review (the per-task build-safety
// lenses, in parallel; the polish/compliance lenses run once per repo in the terminal sweep)
// Each review stage runs its applicable panel, aggregates verdicts, routes ALL failing
// findings back to the SAME implementer, and re-reviews — always ending on a review
// OR a guard-verified fix. This is the INNER (fix) loop; it retries the SAME task,
// it does not replan.

// Guard telemetry: how many quality fixes the guard checked, how many it passed
// without a panel re-run (the saving), and how many it sent back to the full panel.
const guardChecks = { checked: 0, passed: 0, reReviewed: 0 }
// Review-loop telemetry: is the review strategy earning its cost?
// `passedFirstRound / stages` is the waved-through rate; `fixDispatches` is the real
// rework (each one a full opus dispatch); the finding split says whether reviewers
// mostly produce gates (load-bearing) or advisory notes (candidates for slimming).
const reviewStats = { stages: 0, passedFirstRound: 0, fixDispatches: 0, gatingFindings: 0, advisoryFindings: 0 }
async function runReviewStage(task, mode, personas, phaseName, resolved, range) {
  if (personas.length === 0) return { verdict: 'PASS', findings: [], advisory: [], summary: 'no applicable reviewers' }
  reviewStats.stages++
  log(`   · ${task.id} (${task.repo}): ${mode} review — ${personas.length} reviewer(s)…`)
  let aggregate = null
  for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    const reviews = (
      await parallel(
        personas.map((p) => () =>
          agentT(reviewPrompt(task, mode, p, range), {
            label: `${p.id}:${task.id}${attempt ? `#${attempt}` : ''}`,
            phase: phaseName,
            model: 'sonnet',
            agentType: 'reviewer',
            schema: VERDICT_SCHEMA,
          }).then((v) => (v ? { persona: p.name, v } : null)),
        ),
      )
    ).filter(Boolean)

    if (reviews.length === 0) return { verdict: 'FAIL', findings: [], advisory: [], summary: 'reviewers unavailable (all died)' }

    const findings = reviews.flatMap((r) => (r.v.findings || []).map((f) => ({ ...f, persona: r.persona })))
    // ── THE GATE: severity decides, not the verdict flag ──
    // blocker/major → rework. minor/nit → advisory, reported, no rework (a fix round costs a
    // full implementation dispatch, which a naming nit does not justify).
    // One exception, so the gate can't be talked past: a reviewer that returns FAIL with NO
    // findings at all gave us nothing to verify, so we cannot classify it as a nit — it gates,
    // carrying its summary as a synthesized major.
    const gating = findings.filter(isGating)
    const advisory = findings.filter((f) => !isGating(f))
    const voidFails = reviews.filter((r) => r.v.verdict === 'FAIL' && !(r.v.findings || []).length)
    const gate = gating.concat(
      voidFails.map((r) => ({
        severity: 'major',
        file: '?',
        line: 0,
        issue: `${r.persona} returned FAIL without any finding — unverifiable, treated as blocking: ${r.v.summary || '(no summary given)'}`,
        persona: r.persona,
      })),
    )
    const softFails = reviews.filter((r) => r.v.verdict === 'FAIL' && (r.v.findings || []).length && !(r.v.findings || []).some(isGating))

    aggregate = {
      verdict: gate.length ? 'FAIL' : 'PASS',
      findings,
      advisory,
      summary: gate.length
        ? `${gate.length} blocking finding(s) from ${[...new Set(gate.map((f) => f.persona))].join(', ')}` +
          (advisory.length ? ` · ${advisory.length} advisory note(s) not gating` : '')
        : `${reviews.length} reviewer(s) passed the gate` +
          (advisory.length ? ` · ${advisory.length} advisory note(s) recorded (minor/nit — reported, no rework)` : '') +
          (softFails.length ? ` · ${softFails.length} FAIL(s) carried only minor/nit findings and did NOT gate: ${softFails.map((r) => r.persona).join(', ')}` : ''),
    }
    reviewStats.gatingFindings += gate.length
    reviewStats.advisoryFindings += advisory.length
    if (!gate.length) {
      if (attempt === 0) reviewStats.passedFirstRound++
      log(`   · ${task.id}: ${mode} PASS${advisory.length ? ` · ${advisory.length} advisory note(s), no rework` : ''}${softFails.length ? ` · ${softFails.length} nit-only FAIL(s) not gated` : ''}`)
      return aggregate
    }
    if (attempt === MAX_FIX_ATTEMPTS) break // out of fix budget — return this FAIL

    // Route ONLY the gating findings back to the SAME implementer. Advisory notes are
    // deliberately withheld from the fix brief: including them re-imports exactly the
    // rework this gate exists to prevent. They surface in the run summary instead.
    log(`   · ${task.id}: ${mode} FAIL — ${aggregate.summary}; fix attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS}…`)
    const fixFrom = range && range.headSha // HEAD before the fix — isolates the fix's own diff for the guard
    reviewStats.fixDispatches++
    const fix = await dispatchImpl(task, gate, resolved || [], `fix:${task.id}:${mode}#${attempt + 1}`)
    if (!fix || fix.status === 'BLOCKED' || fix.status === 'NEEDS_CONTEXT') {
      return { verdict: 'FAIL', findings, advisory, summary: `implementer ${fix ? fix.status : 'died'} during ${mode} fix` }
    }
    // The fix moved HEAD — advance the range in place so the re-review (and the later quality
    // stage) judges the fixed code, not the stale range.
    if (range) Object.assign(range, reviewRange(fix, range))
    // A fix can pull in files the original task never touched — so it feeds the gate-condition
    // decision too.
    recordTouched(task, fix)

    // ── the GUARD: does the full panel need to see this fix? ──
    // The FIRST review is always the full panel (attempt 0 above) — the guard only ever
    // gates RE-reviews. MULTI-reviewer stages only: a single-reviewer re-review (spec,
    // or a repo whose quality core is one lens) costs exactly what the guard costs, so
    // a guard there saves nothing. PASS ends the stage with the fix verified and the
    // panel not re-run; RE_REVIEW (or a dead guard — fail safe to the panel) loops into
    // a fresh full-panel round.
    if (mode !== 'spec' && personas.length > 1) {
      guardChecks.checked++
      const g = await agentT(guardPrompt(task, gate, fix, fixFrom, range), {
        label: `guard:${task.id}#${attempt + 1}`,
        phase: phaseName,
        model: 'sonnet',
        agentType: 'reviewer',
        schema: GUARD_SCHEMA,
      })
      if (g && g.decision === 'PASS') {
        guardChecks.passed++
        log(`   · ${task.id}: guard verified the fix — quality panel NOT re-run${g.reason ? ` (${g.reason.slice(0, 140)})` : ''}`)
        return {
          verdict: 'PASS',
          findings,
          advisory,
          summary:
            `${gate.length} blocking finding(s) fixed; guard verified the fix — panel not re-run` +
            (advisory.length ? ` · ${advisory.length} advisory note(s) recorded (minor/nit — reported, no rework)` : ''),
        }
      }
      guardChecks.reReviewed++
      log(`   · ${task.id}: guard → RE_REVIEW${g && g.reason ? ` — ${g.reason.slice(0, 140)}` : g ? '' : ' (guard died — failing safe to the full panel)'}`)
    }
  }
  return aggregate // exhausted fixes — last FAIL (already re-reviewed or guard-rejected)
}

// ── the cheapest escalation rung: answer the question instead of replanning ──
// Most NEEDS_CONTEXT questions are DISCOVERABLE FACTS, not decisions. Letting one escalate
// straight to the replanner costs an opus replan + a fresh opus implementer; answering it
// with a read-only scout costs one cheap agent and keeps the SAME implementer going. So:
// scout first, replan only for what code cannot settle.
// A contract-shaped question goes to the contract checker; everything else to a codebase
// scout. Both run on their agent definition's model — deliberately no `model` override
// here, that is the whole point of this rung being cheap.
const CONTRACT_Q = /\b(proto|grpc|schema|contract|migration|table|column|envelope|endpoint|api|topic|openapi|graphql)\b/i
// Rung telemetry. A high `asked` means the SPEC was underspecified — that is a signal for
// roast/to-issues, not a fault of this rung. `escalated` is what actually reached a human.
const contextResolves = { asked: 0, answered: 0, escalated: 0, questions: [] }
async function resolveContext(task, question, n) {
  contextResolves.asked++
  const agentType = CONTRACT_Q.test(question) ? 'contract-checker' : 'codebase-scout'
  log(`   · ${task.id}: NEEDS_CONTEXT → ${agentType} (${n}/${MAX_CONTEXT_RESOLVES}) before escalating — "${question.slice(0, 140)}"`)
  const r = await agentT(resolvePrompt(task, question), {
    label: `resolve:${task.id}#${n}`,
    phase: 'Implement',
    agentType,
    schema: RESOLVE_SCHEMA,
  })
  if (r && r.answered && (r.answer || '').trim()) {
    contextResolves.answered++
    contextResolves.questions.push({ task: task.id, question, resolvedBy: agentType })
    log(`   · ${task.id}: answered from the codebase — re-dispatching the implementer (no replan)`)
    return r
  }
  contextResolves.escalated++
  contextResolves.questions.push({ task: task.id, question, escalated: true, whyNot: (r && r.whyNot) || 'scout died' })
  log(`   · ${task.id}: not answerable from the codebase${r && r.whyNot ? ` — ${r.whyNot}` : r ? '' : ' (scout died)'} → escalating`)
  return null
}

// Every implementer dispatch goes through this, so the resolve rung is uniform: a returned
// NEEDS_CONTEXT is answered and retried in-place, and only an UNANSWERABLE one escalates.
// `resolved` accumulates Q→A for the task and is threaded into every later prompt.
async function dispatchImpl(task, fixFindings, resolved, label) {
  // A repo may declare a longer floor for ITS dispatches — e.g. one whose focused test runs
  // share infrastructure with a machine-global-locked gate and can queue before starting.
  const timeoutMin = repoTimeout(task.repo)
  let out = await agentT(implPrompt(task, fixFindings, resolved), {
    label,
    phase: 'Implement',
    model: task.model || 'opus',
    agentType: task.agent,
    schema: IMPL_SCHEMA,
    timeoutMin,
  })
  for (let n = 1; out && out.status === 'NEEDS_CONTEXT' && n <= MAX_CONTEXT_RESOLVES; n++) {
    const q = ((out && out.question) || '').trim()
    if (!q) {
      log(`   · ${task.id}: NEEDS_CONTEXT with no question — escalating`)
      break
    }
    const ans = await resolveContext(task, q, n)
    if (!ans) break // a human decision (or the scout died) — let it escalate to the replanner
    resolved.push({ question: q, answer: ans.answer })
    out = await agentT(implPrompt(task, fixFindings, resolved), {
      label: `${label}+ctx${n}`,
      phase: 'Implement',
      model: task.model || 'opus',
      agentType: task.agent,
      schema: IMPL_SCHEMA,
      timeoutMin,
    })
  }
  return out
}

// ── the integration queue: lane merges are SERIALIZED per repo ──
// Lane tasks run in parallel, but two merges racing into the same run branch (and the
// same shared checkout) would corrupt both — so each repo's integrations form a promise
// chain. A rejected/failed link must not poison the chain for the next lane. Under
// continuous dispatch a lane can also be admitted NEXT TO an in-flight DIRECT task,
// which occupies the primary checkout the merge runs in — so the chain additionally
// waits for that task (directDone, set by startTask) before merging. No deadlock:
// a direct task never integrates, so it can never wait on this chain.
const mergeQueues = {} // repo → tail of that repo's integration chain
function integrateLane(task) {
  const dispatch = () =>
    agentT(integratePrompt(task), {
      label: `integrate:${task.id}`,
      phase: 'Implement',
      model: 'sonnet',
      agentType: task.agent,
      schema: INTEGRATE_SCHEMA,
    })
  const after = Promise.all([mergeQueues[task.repo] || null, directDone[task.repo] || null])
  const p = after.then(dispatch, dispatch)
  mergeQueues[task.repo] = p.catch(() => null) // keep the chain alive past a failure
  return p
}

async function runTask(task) {
  log(`   · ${task.id} (${task.repo}): implementing…`)
  const resolved = [] // Q→A the resolver settled for this task; carried into every later dispatch
  const impl = await dispatchImpl(task, null, resolved, `impl:${task.id}`)
  if (!impl) return { id: task.id, repo: task.repo, status: 'DIED' }
  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT')
    return { id: task.id, repo: task.repo, status: impl.status, impl }

  // What this task actually wrote, folded into the run-level set the gate condition is
  // decided from (a gate hook's unit is the whole branch, not one task).
  recordTouched(task, impl)

  // Pinned to this task's origin, advanced by each fix — handed to every reviewer so the
  // panel judges this task's change instead of re-deriving it once per reviewer.
  const range = reviewRange(impl, null)

  const spec = await runReviewStage(task, 'spec', panelFor(task.repo, 'spec'), 'Spec review', resolved, range)
  if (spec.verdict !== 'PASS') return { id: task.id, repo: task.repo, status: 'SPEC_FAILED', impl, review: spec }

  const quality = await runReviewStage(task, 'quality', panelFor(task.repo, 'quality'), 'Quality review', resolved, range)
  if (quality.verdict !== 'PASS') return { id: task.id, repo: task.repo, status: 'QUALITY_FAILED', impl, review: quality }

  const advisory = (spec.advisory || []).concat(quality.advisory || [])

  // A parallel lane is not landed until its reviewed branch is IN the run branch — the
  // gate stamp certifies the integrated tree, never a stray lane.
  if (task.lane === 'worktree') {
    log(`   · ${task.id}: reviews passed — integrating lane ${task.laneBranch} into ${task.runBranch}…`)
    const integrate = await integrateLane(task)
    if (!integrate || integrate.status !== 'MERGED') {
      return { id: task.id, repo: task.repo, status: 'MERGE_CONFLICT', impl, review: quality, integrate }
    }
  }

  return { id: task.id, repo: task.repo, status: impl.status, impl, prUrl: impl.prUrl, review: quality, advisory, runBranch: task.runBranch || task.branch }
}

// ═══════════ 2 · DAG execution: continuous dispatch + final terminal wave + REPLAN ═══════════
// The scheduler runs what the TICKETS say can run: an issue DISPATCHES the moment
// EVERY dependsOn has landed — no wave barrier — parallel across repos, and within a
// repo in parallel LANES when the tasks' declared files are disjoint (each lane in its
// own worktree, a serialized integrate step merging reviewed lanes into the repo's ONE
// run branch). Ready order is slice asc → downstream-unlocked desc → id — a bias,
// never a barrier. A failed issue blocks ONLY its dependents — independent chains keep
// going, so the whole project runs start to finish. When the scheduler is STUCK
// (failures blocking work, or failed work is all that remains), it RE-PLANS from the
// current state AT QUIESCENCE; revised tasks re-enter fully specified.
// When the WHOLE project drains, one final wave runs every repo's TERMINAL slot in
// parallel: the terminal quality sweep on the integrated run branch, then the repo's
// gate + PR — so an expensive gate is paid once, at the end, never inside an
// implementation wave.
// ── harness context (execute runs): memory stores + prior ledgers, via one cheap agent ──
// Loaded AFTER the artifact/hook gates (a refused run reads nothing) and BEFORE the first
// brief is built (every brief pastes its agent's memory). A dead loader degrades to empty
// memory — the agent definitions still tell each agent to read its own file.
{
  const repos = [...new Set(pendingIndex.map((i) => i.repo).filter(Boolean))]
  const agents = [...new Set([...repoList.map((r) => r.agent), 'reviewer'])]
  const ctx = await step('harness context — memory stores + prior run ledgers', () =>
    agentT(harnessContextPrompt(project, repos, agents), {
      label: 'harness-context',
      phase: 'Parse plan',
      model: 'haiku',
      schema: HARNESS_CONTEXT_SCHEMA,
    }),
  )
  if (ctx) {
    harnessMemory = typeof ctx.harnessMemory === 'string' ? ctx.harnessMemory : ''
    agentMemory = ctx.agentMemory && typeof ctx.agentMemory === 'object' ? ctx.agentMemory : {}
    priorLearnings = Array.isArray(ctx.priorLearnings) ? ctx.priorLearnings.filter((l) => typeof l === 'string' && l.trim()) : []
    const withMem = Object.entries(agentMemory).filter(([, v]) => v && v.trim()).map(([k]) => k)
    log(`◎ harness context: ${priorLearnings.length} prior learning(s) from ${(ctx.priorLedgers || []).length} ledger(s) · memory for ${withMem.length ? withMem.join(', ') : 'no agent yet'}`)
  } else log('⚠ harness-context loader died — running with empty memory (agents still read their own memory files)')
}

phase('Implement')

const doneTasks = [] // {id, repo, status, summary} — immutable input to every replan
const learnings = [] // durable lessons failures taught — carried into replans AND every later hydration
const allResults = [] // every task + gate result, flat
const failures = [] // {id, repo, status, detail} — unlanded work (a replan can requeue it)
const deferred = [] // tasks hydration or a replan marked deferred (blocked on deploy/other repo)
const landedIds = new Set(alreadyDoneIds) // satisfied dependencies: absorbed + landed this run
const pendingById = new Map(pendingIndex.map((i) => [i.id, i])) // id → index entry still to run
const hydratedById = new Map() // id → full task, from hydration or a replan REVISE
const gateDone = new Set() // repos whose terminal slot (sweep + gate/PR where gated) already succeeded
const gateHold = new Set() // repos whose terminal slot FAILED — held until a replan lands new repo work, else the drained project re-dispatches the same failing slot forever
const repoRef = {} // repo → {ticket, branch} from its most recent landed task (briefs the terminal slot)
const repoBranch = {} // repo → the ONE run branch every task of that repo lands on (lanes merge into it)
const runBranchFor = (t) => (repoBranch[t.repo] ||= t.branch || `feat/${String(project).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${t.repo}`)

// The pseudo-task the TERMINAL quality sweep runs against: the subject is the repo's whole
// integrated run branch, not one issue. Its taskText briefs BOTH sides of runReviewStage —
// the sweep reviewers (what to judge) and any fix dispatch the stage routes (what NOT to do:
// the repo gate runs after this stage, so a fix must never pay the gate or open a PR here).
function terminalTask(repo) {
  const ref = repoRef[repo]
  const landed = doneTasks.filter((d) => d.repo === repo)
  const path = repoPath(repo)
  return {
    id: `${repo}:final`,
    ticket: ref.ticket,
    repo,
    agent: agentFor(repo),
    branch: ref.branch,
    files: [],
    taskText: `Repo-level TERMINAL quality sweep for \`${path}\`. Every per-task review of this run has passed and the WHOLE project's task queue is drained — the subject is the ENTIRE integrated run branch \`${ref.branch}\`:

    git -C ${path} diff ${BASE_BRANCH}...${ref.branch}

Landed on it this run:
${landed.length ? landed.map((d) => `- ${d.id} — ${d.summary || '(no summary)'}`).join('\n') : '- (no task summaries recorded)'}

Reviewers: judge the INTEGRATED feature through your lens. Per-task reviews saw each slice alone; you see them together — cross-task consistency, the assembled user flow, and release-readiness of the branch as a whole are exactly your subject.
Fix dispatches: address ONLY the findings listed, commit to \`${ref.branch}\`. The repo's gate and PR run AFTER this stage — do not run gate commands or open/update any PR from here.`,
    successCriteria: 'every listed finding addressed on the run branch; full suite + lint/typecheck green',
  }
}
let replans = 0
let halt = null // {reason} once we stop early
let waves = 0 // dispatch cycles (historical name — reported in the summary)

// Stop CLEANLY when the turn's token target runs low — a full project can outsize
// one budget, and dying mid-flight loses committed-but-unreviewed work: checked
// before every dispatch, honored at quiescence (in-flight work still settles).
const BUDGET_FLOOR = 80000
const budgetLow = () => {
  try {
    return !!budget.total && budget.remaining() < BUDGET_FLOOR
  } catch (e) {
    return false
  }
}
// A dependency outside the project cannot be tracked — count it satisfied, never deadlock on it.
const depsMet = (i) => (i.dependsOn || []).every((d) => landedIds.has(d) || !inProject.has(d))

// ═══ CONTINUOUS DISPATCH ═══
// A wave used to be a synchronization point: nothing in wave N+1 started until every
// task of wave N returned, so one slow task idled every ready dependent in every
// other repo. The only thing the barrier actually bought was replanner coherence —
// replans must see a QUIESCENT state — and that is preserved below by replanning
// (and gating, and halting) ONLY when nothing is in flight. So: an issue
// dispatches the moment its own dependsOn have landed, under these co-scheduling rules —
//   · at most MAX_PER_REPO of a repo's tasks in flight at once
//   · same-repo concurrency only with pairwise-DISJOINT declared files, each task in
//     its own worktree lane (integrations stay serialized per repo); a task with no
//     declared files has an unknown footprint and runs ALONE in its repo
//   · a task runs DIRECT on the run branch (primary checkout) only when nothing else
//     is running or co-admitted in its repo; a lane admitted NEXT TO a direct task
//     queues its integration behind that task (directDone), so no two agents ever
//     share one physical checkout
const inFlight = new Map() // id → {id, repo, files, exclusive, direct, promise}
const repoBusy = (repo) => [...inFlight.values()].filter((x) => x.repo === repo)
const directDone = {} // repo → the in-flight DIRECT task's promise; lane integrations queue behind it
let consecutiveDied = 0 // task settles in a row where the agent died without a result — see the circuit breaker

// Critical-path bias: among equally-sliced ready issues, prefer the one that
// transitively unblocks the MOST downstream work. Computed once from the phase-A
// index; replan-invented ids default to 0 (the bias is a tiebreak, never a gate).
const downstreamOf = (() => {
  const dependents = new Map()
  for (const i of pendingIndex)
    for (const d of i.dependsOn || []) {
      if (!dependents.has(d)) dependents.set(d, [])
      dependents.get(d).push(i.id)
    }
  const memo = new Map()
  return (id) => {
    if (memo.has(id)) return memo.get(id)
    const seen = new Set()
    const stack = [...(dependents.get(id) || [])]
    while (stack.length) {
      const n = stack.pop()
      if (seen.has(n)) continue
      seen.add(n)
      stack.push(...(dependents.get(n) || []))
    }
    memo.set(id, seen.size)
    return seen.size
  }
})()

// Start one task NOW. The promise never rejects and always carries the task's id so
// the race loop can settle it; a runtime-lost agent (terminal API error) surfaces as
// DIED through runTask's own null handling, an internal throw as ERROR.
function startTask(t) {
  const fs = filesOf(t)
  const entry = { id: t.id, repo: t.repo, files: fs, exclusive: !fs.length, direct: t.lane !== 'worktree' }
  entry.promise = (async () => {
    try {
      return (await runTask(t)) || { id: t.id, repo: t.repo, status: 'DIED' }
    } catch (e) {
      return { id: t.id, repo: t.repo, status: 'ERROR', error: String(e) }
    }
  })()
  inFlight.set(t.id, entry)
  if (entry.direct) directDone[t.repo] = entry.promise.then(() => null, () => null)
}

// Book one settled result — task or terminal slot — into the run state.
function settle(r) {
  allResults.push(r)
  if (r.gateStep) {
    if (r.status === 'GATE_FAILED' || r.status === 'TERMINAL_REVIEW_FAILED') {
      // the sweep/gate caught what per-task review did not → replannable
      failures.push({ id: r.id, repo: r.repo, status: r.status, detail: failureDetail(r) })
      gateHold.add(r.repo) // held until new repo work lands — never re-dispatch a failing slot on the same tree
      log(`⛔ ${r.repo}: ${r.status === 'GATE_FAILED' ? 'gate' : 'terminal sweep'} failed — a replan can queue a repair task (the slot retries at the next full project drain)`)
    } else {
      gateDone.add(r.repo)
      // a retried slot that lands RESOLVES its standing failure(s) — leaving them in
      // `failures` would keep feeding the replanner a problem that no longer exists.
      // Matched by repo, not id: a `:final` failure is resolved by a later `:gate` pass.
      for (let fi; (fi = failures.findIndex((f) => f.repo === r.repo && (f.status === 'GATE_FAILED' || f.status === 'TERMINAL_REVIEW_FAILED'))) >= 0; ) failures.splice(fi, 1)
      log(`   · ${r.repo}: terminal slot green${prByGate(r.repo) ? ' (sweep + gate)' : ' (sweep)'}${r.prUrl ? ` · ${r.prUrl}` : ''}`)
    }
    return
  }
  pendingById.delete(r.id)
  if (r.status === 'DONE' || r.status === 'DONE_WITH_CONCERNS') {
    consecutiveDied = 0
    landedIds.add(r.id)
    gateHold.delete(r.repo) // new work landed on this repo's tree — its gate may retry
    gateDone.delete(r.repo) // and a gate that already shipped must re-run on the new tree (replan-landed work after a green gate)
    doneTasks.push({ id: r.id, repo: r.repo, status: r.status, summary: r.impl?.summary })
    const t = hydratedById.get(r.id)
    // the gate is briefed on the RUN branch — a lane branch no longer exists after integration
    repoRef[r.repo] = { ticket: (t && t.ticket) || 'NO_TICKET', branch: r.runBranch || (t && t.branch) || '' }
  } else {
    // Circuit-breaker input: DIED means the agent returned NOTHING (spend limit /
    // API outage), not a judgement on the task. Any real result resets the streak.
    consecutiveDied = r.status === 'DIED' ? consecutiveDied + 1 : 0
    failures.push({ id: r.id, repo: r.repo, status: r.status, detail: failureDetail(r) })
    log(`⛔ ${r.id} (${r.repo}) → ${r.status} — its dependents stay blocked until a replan lands it`)
  }
}

// ── the repo's TERMINAL slot: quality sweep first, then (where configured) gate + PR ──
// The sweep runs BEFORE the gate so any sweep-fix commit lands before a gate stamp is
// paid — a commit after the stamp would staleness its tree hash.
async function terminalSlot(repo) {
  const ft = terminalTask(repo)
  log(`   · ${repo}: project drained → terminal quality sweep (${panelFor(repo, 'terminal').map((p) => p.name).join(' · ')}) on ${ft.branch}…`)
  const terminal = await runReviewStage(ft, 'terminal', panelFor(repo, 'terminal'), 'Terminal review', [], null)
  if (terminal.verdict !== 'PASS')
    return { id: ft.id, repo, gateStep: true, status: 'TERMINAL_REVIEW_FAILED', review: terminal, advisory: terminal.advisory }
  if (!prByGate(repo))
    // this repo's PRs were opened per ticket by the implementers, and any sweep fix has
    // already been committed onto them — the slot ends at the sweep.
    return { id: ft.id, repo, gateStep: true, status: 'DONE', review: terminal, advisory: terminal.advisory }
  const gateCfg = gateOf(repo)
  const pseudo = { id: `${repo}:gate`, ticket: repoRef[repo].ticket, branch: repoRef[repo].branch, repo }
  // decided AFTER the sweep: a sweep fix can pull in a matching path (recordTouched runs
  // inside the fix rung) and the gate condition must see it
  const hits = gateHits(repo)
  const cond = gateCfg && gateCfg.when && Array.isArray(gateCfg.when.pathsMatching) && gateCfg.when.pathsMatching.length
  const applies = !!(gateCfg && gateCfg.run) && (!cond || hits.length > 0)
  log(`   · ${repo}: terminal sweep green → ${applies ? `gate + PR (\`${gateCfg.run}\`, one run, final tree${cond ? `, ${hits.length} matching path(s) touched` : ''})` : 'PR only (gate command does not apply)'}…`)
  const gate = await agentT(gatePrompt(pseudo, gateCfg, hits), {
    label: `gate:${repo}`,
    phase: 'Implement',
    model: 'opus',
    agentType: agentFor(repo),
    schema: IMPL_SCHEMA,
    timeoutMin: repoTimeout(repo),
  })
  const failed = !gate || gate.status === 'BLOCKED' || gate.status === 'NEEDS_CONTEXT'
  return { id: pseudo.id, repo, gateStep: true, status: failed ? 'GATE_FAILED' : gate.status, gate, prUrl: gate && gate.prUrl, advisory: terminal.advisory }
}

while (true) {
  // ── 1 · dispatch — start EVERY issue whose own dependsOn have landed. No wave
  // barrier: a settle loops straight back here, so newly-unblocked work starts
  // immediately even while unrelated tasks are still running. Skipped once we are
  // stopping (halt set, or budget floor hit): in-flight work still settles below,
  // nothing new starts, and the run ends cleanly at quiescence.
  const stopping = budgetLow()
  if (!halt && !stopping) {
    const eligible = [...pendingById.values()]
      .filter((i) => depsMet(i) && !inFlight.has(i.id))
      .sort(
        (a, b) =>
          (a.slice ?? 0) - (b.slice ?? 0) || // vertical bias: smallest valuable slice first
          downstreamOf(b.id) - downstreamOf(a.id) || // critical path: unlock the most downstream work
          String(a.id).localeCompare(String(b.id)),
      )
    const picks = []
    const picked = {}
    for (const i of eligible) {
      if (repoBusy(i.repo).length + (picked[i.repo] || 0) >= MAX_PER_REPO) continue
      if (repoBusy(i.repo).some((x) => x.exclusive)) continue // an undeclared footprint holds its whole repo
      picked[i.repo] = (picked[i.repo] || 0) + 1
      picks.push(i)
    }
    if (picks.length) {
      waves++ // dispatch CYCLES — kept under the historical `waves` name for output continuity
      // ── phase B: hydrate this cycle's issues that don't have a task yet (one small agent) ──
      const toHydrate = picks.filter((i) => !hydratedById.has(i.id))
      if (toHydrate.length) {
        const hyd = await step(`cycle ${waves} — hydrate ${toHydrate.map((i) => i.id).join(', ')}`, () =>
          agentT(hydratePrompt(project, toHydrate, [...priorLearnings, ...learnings]), {
            label: `hydrate:w${waves}`,
            phase: 'Parse plan',
            model: 'opus',
            schema: TASK_LIST_SCHEMA,
          }),
        )
        if (!hyd) halt = { reason: `hydration died on cycle ${waves} (${toHydrate.map((i) => i.id).join(', ')})` }
        else if (Array.isArray(hyd.inputProblems) && hyd.inputProblems.length)
          halt = { reason: `hydration found input problems: ${hyd.inputProblems.join(' · ')}` }
        if (halt) {
          // don't abandon running work — stop dispatching, drain, then quiescence breaks
          log(`⛔ ${halt.reason} — in-flight work will settle, then the run stops (landed work is absorbed on the next invocation)`)
          continue
        }
        // index under BOTH id and ticket — a hydrator that returns plan-style ids
        // (id "1.1", ticket "PROJ-660") must still match the scheduler's tracker ids
        for (const t of hyd.tasks || []) {
          hydratedById.set(t.id, t)
          if (t.ticket && t.ticket !== 'NO_TICKET') hydratedById.set(t.ticket, t)
        }
      }
      // deferrals surfaced by hydration cannot run unattended — their dependents stay blocked
      const runnable = []
      for (const i of picks) {
        const t = hydratedById.get(i.id)
        if (!t) {
          pendingById.delete(i.id)
          failures.push({ id: i.id, repo: i.repo, status: 'HYDRATION_MISSING', detail: '  hydration returned no task for this issue' })
          log(`⛔ ${i.id}: hydration returned no task — treated as failed`)
          continue
        }
        t.id = i.id // scheduler identity is the tracker id — landedIds/dependsOn/pendingById all match on it
        if (t.deferred) {
          pendingById.delete(i.id)
          deferred.push(t)
          log(`   · ${i.id}: deferred — ${t.deferredReason || '(no reason given)'} (dependents stay blocked)`)
          continue
        }
        runnable.push(t)
      }
      // ── co-scheduling within a repo: declared files decide what runs TOGETHER ──
      // A candidate must be pairwise-disjoint with BOTH the repo's in-flight tasks and
      // this cycle's earlier admissions; an undeclared footprint never shares. Held
      // tasks stay in pendingById (hydration cached) and lead the next cycle. Direct
      // mode (run branch, primary checkout) only when the task runs ALONE in its repo;
      // any co-scheduling puts every co-scheduled task in its own worktree lane.
      const admitted = []
      for (const repo of [...new Set(runnable.map((t) => t.repo))]) {
        const busy = repoBusy(repo)
        const lane = []
        for (const t of runnable.filter((x) => x.repo === repo)) {
          const fs = filesOf(t)
          const clash =
            busy.length + lane.length > 0 &&
            (!fs.length ||
              busy.some((x) => !x.files.length || x.files.some((f) => fs.includes(f))) ||
              lane.some((u) => {
                const ufs = filesOf(u)
                return !ufs.length || ufs.some((f) => fs.includes(f))
              }))
          if (clash) {
            log(`   · ${t.id}: held — file overlap (or an undeclared footprint) with ${busy.map((x) => x.id).concat(lane.map((x) => x.id)).join('/')} in ${repo}`)
            continue
          }
          lane.push(t)
        }
        if (!lane.length) continue
        const runBranch = runBranchFor(lane[0])
        const shared = busy.length > 0 || lane.length > 1
        for (const t of lane) {
          if (shared) {
            t.lane = 'worktree'
            t.runBranch = runBranch
            t.laneBranch = `${runBranch}--${String(t.id).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
            t.branch = t.laneBranch // implementer, reviewers and fix dispatches all look at the lane
          } else {
            t.lane = 'direct'
            t.branch = t.branch || runBranch
            t.runBranch = runBranch
          }
        }
        admitted.push(...lane)
      }
      if (admitted.length) {
        log(`▶ cycle ${waves}: dispatch ${admitted.map((t) => `${t.id}(${t.repo}${t.lane === 'worktree' ? '·lane' : ''})`).join(' · ')}${inFlight.size ? ` · joining ${inFlight.size} already in flight` : ''}`)
        for (const t of admitted) startTask(t)
      }
    }
  }

  // ── 2 · anything running → wait for the FIRST settle, book it, rescan immediately ──
  if (inFlight.size) {
    const r = await Promise.race([...inFlight.values()].map((x) => x.promise))
    inFlight.delete(r.id)
    settle(r)
    // Circuit breaker: consecutive settles where the agent died without ANY result
    // mean the dispatches themselves are failing (spend limit / API outage) — stop
    // dispatching and drain rather than feed a dead API through replans.
    if (!halt && consecutiveDied >= 3) {
      halt = { reason: 'three consecutive dispatches died without a single agent result — agents are dying instantly (spend limit or API outage?); halting instead of spinning' }
      log(`⛔ ${halt.reason}`)
    }
    continue
  }

  // ── 3 · QUIESCENT (nothing in flight) — the ONLY place we stop, gate, or replan,
  // which is exactly the coherence the old wave barrier existed to provide. ──
  if (halt) break
  if (stopping) {
    halt = { reason: `token budget floor (${BUDGET_FLOOR}) reached — stopped cleanly at quiescence` }
    log(`⛔ ${halt.reason}`)
    break
  }
  // TERMINAL slots run ONCE, AT PROJECT END — only when NO issue anywhere is still
  // pending and nothing is in flight. One final wave: every repo's sweep + gate/PR in
  // parallel, the gate paid exactly once, on the tree that is genuinely final. (A
  // gate/sweep FAILURE still replans → new tasks → pendingById refills → the held slot
  // retries at the next full drain.) An ungated repo runs the sweep only — its PRs are
  // already open per ticket from the implementers.
  const finals = !pendingById.size ? Object.keys(repoRef).filter((r) => !gateDone.has(r) && !gateHold.has(r)) : []
  if (finals.length) {
    log(`▶ final wave: terminal sweep${finals.some((r) => prByGate(r)) ? ' → gate+PR' : ''}: ${finals.join(', ')}`)
    const results = await step(`final wave — terminal slots (${finals.join(', ')})`, () => parallel(finals.map((repo) => () => terminalSlot(repo))))
    // A null slot is an agent the runtime lost to a terminal error — map it back to
    // its repo by index and book it as GATE_FAILED (the existing dead-gate semantics).
    ;(results || [])
      .map((r, i) => r || (finals[i] ? { id: `${finals[i]}:gate`, repo: finals[i], gateStep: true, status: 'GATE_FAILED', gate: null } : null))
      .filter(Boolean)
      .forEach(settle)
    continue
  }

  {
    // ── nothing schedulable ──
    if (failures.length && replans < MAX_REPLANS) {
      // failures are blocking the rest (or are all that is left) → A* from current state
      replans++
      phase('Replan')
      const blocked = [...pendingById.values()].map((i) => ({ id: i.id, repo: i.repo, slice: i.slice, dependsOn: i.dependsOn || [] }))
      let revision = await step(`replan #${replans} — A* from current state`, () =>
        agentT(replanPrompt({ goal: goalRef, done: doneTasks, failures, blocked, learnings: [...priorLearnings, ...learnings], replanNo: replans, maxReplans: MAX_REPLANS }), {
          label: `replan#${replans}`,
          phase: 'Replan',
          model: 'opus',
          schema: REPLAN_SCHEMA,
        }),
      )
      // A REVISE with no tasks is malformed (the task list leaked into `reason` as text) —
      // retry the planner ONCE with an explicit correction before treating it as a halt.
      if (revision && revision.decision === 'REVISE' && !(revision.tasks || []).length) {
        log(`⚠ replan #${replans}: REVISE returned zero tasks — retrying the planner once`)
        revision = await step(`replan #${replans} — retry (REVISE had no tasks)`, () =>
          agentT(
            replanPrompt({ goal: goalRef, done: doneTasks, failures, blocked, learnings, replanNo: replans, maxReplans: MAX_REPLANS }) +
              '\n\nIMPORTANT: a previous attempt chose REVISE but returned an EMPTY "tasks" array (its task list was serialized into "reason" as text, which the scheduler cannot use). Return the revised remaining tasks as structured items in the "tasks" array field; keep "reason" to short prose.',
            {
              label: `replan#${replans}-retry`,
              phase: 'Replan',
              model: 'opus',
              schema: REPLAN_SCHEMA,
            },
          ),
        )
      }
      if (!revision) {
        halt = { reason: 'the re-planner died' }
        log(`⛔ replan #${replans}: planner died`)
        break
      }
      if (revision.learnings && revision.learnings.length) learnings.push(...revision.learnings)
      if (revision.decision === 'HALT') {
        halt = { reason: revision.reason }
        log(`⛔ replan #${replans}: HALT — ${revision.reason}`)
        break
      }
      const revised = revision.tasks || []
      const revisedDeferred = revised.filter((t) => t.deferred)
      deferred.push(...revisedDeferred)
      let requeued = 0
      for (const t of revised.filter((x) => !x.deferred)) {
        // a replanned task re-enters the DAG fully specified — no hydration round-trip.
        // A retry of an in-project issue must land under its tracker id, or its dependents
        // never see it in landedIds — so ticket wins over a planner-invented id.
        if (t.ticket && t.ticket !== 'NO_TICKET' && inProject.has(t.ticket)) t.id = t.ticket
        pendingById.set(t.id, { id: t.id, title: '', repo: t.repo, state: 'todo', slice: t.slice ?? 0, sliceLabel: t.sliceLabel || '', dependsOn: t.dependsOn || [] })
        inProject.add(t.id)
        hydratedById.set(t.id, t)
        if (t.ticket && t.ticket !== 'NO_TICKET') hydratedById.set(t.ticket, t)
        const fi = failures.findIndex((f) => f.id === t.id)
        if (fi >= 0) failures.splice(fi, 1) // being retried with a NEW approach — no longer a standing failure
        requeued++
      }
      log(`↻ replan #${replans}: REVISE — ${revision.reason} · ${requeued} task(s) requeued${revision.learnings && revision.learnings.length ? ` · learned: ${revision.learnings.join('; ')}` : ''}`)
      if (!requeued) {
        halt = { reason: `replan #${replans} requeued nothing while work is still open` }
        log(`⛔ ${halt.reason}`)
        break
      }
      continue
    }
    if (pendingById.size) {
      halt = {
        reason: failures.length
          ? `exhausted replan budget (${MAX_REPLANS}) — ${pendingById.size} issue(s) still blocked behind failures`
          : deferred.length
            ? `${pendingById.size} issue(s) blocked behind ${deferred.length} deferral(s) (${deferred.map((t) => t.id).join(', ')}) — resolve the deferral, then re-invoke to resume`
            : `${pendingById.size} issue(s) unschedulable — dependency cycle or dangling dependsOn in the tickets`,
      }
      log(`⛔ ${halt.reason}`)
    }
    break // everything landed (possibly with reported failures and no replan budget left)
  }
}

// Whatever is still pending when we stop never ran — report it, never drop it silently.
const blocked = [...pendingById.values()].map((i) => ({ id: i.id, repo: i.repo, slice: i.slice ?? 0, dependsOn: i.dependsOn || [], status: 'BLOCKED_NOT_RUN' }))
if (blocked.length) log(`⚠ ${blocked.length} issue(s) never ran — blocked behind failures or a halt`)

// ═══════════════════════ 3 · final cross-repo pass ═══════════════════════
// Optional and configured: {finalCheck:{repos:[a,b], prompt, agentType?}} runs one
// read-only check when every named repo landed work — e.g. an API-contract drift check
// between a client and its server. Absent = skipped.
phase('Final pass')
const touched = new Set(doneTasks.map((t) => t.repo))
const finalCheck =
  opts.finalCheck && typeof opts.finalCheck === 'object' && typeof opts.finalCheck.prompt === 'string' && opts.finalCheck.prompt.trim()
    ? { repos: Array.isArray(opts.finalCheck.repos) ? opts.finalCheck.repos : [], prompt: opts.finalCheck.prompt, agentType: typeof opts.finalCheck.agentType === 'string' ? opts.finalCheck.agentType : 'contract-checker' }
    : null
let contract = null
if (finalCheck && finalCheck.repos.every((r) => touched.has(r))) {
  contract = await step('final cross-repo check', () =>
    agentT(finalCheck.prompt, {
      label: 'contract-check',
      phase: 'Final pass',
      model: 'sonnet',
      agentType: finalCheck.agentType,
      schema: VERDICT_SCHEMA,
    }),
  )
}

// ═══════════════════════ 3b · crystallize — the harness learns ═══════════════════════
// Execute runs only. The LEDGER is written on every execute run (a halted run is the most
// informative one); the CRYSTALLIZE dispatch runs only when PRs exist, because review
// threads on those PRs are its primary signal. Everything lands on one branch + PR —
// nothing this phase writes is live before that PR merges.
phase('Crystallize')
const prsOpened = allResults.filter((r) => r.prUrl).map((r) => ({ id: r.id, repo: r.repo, pr: r.prUrl }))
const contextQuestionsForLedger = (contextResolves.questions || []).map((q) => ({ task: q.task, question: q.question, resolvedBy: q.resolvedBy }))
const advisoryForLedger = allResults.flatMap((r) =>
  (r.advisory || []).map((f) => ({ task: r.id, repo: r.repo, severity: f.severity, persona: f.persona, where: `${f.file || '?'}:${f.line || '?'}`, issue: f.issue })),
)
let harnessLearning = null
if (execute) {
  const ledgerPayload = {
    project,
    projectSlug: String(project).replace(/[^A-Za-z0-9._-]+/g, '-'),
    inputs: { specPath, planPath },
    repos: [...new Set(doneTasks.map((t) => t.repo))],
    done: doneTasks.map((t) => ({ id: t.id, repo: t.repo, status: t.status })),
    needsAttention: allResults.filter((r) => !(r.status === 'DONE' || r.status === 'DONE_WITH_CONCERNS')).map((r) => ({ id: r.id, repo: r.repo, status: r.status })),
    blocked: blocked.map((b) => b.id),
    prs: prsOpened,
    learnings,
    priorLearningsUsed: priorLearnings,
    contextResolves: { asked: contextResolves.asked, answered: contextResolves.answered, escalated: contextResolves.escalated, questions: contextQuestionsForLedger },
    guardChecks,
    reviewStats,
    replans,
    waves,
    advisoryNotes: advisoryForLedger,
    halt,
    telemetry: { totalOutputTokens: spentTokens(), steps: telemetry },
  }
  const ledgerRaw = await step(`run ledger — write ${RUNS_DIR}/<date>-<project>.json`, () =>
    agentT(ledgerPrompt(ledgerPayload), {
      label: 'ledger',
      phase: 'Crystallize',
      model: 'haiku',
      isolation: 'worktree', // never mutate the session's live checkout
      schema: LEDGER_SCHEMA,
    }),
  )
  // A dead or malformed writer (no path/branch) leaves no ledger — never fabricate one.
  const ledger = ledgerRaw && typeof ledgerRaw.path === 'string' && ledgerRaw.path && typeof ledgerRaw.branch === 'string' && ledgerRaw.branch ? { path: ledgerRaw.path, branch: ledgerRaw.branch } : null
  if (!ledger) log('⚠ ledger writer died or returned no path/branch — this run leaves no ledger (crystallize skipped: it needs the ledger branch)')
  else if (!prsOpened.length) {
    log(`◎ ledger written: ${ledger.path} on ${ledger.branch} · no PR this run → crystallize skipped (review threads are its signal)`)
    harnessLearning = { ledger, crystallize: null }
  } else {
    const cryRaw = await step(`crystallize — ${prsOpened.length} PR(s) → skills · memory · docs`, () =>
      agentT(crystallizePrompt({ project, prs: prsOpened, ledger, learnings, contextQuestions: contextQuestionsForLedger, advisoryNotes: advisoryForLedger, halt }), {
        label: 'crystallize',
        phase: 'Crystallize',
        model: 'opus',
        isolation: 'worktree', // checks out the ledger branch in its own worktree
        schema: CRYSTALLIZE_SCHEMA,
      }),
    )
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
    const cry = cryRaw && typeof cryRaw === 'object' && ('summary' in cryRaw || 'prUrl' in cryRaw)
      ? {
          reports: arr(cryRaw.reports),
          skillsCreated: arr(cryRaw.skillsCreated),
          skillsPatched: arr(cryRaw.skillsPatched),
          memoryEntriesAdded: Number.isFinite(cryRaw.memoryEntriesAdded) ? cryRaw.memoryEntriesAdded : 0,
          docsSynced: arr(cryRaw.docsSynced),
          prUrl: typeof cryRaw.prUrl === 'string' ? cryRaw.prUrl : '',
          summary: typeof cryRaw.summary === 'string' ? cryRaw.summary : '',
        }
      : null
    if (!cry) log(`⚠ crystallize died — ledger is on ${ledger.branch}; run the crystallize skill by hand over: ${prsOpened.map((p) => p.pr).join(', ')}`)
    else log(`◎ crystallized: ${cry.skillsCreated.length} skill(s) created · ${cry.skillsPatched.length} patched · ${cry.memoryEntriesAdded} memory entr${cry.memoryEntriesAdded === 1 ? 'y' : 'ies'} · ${cry.docsSynced.length} doc(s) synced → ${cry.prUrl || '(no PR)'}`)
    harnessLearning = { ledger, crystallize: cry }
  }
}

// ═══════════════════════════════ 4 · summary ═══════════════════════════════
// The main session reads this and reports. Merge and deploy are deliberately NOT
// automated. `replans`, `learnings`, and `halt` make the adaptive path auditable;
// `telemetry` makes the cost visible.
const ok = (r) => r.status === 'DONE' || r.status === 'DONE_WITH_CONCERNS'
// Advisory notes are the minor/nit findings the gate deliberately did NOT rework. They are a
// deliverable, not debris: this list is the only place they surface, so it must be reported.
const advisoryNotes = allResults.flatMap((r) =>
  (r.advisory || []).map((f) => ({ task: r.id, repo: r.repo, severity: f.severity, persona: f.persona, where: `${f.file || '?'}:${f.line || '?'}`, issue: f.issue })),
)
// Repos with landed work whose terminal slot (sweep → gate → PR) never ran green — a halt
// before the project drained, or a slot that failed and was never repaired. Their run
// branches hold reviewed commits but NO PR: re-invoking the project resumes, drains, and
// gates then (paying a gate on a pre-halt tree that a resume would staleness is waste).
const ungatedRepos = Object.keys(repoRef).filter((r) => !gateDone.has(r))
if (ungatedRepos.length) log(`⚠ ${ungatedRepos.length} repo(s) landed work but never gated (no PR yet): ${ungatedRepos.join(', ')} — re-invoke the project to drain and gate`)
log(
  `■ done: ${allResults.filter((r) => !r.gateStep && ok(r)).length} · needs-attention: ${allResults.filter((r) => !ok(r)).length} · blocked (never ran): ${blocked.length} · absorbed: ${alreadyDone.length} · ` +
    `waves: ${waves} · advisory (not reworked): ${advisoryNotes.length} · ` +
    `context-Qs: ${contextResolves.asked} (${contextResolves.answered} answered by a scout, ${contextResolves.escalated} escalated) · ` +
    `guard: ${guardChecks.passed}/${guardChecks.checked} fix(es) passed without a panel re-run · ` +
    `review: ${reviewStats.passedFirstRound}/${reviewStats.stages} stage(s) passed first round, ${reviewStats.fixDispatches} fix dispatch(es), ${reviewStats.gatingFindings} gating / ${reviewStats.advisoryFindings} advisory finding(s) · ` +
    `replans: ${replans} · ${fmtTok(spentTokens())} total output tok`
)
return {
  inputs: { specPath, planPath, project }, // the design artifacts this run was built from
  done: allResults.filter((r) => !r.gateStep && ok(r)),
  needsAttention: allResults.filter((r) => !ok(r)),
  // issues the scheduler never reached — blocked behind a failure or a halt. Re-invoking the
  // same project resumes here: landed work is absorbed via tracker state, these run next.
  blocked,
  alreadyDone,
  deferred: deferredSummary(deferred),
  // minor/nit findings that passed the gate without a rework round — triage them by hand
  // (decline-with-reason is a legitimate disposition)
  advisoryNotes,
  // repos whose reviewed work is on a run branch but whose terminal sweep/gate/PR never
  // ran green (halt before the project drained, or an unrepaired slot failure)
  ungatedRepos,
  contract,
  // The harness learning step (execute runs): the ledger written + what crystallize
  // created/patched and the ONE PR carrying it.
  harness: harnessLearning,
  prs: prsOpened,
  waves,
  replans,
  learnings,
  halt,
  // The resolve rung, made auditable: every NEEDS_CONTEXT question, who answered it, and
  // which ones the codebase could not settle. A high `asked` count is a signal the spec was
  // underspecified — take it back to roast, not to maxContextResolves.
  contextResolves,
  // The guard, made auditable: `passed` is panel rounds saved, `reReviewed` is fixes the
  // guard (or its death) sent back to the full panel. A low pass rate means fixes are
  // routinely incomplete — a signal about the fix briefs, not a reason to drop the guard.
  guardChecks,
  // The review loop, made auditable (feed for tuning it adaptively): stages run, how
  // many passed their FIRST round untouched, real rework bought (fixDispatches, each a
  // full opus dispatch), and the gating-vs-advisory finding split per reviewer economy.
  reviewStats,
  telemetry: { totalOutputTokens: spentTokens(), steps: telemetry },
  note:
    'Absorbed the WHOLE tracker project: a lightweight slice index up front, each dispatch cycle hydrated just-in-time, already-done issues skipped. Scheduling was CONTINUOUS and dependsOn-driven straight from the tickets — each issue dispatched the moment its dependencies landed (no wave barrier), parallel across repos AND within a repo where declared files were disjoint (worktree lanes, integrations serialized into one run branch per repo); ready order was slice, then downstream-unlocked (critical path). A failed issue blocked only its dependents, and when failures left work stuck the loop re-planned from the current state. Reviews were SCOPED: per task, spec review + the build-safety quality core gated whether dependents could build on the change; once per repo, AT PROJECT END (one final wave, repos in parallel), the TERMINAL quality sweep reviewed the whole integrated run branch before the PR — implementation never paid a gate. Gated on blocker/major only, so any minor/nit finding is in advisoryNotes and was NOT reworked; a cheap guard decided whether a multi-reviewer panel re-reviewed each fix (guardChecks). Gated repos had their PR opened by a gate dispatch after the sweep passed (the gate command run exactly ONCE, on the final tree; ungatedRepos lists any repo a halt left without its gate/PR). ' +
    (halt ? `Stopped early: ${halt.reason}. ` : 'Ran the project start to finish. ') +
    'Merge and deploy left to you. ' +
    (harnessLearning && harnessLearning.crystallize
      ? `HARNESS LEARNED: ${harnessLearning.crystallize.summary} — review its PR ${harnessLearning.crystallize.prUrl || '(none)'} before the next run.`
      : harnessLearning
        ? `Run ledger written at ${harnessLearning.ledger.path} (no PR this run, so no crystallize).`
        : ''),
}
