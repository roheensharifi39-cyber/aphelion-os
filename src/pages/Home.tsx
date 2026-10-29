import type { Agent, ModelCatalog, Note, VaultGraph, ProjectInfo, RuntimeEvent, RuntimeSnapshot, Status, Workspace } from '../types';
import { PixelIcon } from '../components/PixelIcon';
import { useEffect, useRef, useState } from 'react';
import { Heading } from '../components/Heading';
import { AgentPreferences } from '../components/AgentPreferences';
import { Markdown } from '../components/Markdown';
import type { ModuleName } from '../components/ModulePanels';
import '../overview-tools.css';
import { agentActivity } from '../lib/agent-activity';
export type MissionMode = 'mission' | 'chat' | 'plan' | 'build';
export type ComposerProvider = Agent | 'chatgpt';
export type ComposerMode = MissionMode | 'image';
type BaseProps = { workspace: Workspace; status: Status; runtime: RuntimeSnapshot | null; history: RuntimeSnapshot[]; runtimeEvents: RuntimeEvent[]; connected: boolean; runtimeError: string; notes: Note[]; agent: Agent; composerProvider: ComposerProvider; selectComposerProvider: (provider: ComposerProvider) => void; selectAgent: (agent: Agent) => void; draft: string; setDraft: (text: string) => void; mode: ComposerMode; setMode: (mode: ComposerMode) => void; pending: Record<string, string>; mission: { id: string; task: string; phase: string } | null; project: ProjectInfo | null; contexts: string[]; launch: () => void; stop: () => void; start: (agent: Agent) => void; openAgent: (agent: Agent) => void; attach: (path: string) => void; settings: () => void; checkConnections: () => void; openModule: (module: ModuleName) => void; automationCount: number | null; retryRuntime: () => void; openVault: () => void; switchVault: () => void };
type Props = BaseProps & { openChatGPT: (mode: 'chat' | 'image') => void; catalog: ModelCatalog | null; preferencesBusy: boolean; changePreferences: (agent: Agent, model: string, effort: string) => void; drafts: Record<Agent, string>; setAgentDraft: (agent: Agent, text: string) => void; submitAgent: (agent: Agent, mode: 'chat' | 'plan' | 'build') => void; stopAgent: (agent: Agent) => void; saveAgentResponse: (agent: Agent, text: string) => void; graph: VaultGraph | null; toggleContext: (path: string) => void; openTool?: (tool: 'chat' | 'vault' | 'settings' | 'workflows' | 'voice') => void; openSession?: (id: string) => void; inspectNote?: (path: string) => void; openTerminal?: (command: 'status' | 'diff' | 'test' | 'build') => void };
export function Home(p: Props) {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [chatGPTMenu, setChatGPTMenu] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolView, setToolView] = useState<'tools' | 'sessions' | 'notes'>('tools');
  const [sessionQuery, setSessionQuery] = useState('');
  const [noteQuery, setNoteQuery] = useState('');
  const [contextQuery, setContextQuery] = useState('');
  const dock = useRef<HTMLDivElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const followingConversation = useRef(true);
  const previousSession = useRef<string | undefined>(undefined);
  const isChatGPT = p.composerProvider === 'chatgpt';
  const isImage = isChatGPT && p.mode === 'image';
  const current = p.workspace.sessions.find(session => session.id === p.workspace.active[p.agent]);
  const running = !!p.mission || !!(!isChatGPT && current && !current.window && p.pending[current.id]);
  const response = current?.messages.filter(message => message.role === 'assistant').at(-1);
  const lastMessage = current?.messages.at(-1);
  const conversationKey = current && lastMessage ? `${current.id}:${lastMessage.id}` : null;
  const matchingNotes = (query: string) => p.notes.filter(note => `${note.title} ${note.path}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const sessions = p.workspace.sessions.filter(session => `${session.title} ${session.agent}`.toLocaleLowerCase().includes(sessionQuery.trim().toLocaleLowerCase()));
  const showTool = (tool: 'chat' | 'vault' | 'settings' | 'workflows' | 'voice') => {
    setToolsOpen(false);
    if (p.openTool) { p.openTool(tool); return; }
    if (tool === 'chat') p.openAgent(p.agent);
    else if (tool === 'vault') p.openVault();
    else if (tool === 'workflows') p.openModule('automations');
    else p.settings();
  };
  const showModule = (module: ModuleName) => { setToolsOpen(false); p.openModule(module); };
  const showTerminal = (command: 'status' | 'diff' | 'test' | 'build') => { setToolsOpen(false); if (p.openTerminal) p.openTerminal(command); else p.openModule('terminal'); };
  const showSession = (id: string) => {
    setToolsOpen(false);
    if (p.openSession) p.openSession(id);
    else { const session = p.workspace.sessions.find(item => item.id === id); if (session) p.openAgent(session.agent); }
  };
  useEffect(() => {
    const element = conversation.current;
    if (previousSession.current !== current?.id) { previousSession.current = current?.id; followingConversation.current = true; }
    if (element && followingConversation.current) element.scrollTop = element.scrollHeight;
  }, [current?.id, lastMessage?.id, lastMessage?.content, dismissed]);
  useEffect(() => {
    if (!toolsOpen) return;
    const panel = dock.current?.querySelector('.overview-tools-panel');
    const control = panel?.querySelector<HTMLInputElement>('input') || panel?.querySelector<HTMLButtonElement>('.overview-tool-list button:not(:disabled), .overview-back');
    control?.focus();
  }, [toolsOpen, toolView]);
  useEffect(() => {
    if (contextOpen) composer.current?.querySelector<HTMLInputElement>('.composer-context input[type=search]')?.focus();
    if (preferencesOpen) composer.current?.querySelector<HTMLSelectElement>('.composer-preferences select:not(:disabled)')?.focus();
  }, [contextOpen, preferencesOpen]);
  useEffect(() => {
    if (!toolsOpen && !contextOpen && !preferencesOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!dock.current?.contains(target)) setToolsOpen(false);
      if (!composer.current?.contains(target)) { setContextOpen(false); setPreferencesOpen(false); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (toolsOpen) toolsTrigger.current?.focus();
      else if (contextOpen) composer.current?.querySelector<HTMLButtonElement>('[aria-label="Attach context"]')?.focus();
      else if (preferencesOpen) composer.current?.querySelector<HTMLButtonElement>('[aria-label="Model and reasoning preferences"]')?.focus();
      setToolsOpen(false); setContextOpen(false); setPreferencesOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [toolsOpen, contextOpen, preferencesOpen]);
  const activityLabel = (who: Agent) => agentActivity(who, p.workspace.sessions, p.pending, p.status, p.connected, p.mission).label;
  const connectionSummary = !p.connected ? 'Connecting to local engine' : `Vault ${p.runtime?.obsidian.watching ? 'connected' : 'not syncing'} · Claude ${p.status.connected.claude ? 'connected' : 'unavailable'} · Codex ${p.status.connected.codex ? 'connected' : 'unavailable'}`;
  return <div className="living-command-center">
    <section className={`intelligence-panel floating-glass ${agentsOpen ? 'expanded' : 'collapsed'} ${chatGPTMenu ? 'has-chatgpt-menu' : ''}`} aria-label="Intelligence">
      <div className="intelligence-heading"><Heading>Intelligence</Heading><button className="intelligence-toggle" aria-label="Toggle intelligence panel" aria-expanded={agentsOpen} onClick={() => setAgentsOpen(value => !value)}><PixelIcon name="plus" size={15} /></button><button aria-label="Manage connections" onClick={p.settings}><span aria-hidden="true">···</span></button></div>
      <div className="provider-list">{(['claude', 'codex'] as const).map(who => <button key={who} className={`provider-row ${p.composerProvider === who ? 'chosen' : ''}`} onClick={() => { p.selectAgent(who); p.setMode('chat'); }} disabled={!!p.mission} aria-pressed={p.composerProvider === who} aria-label={`Select ${who === 'claude' ? 'Claude' : 'Codex'}`}><ProviderMark name={who} /><strong>{who === 'claude' ? 'Claude' : 'Codex'}</strong><span className={`connection-label ${p.status.connected[who] ? 'connected' : ''}`}><i />{activityLabel(who)}</span></button>)}
      <button className="provider-row chatgpt-row" aria-label="ChatGPT tools" aria-expanded={chatGPTMenu} onClick={() => setChatGPTMenu(value => !value)}><ProviderMark name="chatgpt" /><strong>ChatGPT</strong><span className="external-label">Chat & images <span aria-hidden="true">⌄</span></span></button>{chatGPTMenu && <div className="chatgpt-menu"><button onClick={() => { p.openChatGPT('chat'); setChatGPTMenu(false); }}><PixelIcon name="chat" size={15}/>General chat</button><button onClick={() => { p.openChatGPT('image'); setChatGPTMenu(false); }}><PixelIcon name="spark" size={15}/>Create image</button><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Open ChatGPT website ↗</a></div>}</div>
    </section>
    <section className="vault-status-panel floating-glass" aria-label="Obsidian vault observatory">
      <button className="vault-identity" onClick={p.openVault} aria-label="Explore vault"><svg className="vault-crystal" viewBox="0 0 28 42" aria-hidden="true"><path d="m14 1 10 14 2 15-11 11L2 29l3-16Z" fill="#4d4569" stroke="#c8bfdf" strokeWidth="1"/><path d="m14 1 1 20 11 9M5 13l10 8L2 29m13-8v20" fill="none" stroke="#b5a6d6" strokeWidth="1"/><path d="m14 1 1 20-10-8Z" fill="#b2a5d1" fillOpacity=".7"/></svg><span><Heading as="h1">Your living vault</Heading><strong>Obsidian</strong><span className="vault-live-state"><i className={p.runtime?.obsidian.watching ? 'online' : ''} />{p.runtime?.obsidian.watching ? 'Connected' : p.connected ? 'Local vault' : 'Connecting'}</span></span></button>
      <span className="workspace-footnote">{connectionSummary}</span>
    </section>
    <section ref={composer} className="command-composer floating-glass" aria-label="Command composer">
      {contextOpen && !isImage && <div className="composer-context glass-popover"><div className="popover-title"><Heading>Vault context</Heading><button aria-label="Close context" onClick={() => setContextOpen(false)}><PixelIcon name="x" size={16} /></button></div><p>Vault memory is automatic. Pin up to eight notes to make sure they are included.</p><label className="overview-search"><PixelIcon name="search" size={16} /><input type="search" aria-label="Search context notes" placeholder="Find a note…" value={contextQuery} onChange={event => setContextQuery(event.target.value)} /></label><div className="overview-context-list">{matchingNotes(contextQuery).map(note => <label key={note.path}><input type="checkbox" checked={p.contexts.includes(note.path)} disabled={!!p.mission || (!p.contexts.includes(note.path) && p.contexts.length >= 8)} onChange={() => p.toggleContext(note.path)} /><span>{note.title}<small>{note.path}</small></span></label>)}</div>{!p.notes.length ? <button className="overview-inline-action" onClick={p.switchVault} disabled={!!p.mission}>Connect a vault</button> : !matchingNotes(contextQuery).length && <p>No notes match “{contextQuery}”.</p>}<span className="overview-context-count">{p.contexts.length} of 8 notes attached</span></div>}
      {preferencesOpen && !isChatGPT && <div className="composer-preferences glass-popover"><div className="popover-title"><Heading>Model & reasoning</Heading><button aria-label="Close preferences" onClick={() => setPreferencesOpen(false)}><PixelIcon name="x" size={16} /></button></div><AgentPreferences agent={p.agent} catalog={p.catalog?.[p.agent]} model={p.status.models[p.agent]} reasoning={p.status.reasoning?.[p.agent] || 'auto'} disabled={p.preferencesBusy || !!p.mission} change={(model, effort) => p.changePreferences(p.agent, model, effort)} /></div>}
      <form onSubmit={event => { event.preventDefault(); if (!running) p.launch(); }}>
        <textarea className="living-prompt" aria-label="Your prompt" rows={1} placeholder={isImage ? 'Describe the image you imagine…' : 'Where shall we go from here?'} maxLength={20000} value={p.draft} onChange={event => p.setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!running) p.launch(); } }} />
        <div className="composer-options"><div className="composer-tools"><label className="composer-agent"><ProviderMark name={p.composerProvider} /><select aria-label="Agent" value={p.composerProvider} disabled={!!p.mission} onChange={event => { p.selectComposerProvider(event.target.value as ComposerProvider); setPreferencesOpen(false); }}><option value="claude">Claude</option><option value="codex">Codex</option><option value="chatgpt">ChatGPT</option></select></label><label className={`composer-mode ${isChatGPT ? 'chatgpt-mode' : ''}`}><PixelIcon name={isImage ? 'spark' : 'chat'} size={19} /><select aria-label={isChatGPT ? 'ChatGPT mode' : 'Mission mode'} value={p.mode} onChange={event => { p.setMode(event.target.value as ComposerMode); setContextOpen(false); }} disabled={!!p.mission}>{isChatGPT ? <><option value="chat">Chat</option><option value="image">Create image</option></> : <><option value="chat">Chat</option><option value="mission">Mission</option><option value="plan">Plan</option><option value="build">Build</option></>}</select></label>{!isImage && <button className={contextOpen ? 'active' : ''} type="button" aria-label="Attach context" aria-expanded={contextOpen} onClick={() => { setContextOpen(value => !value); setPreferencesOpen(false); setToolsOpen(false); }}><PixelIcon name="link" size={17} /><span>{p.contexts.length ? `${p.contexts.length} attached` : 'Vault memory'}</span><span className="select-chevron" aria-hidden="true">⌄</span></button>}</div>
        <div className="composer-actions">{!isChatGPT && <button type="button" className="preferences-trigger" aria-label="Model and reasoning preferences" aria-expanded={preferencesOpen} onClick={() => { setPreferencesOpen(value => !value); setContextOpen(false); setToolsOpen(false); }}><PixelIcon name="settings" size={15} /></button>}<button className={`send-command ${running ? 'stop' : ''}`} aria-label={running ? 'Stop mission' : isImage ? 'Generate image' : isChatGPT ? 'Send to ChatGPT' : p.mode === 'chat' ? 'Send message' : p.mode === 'plan' ? 'Create plan' : p.mode === 'build' ? 'Start build' : 'Launch mission'} type={running ? 'button' : 'submit'} disabled={!running && !p.draft.trim()} onClick={running ? p.stop : undefined}>{running ? <PixelIcon name="stop" size={14} /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4M5 11l7-7 7 7" /></svg>}</button></div></div>
      </form>
    </section>
    {!!current?.messages.length && !isChatGPT && !current.window && dismissed !== conversationKey && <section className="home-response floating-glass" aria-label="Latest agent response"><div className="section-title"><div className="overview-conversation-title"><Heading>{p.agent === 'claude' ? 'Claude' : 'Codex'}</Heading><p>{current.title}</p></div><div><button onClick={() => showTool('chat')}>Open conversation</button>{response?.content && !response.pending && <button onClick={() => p.saveAgentResponse(p.agent, response.content)}>Save to vault</button>}<button aria-label="Close response" onClick={() => setDismissed(conversationKey)}><PixelIcon name="x" size={15} /></button></div></div><div ref={conversation} className="overview-conversation-body" tabIndex={0} aria-label="Current conversation" onScroll={event => { const element = event.currentTarget; followingConversation.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}><ol>{current.messages.map(message => <li key={message.id} className={`overview-message ${message.role}${message.error ? ' response-error' : ''}`}><span className="overview-message-author">{message.role === 'user' ? 'You' : p.agent === 'claude' ? 'Claude' : 'Codex'}</span>{message.content ? message.role === 'assistant' ? <Markdown>{message.content}</Markdown> : <p className="overview-user-message">{message.content}</p> : message.pending ? <p role="status">Thinking through your request…</p> : <p>No response text.</p>}</li>)}</ol></div></section>}
    <div ref={dock} className={`overview-tools ${toolsOpen ? 'is-open' : ''}`}>
      {toolsOpen && <section id="overview-workspace-tools" className="overview-tools-panel floating-glass" aria-label="Workspace tools"><div className="overview-tools-heading"><Heading>{toolView === 'sessions' ? 'Your conversations' : toolView === 'notes' ? 'Vault notes' : 'Workspace tools'}</Heading><button aria-label="Close workspace tools" onClick={() => { setToolsOpen(false); toolsTrigger.current?.focus(); }}><PixelIcon name="x" size={16} /></button></div>{toolView !== 'tools' && <button className="overview-back" onClick={() => setToolView('tools')}>All tools</button>}
        {toolView === 'tools' && <div className="overview-tool-list"><div className="overview-tool-pair"><button disabled={!!p.mission} onClick={() => { setToolsOpen(false); p.start(p.agent); setDismissed(null); }}><PixelIcon name="plus" size={17} /><span>New chat</span></button><button onClick={() => setToolView('sessions')}><PixelIcon name="chat" size={17} /><span>Sessions</span><small>{p.workspace.sessions.length}</small></button></div><button onClick={() => { setToolsOpen(false); setDismissed(null); if (!current?.messages.length) showTool('chat'); }}><PixelIcon name="chat" size={17} /><span>Current conversation</span><small>{p.agent === 'claude' ? 'Claude' : 'Codex'}</small></button><button onClick={() => setToolView('notes')}><PixelIcon name="book" size={17} /><span>Notes & context</span><small>{p.notes.length}</small></button><div className="overview-tool-divider" /><button disabled={!!p.mission} onClick={() => showModule('projects')}><PixelIcon name="folder" size={17} /><span>Projects</span><small>{p.project?.name || 'Connect folder'}</small></button><button onClick={() => showModule('files')}><PixelIcon name="book" size={17} /><span>Project files</span></button><button disabled={!!p.mission} onClick={() => showTerminal('status')}><PixelIcon name="terminal" size={17} /><span>Terminal</span></button><div className="overview-command-row"><button disabled={!!p.mission} onClick={() => showTerminal('diff')}><PixelIcon name="github" size={15} />Git diff</button><button disabled={!!p.mission} onClick={() => showTerminal('test')}><PixelIcon name="potion" size={15} />Tests</button><button disabled={!!p.mission} onClick={() => showTerminal('build')}><PixelIcon name="cube" size={15} />Build</button></div><div className="overview-tool-divider" /><button disabled={!!p.mission} onClick={() => showTool('workflows')}><PixelIcon name="flow" size={17} /><span>Workflows</span></button><button disabled={!!p.mission} onClick={() => showModule('automations')}><PixelIcon name="bolt" size={17} /><span>Automations</span>{p.automationCount !== null && <small>{p.automationCount}</small>}</button><button onClick={() => showTool('voice')}><PixelIcon name="mic" size={17} /><span>Voice studio</span></button><button disabled={!!p.mission} onClick={() => showTool('settings')}><PixelIcon name="settings" size={17} /><span>Connections & settings</span></button></div>}
        {toolView === 'sessions' && <><label className="overview-search"><PixelIcon name="search" size={16} /><input type="search" aria-label="Search sessions" placeholder="Find a conversation…" value={sessionQuery} onChange={event => setSessionQuery(event.target.value)} /></label><div className="overview-session-list">{sessions.map(session => <button key={session.id} disabled={!!p.mission} aria-pressed={p.workspace.active[session.agent] === session.id} onClick={() => { setDismissed(null); showSession(session.id); }}><ProviderMark name={session.agent} /><span><strong>{session.title}</strong><small>{session.agent === 'claude' ? 'Claude' : 'Codex'} · {session.messages.length} messages{p.pending[session.id] ? ' · Working' : ''}</small></span>{p.workspace.active[session.agent] === session.id && <PixelIcon name="check" size={15} />}</button>)}{!sessions.length && <p className="overview-empty">{sessionQuery ? 'No conversations match your search.' : 'Your conversations will appear here after you start a chat.'}</p>}</div><button className="overview-inline-action" disabled={!!p.mission} onClick={() => { setToolsOpen(false); p.start(p.agent); setDismissed(null); }}><PixelIcon name="plus" size={16} />New {p.agent === 'claude' ? 'Claude' : 'Codex'} chat</button></>}
        {toolView === 'notes' && <><label className="overview-search"><PixelIcon name="search" size={16} /><input type="search" aria-label="Search vault notes" placeholder="Find a note…" value={noteQuery} onChange={event => setNoteQuery(event.target.value)} /></label><div className="overview-note-list">{matchingNotes(noteQuery).map(note => <div key={note.path}><button className="overview-note-open" onClick={() => { setToolsOpen(false); if (p.inspectNote) p.inspectNote(note.path); else p.openVault(); }}><PixelIcon name="book" size={16} /><span><strong>{note.title}</strong><small>{note.path}</small></span></button><button className="overview-note-attach" aria-label={`${p.contexts.includes(note.path) ? 'Remove' : 'Attach'} ${note.title} ${p.contexts.includes(note.path) ? 'from' : 'as'} context`} aria-pressed={p.contexts.includes(note.path)} disabled={!!p.mission || (!p.contexts.includes(note.path) && p.contexts.length >= 8)} title={p.contexts.includes(note.path) ? 'Remove context' : 'Attach to your next request'} onClick={() => p.toggleContext(note.path)}><PixelIcon name={p.contexts.includes(note.path) ? 'check' : 'plus'} size={16} /></button></div>)}{!matchingNotes(noteQuery).length && <p className="overview-empty">{p.notes.length ? 'No notes match your search.' : 'Connect your Obsidian vault to browse notes here.'}</p>}</div><div className="overview-notes-footer"><span>{p.contexts.length} attached to composer</span><button className="overview-inline-action" onClick={() => showTool('vault')}>Open vault<PixelIcon name="arrow" size={14} /></button></div></>}
        {!!p.mission && <p className="overview-mission-note" role="status">A mission is running. Session and project changes resume when it finishes.</p>}
      </section>}
      <button ref={toolsTrigger} className="overview-tools-trigger floating-glass" aria-expanded={toolsOpen} aria-controls="overview-workspace-tools" onClick={() => { setToolsOpen(value => !value); setContextOpen(false); setPreferencesOpen(false); }}><PixelIcon name={toolsOpen ? 'x' : 'plus'} size={17} /><span>Workspace tools</span></button>
    </div>
    {p.runtimeError && <div className="runtime-connection-error floating-glass" role="alert"><p>{p.runtimeError}</p><button onClick={p.retryRuntime}>Reconnect engine</button></div>}
  </div>;
}

function ProviderMark({ name }: { name: Agent | 'chatgpt' }) {
  return <span className={`provider-symbol ${name}`} aria-hidden="true">{name === 'claude' ? <svg viewBox="0 0 28 28"><path d="M14 2v24M2 14h24M5 5l18 18M5 23 23 5M8 2l12 24M2 8l24 12M2 20 24 8M8 26 20 2" /></svg> : name === 'codex' ? <svg viewBox="0 0 28 28"><path d="m7 5 7 9-7 9M15 5l7 9-7 9" strokeWidth="2.5" /></svg> : <svg viewBox="0 0 28 28">{Array.from({length:6},(_,i)=><path key={i} d="M14 5C18 1 24 5 23 10L19 17l-8-1-3-6Z" transform={`rotate(${i*60} 14 14)`} />)}</svg>}</span>;
}
