import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';
import {providerMcpTool,providerToolAllowKey} from '../provider-tool-allow.ts';
import {JobLedger} from './ledger.mjs';
import {createDurableToolExecutor} from './tool-executor.mjs';
import {openAccountScopedWorkerTools} from './mounted-controller-tools.mjs';
const identity={id:'job',bot:'bot',thread:'thread',project:'project',generation:1};

test('mounted worker tools preserve separate synthetic account environments and refuse foreign input',{timeout:20000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'omb-worker-account-')),script=join(directory,'mcp.mjs');
  writeFileSync(script,String.raw`import {createInterface} from 'node:readline';
    const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
    createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);
      if(m.method==='initialize')send(m.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
      if(m.method==='tools/list')send(m.id,{tools:[{name:'read_account',description:'Synthetic account read',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
      if(m.method==='tools/call' && process.env.SYNTHETIC_CRASH_ON_CALL==='1')process.exit(5);
      if(m.method==='tools/call')send(m.id,{content:[{type:'text',text:process.env.SYNTHETIC_ACCOUNT+' '+process.env.SYNTHETIC_TOKEN}]});
    });`);
  const sessions=[];
  try {
    for(const account of ['account-a','account-b']) {
      const signal=AbortSignal.timeout(15000),events=[];
      const input={botId:'bot',threadId:'thread',approvalMode:'ask',mcpFromUserConfig:false,
        integrations:{composio:{command:process.execPath,args:[script],env:{SYNTHETIC_ACCOUNT:account,SYNTHETIC_TOKEN:'fixture-credential-value'}},browser:{command:'must-not-launch-controller-browser',args:[],env:{}}}};
      let session;
      session=await openAccountScopedWorkerTools({input,job:identity,turnId:'turn',signal,isCurrent:()=>true,
        emit:event=>{events.push(event);if(event.type==='request.opened')session.respondToRequest('thread',event.requestId,{behavior:'allow'});}});
      sessions.push(session);
      const call={id:'call',tool:'composio_read_account',arguments:{}};
      assert.equal(await session.authorize({job:identity,call,signal}),true);
      const result=await session.dispatch({job:identity,call,signal});
      assert.equal(result.ok,true);assert.ok(result.text.includes(account));
      assert.equal(result.text.includes('fixture-credential-value'),false);assert.ok(result.text.includes('[redacted]'));
      assert.equal(result.text.includes(account==='account-a'?'account-b':'account-a'),false);
      assert.equal(events.filter(e=>e.type==='request.opened').length,1);
      const canonical=events.find(e=>e.type==='request.opened').tool;
      assert.equal(canonical,'mcp__composio__read_account');
      assert.deepEqual(providerMcpTool(canonical),{server:'composio',tool:'read_account'});
      const key=providerToolAllowKey('worker-provider',canonical,input.integrations.composio);
      assert.ok(key);
      assert.notEqual(key,providerToolAllowKey('worker-provider',canonical,{...input.integrations.composio,env:{SYNTHETIC_ACCOUNT:'changed'}}));
      assert.equal(providerToolAllowKey('worker-provider','mcp__composio__send_email',input.integrations.composio),null);
      await assert.rejects(openAccountScopedWorkerTools({input:{...input,botId:'foreign'},job:identity,signal,isCurrent:()=>true}),/Controller-owned/);
      const restricted=await openAccountScopedWorkerTools({input:{...input,toolScope:{deny:['mcp:composio:read_account']}},job:identity,
        turnId:'restricted',signal,isCurrent:()=>true,emit:()=>{throw Error('Denied tool must not open approval');}});
      sessions.push(restricted);
      await assert.rejects(restricted.authorize({job:identity,call,signal}),/not advertised|excludes/i);
    }
    const ledger=new JobLedger(':memory:');
    ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
    const lease=ledger.claim('job','worker',30000),signal=AbortSignal.timeout(10000);
    let crashing;
    try {
      crashing=await openAccountScopedWorkerTools({job:ledger.get('job'),turnId:'crash',signal,isCurrent:()=>ledger.get('job').state==='running',
        input:{botId:'bot',threadId:'thread',approvalMode:'ask',mcpFromUserConfig:false,integrations:{composio:{command:process.execPath,args:[script],
          env:{SYNTHETIC_ACCOUNT:'crashing',SYNTHETIC_CRASH_ON_CALL:'1'}}}},
        emit:event=>{if(event.type==='request.opened')crashing.respondToRequest('thread',event.requestId,{behavior:'allow'});}});
      const runner=createDurableToolExecutor({ledger,...crashing});
      await assert.rejects(runner.execute({lease,signal,call:{id:'crash-call',tool:'composio_read_account',arguments:{}}}),/reconciliation/);
      assert.equal(ledger.get('job').state,'cancelling');
      assert.equal(ledger.db.prepare('SELECT state FROM worker_tool_calls').get().state,'uncertain');
      await assert.rejects(runner.execute({lease,signal,call:{id:'new-id',tool:'composio_read_account',arguments:{}}}),/cancelled/);
    }finally{await crashing?.close();ledger.close();}
  } finally {
    await Promise.all(sessions.map(session=>session.close()));
    if(dirname(resolve(directory))!==resolve(tmpdir()))throw Error('Unexpected fixture path');
    rmSync(directory,{recursive:true,force:true});
  }
});

test('worker agents relay keeps controller-owned tool scope and canonical identity',{timeout:15000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'omb-worker-agents-')),script=join(root,'agents.mjs');
 writeFileSync(script,`import {createInterface} from 'node:readline';
 const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
 createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize')send(m.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'agents',version:'1'}});
 if(m.method==='tools/list')send(m.id,{tools:['list_bots','send_message'].map(name=>({name,inputSchema:{type:'object',properties:{},additionalProperties:false}}))});
 if(m.method==='tools/call')send(m.id,{content:[{type:'text',text:'controller-bound:'+process.env.FIXTURE_OWNER}]});
 });`);
 const signal=AbortSignal.timeout(10000);let session;
 try{
  session=await openAccountScopedWorkerTools({input:{botId:'bot',threadId:'thread',approvalMode:'ask',mcpFromUserConfig:false,
   toolScope:{deny:['mcp:agents:send_message']},integrations:{agents:{command:process.execPath,args:[script],env:{FIXTURE_OWNER:'bot/thread'}}}},
   job:identity,turnId:'turn',signal,isCurrent:()=>true,emit:event=>{if(event.type==='request.opened'){assert.equal(event.tool,'mcp__agents__list_bots');session.respondToRequest('thread',event.requestId,{behavior:'allow'});}}});
  const definitions=session.definitions();assert.ok(definitions.some(x=>x.function?.name==='agents_list_bots'));assert.ok(!definitions.some(x=>x.function?.name==='agents_send_message'));
  const call={id:'agents-call',tool:'agents_list_bots',arguments:{}};
  assert.equal(await session.authorize({job:identity,call,signal}),true);
  const result=await session.dispatch({job:identity,call,signal});assert.equal(result.ok,true);assert.ok(result.text.includes('controller-bound:bot/thread'));
 }finally{await session?.close();rmSync(root,{recursive:true,force:true});}
});
