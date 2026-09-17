# grimoire

*A spellbook for coding agents: portable skills, a roster, a memory, and a build loop that learns.*

Open-source [Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) plus the pieces around them that make an agent workflow repeatable: an agent roster (`AGENTS.md`), curated memory (`memory/`), and an unattended build loop (`workflows/`) that ends every run by crystallizing what it learned back into the skills. Stack-agnostic, tracker-agnostic (Jira, Linear, GitHub Issues, or other).

## Setup

### With Claude Code, as a plugin (recommended)

```text
/plugin marketplace add laurentlouk/grimoire
/plugin install grimoire@grimoire
```

Then, in the project, run:

```text
/grimoire:setup
```

It explores the repositories and proposes, in one screen, a team agent per repo (with the gate it must never run), the memory stores seeded only with facts found in your docs, the roster (`AGENTS.md`), the loop's `repos` configuration, and the lines to add to `CLAUDE.md`. Nothing is written until you say yes, and nothing existing is overwritten. A session-start hint points at it while the project has no roster.

Prefer to do it by hand? Copy `memory/`, `AGENTS.md`, `templates/team-agent.md` (one per repo into `.claude/agents/`) and optionally `workflows/`, then add `@memory/harness.md` and a pointer to `AGENTS.md` in your `CLAUDE.md`.

### Pin it for the whole team

Add to the project's `.claude/settings.json` so everyone who trusts the folder gets the plugin, no prompts:

```json
{
  "extraKnownMarketplaces": { "grimoire": { "source": { "source": "github", "repo": "laurentlouk/grimoire" } } },
  "enabledPlugins": { "grimoire@grimoire": true }
}
```

`/grimoire:setup` writes this for you, along with `grimoire.config.json` (repos, gates, rtk guard) that `/orchestrate` reads. **Updating** is one command: `/plugin update grimoire@grimoire` (marketplace plugins also refresh in the background). Nothing is copied into the project except your own agents, memory and config, so an update reaches every project at once.

### With Claude Code, skills only

```sh
npx skills add laurentlouk/grimoire      # every skill → .claude/skills/
```

### Without Claude Code

Skills are plain `SKILL.md` files and work in any agent that reads them (`npx skills add laurentlouk/grimoire` installs them for several). `AGENTS.md` and `memory/` are Markdown any agent can be pointed at; import `memory/harness.md` from whatever instruction file your agent reads. The build loop in `workflows/` is a Claude Code Workflow script and runs only there; without it you walk the pipeline one skill at a time, which is how it is meant to be used interactively anyway.

## Use

**First run**: `/grimoire:setup`. **The pipeline**, one skill recommending the next:

```
roast → to-plan → to-issues → build ⇄ review → PR → crystallize → ship
```

```text
/roast <idea>        # stress-test the design; answers itself from docs + code first, asks you only real decisions
/to-plan             # synthesize the approved spec into a plan of vertical slices
/to-issues           # one tracker issue per slice, with blocked-by links
/launch-agent …      # dispatch a team agent or scout from AGENTS.md, memory pasted in
/tdd                 # the discipline for writing the code
/crystallize         # after the PR: patch/create skills, add memory facts, sync docs, one reviewable PR
/orchestrate {specPath, planPath, project, repos}   # or run the whole build half unattended
```

`/orchestrate` needs a fourth input besides the three design artifacts: `repos`, the list of repositories with their owning agent, tags (for review-lens selection) and gate command. `workflows/README.md` has the full reference.

**How the harness learns.** `roast` treats the code as the source of truth and fixes documentation that drifted from it. `crystallize` runs after a PR, reads its review threads, and turns what they taught into skill patches, memory facts and doc fixes, in a PR a human reviews. The loop does this automatically at the end of every run, and reads the previous runs' ledgers at the start of the next one. Memory is small, capped and declarative on purpose (`memory/README.md`); procedures belong in skills.

**Recommended agent-instructions snippet.** `roast` and every agent work best when the whole project explores before asking. Add this to `CLAUDE.md` or `AGENTS.md`:

```markdown
## Explore before asking; don't guess
If a fact is discoverable in the docs, the code, schemas, contracts, config or git
history, find it yourself before asking, and never state a discoverable fact as a
guess. Ask only decisions the user owns: product/UX calls, cost or vendor trade-offs,
priorities, context outside the codebase. When exploration is inconclusive, say what
you checked and what is still unknown, then ask.
```

## Token economy: rtk

Every tool result an agent sees costs tokens, and an unattended loop sees thousands. [rtk](https://github.com/rtk-ai/rtk) rewrites each Bash command to `rtk <cmd>` and condenses its output before it enters context, keeping the signal and dropping the noise. Install it once and register its hook:

```sh
brew install rtk-ai/tap/rtk && rtk init -g     # registers `rtk hook claude` as a PreToolUse(Bash) hook
```

`/grimoire:setup` detects rtk and proposes the project-level hook plus the loop's guard. The guard is `requireHook` in `/orchestrate`: an execute run probes the session it runs in and refuses to dispatch when the hook is missing, because a registered hook whose binary is absent fails silently on every call and the whole run would read raw output.

```json
"requireHook": {
  "name": "rtk hook claude",
  "check": "command -v rtk && rtk hook check \"git status\" | grep -q '^rtk '",
  "fix": "brew install rtk-ai/tap/rtk && rtk init -g, then restart the session"
}
```

Without rtk everything still works; it just costs more.

## What is in the box

Installed as a plugin, skills are called as `/grimoire:roast` (or just `/roast` when unambiguous), and the loop's briefs live under the plugin root: pass `briefsDir: "${CLAUDE_PLUGIN_ROOT}/workflows/briefs"` and `personasDir` alike to `/orchestrate` if you did not copy `workflows/` into the project.


| Path | What |
| --- | --- |
| [`skills/setup`](skills/setup/SKILL.md) | First run: explore the project, propose agents, memory, roster, loop config; write on approval |
| [`skills/roast`](skills/roast/SKILL.md) | Stress-test a design: docs and code recon in parallel, self-answer ladder, open-source references, one question at a time |
| [`skills/to-plan`](skills/to-plan/SKILL.md) · [`skills/to-issues`](skills/to-issues/SKILL.md) | Spec → plan → vertical-slice issues |
| [`skills/tdd`](skills/tdd/SKILL.md) | Red, green, refactor, one behaviour at a time |
| [`skills/launch-agent`](skills/launch-agent/SKILL.md) | Dispatch from the roster with memory injected |
| [`skills/crystallize`](skills/crystallize/SKILL.md) | Post-PR learning into skills, memory and docs |
| [`skills/orchestrate`](skills/orchestrate/SKILL.md) · [`skills/adaptive-replanning`](skills/adaptive-replanning/SKILL.md) | Front door and failure behaviour of the loop |
| [`agents/`](agents) | `codebase-scout`, `reference-scout`, `contract-checker`, `tracker-scout`, `design-scout`, `reviewer` |
| [`templates/`](templates) | the team-agent definition to copy per repository |
| [`skills/implement`](skills/implement/SKILL.md) · [`skills/review`](skills/review/SKILL.md) | Build one issue through its team agent; gate it with the diverse-lens panel |
| [`memory/`](memory/README.md) | Harness and per-agent stores, Hermes-style rules |
| [`AGENTS.md`](AGENTS.md) | The roster and the three learning stores |
| [`workflows/`](workflows/README.md) | `orchestrate-loop.js` (engine, tested), `briefs/` and `personas/` (everything a dispatched agent reads) |

## License

[MIT](LICENSE)
