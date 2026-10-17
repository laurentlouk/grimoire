# Changelog

## Unreleased — architecture diagrams the code backs, and the docs as a vault

Two things the graph page could not show: what the system *is*, and what the team wrote about it.
Taking [archify](https://github.com/tt-a1i/archify) as the example but building grimoire's own (no
dependency, free to evolve), an architecture is now a typed diagram drawn as an interactive page,
one the code graph checks; and the project's Markdown notes open in the
page as an Obsidian-like vault, editable when the page is served
(`tools/graph/tests/arch-docs.test.mjs`, no parser runtime needed).

**Architecture (`/grimoire:architecture`, `lib/arch.mjs`, the Architecture tab)**
- A diagram is `docs/architecture/<name>.architecture.json`: typed components (frontend, backend,
  worker, database, messagebus, cloud, security, external, library, cli) with the `paths` of their
  code, the `imports` that reach them and `path:line` sources; boundaries; connections with a label,
  a variant and `via` for what the code graph cannot see; cards. `graph.architectureDir` moves it.
- `graph.mjs architecture draft` drafts one deterministically: one component per module of the
  system map, typed by folder names and the frameworks it imports; the external services its
  imports name (PostgreSQL, Redis, Kafka, AWS, Stripe, an LLM API… 23 known); a line per module
  link resolved by syntax. It never overwrites a refined diagram without `--force`.
- `graph.mjs architecture check` checks one against the index: the schema, every glob matching
  indexed production files, every source existing with its lines, each line between code
  components counted in file pairs (or importing files), lines the code shows only the other way,
  code links no line draws, files in two components, and the share of production files covered.
- The skill drafts, has the agent refine the draft by reading the code (names by responsibility,
  datastores and queues from config, trust boundaries, what flows on each line, sources), and
  checks until it passes, answering each warning.
- The tab draws every saved diagram and one drafted on each render, laid out by flow (boundaries
  as bands, free components beside their neighbours), at natural size with Fit, zoom and drag to
  pan. A line the graph confirms is solid; one it cannot see is dashed amber unless it names its
  `via`. A component's passport lists the code it covers, its sources and each line with what the
  graph saw; Upstream, Downstream and Route light up what the drawn lines reach (reachability, not
  runtime impact); *Code links not drawn* shows what the diagram leaves out.
- `docs/architecture/grimoire.architecture.json` is grimoire's own: 19 components, every
  production file covered, all 13 lines between code components confirmed by the graph.

**Docs (the Docs tab, `lib/docs.mjs`, `lib/md.mjs`)**
- Every `.md` and `.markdown` note of the project's repositories, and of the project root in a
  hub, in a folder tree; the header search filters by path and text, with the matching line.
- A Markdown renderer with no dependency, shared by the page and the tests: headings with
  GitHub's anchors, lists and task lists, GFM tables, fenced code, callouts (foldable), front
  matter as properties, `[[wikilinks|alias]]`, `#tags`, `==highlights==`. Raw HTML passes only as
  allowlisted tags rebuilt without attributes; links go out only to http(s) and mailto.
- Beside each note: its outline, its backlinks with the line that links, the indexed files it
  names (inline code such as `lib/render.mjs:42` opens that file's neighbourhood), and its
  unresolved links. A file's page lists the notes that mention it.

**Editing (`graph.mjs serve`, `lib/serve.mjs`)**
- The same page on `127.0.0.1`, re-rendered on every load, whose Docs tab can save: Read, Edit
  or Split views, Ctrl/⌘-E to switch, Ctrl/⌘-S to save, + New note, and an unresolved
  `[[link]]` offers to create its note.
- Local only, behind a random token: the host must be the loopback address (no DNS rebinding),
  writes must be same-origin JSON carrying the token, and only Markdown notes inside the
  project's repositories are written (no `..`, absolute path, skipped folder or symlink out),
  atomically. A save from a copy that changed on disk since is refused with the disk text, and the
  page offers to load it or overwrite; a served page reloads a note changed on disk when it gets
  focus back.
- Symlinks follow one rule, listing and saving alike: a note whose real file is outside its
  repository, or is not itself a Markdown note outside skipped and excluded folders, is never read
  into the page nor written, and a note symlinked to another note is saved through to its real
  file, so the link stays. Read-only notes
  are refused, a CRLF note is saved back with CRLF, and Markdown renders in linear time on any
  input (a note past 200 KB shows as plain text). One malformed diagram is reported in its place
  and never takes the page down.

## Unreleased — the run scorecard, and a journal that arrives whole

The log page could replay one run's decisions, but not say whether the runs deliver. Reading the
journals of seven real runs also showed that two drained runs were displayed as `running`, and that
three had lost a whole chunk of events (the first one, in two of them) without the page noticing. The page now reports both, and the
loop's writer no longer loses them (`workflows/tests/run-durability-journal.test.mjs`, the writer's
scripts run for real in bash, zsh and dash).

**Logs (`scripts/render-logs.mjs`)**
- **A scorecard opens the page**, over the runs the version, briefs and new project filters keep.
  It shows:
  - runs by outcome (drained, halted, running, stale) and the run success rate (drained over finished)
  - the task landing rate (landed over settled), first-round review pass, PRs opened
  - halts by kind, with how many a resume carried to a drain
  - median active time per run and median output tokens per landed task
  - implementers past their soft limit
  - per-persona FAIL and overturn rates, gates per repository
  - the journal's own completeness

  One row per run links to its overview. `summary` prints the same numbers first; `summary --json`
  adds `scorecard` and one `outcomes` row per run. Both use one function, so the CLI and the page
  never disagree.
- **A run whose final run.json write was lost no longer reads as `running`.** When the newest
  session wrote a `run.end`, its status wins over a `running` run.json, or one an earlier session
  wrote, and the overview says where the status came from. A run still `running` with no journal write for 12 h is marked stale.
- **A lost chunk is counted.** These are shown as an incomplete journal, so numbers that undercount
  say so:
  - gaps in `seq` within a session, and before the first session's first event
  - the writer's unfinished temp files (`<file>.<pid>`, `.chunk.<pid>`, `.runjson.<pid>`,
    `.landed.<pid>`, with `.b64`, `.s` or `.d`)
- **A halt the run resumed from is not its verdict.** The overview shows it as "halted in session N,
  then resumed" instead of in red on a drained run.

**Journal (`workflows/orchestrate-loop.js`)**

The haiku writer retypes every payload as base64, and the chunks that did not arrive were among
the biggest (12 to 24 events). One writer's leftover temp file decoded to a first chunk copied
wrong and cut short, and the engine counted an unconfirmed chunk and dropped it.
- **The first flush goes before the first dispatch.** It carries `run.start`, the startup checks and
  what was absorbed. The run is on disk from its start, and its first chunk is small. It used to wait
  for the first landing, hours in, with as many as 24 events by then.
- **A chunk also goes once the buffered events hold `flushBytes` bytes of JSON.** The default is
  3000; set it in `telemetry.flushBytes`. `flushEvery` still applies.
- **A chunk the writer did not confirm is sent again once,** in two pieces that carry its events
  only, with no run.json and no landed delta:
  - Each piece goes to `<firstSeq>.r1.jsonl`, never over a chunk on disk.
  - A piece still unconfirmed is lost, and counted.
  - A resend that writes nothing turns resends off for the run.
  - `telemetry.journal.resent` counts the chunks sent again.
- **The final run.json is sent again alone, up to twice, when it was not confirmed.** Nothing after
  the run's end rewrites it. `telemetry.journal.runJsonResent` counts these resends.
- **A flush's landed delta is capped at 4,000 bytes as well as 8 tasks;** one task always goes.
- A writer returning nothing still marks the writer dead after two in a row, resends included, and
  nothing is resent once it is dead.
- **The writer is a file now, not text the haiku retypes.** `workflows/scripts/journal-writer.sh`
  holds the lock, the attempt registry, the decoding and the checks, and ships with the engine
  copy, next to the briefs. It is the engine's `JOURNAL_WRITER` byte for byte:
  `npm run journal:writer` writes it, and a test checks it.
  - A flush now retypes under 1 kB of shell besides its payloads, against about 5 kB before.
  - Each flush checks the file's cksum before it sources it. A missing or altered file prints
    `WRITER missing` and writes nothing; that flush and every later one then carry the writer
    inline. `telemetry.journal.inlineWriter` says so.
  - `scriptsDir` overrides where the file is; the default is next to `briefsDir`.
- Each event is serialized once: the byte count and the chunk share its line.

**Loop (`workflows/orchestrate-loop.js`)**

The ship lock no longer lets two ships in at once. Two waiters on a dead ship's lock could both
remove it, the slower one after a third waiter had taken it fresh, and two ships then held the lock
(`workflows/tests/run-durability-final.test.mjs` F-6 replays each case on a simulated clock in bash,
zsh and dash; F-3 still runs six real waiters). Four bugs, all fixed:
- **A breaker's mutex could be broken too soon.** A takeover runs under a second `mkdir` mutex,
  `<lock>.brk`. A waiter read the mutex's time stamp before its breaker had written it, took it
  for 0 s old (so stale), and removed it while its breaker was still inside. The mutex now holds
  its breaker's pid, as the journal's lock does: it is broken once that pid is gone, or, with no
  pid in it, once 5 s old by its own age. The owner line is read again under the mutex and
  compared whole before the lock is removed.
- **A lock with no owner line was judged by the waiter's age.** One that had waited 10 s took over
  a lock made a moment ago, before its taker wrote its owner line. Such a lock is now taken over
  once 10 s old by its own age (its mtime, against a stamp the waiter makes beside it).
- **A holder ignored a failed owner write.** It held the lock with no owner line in it, open to
  takeover. Now it removes the lock and fails with `LOCK error`.
- **The gate's release removed whatever lock was there.** The gate releases "the moment it stops",
  so one whose take came back `LOCK busy` removed the live ship's lock it had waited for. Its take
  and release are different shells, so the engine now gives each gate dispatch a holder id,
  written where a ship writes its pid. The release removes the lock only while the owner line
  still names that id as `gate`; otherwise it prints `LOCK kept` and leaves it. A ship or the seal
  already removed the lock only while it named its own pid, and now says `LOCK kept` too when it
  was taken over meanwhile.

Three liveness fixes:
- After a takeover, `mkdir` is tried again at once, before the wait's budget is checked: a waiter
  used to report `LOCK busy` just after clearing a stale lock.
- A busy mutex is waited for with a backoff (0.1 s doubling to 1 s). Five instant tries used to
  give up in about 0.1 s with `LOCK error`.
- A lock released between a failed `mkdir` and the check that it exists is tried again; it used
  to read as `cannot create (not writable?)`.

Known follow-ups, not in this change:
- Take, release and break do not all happen under `.brk`, as they do in the journal's lock. A
  takeover judged on age (a ship still alive after 15 minutes, or a gate) can still race the
  holder's own release, in a window of a few system calls.
