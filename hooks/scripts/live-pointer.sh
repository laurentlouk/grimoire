#!/usr/bin/env bash
# grimoire · SessionStart live pointer. Writes the plugin's absolute root, one line, to
# <project>/.grimoire/live/plugin-root, so a live view drawn in Claude Code finds
# <plugin root>/scripts/live.mjs (the snapshot it runs every few seconds). Only in a project grimoire
# already writes to (its .grimoire/ exists: a run, a briefing, a graph); never in $HOME or /, never when the project is the plugin
# folder or inside it. The file is rewritten only when the path changed, whole (a temp file
# renamed). Silent, and fails open: any error is exit 0 with no output.
{
  root="${CLAUDE_PROJECT_DIR:-$PWD}"
  plugin="$(cd "${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/../..}" 2>/dev/null && pwd -P)" || exit 0
  proj="$(cd "$root" 2>/dev/null && pwd -P)" || exit 0
  [ -n "$plugin" ] && [ -n "$proj" ] && [ -f "$plugin/scripts/live.mjs" ] || exit 0
  [ "$proj" = "/" ] && exit 0
  home="$(cd "${HOME:-/nonexistent}" 2>/dev/null && pwd -P)"
  [ -n "$home" ] && [ "$proj" = "$home" ] && exit 0
  case "$proj/" in "$plugin"/*) exit 0 ;; esac
  [ -d "$proj/.grimoire" ] || exit 0
  dir="$proj/.grimoire/live"
  mkdir -p "$dir" || exit 0
  [ "$(cat "$dir/plugin-root" 2>/dev/null)" = "$plugin" ] && exit 0
  tmp="$dir/.plugin-root.$$"
  printf '%s\n' "$plugin" >"$tmp" && mv -f "$tmp" "$dir/plugin-root" || rm -f "$tmp"
} >/dev/null 2>&1
exit 0
