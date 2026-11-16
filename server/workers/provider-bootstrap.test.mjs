import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderBootstrap } from './provider-bootstrap.mjs';

test('provider bootstrap uses the existing driver contract and disposes one scoped instance',async()=>{
  let created,disposals=0,closed=0,received;
  const adapter={provider:'synthetic'};
  const driver={driverKind:'synthetic',decodeConfig:raw=>({...raw,decoded:true}),create:async args=>{
    created=args;return{instanceId:args.instanceId,driverKind:'synthetic',adapter,dispose:async()=>{disposals++;}};
  }};
  const instance={instanceId:'provider',displayName:'Worker',enabled:true,config:{model:'approved'},environment:{HOME:process.cwd()}};
  const client={run:async args=>{received=args;return{result:{ok:true}};},close:()=>{closed++;}};
  const binding={jobId:'job',worker:'worker',generation:1,botId:'bot',threadId:'thread'};
  const input={botId:'bot',threadId:'thread',cwd:process.cwd(),approvalMode:'ask',mcpFromUserConfig:false,
    toolScope:{allow:['read']},engineAdmission:async()=>{},approvalModeNow:()=> 'ask'};
  const bootstrap=createProviderBootstrap({driver,instance,client,binding,input});
  instance.config.model='foreign';input.toolScope.allow.push('send');
  const signal=AbortSignal.timeout(1000),host=await bootstrap({signal});
  assert.deepEqual(created.config,{model:'approved',decoded:true});
  await host.runtime.run({jobId:'job',lease:{id:'job',worker:'worker',generation:1,token:'a'.repeat(64),deadline:Date.now()+10000},content:{text:'Task'}},signal);
  assert.equal(received.adapter,adapter);assert.deepEqual(received.input.toolScope,{allow:['read']});
  await Promise.all([host.close(),host.close()]);assert.equal(disposals,1);assert.equal(closed,1);
  await assert.rejects(bootstrap({signal}),/consumed/);
});

test('provider bootstrap disposes an instance with a foreign adapter identity',async()=>{
  let disposals=0,closed=0;
  const bootstrap=createProviderBootstrap({
    driver:{driverKind:'synthetic',decodeConfig:v=>v,create:async()=>({instanceId:'provider',driverKind:'synthetic',
      adapter:{provider:'foreign'},dispose:async()=>{disposals++;}})},
    instance:{instanceId:'provider',enabled:true,environment:{},config:{}},client:{run:async()=>{},close:()=>{closed++;}},
    binding:{jobId:'job',worker:'worker',generation:1,botId:'bot',threadId:'thread'},
    input:{botId:'bot',threadId:'thread',cwd:process.cwd(),approvalMode:'ask',mcpFromUserConfig:false,toolScope:{},
      engineAdmission:async()=>{},approvalModeNow:()=> 'ask'}});
  await assert.rejects(bootstrap({signal:AbortSignal.timeout(1000)}),/identity mismatch/);
  assert.equal(disposals,1);assert.equal(closed,1);
});
