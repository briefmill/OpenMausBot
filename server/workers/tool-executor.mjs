import {createHash,randomBytes} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
function json(value,depth=0){
  if(depth>24)throw Error('Tool value nesting limit');
  if(value===null || typeof value==='string' || typeof value==='boolean')return value;
  if(typeof value==='number' && Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(item=>json(item,depth+1));
  if(value && typeof value==='object' && [Object.prototype,null].includes(Object.getPrototypeOf(value)))
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,json(value[key],depth+1)]));
  throw Error('JSON tool value required');
}
const encode=(value,limit)=>{const text=JSON.stringify(json(value));if(Buffer.byteLength(text)>limit)throw Error('Tool value exceeds delivery budget');return text;};

async function bounded(operation,signal){
  signal.throwIfAborted();let abort;
  try{return await Promise.race([
    Promise.resolve().then(()=>{signal.throwIfAborted();return operation();}),
    new Promise((_,reject)=>{abort=()=>reject(Error('Tool operation interrupted'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}),
  ]);}finally{if(abort)signal.removeEventListener('abort',abort);}
}

// Only controller-selected callbacks validate grants and dispatch upstream. A
// worker cannot finish, reset or authorize a persisted tool invocation.
export function createDurableToolExecutor({ledger,authorize,dispatch}){
  if(!ledger?.db || typeof ledger.owned!=='function' || typeof authorize!=='function' || typeof dispatch!=='function')
    throw Error('Trusted controller tool execution required');
  ledger.db.exec(`CREATE TABLE IF NOT EXISTS worker_tool_calls(
    job TEXT NOT NULL REFERENCES jobs(id),generation INTEGER NOT NULL,id TEXT NOT NULL,tool TEXT NOT NULL,
    request_sha TEXT NOT NULL,owner TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,result_sha TEXT,
    created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(job,generation,id));`);
  const get=(lease,callId)=>ledger.db.prepare('SELECT * FROM worker_tool_calls WHERE job=? AND generation=? AND id=?').get(lease.id,lease.generation,callId);
  const result=row=>{
    if(!row.result_json || hash(row.result_json)!==row.result_sha)throw Error('Tool result integrity failure');
    return JSON.parse(row.result_json);
  };
  const current=lease=>{const row=ledger.owned(lease);if(row.state!=='running')throw Error('Tool execution cancelled');return ledger.get(row.id);};
  return{
    inspect({lease,callId}){
      if(!id(callId))throw Error('Tool invocation identity required');current(lease);
      const row=get(lease,callId);return row?{state:row.state,tool:row.tool,...(['completed','denied'].includes(row.state)?{result:result(row)}:{})}:null;
    },
    async execute({lease,call,signal}){
      if(!signal || typeof signal.throwIfAborted!=='function' || !call || Object.keys(call).sort().join(',')!=='arguments,id,tool' ||
         !id(call.id) || typeof call.tool!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(call.tool) ||
         !call.arguments || typeof call.arguments!=='object' || Array.isArray(call.arguments))throw Error('Bounded tool invocation required');
      signal.throwIfAborted();
      const body=encode({tool:call.tool,arguments:call.arguments},1024*1024),request=JSON.parse(body),fingerprint=hash(body),owner=randomBytes(32).toString('hex');
      const prior=ledger.transaction(()=>{
        current(lease);const existing=get(lease,call.id);
        if(existing){if(existing.request_sha!==fingerprint)throw Error('Conflicting tool invocation replay');return existing;}
        const now=ledger.now();ledger.db.prepare("INSERT INTO worker_tool_calls(job,generation,id,tool,request_sha,owner,state,created,updated) VALUES (?,?,?,?,?,?,'pending',?,?)")
          .run(lease.id,lease.generation,call.id,call.tool,fingerprint,owner,now,now);return null;
      });
      if(prior){if(['completed','denied'].includes(prior.state))return{replay:true,result:result(prior)};throw Error('Unfinished tool invocation requires reconciliation');}
      const transition=(expected,state,output)=>ledger.transaction(()=>{
        const row=get(lease,call.id);if(row?.owner!==owner || row.state!==expected)throw Error('Tool invocation ownership changed');
        const encoded=output===undefined?null:encode(output,1024*1024);
        ledger.db.prepare('UPDATE worker_tool_calls SET state=?,result_json=?,result_sha=?,updated=? WHERE job=? AND generation=? AND id=?')
          .run(state,encoded,encoded===null?null:hash(encoded),ledger.now(),lease.id,lease.generation,call.id);
      });
      let dispatched=false;
      try{
        const allowed=await bounded(()=>authorize({job:current(lease),call:{id:call.id,...structuredClone(request)},signal}),signal);
        signal.throwIfAborted();current(lease);
        if(allowed!==true){const denied={ok:false,text:'Tool call denied by controller authorization.'};transition('pending','denied',denied);return{replay:false,result:denied};}
        transition('pending','dispatching');
        signal.throwIfAborted();current(lease);
        const output=await bounded(()=>{current(lease);dispatched=true;return dispatch({job:ledger.get(lease.id),call:{id:call.id,...structuredClone(request)},signal});},signal);
        if(typeof output?.ok!=='boolean')throw Error('Model-safe tool result required');
        transition('dispatching','completed',output);
        signal.throwIfAborted();current(lease);
        return{replay:false,result:result(get(lease,call.id))};
      }catch{
        const row=get(lease,call.id);
        if(row?.owner===owner && ['pending','dispatching'].includes(row.state))transition(row.state,dispatched?'uncertain':'denied',dispatched?undefined:{ok:false,text:'Tool authorization interrupted; no upstream operation dispatched.'});
        throw Error(dispatched?'Tool outcome requires reconciliation; do not repeat the action':'Tool authorization interrupted; no upstream operation dispatched');
      }
    },
  };
}