- The gate's heartbeat reads the owner line, then rewrites it. A ship that takes the lock over
  in between can have its owner line overwritten with the gate's.
- A waiter killed with SIGKILL while it times a lock with no owner line leaves its stamp
  (`grimoire-ship-<repo>.lock.<pid>.l` or `.b`) in the git dir. The stamp is harmless and git
  ignores it.

**Setup (`skills/setup`, `scripts/config-merge.mjs`)**

Re-running `/grimoire:setup` on a project already set up was not handled: nothing checked for an
existing `grimoire.config.json`, `.claude/settings.json` or memory before writing, and the
no-overwrite rule named only the Markdown instructions, the roster and agent definitions.
- **A re-run reads what is there, shows one diff, and writes only what is approved.** Step 0 gains a
  "Re-run" part beside migration mode. Hand-edited values are the user's choice, and secrets are
  referenced, never read. The no-overwrite rule now covers the config, the settings and memory.
- **`scripts/config-merge.mjs` makes the JSON diff.** It takes the current file and a proposal kept
  in the session scratchpad, and prints each key as ADDED, CHANGED or KEPT.
  - A CHANGED key is applied only when an `--approve` names its path, such as `repos[api].gate`.
  - `repos[]` are matched by `name` and `specialists[]` by `agent`; a gate is compared whole.
  - Permission lists and a hook group's commands are sets: the user's entries stay, and the
    proposed ones are added once. A hook is the same hook when its type and command are.
  - Without `--write` it writes nothing. With it, the write is atomic and keeps the file's mode,
    a symlink is written through, and nothing is touched when nothing changes.
  - It names each file by absolute path, and a symlink's target, and warns when an added repo
    sits on another repo's path.
- **Secrets of known shapes are masked.** The two JSON files are read only through the script,
  and its output prints `«redacted»` for:
  - every `env` value;
  - every value under a key named like a token, key, password, credential or auth;
  - inside any value, with the rest of the string kept: `Authorization:` and bearer headers,
    `token=`-style pairs, `--token X`-style flags, `mysql -pX`, `curl -u`, cookies, URL
    credentials, secret query parameters, JWTs, Slack webhooks, and token formats such as
    `ghp_…` and AKIA/ASIA keys.

  Keys and paths are never masked, so a repo named like a token prefix keeps its `--approve`
  hint. An invalid file's error gives its line and column only. The written file keeps the real
  values.
- **The user applies `.claude/settings.json`.** The guard closes that file to agents, so setup
  writes `grimoire.config.json` itself, but for the settings it prints the exact `--write`
  command and the user runs it. A dry run then confirms what is left.
- **The manager section binds the briefing's sources to read-only official tools.** It rides on
  the re-run diff, so a hand-edited source or threshold is kept.
  - It detects the trackers from the docs, `.mcp.json`, the session's connectors, PR templates,
    git remotes and `toolHints.tracker`, and proposes `manager.sources`: one per tracker, a `prs`
    source over the GitHub remotes, and `runs`. Each has a `hint`, a `scope`, and `readOnly`, what
    holds it today: `endpoint` (Linear's `/mcp/readonly`, GitHub's `/x/issues/readonly`) or `flag`
    (`--read-only`) only when the route already uses it, `admin-group` (a read-only account),
    `permission-rule` (`gh` for issues), or `guard` for a claude.ai connector and for the `gh` PR
    source, which only the guard's MCP rule and the scout's instructions hold. A stronger route is
    proposed apart, for the user to apply. Only the vendors' own tools and claude.ai connectors,
    never a community server.
  - Secrets stay out of context: `.mcp.json` joins the files read only through `config-merge.mjs`
    (its `headers` and `env` print as `«redacted»`), and a remote URL is read with its credentials
    stripped by `sed` as it is read.
  - Each source is read once before the diff and gets `verifiedAt`, again after the user corrects
    its scope or hint; a failing one is shown with its fix and not written. `config-merge.mjs`
    matches `manager.sources[]` by `id`, and a re-run reuses the id of a current source with the
    same kind and scope.
  - `manager.repoLabels` (new) maps tracker labels to `repos[]` names from the labels'
    descriptions, the description winning over the name: a `frontend` label described as the
    mobile app maps to the mobile repo, not the web app. A label the descriptions don't tie to one
    repo is left out and named.
  - For a GitHub tracker, the default `priorityLabels` (`priority: urgent` … `low`, `P0`–`P3`,
    `critical`); when the repo has no priority label, an offer to create the four `priority:`
    labels with `gh label create`, listed as a tracker write and run only when the user's answer
    names them. Labels are listed with `--limit 200`, so a long list can't hide them.
  - The `gh` permission rules: deny what the pipeline never runs (`gh issue close`, `delete`,
    `transfer`, `gh pr merge`, `close`), ask for what `to-issues` and claims do. The urgency
    defaults and `maxItemsPerSource: 200`; a re-run builds them and `priorityLabels` from the
    current block, so a hand-set value never shows as changed back to a default. An optional
    `repos[].remote` for a hub of nested clones, which the loop ignores.
  - `grimoire.config.example.json`'s `manager` block follows the spec: a `guard` Linear source,
    the default priority labels, `repoLabels`, and a repo `remote`.
