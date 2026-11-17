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
- The local provider image now installs Claude 2.1.326 and Codex 0.169.0; both executables pass offline startup as UID 1000 with all capabilities dropped and a read-only root. The assembled worker image builds as sha256:b62f02c16a4e572d97a297f5187ded9015668fd99e14bef7c8ea58d9a0f2c7f9. Provider metadata and startup evidence live in provider-runtime/ under the evidence root. npm reported a Claude postinstall allowScripts warning, but executable checks passed. Codex real app-server initialize and account/read pass offline with HOME=/home/node and writable /tmp; accountPresent is false as expected. With a read-only root and no writable /tmp, Codex fails SQLite state migration before its handshake. Configure a worker-owned persistent HOME outside /tmp and writable temporary storage. The successful protocol-proof.json records this check. Claude also accepts a real stream-json initialize control request offline with Ask mode and strict MCP configuration; claude-protocol-proof.json records zero user prompts. Authentication remains unverified for both providers. Qualify isolated authentication next. The package manifest still reports productionReady false. No production credential copy or paid model turn follows from local tests.
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

## Capability boundary for the first pilot

The current service candidate supports native Claude/Codex tasks and scoped controller connected-app tools. It does not yet provide a bot-controlled browser or a full desktop. Basic delegated child execution now passes as described below. The coordinator now advertises customMcp/composioMcp/agentsMcp when the tool relay is enabled. The existing controller agents descriptor binds bot, chat, generation and delegation depth. A synthetic mounted-agents test verifies canonical tool identity, scope exclusions and approval routing. Full-app source and packaged fixtures now exercise coordinate_bots through the real controller agents proxy: worker A delegates to worker B, both jobs complete in separate Linux services, and fixture resources are removed. The fixtures use synthetic providers and no paid calls. The first run reproduced Foreign or inactive controller turn because the old resolver required a pending user message; delegated work has a bot-role request. Admission now requires a live matching dispatch claim, request generation, owning bot/chat and busy task. Focused tests reject stale, foreign, setup, stopped and idle claims. A packaged negative-target fixture confirms unknown targets create no worker job while a valid delegated child still completes. Cross-project account/file access remains a separate gate: upstream intentionally permits some cross-department communication, and this patch preserves that reachability policy rather than adding a blanket section block. Evidence: service-app-qualification/delegation-source-proof.json, delegation-packaged-proof.json and delegation-boundary-packaged-proof.json under the evidence root. Browser/computer capabilities remain absent. Its resource labels reserve assignments but do not start a desktop. Earlier real desktop fixtures used scripted browser actions.

A two-worker native/API pilot is an intermediate acceptance step toward the requested independent computer environments. Complete worker-local browser/desktop integration and remaining delegation boundary acceptance before claiming the full requested setup. BROWSER-INTEGRATION.md defines the required worker target, approval/egress preservation, invocation journal, viewer/control binding and two-browser acceptance. Keep controller browser bridges outside worker tool relays.

## Measured delegated overlap

The packaged two-service delegation fixture records worker start/terminal event timestamps in the controller ledger. Worker A ran from 1794874362017 to 1794874363266; worker B ran from 1794874362391 to 1794874363606, giving 875 ms overlap. The fixture inserts 1.2 second synthetic pauses to make overlap observable. It verifies two distinct worker identities, successful parent/child settlement and removal of fixture resources. Evidence: service-app-qualification/delegation-overlap-packaged-proof.json under the evidence root. This proves the real app/controller handoff can overlap execution on two Linux services; it is not model throughput, resource sizing, browser execution or hosted capacity.

## Specialist reporting and chief resumption

Source and rebuilt packaged fixtures now pass reply=resume through the actual controller agents bridge. The packaged proof asserts exactly three worker jobs and one delegation invocation: the chief assigns work, the specialist reports CHILD_DONE, and the resumed chief verifies that report. Evidence: service-app-qualification/delegation-resume-source-proof.json and delegation-resume-packaged-proof.json. Providers remain synthetic; no paid calls or production changes occur.

The first full-loop run reproduced Changed turn context requires reconciliation when the chief resumed. The resolver had keyed the worker job to the original user message, even though one user request can contain multiple provider turns. It now uses the live matched dispatch generation for execution identity. Same-generation replay retains the same key; a new continuation gets a new job. Foreign/stale/stopped/setup/idle ownership checks stay intact. Worker suite: 187 passes and three Windows skips; server typecheck and packaged compilation pass. This bug belongs to the new isolated-worker integration; upstream standard-driver reproduction remains unproven.

## Parallel specialists and return reporting

The packaged fan-out fixture uses three actual Linux services: chief A calls coordinate_bots once with specialists B and C; both specialists finish, then A resumes with both report markers. The controller ledger contains exactly four jobs and one delegation invocation. Specialist B ran from 1794875176505 to 1794875177720; C ran from 1794875176513 to 1794875177725, giving 1,207 ms overlap. The fixture inserts 1.2 second synthetic pauses, uses no paid models or real accounts, and removes its resources. Evidence: service-app-qualification/delegation-fanout-packaged-proof.json. This qualifies parallel delegated routing and report aggregation through the packaged app, not 34-worker capacity or real model behavior.

## Conversation replay versus native resume

The isolated adapter deliberately advertises strictResume=false and hasSession=false. Its service rejects native resume cursors, and its event projection omits native session identifiers. The controller builds the saved conversation into the next turn text. This is a supported stateless conversation strategy, not evidence that history is lost.

