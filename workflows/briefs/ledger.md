# Brief · ledger — write this run's ledger, mechanically

You run in your OWN worktree of the orchestrating repo (never the session's live checkout).
The header carries the JSON payload verbatim, the target path pattern and the branch name.

1. `git fetch origin && git remote set-head origin -a && git checkout -B <branch> origin/HEAD`
   — the remote's DEFAULT branch, as the header says, never the run's base branch: the ledger
   is one standalone file, and a branch cut from an unmerged base drags that base's commits
   into whatever PR later carries the ledger.
2. `mkdir -p` the runs directory named in the header; compute today's date with `date +%F`;
   write the JSON VERBATIM (pretty-printed) to `<runs dir>/<date>-<projectSlug>.json`. If the
   file already exists, suffix `-2`, `-3`, … Do not modify any other file, do not edit the
   content.
3. `git add` ONLY that file, commit with the message from the header, `git push -u origin
   <branch>`.
4. **Do not open a PR.** The crystallize step stacks the run's lessons on this branch and
   opens the ONE harness PR; a ledger PR opened here can merge the ledger on its own, before
   crystallize has checked what it says (a run once did, and a misdiagnosed learning reached
   the default branch that way).
5. Return `{ path, branch }`.
