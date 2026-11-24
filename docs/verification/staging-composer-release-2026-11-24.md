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

## Live validation follow-up

The normal one-time pairing flow restored a scoped staging CLI session. The authenticated doctor reports version 0.1.166 and a healthy server. Model discovery reports `chatgpt` available, but that is not sufficient evidence of authenticated execution.

A dedicated staging-only bot, `Release validation Codex Nov24` (`ac31f8c4-a461-4ecf-922b-6b678e80768e`), attempted a native workspace marker write/read in thread `404781af-1371-43d0-a90c-4fcdd350efed`. The job failed with `provider_error` before either operation: “Codex isn't signed in on this computer. Sign in to Codex in Settings → AI → Providers, on Codex.” No external communication was requested or sent. Local evidence is in `/tmp/mausbot-codex-live-check-20261124`; it is not a passing promotion receipt.

The normal staging Settings → AI → ChatGPT plan flow confirms “Not signed in.” A device-code sign-in was prepared for the owner; no production credentials were copied. Once connected, rerun native write/read, then real delegation and deployed persistence checks. Claude remains unavailable too. Production has not been promoted. Model discovery/doctor readiness must not be used as a substitute for this execution check.
