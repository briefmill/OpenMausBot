const number = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('Invalid worker usage metric');
  return value;
};
const text = value => {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 60000) throw Error('Worker reply requires bounded artifact delivery');
  return value;
};
export function workerEventForController(event) {
  const result = Object.fromEntries(['eventId','type','threadId','turnId','requestId','provider','ok','requestType','createdAt','itemId']
    .filter(key => event[key] !== undefined).map(key => [key,event[key]]));
  if (event.type === 'item.completed' && event.itemType === 'assistant_text') {
    result.itemType = 'assistant_text'; result.text = text(event.text);
  }
  if (event.type === 'content.delta' && event.streamKind === 'assistant_text') {
    result.streamKind = 'assistant_text'; result.delta = text(event.delta);
  }
  if (event.type === 'turn.completed') {
    if (event.cost !== undefined) result.cost = event.cost === null ? null : number(event.cost);
    if (event.stopReason !== undefined) result.stopReason = event.stopReason === null ? null : text(event.stopReason);
    if (event.usage !== undefined) {
      result.usage = { input:number(event.usage.input), output:number(event.usage.output),
        ...(event.usage.cachedInput === undefined ? {} : { cachedInput:number(event.usage.cachedInput) }) };
    }
  }
  if (event.type === 'thread.token-usage.updated') {
    for (const key of ['input','output','cachedInput','contextTokens','contextWindow','reasoning'])
      if (event[key] !== undefined) result[key] = number(event[key]);
  }
  return result;
}
