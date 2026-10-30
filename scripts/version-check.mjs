// grimoire · every change that ships bumps the plugin version. Projects install releases only, so
// work merged without a bump never reaches them (it once sat on main under "Unreleased"). Read by
// the drift check (group 6): the CHANGELOG's top entry is always the plugin's version, and, given a
// base ref (CI on a pull request, the pre-push hook), a change outside the paths below needs a
// version higher than the base's.
import { spawnSync } from 'node:child_process'

// Paths whose changes ship nothing to a project: the repo's own docs and its CI.
export const NO_RELEASE = ['docs/', '.github/']

const parts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0)
/** Is version `a` higher than `b`, compared numerically part by part? */
export function newer(a, b) {
  const x = parts(a), y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

/** The problems, as lines: [] when the version is right for this change. */
export function versionVerdict({ version, changelogTop, baseVersion = null, changed = [] }) {
  const problems = []
  if (!changelogTop) problems.push(`CHANGELOG.md: no "## <version>" entry; the top one must be "## ${version} — …"`)
  else if (!changelogTop.startsWith(`## ${version} `) && changelogTop !== `## ${version}`)
    problems.push(`CHANGELOG.md: the top entry is "${changelogTop}"; it must be "## ${version} — …", the version in .claude-plugin/plugin.json (a change ships with its version)`)
  const shipped = changed.filter((f) => !NO_RELEASE.some((p) => f.startsWith(p)))
  if (baseVersion !== null && shipped.length && !newer(version, baseVersion))
    problems.push(`.claude-plugin/plugin.json: version ${version} ${version === baseVersion ? "is the base's" : `is not higher than the base's ${baseVersion}`}; this change touches ${shipped[0]}, so it needs a higher version (and its CHANGELOG.md entry)`)
  return problems
}

/** The base's plugin version and the files changed since the merge base, or null when `base` does not resolve. */
export function againstBase(root, base) {
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' })
  if (git('rev-parse', '--verify', '-q', `${base}^{commit}`).status !== 0) return null
  const show = git('show', `${base}:.claude-plugin/plugin.json`)
  if (show.status !== 0) return null
  let baseVersion
  try { baseVersion = JSON.parse(show.stdout).version } catch { return null }
  const diff = git('diff', '--name-only', `${base}...HEAD`)
  if (diff.status !== 0) return null
  return { baseVersion, changed: diff.stdout.split('\n').filter(Boolean) }
}
