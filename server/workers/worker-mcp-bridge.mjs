import {createHash,randomUUID} from 'node:crypto';

export function createWorkerMcpBridge({client,jobId,lease,signal}) {
  if(!['toolCatalog','callTool'].every(key=>typeof client?.[key]==='function') || lease?.id!==jobId || !signal)
    throw Error('Bounded controller tool bridge required');
  const binding=structuredClone(lease),requests=new Map();let poisoned=false;
  const catalog=async()=>{
    const {definitions}=await client.toolCatalog({jobId,lease:binding,signal});
    if(!Array.isArray(definitions) || definitions.length>4096 || Buffer.byteLength(JSON.stringify(definitions))>1024*1024)
      throw Error('Invalid controller tool catalog');
    return definitions.map(definition=>{
      const tool=definition?.function;
      if(definition?.type!=='function' || typeof tool?.name!=='string' || !/^[a-zA-Z0-9_]{1,128}$/.test(tool.name) ||
         typeof tool.description!=='string' || !tool.parameters || typeof tool.parameters!=='object')throw Error('Invalid controller tool definition');
      return{name:tool.name,description:tool.description,inputSchema:tool.parameters};
    });
  };
  return {
    async handle(message) {
      if(!message || message.jsonrpc!=='2.0' || typeof message.method!=='string' ||
         (message.id!==undefined && !((typeof message.id==='string' && message.id.length<=128) || Number.isSafeInteger(message.id))))
        return{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}};
      if(message.id===undefined)return undefined;
      const reply=result=>({jsonrpc:'2.0',id:message.id,result});
      const error=(code,text)=>({jsonrpc:'2.0',id:message.id,error:{code,message:text}});
      try {
        signal.throwIfAborted();
        if(message.method==='initialize')return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},
          serverInfo:{name:'mausbot-controller-tools',version:'1'}});
        if(message.method==='ping')return reply({});
        if(message.method==='tools/list')return reply({tools:await catalog()});
        if(message.method!=='tools/call')return error(-32601,'Method unavailable');
        const params=message.params;
        if(!params || Object.keys(params).some(key=>!['name','arguments','_meta'].includes(key)) ||
           typeof params.name!=='string' || !params.arguments || typeof params.arguments!=='object' || Array.isArray(params.arguments) ||
           Buffer.byteLength(JSON.stringify(params))>1024*1024)return error(-32602,'Invalid tool arguments');
        const key=JSON.stringify(message.id),hash=createHash('sha256').update(JSON.stringify(params)).digest('hex');
        const previous=requests.get(key);
        if(previous){if(previous.hash!==hash)return error(-32600,'Conflicting request identity');return await previous.promise;}
        if(poisoned)return error(-32000,'Tool delivery needs reconciliation. Do not repeat the action.');
        if(requests.size>=64)return error(-32000,'Tool invocation budget exhausted');
        const promise=(async()=>{
          try {
            if(!(await catalog()).some(tool=>tool.name===params.name))return error(-32602,'Tool unavailable for this job');
            const result=await client.callTool({jobId,lease:binding,signal,
              call:{id:randomUUID(),tool:params.name,arguments:structuredClone(params.arguments)}});
            if(typeof result?.result?.ok!=='boolean' || typeof result.result.text!=='string')throw Error('Invalid controller result');
            return reply({isError:!result.result.ok,content:[{type:'text',text:result.result.text+
              (result.result.images?.length?'\nImage output is unavailable through this tool bridge.':'')}]});
          } catch {
            poisoned=true;
            return error(-32000,'Tool delivery needs reconciliation. Do not repeat the action.');
          }
        })();
        requests.set(key,{hash,promise});return await promise;
      } catch {return error(-32000,'Controller tools unavailable');}
    },
  };
}
