# Brief · ledger — write this run's ledger, mechanically

You run in your OWN worktree of the orchestrating repo (never the session's live checkout).
The header carries the JSON payload verbatim, the target path pattern and the branch name.

1. `git fetch origin && git checkout -B <branch> <base branch>` (the header names the base branch).
2. `mkdir -p` the runs directory named in the header; compute today's date with `date +%F`;
   write the JSON VERBATIM (pretty-printed) to `<runs dir>/<date>-<projectSlug>.json`. If the
   file already exists, suffix `-2`, `-3`, … Do not modify any other file, do not edit the
   content.
3. `git add` ONLY that file, commit with the message from the header, `git push -u origin
   <branch>`. Do not open a PR.
4. Return `{ path, branch }`.