The packaged transcript-replay fixture now asserts the resumed chief receives the original request, its earlier response and the specialist report; a private marker seeded in the specialist's unrelated main chat stays absent. It completes exactly three worker jobs and one delegation. Evidence: service-app-qualification/transcript-replay-packaged-proof.json. Providers are synthetic; native CLI resume, live model recall quality and token-cost efficiency remain unverified. Native session reuse would require durable bot/chat/worker binding and additional isolation tests before enabling it.

### Local browser resource evidence

The two-container offline browser fixture measured overlapping RPC execution1132ms and distinct PID namespaces/volumes. Per-fixture cgroup peaks were about800MiB/214PIDs and376MiB/220PIDs under1CPU/1GiB/256PID limits, including local fixture controllers and synthetic CLI. CPU throttling occurred. This is evidence to include in pilot admission sizing, not a production requirement estimate or proof of34-worker density. Browser viewer integration and a shared-controller real-service concurrency test remain open. Canonical evidence is service-browser-qualification/parallel-proof.json under the workspace evidence root.

### PID pressure and affinity experiment

The thread inventory shows Chromium accounts for150-168tasks in the first quota-only browser jobs. Root fixture/service Node processes account for18tasks together, worker Node processes18, native agent-browser4 and crash handlers3. The high task count is not evidence of hundreds of running bot jobs or a leaking Rust pool.

Using the same immutable image b7ba23266f5ec661b1d864b8d8251732865e9f3b8311e192f551a28ec15ad3c2, the quota-only run peaks at223/206PIDs. A second short run pins the two fixtures to CPUs0and1 while retaining the1CPU quota: peaks195/196PIDs, browser RPC overlap1098ms and verified clean shutdown. Chromium snapshots show134/137tasks. Cgroup throttled time changes from32.2/23.6seconds to1.45/1.03milliseconds for this fixture; scheduling and host load can affect repeatability. Memory peaks remain about617-650MiB, and this does not establish heavy-site capacity.

The repeated test preserves browser security flags and separate volumes/PID namespaces. It supports evaluating optional CPU affinity on a controlled Docker host. Railway's available affinity controls have not been verified, so do not prescribe a Railway cpuset variable or claim this configuration exists there. Evidence: service-browser-qualification/parallel-proof.json and parallel-affinity-proof.json. Both use separate fixture controllers and synthetic native CLIs, with no paid turns or production changes.

### Shared controller browser milestone

The local shared-controller browser runner passes two real services, distinct pages, separate approvals, durable open replay, foreign-worker lease refusal and1053ms overlapping browser calls. Both workers stop and clean up. Its measured worker cgroup peaks are about637MiB/199tasks and496MiB/200tasks, excluding the Windows host controller. This closes the earlier separate-fixture-controller limitation for browser tool dispatch. Viewer/annotation/control and actual Railway capacity still need qualification before rollout.

### Native/API rollout package, refreshed November16

Read-only Railway inventory still shows production controller05a417f8-d9cd-49e1-b8af-8bc2f971b238 and the sleeping health-only concurrency service. Staging7e6a9304-dd13-45b4-8e95-bc30e98e7594 contains only sleeping mausbot-staging44625f97-bc43-4018-83c0-a726756d2879 with its existing1GB volume. No staged changes or worker services exist. This inventory does not wake staging.

The current controller package passes its no-node_modules startup,14proxy paths, MCP stdio, CLI doctor/bots, encrypted backup, loopback trust, compile-cache restart and enterprise-layer smoke checks. The native worker context builds without a local-only parent-image dependency: Dockerfile combines the pinned provider base and worker runtime, and includes only manifest-listed worker files. Local image be48ad908fcc9c22d785958deaa74708c5597e05e6c0f3c441162c6f502c2a3a verifies Claude2.1.326 and Codex0.169.0 offline as UID1000, read-only root, dropped capabilities and writable HOME outside/tmp. No account authentication or paid model call follows from these version checks.

Reviewable context and proposed resource ceilings: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\railway-native-pilot\prepared-pilot.json and worker-build/. Two proposed worker services have1CPU/2GB limits and1GB volumes each; these are ceilings to approve, not measured bills or provisioned resources. Browser capability stays disabled so viewer work does not block native/API qualification. Controller deployment, private TLS/config provisioning and the exact synthetic staging test wiring must be ready before requesting rollout approval. Do not wake existing staging schedules or copy production accounts as a shortcut.

Private-network reference: https://docs.railway.com/networking/private-networking/how-it-works. Use the services' private DNS names and an explicit dual-stack listener. This worker protocol retains application mTLS identity and pins even inside the encrypted Railway private network. The connector's documentation lookup returned stale URLs; the official page supplied the current networking details.

### Isolated controller context and rollout scope

The controller context now passes actual Linux startup with fresh temporary data and no network, image fbb5cf1d7894ed34c6e60bc23ffb2e1f07b142365052f8931a3425ab8a1f371a. The first health attempt exposed a packaging mismatch: this app reads OMB_PORT, not PORT. The context now sets both to8080, and health passes. This was a pilot packaging issue, not a production change.

ROLLOUT.md under the railway-native-pilot evidence folder defines three fresh staging-only services and three1GBvolumes, each service limited to1CPU/2GB, a30minute synthetic-only test and cleanup scope. It preserves the existing sleeping staging controller and production. It distinguishes locally verified image IDs from unpublished registry references and leaves provider authentication unverified. Synthetic CLI packaging and exact provisioning/test automation remain preparation work before requesting new deployment approval. Published container rates yield about$0.0833 compute for30minutes at those total ceilings, before egress/other charges; this is not a spending cap. Source:https://docs.railway.com/pricing/plans.
