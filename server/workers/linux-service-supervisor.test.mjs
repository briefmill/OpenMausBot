import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinuxServiceSupervisor} from './linux-service-supervisor.mjs';

test('service supervisor refuses implicit namespace scope and unsupported hosts',()=>{
  assert.throws(()=>createLinuxServiceSupervisor({worker:'worker'}),/Dedicated root Linux/);
  if(process.platform!=='linux' || process.getuid?.()!==0)
    assert.throws(()=>createLinuxServiceSupervisor({worker:'worker',isolatedPidNamespace:true}),/Dedicated root Linux/);
});
