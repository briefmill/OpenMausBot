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


test('explicit browser workers use their pinned service through lazy approved tools',async()=>{
  const {openAccountScopedWorkerTools}=await import('./mounted-controller-tools.mjs');
  let c,adapter,running=false,stopped=false;const browserCalls=[];
  const client={
    async browser(args){assert.equal(running,true);assert.equal(args.lease.worker,'a');browserCalls.push(args);
      if(args.operation.method==='tools/list')return{tools:[{name:'agent_browser_click',description:'Synthetic click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref'],additionalProperties:false}}]};
      return{content:[{type:'text',text:'clicked'}]};},
    async execute({job,lease,signal}){
      assert.equal(browserCalls.length,0);running=true;
      c.ledger.append(lease,1,{type:'worker.execution.claimed',jobId:job.id,generation:lease.generation});
      assert.equal((await c.tools.list({lease}))[0].function.name,'browser_agent_browser_click');
      const call={lease,signal,call:{id:'click',tool:'browser_agent_browser_click',arguments:{ref:'e1'}}};
      assert.equal((await c.tools.execute(call)).result.ok,true);assert.equal((await c.tools.execute(call)).replay,true);
      c.ledger.append(lease,2,{type:'turn.completed',eventId:'done',threadId:job.thread,turnId:'native-a',ok:true});
      return{lease,result:{turnId:'native-a',ok:true,cancelled:false,events:1,stopReason:null}};
    },async stop(){stopped=true;},async inspectStopped(){return stopped;},
  };
  c=createServiceWorkerCoordinator({file:':memory:',assignments:[assignments[0]],pools,clients:{a:client},browserWorkers:['a'],openTools:openAccountScopedWorkerTools,
    admit:async()=>{},health:async()=>true,signal:AbortSignal.timeout(5000),resolveTurn:(bot,thread)=>({bot,thread,requestId:'browser',active:true})});
  try{
    // Later mutation of the caller's registry cannot replace a pinned browser client.
    client.browser=async()=>{throw Error('Mutated client must not execute');};
    adapter=await c.bootstrap.createAdapter({instanceId:'services',pool:'pool'});
    adapter.onEvent(event=>{if(event.type==='request.opened'){assert.equal(browserCalls.length,2);void adapter.respondToRequest(event.threadId,event.requestId,{behavior:'allow'});}});
    await adapter.sendTurn({botId:'bot-a',threadId:'thread-a',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,
      integrations:{browser:{command:'must-not-launch-controller-browser',args:[],env:{}}}});
    const result=await c.drain();assert.equal(result[0].value.outcome,'completed');assert.equal(browserCalls.length,3);
  }finally{c.close();}
});
test('browser opt-in refuses unknown workers or missing service capabilities',()=>{
  const base={file:':memory:',assignments:[assignments[0]],pools,admit:async()=>{},health:async()=>true,signal:AbortSignal.timeout(1000),resolveTurn:()=>{},openTools:()=>{}};
  const client={execute(){},stop(){},inspectStopped(){}};
  assert.throws(()=>createServiceWorkerCoordinator({...base,clients:{a:client},browserWorkers:['foreign']}),/browser worker assignments/);
  assert.throws(()=>createServiceWorkerCoordinator({...base,clients:{a:client},browserWorkers:['a']}),/browser service/);
});
