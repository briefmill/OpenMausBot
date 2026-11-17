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

## Profile persistence primitive

The browser-profile-check.mjs fixture runs two separate restricted containers with a single disposable named volume. The first browser opens a container-loopback page and stores a synthetic localStorage checkpoint in its explicit AGENT_BROWSER_PROFILE. The second container opens the same origin and retrieves the checkpoint. Both run as UID1000 with no external network and all capabilities dropped; the fixture removes its volume. browser-profile-proof.json records the immutable image and successful match. This establishes browser profile persistence across clean container replacement, not real sign-in persistence, crash recovery, identity-bound production volume wiring, shared-account safety or app routing.

## Disabled transport route

service-transport.mjs now accepts an optional trusted browser callback and a pinned-controller POST /v1/jobs/:id/browser route. Without the callback it returns503. Before dispatch it requires the exact active job/generation/lease token, a running supervisor journal and fresh controller lease authorization. It permits only initialize, tools/list and tools/call requests, bounds invocation and result size, retires invocation IDs and refuses parallel operations in the same active slot. It checks current ownership again before returning a result. The callback must run a supervised worker browser. The opt-in version3 service now supplies this backend; ordinary service configurations keep the route unavailable.

The mTLS browser-route test passes on Windows and actual offline Linux. It covers no active job, wrong token/generation, duplicate invocation, parallel-call refusal, revoked authorization and post-settlement refusal. The Windows worker suite passes188tests with three Linux-only skips; server typecheck passes. This transport is not a browser executor, durable operation journal, app routing or viewer integration. Caller integration must pass approved operations through the controller durable tool journal; an unknown outcome must retain authority rather than retry under a new ID.

## Browser executor primitive

browser-executor.mjs now reuses ChatMcpClient behind setpriv, with an explicit empty inherited environment and a fixed worker-owned HOME/profile. It verifies root-owned executable files and the assigned workspace, checks worker assignment and lease identity, rejects foreign session/profile targets, serializes operations and retains a poisoned state after an uncertain MCP failure. It does not grant approvals, expose a listener or certify shutdown. Service lifecycle wiring, egress policy injection and controller durable-journal integration remain work.

The real offline Linux fixture initializes the MCP, opens about:blank and captures a snapshot. It rejects a foreign bot assignment and session, then inspects14 UID1000 processes: effective capabilities zero, no-new-privileges set, and a synthetic parent RAILWAY_TOKEN marker absent. A fixture-only root SYS_PTRACE capability permits environment inspection inside the disposable PID namespace; browser children still drop all capabilities. It is not a production worker requirement. Evidence and repeatable runner: provider-runtime/browser-executor-proof.json and browser-executor-run.mjs. Three focused MCP environment regressions and the real native-driver relay fixture pass. No real credentials, model calls or hosted changes participate.

## Version-3 service lifecycle

The standalone service now accepts an explicit version3 configuration: version2 persistent storage fields plus a browser object containing binaryPath and chromePath. Older versions remain browser-disabled. service-host constructs the backend from verified storage and the fixed assignment, closes it before supervisor stop, and refuses verified settlement if the backend reports an uncertain outcome. The package includes the bundled browser backend; app browser capability remains disabled.

The offline service-browser-qualification fixture passes two clean container launches over one identity-bound volume, two sequential synthetic-native jobs per launch, pinned mTLS browser initialize/catalog/open/snapshot, duplicate and post-stop refusal, unprotected-config refusal and prior-generation replay refusal after replacement. Each job passes the supervisor's UID process shutdown inspection. The fixture uses1CPU/1GiB memory/256PIDs/512MiB shared memory as limits, not measured requirements. No real model runs or accounts participate. proof.json and repeatable run.mjs live under the evidence root's service-browser-qualification folder. Full backup/restore, app routing and egress injection remain unqualified.

The opt-in service passes a trusted shutdown callback to the MCP client. That callback uses the existing UID supervisor, avoiding a root signal attempt that lacks permission under the minimal capability set. The repeated four-job fixture records no fallback shutdown warning; its two container rounds took5046ms and4327ms. The root retains SETUID, SETGID, SETPCAP and CHOWN only. The service still requires an independent empty-UID process inspection before settlement. Default MCP clients retain their existing shutdown path. A focused regression verifies that the callback runs once across repeated close calls.
