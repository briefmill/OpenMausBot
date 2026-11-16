import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerCoordinator } from './coordinator.mjs';
const assignments=['a','b'].map(worker=>({bot:'bot-'+worker,project:'project',pool:'pool',worker,
  desktop:'desktop-'+worker,workspace:'workspace-'+worker}));
const pools={pool:{models:{default:'synthetic',options:[{id:'synthetic',label:'Synthetic'}]}}};

test('controller terminal waits for verified host shutdown',async()=>{
  let release,stopping;const gate=new Promise(resolve=>release=resolve),atStop=new Promise(resolve=>stopping=resolve);
  const events=[];
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request',active:true}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),
      execute:async({job,turnId,emit})=>{
        emit({type:'turn.completed',eventId:'provider-done',threadId:job.thread,turnId,ok:true});return{ok:true};
      },stop:async()=>{stopping();await gate;},inspectStopped:async()=>true}});
  try {
    const adapter=await c.bootstrap.createAdapter({instanceId:'worker',pool:'pool'});adapter.onEvent(e=>events.push(e));
    await adapter.sendTurn({botId:'bot-a',threadId:'thread',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}});
    await atStop;assert.equal(events.filter(e=>e.type==='turn.completed').length,0);
    release();await c.drain();assert.equal(events.filter(e=>e.type==='turn.completed').length,1);assert.equal(events[0].ok,true);
  }finally{release();c.close();}
});

test('uncertain host shutdown never publishes provider success',async()=>{
  const events=[];
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request',active:true}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),
      execute:async({job,turnId,emit})=>{emit({type:'turn.completed',eventId:'done',threadId:job.thread,turnId,ok:true});return{ok:true};},
      stop:async()=>{},inspectStopped:async()=>false}});
  try {
    const adapter=await c.bootstrap.createAdapter({instanceId:'worker',pool:'pool'});adapter.onEvent(e=>events.push(e));
    await adapter.sendTurn({botId:'bot-a',threadId:'thread',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}});
    const results=await c.drain();assert.equal(results[0].value.settled,false);assert.equal(events.length,0);
    assert.throws(()=>c.close(),/settlement/);
  }finally{c.ledger.close();}
});
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


test('unknown controller tool outcome keeps the turn held and explains the hold',async()=>{
  const {createDurableToolExecutor}=await import('./tool-executor.mjs');
  const events=[];
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request',active:true}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),
      execute:async({job,lease,turnId,emit,signal})=>{
        const tools=createDurableToolExecutor({ledger:c.ledger,authorize:async()=>true,
          dispatch:async()=>{throw Error('uncertain');}});
        await assert.rejects(tools.execute({lease,signal,call:{id:'one',tool:'synthetic:read',arguments:{}}}),/reconciliation/);
        emit({type:'turn.completed',eventId:'done',threadId:job.thread,turnId,ok:true});
        return{ok:true};
      },stop:async()=>{},inspectStopped:async()=>true}});
  try{
    const adapter=await c.bootstrap.createAdapter({instanceId:'worker',pool:'pool'});
    adapter.onEvent(e=>events.push(e));
    await adapter.sendTurn({botId:'bot-a',threadId:'thread',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}});
    const results=await c.drain();
    assert.equal(results[0].value.reason,'controller-tool-outcome-unverified');
    assert.equal(events.some(e=>e.type==='turn.completed'),false);
    assert.equal(events.filter(e=>e.type==='runtime.notice' && e.message.includes('prevent duplicate')).length,1);
    assert.throws(()=>c.close(),/settlement/);
  }finally{c.ledger.close();}
});


