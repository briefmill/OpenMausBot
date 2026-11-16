import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerCoordinator } from './coordinator.mjs';
const assignments=['a','b'].map(worker=>({bot:'bot-'+worker,project:'project',pool:'pool',worker,
  desktop:'desktop-'+worker,workspace:'workspace-'+worker}));
const pools={pool:{models:{default:'synthetic',options:[{id:'synthetic',label:'Synthetic'}]}}};
test('coordinator joins scoped planning, concurrent turns, permissions and host settlement',async()=>{
  let active=0,peak=0,release;const gate=new Promise(resolve=>release=resolve),stopped=new Set(),answers=[];
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request-'+bot,active:true}),
    host:{admit:async()=>{},health:async()=>true,launch:async({job})=>({worker:job.worker}),
      execute:async({job,turnId,emit,pollPermission,acknowledgePermission})=>{
        peak=Math.max(peak,++active);if(active===2)release();await gate;
        const requestId='read-'+job.worker;
        emit({type:'request.opened',requestId,requestType:'permission',summary:'Synthetic read',tool:'read',threadId:job.thread,turnId});
        let decision;for(let i=0;i<100;i++){decision=pollPermission(requestId).decision;if(decision)break;await new Promise(resolve=>setTimeout(resolve,1));}
        assert.equal(decision?.behavior,'allow');acknowledgePermission(requestId,'allowed-once');active--;return {worker:job.worker};
      },stop:async({worker})=>{stopped.add(worker);},inspectStopped:async({worker})=>stopped.has(worker)}});
  try{
    const adapter=await c.bootstrap.createAdapter({instanceId:'workers',pool:'pool'});
    adapter.onEvent(event=>{if(event.type==='request.opened')answers.push(adapter.respondToRequest(event.threadId,event.requestId,{behavior:'allow'}));});
    let admissions=0;
    await Promise.all(assignments.map(a=>adapter.sendTurn({botId:a.bot,threadId:'thread-'+a.bot,text:'Synthetic',approvalMode:'ask',
      mcpFromUserConfig:false,toolScope:{allow:['read']},engineAdmission:async()=>{admissions++;}})));
    const results=await c.drain();assert.ok(results.every(x=>x.status==='fulfilled'&&x.value.settled&&x.value.outcome==='completed'));
    assert.equal(peak,2);assert.equal(admissions,2);assert.equal(stopped.size,2);
    assert.deepEqual(await Promise.all(answers),['allowed-once','allowed-once']);
  }finally{c.close();}
});
test('coordinator never releases a desktop when host stop is unverified',async()=>{
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request',active:true}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),execute:async()=>({}),stop:async()=>{},inspectStopped:async()=>false}});
  try{
    const adapter=await c.bootstrap.createAdapter({instanceId:'workers',pool:'pool'});
    await adapter.sendTurn({botId:'bot-a',threadId:'thread',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,
      toolScope:{allow:['read']},engineAdmission:async()=>{}});
    const result=await c.drain();assert.equal(result[0].value.settled,false);
    assert.equal(c.ledger.db.prepare('SELECT state FROM jobs').get().state,'cancelling');
    assert.throws(()=>c.close(),/settlement/);
  }finally{c.ledger.close();}
});
test('remote host admission remains mandatory without a local engine callback',async()=>{
  let admissions=0, launches=0;
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request',active:true}),
    host:{admit:async()=>{admissions++;throw Error('Host capacity exhausted');},health:async()=>true,
      launch:async()=>{launches++;},execute:async()=>({}),stop:async()=>{},inspectStopped:async()=>true}});
  try{
    const adapter=await c.bootstrap.createAdapter({instanceId:'workers',pool:'pool'});
    await adapter.sendTurn({botId:'bot-a',threadId:'thread',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{allow:['read']}});
    const results=await c.drain();assert.equal(results[0].value.outcome,'failed');
    assert.equal(admissions,1);assert.equal(launches,0);
  }finally{c.close();}
});
