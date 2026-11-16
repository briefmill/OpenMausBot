import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServiceExecution} from './service-execution.mjs';
const identity={id:'job-a',worker:'worker-a',generation:1};
const request=(owner=identity)=>({identity:owner,task:{text:'synthetic'},signal:AbortSignal.timeout(2000)});
const setup=options=>createServiceExecution({file:':memory:',worker:'worker-a',execute:async()=>({ok:true}),stop:async()=>{},inspectStopped:async()=>true,...options});

test('persistent service runs sequential jobs and refuses duplicate generations',async()=>{
  const service=setup({});
  try{
    await service.run(request());assert.equal(service.state(identity),'completed');
    await assert.rejects(service.run(request()),/consumed/);
    await service.run(request({...identity,id:'job-b'}));
  }finally{service.close();}
});

test('an occupied service rejects another turn without starting it',async()=>{
  let done,calls=0;const service=setup({execute:()=>{calls++;return new Promise(resolve=>{done=resolve;});}});
  const first=service.run(request());
  await assert.rejects(service.run(request({...identity,id:'job-b'})),/occupied/);
  assert.equal(calls,1);done({ok:true});await first;service.close();
});

test('unverified shutdown holds the service until trusted reconciliation',async()=>{
  let stopped=false;const service=setup({inspectStopped:async()=>stopped});
  try{
    await assert.rejects(service.run(request()),/reconciliation/);
    assert.equal(service.state(identity),'uncertain');
    await assert.rejects(service.run(request({...identity,id:'job-b'})),/occupied/);
    await assert.rejects(service.reconcile(identity),/unverified/);
    stopped=true;await service.reconcile(identity);await service.run(request({...identity,id:'job-b'}));
  }finally{service.close();}
});

test('restart preserves uncertain ownership and duplicate refusal',async()=>{
  const root=mkdtempSync(join(tmpdir(),'omb-service-execution-'));const file=join(root,'supervisor.db');
  let service=setup({file,inspectStopped:async()=>false});
  try{
    await assert.rejects(service.run(request()),/reconciliation/);service.close();
    service=setup({file});assert.equal(service.state(identity),'uncertain');
    await assert.rejects(service.run(request({...identity,id:'job-b'})),/occupied/);
    await service.reconcile(identity);await assert.rejects(service.run(request()),/consumed/);
  }finally{service.close();rmSync(root,{recursive:true,force:true});}
});

test('provider failure still verifies shutdown before releasing capacity',async()=>{
  let stops=0;const service=setup({execute:async()=>{throw Error('synthetic failure');},stop:async()=>{stops++;}});
  try{await assert.rejects(service.run(request()),/synthetic failure/);assert.equal(stops,1);assert.equal(service.state(identity),'failed');}
  finally{service.close();}
});

test('different services overlap while keeping separate ownership',async()=>{
  let finishA,finishB;
  const a=setup({execute:()=>new Promise(resolve=>{finishA=resolve;})});
  const b=setup({worker:'worker-b',execute:()=>new Promise(resolve=>{finishB=resolve;})});
  const first=a.run(request()),other={...identity,worker:'worker-b',id:'job-b'},second=b.run(request(other));
  await Promise.resolve();
  assert.equal(a.state(identity),'running');assert.equal(b.state(other),'running');
  finishA({ok:true});await first;assert.equal(b.state(other),'running');finishB({ok:true});await second;a.close();b.close();
});

test('foreign identity and pre-aborted turns do not reserve capacity',async()=>{
  const service=setup({});
  try{
    await assert.rejects(service.run(request({...identity,worker:'other'})),/Foreign/);
    const control=new AbortController();control.abort();await assert.rejects(service.run({...request(),signal:control.signal}));
    assert.equal(service.state(identity),null);await service.run(request());
  }finally{service.close();}
});


test('cancellation stops an execution that ignores its signal',async()=>{
  let stopped=false;const control=new AbortController();
  const service=setup({execute:()=>new Promise(()=>{}),stop:async()=>{stopped=true;}});
  try{
    const running=service.run({...request(),signal:control.signal});control.abort();
    await assert.rejects(running,/cancelled/);assert.equal(stopped,true);assert.equal(service.state(identity),'cancelled');
  }finally{service.close();}
});

test('a hung stop retains uncertain ownership after its deadline',async()=>{
  const service=setup({stopMs:10,stop:()=>new Promise(()=>{})});
  try{
    await assert.rejects(service.run(request()),/reconciliation/);assert.equal(service.state(identity),'uncertain');
    await assert.rejects(service.run(request({...identity,id:'job-b'})),/occupied/);
  }finally{service.close();}
});

test('missing completion receipts fail after verified shutdown',async()=>{
  const service=setup({execute:async()=>undefined});
  try{await assert.rejects(service.run(request()),/receipt required/);assert.equal(service.state(identity),'failed');}
  finally{service.close();}
});

test('a failed service does not stop an independent service',async()=>{
  let done;const a=setup({execute:async()=>{throw Error('synthetic failure');}});
  const b=setup({worker:'worker-b',execute:()=>new Promise(resolve=>{done=resolve;})});
  const other={...identity,id:'job-b',worker:'worker-b'};const second=b.run(request(other));
  await assert.rejects(a.run(request()),/synthetic failure/);assert.equal(b.state(other),'running');
  done({ok:true});await second;a.close();b.close();
});

test('cancel-before-delivery persists a tombstone and prevents delayed execution',async()=>{
  let calls=0;const service=setup({execute:async()=>{calls++;return{ok:true};}});
  try{
    assert.equal(service.cancelUnseen(identity),true);assert.equal(service.cancelUnseen(identity),false);
    assert.equal(service.state(identity),'cancelled');await assert.rejects(service.run(request()),/consumed/);assert.equal(calls,0);
    await service.run(request({...identity,id:'different'}));assert.equal(calls,1);
  }finally{service.close();}
});
