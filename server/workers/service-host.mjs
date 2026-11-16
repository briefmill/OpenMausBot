import {lstatSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {createServiceExecution} from './service-execution.mjs';
import {createLinuxServiceSupervisor} from './linux-service-supervisor.mjs';
import {createWorkerProcessClient} from './process-client.mjs';
import {listenExecutionService} from './service-transport.mjs';
import {normalizeWorkerAssignment,workerAssignmentMatches} from './worker-assignment.mjs';

export async function createSupervisedExecutionService({file,worker,assignment,verifyLease,bootstrapFile,cwd,environment,
  isolatedPidNamespace=false,uid=1000,deadlineMs=300000,transport}) {
  if(!isAbsolute(file??'') || typeof verifyLease!=='function')throw Error('Trusted service authority required');
  const parent=lstatSync(dirname(file));
  if(!parent.isDirectory() || parent.isSymbolicLink() || parent.uid!==0 || (parent.mode&0o077)!==0)
    throw Error('Root-only supervisor journal directory required');
  try{const existing=lstatSync(file);if(!existing.isFile() || existing.isSymbolicLink() || existing.uid!==0)throw Error('Foreign supervisor journal');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const policy=normalizeWorkerAssignment(assignment);
  const supervisor=createLinuxServiceSupervisor({worker,uid,isolatedPidNamespace});
  const client=createWorkerProcessClient({bootstrapFile,cwd,environment,deadlineMs,command:supervisor.command,onProcess:()=>{}});
  const journal=createServiceExecution({file,worker,
    execute:async({identity,task,signal})=>{
      await supervisor.prepare(identity);
      return client({job:task.job,lease:task.lease,input:{...task.content,botId:task.job.bot,threadId:task.job.thread},signal});
    },stop:supervisor.stop,inspectStopped:supervisor.inspectStopped});
  const service={state:journal.state,cancelUnseen:journal.cancelUnseen,async run(request){
    const previous=journal.state(request.identity);
    try{return await journal.run(request);}
    finally{
      if(previous===null && ['completed','failed','cancelled'].includes(journal.state(request.identity)))await supervisor.release(request.identity);
    }
  }};
  let listener;
  try{
    listener=await listenExecutionService({...transport,worker,assignment,service,deadlineMs,
      authorize:async({job,lease,signal})=>{
        const current=await verifyLease({jobId:job.id,lease,signal});
        return current?.state==='running' && current.id===job.id && current.worker===worker && current.generation===lease.generation &&
          current.thread===job.thread && workerAssignmentMatches(policy,current) &&
          ['bot','project','resource'].every(key=>current[key]===job[key]) && JSON.stringify(current.resources)===JSON.stringify(job.resources);
      }});
  }catch(error){journal.close();throw error;}
  return{origin:listener.origin,async close(){await listener.close();journal.close();}};
}
