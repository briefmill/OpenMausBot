# Worker browser integration

Status: implementation plan, not an available capability. No hosted changes authorized.

## Existing execution boundary

server/host/browser.ts browserIntegration prepares a controller browser session and returns a controller-bound turnIntegration descriptor. That descriptor carries an internal browser capability bound to the bot, chat and generation. mounted-controller-tools.mjs passes computerUse=false, so neither the controller browser nor local computer bridge enters the worker relay. Keep this exclusion until an explicit worker execution target exists.

## Required implementation

1. Add a fixed worker browser target to the trusted assignment. Resolve it from the controller JobLedger lease and configured worker service, never from tool arguments, prompt URLs or a model-supplied origin.
2. Install the repository-pinned agent-browser and reviewed browser build in the worker image. Keep its binary and launcher root-owned. Run the browser and its profile as the dedicated worker UID. Store the profile in the identity-bound workspace; do not copy the controller profile or credentials.
3. Preserve the existing browser tool catalog, schemas, egress rules and controller approval checks. Route an approved operation to the assigned worker rather than executing the controller browser command. Check job, generation, assignment and lease before dispatch and before returning the result. The worker listener requires the pinned controller client identity.
4. Journal each browser invocation with a stable ID and argument digest. Replay a completed result for the same invocation. Refuse changed arguments and uncertain outcomes; do not restart an uncertain click, submission, upload or navigation under a new ID. Resource ownership remains held until independent browser/process shutdown verification.
5. Bind viewer frames, annotation capture and control ownership to the same worker session. Verify bot, chat and generation on view/control routes. Deny a foreign worker/session even when its URL or frame ID is known. Never put the management socket or controller service credentials in the browser process.
6. Advertise browserMcp only after the assigned worker reports this supported execution path and browser/profile readiness. A missing browser must produce an explicit unavailable result; it must not fall back to the controller desktop. Full desktop capability needs its own runtime and viewer qualification.

## Acceptance

Use the packaged app with two synthetic providers and two real worker browsers. Start independent pages and record overlapping activity, distinct PID namespaces, separate profiles and distinct screenshot receipts. Verify the normal bot UI can view and annotate the correct worker browser. Attempt a foreign session/control request and confirm refusal. Verify same-worker queuing and a different worker's continued progress. Then force browser/worker death, inspect uncertain outcomes, restart the service and verify consumed invocation IDs and saved profile state. Include controller and worker CPU, memory, PIDs and shared-memory peaks. Use no real sign-ins, sends or paid model turns for this fixture.

The earlier desktop-isolation fixtures prove scripted browser separation, not this app-to-worker path. Native/API worker pilots can proceed as a separate capability test after deployment approval; they do not satisfy browser/desktop acceptance.

## Runtime evidence

Dockerfile.worker-browser now builds on the provider image with Debian Chromium 156.0.8078.79 and agent-browser 0.37.0. Its build verifies the Linux x64 binary against repository digest 78e0c5a14a7fa1f3d1ae2acdbdcc94a047b435b998a8c505fcc49d7fa4935a49. Local image ID: sha256:fff48e02837c38915627d338e9ea4a482ac0a18442d7fda95ba3cdbfd02a2dcd.

The real MCP initializes, lists the expected tools, opens about:blank and returns a snapshot as UID1000 with all capabilities dropped, no-new-privileges, read-only root and no network. Writable HOME and /tmp use temporary filesystems. Evidence and repeatable fixture: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\provider-runtime\browser-mcp-proof.json and browser-mcp-check.mjs. This verifies the runtime primitive, not app routing, egress policy, durable profile storage, viewer/control integration or paid model use. Browser capability stays disabled in the app adapter.
