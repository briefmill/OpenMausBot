import { z } from "zod";
const header = z.string().trim().max(500).refine(value => !/[\r\n\0]/.test(value), "Headers cannot contain line breaks");
const address = header.pipe(z.email());
const recipients = z.array(address).max(50);
export const replyContentSchema = z.discriminatedUnion("channel", [
  z.object({channel:z.literal("email"),from:address,to:recipients.min(1),cc:recipients.default([]),bcc:recipients.default([]),subject:header.min(1),text:z.string().min(1).max(50_000),mailbox:header.default("INBOX"),replyToUid:z.number().int().positive().optional()}).strict(),
  z.object({channel:z.literal("slack"),frontDeskDraftId:z.uuid(),text:z.string().min(1).max(4000)}).strict(),
]);
export const replyInboundSchema = z.object({
  sender:z.string().min(1).max(500),
  sentAt:z.string().max(100).optional(),
  text:z.string().max(50_000),
  sourceUrl:z.url().refine(value=>new URL(value).protocol==="https:", "Use an HTTPS source link").optional(),
  interpretation:z.string().max(10_000).optional(),
  attachments:z.array(z.object({
    path:z.string().min(1).max(2000),name:z.string().min(1).max(500),
    inspected:z.boolean().default(false),
  }).strict()).max(10).default([]),
}).strict();
export type ReplyInbound = z.infer<typeof replyInboundSchema>;
export type ReplyContent = z.infer<typeof replyContentSchema>;
export interface ReplyDraft {
  id:string; botId:string; threadId:string; revision:number; content:ReplyContent;
  state:"draft"|"sending"|"sent"|"discarded"|"delivery_unknown";
  createdAt:number; updatedAt:number;
  destination?:{workspace:string;channel:string;thread?:string;sender:string;scope:string;hash:string};
  inbound?:ReplyInbound;
  deliveryError?:string;
  preview?:boolean;
  receipt?:{id:string;url?:string};
}
export interface ReplyDraftAnswer { draft:ReplyDraft }
