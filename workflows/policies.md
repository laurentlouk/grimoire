# Execution policies — the profiles

One definition of how strictly a change is reviewed, read by the loop (`orchestrate-loop.js`), by
`/grimoire:implement` and `/grimoire:review` in a session, and by the manager's launch prompts.
The drift check (`scripts/check-drift.mjs`) holds this file to the engine's constants: the
policies, the per-task panels, the router's defaults. Design and rationale:
`docs/specs/2026-10-31-execution-policies-design.md`.

## The profiles

| | `fast` | `balanced` | `strict` |
|---|---|---|---|
| **For** | docs, copy, styles, an isolated component, a small fix in a tested area | normal features and fixes | auth, payments, migrations, infra, cross-repo contracts, wide or untested changes |
| **Implementer tier** | the selector's | the selector's | at least opus |
| **Precheck** | yes | yes | yes |
| **Per-task panel** | `spec-hawk` ∥ `break-it` | `spec-hawk` ∥ the repo's quality core | the repo's, plus `privacy`, `data-integrity` and/or `contract` promoted by the task's files (and a cross-repo dependency) |
| **Verify findings** | yes | yes | yes |
| **Fix rounds** | one, carrying every stage's gating findings (spec first) | up to `maxFixAttempts` per stage | up to `maxFixAttempts` per stage |
| **After a fix** | the guard once, plus the repo's `check` command | the guard, then the panel again on RE_REVIEW | the same |
| **On failure** | escalates to `strict` on the same head (`policies.fast.onFail: 'fail'` stops instead) | the replanner | the replanner |
| **Terminal sweep, gate** | unchanged, per repo | unchanged | unchanged |

An implementer that blocks (or needs context it cannot get) during the FAST fix fails the task as any blocked fix does: escalation only follows a review outcome (a guard RE_REVIEW, a dead guard, a failing check). A FAST failure is never silent: it is journaled (`fast` event, `then: 'escalate'`) and counted
in `result.policies.fast`. Escalation keeps the commits: the strict panel judges the task's whole
range, the fix round already spent counts against its budget, and nothing is re-implemented.

## Which profile runs

1. A tracker label `grimoire:policy/<auto|fast|balanced|strict>` on the issue,
2. else `repos[].policy`,
3. else the run's `policy`,
4. else `balanced`. With no policy set anywhere a run is the lifecycle of 0.15.1.

`auto` takes the router's pick. An explicit policy below a hard floor is refused (the task runs
`strict`) unless `policies.allowBelowFloor: true`.

## The router (`auto`)

Deterministic, no model call.

- **Floor → `strict`:** a declared file matching `strictPaths` (plus the repo's own
  `repos[].strictPaths`); a repo tag in `strictTags`; routing to the migration specialist; a
  `dependsOn` on another repo's issue.
- **Raise → at least `balanced`:** no declared files; more than `fastMaxFiles`; unlocking `fanOut`
  or more downstream tasks; the selector choosing opus; a replan after a code failure; history (a
  repo whose FAST tasks escalated more than `historyMaxEscalation` of the time in earlier runs, or a
  learning about the repo naming one of the task's files).
- **`fast`:** every declared file in `docsPaths`, or nothing raised.
- Hydration may propose a stricter policy, never a looser one.
- **Promotion (`strict` only):** each lens in `promote` joins the per-task quality stage when a
  declared file matches its globs; a `dependsOn` on another repo's issue also promotes
  `data-integrity` and `contract`. This is the only promotion rule; `/grimoire:review` reads it too.

## After the build: routed again on what changed

The router classifies the declared files. Before the panel, the files the implementer changed are
classified again, raise-only:
- a changed file matching a floor glob, or the precheck's `authChange` (the diff adds, removes or
  changes an authentication or authorization check, whatever the file is named) → `strict`, with
  the lenses the changed files promote (`privacy` for an auth change), the fixes on opus;
