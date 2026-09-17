# Harness memory

Two small, always-injected stores of **declarative facts**, curated the way Hermes Agent curates memory. Everything else lives elsewhere: procedures in skills, team truth in `docs/`, episodic detail in run ledgers. Personal preferences stay in your agent's own private memory.

| Store | File | Cap | Injected into |
| --- | --- | --- | --- |
| Harness (shared) | `harness.md` | 2 200 chars | every root session (import it from your agent instructions, e.g. `@memory/harness.md` in `CLAUDE.md`) |
| Per agent | `agents/<agent>.md` | 1 200 chars | that agent's dispatch: the agent reads it first, and `launch-agent` / the loop paste it into the brief |

## Format
- One entry per block, separated by a line containing only `§`.
- Each entry is a **fact that applies to every future task of the store's owner**, dated when it records a decision: `Implementers never run the end-to-end gate; the orchestrator runs it once on the final tree (2026-06-12).`
- Never: instructions to yourself, narratives, one-off failures, environment-specific paths, secrets, anything derivable from the repository or already in the agent instructions.
- A fact stale within a week is not memory. A procedure is a skill, not memory.

## Who writes, and when
- **Only `crystallize` writes**, after a PR, from the PR, its review threads and the run ledger. Agents never write memory mid-task; that keeps them focused.
- Operations are add, replace, remove. When an add would exceed the cap, the same edit removes or shortens stale entries. The cap is the forcing function that keeps memory high-signal. Removal is expected.
- Exact duplicates are rejected; a near-duplicate is a replace.
- Every write is listed in the crystallize report and lands in a PR a human reviews before it is injected anywhere.
