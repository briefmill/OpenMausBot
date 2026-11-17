import {mountChatTools} from '../drivers/chat-mcp-tools.ts';
import {redactSecretsInText} from '../redact.ts';
import {toolDetailPreview} from '../tool-summary.ts';
import {createLazyToolSession} from './lazy-tool-session.mjs';
import {createControllerToolSession} from './controller-tool-session.mjs';

// Controller-selected integration descriptors retain account pins and tool
// scopes. A worker browser may use an explicit trusted transport. Host computer
// bridges never mount through this relay.
export async function openAccountScopedWorkerTools(args) {
  if(args.browserTransport)return createLazyToolSession({signal:args.signal,isCurrent:args.isCurrent,open:()=>mountAccountScopedWorkerTools(args)});
  return mountAccountScopedWorkerTools(args);
}
async function mountAccountScopedWorkerTools(args) {
  const {input,job,signal,isCurrent}=args;
  if(!input || input.botId!==job.bot || input.threadId!==job.thread || input.mcpFromUserConfig!==false || input.guestConfined)
    throw Error('Controller-owned worker tool input required');
  signal.throwIfAborted();if(!isCurrent())throw Error('Worker tool mount no longer current');
  const integrations=structuredClone(input.integrations),scope=structuredClone(input.toolScope);
  if(args.browserTransport && integrations)delete integrations.localComputer;
  const secrets=[];
  for(const integration of Object.values(integrations ?? {})) {
    if(!integration || typeof integration!=='object')continue;
    const specs='command' in integration ? [integration] : Object.values(integration);
    for(const spec of specs)for(const [key,value] of Object.entries(spec?.env ?? {}))
      if(/key|token|password|secret|authorization/i.test(key) && typeof value==='string' && value.length>=8)secrets.push(value);
  }
  const scrub=text=>{
    for(const secret of secrets)text=text.split(secret).join('[redacted]');
    return redactSecretsInText(text);
  };
  const tools=await mountChatTools(integrations,signal,Boolean(args.browserTransport),scope,undefined,undefined,input.toolResultFolder,scrub,undefined,true,args.browserTransport);
  try {
    signal.throwIfAborted();if(!isCurrent())throw Error('Worker tool mount no longer current');
    const preview=value=>toolDetailPreview(JSON.parse(JSON.stringify(value,(_key,part)=>typeof part==='string'?scrub(part):part)));
    return createControllerToolSession({...args,session:{...tools,
      definitions:JSON.parse(JSON.stringify(tools.definitions,(_key,part)=>typeof part==='string'?scrub(part):part)),
      view:(name,args)=>{
        const shown=tools.view(name,args),identity=tools.identity?.(name,args);
        return identity?{...shown,title:`mcp__${identity.server}__${identity.tool}`}:shown;
      },
      execute:async(...callArgs)=>{
        const result=await tools.execute(...callArgs);
        return {...result,text:scrub(result.text)};
      }},
      mode:()=>input.approvalModeNow?.() ?? input.approvalMode,preview});
  } catch(error) {await tools.close();throw error;}
}
