# Operator worker startup

The server reads OMB_WORKER_HOST_CONFIG only from its process environment. Without it, startup adds no worker driver, listener, directory or Docker operation. The configured file is operator-owned JSON, separate from bot folders and user-editable provider settings. An invalid host configuration leaves existing providers enabled and worker instances unavailable.

The version1 file requires these fields:

| Field | Purpose |
| --- | --- |
| namespace | Stable ownership namespace for this controller and host |
| dockerSshAlias | Existing approved SSH alias used by the VPS Docker runner |
| maxRunning | Explicit host admission ceiling, integer1 through64 |
| storageImage | Immutable local image ID containing Node and Tini |
| assignments | Unique bot/project/pool/worker/desktop/workspace mappings |
| pools | Approved model catalogs by pool |
| policies | Container resource/image/network/command and agent paths by worker |
| transport | Fixed listener port, advertised hostname, certificate paths, pins and token-file paths |

Transport requires listenHost, advertisedHost, port, controllerTokenFile, workerTokenFiles and tls. The tls object requires keyFile, certFile, caFile, controllerPin and workerPins. Token-file and pin maps must cover the assigned workers. The listener uses a stable port so packaged worker endpoints survive controller restart. Remote binding requires mutual TLS; workers also verify the server leaf pin, CA and hostname.

Worker images must package the container agent, process entry point, provider driver and an operator-selected bootstrap module. That module uses createAssignedProviderBootstrap with a fixed bot/project/worker/resource policy. Task stdin carries conversation content and a controller-owned lease. It cannot choose host credentials, model configuration, Docker arguments or executable paths. Keep host keys and operator configuration outside writable bot workspaces. Workers receive no management socket.

Admission queues at maxRunning and releases capacity after matching-generation host shutdown verification. This ceiling is an operator policy, not measured hardware capacity, an API-rate allowance or a spending cap. Startup refuses unresolved running, cancelling or uncertain leases. It does not discard them or retry external actions. Changing persisted registrations or credentials still requires a reviewed reconciliation path; automatic rotation/reset is not implemented.

The current Store resolver supports a bot's own direct threads. Shared-room scheduling retains its existing ordering. Provider integrations, model credentials and remote routing need per-worker qualification before deployment. Backup/restore and real-workload capacity remain acceptance work.

Local verification covers default source-app startup through the repository fake-engine launcher and doctor, disabled configuration, prior-lease refusal, queued admission and wrong-generation release refusal. The assembled Docker path passes two synthetic workers plus a later thread. Enabled startup through the complete app still needs acceptance. No production configuration or deployment has been applied.
