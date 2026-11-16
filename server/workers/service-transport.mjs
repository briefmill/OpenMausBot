import {createServer} from 'node:https';
import {createHash,timingSafeEqual} from 'node:crypto';
import {validWorkerHost} from './transport-address.mjs';
import {normalizeWorkerAssignment,workerAssignmentMatches} from './worker-assignment.mjs';

const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const digest=value=>createHash('sha256').update(value).digest();
const id=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const rejected=status=>Object.assign(Error('Service operation rejected'),{status});
async function body(req){
  if(req.headers['content-type']!=='application/json')throw rejected(415);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024+65536)throw rejected(413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw rejected(400);}
}

// The supervisor owns TLS keys, service state and lease authorization. Provider
// processes receive no service-control credentials or management endpoints.
export async function listenExecutionService({service,worker,assignment,authorize,controllerToken,tls,
  listenHost='127.0.0.1',advertisedHost='127.0.0.1',port=0,deadlineMs=300000}) {
  if(!['run','state','cancelUnseen'].every(key=>typeof service?.[key]==='function') || !id(worker) || typeof authorize!=='function' ||
     typeof controllerToken!=='string' || controllerToken.length<32 || controllerToken.length>512 ||
     !exact(tls,['key','cert','ca','controllerPin']) || !/^[a-f0-9]{64}$/.test(tls.controllerPin) ||
     ![tls.key,tls.cert,tls.ca].every(value=>(typeof value==='string' || Buffer.isBuffer(value)) && value.length) ||
     !['127.0.0.1','0.0.0.0','::'].includes(listenHost) || !validWorkerHost(advertisedHost) || advertisedHost==='0.0.0.0' ||
     !Number.isSafeInteger(port) || port<0 || port>65535 || !Number.isSafeInteger(deadlineMs) || deadlineMs<1 || deadlineMs>300000)
    throw Error('Pinned trusted execution service required');
  const policy=normalizeWorkerAssignment(assignment),tokenHash=digest(controllerToken),pin=Buffer.from(tls.controllerPin,'hex');
  let active,closing=false;
  const server=createServer({key:tls.key,cert:tls.cert,ca:tls.ca,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3',
    maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000},async(req,res)=>{
    const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}};
    try{
      if(closing)throw rejected(503);
      if(req.headers.host!==`${advertisedHost}:${server.address().port}` || req.headers.origin)throw rejected(403);
      const credential=/^Bearer ([^\s]{32,512})$/.exec(req.headers.authorization??'');
      if(!credential || !timingSafeEqual(digest(credential[1]),tokenHash))throw rejected(401);
      const raw=req.socket.getPeerCertificate().raw;
      if(!req.socket.authorized || !raw || !timingSafeEqual(digest(raw),pin))throw rejected(403);
      const route=/^\/v1\/jobs\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})\/(run|status|cancel)$/.exec(req.url);
      if(!route || req.method!=='POST')throw rejected(404);
      const [,jobId,action]=route,data=await body(req);
      if(action!=='run'){
        if(!exact(data,['generation']) || !Number.isSafeInteger(data.generation) || data.generation<1)throw rejected(400);
        const identity={id:jobId,worker,generation:data.generation};
        if(action==='cancel' && active?.identity.id===jobId && active.identity.generation===data.generation)active.control.abort();
        if(action==='cancel')service.cancelUnseen(identity);
        const state=service.state(identity);
        return send(200,{state,stoppedVerified:['completed','failed','cancelled'].includes(state)});
      }
      if(active)throw rejected(409);
      if(!exact(data,['job','lease','content']) || !exact(data.job,['id','worker','bot','thread','project','resource','resources']) ||
         data.job.id!==jobId || data.job.worker!==worker || !id(data.job.thread) || !workerAssignmentMatches(policy,data.job) ||
         !exact(data.lease,['id','worker','generation','token','deadline']) || data.lease.id!==jobId || data.lease.worker!==worker ||
         !Number.isSafeInteger(data.lease.generation) || data.lease.generation<1 || !/^[a-f0-9]{64}$/.test(data.lease.token) ||
         !Number.isSafeInteger(data.lease.deadline) || data.lease.deadline<=Date.now())throw rejected(400);
      const allowed=new Set(['text','recalled','system','systemStable','systemVolatile','recoveryText','transcript','mentionTurn','preloadBrowserTools']);
      if(!data.content || typeof data.content!=='object' || Array.isArray(data.content) || typeof data.content.text!=='string' ||
         Object.keys(data.content).some(key=>!allowed.has(key)))throw rejected(400);
      const identity={id:jobId,worker,generation:data.lease.generation},control=new AbortController();
      let done;const slot={identity,control,done:new Promise(resolve=>{done=resolve;})};active=slot;
      const timer=setTimeout(()=>control.abort(),Math.min(deadlineMs,data.lease.deadline-Date.now()));
      const disconnected=()=>{if(!res.writableEnded)control.abort();};res.once('close',disconnected);
      try{
        let interrupted;
        try{
          const approved=await Promise.race([
            Promise.resolve().then(()=>authorize({job:structuredClone(data.job),lease:structuredClone(data.lease),signal:control.signal})),
            new Promise((_,reject)=>{
              interrupted=()=>reject(rejected(409));control.signal.addEventListener('abort',interrupted,{once:true});
              if(control.signal.aborted)interrupted();
            }),
          ]);
          if(approved!==true)throw rejected(403);
        }finally{if(interrupted)control.signal.removeEventListener('abort',interrupted);}
        control.signal.throwIfAborted();
        const execution=await service.run({identity,task:structuredClone(data),signal:control.signal});
        const result=execution?.result;
        if(!exact(result,['turnId','ok','cancelled','events','stopReason']) || typeof result.turnId!=='string' || result.turnId.length>256 ||
           typeof result.ok!=='boolean' || typeof result.cancelled!=='boolean' || !Number.isSafeInteger(result.events) || result.events<0 ||
           ![null,'provider-stopped'].includes(result.stopReason))throw rejected(502);
        send(200,{jobId,worker,generation:identity.generation,result});
      }finally{clearTimeout(timer);res.removeListener('close',disconnected);if(active===slot)active=undefined;done();}
    }catch(error){send(error.status??409,{error:'Service operation rejected'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,listenHost,()=>{server.removeListener('error',reject);resolve();});});
  return{origin:`https://${advertisedHost}:${server.address().port}`,async close(){
    closing=true;const pending=active;pending?.control.abort();
    const closed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    server.closeAllConnections();await pending?.done;await closed;
  }};
}
