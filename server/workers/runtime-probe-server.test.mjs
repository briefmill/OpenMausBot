import test from 'node:test';import assert from 'node:assert/strict';
import {startRuntimeProbe} from './runtime-probe-server.mjs';
test('preflight service serves only readiness and closes its listener',async()=>{
  const probe=await startRuntimeProbe({port:0,listenHost:'127.0.0.1',ttlMs:10000});
  const origin='http://127.0.0.1:'+probe.port;
  try{
    assert.equal(probe.report.railwayQualified,false);assert.equal((await fetch(origin+'/health')).status,200);
    assert.equal((await fetch(origin+'/v1/jobs/anything/run',{method:'POST'})).status,404);
  }finally{await probe.close();}
  await assert.rejects(fetch(origin+'/health'));
});
test('preflight service rejects an unbounded lifetime',async()=>{
  await assert.rejects(startRuntimeProbe({ttlMs:120001}),/Bounded/);
});

test('preflight service stops itself at its configured deadline',async()=>{
  const probe=await startRuntimeProbe({port:0,listenHost:'127.0.0.1',ttlMs:50});
  try{await new Promise(resolve=>setTimeout(resolve,100));await assert.rejects(fetch('http://127.0.0.1:'+probe.port+'/health'));}
  finally{await probe.close();}
});
