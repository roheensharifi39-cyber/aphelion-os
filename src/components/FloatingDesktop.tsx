import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, MessageSquare, Send, Square, Settings2 } from 'lucide-react';
import type { Agent, ChatGPTModel, GeneratedImage, GPTSession, Message, Note, OpenAIStatus, Session, WindowLayout, Workspace } from '../types';
import { api } from '../lib/bridge';
import { newWindowLayout, readImage, storeImage } from '../lib/desktop';
import { vaultKey } from '../lib/workspace';
import { FloatingWindow } from './FloatingWindow';
import { Markdown } from './Markdown';
const ChatGPTConnection = lazy(() => import('./ChatGPTConnection').then(module => ({default:module.ChatGPTConnection})));
function chatConnectionReady(session:GPTSession,status:OpenAIStatus|null):boolean { if(!status)return false;return session.mode==='image'?(session.imageSource==='api'?status.configured:!!(status.codex?.connected&&status.codex.available)):(session.chatSource==='api'?status.configured:!!status.subscription?.connected); }

type Props = { launches:string[]; launched:(ids:string[])=>void; missionBusy: boolean; workspace:Workspace; update:(update:(workspace:Workspace)=>Workspace)=>void; pending:Record<string,string>; contexts:string[]; notes:Note[]; send:(prompt:string,agent:Agent,mode:'chat'|'plan'|'build',sessionId:string)=>void; stop:(id:string)=>void; openSession:(id:string)=>void; busy:(count:number)=>void; refresh:()=>Promise<void>; notify:(text:string)=>void };
type Chat = Session | GPTSession;
const providerName = (session:Chat) => 'agent' in session ? session.agent==='claude'?'Claude':'Codex' : 'ChatGPT';
export function FloatingDesktop(p:Props) {
  const [connection,setConnection]=useState<OpenAIStatus|null>(null),[connectionError,setConnectionError]=useState(''),[connectionWindow,setConnectionWindow]=useState<string|null>(null);
  const [subscriptionModels,setSubscriptionModels]=useState<ChatGPTModel[]>([]);
  const [imageSources,setImageSources]=useState<Record<string,string>>({}),[imageErrors,setImageErrors]=useState<Record<string,string>>({});
  const [contextWindow,setContextWindow]=useState<string|null>(null);
  const [gptPending,setGptPending]=useState<Record<string,string>>({});
  const handledLaunches=useRef(new Set<string>());
  const requests=useRef(new Map<string,{sessionId:string;requestId:string;messageId:string;scope:string;text:string}>()), mounted=useRef(true),latest=useRef(p);latest.current=p;
  const key=vaultKey(p.workspace.vaultPath||'');
  const refreshConnection=useCallback(async()=>{try{const value=await api.openaiStatus();if(mounted.current){setConnection(value);setConnectionError('');}}catch(error){if(mounted.current)setConnectionError((error as Error).message);}},[]);
  useEffect(()=>{mounted.current=true;void refreshConnection();return()=>{mounted.current=false;latest.current.busy(0);};},[refreshConnection]);
  useEffect(()=>{if(!connection?.subscription?.connecting)return;const timer=setInterval(()=>void refreshConnection(),1500);return()=>clearInterval(timer);},[connection?.subscription?.connecting,refreshConnection]);
  useEffect(()=>{let live=true;setSubscriptionModels([]);if(connection?.subscription?.connected)void api.chatGPTModels().then(models=>{if(live)setSubscriptionModels(models);}).catch(()=>{});return()=>{live=false;};},[connection?.subscription?.connected,connection?.subscription?.account]);
  useEffect(()=>api.onDelta(({requestId,delta})=>{const job=[...requests.current.values()].find(entry=>entry.requestId===requestId);if(!job||!mounted.current)return;job.text+=delta;latest.current.update(workspace=>vaultKey(workspace.vaultPath||'')!==job.scope?workspace:{...workspace,gptSessions:workspace.gptSessions?.map(session=>session.id===job.sessionId?{...session,messages:session.messages.map(message=>message.id===job.messageId?{...message,content:job.text}:message)}:session)});}),[]);
  useEffect(()=>{let live=true;for(const image of p.workspace.imageWindows||[])if(!imageSources[image.id])void readImage(key,image.id).then(value=>{if(!live)return;if(value)setImageSources(previous=>({...previous,[image.id]:value.src}));else setImageErrors(previous=>({...previous,[image.id]:'This image is no longer in device storage.'}));}).catch(error=>{if(live)setImageErrors(previous=>({...previous,[image.id]:error.message}));});return()=>{live=false;};},[key,p.workspace.imageWindows,imageSources]);
  const updateChat=(id:string,change:(session:Chat)=>Chat)=>p.update(workspace=>({...workspace,sessions:workspace.sessions.map(session=>session.id===id?change(session) as Session:session),gptSessions:workspace.gptSessions?.map(session=>session.id===id?change(session) as GPTSession:session)}));
  const windowChange=(id:string,layout:WindowLayout)=>p.update(workspace=>{ const merge=(current?:WindowLayout)=>({...layout,order:Math.max(layout.order,current?.order||0)}); return {...workspace,sessions:workspace.sessions.map(session=>session.id===id?{...session,window:merge(session.window)}:session),gptSessions:workspace.gptSessions?.map(session=>session.id===id?{...session,window:merge(session.window)}:session),imageWindows:workspace.imageWindows?.map(image=>image.id===id?{...image,window:merge(image.window)}:image)}; });
  const focus=(id:string)=>p.update(workspace=>{
    const all=[...workspace.sessions,...(workspace.gptSessions||[]),...(workspace.imageWindows||[])];
    const top=all.reduce((max,item)=>Math.max(max,item.window?.order||0),0);
    const item=all.find(item=>item.id===id);if(item?.window?.order===top)return workspace;
    const raise=(layout:WindowLayout)=>({...layout,order:top+1});
    return {...workspace,sessions:workspace.sessions.map(session=>session.id===id&&session.window?{...session,window:raise(session.window)}:session),gptSessions:workspace.gptSessions?.map(session=>session.id===id?{...session,window:raise(session.window)}:session),imageWindows:workspace.imageWindows?.map(image=>image.id===id?{...image,window:raise(image.window)}:image)};
  });
  const showImage=useCallback((id:string)=>latest.current.update(workspace=>({...workspace,imageWindows:workspace.imageWindows?.map(image=>image.id===id?{...image,window:{...image.window,open:true,minimized:false,order:Date.now()}}:image)})),[]);
  async function sendGPT(session:GPTSession){
    const prompt=session.draft.trim();if(!prompt||requests.current.has(session.id))return;
    if(!chatConnectionReady(session,connection)){setConnectionWindow(session.id);void refreshConnection();return;}
    const requestId=crypto.randomUUID(),messageId=crypto.randomUUID(),scope=key;
    requests.current.set(session.id,{sessionId:session.id,requestId,messageId,scope,text:''});p.busy(requests.current.size);setGptPending(previous=>({...previous,[session.id]:requestId}));
    const messages:Message[]=[...session.messages,{id:crypto.randomUUID(),role:'user',content:prompt},{id:messageId,role:'assistant',content:'',pending:true}];
    updateChat(session.id,current=>({...current,draft:'',title:!current.messages.length && ['New ChatGPT chat','New image studio'].includes(current.title)?prompt.slice(0,48):current.title,messages}));
    const patch=(change:Partial<Message>,memoryPath?:string)=>{if(!mounted.current)return;latest.current.update(workspace=>vaultKey(workspace.vaultPath||'')!==scope?workspace:{...workspace,gptSessions:workspace.gptSessions?.map(current=>current.id===session.id?{...current,memoryPath:memoryPath||current.memoryPath,messages:current.messages.map(message=>message.id===messageId?{...message,...change}:message)}:current)});};
    try{
      if(session.mode==='image'){
        const image=await api.generateImage({requestId,prompt,source:session.imageSource||'codex'});if(!mounted.current)return;
        if(!/^data:image\/(png|jpeg|webp);base64,/.test(image.src))throw new Error('The image service returned an unsupported image.');
        setImageSources(previous=>({...previous,[image.id]:image.src}));
        try{await storeImage(scope,image);}catch(error){latest.current.notify((error as Error).message);}
        latest.current.update(workspace=>vaultKey(workspace.vaultPath||'')!==scope?workspace:{...workspace,imageWindows:[...(workspace.imageWindows||[]),{id:image.id,prompt:image.prompt,created:image.created,window:{...newWindowLayout((workspace.imageWindows||[]).length+2),width:420,height:450}}]});
        patch({content:'Image created. Open the preview to move it, download it, or remove it from the screen.',imageId:image.id,pending:false});
      }else{
        const result=await api.openaiChat({requestId,source:session.chatSource||'subscription',model:session.model,messages:messages.filter(message=>!message.pending&&!message.error).map(({role,content})=>({role,content})),contextPaths:session.contextPaths || p.contexts,previousMemoryPath:session.memoryPath});
        patch({content:result.text,pending:false},result.memoryPath);if(result.memoryWarning)latest.current.notify(result.memoryWarning);if(mounted.current)await latest.current.refresh();
      }
    }catch(error){const partial=requests.current.get(session.id)?.text||'';patch({content:partial+(partial?'\n\n':'')+(error as Error).message,pending:false,error:true});}
    finally{requests.current.delete(session.id);if(mounted.current){setGptPending(previous=>{const next={...previous};delete next[session.id];return next;});latest.current.busy(requests.current.size);}}
  }
  useEffect(()=>{
    if(p.missionBusy||(!connection&&!connectionError))return;
    const ready=p.launches.filter(id=>!handledLaunches.current.has(id));
    for(const id of ready){
      handledLaunches.current.add(id);
      const session=p.workspace.gptSessions?.find(session=>session.id===id);
      if(session)void sendGPT(session);
    }
    if(ready.length)p.launched(ready);
  },[p.launches,p.missionBusy,connection,connectionError]);
  const chats:Chat[]=[...p.workspace.sessions.filter(session=>session.window),...(p.workspace.gptSessions||[])];
  const visible=[...chats.filter(session=>session.window?.open),...(p.workspace.imageWindows||[]).filter(image=>image.window.open)].sort((a,b)=>(a.window?.order||0)-(b.window?.order||0));
  const rank=(id:string)=>visible.findIndex(item=>item.id===id);
  return <div className="floating-desktop">
    {!!chats.length&&<div className="desktop-session-tray" aria-label="Saved chat windows">{chats.map(session=><button key={session.id} aria-label={`Open saved ${providerName(session)} chat ${session.title}`} aria-pressed={!!session.window?.open&&!session.window?.minimized} onClick={()=>{if('agent' in session)p.openSession(session.id);else{windowChange(session.id,{...session.window,open:true,minimized:false,order:Date.now()});} }}><MessageSquare size={12}/><span>{session.title||'Untitled conversation'}</span>{(p.pending[session.id]||gptPending[session.id])&&<i aria-label="Working"/>}</button>)}</div>}
    {chats.filter(session=>session.window?.open).map(session=>{
      const provider=providerName(session),isGPT=!('agent' in session),working=p.pending[session.id]||gptPending[session.id],selectedContexts=session.contextPaths || p.contexts;
      return <FloatingWindow key={session.id} title={session.title} label={`${provider} chat window`} layout={session.window!} order={rank(session.id)} className="floating-chat" focus={()=>focus(session.id)} change={layout=>windowChange(session.id,layout)} rename={title=>updateChat(session.id,current=>({...current,title}))} toolbar={<><span>{provider}</span><select aria-label={`${provider} chat mode`} value={session.mode||'chat'} disabled={!!working || p.missionBusy} onChange={event=>updateChat(session.id,current=>'agent' in current?{...current,mode:event.target.value as Session['mode']}:{...current,mode:event.target.value as GPTSession['mode']} )}>{isGPT?<><option value="chat">General chat</option><option value="image">Create image</option></>:<><option value="chat">Chat</option><option value="plan">Plan</option><option value="build">Build</option></>}</select>{isGPT?<button aria-label="OpenAI connection" aria-expanded={connectionWindow===session.id} onClick={()=>setConnectionWindow(value=>value===session.id?null:session.id)}><Settings2 size={13}/>{session.mode==='image'?((session as GPTSession).imageSource==='api'?'API key':'Codex plan'):((session as GPTSession).chatSource==='api'?'API key':'ChatGPT plan')}</button>:<span className="window-context-count">Local agent</span>}<button aria-label={`Context for ${session.title}`} aria-expanded={contextWindow===session.id} disabled={!!working} onClick={()=>setContextWindow(value=>value===session.id?null:session.id)}>{selectedContexts.length?`${selectedContexts.length} notes`:'Context'}</button></>}>
        {isGPT&&(connectionWindow===session.id||!chatConnectionReady(session as GPTSession,connection))&&<Suspense fallback={<div className="provider-connection" role="status">Loading connections…</div>}><ChatGPTConnection session={session as GPTSession} status={connection} models={subscriptionModels} refresh={refreshConnection} error={connectionError} change={change=>updateChat(session.id,current=>'agent' in current?current:{...current,...change})}/></Suspense>}
        {contextWindow===session.id&&<div className="window-context" aria-label={`Vault context for ${session.title}`}><p>Notes shared with this conversation</p>{p.notes.map(note=><label key={note.path}><input type="checkbox" aria-label={`Use ${note.title} in ${session.title}`} checked={selectedContexts.includes(note.path)} disabled={!!working || (!selectedContexts.includes(note.path)&&selectedContexts.length>=8)} onChange={()=>updateChat(session.id,current=>({...current,contextPaths:selectedContexts.includes(note.path)?selectedContexts.filter(path=>path!==note.path):[...selectedContexts,note.path]}))}/><span>{note.title}</span></label>)}{!p.notes.length&&<p>This vault has no notes yet.</p>}</div>}
        <ChatMessages messages={session.messages} provider={provider} showImage={showImage}/>
        <form className="window-composer" onSubmit={event=>{event.preventDefault();if(working||p.missionBusy)return;if(isGPT)void sendGPT(session as GPTSession);else p.send(session.draft||'',(session as Session).agent,(session as Session).mode||'chat',session.id);}}><textarea aria-label={`Message ${provider} in ${session.title}`} rows={2} value={session.draft||''} maxLength={20000} placeholder={session.mode==='image'?'Describe the image you imagine…':'Continue this conversation…'} onChange={event=>updateChat(session.id,current=>({...current,draft:event.target.value}))} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(working||p.missionBusy)return;if(isGPT)void sendGPT(session as GPTSession);else p.send(session.draft||'',(session as Session).agent,(session as Session).mode||'chat',session.id);}}}/>{working?<button type="button" aria-label={`Stop ${provider} response`} onClick={()=>{if(isGPT)void api.cancel(working).catch(error=>p.notify(error.message));else p.stop(session.id);}}><Square size={14}/></button>:<button type="submit" aria-label={`Send to ${provider}`} disabled={!session.draft?.trim() || p.missionBusy}><Send size={16}/></button>}</form>
      </FloatingWindow>;
    })}
    {(p.workspace.imageWindows||[]).filter(image=>image.window.open).map(image=><FloatingWindow key={image.id} title={image.prompt.slice(0,45)||'Generated image'} label="Generated image window" layout={image.window} order={rank(image.id)} className="floating-image" focus={()=>focus(image.id)} change={layout=>windowChange(image.id,layout)} toolbar={<><span><ImageIcon size={13}/> Generated image</span>{imageSources[image.id]&&<a aria-label="Download generated image" href={imageSources[image.id]} download={`aphelion-${image.id}.png`}><Download size={14}/>Download</a>}</>}><div className="image-preview">{imageSources[image.id]?<img src={imageSources[image.id]} alt={image.prompt}/>:<p role="status">{imageErrors[image.id]||'Loading your image…'}</p>}</div></FloatingWindow>)}
  </div>;
}

function ChatMessages({messages,provider,showImage}:{messages:Message[];provider:string;showImage:(id:string)=>void}){
  const body=useRef<HTMLDivElement>(null),following=useRef(true);
  const last=messages.at(-1);
  useEffect(()=>{if(body.current&&following.current)body.current.scrollTop=body.current.scrollHeight;},[messages.length,last?.content]);
  return <div className="window-messages" ref={body} role="region" aria-label="Latest agent response" tabIndex={0} onScroll={event=>{const element=event.currentTarget;following.current=element.scrollHeight-element.scrollTop-element.clientHeight<70;}}>{!messages.length?<p className="window-empty">{provider==='ChatGPT'?'Ask a question or create an image.':'A new conversation, in your orbit.'}</p>:messages.map(message=><article key={message.id} className={`window-message ${message.role} ${message.error?'has-error':''}`}><span>{message.role==='user'?'You':provider}</span>{message.content?<Markdown>{message.content}</Markdown>:<p role="status">{provider==='ChatGPT'?'Working on your request…':'Thinking through your request…'}</p>}{message.imageId&&<button className="open-image-action" onClick={()=>showImage(message.imageId!)}><ImageIcon size={14}/>Open image</button>}</article>)}</div>;
}
