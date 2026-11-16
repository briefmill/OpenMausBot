import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JobLedger } from './ledger.mjs';
import { listenTransport } from './transport.mjs';
import { workerClient } from './worker-client.mjs';

test('provider permission travels over HTTP to controller before any action', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maus-roundtrip-'));
  const ledger = new JobLedger(join(dir, 'jobs.db'));
  const controllerToken = randomBytes(32).toString('hex'), workerToken = randomBytes(32).toString('hex');
  const assignment = { bot: 'bot1', thread: 'thread1', project: 'briefmill', resource: 'desktop:bot1', resources: ['worktree:bot1'] };
  const transport = await listenTransport({ ledger, controllerToken, workers: [{ id: 'worker1', token: workerToken, capacity: 1, assignments: [assignment] }] });
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 3000);
  let running, listener, responses = 0, actions = 0;
  const emit = event => listener?.({ eventId: event.type, provider: 'fixture', threadId: 'thread1', turnId: 'turn1', ...event });
  const adapter = {
    capabilities: { engineAdmission: true },
    onEvent(fn) { listener = fn; return () => { listener = undefined; }; },
    async sendTurn(input) {
      await input.engineAdmission('process');
      emit({ type: 'request.opened', requestId: 'r1', requestType: 'permission', tool: 'mcp__gmail__send_email',
        summary: 'Send', requiresExplicitApproval: true, commandLine: 'private-command', raw: { secret: 'private-raw' } });
      return { turnId: 'turn1' };
    },
    async interruptTurn() { emit({ type: 'turn.completed', ok: false }); },
    async respondToRequest(thread, id, decision) {
      responses++; if (decision.behavior === 'allow') actions++;
      emit({ type: 'turn.completed', ok: true }); return 'rejected';
    },
  };
  const controller = async (path, body) => {
    const r = await fetch(transport.origin + path, { method: body ? 'POST' : 'GET', signal: abort.signal,
      headers: { authorization: `Bearer ${controllerToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    assert.equal(r.status, 200); return r.json();
  };
  try {
    await controller('/v1/jobs', { id: 'one', ...assignment });
    running = workerClient({ origin: transport.origin, token: workerToken, pollMs: 5, heartbeatMs: 10 }).run({
      jobId: 'one', adapter, signal: abort.signal,
      input: { botId: 'bot1', threadId: 'thread1', text: 'fixture', approvalMode: 'ask', toolScope: {},
        mcpFromUserConfig: false, engineAdmission: async () => {}, approvalModeNow: () => 'ask' },
    });
    running.catch(() => {});
    let pending;
    while (!(pending = (await controller('/v1/jobs/one/requests')).requests[0])) await delay(5, undefined, { signal: abort.signal });
    assert.equal(responses, 0); assert.equal(actions, 0);
    assert.equal(pending.request.tool, 'mcp__gmail__send_email');
    assert.equal(pending.request.requiresExplicitApproval, true);
    assert.equal(Object.hasOwn(pending.request, 'raw'), false);
    assert.equal(pending.request.commandLine, 'private-command');
    await controller('/v1/jobs/one/requests/r1/decision', { generation: pending.generation, decision: { behavior: 'deny' } });
    const result = await running;
    assert.equal(result.result.ok, true);
    assert.equal(responses, 1); assert.equal(actions, 0);
    assert.deepEqual(await controller('/v1/jobs/one/requests/r1/result', { generation: pending.generation }), { outcome: 'rejected' });
    const display = ledger.db.prepare('SELECT body FROM events WHERE job=?').all('one').map(r => r.body).join('');
    assert.equal(display.includes('private-command'), false);
    assert.equal(display.includes('private-raw'), false);
    assert.equal(ledger.get('one').state, 'running'); // Delivery still awaits artifact verification.
  } finally {
    abort.abort(); await running?.catch(() => {}); clearTimeout(timeout);
    await transport.close(); ledger.close(); rmSync(dir, { recursive: true, force: true });
  }
});
test('controller-owned lease starts once and rejects forged or replayed execution',async()=>{
  const ledger=new JobLedger(':memory:'),controllerToken=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex');
  const assignment={bot:'bot',thread:'thread',project:'project',resource:'desktop'};
  const transport=await listenTransport({ledger,controllerToken,workers:[{id:'worker',token,capacity:1,assignments:[assignment]}]});
  let listener,starts=0;const adapter={capabilities:{engineAdmission:true},onEvent(fn){listener=fn;return()=>{listener=null;}},
    async sendTurn(){starts++;setImmediate(()=>listener?.({eventId:'done',provider:'fixture',type:'turn.completed',threadId:'thread',turnId:'turn',ok:true}));return{turnId:'turn'};},async interruptTurn(){}};
  const input={botId:'bot',threadId:'thread',text:'Synthetic',approvalMode:'ask',toolScope:{},mcpFromUserConfig:false,
    engineAdmission:async()=>{},approvalModeNow:()=> 'ask'};
  const client=workerClient({origin:transport.origin,token});
  try{
    ledger.enqueue({id:'job',...assignment});const lease=ledger.claim('job','worker',30000);
    await assert.rejects(client.run({jobId:'job',adapter,input,lease:{...lease,token:'f'.repeat(64)},signal:AbortSignal.timeout(3000)}),/rejected/);
    assert.equal(starts,0);
    const first=await client.run({jobId:'job',adapter,input,lease,signal:AbortSignal.timeout(3000)});
    assert.equal(first.result.ok,true);assert.equal(starts,1);assert.equal(ledger.get('job').generation,1);
    await assert.rejects(client.run({jobId:'job',adapter,input,lease,signal:AbortSignal.timeout(3000)}),/already started/);
    assert.equal(starts,1);
    await assert.rejects(client.run({jobId:'job',adapter,input,lease:{...lease,id:'foreign'},signal:AbortSignal.timeout(3000)}),/controller-owned/);
  }finally{client.close();await transport.close();ledger.close();}
});
