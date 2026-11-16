import test from 'node:test';
import assert from 'node:assert/strict';
import {createContainerWorkerCoordinator} from './container-host.mjs';

test('assembled container host runs independent jobs through persistent mounts and fenced event delivery',async()=>{
  const assignments=['a','b'].map(worker=>({bot:'bot-'+worker,worker,project:'project',pool:'pool',desktop:'desktop-'+worker,workspace:'workspace-'+worker}));
  const container={image:'sha256:'+'a'.repeat(64),cpus:1,memoryBytes:256*1024*1024,pids:128,shmBytes:16*1024*1024,network:'none',command:['node','/opt/worker/agent.mjs']};
  const agent={entry:'/opt/worker/container-agent.mjs',bootstrap:'/opt/worker/bootstrap.mjs',cwd:'/workspace',deadlineMs:2000};
  const policies=Object.fromEntries(assignments.map(row=>[row.worker,{container,agent}]));
  const containers=new Map(),events=[],scopes=[];let c,active=0,peak=0,release,admissions=0;
  const gate=new Promise(resolve=>release=resolve);
  const run=async(args,options)=>{
    if(args[0]==='run') {
      const labels={};for(let i=0;i<args.length;i++)if(args[i]==='--label'){const at=args[i+1].indexOf('=');labels[args[i+1].slice(0,at)]=args[i+1].slice(at+1);}
      const id=(containers.size+1).toString().repeat(64);containers.set(id,{labels,state:{Status:'running',Running:true,Restarting:false,Paused:false}});
      assert.ok(args.includes(container.image));assert.ok(args.includes('--mount'));return{stdout:id};
    }
    if(args[0]==='ps') {
      const filters=args.filter((_,i)=>args[i-1]==='--filter').map(value=>value.slice(6).split('='));
      return{stdout:[...containers].filter(([,v])=>filters.every(([key,value])=>v.labels[key]===value)).map(([id])=>id).join('\n')};
    }
    if(args[0]==='inspect'){const id=args.at(-1),v=containers.get(id);return{stdout:[id,v.labels,v.state].map(JSON.stringify).join('\n')};}
    if(args[0]==='stop'){const v=containers.get(args.at(-1));v.state={Status:'exited',Running:false,Restarting:false,Paused:false};return{stdout:''};}
    assert.equal(args[0],'exec');const task=JSON.parse(options.input);peak=Math.max(peak,++active);if(active===2)release();await gate;
    const turnId='native-'+task.job.worker,lease=task.lease;
    c.ledger.append(lease,1,{type:'worker.execution.claimed',jobId:task.job.id,generation:lease.generation});
    c.ledger.append(lease,2,{type:'item.completed',eventId:'reply',threadId:task.job.thread,turnId,itemType:'assistant_text',text:'Report '+task.job.worker});
    c.ledger.append(lease,3,{type:'turn.completed',eventId:'done',threadId:task.job.thread,turnId,ok:true});active--;
    return{stdout:JSON.stringify({jobId:task.job.id,worker:task.job.worker,generation:lease.generation,
      result:{turnId,ok:true,cancelled:false,events:2,stopReason:null}})};
  };
  c=createContainerWorkerCoordinator({file:':memory:',assignments,policies,run,dockerArgs:a=>a,namespace:'host',
    storage:{ensure:async scope=>{scopes.push(scope);return{name:'omb-workspace-'+'a'.repeat(40)};},verify:async()=>true},
    admit:async()=>{admissions++;},health:async()=>true,signal:AbortSignal.timeout(5000),
    pools:{pool:{models:{default:'synthetic',options:[{id:'synthetic',label:'Synthetic'}]}}},
    resolveTurn:(bot,thread)=>({bot,thread,requestId:'request-'+bot,active:true})});
  try {
    policies.a.container={...container,image:'foreign'};
    const adapter=await c.bootstrap.createAdapter({instanceId:'workers',pool:'pool'});adapter.onEvent(e=>events.push(e));
    await Promise.all(assignments.map(row=>adapter.sendTurn({botId:row.bot,threadId:'thread-'+row.bot,text:'Task',
      approvalMode:'ask',mcpFromUserConfig:false,toolScope:{}})));
    const results=await c.drain();assert.ok(results.every(row=>row.value.outcome==='completed'));
    assert.equal(peak,2);assert.equal(admissions,2);assert.equal(scopes.length,2);
    assert.equal(events.filter(e=>e.type==='turn.completed'&&e.ok).length,2);
    assert.ok([...containers.values()].every(value=>value.state.Running===false));
  }finally{c.close();}
});
