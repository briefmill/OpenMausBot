import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

test('container agent keeps provider child logs outside its task receipt channel',async()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-container-agent-'));let child;
  try {
    const bootstrap=join(home,'bootstrap.mjs');
    writeFileSync(bootstrap,`export async function bootstrap(){console.log('synthetic-provider-log');return{
      runtime:{async run(){return{result:{turnId:'native',ok:true,cancelled:false,events:2,stopReason:null}};}},close:async()=>{}};}`);
    child=spawn(process.execPath,[fileURLToPath(new URL('./container-agent.mjs',import.meta.url)),bootstrap,home,'5000'],{
      cwd:home,windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TEMP:home,TMP:home}});
    const output=[],errors=[];child.stdout.on('data',b=>output.push(b));child.stderr.on('data',b=>errors.push(b));
    const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const token='a'.repeat(64);
    child.stdin.end(JSON.stringify({job:{id:'job',bot:'bot',thread:'thread',worker:'worker'},
      lease:{id:'job',worker:'worker',generation:1,token,deadline:Date.now()+10000},content:{text:'Task'}}));
    assert.equal(await exit,0,Buffer.concat(errors).toString());
    const wire=Buffer.concat(output).toString();assert.equal(JSON.parse(wire).result.ok,true);
    assert.equal(wire.includes('synthetic-provider-log'),false);assert.equal(wire.includes(token),false);
  }finally{
    if(child && child.exitCode===null){child.kill();await new Promise(resolve=>child.once('close',resolve));}
    assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-container-agent-'));
    rmSync(home,{recursive:true,force:true});
  }
});
