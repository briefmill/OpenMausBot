import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {ClaudeDriver} from '../drivers/claude.ts';
import {CodexDriver} from '../drivers/codex.ts';
import {workerClient} from './worker-client.mjs';
import {withNativeWorkerTools} from './native-tool-input.mjs';
import {createAssignedProviderBootstrap} from './assigned-bootstrap.mjs';

const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const read=(file,limit=65536)=>{
  if(typeof file!=='string' || !isAbsolute(file))throw Error('Absolute worker binding path required');
  const bytes=readFileSync(file);if(bytes.length>limit)throw Error('Worker binding file too large');return bytes.toString('utf8');
};

// The operator installs this read-only binding outside the writable workspace.
// It contains only this worker's provider and controller-event credentials.
export async function bootstrap({signal,task}) {
  const config=JSON.parse(read(process.env.OMB_NATIVE_WORKER_CONFIG,262144));
  if(!exact(config,config.version===2?['version','driver','instance','assignment','input','controller','toolRelay']:['version','driver','instance','assignment','input','controller']) || ![1,2].includes(config.version) || (config.version===2 && config.toolRelay!==true) ||
     !['claudeAgent','codex'].includes(config.driver) ||
     !exact(config.controller,['origin','tokenFile','keyFile','certFile','caFile','serverPin']) ||
     config.input?.approvalMode!=='ask' || config.input.mcpFromUserConfig!==false || !config.input.toolScope)
    throw Error('Host-owned native worker binding required');
  signal.throwIfAborted();
  const c=config.controller;
  const client=workerClient({origin:c.origin,token:read(c.tokenFile).trim(),allowRemote:true,
    tls:{key:read(c.keyFile),cert:read(c.certFile),ca:read(c.caFile),serverPin:c.serverPin}});
  const input=config.version===2?withNativeWorkerTools({input:config.input,controller:c,task}):config.input;
  return createAssignedProviderBootstrap({driver:config.driver==='claudeAgent'?ClaudeDriver:CodexDriver,client,
    instance:config.instance,assignment:config.assignment,
    input:{...input,engineAdmission:async()=>{signal.throwIfAborted();},approvalModeNow:()=> 'ask'}})({signal,task});
}
