import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceWorkerCoordinator} from './service-controller.mjs';
const assignments=['a','b'].map(worker=>({bot:'bot-'+worker,project:'project',pool:'pool',worker,desktop:'desktop-'+worker,workspace:'workspace-'+worker}));
const pools={pool:{models:{default:'synthetic',options:[{id:'synthetic',label:'Synthetic'}]}}};

test('service controller separates reports and withholds terminal until each service stops',async()=>{
  let c,active=0,peak=0,release;const gate=new Promise(resolve=>release=resolve),stopped=new Set(),events=[];
  const clients=Object.fromEntries(assignments.map(row=>[row.worker,{
    execute:async({job,lease})=>{
      peak=Math.max(peak,++active);if(active===2)release();await gate;
      const turnId='native-'+job.worker;
      c.ledger.append(lease,1,{type:'worker.execution.claimed',jobId:job.id,generation:lease.generation});
      c.ledger.append(lease,2,{type:'item.completed',eventId:'report',threadId:job.thread,turnId,itemType:'assistant_text',text:'Report '+job.worker});
      c.ledger.append(lease,3,{type:'turn.completed',eventId:'done',threadId:job.thread,turnId,ok:true});active--;
      return{lease,result:{turnId,ok:true,cancelled:false,events:2,stopReason:null}};
    },stop:async identity=>{stopped.add(identity.worker);},inspectStopped:async identity=>stopped.has(identity.worker),
  }]));
  c=createServiceWorkerCoordinator({file:':memory:',assignments,pools,clients,admit:async()=>{},health:async()=>true,
    signal:AbortSignal.timeout(5000),resolveTurn:(bot,thread)=>({bot,thread,requestId:'request-'+bot,active:true})});
  try{
    clients.a.execute=()=>{throw Error('Mutated service client');};
    const adapter=await c.bootstrap.createAdapter({instanceId:'services',pool:'pool'});
    adapter.onEvent(event=>{if(event.type==='turn.completed')assert.equal(stopped.has(event.threadId.at(-1)),true);events.push(event);});
    await Promise.all(assignments.map(row=>adapter.sendTurn({botId:row.bot,threadId:'thread-'+row.worker,text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}})));
    const outcomes=await c.drain();assert.ok(outcomes.every(row=>row.value.outcome==='completed'));
    assert.equal(peak,2);assert.deepEqual(events.filter(row=>row.type==='item.completed').map(row=>row.text).sort(),['Report a','Report b']);
    assert.equal(events.filter(row=>row.type==='turn.completed'&&row.ok).length,2);
  }finally{c.close();}
});

test('service controller refuses missing or reused service bindings',()=>{
  const base={file:':memory:',assignments,pools,admit:async()=>{},health:async()=>true,signal:AbortSignal.timeout(1000),resolveTurn:()=>{}};
  assert.throws(()=>createServiceWorkerCoordinator({...base,clients:{}}),/Pinned/);
  assert.throws(()=>createServiceWorkerCoordinator({...base,assignments:[assignments[0],assignments[0]],clients:{}}),/Independent/);
});
