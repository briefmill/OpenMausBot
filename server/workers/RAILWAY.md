# Railway worker deployment state

Updated November 16, 2026. This file describes the local candidate. No deployment approval follows from these checks.

## Architecture and ownership

One controller retains the Store, approval decisions and durable job ledger. Each initial worker gets a separate service, desktop identity and persistent workspace. The controller admits distinct bots concurrently while keeping exclusive ownership of each bot's desktop and workspace. Shared-room ordering remains separate.

service-controller.mjs connects fixed operator-selected service clients to the existing planner, event relay, permission ACKs and settlement gate. service-host.mjs combines the Linux supervisor, root-only execution journal, process client and authenticated endpoint. No task can select an endpoint, executable, credential or foreign workspace. Workers receive no management socket or Railway management credentials.

The Linux supervisor runs as root in an operator-confirmed dedicated PID namespace. It uses setpriv to clear groups and capabilities, switch worker UID and enable no-new-privileges. It checks that UID across /proc, including detached children, before releasing execution. Signal helpers run as the worker UID. The image needs Tini, setpriv and kill; the supervisor needs SETUID, SETGID and SETPCAP. Read-only inspection and a bounded UID-drop probe confirmed these capabilities on the running Railway controller at 21:41 UTC on November 16. This does not qualify a separate worker deployment or its host namespace boundary.

Cancellation before delivery creates a durable tombstone. Duplicate generations cannot execute again. An expired heartbeat, lost connection or unverified shutdown retains ownership for trusted reconciliation. Restart does not silently retry external actions. Controller workspace backups preserve destination worker authority and omit the host-bound ledger. Worker files and consumed-generation records survive container replacement in the named-volume fixture. Full backup/restore still needs acceptance.

## Durable tool relay candidate

The optional authenticated tool endpoint journals invocation IDs under the job and generation. Completed retries return the saved result. In-flight and unknown outcomes refuse repeat dispatch; the dispatcher keeps ownership even after verified worker shutdown and emits a hold notice. Controller-selected callbacks must authorize and execute each call. Without these callbacks, the endpoint returns unavailable.

Local tests cover parallel calls from separate bots, replay, cancellation, restart, foreign leases and uncertain outcomes. controller-tool-policy.mjs binds a controller-mounted ChatToolSession and the existing ChatToolApproval gate to one job identity. It validates tools, preserves canonical grant keys, applies the existing safety floor and requires a matching one-shot authorization before dispatch. The real approval gate plus durable executor test opens one card, dispatches once and reuses the saved result on replay. The worker suite has 163 passes and three Linux-only skips on Windows. This relay still needs the app's account-scoped MCP sessions, saved grants and separate send approvals. It does not yet provide connected-app tools to deployed native workers.

## Controller startup

OMB_WORKER_HOST_CONFIG selects an operator-owned JSON file outside bot-editable folders. Without it, worker startup stays inert. Version 1 retains Docker/SSH startup. Version 2 uses kind services and these exact keys:

| Key | Meaning |
| --- | --- |
| version | 2 |
| kind | services |
| maxRunning | Host admission policy, 1 through 64, not measured capacity |
| assignments | Fixed bot, project, pool, worker, desktop and workspace identities |
| pools | Host-approved model catalogs |
| services | Worker IDs mapped to pinned service endpoints |
| transport | Controller event listener and worker-role TLS configuration |

Each services entry contains origin, tokenFile, keyFile, certFile, caFile and serverPin. Credential paths are absolute. transport contains listenHost, advertisedHost, port, controllerTokenFile, workerTokenFiles and tls. Its tls object contains keyFile, certFile, caFile, controllerPin and workerPins. Remote endpoints require HTTPS, mutual TLS, certificate pins and hostname checks.

An explicit listenHost of :: enables dual-stack binding; advertisedHost remains a DNS name. IPv4 loopback and 0.0.0.0 remain supported. Startup refuses unresolved controller leases. Pool health currently proves authenticated endpoint connectivity, not model authentication or workload capacity.

## Worker package

