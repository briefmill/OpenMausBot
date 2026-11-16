import test from 'node:test';import assert from 'node:assert/strict';
import {parseLinuxCapabilities,workerRuntimePreflight} from './runtime-preflight.mjs';
test('runtime capability parsing distinguishes supervisor and initializer privileges',()=>{
  assert.deepEqual(parseLinuxCapabilities('CapEff:\t00000000000001c0\n'),{CHOWN:false,SETGID:true,SETUID:true,SETPCAP:true});
  assert.deepEqual(parseLinuxCapabilities('CapEff:\t0000000000000001\n'),{CHOWN:true,SETGID:false,SETUID:false,SETPCAP:false});
  assert.equal(parseLinuxCapabilities('CapEff: invalid'),null);
});
test('default preflight reports observations without claiming isolation or authentication',async()=>{
  const previous=process.env.OMB_PREFLIGHT_TEST_SECRET,secret='synthetic-private-preflight-sentinel';
  process.env.OMB_PREFLIGHT_TEST_SECRET=secret;
  try{
    const result=await workerRuntimePreflight();assert.equal(result.railwayQualified,false);assert.equal(result.modelAuthenticationVerified,false);assert.equal(result.privilegeDrop,null);
    assert.equal(JSON.stringify(result).includes(secret),false);
  }finally{if(previous===undefined)delete process.env.OMB_PREFLIGHT_TEST_SECRET;else process.env.OMB_PREFLIGHT_TEST_SECRET=previous;}
  await assert.rejects(workerRuntimePreflight({storageRoot:'/'}),/Explicit storage/);
});