test('controller-local tool approvals route through the normal adapter without remote ACKs',async()=>{
  const {createControllerToolSession}=await import('./controller-tool-session.mjs');
  const events=[];let executed=0,closed=0,adapter;
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request',active:true}),
    openTools:args=>createControllerToolSession({...args,mode:()=> 'ask',preview:()=> 'synthetic read',
      session:{validate:()=>{},view:()=>({title:'account read',input:{},ask:true}),
        execute:async()=>{executed++;return{ok:true,text:'one account'};},close:async()=>{closed++;}}}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),
      execute:async({lease,signal})=>{
        const input={lease,signal,call:{id:'one',tool:'synthetic:read',arguments:{}}};
        assert.equal((await c.tools.execute(input)).result.text,'one account');
        assert.equal((await c.tools.execute(input)).replay,true);
        return{ok:true};
      },stop:async()=>{},inspectStopped:async()=>true}});
  try {
    adapter=await c.bootstrap.createAdapter({instanceId:'worker',pool:'pool'});
    const answers=[];
    adapter.onEvent(event=>{events.push(event);if(event.type==='request.opened')
      answers.push(adapter.respondToRequest(event.threadId,event.requestId,{behavior:'allow'}));});
    await adapter.sendTurn({botId:'bot-a',threadId:'thread',text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}});
    const results=await c.drain();assert.equal(results[0].value.outcome,'completed');
    assert.deepEqual(await Promise.all(answers),['allowed-once']);
    assert.equal(executed,1);assert.equal(closed,1);
    assert.equal(events.filter(e=>e.type==='request.opened').length,1);
    assert.equal(events.filter(e=>e.type==='request.resolved').length,1);
    assert.equal(events.filter(e=>e.type==='turn.completed').length,1);
  } finally { c.close(); }
});


test('two controller-mounted accounts wait for independent approvals and run concurrently',{timeout:10000},async()=>{
  const {createControllerToolSession}=await import('./controller-tool-session.mjs');
  const cards=[],reports=[],grants=new Map(),closed=[];let both;
  const ready=new Promise(resolve=>{both=resolve;});
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request-'+bot,active:true}),
    openTools:args=>createControllerToolSession({...args,mode:()=> 'ask',preview:()=> 'synthetic account read',
      session:{validate:()=>{},view:()=>({title:'read '+args.job.bot,input:{},ask:true}),
        execute:async()=>({ok:true,text:args.job.bot}),close:async()=>{closed.push(args.job.bot);}}}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),
      execute:async({lease,signal})=>{
        const result=await c.tools.execute({lease,signal,call:{id:'same-id',tool:'synthetic:read',arguments:{}}});
        reports.push(result.result.text);return{ok:true};
      },stop:async()=>{},inspectStopped:async()=>true}});
  try{
    const adapter=await c.bootstrap.createAdapter({instanceId:'workers',pool:'pool'});
    adapter.onEvent(event=>{if(event.type==='request.opened'){cards.push(event);if(cards.length===2)both();}});
    await Promise.all(['a','b'].map(id=>adapter.sendTurn({botId:'bot-'+id,threadId:'thread-'+id,text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}})));
    await ready;assert.equal(reports.length,0);
    assert.equal(await adapter.respondToRequest(cards[0].threadId,cards[1].requestId,{behavior:'allow'}),'unavailable');
    grants.set(cards[0].threadId,await adapter.respondToRequest(cards[0].threadId,cards[0].requestId,{behavior:'allow'}));
    assert.equal(grants.get(cards[0].threadId),'allowed-once');
    assert.equal(await adapter.respondToRequest(cards[1].threadId,cards[1].requestId,{behavior:'deny'}),'rejected');
    const results=await c.drain();assert.ok(results.every(row=>row.value.settled));
    assert.equal(reports.filter(row=>row===cards[0].tool.replace('read ','')).length,1);
    assert.equal(reports.length,2);assert.equal(reports.includes('bot-'+cards[1].threadId.slice(-1)),false);
    assert.deepEqual(closed.sort(),['bot-a','bot-b']);
    assert.equal(c.ledger.db.prepare('SELECT count(*) AS n FROM worker_tool_calls').get().n,2);
  }finally{c.close();}
});
