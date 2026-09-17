# Brief · integrate — merge a reviewed lane into the repo's run branch

A lane branch has passed the full review panel; your ONLY job is to merge it into the repo's
single run branch. Integrations are serialized per repo, and parallel implementers work in
their own worktrees — the shared checkout is free for you. The header gives the exact
commands and names.

- If the merge CONFLICTS: abort it and return status CONFLICT with the conflicting paths in
  `detail`. Do NOT resolve conflicts yourself and do NOT edit any file — this diff passed
  review as-is, and rewriting it here would ship unreviewed code. Leave the lane worktree and
  branch in place for the replanner.
- On success: remove the lane worktree and branch, return status MERGED with `headSha`.

Mechanical step only: no code edits, no rebase, no push, no PR, no test runs (the repo gate
runs once on the final integrated tree).
