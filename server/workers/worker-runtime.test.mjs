import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundWorkerRuntime } from './worker-runtime.mjs';
const binding={jobId:'job',worker:'worker',generation:1,botId:'bot',threadId:'thread'};
const lease={id:'job',worker:'worker',generation:1,token:'a'.repeat(64),deadline:Date.now()+30000};
const input={botId:'bot',threadId:'thread',cwd:process.cwd(),model:'approved',approvalMode:'ask',mcpFromUserConfig:false,
  toolScope:{allow:['read']},engineAdmission:async()=>{},approvalModeNow:()=> 'ask'};

test('bound runtime pins host execution settings and refuses reuse after dispatch',async()=>{
  let received,starts=0;
  const runtime=createBoundWorkerRuntime({binding,input,adapter:{},client:{run:async args=>{starts++;received=args;return'accepted';}}});
  const task={jobId:'job',lease,content:{text:'Task',transcript:[{role:'assistant',text:'Prior result'}]}};
  assert.equal(await runtime.run(task,AbortSignal.timeout(1000)),'accepted');
  assert.equal(received.input.model,'approved');assert.equal(received.input.cwd,process.cwd());
  assert.deepEqual(received.input.toolScope,{allow:['read']});assert.equal(received.input.mcpFromUserConfig,false);
  await assert.rejects(runtime.run(task,AbortSignal.timeout(1000)),/already consumed/);assert.equal(starts,1);
});

test('bound runtime rejects task-supplied execution or integration overrides before provider dispatch',async()=>{
  let starts=0;
  const runtime=createBoundWorkerRuntime({binding,input,adapter:{},client:{run:async()=>{starts++;}}});
  for(const [key,value] of Object.entries({cwd:'/foreign',model:'foreign',approvalMode:'full-access',
    mcpFromUserConfig:true,integrations:{custom:{}},userSkillsDir:'/foreign',toolScope:{allow:['*']},
    images:[{path:'/foreign'}],resumeCursor:'foreign'}))
    await assert.rejects(runtime.run({jobId:'job',lease,content:{text:'Task',[key]:value}},AbortSignal.timeout(1000)),/execution settings/);
  await assert.rejects(runtime.run({jobId:'job',lease:{...lease,generation:2},content:{text:'Task'}},AbortSignal.timeout(1000)),/Foreign/);
  assert.equal(starts,0);
});

test('failed dispatch consumes its runtime and does not permit automatic model retry',async()=>{
  let starts=0;
  const runtime=createBoundWorkerRuntime({binding,input,adapter:{},client:{run:async()=>{starts++;throw Error('Uncertain transport');}}});
  const task={jobId:'job',lease,content:{text:'Task'}};
  await assert.rejects(runtime.run(task,AbortSignal.timeout(1000)),/Uncertain transport/);
  await assert.rejects(runtime.run(task,AbortSignal.timeout(1000)),/reconciliation/);assert.equal(starts,1);
});
