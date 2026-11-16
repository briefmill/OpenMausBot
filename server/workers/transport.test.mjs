import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobLedger } from './ledger.mjs';
import { listenTransport } from './transport.mjs';
import { request } from 'node:http';

const token = () => randomBytes(32).toString('hex');
const assignment = { bot: 'briefmill-email', thread: 'email-task', project: 'briefmill', resource: 'desktop:briefmill-email' };
const receipt = { bytes: 1, sha256: 'b'.repeat(64) };
async function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'maus-transport-'));
  const ledger = new JobLedger(join(dir, 'jobs.db'), options);
  const controller = token(), worker = token(), other = token();
  const workers = [
    { id: 'worker1', token: worker, capacity: 1, assignments: [assignment, { ...assignment, resource: 'desktop:second' }] },
    { id: 'worker2', token: other, capacity: 1, assignments: [{ ...assignment, bot: 'personal-email', project: 'personal' }] },
  ];
  const transport = await listenTransport({ ledger, controllerToken: controller, workers, leaseMs: 1000 });
  t.after(async () => { await transport.close(); ledger.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, credential, body, headers = {}) => {
    const r = await fetch(transport.origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
  };
  return { ledger, workers, controller, worker, other, call, origin: transport.origin };
}

test('real HTTP flow binds job, worker, events, cancellation and receipt', async t => {
  const f = await setup(t);
  assert.equal((await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment })).status, 200);
  const claimed = await f.call('/v1/jobs/one/claim', f.worker, {});
  assert.equal(claimed.status, 200);
  const { generation, token } = claimed.body.lease;
  assert.equal((await f.call('/v1/jobs/one/events', f.worker, { generation, token, seq: 1, event: { kind: 'started' } })).status, 200);
  assert.equal((await f.call('/v1/jobs/one/cancel', f.controller, {})).body.job.state, 'cancelling');
  assert.equal((await f.call('/v1/jobs/one/heartbeat', f.worker, { generation, token })).body.cancellationRequested, true);
  assert.equal((await f.call('/v1/jobs/one/finish', f.worker, { generation, token, outcome: 'cancelled', artifact: receipt })).status, 403);
  const read = await f.call('/v1/jobs/one', f.controller);
  assert.equal(read.body.job.state, 'cancelling');
  assert.equal(read.cache, 'no-store');
  assert.equal(JSON.stringify(read.body).includes(token), false);
});

test('unauthenticated callers and worker control-plane mutations fail', async t => {
  const f = await setup(t);
  assert.equal((await f.call('/v1/jobs', 'invalid', { id: 'one', ...assignment })).status, 401);
  assert.equal((await f.call('/v1/jobs', f.worker, { id: 'one', ...assignment })).status, 403);
  await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment });
  assert.equal((await f.call('/v1/jobs/one/cancel', f.worker, {})).status, 403);
  assert.equal((await f.call('/v1/jobs/one/claim', f.controller, {})).status, 403);
});

test('foreign bot, thread, project and resource jobs remain inaccessible', async t => {
  const f = await setup(t);
  for (const [key, value] of Object.entries({ bot: 'other', thread: 'other', project: 'personal', resource: 'desktop:foreign' })) {
    const id = `foreign-${key}`;
    await f.call('/v1/jobs', f.controller, { id, ...assignment, [key]: value });
    assert.equal((await f.call(`/v1/jobs/${id}`, f.worker)).status, 403);
    assert.equal((await f.call(`/v1/jobs/${id}/claim`, f.worker, {})).status, 403);
  }
});

test('worker cannot forge another worker or extend its capacity', async t => {
  const f = await setup(t);
  await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment });
  await f.call('/v1/jobs', f.controller, { id: 'two', ...assignment, resource: 'desktop:second' });
  assert.equal((await f.call('/v1/jobs/one/claim', f.worker, { worker: 'worker2', capacity: 64 })).status, 400);
  const claimed = await f.call('/v1/jobs/one/claim', f.worker, {});
  assert.equal(claimed.status, 200);
  assert.equal((await f.call('/v1/jobs/two/claim', f.worker, {})).status, 409);
  assert.equal((await f.call('/v1/jobs/one/heartbeat', f.other, {
    generation: claimed.body.lease.generation, token: claimed.body.lease.token,
  })).status, 403);
});

