# Isolated worker candidate

This directory contains an opt-in provider driver factory, controller adapter, durable job ledger, assignment planner, dispatcher and authenticated transport candidate. The app entry point does not register it. Existing provider configuration stays unchanged.

The trusted host supplies pool catalogs, health checks, admission, launch/execute/stop inspection callbacks and bot assignments. coordinator.mjs joins those callbacks to planning, adapter events, one-time permissions and dispatcher settlement. User configuration selects an approved pool identity. Bot prompts cannot select worker resources. Saved grants stay with the controller; workers receive one-time decisions. HTTP artifact upload cannot release resources. The trusted host must verify shutdown before settlement.

Run the focused checks from the repository root:

```powershell
node --test server/workers/*.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.server.json --pretty false
```

The TLS tests require OpenSSL on PATH. Tests use synthetic providers and temporary data. They do not establish remote deployment or real model throughput.

The external local qualification harness lives at C:/Users/lL0xt/OneDrive/Documents/ManusBot/worker-execution-candidate. It verifies eight scripted bots through an isolated captured controller, approval cards, separate desktops and retained chat outputs. Those receipts qualify the candidate boundaries, not this worktree as a deployable release.

Remaining integration: reviewed controller bootstrap, remote host transport, per-worker provider runtime and scoped integrations, durable production workspaces, interruption reconciliation, packaging and deployment acceptance. Do not expose a management socket to workers or claim 34-worker capacity from synthetic lease tests.

Coordinator checks cover fast permission acknowledgement followed by immediate job completion. The controller reads persisted acknowledgement before retiring its turn. Server typecheck and 67 focused tests pass. Remote host callbacks and app startup registration remain unimplemented.

Source-backed isolated HTTP run 9c4de33af556 passes eight bot messages, approval cards, overlapping desktop tasks and retained outputs using this coordinator and typed driver. The test host supplies synthetic admission and scripted work; real remote capacity and provider execution remain unverified.

Mutual-TLS clients require a SHA-256 server leaf-certificate pin in addition to CA and hostname verification. The transport rejects wrong or missing pins and does not accept caller TLS verification overrides. The 13 transport/client/TLS checks pass after this change. Remote routing remains loopback or an explicitly managed tunnel; no deployment credentials have been created.

The coordinator waits for an occupied assigned desktop with a cancellation signal instead of abandoning the queued turn. It starts only after host-verified resource release. Queued cancellation leaves the current owner untouched; cancellation before dispatch launches nothing. All 70 focused tests pass. Queue acceptance currently uses synthetic host callbacks, not a remote contention run.

The worker client accepts a controller-owned lease and verifies it through the scoped transport before provider dispatch. A durable first event reserves execution once per job generation; replay requires reconciliation rather than a second provider run. Forged and foreign leases fail before dispatch. All 71 focused tests pass, and the actual ClaudeDriver synthetic CLI fixture still passes with verified process shutdown. This does not yet supply the remote host implementation.

The controller can read ordered durable event pages through GET /v1/jobs/:id/events with x-after-seq. Pages contain at most 100 events and 1 MiB of stored event bodies. Worker credentials cannot read this endpoint. Cursor validation and pagination pass with the existing ledger/transport checks, 27 tests total. The worker event projection retains bounded assistant replies, terminal token totals and nullable cost. Raw protocol, tool arguments, tool results and reasoning text stay outside this stream. Idempotent publication into the app Store remains integration work.

The HTTP worker-client test retrieves the final assistant reply and terminal usage through the controller event reader. Unknown cost stays null; invalid metrics and replies requiring large-artifact delivery fail explicitly. All 74 focused tests pass. Large reply artifacts and remote app Store replay still need integration.

reply-store.mjs binds final remote replies to the actual Store command-receipt transaction. Its isolated Store test closes/reopens the message database and recovers the same message ID without a second copy. Changed event bodies, stale generations and foreign threads fail. Trusted bootstrap must supply redaction. The binder is not yet connected to remote event polling or the app event bus. Usage replay accounting remains separate work. The new Store test and server typecheck pass.

usage-book.mjs records one terminal usage receipt per job generation from matching durable event evidence. Reopen/replay returns the existing record, conflicting terminal values fail, and missing cost remains unpriced. Two focused tests pass. This ledger is not yet projected into the app spending counters; remote terminal events must not be replayed through additive counters without idempotent integration.

delivery-journal.mjs joins ordered worker events, actual Store reply receipts, terminal usage receipts and a durable cursor. Its isolated test forces cursor failure after reply save, closes both databases and recovers one reply and one usage record. It accepts the execution-marker frame and rejects foreign-thread publication without advancing the cursor. Four reply/usage/journal checks pass. The live remote receiver, app broadcasts and spending projections remain unwired.

Reply replay comparison applies the same built-in secret redaction as Store persistence. The actual Store test includes synthetic credential-shaped text and recovers its original scrubbed message rather than reporting a false conflict. Reply and delivery-journal tests pass. No live account or production data participates.

The remote-delivery integration test connects the authenticated loopback HTTP worker client to the actual Store and delivery journal. Reopening Store and rewinding the cursor leaves one persisted reply, one message notification, one usage record and one provider start. It retains the job lease until trusted host settlement. All 79 focused tests and the server typecheck pass. This test does not register the live receiver in app startup, project usage into Spending, or qualify an off-host network.
