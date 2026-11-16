import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createWorkerCoordinator } from './coordinator.mjs';
import { createRemoteExecution } from './remote-execution.mjs';
import { listenTransport } from './transport.mjs';
import { workerClient } from './worker-client.mjs';
import { JobLedger } from './ledger.mjs';

test('remote bridge withholds terminal publication for a mismatched lease receipt',async()=>{
  const ledger=new JobLedger(':memory:');
  try {
    const job=ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
    const lease=ledger.claim(job.id,'worker',30000),events=[];
    const execute=createRemoteExecution({ledger,pollMs:1,executeWorker:async()=>{
      ledger.append(lease,1,{type:'turn.completed',eventId:'done',threadId:'thread',turnId:'native',ok:true});
      return{lease:{...lease,generation:2},result:{turnId:'native',ok:true}};
    }});
    await assert.rejects(execute({job,lease,input:{},turnId:'controller',signal:AbortSignal.timeout(1000),emit:e=>events.push(e)}),/receipt mismatch/);
    assert.equal(events.length,0);assert.equal(ledger.get(job.id).state,'running');
  } finally {ledger.close();}
});

test('remote bridge preserves a failed provider terminal and does not settle the host lease',async()=>{
  const ledger=new JobLedger(':memory:');
  try {
    const job=ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
    const lease=ledger.claim(job.id,'worker',30000),events=[];
    const execute=createRemoteExecution({ledger,pollMs:1,executeWorker:async()=>{
      ledger.append(lease,1,{type:'turn.completed',eventId:'done',threadId:'thread',turnId:'native',ok:false});
      return{lease,result:{turnId:'native',ok:false}};
    }});
    const result=await execute({job,lease,input:{},turnId:'controller',signal:AbortSignal.timeout(1000),emit:e=>events.push(e)});
    assert.equal(result.result.ok,false);assert.equal(events[0].ok,false);assert.equal(events[0].turnId,'controller');
    assert.equal(ledger.get(job.id).state,'running');
  } finally {ledger.close();}
});

test('coordinator executes worker HTTP stream and preserves native permission identity',async()=>{
  const signal=AbortSignal.timeout(5000),token=randomBytes(32).toString('hex');
  let c,client,transport,execute,listener,starts=0,stopped=false;
  const native={capabilities:{engineAdmission:true},onEvent(fn){listener=fn;return()=>{listener=null;}},
    async sendTurn(input){starts++;await input.engineAdmission('process');setImmediate(()=>listener({
      type:'request.opened',eventId:'permission',provider:'synthetic',threadId:'thread',turnId:'native-turn',
      requestId:'read',requestType:'permission',tool:'scoped-read',summary:'Synthetic read',
      raw:{secret:'excluded-from-wire'}}));return{turnId:'native-turn'};},
    async respondToRequest(thread,request,decision){assert.equal(thread,'thread');assert.equal(request,'read');
      assert.equal(decision.behavior,'allow');setImmediate(()=>{
        listener({type:'item.completed',eventId:'reply',provider:'synthetic',threadId:'thread',turnId:'native-turn',itemType:'assistant_text',text:'Read completed'});
        listener({type:'turn.completed',eventId:'terminal',provider:'synthetic',threadId:'thread',turnId:'native-turn',ok:true});
      });return'allowed-once';},async interruptTurn(){}};
  c=createWorkerCoordinator({file:':memory:',signal,
    assignments:[{bot:'bot',project:'project',pool:'pool',worker:'worker',desktop:'desktop',workspace:'workspace'}],
    pools:{pool:{models:{default:'synthetic',options:[{id:'synthetic',label:'Synthetic'}]}}},
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request',active:true}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),
      execute:args=>execute(args),stop:async()=>{stopped=true;},inspectStopped:async()=>stopped}});
  try{
    transport=await listenTransport({ledger:c.ledger,controllerToken:randomBytes(32).toString('hex'),workers:[{
      id:'worker',token,capacity:1,assignments:[{bot:'bot',thread:'thread',project:'project',resource:'desktop',resources:['workspace']}]}]});
    client=workerClient({origin:transport.origin,token,pollMs:1});
    execute=createRemoteExecution({ledger:c.ledger,pollMs:1,executeWorker:({job,lease,input,signal})=>
      client.run({jobId:job.id,lease,adapter:native,input:{...input,approvalModeNow:()=> 'ask',engineAdmission:async()=>{}},signal})});
    const adapter=await c.bootstrap.createAdapter({instanceId:'remote',pool:'pool'}),events=[],answers=[];
    adapter.onEvent(event=>{events.push(event);if(event.type==='request.opened'){
      assert.equal(event.tool,'scoped-read');assert.equal(event.raw,undefined);
      assert.notEqual(event.turnId,'native-turn');answers.push(adapter.respondToRequest('thread','read',{behavior:'allow'}));
    }});
    const start=await adapter.sendTurn({botId:'bot',threadId:'thread',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{allow:['scoped-read']}});
    const result=await c.drain();assert.equal(result[0].value.outcome,'completed');assert.equal(starts,1);
    assert.deepEqual(await Promise.all(answers),['allowed-once']);
    assert.equal(events.filter(e=>e.type==='turn.completed').length,1);
    assert.ok(events.every(e=>e.turnId===start.turnId));
    assert.equal(events.find(e=>e.type==='item.completed').text,'Read completed');
    assert.equal(stopped,true);
  } finally {client?.close();await transport?.close();c.close();}
});
