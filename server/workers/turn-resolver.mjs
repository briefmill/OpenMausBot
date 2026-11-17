// Resolve from live controller ownership, never from a stored message's role.
export function resolveOwnedWorkerTurn({botId,threadId,ownerBotId,claim,request,busy}) {
  const active=ownerBotId===botId && busy===true && claim?.botId===botId && claim.threadId===threadId &&
    claim.phase==='dispatching' && request?.stopped!==true && typeof request?.generation==='string' && request.generation===claim.id;
  return{bot:ownerBotId,thread:threadId,requestId:request?.messageId??request?.generation,active};
}
