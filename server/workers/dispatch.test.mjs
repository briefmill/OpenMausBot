import test from 'node:test';
import assert from 'node:assert/strict';
import { JobLedger } from './ledger.mjs';
import { createDispatcher } from './dispatch.mjs';
const job = (id, resource = 'desktop:a') => ({ id, bot: 'bot', thread: id, project: 'project', resource });
test('provider failure stays failed after verified shutdown and releases the desktop', async () => {
  for (const result of [{ok:false}, {result:{ok:false}}]) {
    const ledger = new JobLedger(':memory:');
    try {
      ledger.enqueue(job('a')); ledger.enqueue(job('b'));
      let stopped = false;
      const dispatcher = createDispatcher({ledger, launch:async()=>({}), execute:async()=>result,
        stop:async()=>{stopped=true;}, inspectStopped:async()=>stopped});
      const settled = await dispatcher.dispatch('a','worker-a');
      assert.equal(settled.outcome,'failed'); assert.equal(settled.settled,true);
      assert.equal(ledger.get('a').state,'failed');
      assert.ok(ledger.claim('b','worker-b',1000));
    } finally { ledger.close(); }
  }
});

test('resource remains exclusive until authoritative host stop', async () => {
  const ledger = new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a')); ledger.enqueue(job('b'));
    let release; const gate = new Promise(resolve => release = resolve);
    let stopping; const reachedStop = new Promise(resolve => stopping = resolve);
    const dispatcher = createDispatcher({ ledger, launch: async () => 'handle', execute: async () => ({ useful: true }),
      stop: async () => { stopping(); await gate; }, inspectStopped: async () => true });
    const pending = dispatcher.dispatch('a', 'worker-a'); await reachedStop;
    assert.equal(ledger.claim('b', 'worker-b', 1000), null);
    release(); assert.equal((await pending).outcome, 'completed');
    assert.ok(ledger.claim('b', 'worker-b', 1000));
  } finally { ledger.close(); }
});
test('partial launch failure with uncertain stop holds resources', async () => {
  const ledger = new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a')); ledger.enqueue(job('b'));
    let stoppedIdentity;
    const dispatcher = createDispatcher({ ledger, launch: async () => { throw Error('partially created'); }, execute: async () => {},
      stop: async identity => { stoppedIdentity = identity; }, inspectStopped: async () => false });
    assert.equal((await dispatcher.dispatch('a', 'worker-a')).settled, false);
    assert.equal(stoppedIdentity.id, 'a'); assert.equal(stoppedIdentity.generation, 1);
    assert.equal(ledger.get('a').state, 'cancelling'); assert.equal(ledger.claim('b', 'worker-b', 1000), null);
  } finally { ledger.close(); }
});
test('separate resources execute concurrently, replay cannot relaunch a job', async () => {
  const ledger = new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a')); ledger.enqueue(job('b', 'desktop:b'));
    let active = 0, peak = 0, release; const gate = new Promise(resolve => release = resolve);
    const dispatcher = createDispatcher({ ledger, launch: async () => ({}), execute: async () => {
      peak = Math.max(peak, ++active); if (active === 2) release(); await gate; active--; return 'done';
    }, stop: async () => {}, inspectStopped: async () => true });
    const results = await Promise.all([dispatcher.dispatch('a', 'worker-a'), dispatcher.dispatch('b', 'worker-b')]);
    assert.equal(peak, 2); assert.ok(results.every(x => x.outcome === 'completed'));
    await assert.rejects(dispatcher.dispatch('a', 'worker-a'), /not queued/);
  } finally { ledger.close(); }
});
test('stop deadline leaves resource held even if a host call hangs', async () => {
  const ledger = new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a')); ledger.enqueue(job('b'));
    const dispatcher = createDispatcher({ ledger, launch: async () => ({}), execute: async () => 'done',
      stop: () => new Promise(() => {}), inspectStopped: async () => true, stopMs: 10 });
    assert.equal((await dispatcher.dispatch('a', 'worker-a')).settled, false);
    assert.equal(ledger.claim('b', 'worker-b', 1000), null);
  } finally { ledger.close(); }
});
test('cancellation during execution settles only after host stop', async () => {
  const ledger = new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a')); let stopped = false;
    const dispatcher = createDispatcher({ ledger, launch: async () => ({}), execute: async () => { ledger.cancel('a'); return 'partial'; },
      stop: async () => { stopped = true; }, inspectStopped: async () => stopped });
    assert.equal((await dispatcher.dispatch('a', 'worker-a')).outcome, 'cancelled');
    assert.equal(stopped, true);
  } finally { ledger.close(); }
});
test('queued desktop job starts after the previous host stop releases ownership', async () => {
  const ledger=new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a'));ledger.enqueue(job('b'));
    let release,firstRunning;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>firstRunning=resolve);
    const order=[];
    const dispatcher=createDispatcher({ledger,waitForCapacity:true,signal:AbortSignal.timeout(2000),pollMs:1,
      launch:async({job})=>{order.push('launch-'+job.id);return job.id;},execute:async({job})=>{if(job.id==='a'){firstRunning();await gate;}return job.id;},
      stop:async({id})=>{order.push('stop-'+id);},inspectStopped:async()=>true});
    const first=dispatcher.dispatch('a','worker');await started;
    const second=dispatcher.dispatch('b','worker');
    await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(order,['launch-a']);
    release();const results=await Promise.all([first,second]);assert.ok(results.every(x=>x.outcome==='completed'));
    assert.deepEqual(order,['launch-a','stop-a','launch-b','stop-b']);
  } finally {ledger.close();}
});
test('cancelling a queued turn does not launch it or disturb its desktop owner',async()=>{
  const ledger=new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a'));ledger.enqueue(job('b'));ledger.claim('a','worker',30000);
    let launches=0;
    const dispatcher=createDispatcher({ledger,waitForCapacity:true,signal:AbortSignal.timeout(2000),pollMs:1,
      launch:async()=>{launches++;},execute:async()=>{},stop:async()=>{},inspectStopped:async()=>true});
    const queued=dispatcher.dispatch('b','worker');ledger.cancel('b');
    assert.equal((await queued).outcome,'cancelled');assert.equal(launches,0);assert.equal(ledger.get('a').state,'running');
  } finally {ledger.close();}
});
test('pre-dispatch cancellation and expired queue signal cannot launch a worker',async()=>{
  const ledger=new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a'));ledger.enqueue(job('b'));ledger.cancel('a');let launches=0;
    const control=new AbortController();control.abort();
    const dispatcher=createDispatcher({ledger,waitForCapacity:true,signal:control.signal,
      launch:async()=>{launches++;},execute:async()=>{},stop:async()=>{},inspectStopped:async()=>true});
    assert.equal((await dispatcher.dispatch('a','worker')).outcome,'cancelled');
    assert.equal((await dispatcher.dispatch('b','worker')).outcome,'cancelled');assert.equal(launches,0);
  } finally {ledger.close();}
});


