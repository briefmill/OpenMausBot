import test from 'node:test';
import assert from 'node:assert/strict';
import {createContainerExecution} from './container-execution.mjs';

const containerId='a'.repeat(64),job={id:'job',bot:'bot',thread:'thread',worker:'worker'};
const lease={id:'job',worker:'worker',generation:1,token:'b'.repeat(64),deadline:Date.now()+30000};
const result={turnId:'native',ok:true,cancelled:false,events:2,stopReason:null};
const agent={entry:'/opt/worker/container-agent.mjs',bootstrap:'/opt/worker/bootstrap.mjs',cwd:'/workspace',deadlineMs:1000};
const args={job,lease,handle:{containerId},input:{botId:'bot',threadId:'thread',text:'Task'},signal:AbortSignal.timeout(2000)};
test('container executor sends lease credentials on stdin only and validates the owned receipt',async()=>{
  let argv,options;
  const execute=createContainerExecution({dockerArgs:v=>v,supervisor:{inspect:async()=>({containerId,state:{Running:true,Restarting:false}})},
    resolveAgent:async()=>agent,run:async(a,o)=>{argv=a;options=o;return{stdout:JSON.stringify({jobId:'job',worker:'worker',generation:1,result})};}});
  const value=await execute(args);assert.deepEqual(value,{lease,result});
  assert.equal(argv.includes(lease.token),false);assert.equal(JSON.parse(options.input).lease.token,lease.token);
  assert.equal(options.timeoutMs,1000);assert.equal(argv.includes(containerId),true);
});
test('foreign handles stop before exec and foreign receipts cannot complete the turn',async()=>{
  let calls=0;
  const factory=owned=>createContainerExecution({dockerArgs:v=>v,supervisor:{inspect:async()=>({containerId:owned,state:{Running:true,Restarting:false}})},
    resolveAgent:async()=>agent,run:async()=>{calls++;return{stdout:JSON.stringify({jobId:'foreign',worker:'worker',generation:1,result})};}});
  await assert.rejects(factory('c'.repeat(64))(args),/ownership/);assert.equal(calls,0);
  await assert.rejects(factory(containerId)(args),/Foreign/);assert.equal(calls,1);
});
