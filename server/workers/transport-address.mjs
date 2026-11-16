export const validWorkerHost=host=>typeof host==='string' && host.length<=253 &&
  host.split('.').every(label=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));

// Remote endpoints are a trusted bootstrap choice and require pinned mTLS.
export function validWorkerOrigin(origin,allowRemote=false) {
  if(typeof origin!=='string')return false;
  const match=/^(https?):\/\/([^/:]+):([0-9]{1,5})$/.exec(origin);
  return !!match && Number(match[3])>0 && Number(match[3])<=65535 && validWorkerHost(match[2]) &&
    (match[2]==='127.0.0.1' || (allowRemote===true && match[1]==='https'));
}
