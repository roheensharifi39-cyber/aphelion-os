import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, Note, Page, ProjectInfo, RuntimeEvent, RuntimeSnapshot, Status, Workspace } from './types';
import { api } from './lib/bridge';
import { appendMessage, createSession, hydrateWorkspace, updateMessage, WORKSPACE_KEY } from './lib/workspace';
import { PixelIcon, type IconName } from './components/PixelIcon';
import { Button } from './components/UI';
import { Palette, type Command } from './components/Palette';
import { ACTIVITY_KEY, readActivity, type Activity, type ActivityScope } from './components/ActivityFeed';
import { ActivityFeed } from './components/ActivityFeed';
import { VaultHub } from './components/VaultHub';
import { ModulePanels, type ModuleName } from './components/ModulePanels';
import { Home, type MissionMode } from './pages/Home';
import { Workbench } from './pages/Workbench';
import { Vault } from './pages/Vault';
import { Workflows } from './pages/Workflows';
import { Voice } from './pages/Voice';
import { Settings } from './pages/Settings';

const nativeWindow = !!window.aphelion;
const routes: { id: Page; label: string; icon: IconName }[] = [{ id: 'home', label: 'Home', icon: 'home' }, { id: 'chat', label: 'Workbench', icon: 'terminal' }, { id: 'vault', label: 'Vault', icon: 'book' }, { id: 'workflows', label: 'Workflows', icon: 'flow' }, { id: 'voice', label: 'Voice studio', icon: 'mic' }, { id: 'settings', label: 'Settings', icon: 'settings' }];
const defaultStatus: Status = { desktop: nativeWindow, connected: { claude: false, codex: false }, auth: { claude: { installed: false, signedIn: false, mode: 'missing', detail: 'Checking subscription connection.' }, codex: { installed: false, signedIn: false, mode: 'missing', detail: 'Checking subscription connection.' } }, models: { claude: 'auto', codex: 'auto' }, repo: 'https://github.com/roheensharifi39-cyber/aphelion-os', vaultPath: '' };
let clickAudio: AudioContext | null = null;
function clickSound() { try { clickAudio ||= new AudioContext(); void clickAudio.resume(); const osc = clickAudio.createOscillator(), gain = clickAudio.createGain(); osc.type = 'square'; osc.frequency.setValueAtTime(760, clickAudio.currentTime); osc.frequency.exponentialRampToValueAtTime(330, clickAudio.currentTime + .035); gain.gain.setValueAtTime(.018, clickAudio.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, clickAudio.currentTime + .05); osc.connect(gain); gain.connect(clickAudio.destination); osc.start(); osc.stop(clickAudio.currentTime + .05); } catch { /* Sound is optional. */ } }
type Job = { sessionId: string; messageId: string; text: string; controller: AbortController; agent: Agent; started: boolean };
export default function App() {
  const [workspace, setWorkspace] = useState(() => hydrateWorkspace(localStorage.getItem(WORKSPACE_KEY)));
  const workspaceRef = useRef(workspace);
  const [page, setPage] = useState<Page>(() => routes.some(r => r.id === location.hash.slice(1)) ? location.hash.slice(1) as Page : 'home');
  const [agent, setAgent] = useState<Agent>('claude');
  const [drafts, setDrafts] = useState<Record<Agent, string>>({ claude: '', codex: '' });
  const [mode, setMode] = useState<MissionMode>('mission');
  const [status, setStatus] = useState<Status>(defaultStatus);
  const statusRef = useRef(status); statusRef.current = status;
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [runtimeHistory, setRuntimeHistory] = useState<RuntimeSnapshot[]>([]);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEvent[]>([]);
  const [runtimeError, setRuntimeError] = useState('');
  const runtimeBusy = useRef(false);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [automationCount, setAutomationCount] = useState<number | null>(null);
  const [module, setModule] = useState<ModuleName | null>(null);
  const [mission, setMission] = useState<{ id: string; task: string; phase: string } | null>(null);
  const missionRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const [contexts, setContexts] = useState<string[]>([]);
  const [vaultDirty, setVaultDirty] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [palette, setPalette] = useState(false);
  const [toast, setToast] = useState('');
  const [pending, setPending] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<Activity[]>(readActivity);
  const main = useRef<HTMLElement>(null);
  const jobs = useRef(new Map<string, Job>());
  const updateWorkspace = useCallback((update: Workspace | ((w: Workspace) => Workspace)) => { const next = typeof update === 'function' ? update(workspaceRef.current) : update; workspaceRef.current = next; setWorkspace(next); }, []);
  const record = useCallback((scope: ActivityScope, text: string) => setEvents(previous => [{ id: crypto.randomUUID(), time: Date.now(), scope, text: text.slice(0, 180) }, ...previous].slice(0, 80)), []);
  const notify = useCallback((text: string, scope: ActivityScope = 'system') => { setToast(text); record(scope, text); }, [record]);
  const navigate = useCallback((destination: Page) => { setPage(destination); location.hash = destination; }, []);
  const updateStatus = useCallback((next: Status) => { const previous = statusRef.current; statusRef.current = next; for (const who of ['claude', 'codex'] as const) if (previous.connected[who] !== next.connected[who]) record(who, next.connected[who] ? 'Subscription connection confirmed' : 'Subscription connection unavailable'); if (previous.vaultPath !== next.vaultPath) record('vault', 'Connected a local vault folder'); setStatus(next); setStatusLoaded(true); }, [record]);
  const refreshNotes = useCallback(async () => { try { setNotes(await api.listNotes()); } catch (e) { notify((e as Error).message); } }, [notify]);
  const applyRuntime = useCallback((next: RuntimeSnapshot) => { setRuntime(next); setProject(next.project); setRuntimeError(''); setRuntimeHistory(previous => previous.at(-1)?.time === next.time ? previous : [...previous, next].slice(-30)); }, []);
  const refreshRuntime = useCallback(async () => { if (runtimeBusy.current) return; runtimeBusy.current = true; try { applyRuntime(await api.runtime()); } catch (e) { setRuntimeError((e as Error).message); } finally { runtimeBusy.current = false; } }, [applyRuntime]);
  useEffect(() => { void api.status().then(next => { setStatus(next); setStatusLoaded(true); }).catch(e => notify(e.message)); void refreshNotes(); void refreshRuntime(); const timer = setInterval(() => void refreshRuntime(), 2000); return () => clearInterval(timer); }, [notify, refreshNotes, refreshRuntime]);
  useEffect(() => { let live = true; void api.automations().then(next => { if (live) setAutomationCount(next.length); }).catch(() => { if (live) setAutomationCount(null); }); return () => { live = false; }; }, [project?.path]);
  useEffect(() => { setContexts(previous => previous.filter(path => notes.some(note => note.path === path))); }, [notes, status.vaultPath]);
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace)); } catch { notify('Device storage is full. Copy important conversations before closing.'); } }, 250); return () => clearTimeout(timer); }, [workspace, notify]);
  useEffect(() => { const flush = () => { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaceRef.current)); } catch { /* Device storage warnings are reported while the app is open. */ } }; window.addEventListener('beforeunload', flush); return () => window.removeEventListener('beforeunload', flush); }, []);
  useEffect(() => { main.current?.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(events)); } catch { /* Activity is optional if local device storage is full. */ } }, [events]);
  const receiveDelta = useCallback(({ requestId, delta }: { requestId: string; delta: string }) => { const job = jobs.current.get(requestId); if (!job) return; if (!job.started) { job.started = true; record(job.agent, 'Response transmission started'); } job.text += delta; updateWorkspace(w => updateMessage(w, job.sessionId, job.messageId, { content: job.text })); }, [updateWorkspace, record]);
  useEffect(() => api.onDelta(receiveDelta), [receiveDelta]);
  useEffect(() => {
    let vaultRefresh: ReturnType<typeof setTimeout> | undefined;
    const off = api.onRuntimeEvent(event => {
      setRuntimeEvents(previous => [event, ...previous].slice(0, 45));
      if (event.type === 'telemetry' && event.data && typeof event.data === 'object' && 'memory' in event.data && 'network' in event.data) applyRuntime(event.data as RuntimeSnapshot);
      if (event.type !== 'telemetry' && event.text) record(event.source === 'project' ? 'system' : event.source, event.text);
      if (event.type === 'vault') { if (vaultRefresh) clearTimeout(vaultRefresh); vaultRefresh = setTimeout(() => { void refreshNotes(); void refreshRuntime(); }, 300); }
      if (event.type === 'mission' && event.requestId === missionRef.current?.id && event.phase) {
        setMission(previous => previous && previous.id === event.requestId ? { ...previous, phase: event.phase! } : previous);
        const done = event.phase === 'building' ? 'claude' : event.phase === 'saving' ? 'codex' : null;
        if (done) { const job = jobs.current.get(`${event.requestId}-${done}`); if (job) { updateWorkspace(w => updateMessage(w, job.sessionId, job.messageId, { pending: false })); setPending(previous => { const next = { ...previous }; delete next[job.sessionId]; return next; }); } }
      }
    });
    return () => { off(); if (vaultRefresh) clearTimeout(vaultRefresh); };
  }, [applyRuntime, record, refreshNotes, refreshRuntime, updateWorkspace]);
  const start = useCallback((who: Agent, prompt = '') => { const next = createSession(workspaceRef.current, who); updateWorkspace(next.state); setAgent(who); setMode('chat'); setDrafts(d => ({ ...d, [who]: prompt })); navigate('home'); record(who, 'Created a new conversation'); }, [navigate, updateWorkspace, record]);
  const openSession = useCallback((id: string) => { const session = workspaceRef.current.sessions.find(s => s.id === id); if (!session) return; updateWorkspace(w => ({ ...w, active: { ...w.active, [session.agent]: id } })); setAgent(session.agent); navigate('chat'); record(session.agent, `Opened conversation: ${session.title}`); }, [updateWorkspace, navigate, record]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { const control = event.ctrlKey || event.metaKey; if (control && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(open => !open); } if (control && event.shiftKey && ['c', 'x'].includes(event.key.toLowerCase())) { event.preventDefault(); setAgent(event.key.toLowerCase() === 'c' ? 'claude' : 'codex'); setMode('chat'); navigate('home'); } if (event.altKey && /^[1-6]$/.test(event.key)) { event.preventDefault(); navigate(routes[Number(event.key) - 1].id); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [navigate]);
  async function requireProject(): Promise<ProjectInfo | null> { const selected = project || await api.project(); if (selected) { setProject(selected); return selected; } setModule('projects'); notify('Connect or create a project first. Your prompt is preserved.'); return null; }
  async function send(promptInput?: string, agentOverride?: Agent, requestMode: 'chat' | 'plan' | 'build' = 'chat') {
    const who = agentOverride || agent, prompt = (promptInput ?? drafts[who]).trim(); if (!prompt) return;
    if (!statusLoaded) { notify('Connections are still loading.'); return; }
    if (!status.connected[who]) { setDrafts(d => ({ ...d, [who]: prompt })); setAgent(who); notify(`Sign in to ${who === 'claude' ? 'Claude' : 'Codex'} with your subscription.`); navigate('settings'); return; }
    if (requestMode !== 'chat') { try { if (!await requireProject()) return; } catch (e) { notify((e as Error).message); return; } }
    let current = workspaceRef.current, sessionId = current.active[who]; if (!sessionId) { const next = createSession(current, who); current = next.state; sessionId = next.id; }
    if (jobs.current.size >= 4 || pending[sessionId] || [...jobs.current.values()].some(job => job.sessionId === sessionId)) { notify('Wait for the active response to finish.'); return; }
    const id = sessionId, requestId = crypto.randomUUID(), messageId = crypto.randomUUID();
    current = appendMessage(current, id, { id: crypto.randomUUID(), role: 'user', content: prompt });
    const messages = current.sessions.find(s => s.id === id)!.messages.filter(m => !m.error && !m.pending && !(m.role === 'assistant' && m.demo)).map(({ role, content }) => ({ role, content }));
    current = appendMessage(current, id, { id: messageId, role: 'assistant', content: '', pending: true }); updateWorkspace(current); setDrafts(d => ({ ...d, [who]: '' }));
    const controller = new AbortController(); jobs.current.set(requestId, { sessionId: id, messageId, text: '', controller, agent: who, started: false }); setPending(p => ({ ...p, [id]: requestId })); record(who, `${requestMode} request launched: ${prompt.split('\n')[0].slice(0, 95)}`);
    try { const result = await api.chat({ agent: who, messages, requestId, mode: requestMode }); updateWorkspace(w => updateMessage(w, id, messageId, { content: result.text, demo: false, pending: false })); record(who, 'Agent response received'); }
    catch (e) { const text = jobs.current.get(requestId)?.text || '', error = (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''); updateWorkspace(w => updateMessage(w, id, messageId, { content: `${text}${text ? '\n\n' : ''}*${controller.signal.aborted ? 'Stopped.' : `Response failed: ${error}`}*`, pending: false, error: true })); record(who, controller.signal.aborted ? 'Response stopped · partial text retained' : `Response failed: ${error}`); }
    finally { jobs.current.delete(requestId); setPending(p => { const next = { ...p }; delete next[id]; return next; }); void refreshRuntime(); }
  }
  async function launchMission(taskInput?: string) {
    const task = (taskInput ?? drafts[agent]).trim(); if (!task || missionRef.current) return;
    if (!statusLoaded) { notify('Connections are still loading.'); return; }
    if (!status.connected.claude || !status.connected.codex) { notify('Connect both Claude and Codex subscriptions to launch a mission.'); navigate('settings'); return; }
    try { if (!await requireProject()) return; } catch (e) { notify((e as Error).message); return; }
    if (missionRef.current) return;
    if (jobs.current.size > 2) { notify('Wait for an active request to finish before starting both agents.'); return; }
    const requestId = crypto.randomUUID(), controller = new AbortController(); missionRef.current = { id: requestId, controller }; setMission({ id: requestId, task, phase: 'planning' });
    let current = workspaceRef.current; const ids: string[] = [];
    for (const who of ['claude', 'codex'] as const) { const created = createSession(current, who); current = created.state; const messageId = crypto.randomUUID(); current = appendMessage(current, created.id, { id: crypto.randomUUID(), role: 'user', content: task }); current = appendMessage(current, created.id, { id: messageId, role: 'assistant', content: '', pending: true }); jobs.current.set(`${requestId}-${who}`, { sessionId: created.id, messageId, text: '', controller, agent: who, started: false }); ids.push(created.id); }
    updateWorkspace(current); setPending(previous => ({ ...previous, [ids[0]]: `${requestId}-claude`, [ids[1]]: `${requestId}-codex` })); if (taskInput === undefined) setDrafts(previous => ({ ...previous, [agent]: '' })); navigate('home'); record('system', `Mission launched: ${task.split('\n')[0].slice(0, 100)}`);
    try { const result = await api.mission({ task, requestId, contextPaths: contexts }); for (const who of ['claude', 'codex'] as const) { const job = jobs.current.get(`${requestId}-${who}`); if (job) updateWorkspace(w => updateMessage(w, job.sessionId, job.messageId, { content: who === 'claude' ? result.plan : `${result.build}\n\n*Mission receipt saved: ${result.receiptPath}*`, pending: false, demo: false })); } setProject(result.project); await refreshNotes(); notify(`Mission complete. Receipt saved: ${result.receiptPath}`, 'vault'); }
    catch (e) { const error = (e as Error).message; for (const who of ['claude', 'codex'] as const) { const job = jobs.current.get(`${requestId}-${who}`); if (job) updateWorkspace(w => updateMessage(w, job.sessionId, job.messageId, { content: `${job.text}${job.text ? '\n\n' : ''}*${controller.signal.aborted ? 'Mission stopped. Partial output retained.' : `Mission failed: ${error}`}*`, pending: false, error: true })); } notify(controller.signal.aborted ? 'Mission stopped. Partial replies are saved.' : `Mission failed: ${error}`); }
    finally { for (const who of ['claude', 'codex'] as const) jobs.current.delete(`${requestId}-${who}`); setPending(previous => { const next = { ...previous }; for (const id of ids) delete next[id]; return next; }); missionRef.current = null; setMission(null); void refreshRuntime(); }
  }
  function stopMission() { const active = missionRef.current; if (!active) return; active.controller.abort(); setMission(previous => previous ? { ...previous, phase: 'stopping' } : previous); void api.cancel(active.id).catch(e => notify(e.message)); record('system', 'Requested mission cancellation'); }
  function stop() { const id = workspace.active[agent], requestId = id ? pending[id] : undefined; if (requestId) { const job = jobs.current.get(requestId); if (missionRef.current && requestId.startsWith(missionRef.current.id)) { stopMission(); return; } job?.controller.abort(); void api.cancel(requestId).catch(e => notify(e.message)); } }
  async function saveText(content: string, prefix = 'Agent response') { try { await api.saveNote({ path: `${prefix} ${new Date().toISOString().replace(/[:.]/g, '-')} ${crypto.randomUUID().slice(0, 5)}.md`, content, title: prefix, modified: '', create: true }); await refreshNotes(); notify('Saved to your Obsidian vault.', 'vault'); } catch (e) { notify((e as Error).message); } }
  async function attach(path: string) { if (!path) return; if (mode === 'mission') { setContexts(previous => previous.includes(path) ? previous : [...previous, path]); record('vault', `Added mission context: ${path}`); return; } try { const note = await api.readNote(path); setDrafts(d => ({ ...d, [agent]: `${d[agent]}\n\nUse this note as context (quoted reference):\n<note title="${note.title}">\n${note.content}\n</note>\n\n` })); notify('Note attached. Review your prompt before sending.', 'vault'); } catch (e) { notify((e as Error).message); } }
  function useText(text: string) { setDrafts(d => ({ ...d, [agent]: text })); setMode('chat'); navigate('chat'); }
  function openAgent(who: Agent) { setAgent(who); navigate('chat'); record(who, 'Opened workbench'); }
  function retry(id: string) { const session = workspaceRef.current.sessions.find(s => s.id === id), prompt = session?.messages.filter(m => m.role === 'user').at(-1)?.content; if (!session || !prompt || pending[id]) return; updateWorkspace(w => ({ ...w, active: { ...w.active, [session.agent]: id } })); setAgent(session.agent); void send(prompt, session.agent); }
  async function checkConnections() { try { updateStatus(await api.status()); void refreshRuntime(); notify('Subscription connections checked.'); } catch (e) { notify((e as Error).message); } }
  async function openObsidian(path?: string) { try { await api.openObsidian(path); void refreshRuntime(); record('vault', path ? `Opened Obsidian note: ${path}` : 'Opened Obsidian app'); } catch (e) { notify((e as Error).message, 'vault'); } }
  const commands: Command[] = [...routes.map((r, i) => ({ title: `Open ${r.label}`, detail: `Open ${r.label.toLowerCase()}`, icon: r.icon, shortcut: `ALT ${i + 1}`, action: () => navigate(r.id) })), ...(['projects', 'automations', 'files', 'terminal', 'missions'] as const).map(name => ({ title: `Open ${name}`, detail: 'Local engine module', icon: name === 'terminal' ? 'terminal' as const : 'folder' as const, action: () => setModule(name) })), { title: 'New Claude session', detail: 'Fresh conversation', icon: 'spark', action: () => start('claude') }, { title: 'New Codex session', detail: 'Fresh conversation', icon: 'terminal', action: () => start('codex') }];
  const current = workspace.sessions.find(s => s.id === workspace.active[agent]), route = routes.find(r => r.id === page)!, frontVisible = page === 'home' || page === 'chat' || page === 'vault';
  const connected = !!runtime && !runtimeError;
  return <div className="os v1-os" onClickCapture={event => { if (workspace.sound && (event.target as HTMLElement).closest('button')) clickSound(); }}>
    <div className="ambient-space" aria-hidden="true"><div className="ambient-grid" /></div>
    <div className="titlebar"><div className="titlebar-brand"><span className="status-dot" /><span>APHELION OS</span><span className="titlebar-separator">//</span><span className="muted">LOCAL AI OPERATING SYSTEM</span></div><div className="titlebar-right"><span>{nativeWindow ? 'DESKTOP ENGINE' : 'LOCAL ENGINE CLIENT'}</span>{nativeWindow && <div className="window-controls"><button aria-label="Minimize window" onClick={() => void api.windowAction('minimize')}>−</button><button aria-label="Maximize window" onClick={() => void api.windowAction('maximize')}>□</button><button aria-label="Close window" onClick={() => void api.windowAction('close')}>×</button></div>}</div></div>
    <header className="workspace-header"><button className="station-brand" aria-label="Aphelion home" onClick={() => navigate('home')}><span className="station-sigil"><PixelIcon name="spark" size={32} /></span><span>APHELION<span>AI OS COMMAND CENTER</span></span></button><nav className="top-navigation" aria-label="Main navigation">{routes.map(r => <button key={r.id} className={page === r.id ? 'active' : ''} aria-label={r.label} aria-current={page === r.id ? 'page' : undefined} onClick={() => navigate(r.id)}><PixelIcon name={r.icon} size={12} /><span>{r.id === 'home' ? 'Command' : r.label}</span></button>)}</nav><div className="header-right"><span className={`engine-status ${connected ? 'online' : ''}`}><i />{connected ? 'SYSTEM ONLINE' : 'CONNECTING'}</span><button className="palette-trigger" aria-label="Quick search" onClick={() => setPalette(true)}><PixelIcon name="search" size={14} /><kbd>CTRL K</kbd></button><Button icon="plus" className="header-new" onClick={() => start(agent)}>New session</Button></div></header>
    <main ref={main} className={`main-shell route-${page}`}><div className={`command-stage ${page === 'home' ? 'front-screen' : 'focus-screen'} focus-${page}`} hidden={!frontVisible}>
      {page !== 'home' && frontVisible && <div className="focus-heading"><div><div className="eyebrow">APHELION / FOCUS MODE</div><h1>{page === 'chat' ? 'Workbench' : 'Obsidian vault'}</h1></div><Button icon="home" onClick={() => navigate('home')}>Command center</Button></div>}
      <div className={`command-deck ${page === 'home' ? 'dashboard-deck cockpit-deck' : ''}`}>
        <div className="home-module" hidden={page !== 'home'}><Home workspace={workspace} status={status} runtime={runtime} history={runtimeHistory} runtimeEvents={runtimeEvents} connected={connected} runtimeError={runtimeError} notes={notes} agent={agent} selectAgent={who => { setAgent(who); setMode('chat'); }} draft={drafts[agent]} setDraft={draft => setDrafts(d => ({ ...d, [agent]: draft }))} mode={mode} setMode={next => { setMode(next); if (next === 'plan') setAgent('claude'); if (next === 'build') setAgent('codex'); }} pending={pending} mission={mission} project={project} contexts={contexts} launch={() => mode === 'mission' ? void launchMission() : void send(undefined, agent, mode)} stop={mode === 'mission' ? stopMission : stop} start={start} openAgent={openAgent} attach={path => void attach(path)} settings={() => navigate('settings')} checkConnections={() => void checkConnections()} openModule={setModule} automationCount={automationCount} retryRuntime={() => void refreshRuntime()} /></div>
        <section className="workbench-module" hidden={page !== 'chat'} aria-label="Agent workbench"><Workbench agent={agent} active={page === 'chat'} setAgent={setAgent} sessions={workspace.sessions} current={current} draft={drafts[agent]} setDraft={draft => setDrafts(d => ({ ...d, [agent]: draft }))} status={status} notes={notes} pending={!!(current && pending[current.id])} send={() => void send()} stop={stop} start={() => start(agent)} openSession={openSession} save={text => void saveText(text)} attach={path => void attach(path)} settings={() => navigate('settings')} /></section>
        <section className="vault-module" hidden={page === 'chat'}><VaultHub notes={notes} status={status} obsidian={runtime?.obsidian} focusMode={page === 'vault'} visible={page === 'home' || page === 'vault'} openAgent={openAgent} openObsidian={path => void openObsidian(path)} contextPaths={contexts} setContextPaths={setContexts} event={text => record('vault', text)} renderFiles={(focusPath, active) => <Vault focusPath={focusPath} activePage={active} onDirtyChange={setVaultDirty} notes={notes} refresh={refreshNotes} status={status} updateStatus={updateStatus} notify={text => notify(text, 'vault')} useNote={useText} />} /></section>
        <div className="home-activity-module" hidden={page !== 'home'}><ActivityFeed events={events} /></div>
      </div></div>
      {page === 'workflows' && <Workflows status={status} project={project} mission={mission} launch={task => void launchMission(task)} stop={stopMission} openProjects={() => setModule('projects')} />}
      {page === 'voice' && <Voice status={status} notify={notify} useTranscript={useText} settings={() => navigate('settings')} />}
      {page === 'settings' && (statusLoaded ? <Settings hasNoteDraft={vaultDirty} status={status} updateStatus={updateStatus} workspace={workspace} updateWorkspace={updateWorkspace} refreshNotes={refreshNotes} notify={notify} /> : <div className="loading-settings panel"><p>{runtimeError || 'Checking your local engine and subscription connections...'}</p><Button icon="flow" onClick={() => void checkConnections()}>Retry connections</Button></div>)}
    </main>
    <div className="inventory-bar"><div className="inventory-caption"><span className="eyebrow">{connected ? 'LOCAL ENGINE / LIVE' : 'LOCAL ENGINE / CONNECTING'}</span><span>{project?.name || 'CONNECT YOUR NEXT PROJECT'}</span></div><nav className="hotbar" aria-label="Quick launch">{routes.map((r, i) => <button key={r.id} className={`hotbar-slot ${page === r.id ? 'selected' : ''}`} aria-label={`Open ${r.label}`} title={`${r.label} · Alt+${i + 1}`} onClick={() => navigate(r.id)}><span className="hotbar-number">{i + 1}</span><PixelIcon name={r.icon} size={20} /><span className="hotbar-tooltip">{r.label}</span></button>)}<button className="hotbar-slot" aria-label="Open GitHub repository" onClick={() => void api.openExternal(status.repo).catch(e => notify(e.message))}><PixelIcon name="github" size={20} /><span className="hotbar-tooltip">GitHub</span></button></nav><div className="inventory-right"><span className="header-clock">{runtime?.time ? new Date(runtime.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}<small>LOCAL RUNTIME</small></span><Button variant="ghost" icon={workspace.sound ? 'sound' : 'mute'} aria-label={workspace.sound ? 'Mute button sounds' : 'Enable button sounds'} onClick={() => updateWorkspace(w => ({ ...w, sound: !w.sound }))} /></div></div>
    <footer className="statusbar"><span><span className="status-dot" />SUBSCRIPTION ACCESS<span className="footer-divider">/</span>{notes.length} notes<span className="footer-divider">/</span>{workspace.sessions.length} sessions</span><span><PixelIcon name={route.icon} size={10} />{route.label.toUpperCase()}<span className="footer-divider">/</span><span className="muted">APHELION V1</span></span></footer>
    {module && <ModulePanels key={module} module={module} project={project} close={() => setModule(null)} updateProject={setProject} refresh={() => void refreshRuntime()} notify={notify} sessions={workspace.sessions} pending={pending} openSession={openSession} retry={retry} />}
    {palette && <Palette commands={commands} close={() => setPalette(false)} />}
    {toast && <div className="toast" role="status"><span className="toast-icon"><PixelIcon name="check" size={14} /></span><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><PixelIcon name="x" size={10} /></button></div>}
  </div>;
}
