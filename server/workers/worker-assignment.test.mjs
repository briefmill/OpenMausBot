import test from 'node:test';
import assert from 'node:assert/strict';
import {JobLedger} from './ledger.mjs';
import {listenTransport} from './transport.mjs';
import {normalizeWorkerAssignment} from './worker-assignment.mjs';

const assignment={scope:'bot',bot:'bot',project:'project',resource:'desktop',resources:['workspace']};
test('bot-scoped worker can use new threads only after controller admission into its fixed resource bundle',async()=>{
  const ledger=new JobLedger(':memory:'),token='w'.repeat(40);let transport;
  try {
    transport=await listenTransport({ledger,controllerToken:'c'.repeat(40),workers:[{id:'worker',token,capacity:1,assignments:[assignment]}]});
    const request=(id,action='')=>fetch(transport.origin+'/v1/jobs/'+id+action,{method:action?'POST':'GET',
      headers:{authorization:'Bearer '+token,...(action?{'content-type':'application/json'}:{})},...(action?{body:'{}'}:{})});
    for(const [index,thread] of ['first-thread','later-scheduled-thread'].entries()) {
      const id='job-'+index;ledger.enqueue({id,bot:'bot',thread,project:'project',resource:'desktop',resources:['workspace']});
      assert.equal((await request(id)).status,403);assert.equal((await request(id,'/claim')).status,403);
      const lease=ledger.claim(id,'worker',30000);assert.equal((await request(id)).status,200);
      ledger.finish(lease,'completed',ledger.putArtifact(lease,Buffer.from('No provider launched in transport fixture')));
    }
    for(const [index,change] of [{bot:'foreign'},{project:'foreign'},{resources:['foreign-workspace']}].entries()) {
      const id='foreign-'+index;ledger.enqueue({id,bot:'bot',thread:'third',project:'project',resource:'desktop',resources:['workspace'],...change});
      const lease=ledger.claim(id,'worker',30000);assert.equal((await request(id)).status,403);
      ledger.finish(lease,'failed',ledger.putArtifact(lease,Buffer.from('No provider launched')));
    }
  }finally{await transport?.close();ledger.close();}
});

test('changing exact-thread registration to bot scope requires explicit reconciliation',()=>{
  const ledger=new JobLedger(':memory:');
  try {
    const worker={id:'worker',capacity:1,credentialHash:'a'.repeat(64),assignments:[{bot:'bot',thread:'thread',project:'project',resource:'desktop',resources:['workspace']}]};
    ledger.registerWorkers([worker]);
    assert.throws(()=>ledger.registerWorkers([{...worker,assignments:[assignment]}]),/reconciliation/);
    assert.throws(()=>normalizeWorkerAssignment({bot:'bot',project:'project',resource:'desktop'}),/Invalid/);
    assert.throws(()=>normalizeWorkerAssignment({...assignment,thread:'*'}),/Invalid/);
  }finally{ledger.close();}
});
