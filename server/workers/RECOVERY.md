# Worker recovery qualification

This describes an offline synthetic recovery check, not an automatic restore command or permission to touch a hosted worker.

## Proven scope

The Linux fixture uses the existing encrypted workspace archive implementation and a stopped service execution journal. It creates a checkpoint as UID 1000, records an old completed generation, closes the service, exports an encrypted archive and stages it into a separate temporary directory. Wrong passwords and a modified authentication tag fail before staging succeeds.

The fixture now wraps encrypted capture with withStoppedServiceSnapshot. It scans /proc for the dedicated worker UID before and after capture and verifies that another supervisor cannot open authority during capture. Both process probes return stopped.

It restores only the worker marker, authority directory and workspace into a fresh root. A trusted offline role repairs workspace ownership, then verifyServiceStorage checks the binding and ownership. A foreign project binding fails. The checkpoint and completed generation survive: the old job cannot execute again, while a new job can complete.

The generated proof records the immutable image and bundled-fixture hash, zero paid calls, no production change and removal of the disposable container. Its actualModelProcesses and automaticRecoveryToolQualified flags are false. All data and the archive passphrase are synthetic; no production credentials enter this test.

Evidence: C:\Users\lL0xt\OneDrive\Documents\ManusBot\worker-execution-candidate\worker-backup-qualification\proof.json. The adjacent fixture.mjs and run.mjs reproduce it from the current source. The isolated container has no network and a read-only fixture mount; its writable data is temporary.

## Separate backup authority

This fixture uses an offline backup-admin role with CHOWN, SETUID, SETGID and DAC_READ_SEARCH inside its disposable namespace. SETUID/SETGID let the checkpoint writer run as the worker UID. DAC_READ_SEARCH lets the offline reader inspect private worker files; it is not added to the ordinary untrusted worker. Ownership changes happen before activation. Controller/worker TLS material and management sockets stay outside the workspace and this archive.

## Remaining operational gates

- Stop and independently verify the worker processes before exporting. The generic archive API does not acquire the service supervisor lock or prove shutdown for the operator.
- service-snapshot.mjs now provides the trusted snapshot critical section: it takes the supervisor exclusion lock, refuses unresolved/foreign journal authority, independently probes shutdown before and after capture, and releases the lock on failure. Four tests pass on Windows and actual Linux. The offline encrypted capture fixture now uses this critical section and passes on Linux. Qualify restore/quarantine orchestration before calling recovery operational. The caller must supply a real namespace process probe; a journal flag or missing lease file is insufficient.
- Restore into quarantine, verify archive/binding/ownership and compare controller job authority before admitting work. Never initialize a foreign volume or silently reset consumed generations.
- A snapshot proves only the receipts it contains. Jobs executed after the snapshot require reconciliation against the surviving controller and external effects. Do not replay them from an older journal.
- Qualify uncertain-owner recovery, interrupted restore, rollback and real Railway volume replacement. The fixture restores a known stopped completed journal, not a live model process or an unknown external action.
- Keep a separately encrypted copy outside the service volume and test recovery under the chosen retention policy. Provision storage, copy credentials or activate restored workers only under applicable owner approval.

The controller workspace backup deliberately excludes host-bound workers/ authority. This worker-specific check does not change that policy or authorize restoring controller leases from an app backup.
