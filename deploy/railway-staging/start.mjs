import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
if(process.env.RAILWAY_SERVICE_ID!=='44625f97-bc43-4018-83c0-a726756d2879')throw Error('This image only runs on the staging service');
const data='/data/.openmausbot';
if(!fs.existsSync(data+'/config.json'))throw Error('Existing staging workspace required');
const uid=Number(execFileSync('id',['-u','maus'],{encoding:'utf8'}).trim()),gid=Number(execFileSync('id',['-g','maus'],{encoding:'utf8'}).trim());
fs.mkdirSync('/tmp/omb-edge',{recursive:true,mode:0o700});fs.chownSync('/tmp/omb-edge',uid,gid);
Object.assign(process.env,{HOME:'/data',OMB_DATA_DIR:data,OMB_STATIC_DIR:'/app/dist',OMB_SERVER_NAME:'MausBot Staging - test data',OMB_PUBLIC_URL:'https://mausbot-staging-staging.up.railway.app',OMB_LOOPBACK_TRUST:'service',OMB_TUNNEL_SOCKET:'/tmp/omb-edge/http.sock',OMB_WEBHOOK_SOCKET:'/tmp/omb-edge/hooks.sock',OMB_CHROME_PATH:'/app/railway/chrome-wrapper.sh',AGENT_BROWSER_EXECUTABLE_PATH:'/app/railway/chrome-wrapper.sh'});
delete process.env.NODE_OPTIONS;
execFileSync(process.execPath,['/app/dist-server/staging-seed-preview.js'],{uid,gid,env:process.env,stdio:'inherit'});
const owner=randomBytes(32).toString('base64url');
const children=[];let closing=false;
function stop(code){if(closing)return;closing=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),25000).unref();Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve)))).then(()=>process.exit(code));}
const app=spawn(process.execPath,['/app/dist-server/server-launcher.js'],{uid,gid,stdio:['pipe','inherit','inherit'],env:{...process.env,OMB_CLI_OWNER_STDIN:'1'}});children.push(app);app.stdin.on('error',()=>{});app.stdin.end(owner+'\n');app.on('exit',code=>stop(code??1));
for(let i=0;i<180&&!fs.existsSync('/tmp/omb-edge/http.sock');i++)await new Promise(resolve=>setTimeout(resolve,500));
if(!fs.existsSync('/tmp/omb-edge/http.sock'))throw Error('Staging application socket did not open');
let healthy=false;
for(let attempt=0;attempt<180&&!healthy;attempt++){
 try{await new Promise((resolve,reject)=>{const request=http.get({socketPath:'/tmp/omb-edge/http.sock',path:'/api/health',headers:{host:'127.0.0.1:8799'}},response=>{response.resume();response.on('end',()=>response.statusCode===200?resolve():reject(Error('Not ready')));});request.on('error',reject);request.setTimeout(1000,()=>request.destroy(Error('Not ready')));});healthy=true;}catch{await new Promise(resolve=>setTimeout(resolve,500));}
}
if(!healthy)throw Error('Staging application health check did not become ready');
const edge=spawn('/usr/local/bin/caddy',['run','--config','/app/railway/Caddyfile','--adapter','caddyfile'],{uid,gid,stdio:'inherit',env:process.env});children.push(edge);edge.on('exit',code=>stop(code??1));
process.on('SIGTERM',()=>stop(0));process.on('SIGINT',()=>stop(0));
const marker=data+'/.composer-pair-20261118-4';
if(!fs.existsSync(marker)){
 const pairing=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:8799,path:'/api/auth/pairing',method:'POST',headers:{host:'127.0.0.1:8799','content-type':'application/json','x-openmausbot-cli':'1','x-openmausbot-cli-owner':owner}},res=>{let text='';res.on('data',chunk=>{text+=chunk;if(text.length>16000)req.destroy(Error('Oversized pairing response'));});res.on('end',()=>{if(res.statusCode!==200)return reject(Error('Staging pairing request refused: '+res.statusCode));try{resolve(JSON.parse(text));}catch(error){reject(error);}});});req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('Pairing request timed out')));req.end(JSON.stringify({scopes:['admin','client'],label:'Locksley staging desktop',ttlMs:600000}));});
 fs.writeFileSync(marker,'Pairing requested once\n',{mode:0o600});
 console.log('STAGING_DESKTOP_PAIRING_CODE '+pairing.code+' EXPIRES '+new Date(pairing.expiresAt).toISOString());
}
console.log('Staging composer deployment ready. Production services unchanged.');
