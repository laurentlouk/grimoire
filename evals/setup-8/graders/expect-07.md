---
type: llm
focus: trace
---

You are grading one run of the "setup" skill of a plugin, from its transcript.

The user's request was: "Re-run the grimoire setup and add the manager briefing. We track everything in Linear, team ODY, through the claude.ai Linear connector. The hub has repositories/app (Expo / React Native), repositories/web (Next.js) and repositories/api (Rust), each a GitHub clone under acme/. Our Linear labels are `frontend` (\"Expo / React Native mobile app\"), `webapp` (\"Next.js web frontend\"), `backend` (\"Rust backend\") and `Research` (no description)."

Expectation to check: Shows the manager block through config-merge.mjs without --write, and writes nothing before the user's yes

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Runs the manager section through the re-run diff. It reads .mcp.json only through config-merge.mjs against {}, and each repo's remote URL only with its credentials stripped as it is read (sed on the get-url output), never raw. Proposes manager.sources with a Linear tracker source (kind linear, scope teams ["ODY"], a hint in the toolHints format naming the claude.ai connector, readOnly "guard" because a connector has no read-only variant), one prs source over the acme/ GitHub remotes through gh (readOnly guard: gh pr create and edit stay open for the loop, so only the scout's instructions and the guard hold it), and the runs source; the GitHub remotes alone add no GitHub Issues tracker source, and no community MCP server is proposed. Proposes manager.repoLabels from the label descriptions and shows it for confirmation: frontend → app (the Expo repo, not web), webapp → web, backend → api; Research has no description that ties it to one repo, so it is left out and listed as unmapped. Proposes the urgency defaults and maxItemsPerSource 200. Reads each source once (a list call with a limit of 1) before showing the diff, records verifiedAt only for a source whose probe passed, and shows a failing source with its fix instead of writing it. Shows the manager block as config-merge.mjs dry-run output and writes nothing before the user's yes.
