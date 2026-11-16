import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';import {createHash,X509Certificate} from 'node:crypto';
import {JobLedger} from './ledger.mjs';import {listenTransport} from './transport.mjs';
import {createDurableToolExecutor} from './tool-executor.mjs';import {ChatMcpClient} from '../drivers/chat-mcp-tools.ts';

test('spawned native MCP proxy uses pinned TLS and the own-job durable tool journal',{timeout:30000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'omb-native-tool-')),ledger=new JobLedger(':memory:');
  let transport,proxy,executions=0;
  const file=name=>join(directory,name),read=name=>readFileSync(file(name));
  const run=args=>execFileSync('openssl',args,{cwd:directory,stdio:'ignore',windowsHide:true,timeout:10000});
  try{
    run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-days','1','-subj','/CN=disposable-native-tools']);
    for(const name of ['server','controller','worker']) {
      run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+name]);
      writeFileSync(file(name+'.ext'),name==='server'?'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth':'extendedKeyUsage=clientAuth');
      run(['x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out',name+'.crt','-days','1','-extfile',name+'.ext']);
    }
    const pin=name=>createHash('sha256').update(new X509Certificate(read(name+'.crt')).raw).digest('hex');
    const token='w'.repeat(40);writeFileSync(file('worker.token'),token);
    const tools={...createDurableToolExecutor({ledger,authorize:async({job})=>job.bot==='bot',
      dispatch:async()=>{executions++;return{ok:true,text:'synthetic account report'};}}),
      list:({lease})=>{ledger.owned(lease);return[{type:'function',function:{name:'account_read',description:'Synthetic read',parameters:{type:'object',properties:{}}}}];}};
    transport=await listenTransport({ledger,controllerToken:'c'.repeat(40),tools,
      workers:[{id:'worker',token,capacity:1,assignments:[{bot:'bot',thread:'thread',project:'project',resource:'desktop'}]}],
      tls:{key:read('server.key'),cert:read('server.crt'),ca:read('ca.crt'),controllerPin:pin('controller'),workerPins:{worker:pin('worker')}}});
    ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
    const lease=ledger.claim('job','worker',30000);
    const binding={jobId:'job',lease,controller:{origin:transport.origin,tokenFile:file('worker.token'),keyFile:file('worker.key'),
      certFile:file('worker.crt'),caFile:file('ca.crt'),serverPin:pin('server')}};
    proxy=new ChatMcpClient({command:process.execPath,args:[fileURLToPath(new URL('./worker-tool-proxy.mjs',import.meta.url))],
      env:{OMB_WORKER_TOOL_TOKEN_BINDING:JSON.stringify(binding)}});
    const signal=AbortSignal.timeout(10000),catalog=await proxy.tools(signal);
    assert.deepEqual(catalog.map(tool=>tool.name),['account_read']);
    const result=await proxy.call('tools/call',{name:'account_read',arguments:{}},signal,5000);
    assert.equal(result.isError,false);assert.equal(result.content[0].text,'synthetic account report');assert.equal(executions,1);
    assert.equal(ledger.db.prepare('SELECT state FROM worker_tool_calls').get().state,'completed');
    const driverScript=file('driver.mjs'),fixtureConfig=file('driver.json');
    writeFileSync(fixtureConfig,JSON.stringify({controller:binding.controller,task:{jobId:'job',lease}}));
    const moduleUrl=name=>pathToFileURL(fileURLToPath(new URL(name,import.meta.url))).href;
    writeFileSync(driverScript,`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
      import {ClaudeDriver} from ${JSON.stringify(moduleUrl('../drivers/claude.ts'))};
      import {ensureDirs} from ${JSON.stringify(moduleUrl('../config.ts'))};
      import {withNativeWorkerTools} from ${JSON.stringify(moduleUrl('./native-tool-input.mjs'))};
      const config=JSON.parse(readFileSync(process.argv[2],'utf8'));ensureDirs();
      const instance=await ClaudeDriver.create({instanceId:'synthetic-native-tools',enabled:true,
        config:{cli:${JSON.stringify(fileURLToPath(new URL('../testing/fake-claude-cli.ts',import.meta.url)))},permissionMode:'acceptEdits'},
        environment:{HOME:${JSON.stringify(directory)},FAKE_CLAUDE_TOOL_CALLS:JSON.stringify([{server:'worker_apps',name:'account_read',input:{}}]),
          FAKE_CLAUDE_MODE:'happy',OMB_CLAUDE_SESSION_IDLE_MS:'1000'}});
      const events=[];let done;const terminal=new Promise(resolve=>{done=resolve;});
      instance.adapter.onEvent(event=>{events.push(event);if(event.type==='turn.completed')done(event);});
      try {
        const input=withNativeWorkerTools({input:{botId:'bot',threadId:'thread',text:'Synthetic account read',cwd:${JSON.stringify(directory)},
          approvalMode:'ask',mcpFromUserConfig:false,toolScope:{allow:['native:*']}},controller:config.controller,task:config.task});
        await instance.adapter.sendTurn({...input,engineAdmission:async()=>{},approvalModeNow:()=> 'ask'});
        const result=await Promise.race([terminal,new Promise((_,reject)=>setTimeout(()=>reject(Error('Native fixture deadline')),10000).unref())]);
        assert.equal(result.ok,true);
        assert.ok(events.some(event=>event.type==='item.completed' && JSON.stringify(event).includes('synthetic account report')));
        console.log(JSON.stringify({realClaudeDriver:true,syntheticCLI:true,toolResultObserved:true}));
      }finally{await instance.dispose();}
    `);
    const child=spawn(process.execPath,[driverScript,fixtureConfig],{windowsHide:true,env:{PATH:process.env.PATH,
      SystemRoot:process.env.SystemRoot,TEMP:directory,TMP:directory,HOME:directory,USERPROFILE:directory,OMB_DATA_DIR:file('isolated-data')},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Driver child deadline'));},20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve(code);});});
    assert.equal(exit,0,stderr.slice(-1500));assert.ok(stdout.includes('"toolResultObserved":true'));assert.equal(executions,2);
    ledger.cancel('job');
    const cancelled=await proxy.call('tools/call',{name:'account_read',arguments:{}},signal,5000).catch(error=>error);
    assert.ok(cancelled instanceof Error);assert.equal(executions,2);
  }finally{
    await proxy?.close();await transport?.close();ledger.close();
    if(dirname(resolve(directory))!==resolve(tmpdir()))throw Error('Unexpected fixture path');
    rmSync(directory,{recursive:true,force:true});
  }
});
