import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobLedger } from './ledger.mjs';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

const job = (id, resource = `desktop:${id}`) => ({ id, bot: `bot:${id}`, thread: `thread:${id}`, project: 'briefmill', resource });
const artifact = { bytes: 12, sha256: 'a'.repeat(64) };
const completed = (ledger, lease) => ledger.finish(lease, 'completed', ledger.putArtifact(lease, Buffer.from('verified output')));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'maus-ledger-'));
  let clock = 1000;
  const file = join(dir, 'jobs.db');
  let ledger = new JobLedger(file, { now: () => clock });
  t.after(() => { ledger.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    get ledger() { return ledger; },
    advance: ms => { clock += ms; },
    reopen: () => { ledger.close(); ledger = new JobLedger(file, { now: () => clock }); return ledger; },
    file,
  };
}

test('34 independent durable jobs can hold leases before any completion', t => {
  const f = fixture(t), leases = [];
  for (let i = 0; i < 34; i++) {
    const id = `j${i}`;
    f.ledger.enqueue(job(id));
    leases.push(f.ledger.claim(id, `worker${i}`, 1000));
  }
  assert.equal(new Set(leases.map(x => x.token)).size, 34);
  f.reopen();
  for (const lease of leases) {
    assert.equal(f.ledger.get(lease.id).state, 'running');
    assert.equal(completed(f.ledger, lease).state, 'completed');
  }
});

test('idempotent job replay preserves ownership and rejects changed identity', t => {
  const { ledger } = fixture(t);
  ledger.enqueue(job('one'));
  const lease = ledger.claim('one', 'worker', 1000);
  assert.equal(ledger.enqueue(job('one')).state, 'running');
  assert.throws(() => ledger.enqueue({ ...job('one'), project: 'personal' }), /Conflicting/);
  assert.throws(() => ledger.claim('one', 'other', 1000), /not queued/);
  assert.equal(ledger.heartbeat(lease, 1000).cancellationRequested, false);
});

test('two database connections cannot share a desktop or worktree', t => {
  const f = fixture(t), other = new JobLedger(f.file, { now: () => 1000 });
  try {
  f.ledger.enqueue(job('one', 'desktop:shared'));
  other.enqueue({ ...job('two', 'desktop:shared'), project: 'personal' });
  const lease = f.ledger.claim('one', 'worker1', 1000);
  assert.equal(other.claim('two', 'worker2', 1000), null);
  completed(f.ledger, lease);
  assert.ok(other.claim('two', 'worker2', 1000));
  } finally { other.close(); }
});

test('expired execution stays uncertain and holds its desktop after restart', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one', 'desktop:shared'));
  f.ledger.enqueue(job('two', 'desktop:shared'));
  const lease = f.ledger.claim('one', 'worker', 100);
  f.advance(100); f.reopen();
  assert.equal(f.ledger.claim('two', 'other', 100), null);
  assert.equal(f.ledger.get('one').state, 'uncertain');
  assert.throws(() => completed(f.ledger, lease), /Stale/);
  assert.throws(() => f.ledger.heartbeat(lease, 100), /Stale/);
});

test('worker, generation and token fence foreign results', t => {
  const { ledger } = fixture(t);
  ledger.enqueue(job('one'));
  const lease = ledger.claim('one', 'worker', 1000);
  for (const change of [{ worker: 'other' }, { generation: 2 }, { token: 'different' }]) {
    assert.throws(() => ledger.finish({ ...lease, ...change }, 'completed', artifact), /Stale/);
  }
  assert.equal(ledger.get('one').state, 'running');
  assert.equal(Object.hasOwn(ledger.get('one'), 'token_hash'), false);
});

test('event acknowledgements survive restart and reject gaps or conflicting replay', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one'));
  const lease = f.ledger.claim('one', 'worker', 1000);
  assert.deepEqual(f.ledger.append(lease, 1, { text: 'started' }), { acknowledged: 1, replay: false });
  f.reopen();
  assert.deepEqual(f.ledger.append(lease, 1, { text: 'started' }), { acknowledged: 1, replay: true });
  assert.throws(() => f.ledger.append(lease, 1, { text: 'changed' }), /Conflicting/);
  assert.throws(() => f.ledger.append(lease, 3, {}), /gap/);
  assert.throws(() => f.ledger.append(lease, 2, 'a'.repeat(65537)), /body/);
});

