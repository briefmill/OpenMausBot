import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {X509Certificate,createHash} from 'node:crypto';
import {listenExecutionService} from './service-transport.mjs';
import {createServiceExecution} from './service-execution.mjs';
import {createServiceClient} from './service-client.mjs';
import {tlsRequester} from './tls-request.mjs';
const assignment={scope:'bot',bot:'bot',project:'project',resource:'desktop',resources:['workspace']};
const token='c'.repeat(40),worker='worker';
function certificates(root){
  const run=args=>execFileSync('openssl',args,{cwd:root,stdio:'ignore'});
  run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-days','1','-subj','/CN=service-fixture']);
  for(const name of ['server','controller','outsider']){
    run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+name]);
    writeFileSync(join(root,name+'.ext'),name==='server'?'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth':'extendedKeyUsage=clientAuth');
    run(['x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out',name+'.crt','-days','1','-extfile',name+'.ext']);
  }
  const peer=name=>({ca:readFileSync(join(root,'ca.crt')),key:readFileSync(join(root,name+'.key')),cert:readFileSync(join(root,name+'.crt'))});
  const pin=name=>createHash('sha256').update(new X509Certificate(peer(name).cert).raw).digest('hex');return{peer,pin};
}
const task=id=>({job:{id,worker,bot:'bot',thread:'thread',project:'project',resource:'desktop',resources:['desktop','workspace']},
  lease:{id,worker,generation:1,token:'a'.repeat(64),deadline:Date.now()+10000},content:{text:'synthetic'}});
const result={turnId:'synthetic',ok:true,cancelled:false,events:0,stopReason:null};

test('service mTLS binds controller identity, assignments, consumed generations and shutdown evidence',async()=>{
  const root=mkdtempSync(join(tmpdir(),'omb-execution-service-')),certs=certificates(root);let transport;const clients=[];
  let authorized=true,executions=0,hang=false,stopped=true,authorizeHang=false,entered=false;
  const service=createServiceExecution({file:join(root,'service.db'),worker,execute:async()=>{executions++;if(hang)return new Promise(()=>{});return{result};},stop:async()=>{},inspectStopped:async()=>stopped});
  try{
    transport=await listenExecutionService({service,worker,assignment,authorize:async()=>{entered=true;return authorizeHang?new Promise(()=>{}):authorized;},controllerToken:token,
      tls:{...certs.peer('server'),controllerPin:certs.pin('controller')}});
    const make=name=>{const client=tlsRequester(transport.origin,{...certs.peer(name),serverPin:certs.pin('server')});clients.push(client);return client;};
    const controller=make('controller'),outsider=make('outsider');
    await assert.rejects(outsider.call('/v1/jobs/one/run',token,task('one')),/403/);
    await assert.rejects(controller.call('/v1/jobs/one/run','x'.repeat(40),task('one')),/401/);
    const foreign=task('one');foreign.job.bot='foreign';
    await assert.rejects(controller.call('/v1/jobs/one/run',token,foreign),/400/);
    authorized=false;await assert.rejects(controller.call('/v1/jobs/one/run',token,task('one')),/403/);assert.equal(executions,0);
    authorized=true;const first=await controller.call('/v1/jobs/one/run',token,task('one'));assert.deepEqual(first.result,result);
    assert.equal(JSON.stringify(first).includes('a'.repeat(64)),false);
    await assert.rejects(controller.call('/v1/jobs/one/run',token,task('one')),/409/);assert.equal(executions,1);
    assert.deepEqual(await controller.call('/v1/jobs/one/status',token,{generation:1}),{state:'completed',stoppedVerified:true});
    assert.deepEqual(await controller.call('/v1/jobs/one/status',token,{generation:2}),{state:null,stoppedVerified:false});
    const bound=createServiceClient({origin:transport.origin,token,worker,tls:{...certs.peer('controller'),serverPin:certs.pin('server')}});clients.push(bound);
    await assert.rejects(bound.browser({lease:task('one').lease,operation:{id:'no-executor',method:'tools/list',params:{}}}),/503/);
    const next=task('two');assert.equal((await bound.execute({...next,input:{botId:'bot',threadId:'thread',text:'synthetic'},signal:AbortSignal.timeout(2000)})).result.ok,true);
    await bound.stop(next.lease);assert.equal(await bound.inspectStopped(next.lease),true);
    await bound.stop(task('unseen').lease);
    assert.equal(await bound.inspectStopped(task('unseen').lease),true);
    await assert.rejects(controller.call('/v1/jobs/unseen/run',token,task('unseen')),/409/);
    const wrong=tlsRequester(transport.origin,{...certs.peer('controller'),serverPin:'0'.repeat(64)});clients.push(wrong);
    await assert.rejects(wrong.call('/v1/jobs/one/status',token,{generation:1}),/pin mismatch/);
    hang=true;const hanging=task('hanging');
    const running=bound.execute({...hanging,input:{botId:'bot',threadId:'thread',text:'synthetic'},signal:AbortSignal.timeout(3000)});
    const failed=assert.rejects(running,/409/);
    const until=Date.now()+2000;
    while(service.state({id:'hanging',worker,generation:1})!=='running'){
      assert.ok(Date.now()<until,'Service must start the turn');await new Promise(resolve=>setTimeout(resolve,5));
    }
    await assert.rejects(controller.call('/v1/jobs/blocked/run',token,task('blocked')),/409/);
    await controller.call('/v1/jobs/hanging/cancel',token,{generation:2});
    assert.equal(service.state({id:'hanging',worker,generation:1}),'running');
    await bound.stop(hanging.lease);await failed;
    assert.equal(service.state({id:'hanging',worker,generation:1}),'cancelled');
    assert.equal(await bound.inspectStopped(hanging.lease),true);
    hang=false;authorizeHang=true;entered=false;const pendingAuth=task('pending-auth');
    const authFailure=assert.rejects(bound.execute({...pendingAuth,input:{botId:'bot',threadId:'thread',text:'synthetic'},signal:AbortSignal.timeout(3000)}),/409/);
    const authUntil=Date.now()+2000;
    while(!entered){assert.ok(Date.now()<authUntil);await new Promise(resolve=>setTimeout(resolve,5));}
    await bound.stop(pendingAuth.lease);await authFailure;authorizeHang=false;
    assert.equal(service.state({id:'pending-auth',worker,generation:1}),'cancelled');
    stopped=false;
    await assert.rejects(bound.execute({...task('uncertain'),input:{botId:'bot',threadId:'thread',text:'synthetic'},signal:AbortSignal.timeout(2000)}),/409/);
    assert.equal(await bound.inspectStopped(task('uncertain').lease),false);
    await assert.rejects(bound.stop(task('uncertain').lease),/reconciliation/);
    await assert.rejects(controller.call('/v1/jobs/held/run',token,task('held')),/409/);
  }finally{for(const client of clients)client.close();await transport?.close();service.close();rmSync(root,{recursive:true,force:true});}
});