- a task already `strict` gains the lenses its changed files (or an auth change) promote;
- an `auto` pick of `fast` whose build went past FAST's footprint (code in a docs-only pick, more
  than `fastMaxFiles` files changed) → `balanced`. An explicit `fast` (label, repo or run) is the
  owner's word on size, as at routing; its floors still apply.

Never with no policy set in the loop (balanced runs as in 0.15.1), and never under
`allowBelowFloor: true` (an override is honoured below a floor there, declared or changed).

## Defaults (`policies`)

| Key | Default |
|---|---|
| `strictPaths` | `["**/migrations/**","**/auth/**","**/payment*/**","**/billing/**","**/*.proto","**/openapi*.{yml,yaml,json}","**/schema.graphql",".github/workflows/**","**/*.tf"]` |
| `strictTags` | `["infra"]` |
| `docsPaths` | `["**/*.md","**/*.mdx","docs/**"]` |
| `fastMaxFiles` | `3` |
| `fanOut` | `3` |
| `historyMaxEscalation` | `0.25` |
| `allowBelowFloor` | `false` |
| `promote.privacy` | `["**/auth/**","**/*auth*.*","**/session*/**","**/*session*.*","**/*secret*","**/payment*/**","**/billing/**","**/*pii*"]` |
| `promote.data-integrity` | `["**/migrations/**","**/migration/**","**/*.sql","**/*.prisma","**/*.proto","**/openapi*.{yml,yaml,json}","**/schema.graphql"]` |
| `promote.contract` | `["**/*.proto","**/openapi*.{yml,yaml,json}","**/asyncapi*.{yml,yaml,json}","**/*.graphql","**/*.avsc"]` |
| `fast.onFail` | `"escalate"` |

Globs match a declared file's path, lower-cased and repo-relative: `**/` is zero or more
directories, `*` stays inside one segment, `{a,b}` is a choice. `repos[].strictPaths` adds floor
globs for one repo, where its auth, money or contract code lives under names the defaults do not
know (`src/services/auth.rs`, `**/aws_cognito/**`).

## In a session (`/grimoire:implement`, `/grimoire:review`)

Resolve the issue's profile with the same rules: its `grimoire:policy/*` label, else the repo's
`policy` in `grimoire.config.json`, else the config's `policy`. When none is set, a session runs
**`fast`** unless a floor applies (then `strict`) or a raise applies (then `balanced`): unlike the
loop, where no policy means balanced, a session's default is the owner's rule for a single issue.

The floors, raises and promotions are the router's, read the same way:
- **The footprint.** With no declared files, list the files the change will touch before building
  and classify those; that is a raise to `balanced` at least. After the build, classify what
  actually changed, as in the loop: a floor hit (the repo's `strictPaths` included) or an auth
  check added, removed or changed in the diff makes it `strict` before review, never lower.
- **Another repo.** The cross-repo floor is a blocking relation on another repo's issue
  (`dependsOn`, the tracker's blocked-by), declared or found while building (this change consumes
  an error code, a field or an endpoint that another repo's open issue adds). Changing a contract
  another repo consumes, with no such issue, is hydration's case: propose `strict`.
- **Promotion.** Under `strict`, add the lenses `promote` names for the files the change touches,
  plus `data-integrity` and `contract` for a cross-repo dependency. Nothing else promotes a lens.

**The panel in a session.** A session has no terminal sweep, so `balanced` and `strict` add the
terminal lenses that fit the repo (by its tags: `reliability-sre`, `privacy`, and `hig`,
`accessibility`, `app-store` on a UI repo) to the per-task panel, after the spec gate. `fast`
stays at its two lenses.

In a session, `fast` may run its two lenses as one reviewer dispatch: one review, one fix round for
blockers and majors carrying every finding, minors to the PR description, no re-review after the
fix. The session itself plays the guard: re-run the tests and check each finding against the fix's
own diff. Anything still open, or a test weakened, escalates the same way: the full panel reviews
the change as `strict`.
