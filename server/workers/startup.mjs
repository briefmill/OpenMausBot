import {readFileSync,mkdirSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {createContainerWorkerCoordinator} from './container-host.mjs';
import {createWorkerVolumes} from './worker-volumes.mjs';
import {listenTransport} from './transport.mjs';
import {createHostAdmission} from './host-admission.mjs';

const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const read=(file,limit=65536)=>{
  if(typeof file!=='string' || !isAbsolute(file))throw Error('Absolute host configuration path required');
  const bytes=readFileSync(file);if(bytes.length>limit)throw Error('Host configuration file too large');return bytes.toString('utf8');
};

// The operator selects this file through the server environment. Bot configs
// cannot select host images, Docker routes, credentials or admission limits.
export async function loadConfiguredWorkerStartup({configFile,dataDir,resolveTurn,run,route}) {
  if(!configFile)return null;
  const config=JSON.parse(read(configFile,262144));
  if(!exact(config,['version','namespace','dockerSshAlias','maxRunning','assignments','pools','policies','storageImage','transport']) ||
     config.version!==1 || !Number.isSafeInteger(config.maxRunning) || config.maxRunning<1 || config.maxRunning>64 ||
     !Array.isArray(config.assignments) || !config.assignments.length || config.assignments.length>64 ||
     typeof config.dockerSshAlias!=='string' || typeof run!=='function' || typeof route!=='function' || typeof resolveTurn!=='function')
    throw Error('Invalid operator worker configuration');
  const transportConfig=config.transport;
  if(!exact(transportConfig,['listenHost','advertisedHost','port','controllerTokenFile','workerTokenFiles','tls']) ||
     !Number.isSafeInteger(transportConfig.port) || transportConfig.port<1 || transportConfig.port>65535 ||
     !exact(transportConfig.tls,['keyFile','certFile','caFile','controllerPin','workerPins']) ||
     !transportConfig.workerTokenFiles || typeof transportConfig.workerTokenFiles!=='object')throw Error('Explicit worker TLS configuration required');
  const ids=config.assignments.map(row=>row.worker);
  if(new Set(ids).size!==ids.length || Object.keys(transportConfig.workerTokenFiles).sort().join(',')!==[...ids].sort().join(','))
    throw Error('Worker credentials do not match assignments');
  const dockerArgs=args=>route(config.dockerSshAlias,args);dockerArgs(['info']);
  const workers=config.assignments.map(row=>({id:row.worker,capacity:1,token:read(transportConfig.workerTokenFiles[row.worker]).trim(),
    assignments:[{scope:'bot',bot:row.bot,project:row.project,resource:row.desktop,resources:[row.workspace]}]}));
  const tls={key:read(transportConfig.tls.keyFile),cert:read(transportConfig.tls.certFile),ca:read(transportConfig.tls.caFile),
    controllerPin:transportConfig.tls.controllerPin,workerPins:transportConfig.tls.workerPins};
  const controllerToken=read(transportConfig.controllerTokenFile).trim();
  const control=new AbortController(),storage=createWorkerVolumes({run,dockerArgs,namespace:config.namespace,initImage:config.storageImage});
  const directory=join(dataDir,'workers');mkdirSync(directory,{recursive:true});
  let c,transport,closing;
  const admission=createHostAdmission({limit:config.maxRunning,signal:control.signal,isCurrent:job=>{
    const current=c.ledger.get(job.id);return current.state==='running' && current.generation===job.generation && current.worker===job.worker;
  }});
  const close=()=>closing??=(async()=>{
    control.abort();await c?.drain();await transport?.close();
    try{c?.close();}catch{c?.ledger.close();}
  })();
  try {
    c=createContainerWorkerCoordinator({file:join(directory,'jobs.db'),assignments:config.assignments,resolveTurn,pools:config.pools,
      policies:config.policies,run,dockerArgs,namespace:config.namespace,storage,signal:control.signal,
      admit:admission.acquire,onStopped:admission.release,
      health:async()=>{
        if(control.signal.aborted)return false;
        try{await run(dockerArgs(['info','--format','{{.ServerVersion}}']),{timeoutMs:5000});return true;}catch{return false;}
      }});
    if(c.ledger.db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('running','cancelling','uncertain')").get().n)
      throw Error('Worker startup requires reconciliation of prior leases');
    transport=await listenTransport({ledger:c.ledger,controllerToken,workers,tls,
      listenHost:transportConfig.listenHost,advertisedHost:transportConfig.advertisedHost,port:transportConfig.port});
    return{bootstrap:c.bootstrap,close};
  }catch(error){await close();throw error;}
}
