import { expect,it } from "vitest";
import { replyContentSchema } from "./reply-draft";
import { socialPlatforms,socialSourceMatches } from "./social-reply";
const content={channel:"social",platform:"instagram",account:"Example business",conversation:"Example client",replyToId:"synthetic-inbound-1",kind:"message",sourceUrl:"https://www.instagram.com/direct/inbox/",text:"Thanks for reaching out."};
it("accepts inbound social reply drafts and requires a source on the same platform",()=>{
 expect(replyContentSchema.parse(content)).toEqual(content);
 expect(replyContentSchema.safeParse({...content,sourceUrl:"https://instagram.com.attacker.example/"}).success).toBe(false);
 expect(replyContentSchema.safeParse({...content,sourceUrl:"javascript:alert(1)"}).success).toBe(false);
 expect(replyContentSchema.safeParse({...content,sourceUrl:"https://www.linkedin.com/feed/"}).success).toBe(false);
 expect(replyContentSchema.safeParse({...content,replyToId:""}).success).toBe(false);
});
it("supports all declared platforms without accepting spoofed host names",()=>{
 const urls={instagram:"https://instagram.com/",facebook:"https://facebook.com/",messenger:"https://messenger.com/",linkedin:"https://linkedin.com/",x:"https://x.com/",youtube:"https://youtube.com/",tiktok:"https://tiktok.com/",threads:"https://threads.com/"};
 for(const platform of socialPlatforms){expect(socialSourceMatches(platform,urls[platform])).toBe(true);expect(socialSourceMatches(platform,"https://evil.example/?url="+urls[platform])).toBe(false);}
});
