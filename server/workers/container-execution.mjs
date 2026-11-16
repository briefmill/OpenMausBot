const keys=['text','recalled','system','systemStable','systemVolatile','recoveryText','transcript','mentionTurn','preloadBrowserTools'];
export function createContainerExecution({run,dockerArgs,supervisor,resolveAgent}) {
  if(typeof run!=='function' || typeof dockerArgs!=='function' || typeof supervisor?.inspect!=='function' ||
     typeof resolveAgent!=='function')throw Error('Trusted container execution host required');
  return async function execute({job,lease,handle,input,signal}) {
    signal.throwIfAborted();
    if(lease.id!==job.id || lease.worker!==job.worker || input.botId!==job.bot || input.threadId!==job.thread || (input.images?.length??0)>0 || input.resumeCursor!==undefined)
      throw Error('Unsupported container turn');
    const identity={id:job.id,worker:lease.worker,generation:lease.generation};
    const owned=await supervisor.inspect(identity);
    if(!owned || owned.containerId!==handle?.containerId || owned.state.Running!==true || owned.state.Restarting!==false)
      throw Error('Worker container ownership unavailable');
    const agent=structuredClone(await resolveAgent({job:structuredClone(job),generation:lease.generation}));
    if(!agent || Object.keys(agent).sort().join(',')!=='bootstrap,cwd,deadlineMs,entry' ||
       !['entry','bootstrap','cwd'].every(key=>typeof agent[key]==='string' && /^\/[a-zA-Z0-9_./-]+$/.test(agent[key]) && !agent[key].split('/').includes('..')) ||
       !Number.isSafeInteger(agent.deadlineMs) || agent.deadlineMs<1 || agent.deadlineMs>300000)
      throw Error('Unapproved container agent');
    const content=Object.fromEntries(keys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
    const task=JSON.stringify({job:{id:job.id,bot:job.bot,thread:job.thread,worker:lease.worker},lease,content});
    if(Buffer.byteLength(task)>4*1024*1024+65536)throw Error('Container task too large');
    signal.throwIfAborted();
    const response=await run(dockerArgs(['exec','--user','1000:1000','--workdir',agent.cwd,'-i',owned.containerId,
      'node',agent.entry,agent.bootstrap,agent.cwd,String(agent.deadlineMs)]),{input:task,timeoutMs:agent.deadlineMs});
    signal.throwIfAborted();
    if(typeof response?.stdout!=='string' || Buffer.byteLength(response.stdout)>8192)throw Error('Container receipt rejected');
    let receipt;
    try{receipt=JSON.parse(response.stdout);}catch{throw Error('Container receipt invalid');}
    if(!receipt || Object.keys(receipt).sort().join(',')!=='generation,jobId,result,worker' ||
       receipt.jobId!==job.id || receipt.worker!==lease.worker || receipt.generation!==lease.generation ||
       !receipt.result || Object.keys(receipt.result).sort().join(',')!=='cancelled,events,ok,stopReason,turnId' ||
       typeof receipt.result.ok!=='boolean' || typeof receipt.result.turnId!=='string' || receipt.result.turnId.length>256 ||
       typeof receipt.result.cancelled!=='boolean' || !Number.isSafeInteger(receipt.result.events) || receipt.result.events<0 ||
       ![null,'provider-stopped'].includes(receipt.result.stopReason))
      throw Error('Foreign container receipt');
    return{lease:structuredClone(lease),result:receipt.result};
  };
}
