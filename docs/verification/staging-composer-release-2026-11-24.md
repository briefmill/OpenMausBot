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

## November 25 — connected OpenAI API

At the owner's request, validation switched to the existing OpenAI API connection (`openai/gpt-5.4-mini`), without requiring ChatGPT subscription login. Only the dedicated diagnostic bot's model changed. A separate diagnostic specialist was created in Release verification (`85611db5-afb5-4030-8eae-5529d727c3a5`); delegation has not yet passed.

The first run (`5f31d399-447f-4ed9-b26e-cfd19095fdef`) waited for server capacity with zero running and was stopped. Railway metrics showed approximately 0.559 GB used of a 2 GB limit. Disabling unused browser access only on the two diagnostic bots let a file-only retry reach the real model. That retry (`33581d67-de05-4f86-81f4-0af7114fce19`) called `agents_select_computer` and failed because This computer was unavailable, not because of provider authentication. No file write/read succeeded. A built-in memory-only retry (`95d69925-d5b0-4344-9588-21b7342a88a8`) again waited on capacity and was stopped. These are failed checks, not promotion evidence. Exports are under `/tmp/mausbot-openai-{live-check,file-only,memory}-20261125`.

Investigate staging admission/resource waits and qualify a supported tool path before restarting live delegation verification. Do not disable resource guards or infer permission persistence from a model response. Production remains unchanged.

## UI-only promotion compatibility check

An authenticated read-only probe on November 25 returned HTTP 404 with `no route: GET /api/reply-drafts/release-contract-probe-20261125` from production. This is a missing route, not a missing draft response. The staging composer polls `/api/reply-drafts/:id` and needs its save/discard/send contracts. Therefore copying the current UI onto the unchanged production runtime cannot release the composer successfully. Integrate its backend into the repaired custom runtime and qualify that combined artifact; do not replace the repair with an ordinary source build.

The same read-only check confirmed all 49 production bot defaults still have `approvalMode: full`. Railway's saved production configuration still uses the scoped November 23 repair launcher and has no staged changes. This verifies saved configuration/defaults only, not every thread or effective runtime file hash.

The isolated composer fixture was rerun successfully, then extended and rerun successfully with explicit assertions that the reply body is transparent while idle and opaque when focused. Editing, auto-resizing, signature rendering, social branding, disabled unsupported Send, and durable draft changes passed. No production deployment or client message was performed.
