import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorkerProcessClient} from './process-client.mjs';
import {readWorkerTask} from './worker-process.mjs';

const contentKeys=new Set(['text','recalled','system','systemStable','systemVolatile','recoveryText','transcript','mentionTurn','preloadBrowserTools']);
export async function runContainerAgent({bootstrapFile,cwd,deadlineMs,stdin=process.stdin,writeReceipt}) {
  if(!isAbsolute(bootstrapFile??'') || !isAbsolute(cwd??'') || !Number.isSafeInteger(deadlineMs) ||
     deadlineMs<1 || deadlineMs>300000 || typeof writeReceipt!=='function')throw Error('Trusted worker agent required');
  const signal=AbortSignal.timeout(deadlineMs),task=await readWorkerTask(stdin,signal);
  if(!task || Object.keys(task).sort().join(',')!=='content,job,lease' || !task.job ||
     Object.keys(task.job).sort().join(',')!=='bot,id,thread,worker' || !task.content ||
     Object.keys(task.content).some(key=>!contentKeys.has(key)) || typeof task.content.text!=='string')
    throw Error('Invalid container task');
  const execute=createWorkerProcessClient({bootstrapFile,cwd,deadlineMs,environment:{...process.env},onProcess:()=>{}});
  const result=await execute({job:task.job,lease:task.lease,input:{...task.content,botId:task.job.bot,threadId:task.job.thread},signal});
  await writeReceipt({jobId:task.job.id,worker:task.lease.worker,generation:task.lease.generation,result:result.result});
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [bootstrapFile,cwd,deadline]=process.argv.slice(2);
  runContainerAgent({bootstrapFile,cwd,deadlineMs:Number(deadline),writeReceipt:receipt=>{
    process.stdout.write(JSON.stringify(receipt)+'\n');
  }}).catch(()=>{process.stderr.write('Container task failed; host reconciliation required.\n');process.exitCode=1;});
}
