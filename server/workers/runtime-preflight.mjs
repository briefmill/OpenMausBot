import {readFileSync,readlinkSync,accessSync,lstatSync,constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,isAbsolute,parse} from 'node:path';
import {pathToFileURL} from 'node:url';
const read=file=>{try{return readFileSync(file,'utf8').trim();}catch{return null;}};
const link=file=>{try{return readlinkSync(file);}catch{return null;}};
const executable=file=>{try{accessSync(file,constants.X_OK);return true;}catch{return false;}};
export function parseLinuxCapabilities(status){
  const match=/^CapEff:\s+([a-fA-F0-9]{1,16})\s*$/m.exec(status??'');if(!match)return null;
  const bits=BigInt('0x'+match[1]);return Object.fromEntries(Object.entries({CHOWN:0,SETGID:6,SETUID:7,SETPCAP:8}).map(([name,bit])=>[name,(bits&(1n<<BigInt(bit)))!==0n]));
}

// This report never reads environment values, credentials, job contents or
// process command lines. Matching namespace IDs do not prove host isolation.
export async function workerRuntimePreflight({storageRoot,verifyPrivilegeDrop=false}={}){
  if(storageRoot!==undefined && (!isAbsolute(storageRoot) || resolve(storageRoot)===parse(resolve(storageRoot)).root))throw Error('Explicit storage root required');
  const linux=process.platform==='linux',status=linux?read('/proc/self/status'):null;
  const report={platform:process.platform,architecture:process.arch,nodeMajor:Number(process.versions.node.split('.')[0]),uid:process.getuid?.()??null,
    tools:linux?{tini:executable('/usr/bin/tini'),setpriv:executable('/usr/bin/setpriv'),kill:executable('/bin/kill')}:null,
    capabilities:parseLinuxCapabilities(status),
    namespace:linux?{self:link('/proc/self/ns/pid'),pid1:link('/proc/1/ns/pid'),pid1Name:read('/proc/1/comm'),isolatedFromHostVerified:false}:null,
    limits:linux?{pidsMax:read('/sys/fs/cgroup/pids.max'),pidsCurrent:read('/sys/fs/cgroup/pids.current'),memoryMax:read('/sys/fs/cgroup/memory.max'),cpuMax:read('/sys/fs/cgroup/cpu.max')}:null,
    privilegeDrop:null,railwayQualified:false,modelAuthenticationVerified:false};
  if(storageRoot!==undefined){try{const info=lstatSync(storageRoot);report.storage={directory:info.isDirectory(),symlink:info.isSymbolicLink(),uid:info.uid,gid:info.gid,mode:info.mode&0o777};}
    catch{report.storage={available:false};}}
  if(verifyPrivilegeDrop){
    if(!linux || report.uid!==0 || !report.tools.setpriv)report.privilegeDrop={ok:false,reason:'Linux root and setpriv required'};
    else{
      const code=`const fs=require('node:fs'),status=fs.readFileSync('/proc/self/status','utf8');let protectedParent=false;
        try{process.kill(process.ppid,0);}catch(error){protectedParent=error.code==='EPERM';}
        console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),protectedParent,
          noNewPrivileges:/^NoNewPrivs:\\s+1$/m.test(status),emptyCapabilities:['CapEff','CapPrm','CapBnd','CapAmb'].every(name=>new RegExp('^'+name+':\\\\s+0+$','m').test(status))}));`;
      try{
        const {stdout}=await promisify(execFile)('/usr/bin/setpriv',['--reuid=1000','--regid=1000','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',process.execPath,'-e',code],
          {windowsHide:true,timeout:3000,maxBuffer:8192,env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});
        const result=JSON.parse(stdout);report.privilegeDrop={...result,ok:result.uid===1000 && result.gid===1000 && JSON.stringify(result.groups)==='[1000]' && result.protectedParent && result.noNewPrivileges && result.emptyCapabilities};
      }catch{report.privilegeDrop={ok:false,reason:'Privilege-drop probe failed'};}
    }
  }
  return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),verifyPrivilegeDrop=args.includes('--verify-privilege-drop'),at=args.indexOf('--storage-root');
  const allowed=new Set(['--verify-privilege-drop','--storage-root',...(at>=0?[args[at+1]]:[])]);
  if(args.some(value=>!allowed.has(value)) || (at>=0&&!args[at+1]))throw Error('Unsupported preflight arguments');
  console.log(JSON.stringify(await workerRuntimePreflight({verifyPrivilegeDrop,storageRoot:at>=0?args[at+1]:undefined})));
}
