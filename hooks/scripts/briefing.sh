#!/usr/bin/env bash
# grimoire · SessionStart headline. Prints one line from the latest manager briefing
# (.grimoire/manager/latest.md): its counts, its age, and whether it is partial or stale. Reads
# files only and never runs a briefing; silent when there is none. Fails open: no node on PATH,
# or any error, is exit 0 with no output.
command -v node >/dev/null 2>&1 || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
PLUGIN_ROOT="$(dirname "$0")/../.."
node "$PLUGIN_ROOT/scripts/manager.mjs" headline --root "$root" 2>/dev/null
exit 0
