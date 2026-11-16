const id=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const prefix='com.openmausbot.worker.';

// Only the trusted host runs Docker commands. Workers receive neither the
// management socket nor a way to choose another container's lifecycle scope.
export function createContainerSupervisor({run,dockerArgs,namespace}) {
  if(typeof run!=='function' || typeof dockerArgs!=='function' || !id(namespace))throw Error('Trusted container host required');
  const labels=identity=>{
    if(!id(identity?.id) || !id(identity.worker) || !Number.isSafeInteger(identity.generation) || identity.generation<1)
      throw Error('Invalid container ownership');
    return {[prefix+'namespace']:namespace,[prefix+'job']:identity.id,[prefix+'worker']:identity.worker,
      [prefix+'generation']:String(identity.generation)};
  };
  const call=async args=>{
    const result=await run(dockerArgs(args),{timeoutMs:10000});
    if(typeof result?.stdout!=='string' || Buffer.byteLength(result.stdout)>65536)throw Error('Container host response rejected');
    return result.stdout.trim();
  };
  const inspect=async(identity)=>{
    const expected=labels(identity);
    const listed=await call(['ps','-a','--no-trunc',...Object.entries(expected).flatMap(([key,value])=>['--filter',`label=${key}=${value}`]),'--format','{{.ID}}']);
    const ids=listed?listed.split(/\r?\n/):[];
    if(ids.length>1 || ids.some(value=>!/^[a-f0-9]{64}$/.test(value)))throw Error('Ambiguous container ownership');
    if(!ids.length)return null;
    const raw=await call(['inspect','--format','{{json .Id}}\n{{json .Config.Labels}}\n{{json .State}}',ids[0]]);
    const lines=raw.split(/\r?\n/);
    if(lines.length!==3)throw Error('Container inspection rejected');
    const [containerId,actual,state]=lines.map(line=>JSON.parse(line));
    if(containerId!==ids[0] || !actual || !state || Object.entries(expected).some(([key,value])=>actual[key]!==value))
      throw Error('Foreign container inspection');
    return{containerId,state};
  };
  const stopped=state=>state.Running===false && state.Restarting===false && state.Paused===false &&
    ['exited','dead','created'].includes(state.Status);
  return {
    labels,
    async stop(identity) {
      const container=await inspect(identity);
      if(container && !stopped(container.state))await call(['stop','--time','5',container.containerId]);
    },
    async inspectStopped(identity) {
      const container=await inspect(identity);
      return container===null || stopped(container.state);
    },
  };
}
