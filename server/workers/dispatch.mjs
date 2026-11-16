// Trusted controller bootstrap supplies host operations. Job bodies cannot
// select executables, credentials, mounts or management endpoints.
export function createDispatcher({ ledger, launch, execute, stop, inspectStopped, capacity = 1, leaseMs = 300000, stopMs = 10000 }) {
  if (![launch, execute, stop, inspectStopped].every(fn => typeof fn === 'function')) throw Error('Trusted host callbacks required');
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) throw Error('Invalid capacity');
  if (!Number.isSafeInteger(stopMs) || stopMs < 1 || stopMs > 30000) throw Error('Invalid stop deadline');
  return {
    async dispatch(id, worker) {
      const lease = ledger.claim(id, worker, leaseMs, capacity);
      if (!lease) return { started: false, reason: 'capacity-or-resource-held' };
      let handle, result, failure;
      try {
        // A rejected launch may still have created a container. Host operations
        // must find it by this job/generation identity, even without a handle.
        handle = await launch({ job: ledger.get(id), generation: lease.generation });
        result = await execute({ handle, job: ledger.get(id), lease,
          heartbeat: () => ledger.heartbeat(lease, leaseMs) });
      } catch (error) { failure = error; }
      const identity = { id, worker, generation: lease.generation, handle };
      let timer;
      try {
        await Promise.race([(async () => {
          await stop(identity);
          if (await inspectStopped(identity) !== true) throw Error('Worker stop unverified');
        })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Stop deadline')), stopMs); })]);
      } catch (error) {
        ledger.cancel(id);
        return { started: true, settled: false, reason: 'worker-stop-unverified' };
      } finally { clearTimeout(timer); }
      // Expired leases deliberately fail here. Restart recovery requires the
      // existing explicit reconciliation path rather than silent reassignment.
      const current = ledger.get(id);
      const outcome = current.state === 'cancelling' ? 'cancelled' : failure ? 'failed' : 'completed';
      const artifact = ledger.putArtifact(lease, Buffer.from(JSON.stringify({
        result: failure ? null : result ?? null, error: failure ? 'Worker execution failed' : null,
        workerStopped: true,
      })));
      ledger.finish(lease, outcome, artifact);
      return { started: true, settled: true, outcome, artifact };
    },
  };
}
