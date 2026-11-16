import test from 'node:test';
import assert from 'node:assert/strict';
import { withWorkerDriver } from './registration.ts';
const host = () => ({
  pools:{ local:{ models:{ default:'synthetic', options:[{ id:'synthetic', label:'Synthetic' }] } } },
  createAdapter:async () => ({ provider:'isolatedWorker', stopAll:async () => {} }),
  health:async () => false,
});
test('disabled worker registration preserves the original driver list', () => {
  const drivers=[{ driverKind:'existing' }];assert.equal(withWorkerDriver(drivers),drivers);
});
test('trusted bootstrap adds one isolated driver and rejects duplicate registration', async () => {
  const bootstrap=host(), drivers=withWorkerDriver([],bootstrap);
  assert.equal(drivers.length,1);assert.equal(drivers[0].driverKind,'isolatedWorker');
  assert.throws(() => withWorkerDriver(drivers,bootstrap),/already registered/);
  const driver=drivers[0];
  assert.throws(() => driver.decodeConfig({ pool:'foreign' }));
  assert.throws(() => driver.decodeConfig({ pool:'local',command:'shell' }));
  await assert.rejects(driver.create({ instanceId:'workers',enabled:true,environment:{ KEY:'override' },config:{ pool:'local' } }),/environment/);
  const instance=await driver.create({ instanceId:'workers',enabled:true,environment:{},config:{ pool:'local' } });
  assert.equal((await instance.snapshot()).state,'unavailable');
});
