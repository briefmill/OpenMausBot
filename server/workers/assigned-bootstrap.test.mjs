import test from 'node:test';
import assert from 'node:assert/strict';
import {JobLedger} from './ledger.mjs';
import {listenTransport} from './transport.mjs';
import {workerClient} from './worker-client.mjs';
import {createAssignedProviderBootstrap} from './assigned-bootstrap.mjs';

test('assigned bootstrap derives each recurring thread from authenticated controller lease metadata',async()=>{
  const ledger=new JobLedger(':memory:'),token='w'.repeat(40);let transport,created=0;
  const seen=[];
  const driver={driverKind:'synthetic',decodeConfig:v=>v,create:async args=>{
    created++;let listener;
    return{instanceId:args.instanceId,driverKind:'synthetic',adapter:{provider:'synthetic',capabilities:{engineAdmission:true},
      onEvent(fn){listener=fn;return()=>{listener=null;}},async sendTurn(input){seen.push(input.threadId);await input.engineAdmission('process');
        const turnId='native-'+input.threadId;setImmediate(()=>listener({type:'turn.completed',eventId:'done',threadId:input.threadId,turnId,ok:true}));
        return{turnId};},async interruptTurn(){}},dispose:async()=>{}};
  }};
  const assignment={bot:'bot',project:'project',worker:'worker',desktop:'desktop',workspace:'workspace'};
  const instance={instanceId:'provider',enabled:true,environment:{},config:{}};
  const input={cwd:process.cwd(),approvalMode:'ask',mcpFromUserConfig:false,toolScope:{},engineAdmission:async()=>{},approvalModeNow:()=> 'ask'};
  try {
    transport=await listenTransport({ledger,controllerToken:'c'.repeat(40),workers:[{id:'worker',token,capacity:1,
      assignments:[{scope:'bot',bot:'bot',project:'project',resource:'desktop',resources:['workspace']}]}]});
    for(const [index,thread] of ['first','later-schedule'].entries()) {
      const jobId='job-'+index;ledger.enqueue({id:jobId,bot:'bot',thread,project:'project',resource:'desktop',resources:['workspace']});
      const lease=ledger.claim(jobId,'worker',30000),client=workerClient({origin:transport.origin,token});
      const task={jobId,lease,content:{text:'Task'}},signal=AbortSignal.timeout(2000);
      const host=await createAssignedProviderBootstrap({driver,instance,client,assignment,input})({signal,task});
      const result=await host.runtime.run(task,signal);assert.equal(result.result.ok,true);await host.close();
      ledger.finish(lease,'completed',ledger.putArtifact(lease,Buffer.from('Synthetic terminal and disposed instance')));
    }
    assert.deepEqual(seen,['first','later-schedule']);assert.equal(created,2);
    ledger.enqueue({id:'forged',bot:'bot',thread:'third',project:'project',resource:'desktop',resources:['workspace']});
    const lease=ledger.claim('forged','worker',30000),client=workerClient({origin:transport.origin,token});
    await assert.rejects(createAssignedProviderBootstrap({driver,instance,client,assignment,input})({signal:AbortSignal.timeout(1000),
      task:{jobId:'forged',lease:{...lease,token:'0'.repeat(64)},content:{text:'Task'}}}),/rejected/);
    assert.equal(created,2);client.close();
  }finally{await transport?.close();ledger.close();}
});

test('assigned bootstrap rejects a foreign project before provider construction',async()=>{
  let created=0,closed=0;
  const bootstrap=createAssignedProviderBootstrap({driver:{create:async()=>{created++;}},instance:{},
    client:{verifyLease:async()=>({id:'job',bot:'bot',project:'foreign',worker:'worker',resource:'desktop',resources:['desktop','workspace']}),close:()=>{closed++;}},
    assignment:{bot:'bot',project:'project',worker:'worker',desktop:'desktop',workspace:'workspace'},input:{}});
  await assert.rejects(bootstrap({signal:AbortSignal.timeout(1000),task:{jobId:'job',lease:{}}}),/Foreign/);
  assert.equal(created,0);assert.equal(closed,1);
});
