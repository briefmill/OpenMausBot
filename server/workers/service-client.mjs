import {tlsRequester} from './tls-request.mjs';
import {setTimeout as pause} from 'node:timers/promises';

const contentKeys=['text','recalled','system','systemStable','systemVolatile','recoveryText','transcript','mentionTurn','preloadBrowserTools'];
export function createServiceClient({origin,token,tls,worker,allowRemote=false}) {
  if(typeof token!=='string' || token.length<32 || typeof worker!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(worker))
    throw Error('Trusted worker service binding required');
  const execution=tlsRequester(origin,tls,{allowRemote,timeoutMs:300000});
  const control=tlsRequester(origin,tls,{allowRemote});
  const identity=value=>{
    if(value?.worker!==worker || typeof value.id!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value.id) ||
       !Number.isSafeInteger(value.generation) || value.generation<1)throw Error('Foreign worker service identity');
    return value;
  };
  const status=(value,action,signal)=>{identity(value);return control.call(`/v1/jobs/${value.id}/${action}`,token,{generation:value.generation},signal);};
  return{
    close(){execution.close();control.close();},
    async execute({job,lease,input,signal}) {
      identity(lease);
      if(lease.id!==job.id || job.worker!==worker || input.botId!==job.bot || input.threadId!==job.thread ||
         (input.images?.length??0)>0 || input.resumeCursor!==undefined)throw Error('Unsupported service turn');
      const body={job:Object.fromEntries(['id','worker','bot','thread','project','resource','resources'].map(key=>[key,job[key]])),
        lease:structuredClone(lease),content:Object.fromEntries(contentKeys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))};
      if(Buffer.byteLength(JSON.stringify(body))>4*1024*1024+65536)throw Error('Worker service task too large');
      const response=await execution.call(`/v1/jobs/${job.id}/run`,token,body,signal);
      if(response.jobId!==job.id || response.worker!==worker || response.generation!==lease.generation || !response.result)
        throw Error('Foreign worker service receipt');
      return{lease:structuredClone(lease),result:response.result};
    },
    async browser({lease,operation,signal}) {
      identity(lease);
      const response=await execution.call(`/v1/jobs/${lease.id}/browser`,token,{generation:lease.generation,leaseToken:lease.token,operation},signal);
      if(response.jobId!==lease.id || response.worker!==worker || response.generation!==lease.generation)throw Error('Foreign browser service receipt');
      return response.result;
    },
    async stop(value) {
      const signal=AbortSignal.timeout(8000);
      let result=await status(value,'cancel',signal);
      while(result.stoppedVerified!==true){
        if(result.state===null || result.state==='uncertain')throw Error('Worker service reconciliation required');
        await pause(25,undefined,{signal});result=await status(value,'status',signal);
      }
    },
    async inspectStopped(value){return(await status(value,'status',AbortSignal.timeout(5000))).stoppedVerified===true;},
  };
}
