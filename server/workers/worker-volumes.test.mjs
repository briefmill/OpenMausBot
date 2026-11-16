import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerVolumes} from './worker-volumes.mjs';

test('workspace catalog binds volume ownership and initializes only a new owned volume',async()=>{
  const scope={bot:'bot',project:'project',workspace:'workspace'};let storage,exists=false,initializations=0,checks=0;
  const run=async args=>{
    const {name,labels}=storage.describe(scope);
    if(args[0]==='volume' && args[1]==='ls')return{stdout:exists?name:''};
    if(args[0]==='volume' && args[1]==='create'){exists=true;return{stdout:name};}
    if(args[0]==='volume' && args[1]==='inspect')return{stdout:[name,labels,'local',null].map(JSON.stringify).join('\n')};
    assert.equal(args[0],'run');assert.ok(args.includes('--network'));assert.ok(args.includes('none'));
    if(args.includes('--cap-add'))initializations++;else checks++;return{stdout:''};
  };
  storage=createWorkerVolumes({run,dockerArgs:a=>a,namespace:'host',initImage:'sha256:'+'a'.repeat(64)});
  const first=await storage.ensure(scope),second=await storage.ensure(scope);
  assert.deepEqual(first,second);assert.equal(initializations,1);assert.equal(checks,2);
  await assert.rejects(storage.verify(first.name,{...scope,bot:'foreign'}),/Foreign workspace volume/);
});

test('foreign or driver-option volumes cannot pass workspace verification',async()=>{
  const scope={bot:'bot',project:'project',workspace:'workspace'};let storage;
  storage=createWorkerVolumes({namespace:'host',initImage:'sha256:'+'a'.repeat(64),dockerArgs:a=>a,
    run:async()=>({stdout:[storage.describe(scope).name,storage.describe(scope).labels,'local',{device:'/foreign',o:'bind'}].map(JSON.stringify).join('\n')})});
  await assert.rejects(storage.verify(storage.describe(scope).name,scope),/Foreign workspace storage/);
});
