# grimoire-live

A live view of grimoire in Claude Code's interface. It is optional: grimoire works the same without it.

| Where | What |
| --- | --- |
| **A pane, "grimoire run"** | The build loop's run as it goes: its status, tasks done of total, who works on what (task, step, agent, model, round, for how long), the latest decisions, the cost against its cap, the stuck watch's flags. It opens with `/grimoire-run`, or with the band's Run button. A toast says when a run starts; the mod never opens a pane unasked. |
| **The band above the prompt** | The manager briefing's line while it asks for attention (urgent or ready-for-AI items, a stale or partial briefing). It has a button to open the run, and a button to hide the band; `/grimoire-band` shows or hides it. |
| **The status line** | The running run: `grimoire <run> · 5/12 tasks · 2 active · cost 84%`. |
| **graph_diff's row** | Its risk (high, medium, low) and what it reaches: files changed, files reaching them, test files to run. It is a card on the desktop and mobile apps, and a line under the row in a terminal. |
| **Toasts** | A run starts, halts or ends, is replaced by another, reaches 80% of its cost cap, or goes 15 minutes without an event; the stuck watch flags an agent. A session's first snapshot is a baseline, so nothing old is toasted when a session opens. |

## How it works

The mod decides nothing. Every 5 seconds it runs grimoire's `scripts/live.mjs --root <project>`, which prints one JSON snapshot. The snapshot is built from the files grimoire already writes:
- the decision journal, `.grimoire/runs/`;
- the manager briefing, `.grimoire/manager/`;
- the stuck watch, `.grimoire/economy/`.

The mod draws that snapshot. Like the briefing headline, it holds ids, counts, verdicts and models, and never a ticket's text.

The mod finds the script through `.grimoire/live/plugin-root`, which grimoire's SessionStart hook writes in the project. In a linked git worktree, the main checkout's file is read too.

A repository could ship that file pointing at a script of its own, so the mod follows the pointer only when it names an installed grimoire:
- an absolute path, with no `.` or `..` segment;
- outside the project and its main checkout;
- holding a `plugin.json` named `grimoire` and a `scripts/live.mjs`.

Until grimoire has run once in a project, the pane says why and the rest stays empty. When the snapshot stops coming (the script fails, the pointer goes), the status line is cleared and the pane says why, so nothing stale stays on screen.

## Install

At the prompt of a terminal session, with grimoire installed:

```
/plugin install grimoire-live@grimoire
```

## Develop

From this folder:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

`hooks/view.ts` holds what the drawings say, as plain functions. `hooks/register.tsx` holds the hooks. `types/index.d.ts` holds the snapshot's contract (version 1) and the values the mod keeps for the session.
