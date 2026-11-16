import { createBoundWorkerRuntime } from './worker-runtime.mjs';

export function createProviderBootstrap({driver,instance,client,binding,input}) {
  if(typeof driver?.create!=='function' || typeof driver.decodeConfig!=='function' ||
     typeof driver.driverKind!=='string' || instance?.enabled!==true ||
     typeof instance.instanceId!=='string' || !instance.environment ||
     typeof instance.environment!=='object' || Array.isArray(instance.environment) ||
     Object.values(instance.environment).some(value=>typeof value!=='string') || typeof client?.close!=='function')
    throw Error('Trusted provider construction required');
  const approved=structuredClone(binding),settings=structuredClone(instance);
  const callbacks={engineAdmission:input?.engineAdmission,approvalModeNow:input?.approvalModeNow};
  const fixed=structuredClone(Object.fromEntries(Object.entries(input??{}).filter(([key])=>!Object.hasOwn(callbacks,key))));
  const turnInput=()=>({...structuredClone(fixed),...callbacks});
  createBoundWorkerRuntime({client,adapter:{},binding:approved,input:turnInput()});
  let consumed=false;
  return async function bootstrap({signal}) {
    if(consumed || !signal)throw Error('Provider bootstrap already consumed or unbounded');
    signal.throwIfAborted();consumed=true;
    const provider=await driver.create({...structuredClone(settings),config:driver.decodeConfig(structuredClone(settings.config))});
    let closing;
    const close=()=>closing??=(async()=>{try{await provider.dispose();}finally{client.close();}})();
    try {
      signal.throwIfAborted();
      if(provider.instanceId!==settings.instanceId || provider.driverKind!==driver.driverKind ||
         provider.adapter?.provider!==driver.driverKind || typeof provider.dispose!=='function')
        throw Error('Constructed worker provider identity mismatch');
      return{runtime:createBoundWorkerRuntime({client,adapter:provider.adapter,binding:approved,input:turnInput()}),close};
    }catch(error){await close();throw error;}
  };
}
