// A request can contain several provider turns. Bind each job to its live
// dispatch generation so returned teammate results cannot replay the first turn.
export function resolveOwnedWorkerTurn({botId,threadId,ownerBotId,claim,request,busy}) {
  const active=ownerBotId===botId && busy===true && claim?.botId===botId && claim.threadId===threadId &&
    claim.phase==='dispatching' && request?.stopped!==true && typeof request?.generation==='string' && request.generation===claim.id;
  return{bot:ownerBotId,thread:threadId,requestId:request?.generation,active};
}
