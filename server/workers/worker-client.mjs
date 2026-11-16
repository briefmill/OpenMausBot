import { setTimeout as delay } from 'node:timers/promises';
import { runProviderTurn } from './provider-runner.mjs';
import { tlsRequester } from './tls-request.mjs';
import { workerEventForController } from './event-wire.mjs';
import { validWorkerOrigin } from './transport-address.mjs';

const safeId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) throw Error('Invalid job identity');
  return value;
};
// Internal runtime requests keep permission evidence. Durable progress events
// carry only this display-safe subset, without raw protocol or shell arguments.

export function workerClient({ origin, token, heartbeatMs = 1000, pollMs = 50, tls, allowRemote=false }) {
  if (!validWorkerOrigin(origin,allowRemote)) throw Error('Loopback transport required unless pinned remote TLS is enabled');
  if (origin.startsWith('https:') !== !!tls) throw Error('Explicit mutual TLS configuration required');
  if (typeof token !== 'string' || token.length < 32) throw Error('Worker credential required');
  if (!Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw Error('Invalid poll interval');
  const secure = tls ? tlsRequester(origin, tls, {allowRemote}) : null;
  const call = async (path, body, signal) => {
    if (secure) return secure.call(path, token, body, signal);
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw Error(`Worker operation rejected (${response.status})`);
    return response.json();
  };
  return {
    close: () => secure?.close(),
    async run({ jobId, adapter, input, signal, lease: suppliedLease }) {
      safeId(jobId);
      const { job } = await call(`/v1/jobs/${jobId}`, undefined, signal);
      if (input.botId !== job.bot || input.threadId !== job.thread) throw Error('Provider input identity mismatch');
      let lease;
      if (suppliedLease !== undefined) {
        lease = structuredClone(suppliedLease);
        if (!lease || lease.id !== jobId || lease.worker !== job.worker || lease.generation !== job.generation ||
            job.state !== 'running' || typeof lease.token !== 'string' || !/^[a-f0-9]{64}$/.test(lease.token))
          throw Error('Invalid controller-owned worker lease');
      } else ({ lease } = await call(`/v1/jobs/${jobId}/claim`, {}, signal));
      const auth = { generation: lease.generation, token: lease.token };
      await call(`/v1/jobs/${jobId}/heartbeat`, auth, signal);
      const reserved = await call(`/v1/jobs/${jobId}/events`, { ...auth, seq:1,
        event:{type:'worker.execution.claimed',jobId,generation:lease.generation} }, signal);
      if (reserved.replay) throw Error('Worker execution already started; reconciliation required');
      let seq = 1;
      const result = await runProviderTurn({ adapter, input, signal, heartbeatMs,
        onRequestOutcome: (event, outcome) => call(`/v1/jobs/${jobId}/requests/${safeId(event.requestId)}/ack`, { ...auth, outcome }, signal),
        checkLease: () => call(`/v1/jobs/${jobId}/heartbeat`, auth, signal),
        forwardEvent: event => call(`/v1/jobs/${jobId}/events`, { ...auth, seq: ++seq, event: workerEventForController(event) }, signal),
        decidePermission: async event => {
          safeId(event.requestId);
          const { raw, ...request } = event;
          await call(`/v1/jobs/${jobId}/requests`, { ...auth, request }, signal);
          while (true) {
            const response = await call(`/v1/jobs/${jobId}/requests/${event.requestId}/poll`, auth, signal);
            if (response.decision) return response.decision;
            await delay(pollMs, undefined, { signal });
          }
        },
      });
      // A provider terminal is not verified delivery. The controller must check
      // stored artifact bytes before accepting a successful ledger completion.
      return { lease, result };
    },
  };
}
