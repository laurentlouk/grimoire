# Brief · journal — write one chunk of the decision log, mechanically

The header holds ONE bash script. Run it exactly as given, in a single Bash call, from the
orchestrating workspace root (the session's working directory — not a cloned repo, not a
worktree).

- Copy the script verbatim. Do not edit, reformat, re-indent, re-quote, wrap or re-encode any
  line — each event line is JSON the viewer parses byte for byte, and the engine checks the
  line and byte counts the script prints against what it sent.
- Do not add commands, do not read the files back, do not commit anything: the directory is
  local and gitignored.
- If the script fails, do not retry with a modified version — return what it printed.

Return `runDir`, `lines` and `bytes` from the script's `RUNDIR`, `LINES` and `BYTES` output.
