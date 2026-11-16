# Isolated worker candidate

This directory contains an opt-in provider driver factory, controller adapter, durable job ledger, assignment planner, dispatcher and authenticated transport candidate. The app entry point does not register it. Existing provider configuration stays unchanged.

The trusted host supplies pool catalogs, adapter creation, health checks and bot assignments. User configuration selects an approved pool identity. Bot prompts cannot select worker resources. Saved grants stay with the controller; workers receive one-time decisions. HTTP artifact upload cannot release resources. The trusted host must verify shutdown before settlement.

Run the focused checks from the repository root:

```powershell
node --test server/workers/*.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.server.json --pretty false
```

The TLS tests require OpenSSL on PATH. Tests use synthetic providers and temporary data. They do not establish remote deployment or real model throughput.

The external local qualification harness lives at C:/Users/lL0xt/OneDrive/Documents/ManusBot/worker-execution-candidate. It verifies eight scripted bots through an isolated captured controller, approval cards, separate desktops and retained chat outputs. Those receipts qualify the candidate boundaries, not this worktree as a deployable release.

Remaining integration: reviewed controller bootstrap, remote host transport, per-worker provider runtime and scoped integrations, durable production workspaces, interruption reconciliation, packaging and deployment acceptance. Do not expose a management socket to workers or claim 34-worker capacity from synthetic lease tests.
