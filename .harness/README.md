# .harness/

What grimoire's agents are allowed to do, in a form a tool can check. Nothing reads it at runtime.

| File | What |
| --- | --- |
| `mcp-policy.json` | The MCP policy: only the `graph` server is approved, everything else is denied; the dangerous patterns; the scope of the graph server's shell, network and file writes. |
| `manifest.json` | Generated. A sha256 of each file that decides what an agent may do: the policy, `.mcp.json`, `hooks/hooks.json` and the guard. |

The graph server needs shell, network and file writes to build its index (`git`, a one-time `npm ci`, `.grimoire/graph/`); every query tool is read-only. Each call is logged to `.grimoire/graph/calls.jsonl`. The dangerous patterns are enforced by the guard hook (`hooks/scripts/guard.mjs`).

After changing any of those files, or the plugin version, run `npm run harness:manifest`. `npm run check` fails in CI when the manifest is stale or the policy loses `defaultDeny`, `auditLog` or `requireApprovalForDangerous`.