- Checks: `scripts/config-merge.test.mjs` (135, a `.mcp.json` read against `{}` included), and
  the setup evals `setup-6` (a configured project re-run changes nothing before the yes, and
  never writes the settings itself), `setup-7` (a hand-edited gate is kept), `setup-8` (a Linear
  hub gets a `guard` source, `prs`, `runs` and `frontend` mapped to the mobile repo, with no
  secret read raw), `setup-9` (a GitHub repo without priority labels is offered them, created
  only when named), `setup-10` (a hand-set `stalledDays` shows no change) and `setup-11` (the
  briefing itself is the manager's).

**Guard (`hooks/scripts/guard.mjs`)**
- **Scouts can't write through MCP tools.** The manager's scouts read trackers through whatever
  connector the session has, and the guard did not see MCP calls at all. Now `hooks.json` routes
  `mcp__.*` to it. A call from the plugin's scouts or `reviewer` is refused when the first known
  verb in its tool part (after the last `__`, split on `_`, `-` and camelCase) is a write:
  `slack_send_message`, `share_issue`, `createJiraIssue` and `run_scheduled_task` are refused, while
  `list_task_runs`, `slack_read_channel` and `getJiraIssue` pass. The deny line names the verb
  that decided and tells the agent to report the write in its result; the main session applies it.
  - The implementers, generic subagents and the main session are never blocked, nor is a project's
    own agent the config names in `repos` or `specialists`, even one called `reviewer`; the plugin's
    `grimoire:reviewer` stays bound.
    `GRIMOIRE_GUARD_ALLOW=1` and `guard.enabled: false` lift it.
  - It reads verbs, a heuristic: a name with no known verb passes, an unknown write verb
    (`issue_cert`) included. The hooks README lists the limits.
  - An MCP call is judged by its name alone, before the guard asks git anything.

**Manager (`skills/manager`, `scripts/manager.mjs`)**
- **`/grimoire:manager` writes a briefing from the tracker:** what the team owes, grouped Decide /
  Do / Hand to AI / Waiting on others / Not now, each item with why it is there, its next step and
  its link. The skill dispatches `tracker-scout` once per tracker source in `manager.sources` (or
  `toolHints.tracker`, and says so, when there is no `manager` block yet), then runs
  `manager.mjs brief`. It never writes to the tracker.
- **The ranking is a tested script, not the model's judgment.** The scouts return WorkItems against
  `skills/manager/workitem.schema.json`, and the script refuses the whole file on any invalid item,
  naming the item and field, never the value. null in an optional field reads as absent: an
  unread `hasAcceptanceCriteria` shows as "not checked", never as "none". From the fields and one
  `--now`:
  - urgent: priority Urgent or High (`manager.urgent.priorityAtMost`), an SLA breaching within
    24 h or past, due today, overdue or within `dueWithinDays` (2) calendar days;
  - Decide: triage, or urgent with no assignee. Do: any other urgent item. Hand to AI: an issue
    with acceptance criteria, unassigned, nothing open blocking it, no linked PR, no sub-issues
    (the rest of D8, the repo check among it, came with launching: below);
  - the model's `bucketHint` moves an item only between the non-urgent groups: it never makes one
    urgent, nor moves one out of Decide or Do;
  - the order: urgent, priority (none last), due date, oldest created, id.
- **The files:** `.grimoire/manager/briefings/<YYYYMMDD-HHMMSS>.md`, `latest.md` (front matter with
  the counts, `generatedAt`, `partial` and the sources) and `ledger.json` (when each item was first
  seen, a hash of what matters, its last group), under one `.lock` broken after 30 minutes; a held
  lock exits 3. Ticket text is escaped for Markdown and HTML, its `scheme://` and `www.` can't
  become GFM autolinks, and its bidi controls are dropped. `view()` builds the one view model the
  page and the panel will render from, and it carries only safe http(s) urls (null otherwise).
- **`tracker-scout` reaches the tracker's connectors.** Its `tools:` line is gone, so it inherits the
  session's tools (a probe confirmed a subagent loads the claude.ai connectors with ToolSearch);
  `disallowedTools` takes away Write, Edit, MultiEdit and NotebookEdit, the guard refuses its MCP
  writes, and a `gh` write through Bash is held by its instructions and setup's permission rule. It
  has a memory file now. It maps native fields onto
  the WorkItem (Linear's priority as is, Jira Highest..Lowest to 1..4, GitHub labels by
  `manager.priorityLabels`; states onto the six state types, the native ones kept).
- `grimoire.config.example.json` has the `manager` block, documented in `workflows/README.md` as not
  read by the loop.
- **Every urgency rule.** Two more, each a named function next to the others and set in
  `manager.urgent`:
  - not started (backlog or unstarted) and blocking at least `blocksAtLeast` (2) open issues:
    "blocks 3 open issues". A blocked id the briefing did not read counts as open;
  - started with no activity for at least `stalledDays` (5) calendar days, from `lastActivityAt`,
    else `updatedAt`: "no activity for 6 days".
- **New and changed, from the ledger.** An item not in the last briefing is badged **new**; one
  whose state, priority, assignee, due date, blockers, labels or linked PR changed, **changed**.
  The items gone since, or now completed or canceled, are counted as resolved, not listed. The
  counts are in the view model and the front matter (`counts.new`, `.changed`, `.resolved`); the
  first briefing (no ledger) says "first briefing" (`firstBriefing: true`) and badges nothing.
- **Partial sources.** `brief --sources <file>` takes what each scout reported, which the skill
  now writes: `ok`, `capped` (its count shows as "≥ N", never as complete) or `failed` (listed
  under **Not checked** with its reason and fix, and `partial: true`). An item a failed or capped
  source didn't show is neither resolved nor dropped from the ledger. `tracker-scout` replies in
  prose naming the routes it tried when a source can't be read, never `[]`, and says so when it
  stops at `maxItemsPerSource`. Without `--sources`, the sources are inferred from the items.
- **`priorityLabels`** maps labels to 0–4 case-insensitively, defaulting to `priority: urgent` /
  `high` / `medium` / `low`, `P0`–`P3` and `critical`; a config map replaces the defaults. The
  scout applies it, and the script maps a `nativePriority` label itself when `priority` is
  absent, so the result is the same whoever maps it. An unknown priority ranks last.
- **Robustness.** A corrupt or old-schema ledger starts over, said once on stderr, with no crash;
  the ledger's `firstSeenAt` is re-checked; a date-time must be a real calendar day and clock
  time (`2026-02-30T10:00:00Z` is refused); `--items=/dir/a=b.json` splits at the first `=`; a
  stale lock is moved aside, re-checked and only then unlinked, so two runs breaking it never
  both hold it; a `.lock` that is a directory, or any state file the script can't use, is a
  one-line error. Checks: `scripts/manager.test.mjs` (222), and the eval `manager-5` (a source
  that can't be read is listed as not checked, with its fix).
- **Every session opens with the briefing's headline.** A new `SessionStart` hook,
  `hooks/scripts/briefing.sh`, runs `manager.mjs headline`, which reads `latest.md`'s front matter
  (in a linked worktree, the main checkout's too, and the newer wins) and prints one line:
  `grimoire manager · 2 urgent, 3 ready for AI · 1 new · briefing 5 h old (/grimoire:manager)`.
  "first briefing" replaces the new count on the first; the page's path follows when `briefing.html`
  exists; a partial briefing adds `partial: <ids> not checked` (brief now writes `notChecked` to
  the front matter); and past `manager.schedule`'s interval the line ends `stale, run
  /grimoire:manager` (`when` read leniently: a cron line, hourly, every N, weekly; daily, weekdays,
  no schedule or text it can't read is 24 h). It reads files only, never runs a briefing, and
  prints ids and counts, never ticket text: one line under 10,000 characters. No briefing, a
  corrupt one, an unreadable root or no `node` prints nothing, exit 0. Checks:
  `scripts/manager.test.mjs` (287 in all).
- **Open pull requests.** A `prs` source (`category: prs`, `scope.repos`) is dispatched with the
  tracker sources: `tracker-scout` reads `gh pr list --state open --json …` per repo (behind
  `requireHook.raw` when set, or GitHub's MCP) and maps each PR onto four new optional,
  null-tolerant WorkItem fields: `reviewDecision`, `checks` (`passing` / `failing` / `pending`, from
  the status rollup), `reviewRequested` and `isDraft`. The script places a PR by its own rules,
  first match wins: a draft → Not now, a pending review request (anyone asked) → Decide, failing
  CI or an approval not merged → Do, the rest → Waiting on others. A PR is never counted urgent,
  and its review and checks are part of its hash, so a change badges it **changed**.
- **Grimoire runs that need us.** With a `runs` source in `manager.sources`, `brief` reads the run
  journals itself (no scout), through render-logs' `loadRuns` and `runOutcome`, under
  `telemetry.dir` (default `.grimoire/runs`) in the project's main checkout, also when `--root` is
  a linked worktree. Each project's latest run is listed
  under Do when it halted (with the halt's first line), is still "running" with no journal write
  for 12 h, or drained with tasks that need attention; its next step names `/grimoire:orchestrate`
  on the project. A drained run with nothing pending is left out, and no runs directory is
  `runs (0)`, no error. Its status joins the sources like the others.
- **The headline names what people forget.** PRs and runs are never counted urgent, so `brief` adds
  `counts.runsNeedingUs` (the runs under Do) and `counts.prsFailing` (open PRs failing CI, drafts
  left out) to the front matter, and `headline` appends `· 2 runs need you · 1 PR failing CI` after
  the ready-for-AI part when either is above 0. An older `latest.md` without the keys gives the
  same line as before.
- **A shared briefing post, opt-in, replaced on every run.** `manager.share` (`null` by default,
  chosen at setup: a Linear document, a GitHub issue labelled `grimoire-briefing`, or a Slack
  canvas when the session has the Slack connector, replaced in place with no channel message)
  gives the team one view. `brief` now saves its view model as `latest.json`; `manager.mjs
  share-body` renders the post from it in Markdown: the groups, reasons, next steps, counts, Not
  checked and "≥ N", without the new and changed badges or a repo's availability (one person's
  ledger, one machine's checkouts), ending "generated
  by <git user.name> · at <time> · covering <sources>", with a hidden `<!-- grimoire:manager-briefing
  v1 -->` marker the skill finds its own post by (a canvas, by its id). Ticket text is escaped as
  in the briefing, its @mentions broken so the post notifies no one, and the body cut to a GitHub
  issue's 65,536 characters with "… N more". The skill's Share step finds the post through the
  vendor's tool, replaces it or creates it, and records the outcome with `share-status`: a failure
  is a "Share: failed (<reason>)" line in the local briefing, never filed anywhere. It is the
  manager's only write. `config-merge.mjs` compares `manager.share` whole. Checks:
  `scripts/manager.test.mjs` (401 in all, with launching), `scripts/config-merge.test.mjs`.
- **What ODY-872's review found.** A `--sources` file holding `null` is refused, no longer read as
  absent. A `manager.sources` entry missing from `--sources` is listed under Not checked, "not
  reported by the skill", and makes the briefing partial; without `--sources`, a configured source
  with no items reads the same way, since nothing said it was read. An `ok` source whose count is not its
  number of items shows both, flagged "count mismatch", and is not trusted as complete. The
  stalled rule reads the later of `lastActivityAt` and `updatedAt`. With neither `priority` nor
  `nativePriority`, the most urgent label in `labels[]` maps. Checks: `scripts/manager.test.mjs`
  (326 in all).
- **Launch from the briefing.** After the briefing, the skill offers the ready issues as
  multi-select checkboxes, one question per project, and one per source for the issues with no
  project (GitHub Issues), at most 4 options each, plus **All ready**,
  and starts what the user ticks: one new conversation per tracker project, through the host's
  session tool when ToolSearch finds one (the desktop app has one), else a prompt per project to
  paste. Headless runs skip the step.
  - **Hand to AI applies every D8 condition.** On top of the earlier ones: not started (an In
    Progress issue is not handed to AI), the assignee may be `claim.identity`, the issue maps to a
    `repos[]` entry (first through `manager.repoLabels`, so `frontend` reaches the mobile repo,
    then through its `repo`, else to a single-repo project's one entry), and that repo is
    available. Each failure is a reason: "no repo
    mapped: no label in repoLabels", "repo not checked out: repositories/webapp, fix: …".
    Only issues: a PR or a run keeps its own rules and has no repo check. `brief --check-repos`
    runs the check; without it a repo shows as "availability not checked".
  - **`manager.mjs repos`** reports each `repos[]` entry as JSON: available when its path is a git
    work tree (a directory a hub ignores must be a clone of its own), a registered submodule
    initialised. A failure carries its fix, and the command when it is one: `git clone --
    <remote> <path>` for a missing nested clone, `git submodule update --init -- <path>` for an
    uninitialised submodule (the `--` keeps a path that starts with `-` from reading as an
    option). A remote with any credential (on http(s), ftp or git URLs, any user name, a bare
    token included; a password anywhere) is never printed: the fix is prose, with no command.
    The skill runs a fix only on the user's yes. Clones `repos[]` doesn't name are ignored.
  - **`manager.mjs launch-plan --ids …`** re-checks the ticked ids against the WorkItems and a
    fresh repos check, and groups them per tracker project: a sliced project goes to
    `/grimoire:orchestrate`, a loose ready issue to `/grimoire:implement` then `/grimoire:review`,
    an issue without acceptance criteria to `/grimoire:roast` first. Groups that share a checkout
    run one after the other (`waitsFor`), never in parallel: a checkout is compared by its real
    path, so `repositories/webapp` and `repositories/webapp/` are one. Each prompt is self-contained and
    carries ids, routes and repo paths only, never a ticket's title, body, labels or project
    name: the launched conversation reads the tickets itself. An unknown, ambiguous or ineligible
    id is refused with its reason. Checks: `scripts/manager.test.mjs` (384 in all, the repos
    check on real temp git repos), and the evals `manager-6` to `manager-8`.
- **A local daily schedule, under the user's own login, no API key.** `/grimoire:setup` gains an
  opt-in schedule step, through the re-run diff:
  - **a desktop task first,** when ToolSearch finds the host's scheduled-tasks tool (the desktop
    app's `create_scheduled_task`): a local cron expression (weekdays 08:30 proposed, the time is
    the user's) and the prompt `/grimoire:manager scheduled <project path>`, created only on the
    user's yes to the schedule, and updated, never duplicated, on a re-run;
  - **otherwise a crontab line** the user installs: `cd "<project>" && mkdir -p .grimoire/manager
    && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN <claude> -p '/grimoire:manager scheduled
    "<project>"' --permission-prompts none [--max-budget-usd <budgetUsd>] >>
    .grimoire/manager/cron.log 2>&1`, with a `PATH=` line for `node` and `gh`. Never `--bare`
    (it needs `ANTHROPIC_API_KEY`), and no key anywhere: `env -u` drops one the shell or cron
    inherited, which `claude -p` would otherwise use instead of the login;
  - the `permissions.allow` rules a headless run needs (each source's read tools by name, the
    briefing's script and its input folder), for the user to apply. They name the version-pinned
    plugin root, so re-run `/grimoire:setup` after `/plugin update`. Then a headless probe,
    `env -u … claude -p "<one read per source>" --permission-prompts none`, run only on a yes; the
    `runs` source is read through the `manager.mjs` call, as a scheduled briefing reads it. A
    source that fails headless is flagged with its fix, and a schedule whose probe passed gets
    `verifiedAt`. Creating the schedule is a second yes;
  - `manager.schedule` is `{kind: 'desktop-task' | 'cron', when, taskId?, verifiedAt?}`, and
    `budgetUsd` is the user's call, proposed and said so.
- **Headless briefings carry the launch prompts.** A run that can't ask (no AskUserQuestion, a
  `-p` run, a scheduled prompt) skips the checkboxes and runs `brief --headless`: the briefing ends
  with **Launch prompts**, `launch-plan`'s prompt for every issue in Hand to AI, one per project,
  each in a fence nothing in it can close, ids, routes and repo paths only. The opt-in shared post
  still goes out (the user's standing ask); its write needs its own allow rule, else the share is
  recorded as failed. `--headless` checks the
  repos, as `launch-plan` does; without it there is no such section.
- **"Stale" reads the schedule better** (ODY-873's review): a cron restricted to some days of the
  week other than `1-5`, or to a day of the month, reads as a week, not 24 h; "weekdays" and a
  `1-5` cron skip the weekend, so Friday's briefing is fresh until Monday's run (cron's day names
  read as its numbers, `mon-fri` as `1-5`, and a day of the month of `1-31` is every day); and a 15 minute
  grace comes before "stale" (a desktop task starts a few minutes late). Whole days are added on
  the calendar, so a DST change keeps the run's hour. Checks: `scripts/manager.test.mjs` (426 in
  all, with the shared post), and the evals `setup-12` (a desktop task proposed, nothing created before a yes) and
  `setup-13` (a crontab line, no `--bare`).
- **A visual briefing page.** Every briefing run, scheduled ones too, writes
  `.grimoire/manager/briefing.html` (`manager.mjs render --html` writes it again, `--out` elsewhere),
  and the skill prints its path to open (`open` on macOS, `xdg-open` elsewhere). One self-contained
  file, as the run log's: inline CSS and JS, a CSP with no network, light and dark; the view is
  embedded as JSON that ticket text can't break out of, every node is built with `textContent`, and
  only http(s) urls become links. It shows the groups in the Markdown's order, the counts, Not
  checked, the badges, filters (urgent, ready for AI, PRs, runs), checkboxes on the ready issues with
  **Select all ready**, a disabled row with its fix for an issue held back by its repo, and **Copy
  launch prompt** per project: the page runs launch-plan's own planner (`planLaunch`), so the copied
  prompt is launch-plan's text, ids, routes and repo paths only, with a box to copy from when the
  clipboard is unavailable. `manager.mjs view --json` prints the view model the Markdown and the page
  both render from, now with each issue's launch pick, `heldBack`, and the launch plan for every
  ready issue (`launch.allReady`), which a headless briefing's **Launch prompts** now print: one
  source for the page's prompts and the scheduled briefing's. Checks: `scripts/manager.test.mjs`
  (463 in all with the shared post's and the schedule's, the page run under a minimal DOM).
- **The briefing as a panel in the desktop app, with Launch.** When ToolSearch finds a widget
  tool that renders HTML in the conversation (the desktop app's `show_widget`), the skill runs
  `manager.mjs render --widget` and passes its output to the tool verbatim: the model writes no
  HTML around ticket text. The fragment shows the counts, the groups with their urgent, new and
  changed badges (Decide and Do capped, Waiting on others and Not now as counts), a checkbox on
  each ready issue with **All ready**, a disabled row with its fix for an issue held back by its
  repo, and **Launch**, which sends `/grimoire:manager launch <ids…>` into the session: plain ids
  taken from the panel's data and checked again, never a title. It is built like the page (data
  escaped against `</script>`, `<!--` and U+2028/2029, `textContent` only, http(s) links only),
  styled with the host's CSS variables, and stays compact (13 KB for a 200-item briefing). Without
  a widget tool, the AskUserQuestion checkboxes and the page's path stay.
  - **`brief` writes `latest.json`**, the view itself. `render --widget` reads it (its badges are
    the briefing's), or builds a fresh view from `--items` and brief's other flags.
  - **`manager.mjs launch-check <ids…>`** checks a launch message's ids against `latest.json` and a
    fresh repos check, then prints `launch-plan`'s plan. It refuses, with the reason, an id that is
    not plain, not in the latest briefing, not under Hand to AI there, or whose repo became
    unavailable since (with the fix), and every id of a briefing stale by the headline's rule
    (`staleAt`). A held-back issue carries its launch pick now, so it launches once its repo is
    fixed.
  - **The page's CSP** allows its one script by the `sha256` of its exact body, no longer
    `script-src 'unsafe-inline'`.
  - Checks: `scripts/manager.test.mjs` (507 in all, the panel run under the minimal DOM with a stub
    `sendPrompt`), and the evals `manager-9` to `manager-11`. The panel shows in a session only:
    a headless briefing keeps its **Launch prompts**.

**Tests (`scripts/run-tests.mjs`, the loop-durability files)**

The suite took about 9½ minutes, one file after another, and six loop-durability files spent
most of that waiting, not computing.
- **The files run in parallel** (the CPU count by default; `--jobs N` or `GRIMOIRE_TEST_JOBS`),
  slowest first. The lock and concurrency trials, and the graph's millisecond-bounded rendering
  check, run alone afterwards, so a busy machine cannot make them flaky. Each file's output is
  printed whole when it ends, and every failure is listed at the end, not only the first.
- **`npm run test:fast`** leaves out the six slow loop-durability files: the other 22 files in
  about 25 s, for iterating. `npm test` and CI still run everything.
- **The six slow files wait less and assert the same.** Their shells (bash, zsh, dash) now run
  side by side on sandboxes of their own, setups are copied from one template instead of rebuilt,
  fixed sleeps became waits for the condition the test then checks, and timeouts sit at the
  smallest value that still proves the behaviour. No assertion was removed or loosened; mutated
  copies (a slow heartbeat, a long lock wait, a late deadline) still fail.
  - `hardening` 105 → 28 s, `followups` 105 → 41 s, `delivery-fix` 85 → 43 s, `final` 72 → 12 s,
    `statewrite` 58 → 18 s, `resume` 46 → 11 s, each run alone.
- **`run-durability-final`'s lock trial was flaky for a reason:** it catches a real race in the
  ship lock, where two breakers can both take a stale lock and two ships end up inside at once.
  The engine fix is its own change.

## 0.11.0 — trust and see

The code graph's first release on its roadmap: make the links worth trusting, then draw them so a
project of thousands of files still reads. Measured on a four-repository project (2,432 files):
before, 30.6% of call links were name guesses and the map was one spiral of 1,500 dots.

**Links worth trusting**
- On a receiver whose type the syntax does not state, a standard-library method name (`len`,
  `get`, `has`, `update`…, listed per language in `COMMON_METHODS`) is no longer linked by name to
  the one method the repository happens to define with that name. One `len` had collected 305
  false callers that way; it now has 2. `self.len()`, `Type::len(x)`, a typed receiver and
  `super().update()` still resolve.
- A method on a chain that starts in a dependency is the dependency's: a call chain whose path
  before its first call starts at a type the repository does not define
  (`UpdateItemOutput::builder().build()`, `new Intl.NumberFormat(..).format()`), or a Rust path
  rooted at a crate the repository does not have (`chrono::Utc::now()`, `std::env::var`). A type,
  namespace or module the index knows anywhere on that path, or a call heading it to the
  repository's own constructor or factory (`Order().total()`, `NewBuilder().Build()`), keeps the
  chain in the repository;
  SCREAMING_CASE heads are constants; a Rust crate counts as the repository's by its folder, an
  inline `mod` or its Cargo.toml package name; a turbofish or a call argument is not a path.
- A standard-library name on a receiver the syntax constructs from a repository type
  (`Store::new().len()`, `new Store().get()`, `Reg.getInstance().add()`, `Store.shared`) is that
  type's; `self.__class__` and `type(self)` count as `self`.
- Result on that project: call links 21,710 → 19,286, name guesses 30.6% → 22.7%. Some 170
  `import` and `same-file` links went too: the same `len`/`get` calls, matched within a file.
- Storybook stories, `mocks/`, `__mocks__/`, `fixtures/` and `__fixtures__/` count as test code
  (172 files there), so they no longer rank as the most connected production code.
- `.tf`, `.tfvars` and `.hcl` files are indexed by name (an infrastructure repository showed 0 of
  193 files); the infrastructure tools' cache folders and lock files never are.
- `graph_status` reports per repository how many call links are name guesses (`unique-name` and
  `ambiguous`; the README defines the term).
- Schema 3: an index built by an older version rebuilds once, on the next query or write, so it
  takes the new rules at once. It adds `churn`: how many of the last 400 non-merge commits touched
  each file, commits touching more than 25 indexed files left out. A repository dropped from the configuration
  drops its churn too.

**A page that groups before it draws**
- Map opens on a system map: one lane per repository drawing its 14 largest modules (folders of
  production code; a folder holding more than 35% of its repository splits into its
  subfolders, `lib/modules.mjs`), in the order code flows, each line a module using another, its
  width the file pairs linked by syntax. Modules in a cycle share a rank; links across repositories
  are drawn but rank nothing. It never shows test code or name guesses. Hover for links and
  counts; click a module for its files on the file map, fitted to it. That project reads as 52
  drawn modules of 83 instead of 1,500 dots.
- A symbol or a file opens beside the list as a neighbourhood: what uses it on the left, what it
  uses on the right; resolved links solid and first, unique-name dashed, ambiguous hidden; every
  hidden count said; the full lists one click away. A file link is as sure as its surest edge.
- Test code and ambiguous links stay hidden until their toggle is on, in the lists, the
  neighbourhoods and the file map, whose cap goes to production code first and whose ranking no
  name guess decides.
- Hotspots rank by links resolved by syntax, name guesses counted apart, and open on a treemap
  of the 400 largest files by size and churn, its legend giving each colour's real range.
- File labels carry their folder; tables wrap paths and keep their counts visible; views have
  plain anchors (`#sym-12`, `#file-3`, `#mod-4`, `#hotspots`). They hold for the index the page was
  rendered from: a re-parsed file gets new ids, and module numbers shift as modules change.
- Keyboard: every list row and link is a real link (`#sym-`, `#file-`, `#mod-`), drawn modules,
  neighbourhood items and treemap tiles are buttons (Enter or Space), focus moves to what opened,
  the header keeps focus across re-renders and the search keeps its caret.
- The CSP admits only the page's own script, by its SHA-256, instead of any inline script: a name
  that slipped past escaping could no longer run code. One did during this work (an `esc()` whose
  last two replacements a trailing comment had swallowed); a test now pins `esc()` itself.
- A generated 10,000-file index renders in about a second into a 3.3 MB page.

**Checks**
- `tools/graph/tests/graph.test.mjs`: 164 checks (84 before): false links and their legitimate
  look-alikes in Rust, TypeScript and Python; file classes; churn (and a sweep that counts for
  none); schema migration on a query; modules, ranks and cross-repository links; the fixture's
  exact system map; the page helpers (escaping, anchors, link sureness, churn bands, treemap,
  lane cap, defaults); the file map's ambiguous-only flag; the CSP hash; and the page's own script
  run against a stub DOM: every view renders, anchors open what they name, the test toggle changes
  what a neighbourhood hides. Each rule that keeps a chain in the repository has its own fixture,
  checked by mutation.
- Three independent reviews (engine, page, tests and docs) found one blocker, six majors and a
  dozen minors; a re-review of the fixes found one regression (a chain headed by the repository's
  own constructor was dropped) and a wrong claim about anchors. A third round on the whole release
  found constructed receivers losing standard-library names, list rows a keyboard could not reach, a
  search caret that jumped, per-repository co-change lost behind a global limit, and tests that a
  regression could pass. All are fixed in this release.
- New eval case `graph` #5.

## 0.10.0 — trust the learning

Three changes that turn promises the harness already made into checks, drawn from a comparison
with Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook):
every gate trusts the tests, so a fix may not weaken them; what CI checks should fail before a
push, not after it, without any key; and the agent that wrote a lesson may not approve it.

**A fix must not weaken a test**
- Loosening the test that exposed a finding is the cheapest way to make the finding go away, and
  nothing caught it: the precheck only checks that tests moved with behaviour, and the
  whole-task diff a re-review reads shows a test the task added and a fix then weakened as one
  weak test, added. Every fix a review sends back (spec, quality and the terminal sweep) now gets
  a fact sheet built from the fix's own diff by one fixed command (no model, no per-repo
  configuration): the test files that existed before the fix and that it deleted, the assertions
  it removed from them, the skips or focus markers it added. The terminal sweep has no task
  range, so its fix range comes from the fix's own report, and its guard now reads the fix diff
  too instead of having to find the commits.
- The guard reads it and sends an unjustified weakening to the panel with a reason starting
  `test weakened:`. In a re-review round exactly one reviewer gets it (break-it, else the spec
  hawk, else the first lens), with the findings the fix answered, and raises it as a blocker
  unless one of them asked for that test change (`briefs/guard.md`, `briefs/review.md`). The
  verifier of that round is handed the fix diff too, since the whole range cannot show a removed
  line (`briefs/verify.md`). The interactive `review` skill applies the same rule.
- A removed assertion is cited by its line before the fix. Deletions of empty or binary test
  files are listed, renames are followed (a test moved and loosened shows under its new path),
  docs are never tests, and the sheet stops at 60 lines of 240 characters with a count of the rest.
- Tested for real against a temp git repo in bash, zsh and dash: a removed `expect()`, an added
  `it.skip`, an emptied Go `t.Errorf`, a deleted `test_*.py`, a Rust `#[ignore]`, a JUnit
  `@Disabled`, an NUnit `[Ignore]`, a Cypress `should()`, a `tests.py`, a path with a space, a
  renamed and loosened test; not code outside test paths, not docs, not tests the fix added;
  `(none)` for a clean fix and a plain failure line when git cannot read the range. The engine
  side covers the guard, one judge per re-review round (also on its retry), the verifier, and a
  second fix round reading the second fix (`workflows/tests/fix-test-integrity.test.mjs`).

**A pre-push check, no key**
- `.githooks/pre-push` (`npm run hooks` once per clone) runs the fast checks CI runs, the drift
  check and the generated `evals/` in sync with `skills/*/evals/evals.json`, on exactly the
  commit being pushed (a temporary worktree, so uncommitted edits never skew it), and blocks the
  push when one fails. No model, no API key, no sign-in; about a second per pushed commit. The
  full test suite (minutes) stays in CI. It never wedges a push on its own problems (no node, a
  commit it cannot check out), and `git push --no-verify` skips it (`scripts/pre-push.test.mjs`,
  through a real `git push`).
- Running the eval cases stays manual and paid: `claude plugin eval .`, which needs the
  command-line `claude` signed in. Nothing in grimoire needs an API key.
- New cases: `review` #5 (a fix that loosens an assertion and skips a test is not passed) and
  `crystallize` #5 (a clean crystallize PR is still not merged by its author).

**The re-flag count crystallize reads**
- `render-logs.mjs summary` counted any guard PASS in a repo whose terminal slot did not end
  PASS as "re-flagged by the terminal sweep". So a sweep that died, or whose reviewers were
  unavailable, counted as a re-flag, and a repair task that landed after the re-flag counted
  too. Meanwhile the real case was missed: a sweep that raised a blocker, fixed it and passed.
  Its reviews belong to `<repo>:final`, which mapped to no repo.
- It now counts per-task guard PASSes (the sweep's own guard can't re-flag itself) whose repo
  the sweep re-flagged after the pass. A re-flag is a blocking terminal review, even one a fix
  then cleared, or a FAIL verdict. The match is still per repo, not per finding, so read the
  number as an upper bound. On the new test's run it reads 1 of 4, where the old count read
  3 of 5 (`scripts/render-logs.test.mjs` §6). The figure `crystallize` uses to decide whether
  to tighten the guard brief no longer rests on harness failures.

**`crystallize` is not loaded before the PR exists**
- A pre-PR request ("capture the learnings now, before the PR") loaded the skill just to
  decline. Its description said "Never mid-implementation", but that wasn't enough for the
  model to skip loading it, so eval case `crystallize-2`, which expects the skill not to fire,
  failed. The description now says such a request is answered without the skill, by saying
  the PR and its review threads come first.
- In-session runs, judged by whether each transcript opened the skill: the negative case
  loaded it in 0 of 3 runs with the new description, against 2 of 3 with the old; the four
  positive cases still loaded it, 4 of 4. Every run still declined correctly and wrote nothing.

**A human merges every crystallize PR**
- The `crystallize` skill let the orchestrator merge a "clean" crystallize PR once a few had
  come back clean; its loop brief said never merge, and the engine never did. They now agree: a
  human merges, because the agent that wrote a lesson must not approve it. The clean checklist
  stays, as what the PR body reports so the merge is quick, and "evals green" says how they
  were run.

## 0.9.1 — the 0.9.0 follow-ups

The minor findings recorded from the last review rounds of 0.9.0 (issue #14). None blocked a run
in the common case; each is fixed and tested for real in bash, zsh and dash
(`workflows/tests/run-durability-followups.test.mjs`), and the whole suite now passes on Linux
too, where only the journal script had run before.

**Delivery and ship**
- **An unreadable PR is UNKNOWN, never a draft.** When `gh pr view` (or `gh pr list`) failed
  (a 502, a timeout), the ship script treated the PR as a draft and pushed to it and rewrote its
  description, though it may have been ready. It now prints `UNKNOWN`: nothing is pushed,
  rewritten or claimed (a halt posts no status comment there), the next ship retries, and the
  `ship` event says `skipped: 'unknown'`.
- **The integrate step's `headSha` is required with MERGED**, and one that leaves it out is asked
  once more, read-only, inside the repo's merge queue: the run branch's head, accepted only when
  it holds the reviewed lane tip. A landing without it was never shipped.
- **Nothing is dispatched once the workflow has returned.** A wedged gate's seal or a late halt
  ship could be dispatched after the body returned, and the runtime does not say what becomes of
  such a call: it is now skipped and logged, and a relaunch resumes from the PR and `run.json`.
- **Bounded steps under the lock.** The repo's `laneSetup` in the ship worktree runs under the
  script's time limits (at most 180 s), and the gate pushes through a script that renews its
  lock's age every 60 s while the push runs: a pre-push hook longer than 20 minutes no longer
  loses the lock to a ship.
- **Free text never closes an issue.** A closing keyword before an issue reference in a title,
  an implementer's summary or a halt reason ("… Closes #99") gets a zero-width space: the PR
  body closes only the issues the engine names.
- **The run branch key.** `SOC-2 …`, `GPT-4 …`, `COVID-19 …`, `AES-256 …`, `Q3-2026 …` (standards,
  models, periods, versions) no longer key a project; "Auth rewrite — PROJ-700" keys as
  `PROJ-700`; a GitHub project URL keys with its owner (`acme/projects/7`). A verified marker
  written for another wording of the same key is logged with that text. A run started before
  0.9.1 whose key changes (one of those texts, or a project URL) builds on a new run branch: pass
  `runBranch` with the old name to keep resuming it.

**Resume and state**
- **The reconcile** checks the checkpoint's tasks first (up to 250 per repo, named by
  12-character SHAs), then the marker's, once per task (a single-commit task's two lines never
  deduped), and shares what a repo's even share leaves to the repos that need more: one repo of
  three with 250 landed tasks gets about 215 checked, not 70.
