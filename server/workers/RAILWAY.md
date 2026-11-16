# Railway worker implementation boundary

Updated 2026-11-16. This is a local implementation plan, not deployment approval.

## Current evidence

Production has one openmausbot controller replica. mausbot-concurrency-test is sleeping and has no persistent volume. mausbot-render has no deployment. Neither service establishes an active agent pool. The controller's latest observed deployment is 804b0101-da6b-432e-ab86-fb4e77252ad0, SUCCESS. Its preceding failure e5111f79-acfd-4df2-810d-b40fbe12a16b reports Front Desk runtime drift and failed health checks. Do not label that failure PID exhaustion without further evidence.

The last-hour controller metrics at inspection show memory peak 5.94345984 GB and current 5.516374016 GB, CPU peak 1.70905375. Metrics do not establish a safe concurrency ceiling.

The candidate passes two concurrent synthetic workers through source and packaged app startup. Its current host launches and inspects containers through Docker. Railway-native worker services need another host adapter. Do not configure the Docker host candidate against a nonexistent Railway Docker daemon.

## Required service architecture

Keep one controller with the authoritative Store, approval decisions and durable job ledger. Give each initial worker a separate Railway service and persistent workspace volume. Pin its bot, project, desktop and worker identity in operator configuration. Use one admitted job per worker service initially. Keep shared-room ordering separate from independent direct-thread execution.

Workers connect over authenticated private transport. Railway private networking is a routing boundary, not permission to trust an arbitrary peer. Preserve the existing mutual TLS, bearer scope, hostname and certificate checks. Keep management credentials and service-management APIs out of workers and their writable workspaces.

Implement the execution service with a fixed operator-selected bootstrap, bounded task body, deadline, job generation and lease verification. A task cannot choose a command, model credential, executable path or another bot's workspace. Reject duplicate execution of a generation. Preserve controller-owned send approvals and account pins.

The worker supervisor must own the child process tree. Before acknowledging completion, cancellation or failure, stop descendants and verify the execution boundary is empty. Worker output alone cannot authorize ledger release. A lost connection or expired heartbeat keeps resources held as uncertain. Reconcile through a trusted host observation of the old service deployment/process boundary before reassignment. A restart must not silently retry a potentially completed external action.

Do not call Railway's management API for each bot turn. Persistent worker services should accept repeated sequential turns while different services overlap. Service replacement and controller reconciliation must fence old generations.

## Acceptance gates before deployment

1. Add Railway-service host adapter and execution service, including process-tree stop evidence and authenticated receipts.
2. Test two service-shaped workers with synthetic providers in isolated fixtures. Prove overlapping execution, separate workspace files, approval ACKs, duplicate refusal and independent completion.
3. Kill one worker during a turn. Prove the other continues and the controller holds uncertain resources until trusted reconciliation. Repeat with controller restart and delayed old-generation events.
4. Test worker-volume backup and restore separately from controller backup. Controller archives omit host-bound worker ledger state; they do not back up worker volumes.
5. Package images and prepare a reviewable staging configuration with explicit resource ceilings, two workers and no schedules. Obtain deployment and resource-cost approval before provisioning or changing services.
6. Run an approved real read-only acceptance pair, then increase in measured steps. Record overlapping timestamps, process count, memory, CPU, queue delay and provider throttling. Qualify 34-worker capacity only after a real workload test and budget review.

## Local checks completed

Worker-focused suite previously passed 115 tests. Current backup boundary run passed 83 tests with four skips across workspace-backup and workspace-backup-policy. This change preserves destination workers/jobs.db during workspace restore and omits the source ledger and WAL from exported archives.

## Persistent service execution component

service-execution.mjs adds a supervisor-owned SQLite journal and one execution slot per worker service. It records consumed job generations before execution, refuses overlapping work on that service, preserves uncertain ownership across restart, and requires a trusted shutdown inspection before reuse. Cancellation interrupts waiting even when the execution promise ignores its signal. Shutdown has a bounded deadline; timeout retains the slot for reconciliation. Eleven isolated tests cover these paths and failure isolation between separate service slots.

This component is not wired into startup or an HTTP service. Its execute, stop and inspectStopped callbacks must come from a trusted process supervisor. A worker-supplied receipt is insufficient shutdown evidence. Run one supervisor per journal; multi-supervisor ownership and process-tree containment still need implementation and integration tests. No Railway worker deployment is implied by these unit tests.

## Linux supervisor qualification

linux-service-supervisor.mjs scopes one worker UID inside an explicitly confirmed dedicated Linux PID namespace. The supervisor runs as root, while setpriv clears supplementary groups and capabilities and enables no-new-privileges for provider processes. Shutdown scans the UID across /proc, including descendants that create a new session. Signal helpers run under the worker UID to avoid signaling a reused privileged PID. Pending shutdown prevents slot release. The host-selected command wrapper in process-client.mjs cannot come from task content.

