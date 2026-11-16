import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { validWorkerHost } from './transport-address.mjs';
import { normalizeWorkerAssignment, workerAssignmentMatches } from './worker-assignment.mjs';

const digest = value => createHash('sha256').update(value).digest();
const denied = (status, message) => Object.assign(Error(message), { status });
const exact = (value, keys) => {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw denied(400, 'Invalid request');
};
async function jsonBody(req, limit = 70_000) {
  if (req.headers['content-type'] !== 'application/json') throw denied(415, 'JSON required');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw denied(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw denied(400, 'Invalid JSON'); }
}

// Loopback is the default. A host-selected remote binding requires mutual TLS.
export async function listenTransport({ ledger, controllerToken, workers, leaseMs = 30_000, tls,
  listenHost='127.0.0.1',advertisedHost='127.0.0.1',port=0 }) {
  if(!Number.isSafeInteger(port) || port<0 || port>65535)throw Error('Invalid worker listener port');
  if(!['127.0.0.1','0.0.0.0'].includes(listenHost) || !validWorkerHost(advertisedHost) || advertisedHost==='0.0.0.0' ||
     ((listenHost!=='127.0.0.1' || advertisedHost!=='127.0.0.1') && !tls))throw Error('Explicit mutual TLS remote binding required');
  workers = structuredClone(workers);
  if (tls) {
    exact(tls, ['key', 'cert', 'ca', 'controllerPin', 'workerPins']);
    if (![tls.key, tls.cert, tls.ca].every(v => (typeof v === 'string' || Buffer.isBuffer(v)) && v.length) ||
        !/^[a-f0-9]{64}$/.test(tls.controllerPin) || !tls.workerPins || typeof tls.workerPins !== 'object' ||
        Object.keys(tls.workerPins).sort().join(',') !== workers.map(w => w.id).sort().join(',') ||
        Object.values(tls.workerPins).some(v => !/^[a-f0-9]{64}$/.test(v)) ||
        new Set([tls.controllerPin, ...Object.values(tls.workerPins)]).size !== workers.length + 1) throw Error('Invalid mutual TLS configuration');
    tls = { ...tls, workerPins: { ...tls.workerPins } };
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw Error('Invalid lease duration');
  const entries = [{ token: controllerToken, role: 'controller' }, ...workers.map(w => ({ ...w, role: 'worker' }))];
  if (entries.some(e => typeof e.token !== 'string' || e.token.length < 32) ||
      new Set(entries.map(e => e.token)).size !== entries.length) throw Error('Distinct strong tokens required');
  if (new Set(workers.map(w => w.id)).size !== workers.length || workers.some(w =>
    typeof w.id !== 'string' || !Array.isArray(w.assignments) || !w.assignments.length ||
    !Number.isSafeInteger(w.capacity) || w.capacity < 1 || w.capacity > 64)) throw Error('Invalid worker registration');
  workers=workers.map(worker=>({...worker,assignments:worker.assignments.map(normalizeWorkerAssignment)}));
  const principals = [{token:controllerToken,role:'controller'},...workers.map(worker=>({...worker,role:'worker'}))].map(({ token, ...entry }) => ({ ...entry, tokenHash: digest(token),
    certificatePin: tls ? entry.role === 'controller' ? tls.controllerPin : tls.workerPins[entry.id] : null }));
  ledger.registerWorkers(workers.map(w => ({ id: w.id, capacity: w.capacity,
    assignments: w.assignments, credentialHash: digest(w.token + (tls ? ':' + tls.workerPins[w.id] : '')).toString('hex') })));
  const factory = tls ? createHttpsServer : createServer;
  const server = factory({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 5000,
    ...(tls ? { key: tls.key, cert: tls.cert, ca: tls.ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3' } : {}) }, async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const expectedHost = `${advertisedHost}:${server.address().port}`;
      if (req.headers.host !== expectedHost || req.headers.origin) throw denied(403, 'Forbidden');
      const match = /^Bearer ([^\s]{32,512})$/.exec(req.headers.authorization ?? '');
      const candidate = digest(match?.[1] ?? '');
      const principal = principals.find(p => timingSafeEqual(p.tokenHash, candidate));
      if (!match || !principal) throw denied(401, 'Unauthorized');
      if (tls && (!req.socket.authorized || !req.socket.getPeerCertificate().raw ||
          digest(req.socket.getPeerCertificate().raw).toString('hex') !== principal.certificatePin)) throw denied(403, 'Forbidden');
      const route = /^\/v1\/jobs(?:\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})(?:\/(claim|heartbeat|events|finish|cancel|requests|artifacts)(?:\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})\/(decision|poll|ack|result))?)?)?$/.exec(req.url);
      if (!route) throw denied(404, 'Not found');
      const [, id, action, requestId, requestAction] = route;
      if (requestId && action !== 'requests') throw denied(404, 'Not found');
      if (!id) {
        if (req.method !== 'POST' || principal.role !== 'controller') throw denied(403, 'Forbidden');
        const body = await jsonBody(req);
        return send(200, { job: ledger.enqueue(body) });
      }
      const job = ledger.get(id);
      if (principal.role === 'worker') {
        const assigned = principal.assignments.find(a => workerAssignmentMatches(a,job));
        if (!assigned || (job.worker && job.worker !== principal.id) ||
            (assigned.scope==='bot' && (job.worker!==principal.id || action==='claim'))) throw denied(403, 'Forbidden');
      }
      if (req.method === 'GET' && !action) return send(200, { job });
      if (req.method === 'GET' && action === 'events') {
        if (principal.role !== 'controller') throw denied(403, 'Forbidden');
        const cursor = req.headers['x-after-seq'] ?? '0';
        if (typeof cursor !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
          throw denied(400, 'Invalid event cursor');
        return send(200,ledger.readEvents(id,Number(cursor)));
      }
      if (req.method === 'GET' && action === 'requests' && !requestId) {
        if (principal.role !== 'controller') throw denied(403, 'Forbidden');
        return send(200, { requests: ledger.pendingRequests(id) });
      }
      if (req.method !== 'POST' || !action) throw denied(405, 'Method not allowed');
      // Neither a worker credential nor a controller bearer can attest host
      // shutdown. Trusted dispatch settles locally after host inspection.
      if (action === 'finish') throw denied(403, 'Host-verified settlement required');
      const body = await jsonBody(req, action === 'artifacts' ? 12 * 1024 * 1024 : 70_000);
      if (action === 'requests' && requestAction === 'result') {
        if (principal.role !== 'controller') throw denied(403, 'Forbidden');
        exact(body, ['generation']);
        return send(200, ledger.requestDelivery(id, body.generation, requestId));
      }
      if (action === 'requests' && requestAction === 'decision') {
        if (principal.role !== 'controller') throw denied(403, 'Forbidden');
        exact(body, ['generation', 'decision']);
        return send(200, ledger.decideRequest(id, body.generation, requestId, body.decision));
      }
      if (action === 'cancel') {
        if (principal.role !== 'controller') throw denied(403, 'Forbidden');
        exact(body, []);
        return send(200, { job: ledger.cancel(id) });
      }
      if (principal.role !== 'worker') throw denied(403, 'Forbidden');
      if (action === 'claim') {
        exact(body, []);
        const lease = ledger.claim(id, principal.id, leaseMs, principal.capacity);
        return send(lease ? 200 : 409, lease ? { lease } : { error: 'Capacity or resource unavailable' });
      }
      const lease = { id, worker: principal.id, generation: body.generation, token: body.token };
      if (action === 'artifacts') {
        exact(body, ['generation', 'token', 'base64']);
        if (typeof body.base64 !== 'string') throw denied(400, 'Invalid artifact');
        const bytes = Buffer.from(body.base64, 'base64');
        if (bytes.toString('base64') !== body.base64) throw denied(400, 'Invalid artifact encoding');
        return send(200, { artifact: ledger.putArtifact(lease, bytes) });
      }
      if (action === 'requests') {
        if (requestAction === 'ack') {
          exact(body, ['generation', 'token', 'outcome']);
          return send(200, ledger.acknowledgeRequest(lease, requestId, body.outcome));
        }
        if (requestAction === 'poll') {
          exact(body, ['generation', 'token']);
          return send(200, ledger.pollRequest(lease, requestId));
        }
        exact(body, ['generation', 'token', 'request']);
        return send(200, ledger.openRequest(lease, body.request));
      }
      if (action === 'heartbeat') {
        exact(body, ['generation', 'token']);
        return send(200, ledger.heartbeat(lease, leaseMs));
      }
      if (action === 'events') {
        exact(body, ['generation', 'token', 'seq', 'event']);
        return send(200, ledger.append(lease, body.seq, body.event));
      }
      throw denied(404, 'Not found');
    } catch (error) {
      // Keep database paths, credentials and internal failure details off the wire.
      send(error.status ?? 409, { error: error.status ? error.message : 'Job operation rejected' });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, listenHost, resolve); });
  return {
    origin: `${tls ? 'https' : 'http'}://${advertisedHost}:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
