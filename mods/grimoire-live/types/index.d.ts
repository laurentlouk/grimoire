// grimoire-live · the values the mod keeps for the session, and the snapshot it draws them from.
// The snapshot is what `node <grimoire>/scripts/live.mjs --root <project>` prints (version 1):
// ids, counts, verdicts and models, never a ticket's text.

export type LiveTask = {
  task: string
  title: string | null
  step: string | null
  agent: string | null
  model: string | null
  round: number | null
  since: string | null
}

export type LiveEvent = { at: string | null; kind: string; task: string | null; text: string }

export type LiveRun = {
  id: string
  status: string
  haltReason: string | null
  startedAt: string | null
  updatedAt: string | null
  isStale: boolean
  tasks: { total: number; done: number; active: number; failed: number; blocked: number; queued: number }
  active: LiveTask[]
  recent: LiveEvent[]
  cost: { effective: number | null; maxCost: number | null; output: number | null; maxOutput: number | null; isCovered: boolean }
}

export type LiveBriefing = {
  line: string
  urgent: number | null
  ready: number | null
  isStale: boolean
  isPartial: boolean
  page: string | null
}

export type LiveWatch = {
  mode: string
  flags: { agent: string; reason: string; at: string | null }[]
}

export type LiveSnapshot = {
  version: number
  at: string
  root: string
  run: LiveRun | null
  briefing: LiveBriefing | null
  watch: LiveWatch | null
  errors: number
}

declare module 'claude-code' {
  interface PluginState {
    'grimoire-live': {
      snapshot: Shaped<LiveSnapshot | null>
      // why there is no snapshot (no grimoire in this project, no node, a script error), or null
      problem: string | null
      isBandHidden: boolean
    }
  }
}