Two disposable local containers passed with 730 ms overlapping execution, two sequential jobs each, detached children stopped, no effective worker capabilities and root supervisor signal protection. Both had network disabled, read-only root filesystems and no management socket. The reproducible fixture and evidence live at C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\linux-service-qualification\run.mjs and proof.json.

The container image must include Tini, setpriv and kill. Its supervisor needs SETUID, SETGID and SETPCAP for the drop wrapper; the worker retains none. Protect the supervisor journal with a root-only directory and keep operator files outside the writable workspace. This path is a prototype for Railway-native services. Railway's namespace, capability availability, persistent volume ownership and authenticated service transport still require qualification. Startup and HTTP wiring remain incomplete.

## Authenticated service composition

service-host.mjs composes the root-only supervisor journal, Linux UID supervisor, provider process client and service-transport.mjs endpoint. Operator configuration pins the worker, assignment, bootstrap, workspace, environment and TLS identities. The authorize callback must verify the lease against the controller and return its current job; the service compares bot, thread, project, resources, worker and generation before execution. Controller calls use service-client.mjs. Remote binding retains mutual TLS, hostname checks, certificate pins and bearer authorization.

The endpoint supports run, cancellation and shutdown status. It does not expose reconciliation or permission grants. Cancellation before request delivery records a durable tombstone, so a delayed run cannot execute later. Unknown status alone does not prove shutdown. A verified terminal state or persisted cancellation does; uncertain shutdown continues to block work. Pending authorization obeys cancellation even when its callback stalls. Provider responses contain no lease token.

The composed service passed two disposable Linux containers with pinned mTLS, two sequential synthetic jobs each and 207 ms overlapping execution. Detached children stopped before each subsequent job. The fixture uses a synthetic lease authority, not the deployed controller: real controller-event relay and approval integration through this service path remain acceptance gates. Evidence: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\service-transport-qualification\proof.json; reproducible runner in the same directory. All 129 worker tests and server typecheck pass. No Railway changes or paid calls occurred.

## Controller service integration

service-controller.mjs binds each operator-assigned worker to a fixed service client and reuses the controller planner, durable event relay, permission decisions and host-settlement gate. Jobs cannot select endpoints. The controller checks bot/project/desktop/workspace before execution and worker generation before stop/status operations. It publishes terminal success only after the authenticated service reports verified shutdown. Configured startup still selects the Docker path; a reviewed service-mode schema and app-startup fixture remain work.

The isolated service-controller fixture passed against two actual Linux service containers and the real controller lease/event transport. Both approval requests were pending before answers; all three requests, including a later thread, returned allowed-once ACKs. Reports stayed in their own threads. Three jobs settled completed after service shutdown checks. The initial tasks overlapped for 36 ms. Provider inference was synthetic, with no paid calls or production changes. Fixture resources and per-worker images were removed. Worker images held only their own worker credential; service control TLS keys stayed in root-only configuration.

Evidence and reproducible runner: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\service-controller-qualification\proof.json and run.mjs. This verifies the assembled controller/service path, not full application startup, live integrations, Railway platform behavior or 34-worker capacity.

## Service-mode controller startup

OMB_WORKER_HOST_CONFIG accepts version 2 with kind services. Its exact top-level keys are version, kind, maxRunning, assignments, pools, services and transport. Version 1 retains the Docker configuration. Version 2 does not call the controller's Docker runner or SSH route.

Each services entry is keyed by assigned worker ID and contains origin, tokenFile, keyFile, certFile, caFile and serverPin. Paths must be absolute. The controller reads the bearer and client TLS material from these operator-owned files; tasks cannot select endpoints or keys. The transport object retains the version-1 listener and worker-event TLS fields. maxRunning is an admission policy, not measured capacity. Pool health probes authenticate the relevant pool's endpoints; successful connectivity does not qualify workload capacity or model access.

Startup preserves the durable controller ledger and refuses unresolved prior leases before listening. Shutdown aborts and drains jobs before closing clients and event transport. The service startup regression proves it does not invoke Docker when prior leases require reconciliation.

The source app and packaged controller copied outside the repository both passed normal provider registration, two Linux service workers, two approval cards before answers, allowed-once ACKs, separate Store reports, terminal digests and two completed host settlements. Both fixtures removed their temporary resources. Provider inference was synthetic. Evidence: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\service-app-qualification\source-proof.json and packaged-proof.json. All 132 worker tests and server typecheck pass; release build and packaged smoke pass. Railway capability/namespace qualification, worker release packaging, persistent worker-volume recovery and real integration/capacity acceptance remain open.
