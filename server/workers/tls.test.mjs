import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {X509Certificate,createHash} from 'node:crypto';
import {request} from 'node:https';
import {JobLedger} from './ledger.mjs';
import {listenTransport} from './transport.mjs';
import {tlsRequester} from './tls-request.mjs';
import {workerClient} from './worker-client.mjs';
const assignment={bot:'b',thread:'t',project:'p',resource:'desktop'};
const token='w'.repeat(40),controllerToken='c'.repeat(40);
function certificates(dir){
 const run=args=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
 run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-days','1','-subj','/CN=disposable-worker-fixture']);
 for(const name of ['server','controller','worker','outsider']){
  run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+name]);
  writeFileSync(join(dir,name+'.ext'),name==='server'?'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth':'extendedKeyUsage=clientAuth');
  run(['x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out',name+'.crt','-days','1','-extfile',name+'.ext']);
 }
 const ca=readFileSync(join(dir,'ca.crt'));const peer=name=>({ca,key:readFileSync(join(dir,name+'.key')),cert:readFileSync(join(dir,name+'.crt'))});
 const pin=name=>createHash('sha256').update(new X509Certificate(peer(name).cert).raw).digest('hex');
 return{peer,pin,server:{...peer('server'),controllerPin:pin('controller'),workerPins:{worker1:pin('worker')}}};
}
test('mutual TLS binds the controller and worker certificates to their bearer roles',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'maus-mtls-'));let transport;const clients=[];const ledger=new JobLedger(join(dir,'jobs.db'));const certs=certificates(dir);
 try{
  transport=await listenTransport({ledger,controllerToken,workers:[{id:'worker1',token,capacity:1,assignments:[assignment]}],tls:certs.server});
  const client=name=>{const c=tlsRequester(transport.origin,certs.peer(name));clients.push(c);return c};
  const controller=client('controller'),worker=client('worker'),outsider=client('outsider');
  await controller.call('/v1/jobs',controllerToken,{id:'one',...assignment});
  const claimed=await worker.call('/v1/jobs/one/claim',token,{});assert.equal(claimed.lease.worker,'worker1');
  await assert.rejects(worker.call('/v1/jobs/one',controllerToken),/403/);
  await assert.rejects(controller.call('/v1/jobs/one',token),/403/);
  await assert.rejects(outsider.call('/v1/jobs/one',token),/403/);
  await assert.rejects(worker.call('/v1/jobs/one','invalid'.repeat(8)),/401/);
  await assert.rejects(new Promise((resolve,reject)=>{const r=request(transport.origin+'/v1/jobs/one',{ca:certs.peer('worker').ca,agent:false,headers:{authorization:'Bearer '+token}},res=>{res.resume();res.on('end',resolve)});r.on('error',reject);r.end()}));
  await assert.rejects(new Promise((resolve,reject)=>{const r=request(transport.origin+'/v1/jobs/one',{...certs.peer('worker'),ca:undefined,agent:false,headers:{authorization:'Bearer '+token}},res=>{res.resume();res.on('end',resolve)});r.on('error',reject);r.end()}));
  await assert.rejects(worker.call('/v1/jobs/one/finish',token,{generation:claimed.lease.generation,token:claimed.lease.token,outcome:'cancelled',artifact:{bytes:0,sha256:'0'.repeat(64)}}),/403/);
  // No process was launched for this transport-only job. Trusted host settles it locally.
  await controller.call('/v1/jobs/one/cancel',controllerToken,{});
  ledger.finish(claimed.lease,'cancelled',{bytes:0,sha256:'0'.repeat(64)});
  await controller.call('/v1/jobs',controllerToken,{id:'two',...assignment});
  let listener;const adapter={capabilities:{engineAdmission:true},onEvent(fn){listener=fn;return()=>{listener=null}},async sendTurn(input){await input.engineAdmission('process');setTimeout(()=>listener?.({eventId:'done',type:'turn.completed',provider:'fixture',threadId:'t',turnId:'fixture-turn',ok:true}),5);return{turnId:'fixture-turn'}},async interruptTurn(){}};
  const runner=workerClient({origin:transport.origin,token,tls:certs.peer('worker'),heartbeatMs:20});clients.push(runner);
  const result=await runner.run({jobId:'two',adapter,signal:AbortSignal.timeout(3000),input:{botId:'b',threadId:'t',text:'synthetic',approvalMode:'ask',toolScope:{},mcpFromUserConfig:false,engineAdmission:async()=>{},approvalModeNow:()=> 'ask'}});assert.equal(result.result.ok,true);assert.equal(result.lease.worker,'worker1');
  for(const c of clients)c.close();await transport.close();transport=null;
  await assert.rejects(listenTransport({ledger,controllerToken,workers:[{id:'worker1',token,capacity:1,assignments:[assignment]}],tls:{...certs.server,workerPins:{worker1:certs.pin('outsider')}}}),/reconciliation/);
 }finally{for(const c of clients)c.close();if(transport)await transport.close();ledger.close();rmSync(dir,{recursive:true,force:true})}
});
test('worker client refuses remote cleartext and TLS verification overrides before dispatch',()=>{
 assert.throws(()=>workerClient({origin:'http://example.com:443',token}),/Loopback/);
 assert.throws(()=>workerClient({origin:'https://127.0.0.1:443',token}),/Explicit/);
 assert.throws(()=>workerClient({origin:'http://127.0.0.1:443',token,tls:{}}),/Explicit/);
 assert.throws(()=>tlsRequester('https://127.0.0.1:443',{ca:'x',key:'x',cert:'x',rejectUnauthorized:false}),/mutual TLS/);
});