- **The journal mutex** holds its holder's pid and is broken only when that pid is gone (a 5-s
  timer alone broke live ones: 4 of ~100 trials overlapped at 16 writers); the lock's pid is read
  again right before it is broken; `GRIMOIRE_LOCK_STALE` is at least 1; without `date +%s` the
  journal and ship locks count their sleeps (their waits had no end); a clock jump (the machine
  slept) ages no lock; `landed.jsonl`'s path reaches `awk` through the environment.
- **A replan's tasks** are listed in the PR marker (`replan`) and absorbed from it under the
  checkpoint's rules, so another machine no longer redoes them.
- **`trustNewerMarker: true`** takes the higher of each counter from a verified marker newer than
  `resumeState` (this machine's `run.json` behind another machine's run). Off by default: a PR body
  never sets the budgets on its own.
- **Every landed detail reaches `landed.jsonl`:** after the final chunk (8 details at most), one
  more per 8 follows (`landed.flush`) while each is confirmed.

**Not covered here**: a run against real GitHub and the real Claude Code Bash-tool output limit
(both need a real session; see issue #14).

## 0.9.0 — run durability

Fixes found in a real unattended run on 0.8.0: one static-site repo, ten issues in a strict
blocked-by chain, `maxPerRepo` 1. It ran about 29 hours (29.4 h of wall clock over three
attempts, plus about 9 hours waiting on the user), built seven slices and opened no PR. Its
agents' time, which overlaps wherever dispatches ran side by side, went to implementing
(12.7 h), reviewing (8.2 h), hydration (3.6 h), replans (2.2 h), prechecks (2.1 h) and journal
and ledger writes (1.3 h). About 16.6 of the 29 hours were a third-party PreToolUse Bash hook
timing out at 30 s on every call: 0.8.1's session probe (`maxToolLatencySec`) refuses such a
session, but the installed plugin was 0.8.0. About 9–10 hours were wasted on the failures
below. The run halted three times: on the replan budget, on a hydration timeout, and on a
locked 1Password commit signer; the Mac also hibernated on battery mid-run. Nothing reached the
remote until a human pushed it. All fixes are engine-, brief- and skill-level and
stack-agnostic.

- **A timeout makes a dispatch late, not dead** (`agentHardTimeoutMin`, default 180;
  `timeouts`). An agent cannot be cancelled, yet the run booked agents dead at 40 minutes while
  they kept working. In the first attempt a "dead" implementer was re-dispatched into the
  checkout it was still writing (about 4 hours of failures on the first slice); in the second,
  two implementers booked dead ran 78 and 115 minutes in all, committed their slices, and cost
  1.5 hours of replans that sent them back as "verify-only". `agentTimeoutMin` is now a soft
  limit: the dispatch is logged as late, still awaited, and its result accepted. At the hard
  limit a reader is given up on; a writer is marked wedged and fences its repo (nothing else is
  dispatched or requeued into that checkout) until it returns, and when only wedged work is
  left the run halts with `kind: 'wedged'`. A lane whose review passed while its repo was
  fenced settles `FENCED`, its worktree kept for the retry. A hydration that returns nothing is
  retried once and a late one is accepted (a 43-minute hydration halted the second attempt).
  Only quick deaths count toward the circuit breaker. Events `late`, `wedged`, `late-result`,
  `fence`; `telemetry.late` (each outcome `accepted`, `died`, `abandoned`, `wedged` or
  `pending`) and `telemetry.wedged`; `needsAttention` lists a still-running task as
  `STILL_RUNNING`.
- **A draft PR from the first landing, and the run's state in it** (`deliver`, default
  `'incremental'`; `shipOnHalt`; `draftPr`). After each landing, one haiku dispatch
  (`briefs/ship.md`), in its own worktree, pushes the exact landed SHA to the run branch
  (fast-forward, hooks run, never forced) and opens or updates the repo's draft PR with `gh`.
  Its body is the run's proof (each landed task with its title, head SHA and "passed spec and
  quality review", what is still open, and the exact resume instruction) and ends with a hidden
  state marker, `<!-- grimoire:state v1 <base64 JSON> -->`, rewritten on every landing: per
  repo, the run's counters and each landed task as `[id, headSha]` or `[id, headSha,
  firstSha]`, filling at most 8,000 characters of base64 (up to 100 tasks, about 80 when each
  has a first commit of its own: first commits are abbreviated, then landed tasks' fix rounds
  dropped, before the newest tasks are left out), with no titles, learnings or summaries. The
  terminal slot waits for the repo's pending ship, then the gate marks the PR ready and keeps
  the marker. On a halt (also a wedged one: only the last reviewed head is pushed) every repo
  pushes what landed, gets its draft PR if it has none, and gets a status comment: the reason,
  what to fix first, what landed, what is open, any agent still running, how to resume; a repo
  whose terminal slot is still running is left to that slot, and gets its halt ship if that slot
  ends without a green gate. A ship failure never halts or replans: two failed pushes in a row,
  or a pre-push hook that wants the gate, stop that repo's incremental pushes
  (`shipped.<repo>.disabled`), and a failed push asks for an environment check. New result
  fields `draftPrs` and `shipped`, event `ship`; `prs` still lists ready PRs only, one per repo
  (its latest gate).
- **A ready PR is the gate's, and a PR claims only what reached the remote.** A final
  adversarial review of incremental delivery proved, each with a repro, that a land ship pushed
  unswept work onto a PR its terminal slot had marked ready and replaced the gate's description
  with the draft banner (after a replan landed more work there, or on a resume), and that a
  failed push still rewrote the description over heads the remote never got. A PR out of draft
  now belongs to the gate: the engine knows it from the gate, every ship's receipt and the
  reconcile (every open PR, on a fresh start too), and the ship script reads
  `gh pr view --json isDraft,body` before anything moves, so a PR a person marked ready by hand
  is left alone too (`READY`; event `ship` with `skipped: 'ready'`). New work there waits for
  the repo's next terminal slot, whose gate pushes it after the sweep and rewrites the title and
  body over every task; the PR stays ready. A halt on a ready PR posts only its status comment.
  The description is rewritten only once the remote holds the pushed SHA: a failed land push
  posts a short note instead, a failed halt push a "push FAILED" comment naming where origin is,
  and a task the remote does not hold reads "landed locally, not yet pushed", with no closing
  keyword. An integrate step that reports MERGED without the run branch's head leaves its
  landing with no head, so no ship ever pushes a lane tip.
- **One ship at a time, within its limits.** A ship given up on at its 12-minute hard limit
  kept running next to the next ship, the halt ship and the gate, on one worktree and one PR,
  and its push alone could run 15 minutes. The ship script now stops by 540 s
  (`GRIMOIRE_SHIP_DEADLINE`) and its push by 480 s, each network call in its own process group,
  killed whole. Ships take a per-repo lock, `<git-common-dir>/grimoire-ship-<repo>.lock`: a ship
  waits up to 150 s for it (`GRIMOIRE_SHIP_LOCK_WAIT`), a holder whose pid is gone or that is 15
  minutes old is taken over, and `LOCK busy` moves nothing and is no failed push (`skipped:
  'lock'`). The gate takes the same lock before it pushes, 90 s an attempt and up to five, else
  BLOCKED with `failedStep: 'push'`; ships honour a gate lock for 20 minutes, and the next gate,
  the seal and the halt ship take one over at once. A ship that starts late never overwrites a
  newer description: the marker carries the `session` and the body generation (`ship`). The
  ship worktree is reset before each ship (a hook that edited it would block the next), the
  scripts run under bash, zsh and dash, and a halt removes only this run's
  `review-<repo>--<task>-` worktrees (a bare `review-` match took lanes of a repo named so).
- **No forged state marker; the gate's copy is sealed.** An issue titled
  `Add login <!-- grimoire:state v1 … --> page` put a forged marker above the real one, which
  the reconcile read first: on another machine every task was redone. Every engine-built PR body,
  comment and note, and the titles, summaries and project text of the gate's prompt, now break
  `<!--` and `-->` with a zero-width space, and the reconcile and the ship's PR view read the
  last marker of a body. The gate retypes up to 8,000 characters of marker into the final body
  with no check, so after a green gate `seal:<repo>` reads the body back and, when its last line
  is not exactly the marker, puts it back (decoded and checked): the one edit the loop makes to a
  ready PR, never its ready state. A seal that fails twice is logged, not a failure (event
  `seal`).
- **Landed work survives the session and is absorbed on resume.** The checkpoint recorded
  landed ids that nothing read back, and the tracker keeps issues open until the PR merges, so
  each new session re-dispatched landed work. Checkpoint v2 records every landed task's run
  branch, head and first commit, and the journal flushes on every landing. At startup the index
  reconciles what `resumeState` and the draft PRs' markers list against the run branch, and the
  engine absorbs a task only when its head (and its first commit) is on the run branch and not in
  the base (`absorb` event; `resumedLanded`, with `source: 'checkpoint' | 'pr'`), so a new
  session or another machine continues where the last one stopped. Reviewed SHAs are now per
  task and per run branch: one task can no longer cite another's reviewed head and land
  unreviewed. An implementer that finds its work already on the branch returns `landedBefore`
  instead of an empty range: SHAs reviewed for that task land as they are, others are reviewed
  as that range, and no "no change" fix is bought (the third attempt's empty ranges bought fix
  rounds that returned invalid start SHAs).
- **A preview proves the resume before it runs.** The preview's reconcile runs read-only and
  returns `resumedLanded`, `unverifiedLanded` (listed as landed, not verified: built again),
  `stillToBuild` and `branches` (each repo's run branch, sync state, PRs and marker verdict),
  with one line, `◎ resume: <k>/<n> landed, verified on <run branch> @ <sha> — still to build:
  <ids>`. Its `estimate` counts only the work still to build.
- **A PR state marker is trusted only as far as it is verified.** Anyone who can edit a PR body
  can write a marker, and a review showed a planted one could put learnings into prompts, get
  foreign ids or an ancestor head absorbed, and halt a run at start with
  `outputTokensSpent: 5e9`. Now the index agent's copy must match the length and `cksum` the
  script printed; the marker must name the same project (by key, unless the run branch is set
  explicitly), repo and run branch; only PRs from the same repository are read, never a fork's;
  only ids of this project's index are absorbed, and only with heads outside the base; the
  counters are clamped to what the project plausibly reaches (`attempt` at most 1,000, `lastSeq`
  at most 500 per issue plus 5,000: a planted marker once set them to 10,000 and 10⁷); and no
  marker text reaches a prompt (learnings come from the local checkpoint only). The last marker of
  a body is the one read, and one over 8,000 characters is reported by its length
  (`marker=toolong`), never printed: one of 441 KB overflowed the Bash output and cut the lines of
  the repos after it. The `resumeState` passed in goes through the same rules: a hostile one
  absorbed `#1337` (the PR would have closed it) and put an `rm -rf` learning into prompts. Only
  the project's issues are absorbed from it, plus a replan's own task when its record says
  `replan: true`, the checkpoint's `runId` (which it now records) is this launch's and the id
  cannot read as an issue reference; a record's ticket is its id; its counters are clamped like a
  marker's (its output tokens kept up to 10⁹: they are the run's own); its learnings are the last
  30, each up to 300 characters, and a `resumeState` shaped like a marker brings none. When a
  `resumeState` is passed, its counters win over every marker's, newer or not; without one, the
  newest verified marker carries them.
