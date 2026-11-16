import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostAdmission} from './host-admission.mjs';

test('host admission queues excess jobs until the matching stopped generation releases capacity',async()=>{
  const a={id:'a',worker:'a',generation:1},b={id:'b',worker:'b',generation:1};
  const admission=createHostAdmission({limit:1,isCurrent:()=>true,signal:AbortSignal.timeout(2000)});
  await admission.acquire({job:a});let entered=false;
  const waiting=admission.acquire({job:b}).then(()=>{entered=true;});
  assert.equal(admission.release({...a,generation:2}),false);
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(entered,false);
  assert.equal(admission.release(a),true);await waiting;assert.equal(entered,true);
  assert.equal(admission.release(b),true);
});

test('cancelled queued admission never consumes the active owner slot',async()=>{
  let allowed=true;
  const admission=createHostAdmission({limit:1,isCurrent:()=>allowed,signal:AbortSignal.timeout(2000)});
  const owner={id:'owner',worker:'a',generation:1};await admission.acquire({job:owner});
  allowed=false;
  await assert.rejects(admission.acquire({job:{id:'queued',worker:'b',generation:1}}),/cancelled/);
  assert.equal(admission.release(owner),true);
});
