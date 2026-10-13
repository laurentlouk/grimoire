# evals/ (GENERATED)

This directory is **generated** from `skills/*/evals/evals.json` by `scripts/build-evals.mjs`. Do not edit it by hand:
edit the skill's `evals.json`, then run `node scripts/build-evals.mjs`. CI runs `node scripts/build-evals.mjs --check`,
which fails when this tree is stale.

Layout (the `claude plugin eval` format): one case per `<skill>-<id>/`, with `prompt.md` (frontmatter: tags
`[<skill>, positive|negative|edge]`, turn and time limits; body: the query) and `graders/`:

- `trigger.md`: `tool_used` on `Skill` for the skill (bare or `grimoire:`-namespaced). For a negative case it is
  `min: 0`, `max: 0`, `arm: both`: the skill must not fire.
- `expect-NN.md`: one `llm` grader per expectation, a PASS/FAIL rubric over the transcript.

Run: `claude plugin eval .` from the plugin root (filter with `--tag <skill>` or `--case '<skill>-*'`).
Each run writes `evals/results/<timestamp>/`, which is git-ignored.

Before a push, `npm run evals:changed` (`scripts/skill-evals.mjs`) runs the cases of every skill the branch changes,
on your machine and your Claude login, in a temporary worktree of the commit, and remembers each pass by the skill's
content, so an unchanged skill is never run twice. The pre-push hook (`npm run hooks` once per clone) does the same for
each pushed ref from a terminal, and blocks a push whose changed skills have not passed. A skill fails when any case
scores below `GRIMOIRE_EVALS_THRESHOLD` (default 0.85); the other settings are in the script's header.

| Skill | Cases | Positive | Negative | Edge |
| --- | --- | --- | --- | --- |
| adaptive-replanning | 4 | 1 | 1 | 2 |
| crystallize | 5 | 1 | 1 | 3 |
| graph | 4 | 1 | 2 | 1 |
| implement | 5 | 1 | 1 | 3 |
| launch-agent | 5 | 1 | 1 | 3 |
| logs | 4 | 1 | 1 | 2 |
| orchestrate | 12 | 1 | 1 | 10 |
| review | 5 | 1 | 1 | 3 |
| roast | 5 | 1 | 1 | 3 |
| setup | 5 | 1 | 1 | 3 |
| tdd | 4 | 1 | 1 | 2 |
| to-issues | 4 | 1 | 1 | 2 |
| to-plan | 3 | 1 | 1 | 1 |
