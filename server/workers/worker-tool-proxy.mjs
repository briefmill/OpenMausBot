import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';import {pathToFileURL} from 'node:url';
import {workerClient} from './worker-client.mjs';
import {serveWorkerMcp} from './worker-mcp-stdio.mjs';
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const read=file=>{
  if(typeof file!=='string' || !isAbsolute(file))throw Error('Absolute worker credential path required');
  const bytes=readFileSync(file);if(bytes.length>65536)throw Error('Worker credential exceeds budget');return bytes.toString('utf8');
};
export async function runWorkerToolProxy({binding,signal,input,output}) {
  if(!exact(binding,['controller','jobId','lease']) || !exact(binding.controller,['origin','tokenFile','keyFile','certFile','caFile','serverPin']))
    throw Error('Fixed worker tool binding required');
  const c=binding.controller;
  const client=workerClient({origin:c.origin,token:read(c.tokenFile).trim(),allowRemote:true,
    tls:{key:read(c.keyFile),cert:read(c.certFile),ca:read(c.caFile),serverPin:c.serverPin}});
  try {
    await client.verifyLease({jobId:binding.jobId,lease:binding.lease,signal});
    await serveWorkerMcp({client,jobId:binding.jobId,lease:binding.lease,signal,input,output});
  }finally{client.close();}
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const control=new AbortController(),stop=()=>control.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try {
    const raw=process.env.OMB_WORKER_TOOL_TOKEN_BINDING;
    if(typeof raw!=='string' || Buffer.byteLength(raw)>262144)throw Error('Worker tool binding unavailable');
    await runWorkerToolProxy({binding:JSON.parse(raw),signal:control.signal,input:process.stdin,output:process.stdout});
  }catch{process.stderr.write('Worker tool bridge unavailable.\n');process.exitCode=1;}
  finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
