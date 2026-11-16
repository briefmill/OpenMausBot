import {createServer} from 'node:http';

// Readiness exposes no job data and cannot authorize execution. The execution
// listener keeps its separate mutual TLS and controller credential checks.
export async function listenWorkerHealth({port=0,listenHost='127.0.0.1',ready}) {
  if(!Number.isSafeInteger(port) || port<0 || port>65535 || !['127.0.0.1','0.0.0.0','::'].includes(listenHost) || typeof ready!=='function')
    throw Error('Worker health configuration required');
  let closing=false;
  const server=createServer({maxHeaderSize:4096,requestTimeout:2000,headersTimeout:1000},(req,res)=>{
    if(req.method!=='GET' || req.url!=='/health'){res.writeHead(404);res.end();return;}
    let available=false;try{available=!closing && ready()===true;}catch{}
    res.writeHead(available?200:503,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({status:available?'ready':'unavailable'}));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,listenHost,()=>{server.removeListener('error',reject);resolve();});});
  return{port:server.address().port,async close(){closing=true;const closed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeAllConnections();await closed;}};
}
