# Composer backend integration

`server/reply/backend.ts` owns the persistent draft store and its authenticated HTTP route as one integration unit. The main server uses this same factory. The server build also emits the self-contained ESM artifact `dist-server/reply/backend.js`, so a separately maintained runtime can integrate the same code rather than copying an entire server over its permission fixes.

The host supplies its existing persistent workspace directory, visibility checks, delivery adapter, selected-mailbox provider and signature callbacks. Register the returned route in the existing authenticated route table and use the returned store for the internal draft-creation handler. Preserve the host's active capability validation, direct-conversation ownership, attachment confinement, mailbox access and immutable Slack destination checks. The factory alone does not install the internal `prepare_reply` tool or those host bindings.

Do not replace production's repaired index, launcher, helper, custom extensions or data directory to install this artifact. Inspect the exact repaired production bundle, qualify the hook locations and hashes, and test the combined runtime before promotion. A missing draft with a valid UUID must return `Draft not found`, while a missing route returns `no route`; arbitrary non-UUID paths are not a valid compatibility probe.

Validation covers persistent draft readback across factory recreation, human-only Send, reviewed-content hashing, delivery state persistence, and importing the built standalone artifact. Existing route/store/Slack tests remain required, followed by the isolated full composer fixture. No live email or Slack send is needed for these checks.

## November 25 candidate

Source `424ed0e2f` deployed to staging as `86df6059-c3f1-4096-b1db-33311a39f051` (Railway SUCCESS). `/api/health` returned HTTP 200 with `app: openmausbot`. The existing staging volume and launcher were retained. The standalone bundle imported successfully with no source checkout dependencies.

Passed: server TypeScript build, server bundles, preview seed build, 20 backend/route/store/Slack tests, 8 permission-repair/promotion tests, changed-module lint, and the isolated running composer fixture. These checks do not establish that the separately repaired production runtime has been integrated or that deployed real-model delegation and restart persistence have passed.

Read-only Railway shell access to the repaired production candidate was attempted with a 25-second timeout and did not connect. No production files, startup command or permission settings were changed. Obtain the exact candidate/bootstrap/manifest through the normal deployment access path before preparing its qualified integration; do not use the older local runtime snapshot as if it were current.

## SSH timeout diagnosis

Railway CLI 5.71.0's `ssh config --dry-run` resolved the active production instance normally. A bounded OpenSSH diagnostic established TCP, negotiated encryption, verified the known Railway host key, and reached public-key authentication. Railway explicitly accepted the existing `Briefmill Railway` key offered by the local agent; progress then stopped before authentication completed. The agent socket is the desktop GCR SSH agent. An independent `ssh-add -T` signing test using only the agent's public key also timed out after 10 seconds. Thus the immediate blocker is local agent signing, not a demonstrated container connectivity failure. A keyring unlock/confirmation prompt is possible but not yet observed. The owner was asked to check for it. No private key was read, new key registered, host verification disabled, agent restarted or production configuration changed.
