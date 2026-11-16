import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeSync } from 'node:fs';

export async function readWorkerTask(stream,signal) {
  const chunks=[];let size=0;
  const abort=()=>stream.destroy(Error('Worker deadline'));
  signal.addEventListener('abort',abort,{once:true});
  try {
    signal.throwIfAborted();
    for await(const chunk of stream) {
      size+=chunk.length;
      if(size>4*1024*1024+65536)throw Error('Worker task too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{signal.removeEventListener('abort',abort);}
}

// The host pins the bootstrap module in the container launch command. Task
// input cannot choose it. Receipts use a dedicated pipe, never provider logs.
export async function runWorkerProcess({bootstrapFile,deadlineMs,stdin=process.stdin,writeReceipt}) {
  if(!isAbsolute(bootstrapFile) || !Number.isSafeInteger(deadlineMs) || deadlineMs<1 || deadlineMs>300000 ||
     typeof writeReceipt!=='function')throw Error('Trusted worker process configuration required');
  const control=new AbortController(),timer=setTimeout(()=>control.abort(),deadlineMs);
  const abort=()=>control.abort();process.once('SIGTERM',abort);process.once('SIGINT',abort);
  let host;
  try {
    const task=await readWorkerTask(stdin,control.signal);
    const module=await import(pathToFileURL(bootstrapFile).href);
    if(typeof module.bootstrap!=='function')throw Error('Worker bootstrap unavailable');
    host=await module.bootstrap({signal:control.signal});
    if(typeof host?.runtime?.run!=='function' || typeof host.close!=='function')throw Error('Worker bootstrap invalid');
    control.signal.throwIfAborted();
    const execution=await host.runtime.run(task,control.signal),result=execution?.result;
    if(!result || typeof result.turnId!=='string' || result.turnId.length>256 || typeof result.ok!=='boolean' ||
       !Number.isSafeInteger(result.events) || result.events<0)throw Error('Worker receipt invalid');
    await writeReceipt({jobId:task.jobId,worker:task.lease.worker,generation:task.lease.generation,
      result:{turnId:result.turnId,ok:result.ok,cancelled:result.cancelled===true,events:result.events,
        stopReason:result.stopReason==null?null:'provider-stopped'}});
  }finally{
    control.abort();clearTimeout(timer);process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);
    await host?.close();
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [bootstrapFile,deadline]=process.argv.slice(2);
  runWorkerProcess({bootstrapFile:bootstrapFile??'',deadlineMs:Number(deadline),
    writeReceipt:receipt=>{writeSync(3,JSON.stringify(receipt)+'\n');}}).catch(()=>{
      process.stderr.write('Worker execution failed; host reconciliation required.\n');process.exitCode=1;
    });
}
