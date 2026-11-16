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
