# Brief · replan — A* from the CURRENT state, never a restart

The dependency scheduler is STUCK: the failures in the header are blocking the remaining work
(or are the only open work left). Re-run the planner as an A* search FROM THE CURRENT STATE —
do NOT restart from the original plan. Treat the already-DONE work as immutable (it is
committed) and as your new start node, and search for the best path that unblocks the goal. A
failure is INFORMATION, not a reason to retry blindly: fold its cause into the revised approach
so we do not walk back into the same dead-end.

The design artifacts to stay true to (spec, plan — paths in the header) settle WHAT must land.
A revised path may re-approach the work, but re-litigating the design is roast's job, not yours.

## Your move — return exactly one decision
- **REVISE**: return replacement/repair tasks for the FAILED work (same task schema). Every task
  you emit re-enters the dependency scheduler FULLY SPECIFIED — it is NOT re-hydrated from the
  tracker — so it must carry a full, self-contained `taskText` an implementer can run
  UNATTENDED (no "ask the user"), plus repo, agent (from the table in the header), slice, order,
  declared `files`, and dependsOn (real issue ids). Re-use a failed issue's id to retry it with a
  concretely DIFFERENT approach (its dependents unblock when it lands); split it; INSERT new
  prerequisite tasks with new ids (point the failed id's dependsOn at them); or mark work
  deferred (blocked on a deploy or another repo). Never re-emit DONE or merely-BLOCKED work.
- **HALT**: only when the remaining goal is genuinely blocked on something this loop cannot do
  unattended — a deploy, a human product/UX decision, an external dependency. Give a precise
  reason. A halt reason is never a discoverable fact: if the spec, the plan, the code, a schema,
  a contract or git history can settle it, read it (or emit a task that does) and REVISE
  instead. Explore before asking; don't guess.

## A DIED task may still be running
An agent the wall-clock backstop gave up on is booked as DIED, but nothing stops it: it can
keep working in the checkout and commit after you start. Its failure detail says so when that
is the case. Before you requeue it, look: `git log <base>..<run branch>`, `git status`, and the
build, test or server processes still running. If its work landed, requeue it as a short
verify-and-report task (startSha = the commit before the task), never as a redo that rebuilds
committed work or regenerates artifacts.

## Learnings are measured, not estimated
Always return `learnings`: the durable lesson(s) this failure taught, phrased so a later replan
can apply them — they are folded into every later hydration AND into the run ledger that the
next run reads. A duration or a cause in a learning comes from a measurement: the session's
tool latency in the header, a timing you take yourself, the journal's timestamps. A learning
once blamed slow tests for a timeout when a hook had added 30 s to every one of the agent's
commands, and proposed a config value that could not take effect; check what a knob does
before you recommend it.

Read-only PLANNING — do NOT modify any repo or the tracker. Prefer REVISE; HALT only when
truly stuck.
