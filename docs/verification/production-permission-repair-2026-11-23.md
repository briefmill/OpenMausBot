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

## Deployment and verification still required

At the time this note was added, the qualified production runtime repair had **not been deployed**. Apply the launcher as the production start command and redeploy. Rollback is restoring `/usr/bin/tini -s -- node /data/permission-fix-20261119/bootstrap.mjs` and redeploying; the original package is preserved.

Do not claim completion from health alone. Verify fresh read/write/readback of a harmless bot memory marker, a bounded Chief → specialist → Chief check on both providers, no repeated approval cards, settings persistence after restart, and the GHL profile's signed-in state. Do not send client messages, publish, spend money, expose pairing tokens, or merge client browser profiles as verification.

Diagnostic Atlas conversation: `5e341e72-9e3f-4e37-8fe7-572442da336b`.
GHL work conversation: `75175fbf-ef89-4b31-afbc-8cb98a1df150`.
CLI session label: `Codex production repair CLI` (normal pairing, revocable from device settings). Credentials are outside the repository.
