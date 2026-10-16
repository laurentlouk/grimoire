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

The pre-push check (`npm run hooks` once per clone) runs the same `--check` on every pushed commit, with no model
and no key. Running the cases is manual and paid, and needs the command-line `claude` signed in.

| Skill | Cases | Positive | Negative | Edge |
| --- | --- | --- | --- | --- |
| adaptive-replanning | 4 | 1 | 1 | 2 |
| architecture | 5 | 1 | 2 | 2 |
| crystallize | 5 | 1 | 1 | 3 |
| graph | 7 | 1 | 3 | 3 |
| implement | 5 | 1 | 1 | 3 |
| launch-agent | 5 | 1 | 1 | 3 |
| logs | 5 | 1 | 1 | 3 |
| manager | 4 | 1 | 1 | 2 |
| orchestrate | 12 | 1 | 1 | 10 |
| review | 5 | 1 | 1 | 3 |
| roast | 5 | 1 | 1 | 3 |
| setup | 11 | 1 | 2 | 8 |
| tdd | 4 | 1 | 1 | 2 |
| to-issues | 4 | 1 | 1 | 2 |
| to-plan | 3 | 1 | 1 | 1 |
