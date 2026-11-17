import {createDurableToolExecutor} from './tool-executor.mjs';

// The controller resolves the pinned service from its own assignment registry.
// This adapter grants no permission and advertises no browser capability.
export function createDurableBrowserDispatch({ledger,authorize,resolveClient}) {
  if(typeof authorize!=='function' || typeof resolveClient!=='function')throw Error('Trusted browser dispatch callbacks required');
  const operation=call=>{
    if(call.tool==='browser.initialize')return{id:call.id,method:'initialize',params:call.arguments};
    if(call.tool==='browser.catalog')return{id:call.id,method:'tools/list',params:call.arguments};
    if(!/^browser\.agent_browser_[a-zA-Z0-9_]+$/.test(call.tool))throw Error('Worker browser tool required');
    return{id:call.id,method:'tools/call',params:{name:call.tool.slice('browser.'.length),arguments:call.arguments}};
  };
  const executor=createDurableToolExecutor({ledger,
    authorize:args=>{operation(args.call);return authorize(args);},
    dispatch:async({job,lease,call,signal})=>{
      const client=resolveClient(structuredClone(job));
      if(typeof client?.browser!=='function')throw Error('Assigned browser service unavailable');
      const result=await client.browser({lease,operation:operation(call),signal});
      return{ok:result?.isError!==true,text:JSON.stringify(result)};
    }});
  return{execute:args=>executor.execute(args),inspect:args=>executor.inspect(args)};
}
