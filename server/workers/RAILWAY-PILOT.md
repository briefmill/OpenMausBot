# Railway worker pilot

Prepared November 16, 2026. This plan changes no hosted resources and authorizes no deployment or spending.

## Current hosted state

The production environment has one MausBot controller, Graphify Brain, a Front Desk watcher, a sleeping concurrency-test service and an undeployed render service. The controller's latest deployment is 05a417f8-d9cd-49e1-b8af-8bc2f971b238. There are no staged changes. The controller has one replica, a 2 CPU / 8,000,000,000 byte memory limit and a 50 GB workspace volume.

A read-only SSH probe at 23:00:39 UTC confirms Node 24, worker-host configuration disabled, 50 of 1,000 PIDs, and about 1.07 GB current cgroup memory. The one-hour Railway metrics snapshot reports memory average 1.27 GB and peak 3.24 GB, CPU average 0.033 and peak 0.333. Those are observed usage, not worker capacity. The package-version probe returned null; the deployed app version remains unverified.

mausbot-concurrency-test runs /usr/bin/tini -- node /opt/concurrency/health.mjs. It sleeps, has no volume or variables, and has 2 CPU / 4,000,000,000 byte limits. It is not an agent environment. None of the new controller/worker code runs in this service or production.

Evidence lives in C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\railway-runtime-preflight\railway-worker-inventory-20261116.json and production-worker-status-20261116.json. Variable values and credentials were not read.

## Software gates before hosted acceptance

- The identified customized checkout overlay is integrated and tested as af003d478. Its original checkout stays untouched. Review any separate feature worktrees and deployed desktop differences before promotion; the production package version is still unverified.
- Built-in Composio batch saved-grant acceptance passes in both source and packaged controllers with two Linux services: six fresh synthetic reads across new chats and a controller restart, separate send cards, zero denied sends dispatched, and eight completed host settlements. Evidence: service-app-qualification/builtin-grant-source-proof.json and builtin-grant-packaged-proof.json under the evidence root above. This qualifies the exercised Gmail batch paths, not all built-in or opaque Bash actions. Both native driver launch/result paths pass with synthetic CLIs; live authentication and provider rate limits still need approved hosted acceptance.
- The local provider image now installs Claude 2.1.326 and Codex 0.169.0; both executables pass offline startup as UID 1000 with all capabilities dropped and a read-only root. The assembled worker image builds as sha256:b62f02c16a4e572d97a297f5187ded9015668fd99e14bef7c8ea58d9a0f2c7f9. Provider metadata and startup evidence live in provider-runtime/ under the evidence root. npm reported a Claude postinstall allowScripts warning, but executable checks passed. Codex warns about helper aliases with the temporary fixture HOME; qualify its persistent home and real driver protocol before hosted use. Qualify isolated authentication next. The package manifest still reports productionReady false. No production credential copy or paid model turn follows from local tests.
- Offline encrypted snapshot restore passes for a stopped synthetic journal, including wrong-password/tamper refusal and old-generation rejection. Finish the trusted stopped-state/locking wrapper, post-snapshot reconciliation, interrupted restore and actual Railway volume acceptance before treating recovery as operational. See RECOVERY.md.
- Include root-controller MCP process/memory pressure in load acceptance. Moving models off the controller does not remove its integration-process load.

## First hosted acceptance

Use two distinct worker services in an approved test environment, with one fixed bot/project/desktop/workspace assignment and one identity-bound volume per service. Keep supervisor configuration and TLS authority outside the worker-owned workspace. Give workers no Railway management token or container-management socket. Only read-only health belongs on the public listener; execution stays pinned mutual TLS.

Start with synthetic providers and fake accounts. Verify overlapping execution, separate workspaces, controller-local approvals, duplicate-request replay, unknown-outcome holds, cancellation, forced worker death and service replacement. Record deployment IDs, image hashes, job timing, peak RSS/PIDs/CPU, separate reports, volume persistence and cleanup. A successful health check alone does not pass this gate.

After synthetic acceptance and owner approval for paid usage, run two bounded read-only turns with isolated provider authentication and existing account boundaries. Record genuine authentication failures and model/API rate limits. Do not retry sign-in or tool failures without a bound. Keep sends separately approved.

## Scaling toward 34

Advance measured concurrent workers from 2 to 4, 8, 16 and 34. At each level, capture controller and per-worker resources plus queue/API delays. Stop increasing the level on an OOM, process exhaustion, unknown tool outcome, cross-account result, unverified shutdown or lost checkpoint. Resolve the failure before repeating that level.

The controller regression already proves 34 overlapping logical assignments with 68 exclusive desktop/workspace leases and a queued same-desktop follow-up. It does not provision 34 machines or measure their resource needs. Default desktop CPU/RAM settings and local synthetic usage cannot establish a 34-worker Railway bill or budget cap. Agree on the hosted resource and paid-provider budget before provisioning the next level.

## Deployment approval boundary

The next reviewable hosted action must name exact services/environment, immutable image, resource limits, volumes, credentials to provision, expected restart effects, test duration and rollback. Existing production sessions and schedules stay untouched until that action receives applicable approval. This plan does not request approval for an unfinished build.
