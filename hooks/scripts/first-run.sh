#!/usr/bin/env bash
# grimoire · SessionStart hint. Prints one line when the project has no harness roster yet,
# so a fresh install knows the next step. Silent otherwise; never blocks.
set -u
root="${CLAUDE_PROJECT_DIR:-$PWD}"
if [ ! -f "$root/AGENTS.md" ] && [ ! -d "$root/memory" ]; then
  echo "grimoire: this project has no harness roster yet — run /grimoire:setup to explore it and create the agents, memory stores and AGENTS.md."
fi
exit 0
