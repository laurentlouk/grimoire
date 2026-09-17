# Review personas — the lenses of the loop's review panel

One file per persona. `orchestrate-loop.js` keeps only the *structure* (id, name, stage,
appliesTo — what the scheduler needs to pick a panel); the *lens* an agent reads lives here so
`crystallize` can sharpen it after a PR, e.g. when a reviewer finding exposed a blind spot.

Stages: `spec` (per task, fidelity) · `quality` (per task, the build-safety core a dependent
task would inherit) · `terminal` (once per repo at project end, the whole integrated branch).

`appliesTo` matches on a repo's **tags**, never its name — set `args.repos[].tags` to
`backend`, `mobile`, `web`, `infra` (or your own; a persona simply never fires for a tag no
repo carries). That is what makes the panel portable: a repo tagged `mobile` draws the
human-interface, accessibility and store-review lenses wherever it lives.
