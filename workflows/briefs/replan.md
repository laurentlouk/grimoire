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

Always return `learnings`: the durable lesson(s) this failure taught, phrased so a later replan
can apply them — they are folded into every later hydration AND into the run ledger that the
next run reads. Read-only PLANNING — do NOT modify any repo or the tracker. Prefer REVISE; HALT
only when truly stuck.

## Which tracker tools (only if you need to read an issue)
If the header has a **Tracker tools** section, use exactly those tools. Otherwise prefer an
authenticated connector over a server picked by its name; if a server reports that it needs
authentication, search for the other tracker tools available (ToolSearch, by the tracker's
name) and use one that works. Only when none works is it a problem to report.
