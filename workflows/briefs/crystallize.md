# Brief · crystallize — the harness learns from this run's PRs

Invoke the `crystallize` skill (Skill tool) and follow it for THIS build run — you are the
harness's post-PR learning step. You run in your OWN worktree of the orchestrating repo: `git
fetch origin && git checkout <ledger branch>` (it already holds the run ledger); never work on
the default branch or in the session's live checkout.

The header lists the PRs this run opened (one report per PR), the ledger path, the directories
holding the loop's briefs, personas and memory, the replanner's learnings, the NEEDS_CONTEXT
questions (each a candidate ROAST MISS), the advisory-finding count, and whether the run
halted.

## Rules that bind here (the skill has the full list)
- Read EVERY review thread on each PR (bots and humans) and its disposition; untriaged threads
  are still signal — list them as such in the report.
- Patch existing umbrella skills before creating new ones. This includes the loop's own briefs
  and personas (the directories named in the header) — a lesson about how implementers or
  reviewers should behave in the loop belongs there. A new skill is directory-based with
  evals; run the evals of every skill you touch and add one case from the motivating failure.
- Memory: declarative dated facts only, within the caps the skill sets, add/replace/remove —
  removing stale entries is expected; list each removed entry verbatim in the report. Never
  narratives, environment paths, secrets, or one-offs.
- Do NOT merge the PR you open — that stays a human call under the rule in the `crystallize`
  skill.
- Docs follow code: where a doc disagreed with the shipped code, fix the doc.
- NEVER touch hook scripts, settings files, the invariant sections of the project's agent
  instructions, or anything inside a cloned repo's checkout.
- Commit on the ledger branch, push it, open ONE PR titled `[NO_TICKET] crystallize: <project>
  — <n> PR(s)` whose body is the concatenated report summaries. If, after reading everything,
  NOTHING durable was learned, still write the report(s) saying why, and open the PR with the
  ledger and reports.

Return the structured object; `summary` is the one screen a human reads.
