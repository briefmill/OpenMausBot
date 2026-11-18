import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Mail, MessageSquare } from "lucide-react";
import type { MessageAttachmentContext } from "./AttachmentPreview";
import { AttachmentGallery } from "./AttachmentGallery";
import { api } from "@/state/store";
import type { ReplyContent, ReplyDraft } from "../../shared/reply-draft";

type Answer={draft:ReplyDraft;hash:string};
const field="w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
export function ReplyComposer({id,viewOnly=false,message}:{id:string;viewOnly?:boolean;message?:MessageAttachmentContext}) {
 const [saved,setSaved]=useState<Answer>();const [content,setContent]=useState<ReplyContent>();const [error,setError]=useState("");const [busy,setBusy]=useState(false);const inFlight=useRef(false);const savedRef=useRef(saved);const contentRef=useRef(content);savedRef.current=saved;contentRef.current=content;
 const dirty=Boolean(saved&&content&&JSON.stringify(saved.draft.content)!==JSON.stringify(content));
 const accept=(answer:Answer)=>{setSaved(answer);setContent(answer.draft.content);};
 const load=async()=>{try{accept(await api(`/api/reply-drafts/${id}`));setError("");}catch(cause){setError((cause as Error).message);}};
 useEffect(()=>{let cancelled=false;const refresh=async()=>{
   if(cancelled||inFlight.current||document.visibilityState!=="visible")return;
   try {
    const next:Answer=await api(`/api/reply-drafts/${id}`);if(cancelled||inFlight.current)return;
    const previous=savedRef.current,current=contentRef.current;
    if(previous&&previous.draft.revision!==next.draft.revision&&current&&JSON.stringify(current)!==JSON.stringify(previous.draft.content)){setError("This draft changed on another device. Copy your edits before reloading.");return;}
    if(!previous||previous.draft.revision!==next.draft.revision)accept(next);
   }catch(cause){if(!cancelled)setError((cause as Error).message);}
  };void refresh();const timer=setInterval(refresh,5000);return()=>{cancelled=true;clearInterval(timer);};},[id]);
 const run=async(action:"save"|"discard"|"send")=>{
  if(inFlight.current||!saved||!content)return;inFlight.current=true;setBusy(true);setError("");
  try {
   let current=saved;
   if(action==="discard")current=await api(`/api/reply-drafts/${id}`,{method:"PATCH",body:JSON.stringify({revision:current.draft.revision,discard:true})});
   else {
    if(dirty)current=await api(`/api/reply-drafts/${id}`,{method:"PATCH",body:JSON.stringify({revision:current.draft.revision,content:content.channel==="email"?{...content,...Object.fromEntries((["to","cc","bcc"] as const).map(key=>[key,content[key].map(value=>value.trim()).filter(Boolean)]))}:content})});
    if(action==="send")current=await api(`/api/reply-drafts/${id}/send`,{method:"POST",body:JSON.stringify({revision:current.draft.revision,hash:current.hash})});
   }
   accept(current);
  }catch(cause){setError((cause as Error).message);}finally{inFlight.current=false;setBusy(false);}
 };
 if(!saved||!content)return <div className="rounded-2xl bg-composer p-5 text-[13px] text-ink-secondary">{error||"Loading reply draft…"}</div>;
 const email=content.channel==="email";const Icon=email?Mail:MessageSquare;const locked=viewOnly||busy||saved.draft.state!=="draft";const patch=(values:Partial<ReplyContent>)=>{setContent({...content,...values} as ReplyContent);if(!error.includes("another device"))setError("");};
 const addresses=(value:string)=>value.split(",").map(item=>item.trimStart());
 return <section aria-label={email?"Email reply composer":"Slack reply composer"} className="w-full max-w-[640px] overflow-hidden rounded-2xl bg-composer p-5 text-ink ring-1 ring-composer-ring">
  <header className="mb-4 flex items-center gap-2 text-[14px] font-medium"><Icon size={18}/>{email?"Email":"Slack"}<span className="ml-auto text-[12px] text-ink-secondary">{dirty?"Unsaved changes":saved.draft.state==="draft"?"Draft saved":saved.draft.state.replaceAll("_"," ")}</span></header>
  {saved.draft.inbound&&<div className="mb-5 space-y-3 border-b border-hairline/50 pb-5">
   <div className="text-[12px] text-ink-secondary">Inbound message · copied by bot</div>
   <div className="text-[13px] font-medium">{saved.draft.inbound.sender}<span className="ml-2 font-normal text-ink-secondary">{saved.draft.inbound.sentAt}</span></div>
   <blockquote className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words border-l-2 border-hairline pl-3 text-[13px] leading-relaxed">{saved.draft.inbound.text||"Message contains attachments only."}</blockquote>
   {saved.draft.inbound.sourceUrl&&<a href={saved.draft.inbound.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent underline">Open original message</a>}
   <AttachmentGallery message={message} images={saved.draft.inbound.attachments.filter(file=>/\.(png|jpe?g|gif|webp|avif)$/i.test(file.path))} files={saved.draft.inbound.attachments.filter(file=>! /\.(png|jpe?g|gif|webp|avif)$/i.test(file.path))}/>
   {saved.draft.inbound.attachments.map(file=><p key={file.path} className="text-[12px] text-ink-secondary">{file.name} · {file.inspected?"Bot reports inspected":"Not inspected by bot"}</p>)}
   {saved.draft.inbound.interpretation&&<div className="rounded-lg bg-inset p-3"><div className="mb-1 text-[12px] font-medium">Bot’s interpretation</div><p className="whitespace-pre-wrap text-[13px] leading-relaxed">{saved.draft.inbound.interpretation}</p></div>}
  </div>}
  {saved.draft.state==="sent"?<p role="status" className="flex items-center gap-2 text-[13px]"><Check size={16}/>Sent · {saved.draft.receipt?.id}</p>:<>
   {email&&content.channel==="email"?<div className="mb-4 space-y-3">
    <label className="block text-[12px] text-ink-secondary">From<input aria-label="From" type="email" disabled={locked} className={field} value={content.from} onChange={event=>patch({from:event.target.value})}/></label>
    <label className="block text-[12px] text-ink-secondary">To<input aria-label="To" disabled={locked} className={field} value={content.to.join(", ")} onChange={event=>patch({to:addresses(event.target.value)})}/></label>
    <div className="grid grid-cols-2 gap-3">{(["cc","bcc"] as const).map(name=><label key={name} className="text-[12px] text-ink-secondary">{name.toUpperCase()}<input aria-label={name.toUpperCase()} disabled={locked} className={field} value={content[name].join(", ")} onChange={event=>patch({[name]:addresses(event.target.value)})}/></label>)}</div>
    <label className="block text-[12px] text-ink-secondary">Subject<input aria-label="Subject" disabled={locked} className={field} value={content.subject} onChange={event=>patch({subject:event.target.value})}/></label>
    {content.replyToUid&&<p className="text-[12px] text-ink-secondary">Reply to message {content.replyToUid} · {content.mailbox}</p>}
   </div>:<p className="mb-4 rounded-lg bg-inset p-3 text-[12px] text-ink-secondary">From {saved.draft.destination?.sender}<br/>Workspace {saved.draft.destination?.workspace} · Channel {saved.draft.destination?.channel}<br/>{saved.draft.destination?.thread?`Reply in thread ${saved.draft.destination.thread}`:"Post to channel"}</p>}
   <label className="block text-[12px] text-ink-secondary">Message<textarea aria-label="Reply message" disabled={locked} className={`${field} mt-1 min-h-[240px] resize-y leading-relaxed`} value={content.text} onChange={event=>patch({text:event.target.value})}/></label>
   {saved.draft.deliveryError&&<p role="alert" className="mt-3 text-[13px] text-danger">{saved.draft.deliveryError}</p>}
   {saved.draft.state==="delivery_unknown"&&<p role="alert" className="mt-3 text-[13px] text-warning">Delivery could not be confirmed. Check the destination before preparing another reply. Automatic retry is disabled.</p>}
   {!viewOnly&&saved.draft.state==="draft"&&<footer className="mt-4 flex flex-wrap items-center justify-end gap-3"><button disabled={busy} onClick={()=>void run("discard")} className="text-[13px] text-ink-secondary">Discard</button><button disabled={busy||!dirty||error.includes("another device")} onClick={()=>void run("save")} className="rounded-full border border-hairline px-4 py-2 text-[13px]">Save draft</button><button disabled={busy||!content.text.trim()||Boolean(error)} onClick={()=>void run("send")} className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-[13px] font-medium text-white">{busy&&<Loader2 size={14} className="animate-spin"/>}Send</button></footer>}
  </>}
  {error&&<div role="alert" className="mt-3 text-[13px] text-danger">{error}<button onClick={()=>void load()} className="ml-2 underline">Reload draft</button></div>}
 </section>;
}
