import {createProviderBootstrap} from './provider-bootstrap.mjs';

export function createAssignedProviderBootstrap({driver,instance,client,assignment,input}) {
  const valid=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
  if(typeof client?.verifyLease!=='function' || typeof client.close!=='function' || !assignment ||
     Object.keys(assignment).sort().join(',')!=='bot,desktop,project,worker,workspace' || !Object.values(assignment).every(valid))
    throw Error('Trusted fixed worker assignment required');
  const approved=structuredClone(assignment),settings=structuredClone(instance);
  const callbacks={engineAdmission:input?.engineAdmission,approvalModeNow:input?.approvalModeNow};
  const fixed=structuredClone(Object.fromEntries(Object.entries(input??{}).filter(([key])=>!Object.hasOwn(callbacks,key))));
  let consumed=false;
  return async function bootstrap({signal,task}) {
    if(consumed || !signal || !task?.lease)throw Error('Assigned provider bootstrap unavailable');
    consumed=true;signal.throwIfAborted();
    try {
    const job=await client.verifyLease({jobId:task.jobId,lease:task.lease,signal});
    if(job.bot!==approved.bot || job.project!==approved.project || job.worker!==approved.worker || job.resource!==approved.desktop ||
       JSON.stringify(job.resources)!==JSON.stringify([...new Set([approved.desktop,approved.workspace])].sort()))
      throw Error('Foreign assigned provider lease');
    signal.throwIfAborted();
    return await createProviderBootstrap({driver,instance:settings,client,
      binding:{jobId:job.id,worker:job.worker,generation:job.generation,botId:job.bot,threadId:job.thread},
      input:{...fixed,...callbacks,botId:job.bot,threadId:job.thread}})({signal});
    }catch(error){client.close();throw error;}
  };
}
