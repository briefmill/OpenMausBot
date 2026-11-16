import {createWorkerCoordinator} from './coordinator.mjs';
import {createRemoteExecution} from './remote-execution.mjs';

export function createServiceWorkerCoordinator({file,assignments,resolveTurn,pools,clients,admit,health,signal,openTools,onStopped=()=>{}}) {
  if(!Array.isArray(assignments) || typeof admit!=='function' || typeof health!=='function' || typeof onStopped!=='function')
    throw Error('Trusted service worker host required');
  const approved=structuredClone(assignments),catalog=new Map();
  if(new Set(approved.map(row=>row.worker)).size!==approved.length)throw Error('Independent worker services required');
  for(const assignment of approved){
    const client=clients?.[assignment.worker];
    if(!['execute','stop','inspectStopped'].every(key=>typeof client?.[key]==='function'))throw Error('Pinned worker service client required');
    catalog.set(assignment.worker,Object.fromEntries(['execute','stop','inspectStopped'].map(key=>[key,client[key]])));
  }
  const selected=job=>{
    const assignment=approved.find(row=>row.worker===job.worker && row.bot===job.bot && row.project===job.project);
    if(!assignment || job.resource!==assignment.desktop ||
       JSON.stringify(job.resources)!==JSON.stringify([...new Set([assignment.desktop,assignment.workspace])].sort()))
      throw Error('Foreign service worker assignment');
    return catalog.get(assignment.worker);
  };
  const owned=identity=>{
    const job=coordinator.ledger.get(identity.id);
    if(job.worker!==identity.worker || job.generation!==identity.generation)throw Error('Foreign service worker generation');
    return selected(job);
  };
  let relay;
  const coordinator=createWorkerCoordinator({file,assignments:approved,resolveTurn,pools,signal,openTools,host:{
    admit,health,
    launch:async({job,generation})=>{selected(job);return{worker:job.worker,generation};},
    execute:args=>relay(args),
    stop:identity=>owned(identity).stop(identity),
    inspectStopped:async identity=>{
      const stopped=await owned(identity).inspectStopped(identity);
      if(stopped===true)await onStopped(identity);
      return stopped===true;
    },
  }});
  relay=createRemoteExecution({ledger:coordinator.ledger,executeWorker:args=>selected(args.job).execute(args)});
  return coordinator;
}
