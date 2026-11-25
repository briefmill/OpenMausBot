# Production permission repair — November 23, 2026

## Verified cause

Production starts `/data/permission-fix-20261119/bootstrap.mjs`, which restores an independently qualified runtime on every restart. A normal source build does not replace that package. Its loaded read/Brain policy:

- forces all individual and room turns into Ask mode;
- enables strict native approvals, removing persistent provider grants;
- supplies a policy verdict before the Full Access branch;
- forces connector review and disables the existing Full Access send shortcut.

Consequently a saved Full Access setting still produces `no-grant` for browser and native tools outside the policy. This was reproduced with a native Read in Atlas's diagnostic conversation. Delegation to BVS Website Builder returned a real blocker: `bwrap: Creating new namespace failed: Permission denied`.

Qualified candidate SHA256: `d47069b68af1e12afd308e3cfca2aa8ce1a33aadc003b5dcfa15c07bf2e07994`.
Loaded provider helper SHA256: `ba8c32d81d249f93e0fa1aa482958be7b1dfe6fee2ac0a78e2e5dd871ccd9b01`.

## Repair

`scripts/repair-production-full-access.mjs` changes six exact hooks in that candidate. Full Access follows the existing live permission and connector checks; non-Full policy behavior, questions, guest/API/proactive confinement, account bindings, and custom extensions remain in place.

The launcher copies the original package to `/data/permission-fix-20261123-full-access`, changes only the candidate, bootstrap root, and candidate hash in the copied manifest, then runs the copied bootstrap. The original archives, UI checks and extension checks still execute. Original package and persistent bot/browser data are not rewritten. A different runtime hash, missing/duplicate hook, or drifted repair package is refused.

Production in-memory preflight matched all six hooks exactly once and passed Node syntax checking, without writing files. Resulting candidate SHA256: `bfc5cf8deafd3f6296ce31835cb96b02f0c231d04517103d2b4dead0ea4d7431`.

Four isolated tests cover Full execution and revocation, questions/confinement/non-Full behavior, patch qualification failures, and preparation/reuse/integrity of a separate package. The package test requires subprocess execution for Node syntax checks.

## Settings already applied and read back

All 49 current bots and their existing threads have Full Access saved through the normal settings API. No tool scopes, MCP configurations, browser profiles, or SOUL content were changed.

BVS defaults and selected conversations: eight Claude Sonnet 5.5 bots and six Codex GPT-5.6-sol bots; Atlas uses Claude Sonnet 5.5. Historical explicit model overrides were not bulk rewritten. The CLI's multi-thread model setter now pins the active conversation.

## Deployment and production verification

The repair is deployed in Railway production deployment `69d87f1d-e451-4f63-b5ee-92f34e6a28f1` (SUCCESS, November 23, 17:45 UTC). Its effective deployment metadata contains the reviewed launcher. The repaired package exists on the production volume.

Important Railway distinction: ordinary `deploymentRedeploy` initially reused the previous launch snapshot, producing healthy deployment `a761f4b2-afc7-4ac1-ad0b-643cf5d759b8` with the **old** start command. Live verification caught this; it was not accepted as a repair. Applying the saved service configuration with `serviceInstanceDeployV2(environmentId, serviceId)` produced the correct deployment. Check `meta.serviceManifest.deploy.startCommand`, not just service configuration or deployment health. Rollback means restoring `/usr/bin/tini -s -- node /data/permission-fix-20261119/bootstrap.mjs` in service settings and applying that configuration with `serviceInstanceDeployV2`; the original package is preserved.

Verified after the correct deployment:

- All 49 bot defaults and all 2,323 existing threads read back as Full Access. All 14 BVS default/selected model assignments and Atlas's Claude assignment persisted through restart.
- Atlas wrote its harmless marker with native Write and read it with native Read.
- Atlas delegated to BVS Website Builder on Codex. The specialist edited its own memory marker and read back the exact 36-byte value through its shell, with no permission prompt or `bwrap` failure. One newline-related patch attempt failed; the specialist corrected it and verified the final bytes.
- The specialist's result returned automatically to Atlas. Atlas independently read the specialist's marker and reported the actual verified outcome.
- Post-deployment permission-card count was **zero** in the Chief, specialist and GHL verification conversations. Browser tabs/snapshots, native file tools and Codex shell calls executed.
- GHL's existing saved profile was signed into the BVS agency after restart, with the application sidebar/profile menu visible and no login/2FA prompt. An initial page-load wait timed out; the subsequent snapshot showed the app loaded. Some dashboard integration widgets reported expired connections; those are separate from browser sign-in and were not modified.

Marker files are `memory/diagnostic-permission-persistence-20261123.md` inside each bot's own workspace: Atlas `49f430fb-e91e-4a02-8efe-06a9f5ef9d44` and Website Builder `3a3f358f-7145-4507-a91e-05f644cdf644`. Exact values are `MAUS-CLAUDE-PERSISTENCE-20261123-BFC5` and `MAUS-CODEX-PERSISTENCE-20261123-BFC5`. They are diagnostic files, not shared Brain/client records. Production memory was verified through write/readback and cross-provider result verification; a further production restart after writing these markers was not performed because real client work had resumed. Isolated memory-capture restart coverage passed separately.

No client communications, publishing, ad spending, credential changes or merged browser profiles were used as verification. Existing client work resumed; it was not interrupted for an additional restart test. These checks establish the repaired permission/delegation path, not completion of every unrelated client assignment or health of every external integration.

Diagnostic Atlas conversation: `5e341e72-9e3f-4e37-8fe7-572442da336b`.
GHL work conversation: `75175fbf-ef89-4b31-afbc-8cb98a1df150`.
CLI session label: `Codex production repair CLI` (normal pairing, revocable from device settings). Credentials are outside the repository.

End-to-end Chief conversation: `3b5dc60b-5637-4dfe-b2c1-4c26616df099`.
Delegated Codex conversation: `abf5714a-43ae-4878-9401-a0375e684fa2`.
GHL browser verification conversation: `9cdad31b-c1e1-409e-90fa-99143678d649`.