test('cancellation retains ownership until worker acknowledges it', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one', 'worktree:shared'));
  f.ledger.enqueue(job('two', 'worktree:shared'));
  const lease = f.ledger.claim('one', 'worker', 1000);
  assert.equal(f.ledger.cancel('one').state, 'cancelling');
  assert.equal(f.ledger.heartbeat(lease, 1000).cancellationRequested, true);
  assert.equal(f.ledger.claim('two', 'other', 1000), null);
  assert.throws(() => completed(f.ledger, lease), /reconciliation/);
  assert.equal(f.ledger.finish(lease, 'cancelled', artifact).state, 'cancelled');
  assert.ok(f.ledger.claim('two', 'other', 1000));
});

test('queued cancellation and malformed jobs cannot acquire leases', t => {
  const { ledger } = fixture(t);
  assert.throws(() => ledger.enqueue({ ...job('bad'), extra: 'ignored' }), /Invalid/);
  assert.throws(() => ledger.enqueue(job('../escape')), /Invalid/);
  ledger.enqueue(job('one'));
  assert.equal(ledger.cancel('one').state, 'cancelled');
  assert.throws(() => ledger.claim('one', 'worker', 1000), /not queued/);
});

test('simultaneous independent threads acquire exactly one shared resource', async t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one', 'desktop:contended'));
  f.ledger.enqueue(job('two', 'desktop:contended'));
  const workers = ['one', 'two'].map(id => new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{
      const {JobLedger}=await import(workerData.module);
      const ledger=new JobLedger(workerData.file);
      parentPort.once('message',()=>{
        try {parentPort.postMessage({claimed:!!ledger.claim(workerData.id,workerData.id,60000)});}
        catch(error){parentPort.postMessage({error:error.message});}
        finally{ledger.close();parentPort.close();}
      });
      parentPort.postMessage({ready:true});
    })().catch(error=>{throw error});
  `, { eval: true, workerData: { id, file: f.file, module: new URL('./ledger.mjs', import.meta.url).href } }));
  try {
    await Promise.all(workers.map(async w => assert.equal((await once(w, 'message'))[0].ready, true)));
    const outcomes = workers.map(w => once(w, 'message'));
    for (const w of workers) w.postMessage('claim');
    const replies = (await Promise.all(outcomes)).map(([r]) => r);
    assert.equal(replies.some(r => r.error), false, JSON.stringify(replies));
    assert.equal(replies.filter(r => r.claimed).length, 1);
  } finally { await Promise.all(workers.map(w => w.terminate())); }
});

test('one-shot permission survives restart and rejects identity or decision replay changes', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one'));
  const lease = f.ledger.claim('one', 'worker', 1000);
  const request = { requestId: 'r1', requestType: 'permission', tool: 'mcp__gmail__send_email', summary: 'Send' };
  f.ledger.openRequest(lease, request);
  f.reopen();
  assert.equal(f.ledger.pendingRequests('one')[0].request.tool, request.tool);
  assert.deepEqual(f.ledger.pollRequest(lease, 'r1'), { decision: null });
  assert.throws(() => f.ledger.openRequest(lease, { ...request, tool: 'other' }), /Conflicting/);
  assert.throws(() => f.ledger.decideRequest('one', 1, 'r1', { behavior: 'allow', always: true }), /one-shot/);
  f.ledger.decideRequest('one', 1, 'r1', { behavior: 'deny' });
  f.reopen();
  assert.deepEqual(f.ledger.pollRequest(lease, 'r1'), { decision: { behavior: 'deny' } });
  assert.throws(() => f.ledger.decideRequest('one', 1, 'r1', { behavior: 'allow' }), /Conflicting/);
});

test('expired or cancelled permissions cannot release a stored approval', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one'));
  const lease = f.ledger.claim('one', 'worker', 1000);
  f.ledger.openRequest(lease, { requestId: 'r1', requestType: 'permission', tool: 'send', summary: 'Send' });
  f.ledger.decideRequest('one', 1, 'r1', { behavior: 'allow' });
  f.ledger.cancel('one');
  assert.deepEqual(f.ledger.pollRequest(lease, 'r1'), { decision: { behavior: 'deny' } });
  f.advance(1000);
  assert.throws(() => f.ledger.pollRequest(lease, 'r1'), /Stale/);
  assert.throws(() => f.ledger.decideRequest('one', 1, 'r1', { behavior: 'allow' }), /Stale/);
});

test('desktop and worktree acquisition is atomic across independent jobs', t => {
  const { ledger } = fixture(t);
  ledger.enqueue({ ...job('one', 'desktop:one'), resources: ['worktree:shared'] });
  ledger.enqueue({ ...job('two', 'desktop:two'), resources: ['worktree:shared'] });
  ledger.enqueue(job('three', 'desktop:two'));
  const one = ledger.claim('one', 'w1', 1000);
  assert.equal(ledger.claim('two', 'w2', 1000), null);
  // A failed bundle claim must not leave desktop:two partially owned.
  const three = ledger.claim('three', 'w3', 1000);
  assert.ok(three);
  completed(ledger, one);
  assert.equal(ledger.claim('two', 'w2', 1000), null);
  completed(ledger, three);
  assert.ok(ledger.claim('two', 'w2', 1000));
  assert.throws(() => ledger.enqueue({ ...job('two', 'desktop:two'), resources: ['worktree:other'] }), /Conflicting/);
});

test('migration preserves an active single-resource lease and replay identity', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one'));
  const lease = f.ledger.claim('one', 'w1', 1000);
  f.ledger.db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE legacy_resources(id TEXT PRIMARY KEY,job TEXT NOT NULL UNIQUE REFERENCES jobs(id));
    INSERT INTO legacy_resources SELECT * FROM resources;
    DROP TABLE resources;
    ALTER TABLE legacy_resources RENAME TO resources;
    DROP TABLE job_resources;
    PRAGMA user_version=0;
    COMMIT;`);
  f.reopen();
  assert.deepEqual(f.ledger.get('one').resources, ['desktop:one']);
  assert.equal(f.ledger.enqueue(job('one')).state, 'running');
  assert.equal(completed(f.ledger, lease).state, 'completed');
});

