import {fileURLToPath} from 'node:url';
import {parseToolScope} from '../../shared/tool-scope.ts';

// The proxy holds only this worker's event credentials. The controller enforces
// the original account/tool scope on each operation behind this transport alias.
export function withNativeWorkerTools({input,controller,task}) {
  const parsed=parseToolScope(input.toolScope);
  if(!parsed.ok || !parsed.scope || input.approvalMode!=='ask' || input.mcpFromUserConfig!==false ||
     input.guestConfined || (input.integrations?.custom?.worker_apps || input.integrations?.controllerTools) || !task?.lease || task.lease.id!==task.jobId)
    throw Error('Trusted native tool input required');
  const proxy={command:process.execPath,args:[fileURLToPath(new URL('./worker-tool-proxy.mjs',import.meta.url))],
    env:{OMB_WORKER_TOOL_TOKEN_BINDING:JSON.stringify({controller,jobId:task.jobId,lease:task.lease})}};
  const scope=structuredClone(parsed.scope);
  if(scope.allow)scope.allow.push('mcp:worker_apps:*');
  return{...input,toolScope:scope,integrations:{...input.integrations,controllerTools:proxy}};
}
