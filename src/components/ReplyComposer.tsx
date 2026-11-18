import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEventHandler, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, Mail } from "lucide-react";
import { socialLabels } from "../../shared/social-reply";
import { emailProvider, type EmailProvider } from "../../shared/email-provider";
import type { MessageAttachmentContext } from "./AttachmentPreview";
import { AttachmentGallery } from "./AttachmentGallery";
import { api } from "@/state/store";
import type { ReplyContent, ReplyDraft } from "../../shared/reply-draft";

type Answer={draft:ReplyDraft;hash:string;emailProvider?:EmailProvider};
const field="w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
function SignaturePreview({html}:{html:string}) {
 const [height,setHeight]=useState(60);const observer=useRef<ResizeObserver|undefined>(undefined);
 useEffect(()=>()=>observer.current?.disconnect(),[]);
 return <iframe title="Email signature preview" sandbox="allow-same-origin" referrerPolicy="no-referrer" className="w-full rounded-lg border-0 bg-transparent" style={{height}} onLoad={event=>{observer.current?.disconnect();const body=event.currentTarget.contentDocument?.body;if(!body)return;const resize=()=>setHeight(Math.min(320,Math.max(44,Math.ceil(body.getBoundingClientRect().height)+16)));resize();observer.current=new ResizeObserver(resize);observer.current.observe(body);}} srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>body{margin:8px;font:13px sans-serif;color:#d4d4d4;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#bdbdbd}</style>${html}`}/>;
}
function ReplyBody({value,disabled,onChange,onPaste,label="Reply message"}:{value:string;disabled:boolean;onChange:(value:string)=>void;onPaste?:ClipboardEventHandler<HTMLTextAreaElement>;label?:string}) {
 const ref=useRef<HTMLTextAreaElement>(null);
 const resize=()=>{const node=ref.current;if(!node)return;node.style.height="0px";const height=Math.max(60,Math.min(node.scrollHeight,420));node.style.height=`${height}px`;node.style.overflowY=node.scrollHeight>420?"auto":"hidden";};
 useLayoutEffect(resize,[value]);
 useEffect(()=>{const node=ref.current;if(!node)return;let width=node.getBoundingClientRect().width;const observer=new ResizeObserver(()=>{const next=node.getBoundingClientRect().width;if(next!==width){width=next;resize();}});observer.observe(node);return()=>observer.disconnect();},[]);
 return <textarea ref={ref} aria-label={label} rows={1} disabled={disabled} className={`${field} min-h-[60px] resize-none leading-relaxed`} value={value} onPaste={onPaste} onChange={event=>onChange(event.target.value)}/>;
}
export function ReplyComposer({id,viewOnly=false,message,actions}:{id:string;viewOnly?:boolean;message?:MessageAttachmentContext;actions?:(text:string)=>ReactNode}) {
 const [detailsOpen,setDetailsOpen]=useState(false);
 const [signatureOpen,setSignatureOpen]=useState(false);
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
 const run=async(action:"save"|"discard"|"send"|"signature")=>{
  if(inFlight.current||!saved||!content)return;inFlight.current=true;setBusy(true);setError("");
  try {
   let current=saved;
   if(action==="discard")current=await api(`/api/reply-drafts/${id}`,{method:"PATCH",body:JSON.stringify({revision:current.draft.revision,discard:true})});
   else {
    if(dirty||action==="signature")current=await api(`/api/reply-drafts/${id}`,{method:"PATCH",body:JSON.stringify({revision:current.draft.revision,...(action==="signature"?{saveSignature:true}:{}),content:content.channel==="email"?{...content,...Object.fromEntries((["to","cc","bcc"] as const).map(key=>[key,content[key].map(value=>value.trim()).filter(Boolean)]))}:content})});
    if(action==="send")current=await api(`/api/reply-drafts/${id}/send`,{method:"POST",body:JSON.stringify({revision:current.draft.revision,hash:current.hash})});
   }
   accept(current);
  }catch(cause){setError((cause as Error).message);}finally{inFlight.current=false;setBusy(false);}
 };
 if(!saved||!content)return <div className="rounded-2xl bg-composer p-5 text-[13px] text-ink-secondary">{error||"Loading reply draft…"}</div>;
 const email=content.channel==="email";const locked=viewOnly||busy||saved.draft.state!=="draft";const patch=(values:Partial<ReplyContent>)=>{setContent({...content,...values} as ReplyContent);if(!error.includes("another device"))setError("");};
 const senderChanged=content.channel==="email"&&saved.draft.content.channel==="email"&&content.from.toLowerCase()!==saved.draft.content.from.toLowerCase();
 const addresses=(value:string)=>value.split(",").map(item=>item.trimStart());
 const provider=content.channel==="email"?(!senderChanged&&saved.emailProvider||emailProvider(content.from)):content.channel==="social"?content.platform:"slack";
 const providerLabel=provider==="gmail"?"Gmail":provider==="outlook"?"Outlook":provider==="slack"?"Slack":content.channel==="social"?socialLabels[content.platform]:"Mail";
 return <section aria-label={email?"Email reply composer":content.channel==="social"?"Social reply composer":"Slack reply composer"} className="reply-composer w-full max-w-[640px] overflow-hidden rounded-2xl bg-composer p-4 text-ink ring-1 ring-composer-ring">
  <header className="mb-3 flex items-center gap-2 text-[14px] font-medium"><span className="flex size-5 shrink-0 items-center justify-center">{provider==="email"?<Mail size={18} aria-hidden="true"/>:<img src={`/app-logos/${provider}.svg`} alt="" width={18} height={18}/>}</span>{providerLabel}<span className="ml-auto text-[12px] text-ink-secondary">{dirty?"Unsaved changes":saved.draft.state==="draft"?"Draft saved":saved.draft.state.replaceAll("_"," ")}</span></header>
  {saved.draft.preview&&<p className="mb-3 text-[12px] text-ink-secondary">Synthetic preview · sending disabled</p>}
  {saved.draft.inbound&&<div className="mb-3 space-y-2 border-b border-hairline/50 pb-3">
   <div className="text-[12px] text-ink-secondary">Inbound message · <span className="font-medium text-ink">{saved.draft.inbound.sender}</span> · {saved.draft.inbound.sentAt} · copied by bot</div>
   <blockquote className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words border-l-2 border-hairline pl-3 text-[13px] leading-relaxed">{saved.draft.inbound.text||"Message contains attachments only."}</blockquote>
   {saved.draft.inbound.sourceUrl&&<a href={saved.draft.inbound.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent underline">Open original message</a>}
   <AttachmentGallery message={message} images={saved.draft.inbound.attachments.filter(file=>/\.(png|jpe?g|gif|webp|avif)$/i.test(file.path))} files={saved.draft.inbound.attachments.filter(file=>! /\.(png|jpe?g|gif|webp|avif)$/i.test(file.path))}/>
   {saved.draft.inbound.attachments.map(file=><p key={file.path} className="text-[12px] text-ink-secondary">{file.name} · {file.inspected?"Bot reports inspected":"Not inspected by bot"}</p>)}
   {saved.draft.inbound.interpretation&&<details className="text-[12px] text-ink-secondary"><summary className="cursor-pointer">Bot’s interpretation</summary><p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{saved.draft.inbound.interpretation}</p></details>}
  </div>}
  {saved.draft.state==="sent"?<p role="status" className="flex items-center gap-2 text-[13px]"><Check size={16}/>Sent · {saved.draft.receipt?.id}</p>:<>
   {email&&content.channel==="email"?<div className="mb-3 space-y-2">
    {!detailsOpen&&<div className="space-y-1 break-words text-[13px]">
      <p className="font-medium">{content.subject}</p>
      <p><span className="text-ink-secondary">From </span>{content.from}</p>
      <p><span className="text-ink-secondary">To </span>{content.to.join(", ")}</p>
      {content.cc.length>0&&<p><span className="text-ink-secondary">Cc </span>{content.cc.join(", ")}</p>}
      {content.bcc.length>0&&<p><span className="text-ink-secondary">Bcc </span>{content.bcc.join(", ")}</p>}
    </div>}
    <button type="button" aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(open=>!open)} className="flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink"><ChevronDown size={12} className={detailsOpen?"rotate-180":""}/>{detailsOpen?"Hide details":"Edit details"}</button>
    {detailsOpen&&<div className="space-y-2">
    <label className="block text-[12px] text-ink-secondary">From<input aria-label="From" type="email" disabled={locked} className={field} value={content.from} onChange={event=>patch({from:event.target.value,signature:undefined})}/></label>
    <label className="block text-[12px] text-ink-secondary">To<input aria-label="To" disabled={locked} className={field} value={content.to.join(", ")} onChange={event=>patch({to:addresses(event.target.value)})}/></label>
    <div className="grid grid-cols-2 gap-3">{(["cc","bcc"] as const).map(name=><label key={name} className="text-[12px] text-ink-secondary">{name.toUpperCase()}<input aria-label={name.toUpperCase()} disabled={locked} className={field} value={content[name].join(", ")} onChange={event=>patch({[name]:addresses(event.target.value)})}/></label>)}</div>
    <label className="block text-[12px] text-ink-secondary">Subject<input aria-label="Subject" disabled={locked} className={field} value={content.subject} onChange={event=>patch({subject:event.target.value})}/></label>
    {content.replyToUid&&<p className="text-[12px] text-ink-secondary">Reply to message {content.replyToUid} · {content.mailbox}</p>}
    </div>}
   </div>:content.channel==="social"?<div className="mb-3 text-[12px] text-ink-secondary"><p>{content.kind==="comment"?"Reply to comment":"Direct message"} · {content.conversation} · From {content.account}</p><a className="underline" href={content.sourceUrl} target="_blank" rel="noopener noreferrer">Open original {socialLabels[content.platform]} {content.kind}</a><p className="mt-2">Sending is not connected. Copy your reply to use it on {socialLabels[content.platform]}.</p></div>:<p className="mb-3 break-words text-[12px] text-ink-secondary">#{saved.draft.destination?.channel} · {saved.draft.destination?.workspace} · From {saved.draft.destination?.sender}{saved.draft.destination?.thread&&<> · Reply in thread {saved.draft.destination.thread}</>}</p>}
   <ReplyBody value={content.text} disabled={locked} onChange={text=>patch({text})}/>
   {content.channel==="email"&&<div aria-label="Email signature" className="mt-3 text-[12px] text-ink-secondary">
    {content.signature?.html ? <SignaturePreview html={content.signature.html}/> : content.signature?.text ? <div aria-label="Signature preview" className="whitespace-pre-wrap break-words border-l-2 border-hairline pl-3 text-[13px] leading-relaxed text-ink">{content.signature.text}</div> : <p>{senderChanged?"Save draft to load this account’s signature.":"Default signature unavailable for this account."}</p>}
    {!viewOnly&&saved.draft.state==="draft"&&<>
     <button type="button" disabled={locked} aria-expanded={signatureOpen} onClick={()=>setSignatureOpen(open=>!open)} className="mt-2 hover:text-ink">{signatureOpen?"Hide signature editor":content.signature?"Edit signature":"Add signature"}</button>
     {signatureOpen&&<div className="mt-2 space-y-2"><label className="block">Signature<ReplyBody label="Signature text" onPaste={event=>{const html=event.clipboardData.getData("text/html"),text=event.clipboardData.getData("text/plain");if(html){event.preventDefault();patch({signature:{text,html}});}}} value={content.signature?.text??""} disabled={locked} onChange={text=>patch({signature:{text}})}/></label><p>Paste your signature from mail settings to keep formatting and images. Typing replaces it with plain text.</p><button type="button" disabled={locked||!content.signature?.text.trim()||Boolean(saved.draft.preview)} onClick={()=>void run("signature")} className="underline">Save as this account’s default</button></div>}
    </>}
   </div>}
   {saved.draft.deliveryError&&<p role="alert" className="mt-3 text-[13px] text-danger">{saved.draft.deliveryError}</p>}
   {saved.draft.state==="delivery_unknown"&&<p role="alert" className="mt-3 text-[13px] text-warning">Delivery could not be confirmed. Check the destination before preparing another reply. Automatic retry is disabled.</p>}
   {!viewOnly&&saved.draft.state==="draft"&&<footer className="mt-3 flex flex-wrap items-center justify-end gap-3"><button disabled={busy} onClick={()=>void run("discard")} className="text-[13px] text-ink-secondary">Discard</button><button disabled={busy||!dirty||error.includes("another device")} onClick={()=>void run("save")} className="rounded-full border border-hairline px-4 py-2 text-[13px]">Save draft</button><button disabled={content.channel==="social"||Boolean(saved.draft.preview)||senderChanged||busy||!content.text.trim()||Boolean(error)} onClick={()=>void run("send")} className="flex items-center gap-2 rounded-full reply-send px-5 py-2 text-[13px] font-medium">{busy&&<Loader2 size={14} className="animate-spin"/>}Send</button></footer>}
  </>}
  {actions&&<div className="mt-3 border-t border-hairline/50 pt-2">{actions(content.channel==="email"&&content.signature?.text?`${content.text}\n\n${content.signature.text}`:content.text)}</div>}
  {error&&<div role="alert" className="mt-3 text-[13px] text-danger">{error}<button onClick={()=>void load()} className="ml-2 underline">Reload draft</button></div>}
 </section>;
}
