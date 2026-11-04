#!/usr/bin/env bash
# grimoire · economy hook wrapper (PostToolUse, PostToolUseFailure, SubagentStop, SessionStart,
# SessionEnd, UserPromptSubmit, Stop). A dispatched agent's events (with "agent_id") and the session
# events always go to economy.mjs. The main session's calls, prompts and stops go only when
# grimoire.config.json sets "loopGuard": "on" (a grep: a shadow session never starts node for them).
# Without node, or when the hook itself fails, the answer is {}: the hook fails open.
IN=$(cat)
case "$IN" in
  *'"agent_id"'*|*'"SessionStart"'*|*'"SessionEnd"'*) ;;
  *) grep -Eqs '"loopGuard"[[:space:]]*:[[:space:]]*"on"' "${CLAUDE_PROJECT_DIR:-$PWD}/grimoire.config.json" || { printf '{}'; exit 0; } ;;
esac
command -v node >/dev/null 2>&1 || { printf '{}'; exit 0; }
OUT=$(printf '%s' "$IN" | node "$(dirname "$0")/economy.mjs" 2>/dev/null) || OUT='{}'
printf '%s' "${OUT:-{\}}"
