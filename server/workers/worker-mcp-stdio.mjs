import {createWorkerMcpBridge} from './worker-mcp-bridge.mjs';

export async function serveWorkerMcp({client,jobId,lease,signal,input,output}) {
  const bridge=createWorkerMcpBridge({client,jobId,lease,signal}),pending=new Set();
  let buffer='',stopped=false;
  const send=message=>{
    if(message===undefined || stopped)return;
    if(output.writableLength>2*1024*1024){stopped=true;input.destroy(Error('MCP output budget exceeded'));return;}
    output.write(JSON.stringify(message)+'\n');
  };
  const invalid=()=>send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}});
  const line=text=>{
    if(!text.trim())return;
    if(pending.size>=16){send({jsonrpc:'2.0',id:null,error:{code:-32000,message:'Too many in-flight requests'}});return;}
    let message;try{message=JSON.parse(text);}catch{invalid();return;}
    const work=bridge.handle(message).then(send).catch(invalid).finally(()=>pending.delete(work));pending.add(work);
  };
  input.setEncoding('utf8');
  const aborted=()=>{stopped=true;input.destroy();};signal.addEventListener('abort',aborted,{once:true});
  try {
    signal.throwIfAborted();
    for await(const chunk of input) {
      buffer+=chunk;
      let boundary;
      while((boundary=buffer.indexOf('\n'))!==-1) {
        const text=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);
        if(Buffer.byteLength(text)>1024*1024)throw Error('MCP frame budget exceeded');
        line(text);
      }
      if(Buffer.byteLength(buffer)>1024*1024)throw Error('MCP frame budget exceeded');
    }
    if(buffer.trim())line(buffer);
    await Promise.allSettled([...pending]);
  } finally {stopped=true;signal.removeEventListener('abort',aborted);}
}
