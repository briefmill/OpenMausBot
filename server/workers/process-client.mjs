import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const contentKeys=['text','recalled','system','systemStable','systemVolatile','recoveryText','transcript','mentionTurn','preloadBrowserTools'];
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');

// Trusted host configuration selects the bootstrap, environment and working
// folder. Killing this child does not attest that its descendants stopped.
export function createWorkerProcessClient({bootstrapFile,cwd,environment,deadlineMs=300000,onProcess}) {
  if(!isAbsolute(bootstrapFile??'') || !isAbsolute(cwd??'') || !environment || typeof environment!=='object' ||
     Array.isArray(environment) || Object.values(environment).some(value=>typeof value!=='string') ||
     !Number.isSafeInteger(deadlineMs) || deadlineMs<1 || deadlineMs>300000 || typeof onProcess!=='function')
    throw Error('Trusted worker launch configuration required');
  const env={...environment};
  return async function execute({job,lease,input,signal}) {
    if(!signal || !exact(lease,['id','worker','generation','token','deadline']) || lease.id!==job.id ||
       input.botId!==job.bot || input.threadId!==job.thread ||
       (input.images?.length ?? 0)>0 || input.resumeCursor!==undefined)
      throw Error('Unsupported or foreign process turn');
    signal.throwIfAborted();
    const task={jobId:job.id,lease:structuredClone(lease),content:Object.fromEntries(
      contentKeys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))};
    const bytes=Buffer.from(JSON.stringify(task));
    if(bytes.length>4*1024*1024+65536)throw Error('Worker task too large');
    return new Promise((resolve,reject)=>{
      let child,settled=false,timer,size=0;const chunks=[];
      const finish=(error,value)=>{
        if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
        if(error){child?.kill();reject(error);}else resolve(value);
      };
      const abort=()=>finish(Error('Worker process interrupted; host stop verification required'));
      try {
        child=spawn(process.execPath,[fileURLToPath(new URL('./worker-process.mjs',import.meta.url)),bootstrapFile,String(deadlineMs)],{
          cwd,env:{...env},windowsHide:true,shell:false,stdio:['pipe','ignore','ignore','pipe']});
        child.once('error',()=>finish(Error('Worker process launch failed')));
        child.stdin.on('error',()=>finish(Error('Worker task delivery failed')));
        child.stdio[3].on('error',()=>finish(Error('Worker receipt pipe failed')));
        child.stdio[3].on('data',chunk=>{
          size+=chunk.length;
          if(size>8192)finish(Error('Worker receipt too large'));else chunks.push(chunk);
        });
        child.once('close',code=>{
          if(settled)return;
          try {
            if(code!==0)throw Error('Worker process failed');
            const receipt=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if(!exact(receipt,['jobId','worker','generation','result']) || receipt.jobId!==job.id ||
               receipt.worker!==lease.worker || receipt.generation!==lease.generation ||
               !exact(receipt.result,['turnId','ok','cancelled','events','stopReason']) ||
               typeof receipt.result.turnId!=='string' || receipt.result.turnId.length>256 ||
               typeof receipt.result.ok!=='boolean' || typeof receipt.result.cancelled!=='boolean' ||
               !Number.isSafeInteger(receipt.result.events) || receipt.result.events<0 ||
               ![null,'provider-stopped'].includes(receipt.result.stopReason))throw Error('Worker receipt mismatch');
            finish(null,{lease:structuredClone(lease),result:receipt.result});
          }catch{finish(Error('Worker process receipt rejected; reconciliation required'));}
        });
        signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(abort,deadlineMs);
        onProcess({id:job.id,worker:lease.worker,generation:lease.generation,child});
        if(signal.aborted)abort();
        else child.stdin.end(bytes);
      }catch{finish(Error('Worker process startup rejected'));}
    });
  };
}
