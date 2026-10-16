# Manager / PO agent: what already exists on GitHub

Research input for the manager / product-owner feature, meant to feed `/roast`. Nothing here is decided.

> **Policy, settled in the roast** ([spec D1](../specs/2026-10-16-manager-briefing-design.md)): no third-party project below is a runtime dependency. Where this page says "use" or "shell out to" one (himalaya, obsei, sooperset/mcp-atlassian, the community MCP servers), read it as "borrow the pattern". Code is copied only from permissively licensed projects, adapted to grimoire, with attribution. The services' own official tools stay allowed.

**The feature, as asked.** A manager / PO agent that:
- watches the trackers (Linear, Jira, GitHub Issues) through tools that already exist,
- tells the team what is urgent and what to hand to AI next,
- organises the inbox and drafts replies a human sends with a button (no auto-send),
- files important signals from trusted sources into the tracker (App Store and Google Play reviews, Shopify, crash reports),
- stays tool-agnostic, configured by `/grimoire:setup`, which can be re-run to update.

**Method.** Four parallel searches, one per area, on 2026-10-16. Every repo listed was checked with `gh api repos/…` that day: stars, last push, licence, archived flag. READMEs, and source code where it mattered, were read. Anything marked *(inferred)* is a reading, not a stated fact. Stars are a popularity signal, not a quality signal. Several of the most useful references are tiny and new.

---

## TL;DR

