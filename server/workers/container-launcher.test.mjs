import test from 'node:test';
import assert from 'node:assert/strict';
import {createContainerLauncher} from './container-launcher.mjs';
import {createContainerSupervisor} from './container-supervisor.mjs';

const plan={image:'sha256:'+'a'.repeat(64),cpus:1,memoryBytes:512*1024*1024,pids:128,shmBytes:64*1024*1024,
  network:'none',command:['node','/opt/worker/agent.mjs']};
const args={job:{id:'job',worker:'worker',bot:'bot',thread:'thread'},generation:1,pool:'pool',signal:AbortSignal.timeout(1000)};
test('container launch uses fixed ownership, image and hardening from trusted policy',async()=>{
  let received;
  const run=async(argv)=>{received=argv;return{stdout:'b'.repeat(64)};};
  const supervisor=createContainerSupervisor({run,dockerArgs:v=>v,namespace:'host'});
  const launch=createContainerLauncher({run,dockerArgs:v=>v,supervisor,resolvePlan:async()=>plan});
  const handle=await launch(args);assert.equal(handle.containerId,'b'.repeat(64));
  assert.ok(received.includes('--read-only'));assert.ok(received.includes('no-new-privileges'));
  assert.deepEqual(received.slice(received.indexOf('--pull'),received.indexOf('--pull')+2),['--pull','never']);
  assert.equal(received.includes('--privileged'),false);assert.equal(received.includes('--mount'),false);
  assert.equal(received.includes('--env'),false);assert.equal(received.includes('--volume'),false);
  assert.deepEqual(received.slice(-4),[plan.image,'--',...plan.command]);
});

test('mutable images, broad networks, mounts and task-selected privilege plans fail before Docker',async()=>{
  let calls=0;
  const run=async()=>{calls++;return{stdout:'b'.repeat(64)};};
  const supervisor=createContainerSupervisor({run,dockerArgs:v=>v,namespace:'host'});
  for(const change of [{image:'latest'},{network:'host'},{network:'bridge'},{mounts:['/var/run/docker.sock']},{pids:0},{command:['node','bad\0arg']}]) {
    const launch=createContainerLauncher({run,dockerArgs:v=>v,supervisor,resolvePlan:async()=>({...plan,...change})});
    await assert.rejects(launch(args),/Unapproved/);
  }
  assert.equal(calls,0);
});
