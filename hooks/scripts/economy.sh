#!/usr/bin/env bash
# grimoire · economy hook wrapper (PostToolUse, PostToolUseFailure, SubagentStop). Only a dispatched
# agent's calls are watched: an input without "agent_id" (the main session) is answered {} without
# starting node. Without node, or when the hook itself fails, the answer is {} too: the watch fails open.
IN=$(cat)
case "$IN" in *'"agent_id"'*) ;; *) printf '{}'; exit 0 ;; esac
command -v node >/dev/null 2>&1 || { printf '{}'; exit 0; }
OUT=$(printf '%s' "$IN" | node "$(dirname "$0")/economy.mjs" 2>/dev/null) || OUT='{}'
printf '%s' "${OUT:-{\}}"
