# Staging composer release — November 24

## Deployed and observed

- Staging service: mausbot-staging, environment staging, existing /data volume retained.
- Deployment: d1d421c5-712d-4992-b1e9-e2275fe1c346, Railway SUCCESS.
- Candidate source: 48c4e86fdd5a7ef48c7c4fcf172d7d315b943bc3.
- Effective configured launcher: node /app/railway/start.mjs. The wrapper refuses a non-staging service ID.
- Health and root page returned HTTP 200.
- Served entry JS, styles entry JS and CSS matched the built local files by SHA256.
- Reloaded the existing composer preview in the browser: Gmail, Slack and Instagram cards rendered, copied inbound context and saved example signature remained visible, and synthetic Send remained disabled.
- Slack reply body computed background was transparent at rest and rgb(41, 41, 41) with keyboard focus. No message text changed or sent during this check.

Builds: client Vite build, server TypeScript build, server bundles, and preview seed bundle passed. Existing bundler warnings remain. Targeted composer tests passed (25). Isolated composer fixture passed. Permission repair and promotion gate tests passed (8). Isolated Full Access defaults, Full Access workflows and memory-capture restart fixtures passed (3).

## Production promotion is not yet qualified

Production remains on the November 23 repaired runtime. This candidate is not yet authorized by a complete promotion receipt: current staging uses simulated engines and does not establish the live Claude/Codex delegation path, loaded production helper/custom-extension identity, or deployed post-restart browser and memory readback. Isolated tests are not replacements for those live observations.

The production bootstrap restores a separately qualified package. Do not overwrite it with this source build or reuse its volume configuration merely because staging health is green. Qualify the combined runtime and preserve a rollback package before promotion. The new preflight is an evidence validator invoked by the release operator, not an installed Railway deployment hook.

Gmail OAuth delivery, authenticated provider signature retrieval, social delivery, and the deployed Front Desk edit/sender contract remain unfinished. The release does not claim those integrations or the remaining BVS bot setup are complete.