- **The reconcile runs under bash, zsh and dash, within 90 seconds.** The Bash tool runs the
  user's shell, and in zsh `"$3:refs"` is `$3` with the `:r` modifier: on a fresh clone the run
  branch was never fetched and every landed task ran again. The script is POSIX sh with every
  risky parameter braced, checks repos in parallel with a 30-second limit on each fetch and `gh`
  call and one 90-second deadline (sequential limits once took 181 s against the Bash tool's
  120), and prints `fetch=`, `inBase=`, `ahead=` and `WARN` lines the engine logs. It fetches
  the base as well as the run branch, so a branch merged upstream since never reads as unmerged
  work. Its output is capped at 28,000 characters, split evenly per repo: `BRANCH` and `PR` lines
  always print, `TASK` lines (at most 100 from the marker and 100 from the checkpoint per repo)
  stop at the repo's share, and a `WARN` line counts the tasks left unchecked. Without `perl` or
  `timeout`, each fetch and `gh` call runs in the background and is killed at its time limit,
  where a hung fetch used to outlive the script.
- **A run branch the run cannot build on refuses the launch.** For a repo with work left, a
  local run branch that diverged from origin refuses as `run_branch_diverged`; one behind origin
  that could not be fast-forwarded (uncommitted changes, or checked out in another worktree), or
  only on origin and not created, refuses as `run_branch_behind`. `problems` says what to run;
  the run never resets a branch. A failed fetch is a warning, and every sync state is logged:
  a silent `behind` or `missing` had looked like a fresh run.
