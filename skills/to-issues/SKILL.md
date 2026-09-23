---
name: to-issues
description: Break a plan into independently grabbable issues, one vertical slice each. Use after to-plan to turn a plan into tracked work in your issue tracker (Jira, Linear, GitHub Issues, or other) before building starts.
---

# Break the plan into issues

Break the plan into small tracer-bullet issues, one thin vertical slice each. A slice cuts through whatever parts of the codebase it needs, can be demoed on its own, and is small enough to fit in one fresh context window. Never carve the work up by layer.

Explore the affected code first, and never guess what you can look up. When the project has the code graph, `graph_impact` on what a slice changes gives a first list of the files it reaches and the tests on those paths; confirm each in the code before it becomes an issue's declared files. The files a slice touches, the tables and contracts it crosses and the helpers it can reuse come from the code, so an issue names them exactly and the implementer inherits no gap to fill. Only a product, priority or trade-off decision is a question for the user; a decision the spec left open goes back to `roast`. If some groundwork would make the real change easier, do that as slice zero: make the change easy, then make the easy change. For a wide mechanical change like a rename or a retype whose reach will not fit in one slice, sequence it as expand then contract. Add the new form next to the old one, move the call sites over in batches, and only then delete the old form. Do not attempt it as one big rewrite.

For each slice, capture a title in the project's own vocabulary, who will build it, the files it touches, what success looks like, its dependencies, and its order (smallest first). Then create one issue per slice in your tracker (Jira, Linear, GitHub Issues, or other), linked to the parent project or ticket and tagged with its slice number, with block and is-blocked-by links between them so nothing runs ahead of an unmet dependency. Ordering is a default, not a straitjacket: any issue whose blockers are all done is fair to pick up, so work the frontier.

Show the proposed breakdown as a numbered list and get the user's sign-off before you create anything. Then take them one issue at a time.
