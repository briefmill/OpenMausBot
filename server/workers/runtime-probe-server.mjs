import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {workerRuntimePreflight} from './runtime-preflight.mjs';
import {listenWorkerHealth} from './service-health.mjs';

export async function startRuntimeProbe({port=8080,listenHost='::',ttlMs=120000}={}){
  if(!Number.isSafeInteger(ttlMs) || ttlMs<50 || ttlMs>120000)throw Error('Bounded preflight lifetime required');
  const report=await workerRuntimePreflight({verifyPrivilegeDrop:true});
  const health=await listenWorkerHealth({port,listenHost,ready:()=>true});
  let closing,timer;
  const close=()=>closing??=(async()=>{clearTimeout(timer);await health.close();})();
  timer=setTimeout(()=>{void close();},ttlMs);
  return{report,port:health.port,close};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  startRuntimeProbe({port:Number(process.env.PORT??8080)}).then(probe=>{
    process.stdout.write(JSON.stringify({kind:'worker-runtime-preflight',report:probe.report,providerCalls:0,maximumLifetimeMs:120000})+'\n');
    const close=()=>{probe.close().catch(()=>{process.exitCode=1;});};process.once('SIGTERM',close);process.once('SIGINT',close);
  }).catch(()=>{process.stderr.write('Runtime preflight failed.\n');process.exitCode=1;});
}