- **Starting over is explicit** (`freshStart: true`): `resumeState` and every PR marker are
  ignored, nothing is absorbed, the budgets start at zero, and no branch is moved. Since its
  first push could not fast-forward an earlier run's branch, it refuses as `run_branch_exists`
  when origin holds the run branch with commits not in the base: pass a new `runBranch`, or
  remove the old branch and PR. Without it, a relaunch always resumes.
- **Environment checks** (`builtinEnvChecks`, default on; `environmentChecks`). The third
  attempt's implementer found the commit signer locked halfway through a task, and a replan
  spent about eight minutes diagnosing it before halting. Per repo, a signed commit in a scratch
  worktree (added without a checkout: it only proves the signer answers) and an `ls-remote` of
  the origin, plus the project's own checks, each under a portable time limit
  (`perl -e 'alarm …'`: stock macOS has no `timeout`, which the implement brief recommended for
  hang-prone commands such as the first attempt's Playwright WebKit runs). The checks run in
  parallel under one 90-second deadline (`GRIMOIRE_ENV_DEADLINE`), so the report fits in the Bash
  tool's 120-second default whatever hangs; a check still running then reports exit 142, and
  `environmentChecks[].timeoutSec` is capped at 85. At start a failure refuses the run
  (`environment_unavailable`); after a BLOCKED, DIED, ERROR or FENCED task, a late writer, or a
  failed push, a check runs in flight and before the next replan and the final wave. Its failure
  pauses new dispatches and is re-checked once (`env:recheck#n`, only the checks that failed): a
  re-check that passes was transient (`environment.transient`) and the run goes on, since one
  timed-out `ls-remote` is often a blip. Only a failing re-check halts, with
  `kind: 'environment'` and the fix, and no replan is spent; a later green check lifts a halt
  that is still pending. Start checks are not re-checked. On macOS a `power` check warns when
  the machine runs on battery (the Mac hibernated on battery at 1% and the run lost 49 minutes);
  it never refuses. The names `commit:<…>`, `remote:<…>` and `power` are the built-ins': a user
  check named so is refused with a warning. One haiku dispatch (`briefs/env.md`); event `env`
  (with `recheck` and `cleared`); result `environment`.
- **Replans are charged to the code only.** In the first attempt, two of the three replans
  answered agents booked dead at the time limit while they worked, and a browser engine that
  hung on that Mac; the run then halted on its exhausted budget. The replanner now names a
  `cause`: `code` spends a replan, `harness` (a dead or late agent, a lane that would not merge)
  is free up to `maxReplans` times and then charged, and `environment` halts the run with
  `kind: 'environment'` without requeuing anything. Every halt the loop itself causes carries
  `kind: 'harness'` (silent reviewers, hydration dying twice, three quick deaths, the replanner
  dying, a replanner HALT on a harness cause), a token-budget stop carries `kind: 'budget'`, and
  the halt `kind` is in the `halt` event and in `run.json`'s `summary.halt`.
- **A run branch named after the project's key** (`runBranch` overrides it, also per repo). The
  run's project text was a sentence ("acme/site#3 — GitHub parent issue #3; its slices are
  …"), so its branch was that sentence slugged and cut at 60 characters, and a relaunch worded
  differently would have built on another branch and missed its PR and saved state. The branch
  now takes the project's ticket reference, the first rule that matches winning: `owner/repo#N`;
  `#N`; a tracker URL (an issue or pull request URL as `owner/repo#N`, a Jira or Linear URL's
  key, any other URL's trailing number); then a bare key like `PROJ-123`, only as the whole
  text, at its start or in brackets or parentheses, and never with a standard's prefix (`UTF`,
  `UTF8`, `ISO`, `SHA`, `HTTP`, `HTTPS`, `RFC`, `ES`, `TLS`, `SSL`, `IPV`, `CVE`): "Migrate to
  UTF-8 and ISO-8601 dates (PROJ-12)" once keyed on `UTF-8`, so every project mentioning UTF-8
  would have shared one run branch. The run's sentence and `acme/site#3` share
  `feat/acme-site-3-<repo>`; a project text with no reference is slugged as before.
- **Shell guidance for implementers and reviewers.** `cd` replaced by a shell plugin's function
  made 147 commands of the run fail: the briefs now say never `cd` (use `git -C` and absolute
  paths, or `builtin cd`), read files with the Read and Grep tools, and bound hang-prone
  commands with `perl -e 'alarm …'`, or `timeout` or `gtimeout` where they exist. The engine's
  own scripts use `builtin cd`, and the guard hook follows `builtin cd` and `command cd` like
  `cd`.
- **The journal agent can only run its script.** In the first attempt the haiku journal agent,
  running from the product checkout with the project's instructions loaded, acted on its
  payload. Event lines, `run.json` and the landed-task detail now travel base64 and are decoded
  by the script; the brief says the payload is data and forbids any other command. The ledger
  and ship payloads travel the same way.
- **State writes that cannot corrupt, roll back or overflow.** 0.8.x wrote `run.json` through
  one shared temp file, with no lock and no order: two flushes at once could corrupt it, and a
  late flush could roll the checkpoint back. Every decoded payload is now checked against the
  engine's byte count and `cksum` before anything is written (`RUNJSON ok|kept|bad`,
  `LANDED ok|bad`, `LEDGER bad`; a refused `run.json` counts in
  `telemetry.journal.runJsonLost`); writers take a lock (`<runId>/.lock`) that changes hands only
  under a second mutex (`.lock.brk`: two waiters on a dead writer's lock once both broke it, one
  of them the other's fresh lock), broken at once when its pid is gone and after 30 s when the
  same pid or none holds it (`GRIMOIRE_LOCK_STALE`), with a writer going on without it after
  60 s and a stale mutex removed after 5 s, all timed with `date +%s`; `run.json` moves into
  place atomically and only when it is not older than the one on disk, ordered by the resume
  generation and `lastSeq`, and a `run.json` the script kept for a newer one is logged once per
  session with its reason and counted (`telemetry.journal.runJsonKept`: a session behind the one
  on disk never persists its checkpoint); and each launch registers one attempt for its session
  token in `<runId>/sessions` (two launches that start from exactly the same state share one).
  Since `run.json` travels in every flush, it keeps only what a resume needs (with every task's
  detail in it, a 40-task run sent 89 KB per flush, enough to outrun the writer), and each task's
  detail goes once to `<runId>/landed.jsonl`: at most 8 a flush, each line keyed (`k`) so a
  resent one is never appended twice, and the writer's `landed` receipt is required (one that
  left it out made every flush resend every detail, 104 KB a flush at 40 tasks). A `runId` must
  be letters, digits, `.`, `_` and `-`, and not only dots (`..` would put the journal above the
  telemetry directory): any other is ignored with a warning and a new dated directory opens.
