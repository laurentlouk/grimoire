---
name: to-plan
description: Synthesize an approved design into a plan. Use after roast, when a design spec exists and you need a written plan before slicing it into work; no interview, just synthesis of what roast already settled.
---

# Turn the design into a plan

Take the approved design (the spec `roast` produced) and what you know about the codebase, and turn them into a written plan. Do not re-interview anyone; just synthesize what is already settled.

Start by choosing the seams you will test the feature at. When the project has the code graph, `graph_impact` and `graph_callers` on what the design changes show where the existing seams are and which tests already cross them; read those seams in the code before you choose one. Prefer seams that already exist, and pick the highest one you can, since fewer seams across the codebase is better and one is ideal. Check that those seams match what the user expects before you go further.

Then write the plan to a file (for example `docs/plans/YYYY-MM-DD-topic-plan.md`). Include the problem in the user's words, the solution in the user's words, a numbered list of user stories in the form "as an [actor] I want [feature] so that [benefit]", the seams you chose, and the vertical slices. A slice is the smallest end-to-end piece that delivers something a user can see, and it cuts through whatever parts of the codebase it needs rather than building one layer on its own. Order them smallest first.

Use the project's own vocabulary and respect the conventions it already follows, and do not reopen decisions the spec has already made. Explore before asking; don't guess: a seam, a path, an existing helper or a convention is read from the code, never assumed and never asked. If the plan needs a decision the spec did not settle, that is a design gap: take it back to `roast`, not to a guess. When the plan is agreed, hand it to `to-issues`.