test('verified worker shutdown cannot release an uncertain controller tool action', async () => {
  const { createDurableToolExecutor } = await import('./tool-executor.mjs');
  const ledger = new JobLedger(':memory:');
  try {
    ledger.enqueue(job('a')); ledger.enqueue(job('b'));
    let stopped = false, upstream = 0;
    const tools = createDurableToolExecutor({ledger,authorize:async()=>true,
      dispatch:async()=>{upstream++;throw Error('unknown remote outcome');}});
    const dispatcher = createDispatcher({ledger,launch:async()=>({}),
      execute:async({lease})=>{
        await assert.rejects(tools.execute({lease,call:{id:'one',tool:'synthetic:read',arguments:{}},
          signal:AbortSignal.timeout(1000)}),/reconciliation/);
        return {ok:true};
      },stop:async()=>{stopped=true;},inspectStopped:async()=>stopped});
    assert.deepEqual(await dispatcher.dispatch('a','worker-a'),
      {started:true,settled:false,reason:'controller-tool-outcome-unverified'});
    assert.equal(stopped,true); assert.equal(upstream,1);
    assert.equal(ledger.get('a').state,'cancelling');
    assert.equal(ledger.claim('b','worker-b',1000),null);
    assert.deepEqual(ledger.unfinishedToolCalls('a',1).map(row=>({...row})),[{id:'one',tool:'synthetic:read',state:'uncertain'}]);
    assert.throws(()=>ledger.unfinishedToolCalls('a',2),/Stale/);
  } finally { ledger.close(); }
});
