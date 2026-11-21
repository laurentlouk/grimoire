#!/usr/bin/env bash
# grimoire · SessionStart live pointer. Writes the plugin's absolute root, one line, to
# <project>/.grimoire/live/plugin-root, so a live view drawn in Claude Code finds
# <plugin root>/scripts/live.mjs (the snapshot it runs every few seconds). Only in a project grimoire
# already writes to (its .grimoire/ exists: a run, a briefing, a graph; for a linked git worktree,
# its own or its main checkout's); never in $HOME or /, never when the project is the plugin
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
  # A linked git worktree's state lives in its main checkout (scripts/project-config.mjs mainCheckout:
  # the worktree's .git file names its git dir, whose commondir names the shared .git): grimoire
  # writes there, so its .grimoire/ is what says the project is grimoire's. The pointer still goes
  # in the worktree's own .grimoire/live/: a view reads <its cwd>/.grimoire/live/plugin-root.
  main=""
  if [ -f "$proj/.git" ]; then
    gd="$(sed -n 's/^gitdir: *//p' "$proj/.git" | head -n 1)"
    case "$gd" in "") ;; /*) ;; *) gd="$proj/$gd" ;; esac
    if [ -n "$gd" ] && [ -f "$gd/commondir" ]; then
      cd_="$(head -n 1 "$gd/commondir")"
      case "$cd_" in /*) ;; *) cd_="$gd/$cd_" ;; esac
      common="$(cd "$cd_" 2>/dev/null && pwd -P)"
      [ "${common##*/}" = ".git" ] && main="${common%/.git}"
      [ "$main" = "$proj" ] && main=""
    fi
  fi
  [ -d "$proj/.grimoire" ] || { [ -n "$main" ] && [ -d "$main/.grimoire" ]; } || exit 0
  dir="$proj/.grimoire/live"
  mkdir -p "$dir" || exit 0
  [ "$(cat "$dir/plugin-root" 2>/dev/null)" = "$plugin" ] && exit 0
  tmp="$dir/.plugin-root.$$"
  printf '%s\n' "$plugin" >"$tmp" && mv -f "$tmp" "$dir/plugin-root" || rm -f "$tmp"
} >/dev/null 2>&1
exit 0