test('service listener accepts explicit dual-stack binding with named pinned TLS',async()=>{
  const root=mkdtempSync(join(tmpdir(),'omb-service-ipv6-')),certs=certificates(root);
  const service=createServiceExecution({file:':memory:',worker,execute:async()=>({result}),stop:async()=>{},inspectStopped:async()=>true});
  let listener,client;
  try{
    listener=await listenExecutionService({service,worker,assignment,authorize:async()=>true,controllerToken:token,
      listenHost:'::',advertisedHost:'localhost',tls:{...certs.peer('server'),controllerPin:certs.pin('controller')}});
    client=createServiceClient({origin:listener.origin,worker,token,allowRemote:true,tls:{...certs.peer('controller'),serverPin:certs.pin('server')}});
    const current=task('dual');const reply=await client.execute({...current,input:{botId:'bot',threadId:'thread',text:'synthetic'},signal:AbortSignal.timeout(2000)});
    assert.equal(reply.result.ok,true);assert.equal(await client.inspectStopped(current.lease),true);
  }finally{client?.close();await listener?.close();service.close();rmSync(root,{recursive:true,force:true});}
});

test('browser route requires pinned controller, active exact lease, fresh authorization and unique invocation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'omb-service-browser-')),certs=certificates(root);let listener,client,entered,finish,releaseBrowser,allowed=true,calls=0;
 const started=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>finish=resolve);
 const service=createServiceExecution({file:':memory:',worker,execute:async()=>{entered();await held;return{result};},stop:async()=>{},inspectStopped:async()=>true});
 try{
  listener=await listenExecutionService({service,worker,assignment,authorize:async()=>allowed,controllerToken:token,
    browser:async({job,operation})=>{calls++;if(operation.id==='slow')await new Promise(resolve=>{releaseBrowser=resolve;});return{thread:job.thread,id:operation.id};},tls:{...certs.peer('server'),controllerPin:certs.pin('controller')}});
  client=createServiceClient({origin:listener.origin,token,worker,tls:{...certs.peer('controller'),serverPin:certs.pin('server')}});
  const current=task('browser'),operation={id:'call-1',method:'tools/list',params:{}};
  await assert.rejects(client.browser({lease:current.lease,operation}),/409/);
  const running=client.execute({...current,input:{botId:'bot',threadId:'thread',text:'synthetic'},signal:AbortSignal.timeout(5000)});await started;
  await assert.rejects(client.browser({lease:{...current.lease,token:'b'.repeat(64)},operation}),/409/);
  await assert.rejects(client.browser({lease:{...current.lease,generation:2},operation}),/409/);
  assert.deepEqual(await client.browser({lease:current.lease,operation}),{thread:'thread',id:'call-1'});
  await assert.rejects(client.browser({lease:current.lease,operation}),/409/);
  const slow=client.browser({lease:current.lease,operation:{...operation,id:'slow'}});
  const waitUntil=Date.now()+1000;while(!releaseBrowser){assert.ok(Date.now()<waitUntil);await new Promise(resolve=>setTimeout(resolve,5));}
  await assert.rejects(client.browser({lease:current.lease,operation:{...operation,id:'parallel'}}),/409/);releaseBrowser();await slow;
  allowed=false;await assert.rejects(client.browser({lease:current.lease,operation:{...operation,id:'refused'}}),/403/);assert.equal(calls,2);
  allowed=true;finish();await running;await assert.rejects(client.browser({lease:current.lease,operation:{...operation,id:'late'}}),/409/);
 }finally{finish?.();client?.close();await listener?.close();service.close();rmSync(root,{recursive:true,force:true});}
});
