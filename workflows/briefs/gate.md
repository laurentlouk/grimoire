# Brief · gate — run the repo's gate ONCE on the final tree, then open the PR

Every code change of this run in this repo is already committed AND has passed every per-task
review plus the repo's terminal quality sweep — the WHOLE project's task queue is drained.
There is NOTHING left to implement. Your only job is to certify the tree and ship it.

The header gives the checkout, the branch, the ticket, whether the repo's gate command
**applies** (and why — a gate may be conditional on which paths the run touched), the exact
command, and the stamp file it writes.

## Steps, in order
1. Confirm the tree is clean and everything is committed on the branch — `git status
   --porcelain` must be empty. A gate stamp is a TREE HASH, so any uncommitted edit or later
   commit invalidates it. If something is uncommitted, commit it first.
2. **If the gate command APPLIES**: run it ONCE, in the FOREGROUND, exactly as the header
   gives it, including any flags (a lock wait, a timeout, an environment variable) — those
   flags are not optional, they are what makes the command safe to run unattended. Do NOT
   background it and do NOT poll for it in a shell loop. If the header names a preparation
   step (rebuilding a vendored artifact, say), do that first and commit the result — the gate
   certifies what is committed, not your sources.
   **If it does NOT apply**, do not run it — there is nothing for it to certify. Go to step 3.
3. Open the PR with `gh pr create` (or your forge's equivalent), ticket in the title, using a
   literal absolute `cd /path/to/checkout && …` so any pre-commit hook reads the command's own
   arguments. If a PR is already open for this ticket, push to it instead of opening a
   duplicate.

## Hard rules
- This is the ONLY gate run for this repo in this run — the review fixes are already in the
  tree, which is precisely why the gate runs here instead of once per fix round. Do not re-run
  it "to be safe", and never write a stamp by hand.
- Do NOT change code to make the gate pass. A failure here is a real regression the panel
  missed: return BLOCKED with the failing test names and the relevant output, and let the loop
  re-plan.
- A gate that needs a shared or exclusive resource (a lock, a device, an emulator, a port) can
  fail for scheduling reasons rather than code reasons. Report what it told you — the holder,
  the missing device — and return BLOCKED. Never work around the lock and never retry in a
  loop hoping it passes.
- If the gate was judged NOT to apply but the PR is blocked by the repo's own pre-PR hook, the
  branch DOES touch a path the gate condition did not account for: return BLOCKED naming the
  file the hook reported, so the condition can be fixed.
- Never poll-loop or babysit a command: run it in the foreground and wait.
- Return the structured status, and put the PR URL in `prUrl`.
