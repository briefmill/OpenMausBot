import {lstatSync,fstatSync,chmodSync,realpathSync,readdirSync,openSync,closeSync,readFileSync,writeFileSync,fsyncSync,mkdirSync,chownSync,renameSync,constants} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const valid=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const markerName='.mausbot-worker.json';
function scope({root,binding,uid}){
  if(process.platform!=='linux' || process.getuid?.()!==0 || !isAbsolute(root??'') || resolve(root)==='/' ||
     !binding || Object.keys(binding).sort().join(',')!=='bot,desktop,project,worker,workspace' || !Object.values(binding).every(valid) ||
     !Number.isSafeInteger(uid) || uid<1000 || uid>60000)throw Error('Trusted worker storage scope required');
  root=resolve(root);const info=lstatSync(root);
  if(!info.isDirectory() || info.isSymbolicLink() || realpathSync(root)!==root || info.uid!==0 || info.gid!==0 || (info.mode&0o022)!==0 || (info.mode&0o001)===0)
    throw Error('Protected worker volume root required');
  return{root,binding:structuredClone(binding),uid,marker:join(root,markerName),file:join(root,'authority','jobs.db'),cwd:join(root,'workspace')};
}
function readMarker(file){
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=fstatSync(fd);
    if(!info.isFile() || info.uid!==0 || (info.mode&0o077)!==0 || info.size>4096)throw Error('Protected volume binding required');
    return JSON.parse(readFileSync(fd,'utf8'));
  }finally{closeSync(fd);}
}
const syncDirectory=root=>{const fd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}};
function writeNew(file,value){
  const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}
}

// An existing volume is verified, never silently re-owned. Its root-only marker
// binds both the journal and workspace to one bot, project and worker identity.
export function verifyServiceStorage(options){
  const selected=scope(options),expected={version:1,state:'ready',binding:selected.binding,uid:selected.uid};
  if(!isDeepStrictEqual(readMarker(selected.marker),expected))throw Error('Foreign or unfinished worker volume');
  const authority=lstatSync(join(selected.root,'authority')),workspace=lstatSync(selected.cwd);
  if(!authority.isDirectory() || authority.isSymbolicLink() || authority.uid!==0 || (authority.mode&0o077)!==0 ||
     !workspace.isDirectory() || workspace.isSymbolicLink() || workspace.uid!==selected.uid || workspace.gid!==selected.uid || (workspace.mode&0o022)!==0)
    throw Error('Worker storage ownership mismatch');
  return{file:selected.file,cwd:selected.cwd};
}

export function initializeServiceStorage(options){
  const selected=scope(options);
  if(readdirSync(selected.root).includes(markerName))return verifyServiceStorage(options);
  if(readdirSync(selected.root).some(name=>name!=='lost+found'))throw Error('Unbound nonempty worker volume refused');
  writeNew(selected.marker,{version:1,state:'initializing',binding:selected.binding,uid:selected.uid});syncDirectory(selected.root);
  mkdirSync(join(selected.root,'authority'),{mode:0o700});mkdirSync(selected.cwd,{mode:0o755});chmodSync(selected.cwd,0o755);chownSync(selected.cwd,selected.uid,selected.uid);
  syncDirectory(join(selected.root,'authority'));syncDirectory(selected.cwd);
  const temporary=join(selected.root,'.binding-'+randomBytes(12).toString('hex'));
  writeNew(temporary,{version:1,state:'ready',binding:selected.binding,uid:selected.uid});renameSync(temporary,selected.marker);syncDirectory(selected.root);
  return verifyServiceStorage(options);
}
