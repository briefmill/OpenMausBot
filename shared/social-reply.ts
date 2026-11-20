import { z } from "zod";
export const socialPlatforms = ["instagram","facebook","messenger","linkedin","x","youtube","tiktok","threads"] as const;
export type SocialPlatform = typeof socialPlatforms[number];
export const socialLabels: Record<SocialPlatform,string> = {instagram:"Instagram",facebook:"Facebook",messenger:"Messenger",linkedin:"LinkedIn",x:"X",youtube:"YouTube",tiktok:"TikTok",threads:"Threads"};
const hosts: Record<SocialPlatform,readonly string[]> = {instagram:["instagram.com"],facebook:["facebook.com"],messenger:["messenger.com","facebook.com"],linkedin:["linkedin.com"],x:["x.com","twitter.com"],youtube:["youtube.com","youtu.be"],tiktok:["tiktok.com"],threads:["threads.net","threads.com"]};
export function socialSourceMatches(platform:SocialPlatform,url:string) {
 try {const parsed=new URL(url);return parsed.protocol==="https:"&&!parsed.username&&!parsed.password&&(!parsed.port||parsed.port==="443")&&hosts[platform].some(host=>parsed.hostname===host||parsed.hostname.endsWith("."+host));}catch{return false;}
}
export const socialReplySchema = z.object({
 channel:z.literal("social"),platform:z.enum(socialPlatforms),
 account:z.string().trim().min(1).max(300),conversation:z.string().trim().min(1).max(500),
 replyToId:z.string().trim().min(1).max(500),kind:z.enum(["message","comment"]),
 sourceUrl:z.url().max(2000),text:z.string().min(1).max(4000),
}).strict().refine(value=>socialSourceMatches(value.platform,value.sourceUrl),{message:"Use an HTTPS original-message link on the selected social platform",path:["sourceUrl"]});
