import type {ChatMcpTransport} from '../drivers/chat-mcp-tools.ts';
interface BrowserLease {id:string;worker:string;generation:number;token:string;deadline:number}
export function createWorkerBrowserTransport(options:{
  job:{id:string;worker:string;generation:number};
  lease:BrowserLease;
  client:{browser(args:{lease:BrowserLease;operation:{id:string;method:string;params:unknown};signal:AbortSignal}):Promise<unknown>};
  isCurrent():boolean;
}):ChatMcpTransport;
