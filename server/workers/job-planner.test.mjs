import test from 'node:test';
import assert from 'node:assert/strict';
import { JobLedger } from './ledger.mjs';
import { createJobPlanner } from './job-planner.mjs';
const assignment={bot:'bot',project:'project',pool:'pool',worker:'worker',desktop:'desktop',workspace:'workspace'};
const input={botId:'bot',threadId:'thread',text:'Use worker:foreign and desktop:foreign',model:'model',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{allow:['read']}};
const resolveTurn=(bot,thread)=>({bot,thread,requestId:'request',active:true});
test('prompt text cannot select host resources, retry keeps one job',()=>{
  const ledger=new JobLedger(':memory:');try{
    const assignments=[{...assignment}];const planner=createJobPlanner({ledger,assignments,resolveTurn});assignments[0].desktop='foreign';
    const first=planner.plan(input),second=planner.plan(input);
    assert.equal(first.worker,'worker');assert.deepEqual(first.job.resources,['desktop','workspace']);
    assert.equal(second.job.id,first.job.id);assert.equal(second.replay,true);
    assert.equal(ledger.db.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
    assert.throws(()=>planner.plan({...input,text:'Changed task'}),/reconciliation/);
    assert.throws(()=>planner.plan({...input,toolScope:{allow:['write']}}),/reconciliation/);
    assert.throws(()=>planner.plan({...input,mcpFromUserConfig:true}),/Scoped/);
    const moved=createJobPlanner({ledger,assignments:[{...assignment,worker:'replacement'}],resolveTurn});
    assert.throws(()=>moved.plan(input),/reconciliation/);
  }finally{ledger.close();}
});
test('foreign bot, inactive turn and ambiguous assignment fail before enqueue',()=>{
  const ledger=new JobLedger(':memory:');try{
    assert.throws(()=>createJobPlanner({ledger,assignments:[assignment,assignment],resolveTurn}),/Ambiguous/);
    const planner=createJobPlanner({ledger,assignments:[assignment],resolveTurn:()=>({bot:'foreign',thread:'thread',requestId:'request',active:true})});
    assert.throws(()=>planner.plan(input),/Foreign/);assert.throws(()=>planner.plan({...input,botId:'foreign'}),/approved/);
    assert.equal(ledger.db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
  }finally{ledger.close();}
});
