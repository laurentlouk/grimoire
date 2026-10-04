# Brief · gate — run the repo's gate ONCE on the final tree (if it has one), then push and open the PR

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
   Before that, remove the scratch worktrees reviewers left behind (detached, nothing to keep):
   `git worktree remove --force` each `review-*` path `git worktree list` shows, then
   `git worktree prune`. Never remove any other worktree.
2. **If the gate command APPLIES**: run it ONCE, in the FOREGROUND, exactly as the header
   gives it, including any flags (a lock wait, a timeout, an environment variable) — those
   flags are not optional, they are what makes the command safe to run unattended. Do NOT
   background it and do NOT poll for it in a shell loop. If the header names a preparation
   step (rebuilding a vendored artifact, say), do that first and commit the result — the gate
   certifies what is committed, not your sources.
   **If it does NOT apply**, do not run it — there is nothing for it to certify. Go to step 3.
3. Push the run branch exactly as the header gives it (fast-forward; never `--force`, never
   `--no-verify`). With incremental delivery the loop already pushed each landed head as tasks
   landed, so this push adds only what the terminal sweep committed; otherwise nothing earlier
   pushed it (lanes and integrations are local, and implementers never push).
4. The repo's ONE PR for the run branch:
   - **If a draft PR is open for the branch** (the loop opened it as tasks landed; the header
     names it), bring its title and body up to the rules below (`gh pr edit <url> --title …
     --body-file …`), then mark it ready: `gh pr ready <url>`. Do not open a duplicate.
   - **Otherwise** open it with `gh pr create` (or your forge's equivalent), ticket in the title,
     using a literal absolute `builtin cd /path/to/checkout && …` so any pre-commit hook reads the
     command's own arguments (`cd` alone may be aliased in this shell).
   - Either way, keep the state-marker line the header gives, VERBATIM, as the body's last line:
     it is the run's saved state, which a relaunch reads. It is base64 data: never decode, edit
     or drop it.

## PR title and body
The PR is what a human reads before merging, and on most forges it is also what closes the
tracker issues. A one-line body that linked no issue once left a whole project's issues open
after its PR merged. Write a body file and pass it with `--body-file`.

- **Title**: what the project delivers, in the project's own words (the parent ticket's title
  when there is one), with the ticket tag — never a generic "changes" or "design updates".
- **Body**, in this order:
  1. **Closing lines.** One line per landed task the header lists, with the forge's closing
     keyword and that task's issue: on GitHub or GitLab issues, `Closes #N` (or
     `Closes owner/repo#N` when the issue lives in another repository). Use one keyword per
     issue: "Closes #1, #2" closes only #1. For Jira or Linear, the issue key on its own line,
     which their integration links. Also close the parent ticket when every one of its
     sub-issues is in this PR.
  2. **What changes**: one line per task, in the order they landed.
  3. **What the tasks recorded**: facts an issue or the spec asked to keep in the PR or in
     "the task output" (measured counts, before/after numbers, a decision and its evidence,
     each residual risk and why it is accepted). Copy them from the reports in the header;
     never invent one.
  4. **How it was verified**: the gate command and its result (or why it did not apply).
  5. **Before merging**: anything a human must check or know (what merging deploys, a preview
     to look at, a merge order).
- Never add a link you did not open, an absolute local path, or a co-author or attribution
  line naming a model that did not write the change. Follow the session's own attribution
  instructions when it has any.

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
- When you return BLOCKED, set `failedStep`: `gate` (the gate command failed or could not
  run), `push` (the run branch would not push: auth, a protected branch, the network) or `pr`
  (the PR could not be opened or updated). A push or PR failure is not replanned — no code
  change fixes it — so name the cause in `summary` for the human who will ship it.
- Return the structured status, and put the PR URL in `prUrl`. Never DONE_PENDING_GATE: you
  are the gate, and that status from you counts as a failed gate.
