import {openSync,fstatSync,readFileSync,closeSync,constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {workerClient} from './worker-client.mjs';
import {createSupervisedExecutionService} from './service-host.mjs';
import {listenWorkerHealth} from './service-health.mjs';
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function read(file,{privateFile=false,limit=65536}={}){
  if(typeof file!=='string' || !isAbsolute(file))throw Error('Absolute service configuration path required');
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=fstatSync(fd);
    if(!info.isFile() || info.size>limit || (privateFile && (info.uid!==0 || (info.mode&0o077)!==0)))throw Error('Protected service file required');
    return readFileSync(fd,'utf8');
  }finally{closeSync(fd);}
}
const controllerConnection=value=>{
  if(!exact(value,['origin','tokenFile','keyFile','certFile','caFile','serverPin']))throw Error('Pinned controller configuration required');
  return{origin:value.origin,token:read(value.tokenFile).trim(),allowRemote:true,
    tls:{key:read(value.keyFile),cert:read(value.certFile),ca:read(value.caFile),serverPin:value.serverPin}};
};

export async function startWorkerService({configFile}) {
  if(process.platform!=='linux' || process.getuid?.()!==0)throw Error('Root Linux worker service required');
  const config=JSON.parse(read(configFile,{privateFile:true,limit:262144}));
  if(!exact(config,['version','worker','assignment','file','bootstrapFile','cwd','environment','uid','deadlineMs','isolatedPidNamespace','controller','transport','health']) ||
     config.version!==1 || !exact(config.transport,['listenHost','advertisedHost','port','controllerTokenFile','tls']) ||
     !exact(config.transport.tls,['keyFile','certFile','caFile','controllerPin']) ||
     !exact(config.health,['listenHost','port']) || !Number.isSafeInteger(config.health.port) || config.health.port<1 ||
     config.health.port===config.transport.port || !Number.isSafeInteger(config.transport.port) || config.transport.port<1 ||
     !config.environment || typeof config.environment!=='object' || Array.isArray(config.environment) ||
     Object.keys(config.environment).some(name=>/^RAILWAY_|^(DOCKER_HOST|SSH_AUTH_SOCK|OMB_WORKER_SERVICE_CONFIG|OMB_WORKER_HOST_CONFIG)$/.test(name)))
    throw Error('Operator-owned worker service configuration required');
  const client=workerClient(controllerConnection(config.controller)),t=config.transport,tls=t.tls;
  let service,health,closing;
  const close=()=>closing??=(async()=>{try{await health?.close();}finally{try{await service?.close();}finally{client.close();}}})();
  try{
    service=await createSupervisedExecutionService({...config,verifyLease:client.verifyLease,
      transport:{listenHost:t.listenHost,advertisedHost:t.advertisedHost,port:t.port,
        controllerToken:read(t.controllerTokenFile,{privateFile:true}).trim(),
        tls:{key:read(tls.keyFile,{privateFile:true}),cert:read(tls.certFile),ca:read(tls.caFile),controllerPin:tls.controllerPin}}});
    health=await listenWorkerHealth({...config.health,ready:()=>!closing && service.ready()});
    return{close};
  }catch(error){await close();throw error;}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  startWorkerService({configFile:process.env.OMB_WORKER_SERVICE_CONFIG}).then(host=>{
    const stop=()=>{host.close().catch(()=>{process.exitCode=1;});};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);process.stdout.write('Worker service ready.\n');
  }).catch(()=>{process.stderr.write('Worker service startup rejected.\n');process.exitCode=1;});
}
