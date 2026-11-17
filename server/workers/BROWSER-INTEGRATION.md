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

## Controller browser journal adapter

browser-dispatch.mjs maps controller-approved browser tool identities to the fixed worker service client. It uses the same durable invocation table as connected tools, passes the current lease from the journal executor to the trusted service callback, and uses the invocation ID for the service operation ID. A completed retry returns its saved result; changed arguments fail. A lost browser reply marks the invocation uncertain and cancels further dispatch for that job, including calls with new IDs. Denied calls never reach the worker.

Four adapter regressions cover pinned lease forwarding, duplicate click replay, argument conflicts, foreign leases, denial, catalog operations and lost-reply containment. These use a synthetic service callback, not a real browser. This adapter is not wired into app startup or the browser catalog. Existing approval policy, egress configuration and viewer/control routing still need integration before advertising browserMcp.

The service-browser-qualification fixture now uses this adapter for real MCP initialize/catalog/open/snapshot operations over pinned mTLS. Across four synthetic-native jobs in two container launches, each open replay returns from the controller journal without an extra service dispatch, and changed arguments fail before dispatch. Each round records eight upstream browser requests, matching four operations for each of its two jobs. The immutable fixture image is sha256:afbdaadaee00c75d03c1e8a071d1ea16847e52cb507a7adccb9f820aa346857a. Both rounds pass independent process shutdown inspection, and the fixture removes its persistent volume. This still uses a synthetic authorization callback; it does not qualify the app approval UI or browser network policy.

## Shared browser tool validation and approvals

mountChatTools accepts an optional controller-owned browser transport for the built-in browser descriptor. It retains the existing schema validator, tool scopes, model tool names, result handling and approval views. Other configured integrations continue using their normal clients. A transport without an enabled built-in browser mount fails before launch. No startup path supplies this option yet.

Three focused regressions verify scoped catalog filtering, schema rejection, no controller-browser process launch, close-once behavior and the actual createControllerToolSession Ask flow. An unapproved click reaches no transport call; a foreign-thread answer fails; one approved dispatch consumes its ticket; a denied call does not execute. The transport fixture is synthetic. The normal app, worker service readiness ordering and viewer/network policy still need integration.

## Pinned browser MCP transport

browser-mcp-transport.mjs binds the shared browser tool mount to a controller-selected worker client and copied current lease. It initializes and caches one catalog, checks current ownership before and after each service response, serializes operations, refuses unlisted tools and poisons the mount on an unknown service outcome. Closing the mount does not stop the service or release its resource lease. The coordinator durable tool executor remains responsible for approvals and operation receipts.

Four transport regressions and the shared browser mount/controller Ask test pass. The real offline service fixture now composes this transport with durable dispatch across four jobs and two container launches. Image sha256:b9713b16bda89f32ad960e354648a91034d22e66ab113c5e759140b6dda682ba records eight upstream browser requests per round, saved-result replay, changed-argument refusal, persistent volume replacement and verified process shutdown. No real credentials or model calls participate. The full worker suite passes196tests with three Windows platform skips; server typecheck passes. App startup still needs lazy catalog mounting after the native worker starts, plus network and viewer/control integration.

## Lazy coordinator mounting

openAccountScopedWorkerTools accepts a trusted browserTransport option and defers mounting that session until the worker requests its catalog. The coordinator can start the native service first, so browser initialize reaches an active worker job. The worker mount drops localComputer even when the input contains that descriptor. Existing non-browser sessions keep their eager startup path. No normal startup path supplies browserTransport yet.

The coordinator regression uses the actual scoped mount and controller approval session. It asserts zero catalog mounts before host execution, then lists the scoped browser tool, approves one click, replays its durable result and closes the transport once. The fixture gives both controller browser and host computer descriptors nonexistent commands; neither launches. Four lazy-session tests cover single initialization, unused close, revocation during mount and close racing initialization. Full worker suite201pass/3Windows skips and server typecheck pass. Real app/service composition, network egress and viewer/control integration remain pending.

## Worker network gate

The browser executor now configures a worker-local BrowserEgress with the existing self-hosted server policy and empty local-network allow settings. It opens a root-owned SOCKS gate and passes the shared gateChromeSettings proxy, bypass and Chrome flags through the explicit browser environment. Each result includes any blocked-site notice. Shutdown closes the gate after the browser client. This does not yet import controller-specific site allowances or lent-device routing; those require an explicit scoped policy contract. Browser capability remains disabled in normal startup.

The actual browser service fixture tries to navigate to a disposable HTTP trap on worker loopback. Across four jobs the trap receives zero requests and each result includes the gate refusal notice. Browser initialize/open/snapshot, durable replay, changed-argument refusal and clean replacement still pass. Image sha256:dd2fc531486fb27fe818d73f6ccf0f34c5a93b0a28ca85e687fc02d364016e0a records this run. The existing gate/policy suites pass76tests; server typecheck and worker bundle pass. No external navigation, real login, provider call or production change participates. This establishes the Chromium network gate for the browser path, not general network confinement of coding processes that share its worker UID.

## Service coordinator browser selection

createServiceWorkerCoordinator accepts an explicit trusted browserWorkers list. It validates those IDs against the fixed assignments, requires each pinned service client to expose browser operations and copies that callback before use. Only selected workers receive a current-lease browser transport when the controller opens their scoped tools. Other workers keep their existing tool path. The operator startup schema does not accept this option yet, and provider browser capability remains disabled until app/viewer qualification.

The service coordinator regression composes the lazy scoped mount, pinned service transport, actual controller Ask session and durable executor. It verifies no catalog request before service execution, one approved tool dispatch, saved-result replay and completion only after the service stop check. Mutating the caller's client registry cannot replace the pinned browser callback. Unknown browser worker IDs and missing browser service methods fail configuration. This fixture uses synthetic service callbacks, not a real app deployment. Full worker suite203pass/3Windows skips and server typecheck pass.
