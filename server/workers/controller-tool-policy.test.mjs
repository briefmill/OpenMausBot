import test from 'node:test';
import assert from 'node:assert/strict';
import {bindControllerToolPolicy} from './controller-tool-policy.mjs';
const identity={id:'job',bot:'bot',thread:'thread',project:'project',generation:1};
const call={id:'call',tool:'mail_read',arguments:{query:'synthetic'}};
function fixture(overrides={}) {
  const calls=[],control=new AbortController();
  const input={job:identity,call,signal:control.signal};
  const options={identity,signal:control.signal,isCurrent:()=>true,mode:()=> 'ask',preview:()=> 'redacted input',
    session:{validate:()=>{},view:()=>({title:'mail read',input:{},ask:true,grant:'exact-tool'}),
      execute:async(tool,args)=>{calls.push({tool,args});return{ok:true,text:'scoped result'};}},
    approval:{floored:()=>null,ask:async()=>true},...overrides};
  return{policy:bindControllerToolPolicy(options),input,calls,control,options};
}
test('scoped policy requires matching one-shot authorization before dispatch',async()=>{
  const {policy,input,calls}=fixture();
  await assert.rejects(policy.dispatch(input),/authorization/);
  assert.equal(await policy.authorize(input),true);
  await assert.rejects(policy.dispatch({...input,call:{...call,arguments:{query:'changed'}}}),/authorization/);
  assert.equal((await policy.dispatch(input)).text,'scoped result');
  await assert.rejects(policy.dispatch(input),/authorization/);assert.equal(calls.length,1);
});
test('saved-grant and full-mode calls pass through the existing safety floor',async()=>{
  for(const mode of ['ask','full']) {
    let asks=0,floors=0;
    const {policy,input,calls}=fixture({mode:()=>mode,approval:{floored:args=>{floors++;assert.equal(args.full,mode==='full');return{reason:'send needs approval'};},
      ask:async()=>{asks++;return true;}}});
    assert.equal(await policy.authorize(input),false);
    await assert.rejects(policy.dispatch(input),/authorization/);
    assert.equal(floors,1);assert.equal(asks,0);assert.equal(calls.length,0);
  }
});
test('asks retain canonical grants and redacted summaries; denial cannot dispatch',async()=>{
  let seen;
  const {policy,input}=fixture({approval:{floored:()=>null,ask:async(...args)=>{seen=args;return false;}}});
  assert.equal(await policy.authorize(input),false);
  assert.deepEqual(seen,['mail read','redacted input','exact-tool']);
  await assert.rejects(policy.dispatch(input),/authorization/);
});
test('foreign bot, project, generation and cancelled calls cannot use a mounted account',async()=>{
  const {policy,input,control,calls}=fixture();
  for(const key of ['id','bot','thread','project','generation'])
    await assert.rejects(policy.authorize({...input,job:{...identity,[key]:'foreign'}}),/assignment/);
  assert.equal(await policy.authorize(input),true);control.abort();
  await assert.rejects(policy.dispatch(input));assert.equal(calls.length,0);
});
test('assignment changes while approval is pending invalidate the authorization',async()=>{
  let active=true;
  const {policy,input}=fixture({isCurrent:()=>active,approval:{floored:()=>null,ask:async()=>{active=false;return true;}}});
  await assert.rejects(policy.authorize(input),/assignment/);
  await assert.rejects(policy.dispatch(input),/assignment/);
});


test('real approval gate and durable executor require one decision and reuse the saved result',async()=>{
  const {createChatToolApproval}=await import('../drivers/chat-tool-approval.ts');
  const {createDurableToolExecutor}=await import('./tool-executor.mjs');
  const {JobLedger}=await import('./ledger.mjs');
  const ledger=new JobLedger(':memory:'),control=new AbortController();
  ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
  const lease=ledger.claim('job','worker',30000),job=ledger.get('job');
  let cards=0,dispatches=0,resolutions=0;
  const approval=createChatToolApproval({signal:control.signal,
    open:ask=>{cards++;assert.equal(approval.answer(ask.id,'allow'),'allowed-once');},
    resolved:()=>{resolutions++;},openQuestion:()=>{},resolvedQuestion:()=>{}});
  const policy=bindControllerToolPolicy({identity,signal:control.signal,isCurrent:()=>true,mode:()=> 'ask',preview:()=> 'synthetic read',approval,
    session:{validate:()=>{},view:()=>({title:'read',input:{},ask:true}),
      execute:async()=>{dispatches++;return{ok:true,text:'account-scoped synthetic report'};}}});
  const runner=createDurableToolExecutor({ledger,...policy});
  try{
    const request={lease,call,signal:control.signal};
    assert.equal(job.generation,1);
    assert.equal((await runner.execute(request)).replay,false);
    assert.equal((await runner.execute(request)).replay,true);
    assert.equal(cards,1);assert.equal(resolutions,1);assert.equal(dispatches,1);
  }finally{approval.close();ledger.close();}
});
