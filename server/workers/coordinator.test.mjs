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
    const adapter=await c.bootstrap.createAdapter({instanceId:'worker',pool:'pool'});
    assert.equal(adapter.capabilities.agentsMcp,undefined);assert.equal(adapter.capabilities.customMcp,undefined);assert.equal(adapter.capabilities.composioMcp,undefined);adapter.onEvent(e=>events.push(e));
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
    assert.equal(adapter.capabilities.agentsMcp,true);assert.equal(adapter.capabilities.customMcp,true);assert.equal(adapter.capabilities.composioMcp,true);
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


test('34 independent bot assignments overlap while a busy desktop keeps its next thread queued',{timeout:10000},async()=>{
  const {createHostAdmission}=await import('./host-admission.mjs');
  const assignments=Array.from({length:34},(_,index)=>({bot:'bot-'+index,project:'project-'+index,pool:'pool',worker:'worker-'+index,
    desktop:'desktop-'+index,workspace:'workspace-'+index}));
  const signal=AbortSignal.timeout(7000),events=[],stopped=new Set();
  let active=0,peak=0,release,allStarted;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{allStarted=resolve;});
  const admission=createHostAdmission({limit:34,signal,isCurrent:job=>c.ledger.get(job.id).state==='running'});
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal,
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request-'+thread,active:true}),
    host:{admit:admission.acquire,health:async()=>true,launch:async({job})=>({worker:job.worker}),
      execute:async({job,turnId,emit})=>{
        assert.equal(job.bot.replace('bot-',''),job.worker.replace('worker-',''));
        assert.equal(job.resources.length,2);
        peak=Math.max(peak,++active);if(active===34)allStarted();
        if(job.thread!=='followup')await gate;
        active--;
        emit({type:'item.completed',eventId:'report-'+job.id,itemType:'assistant_text',threadId:job.thread,turnId,text:job.bot});
        return{ok:true};
      },stop:async identity=>{stopped.add(identity.id);},inspectStopped:async identity=>{
        if(!stopped.has(identity.id))return false;admission.release(identity);return true;
      }}});
  try{
    const adapter=await c.bootstrap.createAdapter({instanceId:'workers',pool:'pool'});adapter.onEvent(event=>events.push(event));
    await Promise.all(assignments.map(row=>adapter.sendTurn({botId:row.bot,threadId:'thread-'+row.worker,text:'Synthetic independent job',
      approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}})));
    await ready;assert.equal(peak,34);
    assert.equal(c.ledger.db.prepare("SELECT count(*) AS n FROM jobs WHERE state='running'").get().n,34);
    assert.equal(c.ledger.db.prepare('SELECT count(*) AS n FROM resources').get().n,68);
    await adapter.sendTurn({botId:'bot-0',threadId:'followup',text:'Synthetic queued job',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}});
    assert.equal(c.ledger.db.prepare("SELECT count(*) AS n FROM jobs WHERE state='queued'").get().n,1);
    assert.equal(active,34);release();
    const results=await c.drain();assert.equal(results.length,35);assert.ok(results.every(row=>row.status==='fulfilled' && row.value.settled));
    assert.equal(c.ledger.db.prepare('SELECT count(*) AS n FROM resources').get().n,0);
    assert.equal(c.ledger.db.prepare("SELECT count(*) AS n FROM jobs WHERE state='completed'").get().n,35);
    const reports=events.filter(event=>event.type==='item.completed');assert.equal(reports.length,35);
    for(const row of assignments)assert.equal(reports.filter(event=>event.threadId==='thread-'+row.worker && event.text===row.bot).length,1);
    assert.equal(reports.filter(event=>event.threadId==='followup' && event.text==='bot-0').length,1);
  }finally{release();if(active===0)c.close();else c.ledger.close();}
});


test('worker browser catalogs mount after host startup and retain controller approvals',async()=>{
  const {openAccountScopedWorkerTools}=await import('./mounted-controller-tools.mjs');
  let started=false,mounted=0,executed=0,closed=0,adapter;
  const c=createWorkerCoordinator({file:':memory:',assignments,pools,signal:AbortSignal.timeout(5000),
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'browser-request',active:true}),
    openTools:args=>openAccountScopedWorkerTools({...args,browserTransport:{
      async tools(){assert.equal(started,true);mounted++;return[{name:'agent_browser_click',description:'Synthetic click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref'],additionalProperties:false}}];},
      async call(){executed++;return{content:[{type:'text',text:'worker browser clicked'}]};},
      async close(){closed++;}}}),
    host:{admit:async()=>{},health:async()=>true,launch:async()=>({}),
      execute:async({lease,signal})=>{
        assert.equal(mounted,0);started=true;
        const catalog=await c.tools.list({lease});assert.equal(catalog[0].function.name,'browser_agent_browser_click');
        const request={lease,signal,call:{id:'browser-click',tool:'browser_agent_browser_click',arguments:{ref:'e1'}}};
        assert.equal((await c.tools.execute(request)).result.ok,true);assert.equal((await c.tools.execute(request)).replay,true);
        return{ok:true};
      },stop:async()=>{},inspectStopped:async()=>true}});
  try{
    adapter=await c.bootstrap.createAdapter({instanceId:'worker',pool:'pool'});
    adapter.onEvent(event=>{if(event.type==='request.opened'){assert.equal(executed,0);void adapter.respondToRequest(event.threadId,event.requestId,{behavior:'allow'});}});
    await adapter.sendTurn({botId:'bot-a',threadId:'thread',text:'Synthetic browser task',approvalMode:'ask',mcpFromUserConfig:false,
      integrations:{browser:{command:'must-not-launch-controller-browser',args:[],env:{}},localComputer:{command:'must-not-launch-host-computer',args:[],env:{}}}});
    const results=await c.drain();assert.equal(results[0].value.outcome,'completed');
    assert.equal(mounted,1);assert.equal(executed,1);assert.equal(closed,1);
  }finally{c.close();}
});