test('browser origins, host overrides and oversized input fail closed', async t => {
  const f = await setup(t);
  assert.equal((await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment }, { origin: 'https://untrusted.example' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(f.origin + '/v1/jobs/one', {
      headers: { authorization: `Bearer ${f.controller}`, host: 'untrusted.example' },
    }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
    req.once('error', reject); req.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await f.call('/v1/jobs', f.controller, { oversized: 'a'.repeat(71000) })).status, 413);
});

test('registration snapshot prevents caller-side assignment widening', async t => {
  const f = await setup(t);
  const foreign = { ...assignment, project: 'personal' };
  f.workers[0].assignments.push(foreign);
  f.workers[0].capacity = 64;
  await f.call('/v1/jobs', f.controller, { id: 'foreign', ...foreign });
  assert.equal((await f.call('/v1/jobs/foreign', f.worker)).status, 403);
});

test('uncertain jobs retain worker capacity after lease expiry', async t => {
  let clock = 1000;
  const f = await setup(t, { now: () => clock });
  await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment });
  await f.call('/v1/jobs', f.controller, { id: 'two', ...assignment, resource: 'desktop:second' });
  await f.call('/v1/jobs/one/claim', f.worker, {});
  clock += 1000;
  assert.equal((await f.call('/v1/jobs/two/claim', f.worker, {})).status, 409);
  assert.equal(f.ledger.get('one').state, 'uncertain');
});

test('only the controller records one-shot permission decisions', async t => {
  const f = await setup(t);
  await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment });
  const { body: { lease } } = await f.call('/v1/jobs/one/claim', f.worker, {});
  const auth = { generation: lease.generation, token: lease.token };
  const request = { requestId: 'r1', requestType: 'permission', tool: 'send', summary: 'Send' };
  assert.equal((await f.call('/v1/jobs/one/requests', f.worker, { ...auth, request })).status, 200);
  assert.equal((await f.call('/v1/jobs/one/requests/r1/poll', f.worker, auth)).body.decision, null);
  assert.equal((await f.call('/v1/jobs/one/requests', f.worker)).status, 403);
  assert.equal((await f.call('/v1/jobs/one/requests/r1/decision', f.worker, { generation: 1, decision: { behavior: 'allow' } })).status, 403);
  assert.equal((await f.call('/v1/jobs/one/requests/r1/decision', f.controller, { generation: 1, decision: { behavior: 'allow', always: true } })).status, 409);
  assert.equal((await f.call('/v1/jobs/one/requests', f.controller)).body.requests[0].request.tool, 'send');
  assert.equal((await f.call('/v1/jobs/one/requests/r1/decision', f.controller, { generation: 1, decision: { behavior: 'deny' } })).status, 200);
  assert.deepEqual((await f.call('/v1/jobs/one/requests/r1/poll', f.worker, auth)).body.decision, { behavior: 'deny' });
});

test('a worker cannot acquire an unregistered secondary worktree', async t => {
  const f = await setup(t);
  await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment, resources: ['worktree:foreign'] });
  assert.equal((await f.call('/v1/jobs/one/claim', f.worker, {})).status, 403);
});

test('uploaded artifacts cannot authorize HTTP resource release', async t => {
  const f = await setup(t);
  await f.call('/v1/jobs', f.controller, { id: 'one', ...assignment });
  const { body: { lease } } = await f.call('/v1/jobs/one/claim', f.worker, {});
  const auth = { generation: lease.generation, token: lease.token };
  assert.equal((await f.call('/v1/jobs/one/finish', f.worker, { ...auth, outcome: 'completed', artifact: receipt })).status, 403);
  const uploaded = await f.call('/v1/jobs/one/artifacts', f.worker, { ...auth, base64: Buffer.from('output').toString('base64') });
  assert.equal(uploaded.status, 200);
  assert.equal((await f.call('/v1/jobs/one/artifacts', f.worker, { ...auth, base64: '../bad!' })).status, 400);
  assert.equal((await f.call('/v1/jobs/one/finish', f.worker, { ...auth, outcome: 'completed', artifact: uploaded.body.artifact })).status, 403);
  assert.equal((await f.call('/v1/jobs/one/finish', f.controller, { ...auth, outcome: 'completed', artifact: uploaded.body.artifact })).status, 403);
  assert.equal(f.ledger.get('one').state, 'running');
  f.ledger.enqueue({ id:'competing', ...assignment });
  assert.equal(f.ledger.claim('competing','worker2',1000), null);
});
