import test from 'node:test';
import assert from 'node:assert/strict';
import {JobLedger} from './ledger.mjs';
import {createDurableBrowserDispatch} from './browser-dispatch.mjs';
function fixture({allow=true,fail=false}={}) {
  const ledger=new JobLedger(':memory:');
  ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
  const lease=ledger.claim('job','worker',30000),requests=[],approvals=[];
  const dispatch=createDurableBrowserDispatch({ledger,authorize:async args=>{approvals.push(args.call.id);return allow;},
    resolveClient:job=>{assert.equal(job.worker,'worker');return{browser:async args=>{requests.push(args);if(fail)throw Error('lost reply');return{content:[{type:'text',text:'synthetic page'}]};}};}});
  return{ledger,lease,requests,approvals,dispatch};
}
const call={id:'click-one',tool:'browser.agent_browser_click',arguments:{ref:'e1'}};
const execute=(f,request=call,lease=f.lease)=>f.dispatch.execute({lease,call:request,signal:AbortSignal.timeout(2000)});
test('approved browser invocation uses its pinned lease and replays without another click',async()=>{
  const f=fixture();try{
    assert.equal((await execute(f)).replay,false);assert.equal((await execute(f)).replay,true);
    assert.equal(f.requests.length,1);assert.equal(f.approvals.length,1);
    assert.deepEqual(f.requests[0].lease,f.lease);
    assert.deepEqual(f.requests[0].operation,{id:'click-one',method:'tools/call',params:{name:'agent_browser_click',arguments:{ref:'e1'}}});
    await assert.rejects(execute(f,{...call,arguments:{ref:'e2'}}),/Conflicting/);
  }finally{f.ledger.close();}
});
test('denied browser actions and foreign leases never reach the service',async()=>{
  const f=fixture({allow:false});try{
    assert.equal((await execute(f)).result.ok,false);assert.equal((await execute(f)).replay,true);
    await assert.rejects(execute(f,call,{...f.lease,worker:'foreign'}),/foreign lease/);
    assert.equal(f.requests.length,0);
  }finally{f.ledger.close();}
});
test('a lost browser reply holds the job and forbids retry under a new ID',async()=>{
  const f=fixture({fail:true});try{
    await assert.rejects(execute(f),/reconciliation/);
    await assert.rejects(execute(f,{...call,id:'click-two'}),/cancelled/);
    assert.equal(f.requests.length,1);assert.equal(f.ledger.get('job').state,'cancelling');
    assert.equal(f.ledger.db.prepare('SELECT state FROM worker_tool_calls').get().state,'uncertain');
  }finally{f.ledger.close();}
});
test('browser catalog operations share the journal and unrelated tools cannot route here',async()=>{
  const f=fixture();try{
    for(const [id,tool,method] of [['init','browser.initialize','initialize'],['list','browser.catalog','tools/list']]){
      await execute(f,{id,tool,arguments:{}});assert.equal(f.requests.at(-1).operation.method,method);
    }
    await assert.rejects(execute(f,{id:'bad',tool:'mail.send',arguments:{}}),/authorization interrupted/);
    assert.equal(f.requests.length,2);
  }finally{f.ledger.close();}
});
