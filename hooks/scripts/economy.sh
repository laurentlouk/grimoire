#!/usr/bin/env bash
# grimoire · economy hook wrapper (PostToolUse, PostToolUseFailure, SubagentStop, SessionStart,
# SessionEnd). Only a dispatched agent's calls are watched: a call without "agent_id" (the main
# session's) is answered {} without starting node; the session events always go through. Without
# node, or when the hook itself fails, the answer is {} too: the hook fails open.
IN=$(cat)
case "$IN" in *'"agent_id"'*|*'"SessionStart"'*|*'"SessionEnd"'*) ;; *) printf '{}'; exit 0 ;; esac
command -v node >/dev/null 2>&1 || { printf '{}'; exit 0; }
OUT=$(printf '%s' "$IN" | node "$(dirname "$0")/economy.mjs" 2>/dev/null) || OUT='{}'
printf '%s' "${OUT:-{\}}"