1. **No single open-source project does the whole job.** The pieces exist separately, and the best ones share one design: the model **proposes** and narrow code **applies** after a check or a human yes.
2. **Closest match overall: [obsei/obsei](https://github.com/obsei/obsei) v1.x.**
   - Reviews (App Store Connect, Play) feed Linear, Jira and GitHub Issues.
   - It dedupes deterministically, routes on confidence, holds a human-approval queue for agent-written issues, and ships a Claude Code plugin and an MCP server.
   - But v1.0.0 shipped on 2026-10-15 as a full rewrite. **Borrow the design. Don't depend on it yet.**
3. **Best "what needs you" report: [crmne/copilot-triage](https://github.com/crmne/copilot-triage)** (GitHub only).
   - It sorts work by what the human owes: *Sign off · Decide · Do · Their move · Not now*. Each card has a one-line next step.
   - Priority only goes up, and silence is a valid outcome.
4. **Best manager/executor split: [microsoft/hve-core](https://github.com/microsoft/hve-core)'s Backlog Manager.**
   - The manager holds **no write tool**. Writes go through one executor per tracker (Azure DevOps, GitHub, Jira; no Linear executor).
   - Autonomy is set per operation.
5. **Email: drafts go to the provider's Drafts folder, with no send tool at all.**
   - [inbox-zero](https://github.com/elie222/inbox-zero) has the best workflow, but it is Gmail/Outlook only and AGPL.
   - [himalaya](https://github.com/pimalaya/himalaya) is the only open access layer that covers IMAP, JMAP, Gmail and Microsoft Graph.
   - [ni-c/imap-mcp](https://github.com/ni-c/imap-mcp) shows the safe tool surface: it has no send code.
6. **Connectors don't give us a common issue format.** Composio, Nango and Pipedream all expose each app's own tools. We own a small `WorkItem` type and map each tracker onto it.
   - [openai/symphony](https://github.com/openai/symphony)'s `SPEC.md` is the best reference for that contract.
   - [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) already uses a tool-agnostic pattern: placeholders like `~~project tracker`, bound to a real server at setup.
7. **Hooks alone can't watch anything.** Claude Code hooks fire on session events. They don't poll and they don't receive webhooks.
   - The watching needs a schedule: a cloud routine (1 h minimum interval), a desktop scheduled task (1 min), or cron plus `claude -p`. Webhooks need a public endpoint.
   - A hook can still add "since the last report" context when a session starts.

---

## 1 · Manager / PO / triage agents over trackers

| Project | ★ | Last push | Licence | What it is |
| --- | --- | --- | --- | --- |
| [crmne/copilot-triage](https://github.com/crmne/copilot-triage) | 16 | 2026-10-13 | MIT | GitHub Action. Keeps a private Projects board of "what actually needs you", with priority and a one-line next step per card |
| [microsoft/hve-core](https://github.com/microsoft/hve-core) | 1,529 | 2026-10-16 | MIT | Copilot agent pack. Its Backlog Manager triages and grooms across Azure DevOps, GitHub and Jira, with separate write executors |
| [openai/symphony](https://github.com/openai/symphony) | 27,709 | 2026-09-15 | Apache-2.0 | Daemon that polls a tracker (Linear, GitHub, Jira, Asana, GitLab) and runs a coding agent per eligible issue |
| [github/gh-aw](https://github.com/github/gh-aw) + [githubnext/agentics](https://github.com/githubnext/agentics) | 5,404 / 987 | 2026-10-16 | MIT | Agentic workflows in Markdown, compiled to Actions: `issue-triage`, `daily-plan`, `daily-repo-status`, `issue-monster`… |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) triage workflows | 107,408 | 2026-10-16 | Apache-2.0 | Hourly triage. Shell queries pick the issues missing labels, and the model fills only those gaps |
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) + claude-code's own triage | 9,533 | 2026-10-15 | MIT | Issue triage and dedupe examples. The agent can only add labels, through wrapper scripts with call caps |
| [cyrusagents/cyrus](https://github.com/cyrusagents/cyrus) | 857 | 2026-10-15 | Apache-2.0 | Linear agent built on Linear's Agent API. Assign or @mention it, and it runs Claude Code in a worktree |
| [automazeio/ccpm](https://github.com/automazeio/ccpm) | 8,413 | 2026-03-18 | MIT | PRD → epic → GitHub issues. `status`, `standup`, `next` and `blocked` are plain bash scripts that use no LLM |
| [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master) | 28,233 | 2026-04-28 | MIT + Commons Clause | PRD → task graph with a `next` rule and a complexity score. Keeps a local store, not a tracker |
| [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md) | 7,051 | 2026-10-16 | MIT | The repo is the tracker. Three human checkpoints: spec, plan, code |
| [multica-ai/multica](https://github.com/multica-ai/multica) | 53,008 | 2026-10-16 | source-available | Board with agents as teammates. Scheduled "autopilots", an inbox that holds only decisions, circuit breakers |
| [paperclipai/paperclip](https://github.com/paperclipai/paperclip) | 103,024 | 2026-10-16 | MIT | Org chart, tickets and budgets for agent teams. Coalescing wakeups, audit log |
| [snakyvine/codex-maintainer](https://github.com/snakyvine/codex-maintainer) | 100 | 2026-10-15 | MIT | Recommends and never writes by default. Rejects any recommendation whose cited evidence can't be re-checked |
| [wshm-dev/wshm](https://github.com/wshm-dev/wshm) | 85 | 2026-10-16 | Apache-2.0 (open core) | Rust triage daemon for forges. Dry run by default, `--apply` to write, confidence shown per decision |

Tiny but worth a look:
- [withoneai/backlog-groomer](https://github.com/withoneai/backlog-groomer) (Linear): a written grooming-policy file the model must cite, a scan of the whole backlog for duplicates, and findings posted as comments only.
- [atharrison/linear-cursor-sprint-toolkit](https://github.com/atharrison/linear-cursor-sprint-toolkit): `/standup-prep`, `/sprint-health`, `/triage-review` and `/focus-today` over a Linear CLI. A good checklist of the commands a PO agent needs.

**Borrow:**
- **Group the report by what the human owes, not by status** (copilot-triage).
  - Columns: Sign off / Decide / Do / Their move / Not now.
  - Only *Urgent* sends a notification.
  - One rolling report replaces the previous one, states its time window, and marks capped counts as lower bounds (gh-aw).
- **The manager can't write** (hve-core, gh-aw safe-outputs, copilot-triage `submit_decision`).
  - It produces a proposal checked against a schema. Narrow code applies it, with per-run caps.
  - Autonomy is set per operation: low-risk field updates apply on their own; creates, transitions and comments wait for a human.
- **Facts come from code, judgment from the model, and ranking stays simple.**
  - Code computes staleness, missing owners, dependency readiness and lifecycle timers (Claude's sweep, Gemini's pre-filter queries).
  - Urgency is a sort anyone can read: Symphony uses priority → age → id; Issue Monster adds label weights to a capped age bonus.
  - Gemini lets the model say "probably P0" but never apply P0. A person does.
- **"Hand this to AI" has a gate and a cap** (gh-aw Issue Monster, Symphony).
  - It needs a human-applied queue label or a Linear delegation.
  - The issue must not be blocked, must have no open PR, and must not be a parent issue.
  - There is a cap on open agent work (skip if 5 or more agent PRs are open), and it backs off when the agent hits rate limits.
- **Staleness and similarity are signals, not verdicts** (hve-core).
  - Outcomes: Still needed / Likely done / Superseded / Possible duplicate / Uncertain.
  - Each needs cited evidence, and *Uncertain* goes to a human.
- **Noise budget.** Labels only, or silence, by default. "No-op" is an explicit outcome. A failure goes to the run summary, never into the tracker: copilot-triage's author replaced gh-aw partly because the bot started opening issues about its own failures.

---

## 2 · Mail organiser with draft-and-approve

| Project | ★ | Last push | Licence | What it is |
| --- | --- | --- | --- | --- |
| [elie222/inbox-zero](https://github.com/elie222/inbox-zero) | 12,573 | 2026-10-16 | AGPL-3.0 | AI inbox for Gmail and Outlook. Plain-English rules, AI drafts in the provider's Drafts folder, Slack review cards |
| [pimalaya/himalaya](https://github.com/pimalaya/himalaya) | 7,467 | 2026-10-16 | Apache-2.0 / MIT | Rust mail CLI over IMAP, SMTP, JMAP, Gmail API, Microsoft Graph and Maildir. `--json` output and a drafts mailbox role |
| [ni-c/imap-mcp](https://github.com/ni-c/imap-mcp) | 3 | 2026-10-12 | MIT | IMAP MCP server that **cannot send** (there is no send code). `save_draft` writes to `\Drafts`, and it defends against prompt injection |
| [randomparity/rusty-imap-mcp](https://github.com/randomparity/rusty-imap-mcp) | 6 | 2026-10-14 | Apache-2.0 | IMAP MCP with named permission levels (`readonly`, `draft-safe` by default, `full`). Tags drafts `$PendingReview` and keeps an audit log |
| [codefuturist/email-mcp](https://github.com/codefuturist/email-mcp) | 128 | 2026-10-16 | LGPL-3.0 | Full IMAP and SMTP MCP. A watcher triages new mail as it arrives, header-based bulk detection, rules run before the AI |
| [langchain-ai/agents-from-scratch](https://github.com/langchain-ai/agents-from-scratch) | 2,392 | 2026-08-11 | MIT | Email-assistant tutorial: triage into respond / notify / ignore, a human approval step, memory, **and an eval set** |
| [langchain-ai/executive-ai-assistant](https://github.com/langchain-ai/executive-ai-assistant) + agent-inbox | 2,209 / 1,094 | archived | MIT | Archived, kept for the idea: four review verbs (accept / edit / respond with feedback / ignore) that feed learning |
| [ericporres/email-triage-plugin](https://github.com/ericporres/email-triage-plugin) | 28 | 2026-02-19 | MIT | Claude plugin. Numbered triage list ("draft a reply to #2"), never sends or archives without a yes |
| [unstko/postfach-mcp](https://github.com/unstko/postfach-mcp) | 0 | 2026-09-10 | MIT | Remote IMAP MCP, "no send, no delete by design". Only allowed From addresses can appear on a draft |
| [wyattjoh/jmap-mcp](https://github.com/wyattjoh/jmap-mcp) | 176 | 2026-09-23 | MIT | JMAP MCP (Fastmail, Stalwart). Fetches only what changed since the last run |
| [scalekit-developers/litellm-agentkit-inbox-triage](https://github.com/scalekit-developers/litellm-agentkit-inbox-triage) | 0 | 2026-10-08 | none | The only email → GitHub-issue bridge with approval found. One card approves "create issue" and "send reply" together (no licence: read the idea, don't copy code) |
| [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) | 3,346 | 2026-10-09 | MIT | Gmail and Workspace MCP with `--read-only` and permission flags |

Google also has an official **Gmail MCP**, in developer preview. It has `create_draft` and no send tool, and needs the `gmail.readonly` and `gmail.compose` scopes. One caution: the claude.ai Gmail connector that was enabled during this research exposes `send_message`, `reply` and `forward` next to its draft tools, so a draft-only mode there would have to be enforced by deny rules.

Not usable, and why:
- [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer): its README says the code is deprecated.
- Mail-0/Zero: dormant since 2025-08.
- GongRzhe/Gmail-MCP-Server: archived.
- EmailEngine: paid.

**Ways to access mail, compared:**

| Option | For | Against |
| --- | --- | --- |
| IMAP + SMTP (himalaya or an IMAP MCP) | Works with almost every provider. Drafts are an IMAP APPEND to the `\Drafts` folder. A draft-only agent never needs SMTP credentials | Gmail and Outlook need OAuth or app passwords. Labels are weaker than the native APIs |
| JMAP | Clean API, real drafts, fetch only what changed | Fastmail, Stalwart and Cyrus only. Gmail and Outlook don't speak it |
| Gmail API / Microsoft Graph | Best fidelity, plus push notifications | Two integrations, OAuth app registration, and Google's restricted-scope rules (`gmail.compose` is needed to draft) |
| An existing MCP server | Fastest to adopt | Safety differs per server, and many expose send |

**Borrow:**
- **Make "can't send" a fact of the setup, not a prompt.**
  - The agent gets no send tool and holds no SMTP credentials.
  - Drafts go to the provider's Drafts folder, so the human sends from their own client. That client's Send button is the "button".
  - Each draft is tagged `$PendingReview`, or with a label, so reviewers can filter for them (rusty-imap-mcp).
- **Treat every email as hostile input** (ni-c).
  - Wrap each message body in a per-call random marker. Strip hidden HTML and zero-width characters.
  - Report SPF, DKIM and DMARC results only from the provider's own check.
  - The same caution applies to "file this email as a Linear issue": it stays a proposal until approved.
- **Track "already processed" with the agent's own marker, never the human's.**
  - Options: an IMAP keyword such as `AiSeen` (ni-c), JMAP's change state, or Gmail history IDs.
  - Never set the human's `\Seen` flag.
- **Cheap rules first, the LLM second** (email-mcp, email-triage-plugin).
  - Header checks catch bulk and automated mail (`Auto-Submitted`, `Precedence`, `List-Unsubscribe`).
  - Sender or alias → tier rules sort most mail before any tokens are spent.
- **Learn from what the human did** (inbox-zero, EAIA).
  - Compare what was sent with the draft, and log accept / edit / ignore.
  - That fits straight into `crystallize`.
  - Replace an earlier AI draft only if the human hasn't touched it.

---

## 3 · Signals from trusted sources into the tracker

| Project | ★ | Last push | Licence | What it is |
| --- | --- | --- | --- | --- |
| [obsei/obsei](https://github.com/obsei/obsei) | 1,437 | 2026-10-16 | Apache-2.0 | Customer-feedback pipeline: source → PII redaction → classify → route → Linear / Jira / GitHub / Slack. MCP server and Claude Code plugin. **v1.0.0 is from 2026-10-15** |
| [ZhgChgLi/ZReviewTender](https://github.com/ZhgChgLi/ZReviewTender) | 62 | 2026-05-07 | MIT | App Store and Play reviews (official APIs) → Slack, Sheets or Asana through chained processors. Runs on a GitHub Actions cron |
| [AzimoLabs/Review-Reporter](https://github.com/AzimoLabs/Review-Reporter) | 134 | 2021 (stale) | none | Play reviews → Slack, and → Jira when rated 3 stars or below. A separate "already sent" list per destination (idea only, no licence) |
| [ForgeHQ-Agents/mcp-appstore-reviews](https://github.com/ForgeHQ-Agents/mcp-appstore-reviews) / [mcp-googleplay-reviews](https://github.com/ForgeHQ-Agents/mcp-googleplay-reviews) | 0 | 2026-06 | MIT | Single-file MCP servers that only read and reply to reviews, using a narrowly scoped key |
| [rorkai/App-Store-Connect-CLI](https://github.com/rorkai/App-Store-Connect-CLI) (`asc`) | 7,944 | 2026-10-16 | MIT | App Store Connect CLI with a `reviews` command, `asc auth doctor`, and JSON output when not run in a terminal |
| [Shopify/Shopify-AI-Toolkit](https://github.com/Shopify/Shopify-AI-Toolkit) | 601 | 2026-10-14 | MIT | Shopify's official Claude Code plugin (skills plus a hook). A developer assistant, not a signal pipeline. **Sends usage telemetry** |
| [GeLi2001/shopify-mcp](https://github.com/GeLi2001/shopify-mcp) | 237 | 2026-04-05 | MIT | Community Shopify Admin API MCP. It can also write to the store, so use a read-only scoped token |
| [QuackbackIO/quackback](https://github.com/QuackbackIO/quackback) | 318 | 2026-10-16 | AGPL-3.0 | Feedback boards plus an AI agent. One table of external links lets one tracker issue gather many signals |
| [line/abc-user-feedback](https://github.com/line/abc-user-feedback) | 378 | 2026-10-15 | Apache-2.0 | Customer-feedback app with AI fields (sentiment, summary) computed on arrival and AI-suggested issues |
| [getfider/fider](https://github.com/getfider/fider) | 4,586 | 2026-10-16 | AGPL-3.0 | Voting board with templated outgoing webhooks |
| [n8n-io/n8n](https://github.com/n8n-io/n8n) | 207,649 | 2026-10-16 | Sustainable Use (fair-code) | Has Linear, Jira, GitHub, Shopify and Sentry nodes, and a Remove Duplicates node that remembers earlier runs. No App Store or Play node |
| [activepieces/activepieces](https://github.com/activepieces/activepieces) | 25,071 | 2026-10-16 | MIT outside `ee/` | Has Linear, Jira, Shopify and AppFollow pieces. A clean polling helper with two dedupe strategies (by timestamp, by last ID) |
| [Geocodio/yak](https://github.com/Geocodio/yak) | 35 | 2026-10-16 | MIT | Coding agent fed by Sentry alert rules. The thresholds live in the Sentry rule; Yak only drops noise no code change can fix |
| [benlrichards/crashlytics-to-linear](https://github.com/benlrichards/crashlytics-to-linear) | 0 | 2025-07 | Apache-2.0 | Firebase extension: Crashlytics alerts → Linear issues. **No dedupe**, a warning in itself |
| [firebase/firebase-tools](https://github.com/firebase/firebase-tools) | 4,476 | 2026-10-16 | MIT | The Firebase MCP's Crashlytics tools: `get_report TOP_ISSUES`, `get_issue`, notes |

**Facts about the official APIs that shape the design:**

| Source | Push? | Notes |
| --- | --- | --- |
| App Store Connect `customerReviews` | **No review webhook** | `.p8` key signs a short-lived token, valid at most 20 minutes. Sort by `-createdDate`, up to 200 per page. The hourly rate limit is per key ("varies"). Edited old reviews won't show up through a created-date cursor *(inferred)* |
| Google Play `reviews.list` | No | **Only reviews from the last 7 days**, only reviews with text (star-only ratings are invisible), production versions only. Quota: 200 GET per hour per app. Must be polled at least weekly |
| Shopify webhooks | Yes | HMAC signature, `X-Shopify-Webhook-Id` for dedupe. Delivered at least once, in no fixed order, 8 retries over 4 hours. Shopify says to also run a periodic check by `updated_at`. **No API returns reviews of your own app** (unconfirmed) |
| Sentry webhooks | Yes | HMAC signature, must answer within 1 s. Fingerprint grouping already dedupes events. The official Sentry ↔ Linear integration is hosted only |
| Crashlytics | Yes (alert triggers) | New fatal, non-fatal and ANR issues, regressions, velocity alerts. Pull-based TOP_ISSUES reports through the Firebase MCP |
| Linear (writing) | n/a | An attachment URL is idempotent per issue, and `attachmentsForURL(url)` finds the issue that has a given source URL. That is the cleanest dedupe on the write side |

**Borrow:**
- **Trusted channels, never trusted content.** Take data only from authenticated first-party APIs scoped to our own apps, and check webhook signatures. Review text is still attacker-writable (obsei):
  - Mark it untrusted.
  - Redact personal data before any model sees it.
  - Any free text the agent writes after reading feedback becomes a proposed issue that a person approves.
- **A ledger of items already seen** (obsei).
  - The ID is a hash of (source, instance, native ID). A content hash catches edits.
  - The cursor moves forward only after the batch is delivered, and overlaps the previous window so items with the same timestamp aren't lost.
  - The first run records a baseline instead of flooding the tracker (ZReviewTender, reviewme).
- **Dedupe in the tracker too.**
  - Linear: the source URL as an attachment, which is idempotent.
  - Jira and GitHub: a label or a hidden marker searched before creating (obsei).
  - A links table (Quackback) lets one issue gather many signals and maps tracker changes back to their source.
- **Filter at the source, route on confidence, and have a review lane.**
  - Put thresholds where they belong: the Sentry alert rule, the Crashlytics velocity alert, a rating cutoff.
  - Drop noise no code change can fix (Yak).
  - Cap issues per run. Low-confidence items go to a review lane, never to the tracker.
  - File one issue per *theme* that cites N reviews, not one issue per review.
- **Use push where it exists, always backed by a periodic re-sync.** App Store and Play reviews can only be polled.

---

## 4 · Connectors, triggers and a setup you can re-run

**Tracker MCP servers and CLIs, and how each can be made read-only:**

| Tool | Read-only how | Notes |
| --- | --- | --- |
| Linear official MCP `https://mcp.linear.app/mcp` | **`/mcp/readonly` endpoint**, or the OAuth `read` scope | `list_issues` filters by `updatedAt` and returns SLA and triage fields, so it supports the cursor and gives urgency signals for free |
| Atlassian official MCP `https://mcp.atlassian.com/v2/mcp` ([repo](https://github.com/atlassian/atlassian-mcp-server), 1,100★) | Only through admin permission groups | The legacy SSE endpoint was due to be retired after 2026-06-30. Use a dedicated read-only service account plus Claude Code deny rules |
| [sooperset/mcp-atlassian](https://github.com/sooperset/mcp-atlassian) (6,008★, MIT) | `READ_ONLY_MODE=true`, `ENABLED_TOOLS` allow-list | The only Jira option that is read-only on the server side, and the only one for Jira Server and Data Center |
| [github/github-mcp-server](https://github.com/github/github-mcp-server) (33,662★, MIT) | `/x/issues/readonly`, `X-MCP-Readonly`, `--read-only` | Lockdown mode hides public-issue text from strangers, a defence against prompt injection (the docs call it best-effort) |
| `gh` CLI | Claude Code permission rules only | No priority field: it comes from labels or Projects fields |
| [ankitpokhrel/jira-cli](https://github.com/ankitpokhrel/jira-cli) (6,033★), [schpet/linear-cli](https://github.com/schpet/linear-cli) (1,011★), [linearis](https://github.com/linearis-oss/linearis) (261★) | Read-only API key plus permission rules | Cheap on context for runs started by a hook. linearis shows a compact usage summary first and more detail on demand |

**Connector layers.** None of them gives every tracker one shared issue format:
- [Composio](https://github.com/ComposioHQ/composio) (30,588★, MIT) exposes `LINEAR_…` and `JIRA_…` tools side by side. It can filter or require approval by tool annotation (`readOnlyHint`, `destructiveHint`), which is the right way to model "read-only by default". It is hosted, so our data passes through a third party.
- [Nango](https://github.com/NangoHQ/nango) says "you define the model". Its advice to pair webhooks with a periodic re-sync applies to us.
- Pipedream, [Arcade](https://github.com/ArcadeAI/arcade-mcp) and gateways ([docker/mcp-gateway](https://github.com/docker/mcp-gateway), [toolhive](https://github.com/stacklok/toolhive), [metamcp](https://github.com/metatool-ai/metamcp), [agentgateway](https://github.com/agentgateway/agentgateway)) would be an optional access path, never a dependency.

**Issue models to borrow:**
- **[openai/symphony `SPEC.md`](https://github.com/openai/symphony).**
  - A two-call read kernel: fetch by states, fetch by IDs.
  - It keeps the tracker's native state name next to the normalised one.
  - A per-adapter `dispatchable` flag keeps tracker quirks out of the core.
  - In the spec's words: no "generic comment/state/attachment CRUD merely to make providers look alike".
- **Linear's importer** ([linear/linear](https://github.com/linear/linear) `packages/import`).
  - Five state types: `backlog | unstarted | started | completed | canceled`.
  - Priority on a 0–4 scale where 1 is the highest; it already maps Jira's Highest…Lowest onto it.
- **[git-bug](https://github.com/git-bug/git-bug) bridges** (GPL, so ideas only): Configure / ValidateConfig / Import(since), a stored `lastImportTime`, and origin metadata as the dedupe key.
- **No mature open-source two-way Linear ↔ Jira ↔ GitHub sync exists.** A read-only normaliser is enough for a watcher.

**Triggers. What can actually wake the manager:**

| Trigger | Fits | Limits |
| --- | --- | --- |
| Claude Code hooks (`SessionStart`, `Stop`, …) | Adding "since the last report" context when someone opens a session | Fire only on session events. **They don't poll and they don't receive webhooks** |
| Cloud routine | An unattended daily or hourly report | Interval of at least 1 h. Starts from a fresh clone with connectors set per task. No local CLIs |
| Desktop scheduled task / cron + `claude -p --bare --mcp-config … --json-schema … --permission-prompts none` | Local polling. Can use CLIs | The machine must be on. `--bare` skips hooks, plugins and MCP discovery, so servers are passed explicitly |
| [claude-code-action](https://github.com/anthropics/claude-code-action) on `schedule:` | GitHub-hosted reports. `--json-schema` returns `structured_output` for later steps to act on | Tied to GitHub Actions |
| Linear Agent API (mention or delegate) | "@manager, what's urgent?" on demand | Needs a public webhook endpoint and a workspace admin. Developer preview. Delegating sets `delegate`, never `assignee` |
| Tracker webhooks | Near real time | Dedupe keys: `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-GitHub-Delivery`. Jira's dynamic webhooks expire after 30 days |

**A setup you can re-run:**
- **[cyrus-setup](https://github.com/cyrusagents/cyrus)** has one sub-skill per integration. Each starts with "check existing configuration" and skips what's done, so re-running it adds or fixes a source. Its rule: never read a secrets file into context; check it with a visible grep.
- **[knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)** describes behaviour by *category* (`~~project tracker`) and keeps a `CONNECTORS.md` table of category → included servers → other options. Its customizer binds each category to a real server.
- **[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)** layers config: shipped defaults, then a committed team file, then a gitignored personal file. Override files hold only what changed, and updates never touch the user's files.
- **Health checks.** The official [MCP registry](https://github.com/modelcontextprotocol/registry) is searchable without auth, so setup can suggest servers by category. A doctor step can reuse `mcp_servers[].status` from `claude -p --output-format json`. `asc auth doctor` is a per-CLI example.

---

## Closed-source references (ideas only)

- **Linear Triage Intelligence**: suggests team, labels, assignee and duplicates, with its reasoning visible. Admins set auto-apply per property and per team.
- **Linear Asks**: email intake that turns each email into an issue and lets you reply from Linear. Compare it against building our own email → issue path.
- **Cursor's Linear triage automation**: silent by default for items it can't act on. It posts an investigation comment rather than just labels, and flags ambiguous items for a human.
- **GitHub duplicate detection**: suggests duplicates while the issue is being filed, not in later cleanup.
- **Fyxer AI**: drafts in the provider's Drafts folder and never sends automatically. It learns tone from about 300 past emails.
- **Superhuman Auto Drafts**: one main draft plus two alternatives, in three kinds: reply, follow-up, scheduling.

---

## What this suggests for grimoire *(inferred: a sketch for `/roast` to stress-test, not a decision)*

**Pieces grimoire already has:**
- **`tracker-scout`** reads tracker context and never writes; the manager is a broader, scheduled version of it.
- **`toolHints`** in `grimoire.config.json` is a loose start on binding a category to a tool.
- The **`SessionStart` hook** exists.
- **`/grimoire:setup` migration mode** already proposes changes instead of overwriting.
- **`crystallize`** is where "the human edited the draft like this" could become a lesson.
- **`/grimoire:logs`** shows a local HTML report can work as the place the team reads the manager's output.

**A possible shape:**
1. **Sources by category, bound at setup.**
   - Categories: `tracker`, `inbox`, `reviews`, `commerce`, `errors`.
   - A `manager.sources[]` block records for each source:
     - `kind` and access (`via: mcp | cli`, the server or command, an auth *reference* and never the secret)
     - the resolved read-tool allow-list and how read-only is enforced (endpoint, flag, admin group or permission rule)
     - scope, cursor field and overlap, mapping overrides, triggers, and `verifiedAt`
   - Re-running setup detects what is configured, shows a diff, writes only what changed, then runs a probe for each source.
2. **A small adapter contract**, Symphony-style: `probe()`, `fetchChanged(since)`, `fetchByIds(ids)`. Items are normalised to a `WorkItem`:
   - Linear's five state types plus `triage`, and the native state kept alongside
   - priority 0–4, plus the native value
   - external refs, and a `needsAttention` flag with its reason
3. **A ledger in `.grimoire/manager/`.**
   - Per source: a cursor, the last run time and the last full re-sync time.
   - Per item: when it was last seen, and a hash of what was last reported, so unchanged items stay quiet.
   - A short-lived set of webhook delivery IDs.
   - Losing the ledger only causes a re-report, because the trackers can rebuild it.
4. **Separate deciding from writing.**
   - The manager runs on read-only tools and produces a schema-checked proposal list: file this, comment that, hand this to AI, draft this reply.
   - A human approves, and a narrow step applies it.
   - Email gets no send tool at all. Drafts land in Drafts, tagged for review.
5. **The report, sorted by what the human owes:** Sign off / Decide / Do / Hand to AI / Their move / Not now.
   - Each line: why it's here, the evidence, the next step.
   - One rolling report per window. Only Urgent sends a notification.
6. **Triggers: polling first.** A scheduled run (a cloud routine for MCP-only sources; a desktop task or cron for CLI sources), a `SessionStart` hint, then webhooks and the Linear Agent API mention as later upgrades.

**Decisions that are the owner's, not discoverable:**
- **Build or reuse for reviews:** borrow obsei's design, or run obsei itself once it has had time to settle?
- **Where the manager runs:** cloud routine, a local schedule, or GitHub Actions. Webhooks would need a public endpoint someone hosts.
- **Mail providers:** IMAP for everything, or the Gmail and Graph APIs where we have them?
- **Write autonomy:** which tracker writes, if any, may apply without a human yes (Linear Triage Intelligence-style per-property knobs)?
- **Where the report lands:** a local HTML page like `/grimoire:logs`, a Linear document or project update, Slack, or several.
- **Cost:** a budget per run, and how often each source is checked.

## Not verified

- The exact keys of Jira's `statusCategory`.
- Whether GitHub retries failed webhook deliveries.
- The Channels feature's minimum Claude Code version.
- Whether Activepieces exposes its piece actions as MCP tools.
- Daily run caps for cloud routines.
- That Shopify has no app-review API (one community answer).
- Whether himalaya's `-m drafts` creates a native draft on its Gmail and Graph backends.
- Licences where GitHub reports NOASSERTION; read the LICENSE file before copying anything.