test('completion requires the original stored artifact bytes for that job', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one')); f.ledger.enqueue(job('two'));
  const one = f.ledger.claim('one', 'w1', 1000), two = f.ledger.claim('two', 'w2', 1000);
  const receipt = f.ledger.putArtifact(one, Buffer.from('actual deliverable'));
  assert.deepEqual(f.ledger.putArtifact(one, Buffer.from('actual deliverable')), receipt);
  assert.throws(() => f.ledger.finish(two, 'completed', receipt), /Unverified/);
  assert.throws(() => f.ledger.finish(one, 'completed', { ...receipt, bytes: receipt.bytes + 1 }), /Unverified/);
  f.reopen();
  assert.equal(f.ledger.finish(one, 'completed', receipt).state, 'completed');
  assert.throws(() => f.ledger.putArtifact(two, Buffer.alloc(8 * 1024 * 1024 + 1)), /Invalid artifact/);
});

test('saved approval stays pending until provider acknowledgement survives restart', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one')); const lease = f.ledger.claim('one', 'w1', 1000);
  f.ledger.openRequest(lease, { requestId: 'r1', requestType: 'permission', tool: 'read', summary: 'Read' });
  f.ledger.decideRequest('one', 1, 'r1', { behavior: 'allow' });
  assert.deepEqual(f.ledger.requestDelivery('one', 1, 'r1'), { outcome: null });
  f.ledger.acknowledgeRequest(lease, 'r1', 'allowed-once');
  f.reopen();
  assert.deepEqual(f.ledger.requestDelivery('one', 1, 'r1'), { outcome: 'allowed-once' });
  assert.throws(() => f.ledger.acknowledgeRequest(lease, 'r1', 'rejected'), /Conflicting/);
});

test('undelivered or mismatched decisions never report accepted approval', t => {
  const f = fixture(t);
  f.ledger.enqueue(job('one')); const lease = f.ledger.claim('one', 'w1', 1000);
  f.ledger.openRequest(lease, { requestId: 'r1', requestType: 'permission', tool: 'send', summary: 'Send' });
  f.ledger.decideRequest('one', 1, 'r1', { behavior: 'deny' });
  assert.throws(() => f.ledger.acknowledgeRequest(lease, 'r1', 'allowed-once'), /does not match/);
  f.advance(1000);
  assert.throws(() => f.ledger.acknowledgeRequest(lease, 'r1', 'rejected'), /Stale/);
  assert.deepEqual(f.ledger.requestDelivery('one', 1, 'r1'), { outcome: 'unavailable' });
});