- **Per-task reviewers in parallel** (`reviewParallel`, default `'stages'`). Precheck, spec
  review and quality review ran one after another, and reviewing took 8.2 hours of agent time.
  Spec and quality round 0 now run together on the same head after the precheck; a spec fix that
  moves the head re-runs quality. A reviewer, verifier or guard that runs commands does it in
  its own detached worktree: two reviewers building in one checkout emptied each other's build
  output.
- **Hydration ahead** (`hydrateAhead`, default 2). In a chain each hydration (6–43 minutes,
  3.6 hours in all) waited for its blocker to land. The next ready tasks are now hydrated while
  their blockers are in flight, and the implementer is told the code may have moved since.
- **Short limits and a hedge for mechanical dispatches.** Preflight, precheck, journal, ship
  and environment checks shared an implementer's 40-minute limit; a one-word preflight reply
  took 12 minutes, and prechecks took 5–13 minutes for about eight git commands (2.1 hours in
  all). They now have limits of their own (`timeouts`); preflight and precheck start one
  duplicate when the first is slow (`hedge`; `hedgeAfter` applies only to them and to hydration
  without claims); the preflight prompt asks for the reply and nothing else; the precheck runs
  one fact script in a single Bash call.
- **The skill resumes by state and says how long a run takes.** The third attempt was a
  `resumeFromRunId` relaunch with only `agentTimeoutMin` raised, on a stale checkpoint: the
  replay diverged at the first late result and redid three slices, 3.5 hours for two small
  commits. The preview now returns an `estimate` (critical path × minutes per task;
  `estimatePerTaskMin`), about 7–20 hours for that project, and the `orchestrate` skill prints
  it, says a draft PR appears after the first landing, and names the environment checks.
  Before an execute run it tells the user the duration, checks commit signing, push and the
  project's prerequisites, and warns that a message sent to the session while the run goes is
  relayed into its agents' prompts (in the real run a haiku probe then ran the build and the
  gate): instructions go in after the run, or the run is stopped first. Invoked on a project
  that already has a run, it finds the newest local `run.json`, passes its `runId` and a fresh
  `resumeState` to the preview and shows its resume line, then relaunches by state; the engine
  reads the draft PRs' markers itself. Starting from scratch takes an explicit request and
  `freshStart`. `resumeFromRunId` is kept for a byte-identical relaunch, the tracker alone never
  resumes a run, and after a halt the skill reads the PR's status comment first.
- **Late results land where they belong.** An adversarial review raced the engine's
  asynchronous paths against each other. A final wave no longer hangs when one slot wedges and
  another then returns. A wedged terminal slot is booked when it returns, even after the run
  has ended, and its gate is never run twice (a second push, a second PR); ship on halt leaves
  that repo to it. A prefetch that lands after a replan never replaces the task the replan
  revised. A writer that returns after the run stopped dispatching flows no further. A repo with
  a failed task is never gated, its PR never marked ready, while that failure stands; when the
  budget runs out with nothing else left, the halt names each task that did not land and its
  repo. A dead journal writer stops being queued instead of holding the end of the run for
  8 minutes per chunk (its chunks count in `telemetry.journal.lostEvents`). A prefetch's claims
  are handed back when the run halts before it returns.
- **Logs and eval cases.** `/grimoire:logs` summarizes the new events in words (each `absorb`
  source, `harness-routed`, `seal`, a `ship` skipped on a ready PR or a busy lock, which never
  reads as a failed push, and an `env` re-check, transient or failing again, or a halt a later
  check lifted), shows a halt's kind and a v2 checkpoint's landed tasks and heads,
  joins `landed.jsonl`, and counts discarded review rounds apart. `orchestrate` evals: resume by
  state after a halt, a knob change on resume, the preview's estimate, an environment halt, a
  new-session relaunch that finds the run, a message sent during a run, and starting over.

### Upgrading from 0.8.1
Nothing to change in `grimoire.config.json`.
- Update the installed plugin (`/plugin update grimoire@grimoire`) before the next run. The run
  behind this release ran 0.8.0 and so never had 0.8.1's session probe, which would have
  refused the hook that cost it about 16.6 hours.
- Draft PRs now appear after each repo's first landed task, and each landing pushes the run
  branch, which triggers its CI and previews. Set `deliver: 'end'` (run-wide, or per repo) to
  keep pushes for the end; `shipOnHalt: false` also skips the halt push and comment. The draft
  PR and its state marker go through `gh`: without it, pushes go on and the resume relies on the
  local `run.json`. A PR out of draft, marked ready by the gate or by hand, gets no more ships:
  new work in its repo waits for that repo's next terminal slot, whose gate pushes it.
- A run can now refuse to start with `environment_unavailable` when a signed commit or the
  remote does not answer: unlock the signing agent or fix the remote, or pass
  `builtinEnvChecks: false`. It also refuses a run branch it cannot build on:
  `run_branch_diverged` or `run_branch_behind` (fix the branch as `problems` says, then
  relaunch), and, with `freshStart`, `run_branch_exists`.
- The run branch is now named after the project's ticket reference. A run started on
  0.8.x whose project text held more than its key (a sentence) used another branch name: to
  continue it, pass `runBranch` with that name.
- `agentTimeoutMin` is now a soft limit: a late agent is awaited and its result accepted.
  `agentHardTimeoutMin` (180) is where the run stops waiting; `repos[].timeoutMin` still raises
  its repo's writers' limits.
- `maxReplans` now counts only replans whose cause is the code: a harness cause is free up to
  `maxReplans` times, then charged, and an environment cause halts the run instead of
  replanning. `replans` in the result counts the charged ones.
