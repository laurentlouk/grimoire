---
type: llm
focus: trace
---

You are grading one run of the "tdd" skill of a plugin, from its transcript.

The user's request was: "Test-first, add a reader to our indexer for the migration SQL and snapshots that our ORM's migration generator writes. The indexer runs over any repository a user points it at."

Expectation to check: Still proceeds one behaviour at a time: one failing test, then the least code to pass it

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Works one behaviour at a time, and takes the expected values from the generator itself: runs it at development time (in a throwaway container if it needs a database) on small schemas and commits what it wrote as golden fixtures the tests read, rather than expectations written from reading the generator's source. Because the files come from any repository, it also builds the hostile shapes (deep nesting, long runs of blanks, many statements, self-referencing expansions) at a size where quadratic work takes seconds and asserts a bound with wide headroom, and plants a fake secret built at runtime in a literal and in a malformed file, asserting it reaches no output and that errors give a position, never the text.
