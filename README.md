# grimoire

*A spellbook for coding agents: portable skills, a roster, a memory, and a build loop that learns.*

Open-source [Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) plus the pieces around them that make an agent workflow repeatable: an agent roster (`AGENTS.md`), curated memory (`memory/`), and an unattended build loop (`workflows/`) that ends every run by crystallizing what it learned back into the skills. Stack-agnostic, tracker-agnostic (Jira, Linear, GitHub Issues, or other).

## Setup

### With Claude Code

```sh
npx skills add laurentlouk/grimoire            # every skill → .claude/skills/
git clone https://github.com/laurentlouk/grimoire /tmp/grimoire
cp -r /tmp/grimoire/agents .claude/agents        # the scouts + a team-agent template
cp -r /tmp/grimoire/memory ./memory              # harness + per-agent memory stores
cp /tmp/grimoire/AGENTS.md ./AGENTS.md           # the roster; fill in your repos
cp -r /tmp/grimoire/workflows .claude/workflows  # optional: the build loop
```

Then, in your `CLAUDE.md`:

```markdown
@memory/harness.md
See AGENTS.md for the agents this project dispatches and how the harness learns.
```

Create one team agent per repository from `agents/team-agent.template.md`, and one memory file per agent in `memory/agents/`.

### Without Claude Code

Skills are plain `SKILL.md` files and work in any agent that reads them (`npx skills add laurentlouk/grimoire` installs them for several). `AGENTS.md` and `memory/` are Markdown any agent can be pointed at; import `memory/harness.md` from whatever instruction file your agent reads. The build loop in `workflows/` is a Claude Code Workflow script and runs only there; without it you walk the pipeline one skill at a time, which is how it is meant to be used interactively anyway.

## Use

**The pipeline**, one skill recommending the next:

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

**How the harness learns.** `roast` treats the code as the source of truth and fixes documentation that drifted from it. `crystallize` runs after a PR, reads its review threads, and turns what they taught into skill patches, memory facts and doc fixes, in a PR a human reviews. The loop does this automatically at the end of every run, and reads the previous runs' ledgers at the start of the next one. Memory is small, capped and declarative on purpose (`memory/README.md`); procedures belong in skills.

## What is in the box

| Path | What |
| --- | --- |
| [`skills/roast`](skills/roast/SKILL.md) | Stress-test a design: docs and code recon in parallel, self-answer ladder, open-source references, one question at a time |
| [`skills/to-plan`](skills/to-plan/SKILL.md) · [`skills/to-issues`](skills/to-issues/SKILL.md) | Spec → plan → vertical-slice issues |
| [`skills/tdd`](skills/tdd/SKILL.md) | Red, green, refactor, one behaviour at a time |
| [`skills/launch-agent`](skills/launch-agent/SKILL.md) | Dispatch from the roster with memory injected |
| [`skills/crystallize`](skills/crystallize/SKILL.md) | Post-PR learning into skills, memory and docs |
| [`skills/orchestrate`](skills/orchestrate/SKILL.md) · [`skills/adaptive-replanning`](skills/adaptive-replanning/SKILL.md) | Front door and failure behaviour of the loop |
| [`agents/`](agents) | `codebase-scout`, `reference-scout`, `reviewer`, and a team-agent template |
| [`memory/`](memory/README.md) | Harness and per-agent stores, Hermes-style rules |
| [`AGENTS.md`](AGENTS.md) | The roster and the three learning stores |
| [`workflows/`](workflows/README.md) | `orchestrate-loop.js` (engine, tested), `briefs/` and `personas/` (everything a dispatched agent reads) |

## License

[MIT](LICENSE)
