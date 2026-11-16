import { setTimeout as pause } from 'node:timers/promises';

// Controller-owned ProviderAdapter permission seam. Policy and durable saved
// grants stay in MausBot; workers receive only the resulting one-shot answer.
export function bindWorkerPermissions({ ledger, jobId, generation, botId, threadId, turnId,
  isCurrent, signal, deliveryMs = 10000, pollMs = 10 }) {
  if (typeof isCurrent !== 'function' || !signal || !Number.isSafeInteger(deliveryMs) || deliveryMs < 1 || deliveryMs > 30000 ||
      !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw Error('Bounded live controller binding required');
  const current = () => {
    const job = ledger.get(jobId);
    return !signal.aborted && isCurrent() === true && job.bot === botId && job.thread === threadId &&
      job.generation === generation && job.state === 'running';
  };
  return {
    async respondToRequest(thread, requestId, decision) {
      if (thread !== threadId || !current()) return 'unavailable';
      if (decision?.always === true) throw Error('Worker channel cannot persist grants');
      const answer = { behavior: decision?.behavior, ...(decision?.message === undefined ? {} : { message: decision.message }) };
      ledger.decideRequest(jobId, generation, requestId, answer);
      const deadline = Date.now() + deliveryMs;
      while (current() && Date.now() < deadline) {
        const delivered = ledger.requestDelivery(jobId, generation, requestId);
        if (delivered.outcome && delivered.outcome !== 'unavailable') return delivered.outcome;
        if (delivered.outcome === 'unavailable') break;
        await pause(pollMs);
      }
      // A recorded allow without a delivery acknowledgement is uncertain.
      // Cancel further collection and retain the desktop/worktree lease.
      const job = ledger.get(jobId);
      if (job.generation === generation && job.state === 'running') ledger.cancel(jobId);
      throw Error('Remote approval delivery uncertain; worker stop requires verification');
    },
    async interruptTurn(thread, requestedTurn) {
      if (thread !== threadId || (requestedTurn !== undefined && requestedTurn !== turnId)) return;
      const job = ledger.get(jobId);
      if (job.generation === generation && job.state === 'running') ledger.cancel(jobId);
    },
  };
}
