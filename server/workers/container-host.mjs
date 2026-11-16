import {createWorkerCoordinator} from './coordinator.mjs';
import {createContainerSupervisor} from './container-supervisor.mjs';
import {createContainerLauncher} from './container-launcher.mjs';
import {createContainerExecution} from './container-execution.mjs';
import {createRemoteExecution} from './remote-execution.mjs';

export function createContainerWorkerCoordinator({file,assignments,resolveTurn,pools,policies,run,dockerArgs,
  namespace,storage,admit,health,signal,onStopped=()=>{}}) {
  if(typeof admit!=='function' || typeof health!=='function' || typeof storage?.ensure!=='function' ||
     typeof storage.verify!=='function' || !Array.isArray(assignments))throw Error('Complete trusted container host required');
  const approved=structuredClone(assignments),catalog=structuredClone(policies);
  if(new Set(approved.map(row=>row.worker)).size!==approved.length ||
     approved.some(row=>!Object.hasOwn(catalog??{},row.worker)))throw Error('Independent worker policies required');
  const selected=job=>{
    const assignment=approved.find(row=>row.bot===job.bot && row.worker===job.worker && row.project===job.project);
    if(!assignment || !job.resources.includes(assignment.workspace) || job.resource!==assignment.desktop)
      throw Error('Foreign container host assignment');
    return{assignment,policy:catalog[assignment.worker]};
  };
  const supervisor=createContainerSupervisor({run,dockerArgs,namespace});
  const launch=createContainerLauncher({run,dockerArgs,supervisor,storage,resolvePlan:async({job})=>{
    const {assignment,policy}=selected(job);
    const volume=await storage.ensure({bot:job.bot,project:job.project,workspace:assignment.workspace});
    return{...structuredClone(policy.container),workspace:{name:volume.name,resource:assignment.workspace}};
  }});
  const executeWorker=createContainerExecution({run,dockerArgs,supervisor,resolveAgent:async({job})=>structuredClone(selected(job).policy.agent)});
  let relay;
  const coordinator=createWorkerCoordinator({file,assignments:approved,resolveTurn,pools,signal,host:{
    admit,health,launch,execute:args=>relay(args),stop:supervisor.stop,inspectStopped:async identity=>{
      const stopped=await supervisor.inspectStopped(identity);
      if(stopped)await onStopped(identity);
      return stopped;
    },
  }});
  relay=createRemoteExecution({ledger:coordinator.ledger,executeWorker});
  return{...coordinator,supervisor};
}
