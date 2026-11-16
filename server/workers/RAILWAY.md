# Railway worker deployment state

Updated November 16, 2026. This file describes the local candidate. No deployment approval follows from these checks.

## Architecture and ownership

One controller retains the Store, approval decisions and durable job ledger. Each initial worker gets a separate service, desktop identity and persistent workspace. The controller admits distinct bots concurrently while keeping exclusive ownership of each bot's desktop and workspace. Shared-room ordering remains separate.

service-controller.mjs connects fixed operator-selected service clients to the existing planner, event relay, permission ACKs and settlement gate. service-host.mjs combines the Linux supervisor, root-only execution journal, process client and authenticated endpoint. No task can select an endpoint, executable, credential or foreign workspace. Workers receive no management socket or Railway management credentials.

The Linux supervisor runs as root in an operator-confirmed dedicated PID namespace. It uses setpriv to clear groups and capabilities, switch worker UID and enable no-new-privileges. It checks that UID across /proc, including detached children, before releasing execution. Signal helpers run as the worker UID. The image needs Tini, setpriv and kill; the supervisor needs SETUID, SETGID and SETPCAP. Railway availability of those capabilities is unverified.

Cancellation before delivery creates a durable tombstone. Duplicate generations cannot execute again. An expired heartbeat, lost connection or unverified shutdown retains ownership for trusted reconciliation. Restart does not silently retry external actions. Controller workspace backups preserve destination worker authority and omit the host-bound ledger. Worker volumes need a separate backup/recovery test.

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

The release is incomplete: it does not include provider CLIs, a standalone service entry point or a production image. The manifest marks productionReady false. Only Claude has a runtime package qualification so far. No production credentials belong in the build context or image.

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

All inference in these fixtures is synthetic. They establish neither real model authentication nor 34-worker throughput. The focused worker suite has 134 passing tests; server typecheck and release build pass. Packaged smoke covers normal startup outside the source tree, proxy paths, CLI/MCP, backup worker, trust gate and desktop entry. Temporary containers, networks and certificates from the full-app fixtures were removed.

## Railway facts and open gates

[Private networking](https://docs.railway.com/networking/private-networking/how-it-works) supports named service endpoints within one environment. New environments have IPv4 and IPv6; legacy environments can be IPv6-only. The candidate retains mTLS role authentication over that private network.

[Volumes](https://docs.railway.com/volumes/reference) allow one volume per service and prohibit replicas on volume-backed services. Worker workspace and supervisor journal therefore need separate permission-protected directories within that service's volume. Redeploying a volume-backed service has downtime.

[Health checks](https://docs.railway.com/deployments/healthchecks) use PORT and the healthcheck.railway.app hostname. A separate read-only readiness listener is still required because the execution listener requires client certificates. Railway health checks run at deployment, not as continuous monitoring.

Before hosted testing: finish standalone worker startup, package the image, qualify namespace/capabilities and durable volume ownership, and prepare a bounded two-worker staging configuration. Deployment, added resources, credential installation and paid tests require their applicable approvals. Then test worker/controller interruption, reconciliation, volume restore and real read-only integration tasks. Increase capacity in measured steps with CPU, RAM, PID, queue, rate-limit and cost evidence. Do not claim 34-worker capacity before that acceptance.
