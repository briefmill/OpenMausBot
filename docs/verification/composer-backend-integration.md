# Composer backend integration

`server/reply/backend.ts` owns the persistent draft store and its authenticated HTTP route as one integration unit. The main server uses this same factory. The server build also emits the self-contained ESM artifact `dist-server/reply/backend.js`, so a separately maintained runtime can integrate the same code rather than copying an entire server over its permission fixes.

The host supplies its existing persistent workspace directory, visibility checks, delivery adapter, selected-mailbox provider and signature callbacks. Register the returned route in the existing authenticated route table and use the returned store for the internal draft-creation handler. Preserve the host's active capability validation, direct-conversation ownership, attachment confinement, mailbox access and immutable Slack destination checks. The factory alone does not install the internal `prepare_reply` tool or those host bindings.

Do not replace production's repaired index, launcher, helper, custom extensions or data directory to install this artifact. Inspect the exact repaired production bundle, qualify the hook locations and hashes, and test the combined runtime before promotion. A missing draft with a valid UUID must return `Draft not found`, while a missing route returns `no route`; arbitrary non-UUID paths are not a valid compatibility probe.

Validation covers persistent draft readback across factory recreation, human-only Send, reviewed-content hashing, delivery state persistence, and importing the built standalone artifact. Existing route/store/Slack tests remain required, followed by the isolated full composer fixture. No live email or Slack send is needed for these checks.
