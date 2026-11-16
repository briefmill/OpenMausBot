import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {loadConfiguredWorkerStartup} from './startup.mjs';
import {JobLedger} from './ledger.mjs';

test('worker startup stays inert without an operator configuration',async()=>{
  let calls=0;
  assert.equal(await loadConfiguredWorkerStartup({dataDir:'unused',run:async()=>{calls++;},route:()=>{calls++;}}),null);
  assert.equal(calls,0);
});

test('worker startup refuses unresolved prior leases before listening or running Docker',async()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-worker-startup-'));let calls=0;
  try {
    const data=join(home,'data');mkdirSync(join(data,'workers'),{recursive:true});
    const ledger=new JobLedger(join(data,'workers','jobs.db'));
    ledger.enqueue({id:'held',bot:'bot',thread:'thread',project:'project',resource:'desktop',resources:['workspace']});
    ledger.claim('held','worker',30000);ledger.close();
    const file=(name,value)=>{const path=join(home,name);writeFileSync(path,value);return path;};
    const config={version:1,namespace:'host',dockerSshAlias:'approved',maxRunning:2,storageImage:'sha256:'+'a'.repeat(64),
      assignments:[{bot:'bot',worker:'worker',project:'project',pool:'pool',desktop:'desktop',workspace:'workspace'}],
      pools:{pool:{models:{default:'synthetic',options:[{id:'synthetic',label:'Synthetic'}]}}},policies:{worker:{}},
      transport:{listenHost:'127.0.0.1',advertisedHost:'127.0.0.1',port:12345,
        controllerTokenFile:file('controller.token','c'.repeat(40)),workerTokenFiles:{worker:file('worker.token','w'.repeat(40))},
        tls:{keyFile:file('server.key','fixture'),certFile:file('server.crt','fixture'),caFile:file('ca.crt','fixture'),
          controllerPin:'a'.repeat(64),workerPins:{worker:'b'.repeat(64)}}}};
    const configFile=file('host.json',JSON.stringify(config));
    await assert.rejects(loadConfiguredWorkerStartup({configFile,dataDir:data,resolveTurn:()=>{},route:(_alias,args)=>args,
      run:async()=>{calls++;return{stdout:''};}}),/reconciliation/);
    assert.equal(calls,0);
    const reopened=new JobLedger(join(data,'workers','jobs.db'));assert.equal(reopened.get('held').state,'running');reopened.close();
  }finally{
    assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-worker-startup-'));
    rmSync(home,{recursive:true,force:true});
  }
});
