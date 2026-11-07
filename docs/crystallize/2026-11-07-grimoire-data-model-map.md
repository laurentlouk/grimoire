## Source: grimoire, data model map (#74), 20 PRs

Merged 2026-11-06 and 2026-11-07, releases 0.26.1 to 0.41.0: #73 and #104 (docs), #88 (a CI time bomb), #89 to #110 (the 14 slices, #94 navigation, #90 a security fix, #100 the delta committed on the run branch). Interactive sessions, not unattended runs: there is no `.grimoire/runs/` journal, so the journal rows (pass rate, cost, `toolEvidence`, `learnedFacts`, config) are skipped. No PR had a review thread. Signal: each PR body's profile, its one combined review, its fix round, what was verified, its follow-ups. The reviews: 15 FAIL (3 blockers, 38 majors), 3 PASS, 2 docs PRs with none; each FAIL took one fix round.

## Skills: created none · patched 3, plus a persona and a brief
- **`tdd`, new section "Input you do not control"**: time each hostile shape with wide headroom, and follow a planted secret to every output. Plus a paragraph: code that models another tool's output takes its expected values from that tool's real output, kept as golden fixtures. Signal: 13 reliability blockers or majors in 8 of 14 slices (1, 7, 9, 10, 11, 12, 13, 14). The spec required linear readers, yet each was found by the reviewer timing hostile input: overlapping `\s*` runs, O(depth²) parent walks, a list scanned per statement, a cache keyed by a path's spelling, deep JSON, unbounded spreads, globs and fan-out. A secret reached the index twice (#102 major: a JSON error quoted the file; #110 blocker: a quoted value read as a name). Six majors in #107 and #108 were false conflicts that only running the tools in Docker exposed. In #108 the reviewer's own oracle found three that the implementer's had missed. Eval `tdd-5`.
- **`review`, "Input the code does not control"**: such a change always gets adversarial QA with a security review, plus the reliability lens. Adversarial QA also flags a check that runs after what it guards. Signal: #89's review, with only the reliability lens, missed the file write that an outside security review found (#90). The check-after-use pattern appeared 3 times: #90 (a text filter that splits statements differently from the engine), #95 (an MCP tool skipping the endpoint's containment), #109 (grouping before the citation check). Eval `review-9`.
- **`data-model`**: stores deduced from queries (slice 14) are read. They are never re-described, and a lineage may name their tables. Signal: #110 follow-up. Eval `data-model-6`.
- **`workflows/personas/break-it.md`** and **`workflows/briefs/implement.md`**: the same two rules, for the loop's reviewers and implementers.

## Memory: harness +0/−0 · agents +0/−0
None. See Declined.

## Docs synced
- **`docs/architecture/grimoire.architecture.json`**:
  - **Before:** no component for the data model map (44 graph files uncovered); the page's paths lacked `data-view.mjs` and `stage-view.mjs` (#94 follow-up); the page server was "the only writer: Markdown notes".
  - **Now:** a `data-model` component with the 6 lines the graph shows, the page's paths, and the server writing a delta's acknowledgements too (since 0.30.0, #95). `architecture check`: 0 warnings, 19 of 19 lines seen, 81 of 106 files covered (was 37).
- **The data model map's spec and plan**:
  - **Status:** "approved" → shipped in 0.27.0–0.41.0.
  - **Slice 14:** the owner's slice (#106) is added, with its dependency.

## Config
None (no loop run).

## Upstream
- **Wall-clock assertions flake** under a loaded `npm test`, in `run-durability-hardening`, `-followups` and `-statewrite`, and pass alone (#107, #108, #109) → [#112](https://github.com/laurentlouk/grimoire/issues/112). Reproduced here: 15 failures in the full run, 91 of 91 passed alone.
- **A refined relation that disagrees with a join inferred from queries is drift worded "a foreign key … references"**, though such a join is never a foreign key (`lib/data/check.mjs`, probed on a hand-built model) → drafted, not filed here; the owner decides.
- **Mentioned only:** `nodes.signature` (`tools/graph/lib/extract.mjs`) keeps a definition's first line, so it can hold a SQL literal (#110 follow-up). It is being fixed in a separate session.

## Roast misses
- A database nothing declares (production-only, raw SQL): the owner added it as slice 14 (#106).
- Who commits the delta: D4 had the ship append it in place. #96's review raised it; D4 was amended (#97, #100) and #99 is still open.
- D9 replays repository SQL in an engine, but named no guard against the engine's file writes (#90).
- Local and production declarations of one table carry different names, so "two declarations of one store" never grouped them. Slice 13 added equivalences (#87).

None recurs, so there is no roast patch.

## Review gaps
- **#90:** an automated security review outside the panel found what the panel missed. That became the `review` patch.
- **Private names:** #73 put a private project's names into public docs. #104 removed them, and from slice 9 the reviewer checked for them. That project's name or ticket prefix still sits in 18 tracked files and 48 generated eval files (docs, skills, evals, scripts and tests; the PR lists them). They are not changed here; the owner decides.

## Declined, and why
- **Memory (every candidate, the secrets rule included).** grimoire's `memory/` is the template projects copy (README), so facts about building grimoire would reach their sessions. The rules went to skills.
- **Issues adapted to code that landed after they were written.** This is neither a roast nor a `to-issues` miss. Issues are written from the plan up front; each implementer built against the code and said what differed. No question or replan resulted.
- **Choices kept as declared, for the owner to overrule** (report only): MySQL `SERIAL` as written; a `UNIQUE` equal to the primary key (#108); attaching queries that share one table with the only declared store (#110).
- **A specialist agent for readers:** first see whether the `tdd` patch stops the pattern; no journal measured it.
- **#88's time bomb:** it happened once, and `tdd` already says to mock the clock at the edge.

## Evals
- `tdd`, `review`, `data-model`: `npm run evals:build` then `npm run evals:check` pass (122 cases).
- `npm test` (the full parallel run): 4 of 46 files failed.
  - `run-durability-hardening` and `-followups`: the flakes of #112.
  - `data.test.mjs`: a timing bound, once.
  - `pre-push.test.mjs`: it read this branch mid-edit, with the version bumped but no CHANGELOG entry yet.
  - All four pass when run again on their own.
- `GRIMOIRE_VERSION_BASE=origin/main npm run check`: no drift.
- Behavioural evals (`claude plugin eval`) were not run. The human runs them before merging.
