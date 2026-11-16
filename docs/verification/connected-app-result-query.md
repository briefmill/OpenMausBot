# Bounded results from connected apps in Claude

Claude's built-in Composio and own-app connections now use the existing result gate even when the bot has no explicit tool selection. The gate keeps the original server name and upstream bridge. It bounds large text results and advertises query_result for reading a selected portion of the held result. The query runs in the gate and does not call the original tool again.

An observed Inner Clip email run fetched an oversized Gmail thread, then tried a shell pipeline to read Claude's temporary overflow file. That file sits outside the bot's approved own-file roots. The shell approval timed out. This change avoids that overflow path for shaped connected-app results rather than broadening shell access.

The existing OMB_MCP_RESULT_BUDGET setting still applies; an explicit zero preserves untrimmed results. Existing tool selection continues to filter the mounted gate. Calls to upstream tools still reach the original application bridge and its account/approval checks. A query_result call reads data that the same gate already received. It cannot select another account, run a shell command or send mail.

## Verification

```sh
node node_modules/vitest/vitest.mjs run server/drivers/claude.test.ts -t 'MCP|connected-app|built-in connections|tool selection'
node node_modules/vitest/vitest.mjs run server/mcp-gate.test.ts server/mcp-gate-config.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
```

Sixteen driver tests and52gate/config tests passed. The actual driver with the fake Claude CLI records both built-in bridges behind an8,000character gate, preserves original bridge settings, retains tool selection, and honors an explicit zero budget. The process fixture for the gate retrieves a selected field from a large held result and records just one upstream execution. Oversized query answers remain bounded, and invalid handles do not reach the upstream server.

These fixtures use synthetic data and no paid models. They prove driver configuration and the existing gate's behavior, not that a live model chooses a query correctly in production. No shell permission, saved grant, account policy or model changed during preparation.

Held-result storage belongs to the live gate process and can expire or evict results. It is not durable cross-run task memory. A routine still needs its own checkpoint and processed-resource records to avoid repeated work after a restart. The fix does not recover an earlier expired result or repair a run that already timed out.

Staging integration, a packaged-controller check and an authorized live acceptance remain before release. Production remains unchanged.