- Checkpoint v2 and the slimmer `run.json` are backward compatible: a 0.8.x `resumeState` still
  resumes its budgets (replans, fix rounds, spend, sequence), but it has no SHAs, so nothing is
  absorbed from it; each landed task runs again, finds its work on the run branch and is
  reviewed as it stands rather than rebuilt.
- Resume with the same `runId` and a fresh `resumeState` (`/grimoire:orchestrate` does it), not
  with `resumeFromRunId` and changed args. To start over on purpose, pass `freshStart: true`. A
  `runId` passed by hand must be letters, digits, `.`, `_` and `-`; any other is ignored and the
  journal opens a new directory.

## 0.8.1 — run efficiency and honest reporting

Fixes found in a real unattended run (six issues, one repo) that took 9 h 10 for about 2 h 45
of work. Its transcripts showed where the time went and its journal showed each defect. All are
engine-, brief- and skill-level and stack-agnostic.

- **Session probe** (`maxToolLatencySec`, default 15). Every Bash call of that run waited 30 s
  on a PreToolUse hook that hung until its timeout: 836 calls, 6.4 h, read by the run as slow
  builds. Execute runs now have the indexer time two back-to-back Bash calls; past the limit
  the run refuses to start as `slow_tool_calls` and names the likely cause; from 8 s it warns.
  The number is in `telemetry.toolLatencySec` and in every replan prompt. The `orchestrate`
  skill also times `git status` before launching.
- **A timed-out agent may still be running.** The backstop books the dispatch as died but
  cannot stop it, and that run's "dead" implementer committed three minutes later. The timeout
  log, the replanner's failure detail and the replan brief now say so and what to check
  (`git log`, `git status`, live processes) before requeuing; the dispatches are listed in
  `telemetry.timedOut`.
- **Learnings are measured.** The replan blamed slow tests and proposed raising
  `repos[].timeoutMin` to 75 — a key that only raises the backstop and was set below it, so it
  had never applied. The replan brief requires durations from measurement; the engine warns
  when a repo's `timeoutMin` is at or under the global backstop; crystallize checks each
  learning against the journal before keeping it.
- **`needsAttention` holds only open work.** A task that died, was requeued and landed was
  still reported there. It is now in `recovered`; `needsAttention` keeps the latest attempt of
  what never landed.
- **An honest note when crystallize does not finish.** The note said "no PR this run, so no
  crystallize" when a PR existed and crystallize had timed out. It now says crystallize did
  not finish and names the PRs to run it over by hand. Crystallize, the longest dispatch of a
  run, gets its own 90-minute allowance.
- **Harness findings stay out of the product PR.** A terminal-sweep blocker on the loop's own
  lane config bought a 37-minute fix round and three harness commits in the product PR. A
  terminal blocker/major on a harness file (`grimoire.config.json`, `.claude/`, `AGENTS.md`,
  memory, runs, `docs/crystallize/`) is now an advisory note tagged `harness`, listed in
  crystallize's header for the harness PR. A per-task review still gates a task's own change
  to such a file.
- **A PR that closes what it ships.** The gate opened a one-line PR that linked no issue. It is
  now handed every landed task (id, title, the implementer's report) and the gate brief sets
  the title and body: one closing keyword per issue, what changed, what the tasks recorded,
  how it was verified, what to check before merging, and no invented links, local paths or
  model co-authors. The gate runs on sonnet instead of opus.
- **Repo-relative paths in what the run publishes.** Reviewers' absolute paths, home directory
  included, went into the committed ledger. The probe reports each checkout's root and
  `$HOME`; the ledger, the gate's task reports and crystallize's header are rewritten
  repo-relative, with `~` for the home directory. Reviewers are asked for repo-relative paths.
- **The ledger branch starts from the default branch**, not from the run's base: cut from an
  unmerged base, the ledger's PR carried that base's commits. The ledger agent must not open a
  PR (it did); crystallize merges the run's unmerged PR heads into its branch before patching
  and says its PR merges after them.
- **Less work that was never used.** Hydration plans from reading and no longer runs builds or
  browsers (one spent twenty minutes probing whether two tasks could share a repo). Spec
  reviewers read instead of re-running the full suite; the quality stage and the gate run it.
- **`laneSetup` docs and setup** no longer suggest a symlinked `node_modules` without checking
  the bundler accepts one (Next.js 16's Turbopack does not); the setup skill proposes
  `timeoutMin` only above the 40-minute backstop.
- **The Reliability lens checks the gate from a fresh clone.** That run's gate type-checked
  before the build that writes the gitignored type declarations, so it passed only in a
  checkout an earlier build had left them in; no reviewer read the gate. The persona's scope
  now includes the gate command and the scripts it calls.
- **Eval cases** from these failures: `orchestrate` does not launch while a trivial command
  waits tens of seconds; `setup` proposes no no-op `timeoutMin` and no symlinked
  `node_modules` for a Next.js 16 app.

### Upgrading from 0.8.0
Nothing to change in `grimoire.config.json`. Drop a `repos[].timeoutMin` at or under 40 (the run
now warns that it has no effect). A session the probe refuses is a session to fix first: time
`git status`, find the slow PreToolUse hook, restart.

## 0.8.0 — loop integrity

Fixes found in a real unattended run whose journal showed each defect. All are engine- and
brief-level and stack-agnostic.

- **Direct tasks work on the run branch.** A task running alone in its repo used the tracker's
  per-issue branch, so it settled DONE without ever reaching the run branch its dependents,
  the sweep and the gate build on. It now always commits on the run branch, and the precheck
  verifies a direct task's head is an ancestor of the run branch (new check `ancestry`). The
  run branch is named deterministically, `feat/<project-slug>-<repo>`, never after a tracker
  branch, so a resumed session builds on the same branch as the session before it. Work that
  0.7.x landed on per-issue branches is not merged into it automatically.
- **Review range `startSha..headSha`.** Implementers report `startSha` (HEAD before their
  first change); precheck, panel, guard and verifier judge from there instead of `firstSha^`,
  so a merge task is no longer blamed for every lane merged before it. The precheck verifies
  `startSha` is an ancestor of the head (check `range`; on a FAIL the range falls back to
  `firstSha^`). A footprint-only precheck failure that repeats with the same known head becomes
  an advisory note and the panel runs.
- **Agent preflight** (`preflight`, default on). Before any hydration or implementer, every
  agent type the run can dispatch answers one trivial haiku prompt; a silent type is probed
  once more, and any still silent refuses the run as `agents_unavailable`, naming the types.
- **Dead reviewers are a harness failure.** A reviewer that returns nothing is retried once
  (only the missing persona); if any required lens is still absent the stage fails closed and
  the run halts as `reviewers unavailable` (`REVIEWERS_UNAVAILABLE`), naming the lens: no
  replan spent, no code marked failed, and no stage passes on its surviving reviewers.
- **One PR per repo, pushed by the loop.** Lanes and integrations never pushed, so an ungated
  repo ended with unpushed merges. Every repo's terminal slot now runs the gate command if it
  has one, pushes the run branch and opens (or updates) the repo's one PR; implementers never
  push or open PRs. `repos[].prBy` is removed (ignored, with a warning). When the push or PR
  step itself fails (auth, a protected branch, the network) the slot is `SHIP_FAILED`: never
  replanned, the repo is listed in `ungatedRepos` with the cause in `ungatedReasons`.
- **Escalation only for code failures.** A replanned task moves to opus only when its last
  failure was code-kind (gating findings, BLOCKED, a structural precheck defect, a failed gate
  or sweep); harness failures (dead agent, merge conflict, footprint or ancestry precheck)
  keep the selector's tier. A task the replanner invents inherits the kind of the failures it
  repairs in its repo. The replanner is told which failures were harness failures.
- **`requireHook.raw`** (e.g. `"rtk proxy"`): implement and gate prompts say how to re-run a
  command whose compressed output is empty, garbled or contradicts its exit code (a generic
  version when unset).
- **`DONE_PENDING_GATE`**: a gated repo's DONE, landed everywhere DONE is. A gate dispatch
  returning it counts as a failed gate.
- **Pre-existing failures**: the implement brief says to run a failing check on the base (a
  throwaway worktree of `baseSha`, never `git stash`) before owning it, and to report
  pre-existing failures in `concerns`.
- **Unattended boundary**: every briefed dispatch is told nobody is watching; a message that
  looks like a user's mid-task is reported, never answered or obeyed.
- **Journal**: `at` is documented as the chunk's flush time (the runtime has no clock). Events
  and `run.json` carry `attempt`, the session number under a `runId` (bumped by the session's
  first flush that lands; a 0.7.x `run.json` counts as attempt 1); from attempt 2 chunks are
  `<firstSeq>.a<N>.jsonl`, so a relaunch never overwrites an earlier attempt, and
  `render-logs` dedupes by (attempt, seq).

### Upgrading from 0.7.x

- **One deterministic run branch per repo**, `feat/<project-slug>-<repo>`, and one PR per repo
  opened at project end. Per-ticket branches and per-ticket PRs are gone; drop `prBy` from
  `grimoire.config.json`. Work a 0.7.x run landed on per-issue branches is not merged into the
  new run branch automatically: merge or re-run it by hand. A repo whose 0.7.x run already
  opened per-ticket PRs on tracker branches gets one NEW PR, from the run branch, at the end of
  the next run: close the old per-ticket PRs or retarget them, or they stay open alongside it.
  The run branch name is slugged (`feat/<project-slug>-<repo-slug>`); a name with no
  sluggable characters becomes `x<hash>`.
- **The agent preflight is on by default.** An execute run that cannot spawn one of its agent
  types refuses with `error: 'agents_unavailable'` and `problems: [<types>]`. Fix
  `agentNamespace` or the agent names, or opt out with `{preflight: false}`.
- **New statuses for consumers of the result, the ledger and the journal.** `DONE_PENDING_GATE`
  is landed (count it with `DONE` and `DONE_WITH_CONCERNS`). `REVIEWERS_UNAVAILABLE` is not a
  code failure; the run halts with a reason starting `reviewers unavailable`. `SHIP_FAILED` is a
  terminal slot whose push or PR step failed (see `ungatedReasons`). Precheck events
  can carry the verdict `ADVISORY`, review events the verdict `UNAVAILABLE`.
- **Journal readers**: events and `run.json` have an `attempt` field (absent = 1), chunks from
  a second attempt onward are named `<seq>.a<N>.jsonl`, and `seq` is unique per attempt, not
  per run. `at` is the chunk's flush time, shared by every event of the chunk.
- **Implementers report `startSha`.** Team-agent definitions copied from the templates should
  add it to their return (`baseSha`, `startSha`, `commits`, `headSha`).
- **Known trade-off**: a footprint problem the precheck flags identically twice, with no new
  commit in between, is demoted to an advisory note. A stray change the precheck mislabels as
  footprint would then reach the panel instead of failing the task; the reviewers, not the
  precheck, have to catch it.