Run node scripts/bundle-worker.mjs to create dist-worker. The native bootstrap bundles the real Claude and Codex drivers; the runtime modules need no node_modules. manifest.json records file hashes and exclusions. OMB_NATIVE_WORKER_CONFIG selects a read-only per-worker binding with version, driver, instance, assignment, input and controller. The controller entry contains origin, tokenFile, keyFile, certFile, caFile and serverPin. Ask mode, explicit tool scope and mcpFromUserConfig false remain mandatory.

The package now includes service-entry.mjs and the read-only health listener. Dockerfile.worker builds it from an explicitly selected base image; Dockerfile.worker.dockerignore allowlists only the recipe and named runtime files. The base must provide Node 24, Tini, setpriv and kill. A local qualification image builds and rejects missing configuration. Provider CLIs and a qualified production base remain absent; manifest productionReady stays false. Only Claude has runtime qualification. No production credentials belong in the build context or image.

## Verification evidence

Evidence root: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\.

| Evidence | Proven scope |
| --- | --- |
| linux-service-qualification\proof.json | Two service slots, 730 ms overlap, detached descendants stopped, worker UID/capability isolation |
| service-transport-qualification\proof.json | Composed pinned mTLS services, two sequential jobs each, 207 ms overlap |
| service-controller-qualification\proof.json | Real isolated controller lease/event transport, both permissions pending before answers, three allowed-once ACKs, separate reports and later thread |
| service-app-qualification\source-proof.json | Normal source-app provider registration, two approval cards, separate Store replies and terminal digests |
| service-app-qualification\packaged-proof.json | Same service path through packaged controller copied outside the repository |
| native-package-qualification\proof.json | Bundled real Claude driver, fake CLI, two separate threads, event receipt and verified shutdown, external network disabled |

All inference in these fixtures is synthetic. They establish neither real model authentication nor 34-worker throughput. The Windows worker suite has 144 passing tests and three Linux-only skips; those three ownership tests also pass in the Linux fixture; server typecheck and release build pass. Packaged smoke covers normal startup outside the source tree, proxy paths, CLI/MCP, backup worker, trust gate and desktop entry. Temporary containers, networks and certificates from the full-app fixtures were removed.

## Railway facts and open gates

