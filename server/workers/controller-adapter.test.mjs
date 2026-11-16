import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerAdapter } from './controller-adapter.mjs';
const setup = (overrides = {}) => {
  const streams = new Map(), finishes = new Map(), answers = [];
  const adapter = createWorkerAdapter({ provider: 'openaiCompat', submit: async (input, emit) => {
    streams.set(input.threadId, emit); let done;
    const completion = new Promise(resolve => done = resolve); finishes.set(input.threadId, done);
    return { turnId: 'turn-' + input.threadId, completion };
  }, answer: async value => { answers.push(value); return 'allowed-once'; }, cancel: async () => false, ...overrides });
  return { adapter, streams, finishes, answers };
};
test('independent threads route events, foreign and stale events cannot cross', async () => {
  const { adapter, streams, finishes } = setup(), events = []; adapter.onEvent(x => events.push(x));
  await Promise.all(['a','b'].map(threadId => adapter.sendTurn({ threadId })));
  streams.get('a')({ threadId:'b', turnId:'turn-b', type:'text' });
  streams.get('a')({ threadId:'a', turnId:'old', type:'text' });
  streams.get('a')({ threadId:'a', turnId:'turn-a', type:'text' });
  assert.equal(events.length,1); finishes.get('a')({ settled:true }); await new Promise(resolve => setImmediate(resolve));
  streams.get('a')({ threadId:'a', turnId:'turn-a', type:'text' }); assert.equal(events.length,1);
});
test('uncertain dispatch settlement keeps the thread occupied', async () => {
  const { adapter, finishes } = setup(); await adapter.sendTurn({ threadId:'a' });
  finishes.get('a')({ settled:false }); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(adapter.sendTurn({ threadId:'a' }), /already owns/);
});
test('permissions stay thread and turn bound, permanent worker grant refused', async () => {
  const { adapter, streams, answers } = setup(); await adapter.sendTurn({ threadId:'a' });
  streams.get('a')({ threadId:'a', turnId:'turn-a', type:'request.opened', requestId:'request' });
  assert.equal(await adapter.respondToRequest('b','request',{ behavior:'allow' }), 'unavailable');
  assert.equal(await adapter.respondToRequest('a','request',{ behavior:'allow', always:true }), 'unavailable');
  assert.equal(answers.length,0);
  assert.equal(await adapter.respondToRequest('a','request',{ behavior:'allow' }), 'allowed-once');
  assert.equal(await adapter.respondToRequest('a','request',{ behavior:'allow' }), 'unavailable');
});
test('provider completion or unverified stop cannot free occupied thread', async () => {
  const { adapter, streams } = setup(); await adapter.sendTurn({ threadId:'a' });
  streams.get('a')({ threadId:'a', turnId:'turn-a', type:'turn.completed' });
  await adapter.interruptTurn('a');
  await assert.rejects(adapter.sendTurn({ threadId:'a' }), /already owns/);
});
test('partially failed startup stays fenced until verified cancellation', async () => {
  let safe = false;
  const { adapter } = setup({ submit: async () => { throw Error('startup uncertain'); }, cancel: async () => safe });
  await assert.rejects(adapter.sendTurn({ threadId:'a' }), /startup uncertain/);
  await adapter.interruptTurn('a'); await assert.rejects(adapter.sendTurn({ threadId:'a' }), /already owns/);
  safe = true; await adapter.interruptTurn('a');
  await assert.rejects(adapter.sendTurn({ threadId:'a' }), /startup uncertain/);
});
test('events emitted during startup wait for the acknowledged turn identity', async () => {
  const events = [];
  const { adapter } = setup({ submit: async (input, emit) => {
    emit({ threadId:input.threadId, turnId:'wrong', type:'text' });
    emit({ threadId:input.threadId, turnId:'real', type:'text', text:'startup' });
    return { turnId:'real', completion:new Promise(() => {}) };
  }});
  adapter.onEvent(event => events.push(event)); await adapter.sendTurn({ threadId:'a' });
  assert.deepEqual(events.map(x => x.text), ['startup']);
});
test('two concurrent answers cannot both enter worker delivery', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => release = resolve);
  const { adapter, streams } = setup({ answer: async () => { calls++; await gate; return 'allowed-once'; } });
  await adapter.sendTurn({ threadId:'a' });
  streams.get('a')({ threadId:'a', turnId:'turn-a', type:'request.opened', requestId:'request' });
  const first = adapter.respondToRequest('a','request',{ behavior:'allow' });
  assert.equal(await adapter.respondToRequest('a','request',{ behavior:'allow' }), 'unavailable');
  release(); assert.equal(await first,'allowed-once'); assert.equal(calls,1);
});
