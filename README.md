# grimoire

*A spellbook for coding agents: portable skills you cast on your own workflow.*

Open-source [Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) for Claude Code and other SKILL.md-compatible agents. Each skill is a portable workflow an agent discovers and runs on its own, living in `skills/<name>/SKILL.md`. `workflows/` holds the orchestrator that chains the build half of them end-to-end.

## Install

Install every skill in this repo with the [`skills`](https://skills.sh) CLI:

```sh
npx skills add laurentlouk/grimoire
```

Or install a single skill:

```sh
npx skills add laurentlouk/grimoire/roast
```

Skills land in `.claude/skills/` (project) or `~/.claude/skills/` (global). Invoke one in Claude Code with `/roast`, or let the agent trigger it automatically from the description.

## Skills

`roast`, `to-plan`, and `to-issues` run in order as a design pipeline. `tdd` is the discipline for writing the code once the work is planned. `adaptive-replanning` describes how an unattended build loop recovers when a step fails. Each one is useful on its own.

| Skill | What it does |
| ----- | ------------ |
| [`roast`](skills/roast/SKILL.md) | Stress-tests a plan or design before any code is written. It reads the code and existing patterns first, then interrogates the design one question at a time until you reach shared understanding. |
| [`to-plan`](skills/to-plan/SKILL.md) | Turns an approved `roast` design into a written plan. No interview, just a synthesis of what was settled, sliced into small vertical increments. |
| [`to-issues`](skills/to-issues/SKILL.md) | Breaks a plan into independently grabbable issues, one vertical slice each, in your tracker (Jira, Linear, GitHub Issues, or other). |
| [`tdd`](skills/tdd/SKILL.md) | Test-driven development discipline: red, green, refactor, one behavior at a time, tested through the public interface. |
| [`adaptive-replanning`](skills/adaptive-replanning/SKILL.md) | How an unattended build loop recovers from a failed step: replan the remaining work from the current state instead of restarting or retrying blindly. |

## Workflows

`workflows/orchestrate-loop.js` is a [dynamic workflow](https://code.claude.com/docs/en/workflows) script that runs the build half of the pipeline unattended: it takes the spec, the plan and the tracker project the design skills produced, then implements every issue, reviews each one through a diverse-lens panel, gates the final tree and opens one PR per repo. It previews by default, and every repo, agent, gate command and path is configuration you pass in — nothing about a stack is baked in. See [`workflows/README.md`](workflows/README.md).

## Recommended `CLAUDE.md` setup

`roast` works best when your agent reads the project's documentation before asking you anything. Add this to your project's `CLAUDE.md` (or `AGENTS.md`) so the docs-first behavior applies everywhere, not just inside the skill:

```markdown
## Explore before asking; don't guess

If a fact is discoverable — in the project's documentation (`README`, `docs/`, ADRs,
specs, runbooks), the code, schemas, API contracts, config, or git history — find it
yourself before putting the question to the user, and never state a discoverable fact
as a guess. Reserve questions for decisions only the user owns: product/UX calls, cost
or vendor trade-offs, priorities, and context that lives outside the codebase. When
exploration is inconclusive, say what you checked and what's still unknown, then ask.
```

## License

[MIT](LICENSE)
