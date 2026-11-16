import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { JobLedger } from './ledger.mjs';
import { listenTransport } from './transport.mjs';

test('separate worker process runs authenticated provider work with a private receipt pipe',async()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-worker-process-')),ledger=new JobLedger(':memory:');
  let transport,child;
  try {
    const token=randomBytes(32).toString('hex');
    const assignment={bot:'bot',thread:'thread',project:'project',resource:'desktop'};
    ledger.enqueue({id:'job',...assignment});
    transport=await listenTransport({ledger,controllerToken:randomBytes(32).toString('hex'),workers:[{id:'worker',token,capacity:1,assignments:[assignment]}]});
    const lease=ledger.claim('job','worker',30000),bootstrapFile=join(home,'bootstrap.mjs');
    writeFileSync(bootstrapFile,`
      import {workerClient} from ${JSON.stringify(new URL('./worker-client.mjs',import.meta.url).href)};
      import {createBoundWorkerRuntime} from ${JSON.stringify(new URL('./worker-runtime.mjs',import.meta.url).href)};
      export async function bootstrap(){
        const client=workerClient({origin:${JSON.stringify(transport.origin)},token:${JSON.stringify(token)}});let listener;
        const adapter={capabilities:{engineAdmission:true},onEvent(fn){listener=fn;return()=>{listener=null;}},
          async sendTurn(input){await input.engineAdmission('process');setImmediate(()=>{
            listener({eventId:'reply',type:'item.completed',itemType:'assistant_text',text:'Child process report',threadId:'thread',turnId:'child-turn'});
            listener({eventId:'done',type:'turn.completed',ok:true,threadId:'thread',turnId:'child-turn'});
          });return{turnId:'child-turn'};},async interruptTurn(){}};
        return{runtime:createBoundWorkerRuntime({client,adapter,
          binding:{jobId:'job',worker:'worker',generation:1,botId:'bot',threadId:'thread'},
          input:{botId:'bot',threadId:'thread',cwd:${JSON.stringify(home)},approvalMode:'ask',mcpFromUserConfig:false,
            toolScope:{},engineAdmission:async()=>{},approvalModeNow:()=> 'ask'}}),close:async()=>client.close()};
      }
    `);
    child=spawn(process.execPath,[fileURLToPath(new URL('./worker-process.mjs',import.meta.url)),bootstrapFile,'5000'],{
      cwd:home,windowsHide:true,stdio:['pipe','pipe','pipe','pipe'],
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TEMP:home,TMP:home}});
    const receipts=[],stdout=[],stderr=[];
    child.stdio[3].on('data',b=>receipts.push(b));child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));
    const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
    child.stdin.end(JSON.stringify({jobId:'job',lease,content:{text:'Synthetic task'}}));
    assert.equal(await exit,0,Buffer.concat(stderr).toString());
    const wire=Buffer.concat(receipts).toString(),receipt=JSON.parse(wire);
    assert.equal(receipt.result.ok,true);assert.equal(receipt.result.turnId,'child-turn');assert.equal(receipt.worker,'worker');
    assert.equal(wire.includes(token),false);assert.equal(wire.includes(lease.token),false);assert.equal(Buffer.concat(stdout).length,0);
    assert.equal(ledger.readEvents('job').events.find(row=>row.event.itemType==='assistant_text').event.text,'Child process report');
    assert.equal(ledger.get('job').state,'running');
    const before=ledger.readEvents('job').lastSeq;
    child=spawn(process.execPath,[fileURLToPath(new URL('./worker-process.mjs',import.meta.url)),bootstrapFile,'5000'],{
      cwd:home,windowsHide:true,stdio:['pipe','ignore','pipe','pipe'],
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TEMP:home,TMP:home}});
    const rejected=[],errors=[];
    child.stdio[3].on('data',b=>rejected.push(b));child.stderr.on('data',b=>errors.push(b));
    const denied=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
    child.stdin.end(JSON.stringify({jobId:'job',lease,content:{text:'Synthetic',cwd:'/foreign'}}));
    assert.equal(await denied,1);assert.equal(Buffer.concat(rejected).length,0);
    assert.match(Buffer.concat(errors).toString(),/host reconciliation required/);
    assert.equal(Buffer.concat(errors).toString().includes(lease.token),false);
    assert.equal(ledger.readEvents('job').lastSeq,before);
  } finally {
    if(child && child.exitCode===null){child.kill();await new Promise(resolve=>child.once('close',resolve));}
    await transport?.close();ledger.close();
    assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-worker-process-'));
    rmSync(home,{recursive:true,force:true});
  }
});
