import {readFileSync,mkdirSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {createServiceWorkerCoordinator} from './service-controller.mjs';
import {createServiceClient} from './service-client.mjs';
import {listenTransport} from './transport.mjs';
import {createHostAdmission} from './host-admission.mjs';

const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const read=file=>{
  if(typeof file!=='string' || !isAbsolute(file))throw Error('Absolute service credential path required');
  const bytes=readFileSync(file);if(bytes.length>65536)throw Error('Service credential file too large');return bytes.toString('utf8');
};

export async function loadConfiguredServiceStartup({config,dataDir,resolveTurn}) {
  if(!exact(config,['version','kind','maxRunning','assignments','pools','services','transport']) || config.version!==2 || config.kind!=='services' ||
     !Number.isSafeInteger(config.maxRunning) || config.maxRunning<1 || config.maxRunning>64 ||
     !Array.isArray(config.assignments) || !config.assignments.length || config.assignments.length>64 || typeof resolveTurn!=='function')
    throw Error('Invalid operator service configuration');
  const ids=config.assignments.map(row=>row.worker),t=config.transport;
  if(new Set(ids).size!==ids.length || !config.services || typeof config.services!=='object' ||
     Object.keys(config.services).sort().join(',')!==[...ids].sort().join(',') ||
     !exact(t,['listenHost','advertisedHost','port','controllerTokenFile','workerTokenFiles','tls']) ||
     !Number.isSafeInteger(t.port) || t.port<1 || t.port>65535 ||
     !exact(t.tls,['keyFile','certFile','caFile','controllerPin','workerPins']) || !t.workerTokenFiles ||
     Object.keys(t.workerTokenFiles).sort().join(',')!==[...ids].sort().join(','))throw Error('Explicit service assignments and TLS required');
  const workers=config.assignments.map(row=>({id:row.worker,capacity:1,token:read(t.workerTokenFiles[row.worker]).trim(),
    assignments:[{scope:'bot',bot:row.bot,project:row.project,resource:row.desktop,resources:[row.workspace]}]}));
  const tls={key:read(t.tls.keyFile),cert:read(t.tls.certFile),ca:read(t.tls.caFile),controllerPin:t.tls.controllerPin,workerPins:t.tls.workerPins};
  const token=read(t.controllerTokenFile).trim(),control=new AbortController(),clients={};
  const directory=join(dataDir,'workers');mkdirSync(directory,{recursive:true});
  let coordinator,transport,closing;
  const close=()=>closing??=(async()=>{
    control.abort();await coordinator?.drain();
    for(const client of Object.values(clients))client.close();
    await transport?.close();try{coordinator?.close();}catch{coordinator?.ledger.close();}
  })();
  try{
    for(const worker of ids){
      const service=config.services[worker];
      if(!exact(service,['origin','tokenFile','keyFile','certFile','caFile','serverPin']))throw Error('Pinned service endpoint required');
      clients[worker]=createServiceClient({worker,origin:service.origin,token:read(service.tokenFile).trim(),allowRemote:true,
        tls:{key:read(service.keyFile),cert:read(service.certFile),ca:read(service.caFile),serverPin:service.serverPin}});
    }
    const admission=createHostAdmission({limit:config.maxRunning,signal:control.signal,isCurrent:job=>{
      const current=coordinator.ledger.get(job.id);return current.state==='running' && current.generation===job.generation && current.worker===job.worker;
    }});
    coordinator=createServiceWorkerCoordinator({file:join(directory,'jobs.db'),assignments:config.assignments,pools:config.pools,resolveTurn,clients,
      signal:control.signal,admit:admission.acquire,onStopped:admission.release,
      health:async({pool}={})=>{
        if(control.signal.aborted)return false;
        const relevant=config.assignments.filter(row=>pool===undefined || row.pool===pool).map(row=>row.worker);
        const results=await Promise.allSettled(relevant.map(worker=>clients[worker].inspectStopped({id:'startup-readiness',worker,generation:1})));
        return results.some(result=>result.status==='fulfilled');
      }});
    if(coordinator.ledger.db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('running','cancelling','uncertain')").get().n)
      throw Error('Worker startup requires reconciliation of prior leases');
    transport=await listenTransport({ledger:coordinator.ledger,controllerToken:token,workers,tls,
      listenHost:t.listenHost,advertisedHost:t.advertisedHost,port:t.port});
    return{bootstrap:coordinator.bootstrap,close};
  }catch(error){await close();throw error;}
}
