import {createHash} from 'node:crypto';
const valid=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const prefix='com.openmausbot.workspace.';

export function createWorkerVolumes({run,dockerArgs,namespace,initImage}) {
  if(typeof run!=='function' || typeof dockerArgs!=='function' || !valid(namespace) || !/^sha256:[a-f0-9]{64}$/.test(initImage))
    throw Error('Trusted workspace storage host required');
  const describe=scope=>{
    if(!scope || Object.keys(scope).sort().join(',')!=='bot,project,workspace' || !Object.values(scope).every(valid))
      throw Error('Invalid workspace scope');
    const labels={[prefix+'namespace']:namespace,...Object.fromEntries(['bot','project','workspace'].map(key=>[prefix+key,scope[key]]))};
    return{name:'omb-workspace-'+createHash('sha256').update(JSON.stringify(labels)).digest('hex').slice(0,40),labels};
  };
  const call=async(args)=>{
    const result=await run(dockerArgs(args),{timeoutMs:10000});
    if(typeof result?.stdout!=='string' || Buffer.byteLength(result.stdout)>65536)throw Error('Workspace host response rejected');
    return result.stdout.trim();
  };
  const verify=async(name,scope)=>{
    const expected=describe(scope);
    if(name!==expected.name)throw Error('Foreign workspace volume');
    const raw=await call(['volume','inspect','--format','{{json .Name}}\n{{json .Labels}}\n{{json .Driver}}\n{{json .Options}}',name]);
    const lines=raw.split(/\r?\n/);
    if(lines.length!==4)throw Error('Workspace inspection rejected');
    const [actualName,labels,driver,options]=lines.map(line=>JSON.parse(line));
    if(actualName!==name || driver!=='local' || (options && Object.keys(options).length) || !labels ||
       Object.entries(expected.labels).some(([key,value])=>labels[key]!==value))throw Error('Foreign workspace storage');
    return true;
  };
  return {
    describe,verify,
    async ensure(scope) {
      const {name,labels}=describe(scope);
      const listed=await call(['volume','ls','--filter','name=^'+name+'$','--format','{{.Name}}']);
      if(listed && listed!==name)throw Error('Ambiguous workspace volume');
      if(!listed) {
        if(await call(['volume','create',...Object.entries(labels).flatMap(([key,value])=>['--label',key+'='+value]),name])!==name)
          throw Error('Workspace creation uncertain');
        await verify(name,scope);
        await call(['run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--cap-drop','ALL',
          '--cap-add','CHOWN','--security-opt','no-new-privileges','--memory','134217728','--pids-limit','32',
          '--mount','type=volume,src='+name+',dst=/storage,volume-nocopy','--entrypoint','/usr/bin/tini',initImage,'--','node','-e',
          "const fs=require('node:fs');fs.chmodSync('/storage',0o700);fs.chownSync('/storage',1000,1000)"]);
      }
      await verify(name,scope);
      await call(['run','--rm','--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--memory','134217728','--pids-limit','32',
        '--mount','type=volume,src='+name+',dst=/storage,volume-nocopy','--entrypoint','/usr/bin/tini',initImage,'--','node','-e',
        "const fs=require('node:fs');fs.accessSync('/storage',fs.constants.R_OK|fs.constants.W_OK);if(fs.statSync('/storage').uid!==1000)process.exit(1)"]);
      return{name};
    },
  };
}
