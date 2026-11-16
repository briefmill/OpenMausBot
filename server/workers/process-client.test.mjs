import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { createWorkerProcessClient } from './process-client.mjs';

test('host process client sends one task and rejects process failure without private errors',async()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-process-client-')),bootstrapFile=join(home,'bootstrap.mjs');
  const children=[];
  try {
    writeFileSync(bootstrapFile,`export async function bootstrap(){return{runtime:{async run(task){
      if(task.content.text==='fail')throw Error('synthetic-private-error');
      return{result:{turnId:'native',ok:true,cancelled:false,events:2,stopReason:null}};
    }},close:async()=>{}};}`);
    const client=createWorkerProcessClient({bootstrapFile,cwd:home,deadlineMs:5000,
      environment:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TEMP:home,TMP:home},
      onProcess:identity=>children.push(identity)});
    const input={botId:'bot',threadId:'thread',text:'Task'},job={id:'job',bot:'bot',thread:'thread'};
    const lease={id:'job',worker:'worker',generation:1,token:'a'.repeat(64),deadline:Date.now()+30000};
    const result=await client({job,lease,input,signal:AbortSignal.timeout(6000)});
    assert.equal(result.result.ok,true);assert.deepEqual(result.lease,lease);
    assert.equal(children[0].id,'job');assert.equal(children[0].child.exitCode,0);
    await assert.rejects(client({job,lease,input:{...input,text:'fail'},signal:AbortSignal.timeout(6000)}),error=>{
      assert.equal(error.message.includes('synthetic-private-error'),false);return /reconciliation/.test(error.message);
    });
    const before=children.length;
    await assert.rejects(client({job,lease,input:{...input,images:[{path:'/foreign'}]},signal:AbortSignal.timeout(1000)}),/Unsupported/);
    assert.equal(children.length,before);
  } finally {
    for(const {child} of children)if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('close',resolve));}
    assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-process-client-'));
    rmSync(home,{recursive:true,force:true});
  }
});
