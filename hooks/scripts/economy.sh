#!/usr/bin/env bash
# grimoire · economy hook wrapper (PostToolUse, PostToolUseFailure, SubagentStop, SessionStart,
# SessionEnd, UserPromptSubmit, Stop). A dispatched agent's events (with "agent_id") and the session
# events always go to economy.mjs. The main session's calls, prompts and stops go only when
# grimoire.config.json sets "loopGuard": "on" (a grep: a shadow session never starts node for them).
# In a linked worktree the main checkout's config is read too, as scripts/project-config.mjs layers
# it (node then decides from the merged config). Without node, or when the hook itself fails, the
# answer is {}: the hook fails open.
IN=$(cat)
guard_on() { grep -Eqs '"loopGuard"[[:space:]]*:[[:space:]]*"on"' "$1/grimoire.config.json"; }
case "$IN" in
  *'"agent_id"'*|*'"SessionStart"'*|*'"SessionEnd"'*) ;;
  *)
    D="${CLAUDE_PROJECT_DIR:-$PWD}"
    if ! guard_on "$D"; then
      GD=$(sed -n 's/^gitdir: //p' "$D/.git" 2>/dev/null)
      case "$GD" in */.git/worktrees/*) guard_on "${GD%%/.git/worktrees/*}" || { printf '{}'; exit 0; } ;; *) printf '{}'; exit 0 ;; esac
    fi ;;
esac
command -v node >/dev/null 2>&1 || { printf '{}'; exit 0; }
OUT=$(printf '%s' "$IN" | node "$(dirname "$0")/economy.mjs" 2>/dev/null) || OUT='{}'
printf '%s' "${OUT:-{\}}"
