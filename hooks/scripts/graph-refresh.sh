#!/usr/bin/env bash
# grimoire · SubagentStop hook: refresh the code graph after an agent finished (an implementer's
# commit, an integrate merge). Deterministic script, no model: tools/graph/graph.mjs refresh, which
# is incremental, seeds a worktree from the main checkout and holds a lock so indexers never
# overlap. Registered async, so the session never waits on it; fails open (no node → exit 0).
command -v node >/dev/null 2>&1 || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
node --no-warnings "$(dirname "$0")/../../tools/graph/graph.mjs" refresh --root "$root" >/dev/null 2>&1
exit 0
