import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';
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
      await assert.rejects(openAccountScopedWorkerTools({input:{...input,botId:'foreign'},job:identity,signal,isCurrent:()=>true}),/Controller-owned/);
      const restricted=await openAccountScopedWorkerTools({input:{...input,toolScope:{deny:['mcp:composio:read_account']}},job:identity,
        turnId:'restricted',signal,isCurrent:()=>true,emit:()=>{throw Error('Denied tool must not open approval');}});
      sessions.push(restricted);
      await assert.rejects(restricted.authorize({job:identity,call,signal}),/not advertised|excludes/i);
    }
  } finally {
    await Promise.all(sessions.map(session=>session.close()));
    if(dirname(resolve(directory))!==resolve(tmpdir()))throw Error('Unexpected fixture path');
    rmSync(directory,{recursive:true,force:true});
  }
});
