import test from 'node:test';
import assert from 'node:assert/strict';
import { runProviderTurn } from './provider-runner.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const input = () => ({ botId: 'bot1', threadId: 'thread1', text: 'Scoped task', approvalMode: 'ask',
  toolScope: { kind: 'test-scope' }, mcpFromUserConfig: false, approvalModeNow: () => 'ask',
  engineAdmission: async () => {}, integrations: { custom: { scoped: { type: 'http', url: 'https://example.invalid/mcp', headers: {} } } } });
function provider(start, { terminalOnStop = true } = {}) {
  let listener; let count = 0;
  const calls = { responses: [], interrupts: [], dispatched: [], actions: [] };
  const emit = patch => listener?.({ eventId: `e${++count}`, threadId: 'thread1', turnId: 'turn1', provider: 'fixture', ...patch });
  const adapter = {
    capabilities: { engineAdmission: true },
    onEvent: fn => { listener = fn; return () => { listener = undefined; }; },
    sendTurn: async value => { calls.dispatched.push(value); await value.engineAdmission('process'); start?.(emit); return { turnId: 'turn1' }; },
    interruptTurn: async (thread, turn) => { calls.interrupts.push({ thread, turn }); if (terminalOnStop) emit({ type: 'turn.completed', ok: false }); },
    respondToRequest: async (thread, request, decision) => {
      calls.responses.push({ thread, request, decision });
      if (decision.behavior === 'allow') calls.actions.push(request);
      emit({ type: 'turn.completed', ok: true });
      return decision.behavior === 'allow' ? 'allowed-once' : 'rejected';
    },
  };
  return { adapter, calls, emit };
}
const request = { type: 'request.opened', requestId: 'request1', requestType: 'permission', tool: 'mcp__gmail__send_email',
  summary: 'Send email', requiresExplicitApproval: true, command: { command: 'original', cwd: '/own' } };
const options = p => ({ adapter: p.adapter, input: input(), checkLease: async () => ({ cancellationRequested: false }),
  forwardEvent: async () => {}, decidePermission: async () => ({ behavior: 'deny' }),
  signal: AbortSignal.timeout(2000), heartbeatMs: 5 });

test('provider input and original permission identity reach controller unchanged', async () => {
  const p = provider(emit => emit(request)), events = [], decisions = [];
  const opts = { ...options(p), forwardEvent: async e => { events.push(e); }, decidePermission: async e => {
    decisions.push(e); return { behavior: 'deny' };
  } };
  const result = await runProviderTurn(opts);
  assert.equal(result.ok, true);
  assert.equal(p.calls.dispatched[0], opts.input);
  assert.equal(decisions[0].tool, request.tool);
  assert.deepEqual(decisions[0].command, request.command);
  assert.equal(decisions[0].requiresExplicitApproval, true);
  assert.equal(events[0], decisions[0]);
  assert.equal(p.calls.actions.length, 0);
});

test('pending controller decision cannot execute a send', async () => {
  const pending = deferred(), arrived = deferred(), p = provider(emit => emit(request));
  const result = runProviderTurn({ ...options(p), decidePermission: async () => { arrived.resolve(); return pending.promise; } });
  await arrived.promise;
  assert.equal(p.calls.actions.length, 0);
  assert.equal(p.calls.responses.length, 0);
  pending.resolve({ behavior: 'allow' });
  await result;
  assert.deepEqual(p.calls.actions, ['request1']);
  assert.deepEqual(p.calls.responses[0].decision, { behavior: 'allow' });
});

test('worker rejects permanent permission grants', async () => {
  const p = provider(emit => emit(request));
  await assert.rejects(runProviderTurn({ ...options(p), decidePermission: async () => ({ behavior: 'allow', always: true }) }), /Invalid controller/);
  assert.equal(p.calls.actions.length, 0);
  assert.equal(p.calls.interrupts.length, 1);
});

test('foreign turns cannot end execution or ask for permission', async () => {
  const p = provider(emit => {
    emit({ ...request, turnId: 'foreign' });
    emit({ type: 'turn.completed', ok: true, threadId: 'foreign' });
    emit({ type: 'turn.completed', ok: false });
  });
  const result = await runProviderTurn(options(p));
  assert.equal(result.ok, false);
  assert.equal(p.calls.responses.length, 0);
});

test('heartbeat observes cancellation even when provider emits nothing', async () => {
  const p = provider(); let cancel = false;
  const timer = setTimeout(() => { cancel = true; }, 15);
  try {
    const result = await runProviderTurn({ ...options(p), checkLease: async () => ({ cancellationRequested: cancel }) });
    assert.equal(result.cancelled, true);
    assert.equal(p.calls.interrupts.length, 1);
  } finally { clearTimeout(timer); }
});

test('lease loss stops a pending permission wait without an approval', async () => {
  const p = provider(emit => emit(request)); let lost = false;
  await assert.rejects(runProviderTurn({ ...options(p), checkLease: async () => {
    if (lost) throw Error('Lease revoked'); return { cancellationRequested: false };
  }, decidePermission: async () => { lost = true; return new Promise(() => {}); } }), /Lease revoked/);
  assert.equal(p.calls.responses.length, 0);
  assert.equal(p.calls.interrupts.length, 1);
});

test('deadline bounds a startup that never acknowledges', async () => {
  const p = provider(undefined, { terminalOnStop: false });
  p.adapter.sendTurn = async () => new Promise(() => {});
  await assert.rejects(runProviderTurn({ ...options(p), signal: AbortSignal.timeout(30) }), /uncertain/);
  assert.deepEqual(p.calls.interrupts, [{ thread: 'thread1', turn: undefined }]);
});

test('missing safeguards reject before provider dispatch', async () => {
  for (const patch of [{ approvalMode: 'full-auto' }, { engineAdmission: undefined }, { mcpFromUserConfig: true }, { toolScope: undefined }]) {
    const p = provider();
    await assert.rejects(runProviderTurn({ ...options(p), input: { ...input(), ...patch } }), /Scoped/);
    assert.equal(p.calls.dispatched.length, 0);
  }
});


test('legacy adapters reserve a process slot before provider dispatch', async () => {
  const p=provider(emit=>emit({type:'turn.completed',ok:true}));delete p.adapter.capabilities;
  const order=[];const original=p.adapter.sendTurn;
  p.adapter.sendTurn=async value=>{order.push('dispatch');return original({...value,engineAdmission:async()=>{}});};
  await runProviderTurn({...options(p),input:{...input(),engineAdmission:async kind=>{assert.equal(kind,'process');order.push('admission');}}});
  assert.deepEqual(order,['admission','dispatch']);
});

test('rejected fallback admission prevents a legacy engine launch', async () => {
  const p=provider();delete p.adapter.capabilities;
  await assert.rejects(runProviderTurn({...options(p),input:{...input(),engineAdmission:async()=>{throw Error('No process capacity');}}}),/No process capacity/);
  assert.equal(p.calls.dispatched.length,0);assert.equal(p.calls.interrupts.length,0);
});

test('cancellation during fallback admission prevents dispatch', async () => {
  const p=provider();delete p.adapter.capabilities;let cancelled=false;
  await assert.rejects(runProviderTurn({...options(p),checkLease:async()=>({cancellationRequested:cancelled}),input:{...input(),engineAdmission:async()=>{cancelled=true;}}}),/Cancelled before provider dispatch/);
  assert.equal(p.calls.dispatched.length,0);
});
