# Loop briefs — the prose every dispatched agent reads

`orchestrate-loop.js` builds each dispatch as a **short dynamic header** (the task text,
files, SHAs, memory block, exact commands) plus one line: *"Read `briefs/<name>.md` — it is
the binding rest of this brief."* Everything an agent needs to *understand* lives here, in
Markdown; the JS keeps only what must be *computed*. Workflow scripts cannot read files, so
the agent reads its brief itself (one `Read`, same as a skill).

Why: readability (the JS would otherwise be two-thirds template strings), and **crystallize
can patch these files** as prose after a PR — the loop's briefs are procedures, so they are
skills in all but name and evolve the same way. Personas (review lenses) live in
`../personas/<id>.md`.

| Brief | Dispatch | Model |
|---|---|---|
| `index.md` | verify design artifacts + slice index | sonnet |
| `hydrate.md` | per-cycle just-in-time task hydration + the selector (agent × model per task) | sonnet |
| `implement.md` | implementer + fix rounds (owning repo agent or an enabled specialist) | per task |
| `resolve.md` | read-only scout answering NEEDS_CONTEXT (picked by question shape) | cheap |
| `precheck.md` | structural check between implementer and panel | haiku |
| `review.md` | every review persona (spec · quality · terminal) | sonnet |
| `verify.md` | checks each gating finding before a fix is bought | sonnet |
| `guard.md` | post-fix guard | sonnet |
| `integrate.md` | lane → run-branch merge | cheap |
| `gate.md` | the repo's gate command + PR | opus |
| `replan.md` | adaptive re-planner | opus |
| `journal.md` | one chunk of the decision log (runs a fixed script) | haiku |
| `claim.md` | hands back tracker issues the run claimed and did not land | haiku |
| `ledger.md` | run ledger writer | cheap |
| `crystallize.md` | post-PR learning (runs the `crystallize` skill) | opus |

`per task` is the selector's pick (haiku, sonnet or opus; opus when unset), escalated to opus
from the configured fix round and for every replanned task.

Nothing here names a language, framework, tracker or CI system: anything stack-specific
arrives in the header the JS builds from `args` (the repo's checkout path, its gate command,
its agent). Rule for editing: a change here changes every future run. Keep each file
imperative and short; put *why* in one sentence, not a paragraph. Values that differ per
dispatch never belong here.

If you installed these through a skills CLI and they live somewhere other than
`workflows/briefs`, pass `{briefsDir, personasDir}` so every dispatch points at the right
path.
