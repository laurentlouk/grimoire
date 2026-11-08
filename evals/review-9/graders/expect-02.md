---
type: llm
focus: trace
---

You are grading one run of the "review" skill of a plugin, from its transcript.

The user's request was: "Review the PR for INDEX-12. It resolved to fast. The diff adds a reader that replays the migration SQL found in any indexed repository into an in-memory SQLite database, after a text filter drops statements that start with ATTACH or VACUUM, and stores the schema it reads back in the index."

Expectation to check: Flags the text filter as a check on a different reading of the input than the engine it guards, and asks that the engine itself refuse file writes

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Treats the repository's SQL as input the code does not control, so even under fast the review runs a security review beside adversarial QA, and the reliability lens. A text filter that reads statements differently from the engine it guards is a check on a different reading of the input than its use, so it is a finding: the engine itself must refuse what can write a file (ATTACH, VACUUM INTO, extension loading). The reviewer times hostile shapes (deep nesting, long runs of blanks, very many statements) at a size where quadratic work takes seconds, and follows a planted secret from a migration literal and a malformed file to the index, tool answers and error notes.
