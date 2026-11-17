// The native service must own its job before a browser catalog can initialize.
// Defer mounting until its first tool-catalog request, not controller admission.
export function createLazyToolSession({open,signal,isCurrent}) {
  if(typeof open!=='function' || typeof isCurrent!=='function' || !signal)throw Error('Trusted lazy tool session required');
  let pending,session,closed=false,closing;
  const current=()=>{signal.throwIfAborted();if(closed || isCurrent()!==true)throw Error('Tool mount no longer current');};
  const ready=()=>{
    current();
    pending??=Promise.resolve().then(async()=>{
      current();const mounted=await open();session=mounted;
      if(closed || signal.aborted || isCurrent()!==true){await mounted.close();throw Error('Tool mount no longer current');}
      return mounted;
    });
    return pending;
  };
  return{
    async definitions(){return(await ready()).definitions();},
    async authorize(args){return(await ready()).authorize(args);},
    async dispatch(args){return(await ready()).dispatch(args);},
    hasRequest:id=>!closed && isCurrent()===true && session?.hasRequest(id)===true,
    respondToRequest(thread,id,decision){return !closed && isCurrent()===true && session ? session.respondToRequest(thread,id,decision):'unavailable';},
    close(){
      if(closing)return closing;closed=true;
      closing=(async()=>{if(pending){try{await pending;}catch{return;}await session?.close();}})();
      return closing;
    },
  };
}
