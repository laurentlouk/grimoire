#!/usr/bin/env bash
# grimoire · PreToolUse guard wrapper. Runs guard.mjs when node is on PATH and passes its
# exit code through unchanged (2 = deny, stderr is the reason). No node → exit 0: the guard
# fails open rather than breaking every tool call.
command -v node >/dev/null 2>&1 || exit 0
exec node "$(dirname "$0")/guard.mjs"
