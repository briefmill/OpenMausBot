import test from 'node:test';
import assert from 'node:assert/strict';
import {listenWorkerHealth} from './service-health.mjs';
import {startWorkerService} from './service-entry.mjs';

test('readiness reports only status and exposes no execution operations',async()=>{
  let ready=true;const health=await listenWorkerHealth({ready:()=>ready});
  const origin='http://127.0.0.1:'+health.port;
  try{
    const response=await fetch(origin+'/health',{headers:{host:'healthcheck.railway.app'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{status:'ready'});
    ready=false;const unavailable=await fetch(origin+'/health');assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{status:'unavailable'});
    for(const [path,method] of [['/health','POST'],['/v1/jobs/one/run','POST'],['/health?secret=1','GET']])
      assert.equal((await fetch(origin+path,{method})).status,404);
  }finally{await health.close();}
});

test('readiness fails closed when its state cannot be inspected',async()=>{
  const health=await listenWorkerHealth({ready:()=>{throw Error('private state');}});
  try{const response=await fetch('http://127.0.0.1:'+health.port+'/health');assert.equal(response.status,503);assert.equal((await response.text()).includes('private'),false);}
  finally{await health.close();}
});

test('standalone service rejects unsupported execution hosts before reading configuration',async()=>{
  if(process.platform!=='linux' || process.getuid?.()!==0)await assert.rejects(startWorkerService({configFile:'missing'}),/Root Linux/);
});
