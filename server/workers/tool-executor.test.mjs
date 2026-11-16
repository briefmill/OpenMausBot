import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {JobLedger} from './ledger.mjs';import {createDurableToolExecutor} from './tool-executor.mjs';
const call={id:'call-one',tool:'mcp:mail:read',arguments:{query:'synthetic',nested:{b:2,a:1}}};
function fixture(file=':memory:'){
  const ledger=new JobLedger(file);ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
  return{ledger,lease:ledger.claim('job','worker',30000)};
}
const execute=(runner,lease,request=call)=>runner.execute({lease,call:request,signal:AbortSignal.timeout(2000)});
test('completed tool retries return persisted results without another upstream call',async()=>{
  const {ledger,lease}=fixture();let calls=0,approvals=0;
  const runner=createDurableToolExecutor({ledger,authorize:async()=>{approvals++;return true;},dispatch:async()=>{calls++;return{ok:true,text:'report'};}});
  try{
    assert.equal((await execute(runner,lease)).replay,false);
    const again=await execute(runner,lease,{...call,arguments:{nested:{a:1,b:2},query:'synthetic'}});
    assert.deepEqual(again,{replay:true,result:{ok:true,text:'report'}});assert.equal(calls,1);assert.equal(approvals,1);
    await assert.rejects(execute(runner,lease,{...call,arguments:{query:'changed'}}),/Conflicting/);
    assert.equal(ledger.db.prepare('SELECT request_sha FROM worker_tool_calls').get().request_sha.length,64);
    assert.equal(Object.keys(ledger.db.prepare('SELECT * FROM worker_tool_calls').get()).includes('arguments'),false);
  }finally{ledger.close();}
});
test('controller denial persists and cannot dispatch through a retry',async()=>{
  const {ledger,lease}=fixture();let calls=0;
  const runner=createDurableToolExecutor({ledger,authorize:async()=>false,dispatch:async()=>{calls++;return{ok:true};}});
  try{assert.equal((await execute(runner,lease)).result.ok,false);assert.equal((await execute(runner,lease)).replay,true);assert.equal(calls,0);}
  finally{ledger.close();}
});
test('an unknown upstream outcome remains held across controller executor replacement',async()=>{
  const {ledger,lease}=fixture();let calls=0;
  const options={ledger,authorize:async()=>true,dispatch:async()=>{calls++;throw Error('private upstream detail');}};
  try{
    await assert.rejects(execute(createDurableToolExecutor(options),lease),error=>!error.message.includes('private')&&/reconciliation/.test(error.message));
    await assert.rejects(execute(createDurableToolExecutor(options),lease),/cancelled|Unfinished/);assert.equal(calls,1);
    assert.equal(ledger.get(lease.id).state,'cancelling');
    assert.equal(ledger.db.prepare('SELECT state FROM worker_tool_calls').get().state,'uncertain');
    await assert.rejects(execute(createDurableToolExecutor(options),lease,{...call,id:'another-id'}),/cancelled/);
    assert.equal(calls,1);
  }finally{ledger.close();}
});
test('in-flight replay cannot start a second upstream operation',async()=>{
  const {ledger,lease}=fixture();let finish,calls=0,started;const ready=new Promise(resolve=>{started=resolve;});
  const runner=createDurableToolExecutor({ledger,authorize:async()=>true,dispatch:async()=>{calls++;return new Promise(resolve=>{finish=resolve;started();});}});
  try{
    const first=execute(runner,lease);await ready;
    await assert.rejects(execute(runner,lease),/Unfinished/);assert.equal(calls,1);finish({ok:true,text:'done'});await first;
  }finally{ledger.close();}
});
test('cancellation during authorization prevents upstream dispatch',async()=>{
  const {ledger,lease}=fixture();let calls=0;
  const runner=createDurableToolExecutor({ledger,authorize:async()=>{ledger.cancel('job');return true;},dispatch:async()=>{calls++;return{ok:true};}});
  try{await assert.rejects(execute(runner,lease),/authorization interrupted/);assert.equal(calls,0);}
  finally{ledger.close();}
});
test('persisted results survive ledger reopen and foreign leases cannot access them',async()=>{
  const root=mkdtempSync(join(tmpdir(),'omb-tool-journal-'));let {ledger,lease}=fixture(join(root,'jobs.db')),calls=0;
  const options=()=>({ledger,authorize:async()=>true,dispatch:async()=>{calls++;return{ok:true,text:'saved'};}});
  try{
    await execute(createDurableToolExecutor(options()),lease);ledger.close();ledger=new JobLedger(join(root,'jobs.db'));
    const runner=createDurableToolExecutor(options());assert.equal((await execute(runner,lease)).replay,true);assert.equal(calls,1);
    await assert.rejects(execute(runner,{...lease,worker:'foreign'}),/foreign lease/);
  }finally{ledger.close();rmSync(root,{recursive:true,force:true});}
});

test('aborted authorization cannot dispatch later and its denied result is durable',async()=>{
  const {ledger,lease}=fixture(),control=new AbortController();let approve,calls=0;
  const runner=createDurableToolExecutor({ledger,authorize:()=>new Promise(resolve=>{approve=resolve;}),dispatch:async()=>{calls++;return{ok:true};}});
  try{
    const running=runner.execute({lease,call,signal:control.signal});await Promise.resolve();control.abort();
    await assert.rejects(running,/authorization interrupted/);approve(true);await Promise.resolve();
    assert.equal(calls,0);assert.equal((await execute(runner,lease)).result.ok,false);
  }finally{ledger.close();}
});
test('uncertain upstream work blocks job settlement and resource release',async()=>{
  const {ledger,lease}=fixture(),control=new AbortController();let started;
  const ready=new Promise(resolve=>{started=resolve;});
  const runner=createDurableToolExecutor({ledger,authorize:async()=>true,dispatch:async()=>{started();await new Promise(()=>{});}});
  try{
    const running=runner.execute({lease,call,signal:control.signal});await ready;control.abort();await assert.rejects(running,/reconciliation/);
    const artifact=ledger.putArtifact(lease,Buffer.from('synthetic host stopped'));
    assert.throws(()=>ledger.finish(lease,'failed',artifact),/controller tool operations/);
    assert.equal(ledger.db.prepare('SELECT job FROM resources WHERE id=?').get('desktop').job,'job');
  }finally{ledger.close();}
});
test('separate bots dispatch tools concurrently and keep invocation histories apart',async()=>{
  const {ledger,lease}=fixture();ledger.enqueue({id:'other',bot:'other-bot',thread:'other-thread',project:'other-project',resource:'other-desktop'});
  const other=ledger.claim('other','other-worker',30000);let active=0,peak=0,release;
  const gate=new Promise(resolve=>{release=resolve;}),timer=setTimeout(()=>release(),1000);
  const runner=createDurableToolExecutor({ledger,authorize:async()=>true,dispatch:async({job})=>{peak=Math.max(peak,++active);if(active===2)release();await gate;active--;return{ok:true,text:job.bot};}});
  try{
    const values=await Promise.all([execute(runner,lease),execute(runner,other)]);assert.equal(peak,2);
    assert.deepEqual(values.map(row=>row.result.text),['bot','other-bot']);assert.equal(ledger.db.prepare('SELECT count(*) AS n FROM worker_tool_calls').get().n,2);
  }finally{clearTimeout(timer);release();ledger.close();}
});