[Private networking](https://docs.railway.com/networking/private-networking/how-it-works) supports named service endpoints within one environment. New environments have IPv4 and IPv6; legacy environments can be IPv6-only. The candidate retains mTLS role authentication over that private network.

[Volumes](https://docs.railway.com/volumes/reference) allow one volume per service and prohibit replicas on volume-backed services. Worker workspace and supervisor journal therefore need separate permission-protected directories within that service's volume. Redeploying a volume-backed service has downtime.

[Health checks](https://docs.railway.com/deployments/healthchecks) use PORT and the healthcheck.railway.app hostname. The separate read-only readiness listener serves GET /health without exposing execution routes or job details. Configure Railway PORT to match health.port in the protected worker config. The execution listener still requires client certificates. Railway health checks run at deployment, not as continuous monitoring.

Before hosted testing: qualify the production image/base, namespace/capabilities and durable volume ownership, and prepare a bounded two-worker staging configuration. Deployment, added resources, credential installation and paid tests require their applicable approvals. Before paid work, qualify the native tool/MCP proxy path, controller-owned permission decisions and business account routing. The fake-CLI package tests use no actual connected-app calls. Then test worker/controller interruption, reconciliation, volume restore and real read-only integration tasks. Increase capacity in measured steps with CPU, RAM, PID, queue, rate-limit and cost evidence. Do not claim 34-worker capacity before that acceptance.

## Standalone worker configuration

OMB_WORKER_SERVICE_CONFIG selects a root-owned regular JSON file with mode 0600. The entry opens it without following a symlink. Its exact fields are version, worker, assignment, file, bootstrapFile, cwd, environment, uid, deadlineMs, isolatedPidNamespace, controller, transport and health. version is 1. file is the journal inside a root-only directory. cwd is the worker-owned workspace. The controller object uses the native binding credential-path fields. transport contains listenHost, advertisedHost, port, controllerTokenFile and tls; tls contains keyFile, certFile, caFile and controllerPin. The incoming controller token and service private key require root-only files. health contains listenHost and port, separate from the execution port.

The child environment is explicit; Railway management variables, Docker endpoints, SSH agent sockets and controller startup variables are rejected. Set OMB_NATIVE_WORKER_CONFIG there to the worker's read-only native binding. The entry closes health, drains/stops execution and closes its controller client on SIGTERM. Readiness becomes unavailable when the execution journal contains uncertain ownership. It does not prove provider login or model capacity.

standalone-worker-qualification\proof.json verifies the packaged entry, rejection of an unprotected configuration, readiness, two real-Claude-driver/fake-CLI turns, controller lease checks, recorded events and graceful shutdown. External networking was disabled. image-proof.json records the local worker recipe build and missing-config rejection. These checks do not qualify Railway capabilities, the production base or Codex runtime.

## Persistent volume and supervisor recovery

service-storage.mjs binds an initialized volume to one bot, project, worker, desktop, workspace and UID. Initialization is an explicit trusted operator action on an empty volume. It writes a root-only binding marker, root-only authority directory and worker-owned workspace. Existing nonempty unbound data, foreign bindings and unsafe permissions are refused; initialization never re-owns existing data. An interrupted initialization remains blocked for review. The initializer needs CHOWN; the ordinary service does not initialize storage on startup.

Standalone configuration version 2 replaces file and cwd with storageRoot. Startup verifies the binding and derives authority/jobs.db and workspace under that root. Version 1 remains the path-based fixture format; use version 2 for persistent workers. Keep the root directory owned by root with no group/other write and enough traversal permission for the worker. Secrets and service configuration remain outside the worker-owned workspace.

Each file-backed service journal takes an exclusive SQLite lock in a separate supervisor-lock file before changing job state. A second supervisor cannot mark a live job uncertain or reuse its slot. The operating system releases the lock when a process dies; unfinished jobs become uncertain on reopen, keep their ownership and still require trusted stop reconciliation. Cancellation and completed-generation records persist.

service-volume-qualification\proof.json verifies named-volume ownership, private authority permissions, foreign-project refusal and checkpoint/consumed-generation persistence. persistent-entry-qualification\proof.json verifies two standalone container instances sharing one bound volume: four fresh real-Claude-driver/fake-CLI turns complete, old-generation replay is refused and the worker checkpoint survives. Both fixtures remove their volumes. The source crash test kills an actual disposable supervisor process and verifies lock release with uncertain ownership retained. These results do not establish encrypted backup restore, Railway volume locking behavior or production model authentication.

## Runtime preflight evidence

runtime-preflight.mjs reports Node/platform/UID, tool presence, selected capability bits, cgroup limits and namespace observations. Default mode only reads system metadata. The optional verify-privilege-drop probe executes a fixed Node program under UID 1000 with cleared capabilities/groups and no-new-privileges. Its signal-zero check only checks parent permissions. Neither mode reads environment values, credentials, process command lines or job data. Namespace IDs alone never mark host isolation verified.

Dockerfile.worker-preflight builds a small diagnostic image from a pinned official Linux-amd64 Node image and pinned Tini/util-linux/procps versions. Its allowlisted context contains three diagnostic modules. The service logs the report, serves read-only /health and exits after at most 120 seconds. Health means the probe completed, not that worker compatibility passed. Local tests prove tool availability, UID drop, deadline termination and graceful shutdown. The first slim-image check caught a missing kill binary; procps now supplies it.

The existing Railway controller was inspected through its established CLI connection without restarting it. At 21:41 UTC, it ran Node 24 as root with Tini and all required tools/capabilities; its limits were 1,000 PIDs, 8,000,000,000 memory bytes and 2 CPUs, with 50 PIDs observed during the diagnostic. The optional child probe passed UID/GID 1000, cleared groups/capabilities, no-new-privileges and root-parent protection. No provider calls, configuration writes or deployments occurred. This is prerequisite evidence, not an independent worker or 34-agent acceptance.

Evidence: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\railway-runtime-preflight\production-read-only-runtime.json, production-privilege-drop-runtime.json and proof.json. The existing concurrency-test service remained sleeping with no volume, variables or staged changes when inspected. It is still not an active agent pool.
