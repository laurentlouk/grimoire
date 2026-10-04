# Brief · env — check that the machine can still do the work, mechanically

Something in the run stalled: a task came back BLOCKED or empty, an agent ran late, or a push
failed. A machine that stopped cooperating looks exactly like that: a commit-signing agent that
locked, an SSH agent that hangs, a laptop on battery about to sleep. The header holds ONE bash
script that checks those things, each under a time limit. Your whole job is one Bash call: run it
exactly as given, from the orchestrating workspace root, then report what it printed.

- Copy the script verbatim. Do not edit, reformat or re-quote any line.
- Run no other command, and fix nothing: do not unlock, approve, restart or reconfigure anything,
  do not commit or push yourself. The loop decides what a failure means.
- A check that timed out prints exit 142. That is a result: report it, never retry it or run the
  command another way.
- A check prints `CHECK <name> EXIT <code>`, then up to five lines of its output, each starting
  with `  | `.

Return one `results` entry per `CHECK` line, in order: `name` exactly as printed, `exit` (the
number), and `output` (the `  | ` lines under it, verbatim, without the `  | ` prefix).
