#!/usr/bin/env bash
# grimoire · economy hook wrapper (PostToolUse, PostToolUseFailure, SubagentStop). Runs economy.mjs
# when node is on PATH; without node it answers {} and changes nothing: the watch fails open.
command -v node >/dev/null 2>&1 || { echo '{}'; exit 0; }
exec node "$(dirname "$0")/economy.mjs"
