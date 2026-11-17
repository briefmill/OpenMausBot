export function resolveOwnedWorkerTurn(input: {
 botId: string; threadId: string; ownerBotId?: string; busy: boolean;
 claim?: { id: string; botId: string; threadId: string; phase: string };
 request?: { generation: string; messageId?: string; stopped?: boolean };
}): {bot: string|undefined; thread: string; requestId: string|undefined; active: boolean};
