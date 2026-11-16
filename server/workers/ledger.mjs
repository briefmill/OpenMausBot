import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { normalizeWorkerAssignment } from './worker-assignment.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const identity = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) throw Error('Invalid identity');
  return value;
};
const milliseconds = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) throw Error('Invalid lease duration');
  return value;
};

// Trusted-controller storage only. This module does not authenticate network callers.
export class JobLedger {
  constructor(file, { now = Date.now } = {}) {
    this.now = now;
    this.db = new DatabaseSync(file, { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, bot TEXT NOT NULL,
        thread TEXT NOT NULL, project TEXT NOT NULL, resource TEXT NOT NULL,
        state TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0,
        worker TEXT, token_hash TEXT, deadline INTEGER, event_seq INTEGER NOT NULL DEFAULT 0,
        result TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, job TEXT NOT NULL REFERENCES jobs(id));
      CREATE TABLE IF NOT EXISTS job_resources (job TEXT NOT NULL REFERENCES jobs(id), id TEXT NOT NULL, PRIMARY KEY(job,id));
      CREATE TABLE IF NOT EXISTS events (
        job TEXT NOT NULL REFERENCES jobs(id), seq INTEGER NOT NULL, digest TEXT NOT NULL,
        body TEXT NOT NULL, PRIMARY KEY(job,seq));
      CREATE TABLE IF NOT EXISTS permission_requests (
        job TEXT NOT NULL REFERENCES jobs(id), generation INTEGER NOT NULL, id TEXT NOT NULL,
        body TEXT NOT NULL, decision TEXT, PRIMARY KEY(job,generation,id));
      CREATE TABLE IF NOT EXISTS artifacts (
        job TEXT NOT NULL REFERENCES jobs(id), generation INTEGER NOT NULL, sha256 TEXT NOT NULL,
        bytes BLOB NOT NULL, PRIMARY KEY(job,generation,sha256));
      CREATE TABLE IF NOT EXISTS worker_registrations (
        id TEXT PRIMARY KEY, capacity INTEGER NOT NULL, assignments TEXT NOT NULL,
        credential_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_registry_initialized (id INTEGER PRIMARY KEY CHECK(id=1));
      CREATE TABLE IF NOT EXISTS job_reconciliations (
        job TEXT PRIMARY KEY REFERENCES jobs(id), generation INTEGER NOT NULL,
        evidence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS request_delivery (
        job TEXT NOT NULL, generation INTEGER NOT NULL, request TEXT NOT NULL, outcome TEXT NOT NULL,
        PRIMARY KEY(job,generation,request),
        FOREIGN KEY(job,generation,request) REFERENCES permission_requests(job,generation,id));`);
    this.transaction(() => {
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 1) throw Error('Unsupported ledger schema');
      if (version === 0) {
        // Preserve leases from the earlier single-resource local candidate.
        this.db.exec(`CREATE TABLE resources_next (id TEXT PRIMARY KEY, job TEXT NOT NULL REFERENCES jobs(id));
          INSERT INTO resources_next SELECT id,job FROM resources;
          DROP TABLE resources;
          ALTER TABLE resources_next RENAME TO resources;
          INSERT OR IGNORE INTO job_resources SELECT id,resource FROM jobs;
          PRAGMA user_version=1;`);
      }
    });
  }
  close() { this.db.close(); }
  registerWorkers(workers) {
    // Trusted bootstrap only. Registration changes need explicit reconciliation,
    // never an implicit reset of a worker's capacity or ownership after restart.
    if (!Array.isArray(workers) || workers.length > 1024) throw Error('Invalid worker registrations');
    const rows = workers.map(worker => {
      const id = identity(worker.id);
      if (!Number.isSafeInteger(worker.capacity) || worker.capacity < 1 || worker.capacity > 64 ||
          typeof worker.credentialHash !== 'string' || !/^[a-f0-9]{64}$/.test(worker.credentialHash) ||
          !Array.isArray(worker.assignments) || !worker.assignments.length) throw Error('Invalid worker registration');
      const assignments = worker.assignments.map(normalizeWorkerAssignment).map(a => JSON.stringify(a)).sort();
      return { id, capacity: worker.capacity, assignments: JSON.stringify([...new Set(assignments)]), credentialHash: worker.credentialHash };
    });
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Repeated worker registration');
    return this.transaction(() => {
      const stored = this.db.prepare('SELECT * FROM worker_registrations ORDER BY id').all();
      if (this.db.prepare('SELECT id FROM worker_registry_initialized WHERE id=1').get()) {
        if (stored.length !== rows.length || stored.some(old => {
          const next = rows.find(r => r.id === old.id);
          return !next || old.capacity !== next.capacity || old.assignments !== next.assignments || old.credential_hash !== next.credentialHash;
        })) throw Error('Worker registration changed; explicit reconciliation required');
      } else {
        const insert = this.db.prepare('INSERT INTO worker_registrations VALUES (?,?,?,?)');
        for (const row of rows) insert.run(row.id, row.capacity, row.assignments, row.credentialHash);
        this.db.prepare('INSERT INTO worker_registry_initialized VALUES (1)').run();
      }
      return { count: rows.length };
    });
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(identity(id));
    if (!row) throw Error('Unknown job');
    const { token_hash, fingerprint, ...visible } = row;
    const resources = this.db.prepare('SELECT id FROM job_resources WHERE job=? ORDER BY id').all(id).map(r => r.id);
    return { ...visible, resources };
  }
  enqueue(input) {
    const keys = ['id', 'bot', 'thread', 'project', 'resource'];
    if (!input || Object.keys(input).some(key => ![...keys, 'resources'].includes(key))) throw Error('Invalid job');
    const job = Object.fromEntries(keys.map(key => [key, identity(input[key])]));
    if (input.resources !== undefined && (!Array.isArray(input.resources) || input.resources.length > 15)) throw Error('Invalid resources');
    const resources = [...new Set([job.resource, ...(input.resources ?? []).map(identity)])].sort();
    // Retain the original fingerprint for one-resource job replay after migration.
    if (resources.length > 1) job.resources = resources;
    const fingerprint = hash(canonical(job));
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT fingerprint FROM jobs WHERE id=?').get(job.id);
      if (prior && prior.fingerprint !== fingerprint) throw Error('Conflicting job replay');
      if (!prior) {
        this.db.prepare(`INSERT INTO jobs
          (id,fingerprint,bot,thread,project,resource,state,created) VALUES (?,?,?,?,?,?,'queued',?)`)
          .run(job.id, fingerprint, job.bot, job.thread, job.project, job.resource, this.now());
        for (const resource of resources) this.db.prepare('INSERT INTO job_resources(job,id) VALUES (?,?)').run(job.id, resource);
      }
      return this.get(job.id);
    });
  }
  expire() {
    // Retain resource ownership until an operator reconciles uncertain execution.
    return this.db.prepare(`UPDATE jobs SET state='uncertain',token_hash=NULL
      WHERE state IN ('running','cancelling') AND deadline<=?`).run(this.now()).changes;
  }
  reconcileStopped(id, evidence) {
    // Controller/operator API only, deliberately absent from worker HTTP routes.
    const keys = ['worker', 'generation', 'resources', 'operator', 'observedAt', 'stopSHA256', 'effectsSHA256', 'outcome'];
    if (!evidence || Object.keys(evidence).sort().join(',') !== keys.sort().join(',') ||
        !['failed', 'cancelled'].includes(evidence.outcome) ||
        !Number.isSafeInteger(evidence.generation) || evidence.generation < 1 ||
        !Number.isSafeInteger(evidence.observedAt) || evidence.observedAt > this.now() ||
        !Array.isArray(evidence.resources) || !evidence.resources.length || evidence.resources.length > 16 ||
        ![evidence.stopSHA256, evidence.effectsSHA256].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)))
      throw Error('Invalid reconciliation evidence');
    identity(evidence.worker); identity(evidence.operator);
    const resources = [...new Set(evidence.resources.map(identity))].sort();
    const body = JSON.stringify({ worker: evidence.worker, generation: evidence.generation, resources,
      operator: evidence.operator, observedAt: evidence.observedAt, stopSHA256: evidence.stopSHA256,
      effectsSHA256: evidence.effectsSHA256, outcome: evidence.outcome });
    return this.transaction(() => {
      this.expire();
      const job = this.get(id);
      const old = this.db.prepare('SELECT evidence FROM job_reconciliations WHERE job=?').get(id);
      if (old) {
        if (old.evidence !== body) throw Error('Conflicting reconciliation replay');
        return this.get(id);
      }
      if (job.state !== 'uncertain' || job.worker !== evidence.worker || job.generation !== evidence.generation ||
          evidence.observedAt < job.deadline || JSON.stringify(resources) !== JSON.stringify(job.resources))
        throw Error('Stale or foreign reconciliation');
      for (const resource of resources)
        if (this.db.prepare('SELECT job FROM resources WHERE id=?').get(resource)?.job !== id)
          throw Error('Resource ownership changed');
      this.db.prepare('INSERT INTO job_reconciliations VALUES (?,?,?)').run(id, job.generation, body);
      this.db.prepare('UPDATE jobs SET state=?,token_hash=NULL WHERE id=?').run(evidence.outcome, id);
      this.db.prepare('DELETE FROM resources WHERE job=?').run(id);
      return this.get(id);
    });
  }
  claim(id, worker, leaseMs, maxActive = 16) {
    identity(worker); milliseconds(leaseMs);
    if (!Number.isSafeInteger(maxActive) || maxActive < 1 || maxActive > 64) throw Error('Invalid capacity');
    return this.transaction(() => {
      this.expire();
      const job = this.get(id);
      if (job.state !== 'queued') throw Error('Job is not queued');
      const active = this.db.prepare(`SELECT count(*) AS n FROM jobs WHERE worker=?
        AND state IN ('running','cancelling','uncertain')`).get(worker).n;
      if (active >= maxActive) return null;
      for (const resource of job.resources)
        if (this.db.prepare('SELECT job FROM resources WHERE id=?').get(resource)) return null;
      const token = randomBytes(32).toString('hex');
      const generation = job.generation + 1;
      const deadline = this.now() + leaseMs;
      for (const resource of job.resources) this.db.prepare('INSERT INTO resources(id,job) VALUES (?,?)').run(resource, id);
      this.db.prepare(`UPDATE jobs SET state='running',worker=?,generation=?,token_hash=?,deadline=? WHERE id=?`)
        .run(worker, generation, hash(token), deadline, id);
      return { id, worker, generation, token, deadline };
    });
  }
  owned(lease) {
    if (!lease || typeof lease.token !== 'string') throw Error('Invalid lease');
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(identity(lease.id));
    if (!row || row.worker !== lease.worker || row.generation !== lease.generation ||
        row.token_hash !== hash(lease.token) || !['running', 'cancelling'].includes(row.state) ||
        row.deadline <= this.now()) throw Error('Stale or foreign lease');
    return row;
  }
  heartbeat(lease, leaseMs) {
    milliseconds(leaseMs);
    return this.transaction(() => {
      const row = this.owned(lease), deadline = this.now() + leaseMs;
      this.db.prepare('UPDATE jobs SET deadline=? WHERE id=?').run(deadline, row.id);
      return { deadline, cancellationRequested: row.state === 'cancelling' };
    });
  }
  append(lease, seq, event) {
    if (!Number.isSafeInteger(seq) || seq < 1) throw Error('Invalid event sequence');
    const body = JSON.stringify(event);
    if (typeof body !== 'string' || Buffer.byteLength(body) > 65536) throw Error('Invalid event body');
    const digest = hash(body);
    return this.transaction(() => {
      const row = this.owned(lease);
      const prior = this.db.prepare('SELECT digest FROM events WHERE job=? AND seq=?').get(row.id, seq);
      if (prior) {
        if (prior.digest !== digest) throw Error('Conflicting event replay');
        return { acknowledged: seq, replay: true };
      }
      if (seq !== row.event_seq + 1) throw Error('Event sequence gap');
      this.db.prepare('INSERT INTO events(job,seq,digest,body) VALUES (?,?,?,?)').run(row.id, seq, digest, body);
      this.db.prepare('UPDATE jobs SET event_seq=? WHERE id=?').run(seq, row.id);
      return { acknowledged: seq, replay: false };
    });
  }
  readEvents(id, afterSeq = 0, limit = 100) {
    const job = this.get(id);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error('Invalid event cursor');
    const rows = this.db.prepare('SELECT seq,body FROM events WHERE job=? AND seq>? ORDER BY seq LIMIT ?').all(id,afterSeq,limit + 1);
    const events = []; let bytes = 0;
    for (const row of rows.slice(0,limit)) {
      const size = Buffer.byteLength(row.body);
      if (bytes + size > 1024 * 1024) break;
      bytes += size; events.push({ seq:row.seq,event:JSON.parse(row.body) });
    }
    return { generation:job.generation, events, lastSeq:events.at(-1)?.seq ?? afterSeq, hasMore:rows.length > events.length };
  }
  cancel(id) {
    return this.transaction(() => {
      const job = this.get(id);
      if (job.state === 'queued') this.db.prepare("UPDATE jobs SET state='cancelled' WHERE id=?").run(id);
      else if (job.state === 'running') this.db.prepare("UPDATE jobs SET state='cancelling' WHERE id=?").run(id);
      return this.get(id);
    });
  }
  openRequest(lease, request) {
    identity(request?.requestId);
    if (!['permission', 'question'].includes(request.requestType) ||
        typeof request.tool !== 'string' || request.tool.length > 256 ||
        typeof request.summary !== 'string' || request.summary.length > 4000) throw Error('Invalid permission request');
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body) > 65536) throw Error('Permission request too large');
    return this.transaction(() => {
      const row = this.owned(lease);
      if (row.state !== 'running') throw Error('Job cancellation in progress');
      const old = this.db.prepare('SELECT body FROM permission_requests WHERE job=? AND generation=? AND id=?')
        .get(row.id, row.generation, request.requestId);
      if (old && old.body !== body) throw Error('Conflicting permission replay');
      if (!old) {
        const count = this.db.prepare('SELECT count(*) AS n FROM permission_requests WHERE job=? AND generation=?')
          .get(row.id, row.generation).n;
        if (count >= 1000) throw Error('Permission request limit');
        this.db.prepare('INSERT INTO permission_requests(job,generation,id,body) VALUES (?,?,?,?)')
          .run(row.id, row.generation, request.requestId, body);
      }
      return { requestId: request.requestId, generation: row.generation };
    });
  }
  pendingRequests(id) {
    this.get(id);
    return this.db.prepare(`SELECT p.id,p.generation,p.body FROM permission_requests p JOIN jobs j ON j.id=p.job
      WHERE p.job=? AND p.generation=j.generation AND p.decision IS NULL
      AND j.state='running' AND j.deadline>? ORDER BY p.rowid LIMIT 100`)
      .all(id, this.now()).map(p => ({ requestId: p.id, generation: p.generation, request: JSON.parse(p.body) }));
  }
  decideRequest(id, generation, requestId, decision) {
    identity(requestId);
    if (!decision || Object.keys(decision).some(k => !['behavior', 'message'].includes(k)) ||
        !['allow', 'deny', 'answer'].includes(decision.behavior) ||
        (decision.message !== undefined && (typeof decision.message !== 'string' || decision.message.length > 4000)))
      throw Error('Invalid one-shot decision');
    return this.transaction(() => {
      const job = this.get(id);
      if (job.state !== 'running' || job.generation !== generation || job.deadline <= this.now()) throw Error('Stale request');
      const request = this.db.prepare('SELECT body,decision FROM permission_requests WHERE job=? AND generation=? AND id=?')
        .get(id, generation, requestId);
      if (!request) throw Error('Unknown request');
      const kind = JSON.parse(request.body).requestType;
      if ((kind === 'permission' && decision.behavior === 'answer') || (kind === 'question' && decision.behavior === 'allow'))
        throw Error('Decision does not match request');
      const body = JSON.stringify(decision);
      if (request.decision && request.decision !== body) throw Error('Conflicting decision replay');
      this.db.prepare('UPDATE permission_requests SET decision=? WHERE job=? AND generation=? AND id=?')
        .run(body, id, generation, requestId);
      return { requestId, generation, recorded: true };
    });
  }
  pollRequest(lease, requestId) {
    return this.transaction(() => {
      const row = this.owned(lease);
      if (row.state !== 'running') return { decision: { behavior: 'deny' } };
      const request = this.db.prepare('SELECT decision FROM permission_requests WHERE job=? AND generation=? AND id=?')
        .get(row.id, row.generation, identity(requestId));
      if (!request) throw Error('Unknown request');
      return { decision: request.decision ? JSON.parse(request.decision) : null };
    });
  }
  putArtifact(lease, bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024) throw Error('Invalid artifact bytes');
    const sha256 = hash(bytes);
    return this.transaction(() => {
      const row = this.owned(lease);
      const prior = this.db.prepare('SELECT bytes FROM artifacts WHERE job=? AND generation=? AND sha256=?')
        .get(row.id, row.generation, sha256);
      if (prior && !Buffer.from(prior.bytes).equals(bytes)) throw Error('Artifact digest collision');
      if (!prior) {
        const usage = this.db.prepare('SELECT count(*) AS n,coalesce(sum(length(bytes)),0) AS size FROM artifacts WHERE job=?')
          .get(row.id);
        if (usage.n >= 64 || usage.size + bytes.length > 32 * 1024 * 1024) throw Error('Artifact storage limit');
        this.db.prepare('INSERT INTO artifacts(job,generation,sha256,bytes) VALUES (?,?,?,?)')
          .run(row.id, row.generation, sha256, bytes);
      }
      return { sha256, bytes: bytes.length };
    });
  }
  acknowledgeRequest(lease, requestId, outcome) {
    if (!['allowed-once', 'rejected', 'answered', 'unavailable'].includes(outcome)) throw Error('Invalid request outcome');
    return this.transaction(() => {
      const row = this.owned(lease);
      const request = this.db.prepare('SELECT decision FROM permission_requests WHERE job=? AND generation=? AND id=?')
        .get(row.id, row.generation, identity(requestId));
      if (!request?.decision) throw Error('No recorded decision');
      const decision = JSON.parse(request.decision);
      if ((outcome === 'allowed-once' && (decision.behavior !== 'allow' || row.state !== 'running')) ||
          (outcome === 'answered' && (decision.behavior !== 'answer' || row.state !== 'running')))
        throw Error('Outcome does not match decision');
      const prior = this.db.prepare('SELECT outcome FROM request_delivery WHERE job=? AND generation=? AND request=?')
        .get(row.id, row.generation, requestId);
      if (prior && prior.outcome !== outcome) throw Error('Conflicting acknowledgement');
      this.db.prepare('INSERT OR IGNORE INTO request_delivery(job,generation,request,outcome) VALUES (?,?,?,?)')
        .run(row.id, row.generation, requestId, outcome);
      return { acknowledged: true };
    });
  }
  requestDelivery(id, generation, requestId) {
    const job = this.get(id);
    if (job.generation !== generation) throw Error('Stale generation');
    const request = this.db.prepare('SELECT decision FROM permission_requests WHERE job=? AND generation=? AND id=?')
      .get(id, generation, identity(requestId));
    if (!request) throw Error('Unknown request');
    const ack = this.db.prepare('SELECT outcome FROM request_delivery WHERE job=? AND generation=? AND request=?')
      .get(id, generation, requestId);
    if (ack) return { outcome: ack.outcome };
    if (!['running', 'cancelling'].includes(job.state) || job.deadline <= this.now()) return { outcome: 'unavailable' };
    return { outcome: null };
  }
  unfinishedToolCalls(id, generation) {
    const job = this.get(id);
    if (job.generation !== generation) throw Error('Stale generation');
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worker_tool_calls'").get()) return [];
    return this.db.prepare("SELECT id,tool,state FROM worker_tool_calls WHERE job=? AND generation=? AND state IN ('pending','dispatching','uncertain') ORDER BY id").all(id,generation);
  }
  finish(lease, outcome, artifact) {
    if (!['completed', 'failed', 'cancelled'].includes(outcome)) throw Error('Invalid outcome');
    if (!artifact || Object.keys(artifact).sort().join(',') !== 'bytes,sha256' ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0)
      throw Error('Invalid artifact receipt');
    return this.transaction(() => {
      const row = this.owned(lease);
      if (this.unfinishedToolCalls(row.id,row.generation).length)
        throw Error('Unfinished controller tool operations require reconciliation');
      if (row.state === 'cancelling' && outcome !== 'cancelled') throw Error('Cancellation requires reconciliation');
      if (outcome === 'completed') {
        const stored = this.db.prepare('SELECT bytes FROM artifacts WHERE job=? AND generation=? AND sha256=?')
          .get(row.id, row.generation, artifact.sha256);
        if (!stored || stored.bytes.length !== artifact.bytes || hash(stored.bytes) !== artifact.sha256)
          throw Error('Unverified completion artifact');
      }
      this.db.prepare('UPDATE jobs SET state=?,result=?,token_hash=NULL WHERE id=?')
        .run(outcome, JSON.stringify(artifact), row.id);
      this.db.prepare('DELETE FROM resources WHERE job=?').run(row.id);
      return this.get(row.id);
    });
  }
}
