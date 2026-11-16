import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServiceExecution} from './service-execution.mjs';
import {withStoppedServiceSnapshot,verifyRestoredServiceSnapshot} from './service-snapshot.mjs';
const options=file=>({file,worker:'worker-a',execute:async()=>({ok:true}),stop:async()=>{},inspectStopped:async()=>true});
const fixture=async fn=>{const root=mkdtempSync(join(tmpdir(),'omb-snapshot-'));try{await fn(join(root,'jobs.db'));}finally{rmSync(root,{recursive:true,force:true});}};
test('snapshot refuses a live supervisor without invoking capture',()=>fixture(async file=>{
 const service=createServiceExecution(options(file));let calls=0;
 try{await assert.rejects(withStoppedServiceSnapshot({file,worker:'worker-a',inspectStopped:async()=>true,snapshot:async()=>calls++}),/active/);assert.equal(calls,0);}finally{service.close();}
}));
test('snapshot holds exclusive authority through capture and releases on failure',()=>fixture(async file=>{
 createServiceExecution(options(file)).close();let probes=0;
 const result=await withStoppedServiceSnapshot({file,worker:'worker-a',inspectStopped:async()=>{probes++;return true;},snapshot:async()=>{
  assert.throws(()=>createServiceExecution(options(file)),/active or unavailable/);return 'captured';
 }});assert.equal(result,'captured');assert.equal(probes,2);
 await assert.rejects(withStoppedServiceSnapshot({file,worker:'worker-a',inspectStopped:async()=>true,snapshot:async()=>{throw Error('capture failed');}}),/capture failed/);
 createServiceExecution(options(file)).close();
}));
test('snapshot refuses unresolved authority and unverifiable process shutdown',()=>fixture(async file=>{
 createServiceExecution(options(file)).close();let calls=0;
 const args={file,worker:'worker-a',inspectStopped:async()=>false,snapshot:async()=>calls++};
 await assert.rejects(withStoppedServiceSnapshot(args),/shutdown unverified/);
 const db=new DatabaseSync(file);db.prepare('INSERT INTO executions VALUES (?,?)').run(JSON.stringify(['a','worker-a',1]),'uncertain');db.close();
 await assert.rejects(withStoppedServiceSnapshot({...args,inspectStopped:async()=>true}),/reconciliation/);assert.equal(calls,0);
}));
test('snapshot rejects a foreign worker journal',()=>fixture(async file=>{
 const service=createServiceExecution(options(file));await service.run({identity:{id:'a',worker:'worker-a',generation:1},task:{},signal:AbortSignal.timeout(2000)});service.close();
 await assert.rejects(withStoppedServiceSnapshot({file,worker:'worker-b',inspectStopped:async()=>true,snapshot:async()=>{throw Error('must not capture');}}),/Foreign/);
}));

test('restored journal must match trusted receipts and cannot omit completed work',()=>fixture(async file=>{
 const service=createServiceExecution(options(file));await service.run({identity:{id:'a',worker:'worker-a',generation:1},task:{},signal:AbortSignal.timeout(2000)});service.close();
 let expected;
 await withStoppedServiceSnapshot({file,worker:'worker-a',inspectStopped:async()=>true,snapshot:async({receipts})=>{expected=receipts;}});
 const args={file,worker:'worker-a',expectedReceipts:expected,inspectStopped:async()=>true};
 assert.equal(await verifyRestoredServiceSnapshot(args),true);
 await assert.rejects(verifyRestoredServiceSnapshot({...args,expectedReceipts:[]}),/mismatch/);
 const db=new DatabaseSync(file);db.exec('DELETE FROM executions');db.close();
 await assert.rejects(verifyRestoredServiceSnapshot(args),/mismatch/);
 await assert.rejects(verifyRestoredServiceSnapshot({...args,file:file+'.missing'}),/ENOENT/);
}));
test('capture refuses a journal changed during its critical section',()=>fixture(async file=>{
 createServiceExecution(options(file)).close();
 await assert.rejects(withStoppedServiceSnapshot({file,worker:'worker-a',inspectStopped:async()=>true,snapshot:async()=>{
  const db=new DatabaseSync(file);db.prepare('INSERT INTO executions VALUES (?,?)').run(JSON.stringify(['new','worker-a',1]),'completed');db.close();
 }}),/changed during capture/);
}));
