// grimoire · economy · paths: where the economy's local state lives. `.grimoire/economy/` in the
// project's main checkout, so a loop's worktree lanes and the main session share what is learned
// (the way project-config.mjs resolves the config). No git subprocess: the hook runs on every call.
import { join, resolve } from 'node:path'
import { mainCheckout } from '../project-config.mjs'

/** The project root a hook runs for: $CLAUDE_PROJECT_DIR, else the payload's cwd, else the process cwd. */
export const projectRoot = ({ env = process.env, cwd = null } = {}) => resolve(env.CLAUDE_PROJECT_DIR || cwd || process.cwd())

/** `<main checkout of root>/.grimoire/economy`. */
export function economyDir(root) {
  const r = resolve(root)
  return join(mainCheckout(r) ?? r, '.grimoire', 'economy')
}
