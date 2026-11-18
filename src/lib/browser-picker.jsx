import { readPickerDraft as draftReader } from "./browser-picker-draft";
import React from 'react';
import{createRoot}from'react-dom/client';
import{Button}from'@astryxdesign/core/Button';
import{HStack}from'@astryxdesign/core/HStack';
import{Text}from'@astryxdesign/core/Text';
import reset from'@astryxdesign/core/reset.css?inline';import core from'@astryxdesign/core/astryx.css?inline';
const css=reset.replaceAll(':root',':host')+core.replaceAll(':root',':host')+':host{position:relative;display:inline-flex;color-scheme:inherit;color:inherit}button{color:inherit}';
const receivers=new Map(),viewports=new Map();
export function browserMessage(key,message){if(message.type==='viewport')viewports.set(key,{width:message.width,height:message.height});receivers.get(key)?.(message);}
const icon=<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 8l9 5-5 1-1 5z"/></svg>;
export function mountBrowserPicker(host,read){
 const shadow=host.shadowRoot ?? host.attachShadow({mode:'open'}),style=document.createElement('style');style.textContent=css;shadow.append(style);const buttonMount=document.createElement('omb-annotation-button');shadow.append(buttonMount);const root=createRoot(buttonMount);let alive=true,active=false,busy=false,target=null,outline=null,status=null,statusRoot=null,request=null,hover=null,pending=false,last=0,starting=0;
 const key=read().scopeKey;
 function notice(text) {
  if (!status) {
   status = document.createElement('omb-browser-picker-status');
   const statusShadow = status.attachShadow({mode:'open'});
   const statusStyle = document.createElement('style');
   statusStyle.textContent = css + `:host {
    position:absolute;
    inset-block-end:calc(100% + var(--spacing-2));
    inset-inline-start:0;
    z-index:20;
    inline-size:max-content;
    max-inline-size:var(--container-2xs, 16rem);
    background:var(--color-card);
    color:var(--color-ink);
    border:1px solid var(--color-hairline);
    border-radius:var(--radius-lg);
    padding:var(--spacing-3);
    box-shadow:var(--shadow-high);
   }`;
   statusShadow.append(statusStyle);
   statusRoot = createRoot(statusShadow);
   shadow.append(status);
  }
  statusRoot.render(<HStack gap={2} vAlign="center">
   <Text role="status" aria-live="polite" style={{color:"var(--color-ink)"}}>{text}</Text>
   <Button label={active ? 'Cancel' : 'Dismiss'} size="sm" variant="secondary" onClick={() => { cancel(); clearNotice(); }}/>
  </HStack>);
 }
 function clearNotice(){statusRoot?.unmount();status?.remove();status=statusRoot=null;}
 function render() {
  if (!alive) return;
  const label = active ? 'Cancel webpage selection' : 'Select webpage element';
  root.render(<Button
   className="annotation-toolbar-button"
   style={{
    minBlockSize: 'calc(var(--spacing) * 9)',
    borderRadius: 'var(--radius-lg)',
    border: active ? '1px solid var(--color-accent-border)' : '1px solid var(--color-hairline)',
    background: active ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'transparent',
    color: active ? 'var(--color-accent-text)' : 'var(--color-ink-secondary)',
   }}
   aria-label={label} aria-pressed={active} label="Annotate"
   title={active ? 'Annotation mode on. Click to cancel, or press Escape.' : 'Select a webpage element and attach its screenshot'}
   icon={icon} variant="secondary" size="md" isLoading={busy}
   onClick={() => { if (active) { cancel(); clearNotice(); } else void start(); }}
  />);
 }
 function cancel(keepBusy=false){if(!keepBusy)busy=false;active=false;starting++;target=null;hover=null;request=null;pending=false;outline?.remove();outline=null;document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',down,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',cancel);render();}
 function escape(e){if(e.key==='Escape'&&active){e.preventDefault();e.stopImmediatePropagation();cancel();clearNotice();}}
 function point(e){const canvas=read().surface(),v=viewports.get(key);if(!canvas||!v||e.target!==canvas)return null;const b=canvas.getBoundingClientRect(),scale=Math.min(b.width/canvas.width,b.height/canvas.height),w=canvas.width*scale,h=canvas.height*scale,left=b.left+(b.width-w)/2,top=b.top+(b.height-h)/2;const x=(e.clientX-left)*v.width/w,y=(e.clientY-top)*v.height/h;return x>=0&&y>=0&&x<v.width&&y<v.height?{x,y,b,left,top,w,h,v}:null;}
 function show(element){const canvas=read().surface(),v=viewports.get(key);if(!canvas||!v||!element?.rect)return;const b=canvas.getBoundingClientRect(),scale=Math.min(b.width/canvas.width,b.height/canvas.height),w=canvas.width*scale,h=canvas.height*scale,left=b.left+(b.width-w)/2,top=b.top+(b.height-h)/2,r=element.rect;if(!outline){outline=document.createElementNS('http://www.w3.org/2000/svg','svg');outline.setAttribute('aria-hidden','true');Object.assign(outline.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'2147483646',color:'Highlight'});const rect=document.createElementNS(outline.namespaceURI,'rect');rect.setAttribute('fill','none');rect.setAttribute('stroke','currentColor');rect.setAttribute('stroke-width','2');outline.append(rect);document.body.append(outline);}for(const[k,value]of Object.entries({x:left+r.x*w/v.width,y:top+r.y*h/v.height,width:r.width*w/v.width,height:r.height*h/v.height}))outline.firstChild.setAttribute(k,String(value));}
 function issue(p,capture){const id=crypto.randomUUID();request={id,capture,draft:draftReader?.(),draftId:draftReader?.().draftId};pending=true;read().send({type:'ombElementInspect',requestId:id,x:p.x,y:p.y,capture,...hover?.document?{document:hover.document}:{}});}
 function move(e){if(!active||busy)return;const p=point(e);if(!p){outline?.remove();outline=null;return;}target=p;if(!pending&&performance.now()-last>100){last=performance.now();issue(p,false);}}
 function down(e){if(active&&point(e)){e.preventDefault();e.stopImmediatePropagation();}}
 function click(e){const p=point(e);if(!active||!p||busy)return;e.preventDefault();e.stopImmediatePropagation();const draft=draftReader?.();if(!draft?.allowImages){notice('This model does not accept image attachments.');return;}if(draft.recording){notice('Finish dictation before selecting an element.');return;}if(draft.imageSlots!==undefined&&draft.imageSlots<1){notice('Remove an image attachment before adding a selection.');return;}busy=true;issue(p,true);render();}
 async function receive(message){if(message.type==='nav'||message.type==='tabs'||message.type==='url'){let next=message.url;if(message.type==='tabs')next=message.tabs?.find(tab=>tab.active)?.url;try{if(next){const u=new URL(next);u.search='';u.hash='';u.username='';u.password='';next=u.href;}}catch{next=null;}if(active&&hover&&next&&next!==hover.url){cancel();notice('The browser page changed. Start selection again.');}return;}if(message.type!=='ombElementInspection'||!request||message.requestId!==request.id)return;const job=request;pending=false;request=null;if(message.error){if(job.capture){busy=false;notice(message.error);render();}return;}if(!active)return;hover=message.element;show(hover);if(!job.capture)return;const current=draftReader?.();if(!message.image||!current||current.draftId!==job.draftId){busy=false;cancel();notice('The conversation changed. Select the element again.');return;}try{const data=Uint8Array.from(atob(message.image),c=>c.charCodeAt(0));if(data.length>Math.min(8000000,current.imageBytes??8000000))throw Error('Select a smaller element.');const element=message.element;cancel(true);await current.onFiles([new File([data],'browser-selected-element.png',{type:'image/png'})]);const latest=draftReader?.();if(latest?.draftId===job.draftId){const context='[Selected browser element]\n'+element.url+'\n'+element.tag+': '+element.selector+(element.label?'\n'+element.label:'');latest.onText(latest.getText()+(latest.getText()?'\n\n':'')+context);}notice('Webpage element added to your draft. Review it before sending.');}catch(error){notice(error.message||'Element capture failed.');}finally{busy=false;render();}}
 async function start(){const props=read(),d=draftReader?.();if(!props.connected||!props.surface()){notice('Wait for the browser page to load.');return;}if(!d){notice('Open the conversation before selecting an element.');return;}if(d.recording){notice('Finish dictation before selecting an element.');return;}const run=++starting;if(props.control?.controller!=='you'){props.take();for(let i=0;i<100&&alive&&run===starting&&read().control?.controller!=='you';i++)await new Promise(r=>setTimeout(r,100));}if(!alive||run!==starting)return;if(read().control?.controller!=='you'){notice('Take control of this browser before selecting an element.');return;}active=true;document.addEventListener('pointermove',move,true);document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',down,true);document.addEventListener('click',click,true);document.addEventListener('keydown',escape,true);window.addEventListener('resize',cancel);notice('Select an element on the webpage. Escape cancels.');render();}
 receivers.set(key,receive);render();return()=>{alive=false;cancel();clearNotice();if(receivers.get(key)===receive)receivers.delete(key);root.unmount();buttonMount.remove();style.remove();};
}
