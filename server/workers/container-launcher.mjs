import {createHash} from 'node:crypto';

// Host policy supplies the immutable image, executable and network. No Docker
// arguments, mounts, credentials or privilege switches come from a job body.
export function createContainerLauncher({run,dockerArgs,supervisor,resolvePlan}) {
  if(typeof run!=='function' || typeof dockerArgs!=='function' || typeof supervisor?.labels!=='function' ||
     typeof resolvePlan!=='function')throw Error('Trusted container launch policy required');
  return async function launch({job,generation,pool,signal}) {
    signal.throwIfAborted();
    const identity={id:job.id,worker:job.worker,generation},labels=supervisor.labels(identity);
    const plan=structuredClone(await resolvePlan({job:structuredClone(job),generation,pool}));
    if(!plan || Object.keys(plan).sort().join(',')!=='command,cpus,image,memoryBytes,network,pids,shmBytes' ||
       !/^sha256:[a-f0-9]{64}$/.test(plan.image) || typeof plan.cpus!=='number' || !Number.isFinite(plan.cpus) || plan.cpus<0.1 || plan.cpus>64 ||
       !Number.isSafeInteger(plan.memoryBytes) || plan.memoryBytes<64*1024*1024 || plan.memoryBytes>256*1024**3 ||
       !Number.isSafeInteger(plan.pids) || plan.pids<16 || plan.pids>4096 ||
       !Number.isSafeInteger(plan.shmBytes) || plan.shmBytes<1024*1024 || plan.shmBytes>plan.memoryBytes ||
       typeof plan.network!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(plan.network) ||
       ['host','bridge','default'].includes(plan.network) ||
       !Array.isArray(plan.command) || plan.command.length<1 || plan.command.length>64 ||
       plan.command.some(value=>typeof value!=='string' || value.length>4096 || value.includes('\0')))
      throw Error('Unapproved worker container plan');
    const name='omb-worker-'+createHash('sha256').update(JSON.stringify(labels)).digest('hex').slice(0,32);
    signal.throwIfAborted();
    const args=['run','-d','--name',name,'--pull','never','--user','1000:1000','--network',plan.network,
      '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--restart','no','--entrypoint','/usr/bin/tini',
      '--cpus',String(plan.cpus),'--memory',String(plan.memoryBytes),'--memory-swap',String(plan.memoryBytes),
      '--pids-limit',String(plan.pids),'--shm-size',String(plan.shmBytes),
      '--tmpfs','/tmp:rw,exec,nosuid,nodev,size=268435456,uid=1000,gid=1000,mode=0700',
      '--tmpfs','/workspace:rw,nosuid,nodev,size=134217728,uid=1000,gid=1000,mode=0700',
      ...Object.entries(labels).flatMap(([key,value])=>['--label',key+'='+value]),plan.image,'--',...plan.command];
    const result=await run(dockerArgs(args),{timeoutMs:10000});
    const containerId=result?.stdout?.trim();
    if(!/^[a-f0-9]{64}$/.test(containerId??''))throw Error('Worker container launch uncertain');
    return{containerId,name};
  };
}
