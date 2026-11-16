import test from 'node:test';
import assert from 'node:assert/strict';
import {createContainerSupervisor} from './container-supervisor.mjs';

const identity={id:'job',worker:'worker',generation:1},containerId='a'.repeat(64);
test('host supervisor checks ownership before stopping and independently verifies exit',async()=>{
  let state={Status:'running',Running:true,Restarting:false,Paused:false},supervisor;
  const commands=[];
  supervisor=createContainerSupervisor({namespace:'host',dockerArgs:args=>['-H','ssh://approved-host',...args],
    run:async(args,options)=>{
      commands.push(args);assert.equal(options.timeoutMs,10000);assert.deepEqual(args.slice(0,2),['-H','ssh://approved-host']);
      const op=args[2];if(op==='ps')return{stdout:containerId};
      if(op==='inspect')return{stdout:[containerId,supervisor.labels(identity),state].map(JSON.stringify).join('\n')};
      assert.equal(op,'stop');assert.equal(args.at(-1),containerId);
      state={Status:'exited',Running:false,Restarting:false,Paused:false};return{stdout:containerId};
    }});
  assert.equal(await supervisor.inspectStopped(identity),false);
  await supervisor.stop(identity);assert.equal(await supervisor.inspectStopped(identity),true);
  assert.equal(commands.filter(args=>args[2]==='stop').length,1);
});

test('foreign ownership and failed host inspection cannot attest shutdown',async()=>{
  let stopped=false;
  const supervisor=createContainerSupervisor({namespace:'host',dockerArgs:args=>args,run:async args=>{
    if(args[0]==='ps')return{stdout:containerId};
    if(args[0]==='inspect')return{stdout:[containerId,{},{}].map(JSON.stringify).join('\n')};
    stopped=true;return{stdout:''};
  }});
  await assert.rejects(supervisor.stop(identity),/Foreign/);assert.equal(stopped,false);
  await assert.rejects(supervisor.inspectStopped(identity),/Foreign/);
  const offline=createContainerSupervisor({namespace:'host',dockerArgs:args=>args,run:async()=>{throw Error('Host offline');}});
  await assert.rejects(offline.inspectStopped(identity),/offline/);
});

test('only a successful empty ownership query proves no container remains',async()=>{
  const supervisor=createContainerSupervisor({namespace:'host',dockerArgs:args=>args,run:async()=>({stdout:''})});
  assert.equal(await supervisor.inspectStopped(identity),true);
  await assert.rejects(supervisor.stop({...identity,worker:'--foreign'}),/ownership/);
});
