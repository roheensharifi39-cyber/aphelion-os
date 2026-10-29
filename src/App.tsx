import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, ModelCatalog, Note, Page, ProjectInfo, RuntimeEvent, RuntimeSnapshot, Status, VaultGraph, Workspace } from './types';
import { api } from './lib/bridge';
import { appendMessage, createSession, hydrateWorkspace, updateMessage, switchWorkspaceVault, vaultKey, WORKSPACE_KEY } from './lib/workspace';
import { PixelIcon, type IconName } from './components/PixelIcon';
import { Button } from './components/UI';
import { Palette, type Command } from './components/Palette';
import { ACTIVITY_KEY, readActivity, type Activity, type ActivityScope } from './components/ActivityFeed';
import { ActivityFeed } from './components/ActivityFeed';
import { VaultHub } from './components/VaultHub';
import { ModulePanels, type ModuleName } from './components/ModulePanels';
import { Heading } from './components/Heading';
import { CursorField } from './components/CursorField';
import { MemoryInspector } from './components/MemoryInspector';
import { FloatingDesktop } from './components/FloatingDesktop';
import { newWindowLayout } from './lib/desktop';
import './workspace-interactions.css';
import { VaultField } from './components/VaultField';
import { agentActivity } from './lib/agent-activity';
import { Home, type ComposerProvider, type ComposerMode, type MissionMode } from './pages/Home';
import { Workbench } from './pages/Workbench';
import { Vault } from './pages/Vault';
import { Workflows } from './pages/Workflows';
import { Voice } from './pages/Voice';
import { Settings } from './pages/Settings';

const nativeWindow = !!window.aphelion;
const routes: { id: Page; label: string; icon: IconName }[] = [{ id: 'home', label: 'Overview', icon: 'home' }, { id: 'chat', label: 'Workbench', icon: 'terminal' }, { id: 'vault', label: 'Knowledge', icon: 'book' }, { id: 'workflows', label: 'Workflows', icon: 'flow' }, { id: 'voice', label: 'Voice studio', icon: 'mic' }, { id: 'settings', label: 'Settings', icon: 'settings' }];
const defaultStatus: Status = { desktop: nativeWindow, connected: { claude: false, codex: false }, auth: { claude: { installed: false, signedIn: false, mode: 'missing', detail: 'Checking subscription connection.' }, codex: { installed: false, signedIn: false, mode: 'missing', detail: 'Checking subscription connection.' } }, models: { claude: 'auto', codex: 'auto' }, repo: 'https://github.com/roheensharifi39-cyber/aphelion-os', vaultPath: '' };
let clickAudio: AudioContext | null = null;
function clickSound() { try { clickAudio ||= new AudioContext(); void clickAudio.resume(); const osc = clickAudio.createOscillator(), gain = clickAudio.createGain(); osc.type = 'square'; osc.frequency.setValueAtTime(760, clickAudio.currentTime); osc.frequency.exponentialRampToValueAtTime(330, clickAudio.currentTime + .035); gain.gain.setValueAtTime(.018, clickAudio.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, clickAudio.currentTime + .05); osc.connect(gain); gain.connect(clickAudio.destination); osc.start(); osc.stop(clickAudio.currentTime + .05); } catch { /* Sound is optional. */ } }
type Job = { sessionId: string; messageId: string; text: string; controller: AbortController; agent: Agent; started: boolean };
export default function App() {
  const [workspace, setWorkspace] = useState(() => hydrateWorkspace(localStorage.getItem(WORKSPACE_KEY)));
  const workspaceRef = useRef(workspace);
  const [page, setPage] = useState<Page>(() => routes.some(r => r.id === location.hash.slice(1)) ? location.hash.slice(1) as Page : 'home');
  const [agent, setAgent] = useState<Agent>('claude');
  const [composerProvider, setComposerProvider] = useState<ComposerProvider>('claude');
  const [gptMode, setGptMode] = useState<'chat' | 'image'>('chat');
  const [gptLaunches, setGptLaunches] = useState<string[]>([]);
  const finishGPTLaunches = useCallback((ids: string[]) => setGptLaunches(previous => previous.filter(id => !ids.includes(id))), []);
  const [drafts, setDrafts] = useState<Record<Agent, string>>(() => workspace.drafts || { claude: '', codex: '' });
  const [mode, setMode] = useState<MissionMode>('chat');
  const [missionDraft, setMissionDraft] = useState(workspace.missionDraft || '');
  const draftsRef = useRef(drafts), missionDraftRef = useRef(missionDraft);
  draftsRef.current = drafts; missionDraftRef.current = missionDraft;
  const [status, setStatus] = useState<Status>(defaultStatus);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const preferencesSaving = useRef(false);
  const [vaultGraph, setVaultGraph] = useState<VaultGraph | null>(null);
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
  const [terminalCommand, setTerminalCommand] = useState<'status' | 'diff' | 'test' | 'build'>('status');
  const [focusedNote, setFocusedNote] = useState<string>();
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null);
  const [mission, setMission] = useState<{ id: string; task: string; phase: string; sessionIds?: string[] } | null>(null);
  const missionRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const [contexts, setContexts] = useState<string[]>([]);
  const [vaultDirty, setVaultDirty] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [palette, setPalette] = useState(false);
  const [toast, setToast] = useState('');
  const [pending, setPending] = useState<Record<string, string>>({});
  const [openAIBusy, setOpenAIBusy] = useState(0);
  const openAIBusyRef = useRef(0);
  const updateOpenAIBusy = useCallback((count: number) => { openAIBusyRef.current = count; setOpenAIBusy(count); }, []);
  const [events, setEvents] = useState<Activity[]>(readActivity);
  const main = useRef<HTMLElement>(null);
  const jobs = useRef(new Map<string, Job>());
  const updateWorkspace = useCallback((update: Workspace | ((w: Workspace) => Workspace)) => { const next = typeof update === 'function' ? update(workspaceRef.current) : update; workspaceRef.current = next; setWorkspace(next); }, []);
  const record = useCallback((scope: ActivityScope, text: string) => setEvents(previous => [{ id: crypto.randomUUID(), time: Date.now(), scope, text: text.slice(0, 180) }, ...previous].slice(0, 80)), []);
  const notify = useCallback((text: string, scope: ActivityScope = 'system') => { setToast(text); record(scope, text); }, [record]);
  const navigate = useCallback((destination: Page) => { setPage(destination); location.hash = destination; }, []);
  const updateStatus = useCallback((next: Status) => { const previous = statusRef.current; statusRef.current = next; for (const who of ['claude', 'codex'] as const) if (previous.connected[who] !== next.connected[who]) record(who, next.connected[who] ? 'Subscription connection confirmed' : 'Subscription connection unavailable'); if (previous.vaultPath !== next.vaultPath) {
      record('vault', 'Connected a local vault folder');
      const scoped = switchWorkspaceVault({ ...workspaceRef.current, drafts: draftsRef.current, missionDraft: missionDraftRef.current }, next.vaultPath);
      updateWorkspace(scoped); setDrafts(scoped.drafts || { claude: '', codex: '' }); setMissionDraft(scoped.missionDraft || '');
      setGptLaunches([]);
      setContexts([]); setSelectedMemory(null); setFocusedNote(undefined); setVaultGraph(null);
    } setStatus(next); setStatusLoaded(true); }, [record, updateWorkspace]);
  const refreshCatalog = useCallback(async () => { try { setCatalog(await api.modelCatalog()); } catch (e) { const error = (e as Error).message; setCatalog({ claude: { models: [], error }, codex: { models: [], error } }); } }, []);
  useEffect(() => { void refreshCatalog(); }, [refreshCatalog]);
  useEffect(() => { setVaultGraph(null); }, [status.vaultPath]);
  async function changePreferences(who: Agent, model: string, reasoning: string) {
    if (!statusLoaded || preferencesSaving.current) return; preferencesSaving.current = true; setPreferencesBusy(true);
    const current = statusRef.current;
    try { updateStatus(await api.configure({ models: { ...current.models, [who]: model }, reasoning: { claude: current.reasoning?.claude || 'auto', codex: current.reasoning?.codex || 'auto', [who]: reasoning } })); }
    catch (e) { notify((e as Error).message); } finally { preferencesSaving.current = false; setPreferencesBusy(false); }
  }
  function toggleContext(path: string) { if (!contexts.includes(path) && contexts.length >= 8) { notify('Attach up to eight vault notes.'); return; } setContexts(previous => previous.includes(path) ? previous.filter(value => value !== path) : [...previous, path]); }
  const refreshNotes = useCallback(async () => { const path = statusRef.current.vaultPath; try { const next = await api.listNotes(); if (path === statusRef.current.vaultPath) setNotes(next); } catch (e) { if (path === statusRef.current.vaultPath) notify((e as Error).message); } }, [notify]);
  useEffect(() => { if (status.vaultPath) { setNotes([]); void refreshNotes(); } }, [status.vaultPath, refreshNotes]);
  const applyRuntime = useCallback((next: RuntimeSnapshot) => { setRuntime(next); setProject(next.project); setRuntimeError(''); setRuntimeHistory(previous => previous.at(-1)?.time === next.time ? previous : [...previous, next].slice(-30)); }, []);
  const refreshRuntime = useCallback(async () => { if (runtimeBusy.current) return; runtimeBusy.current = true; try { applyRuntime(await api.runtime()); } catch (e) { setRuntimeError((e as Error).message); } finally { runtimeBusy.current = false; } }, [applyRuntime]);
  useEffect(() => { void api.status().then(updateStatus).catch(e => notify(e.message)); void refreshNotes(); void refreshRuntime(); const timer = setInterval(() => void refreshRuntime(), 2000); return () => clearInterval(timer); }, [notify, refreshNotes, refreshRuntime, updateStatus]);
  useEffect(() => { let live = true; void api.automations().then(next => { if (live) setAutomationCount(next.length); }).catch(() => { if (live) setAutomationCount(null); }); return () => { live = false; }; }, [project?.path]);
  useEffect(() => { setContexts(previous => previous.filter(path => notes.some(note => note.path === path))); }, [notes, status.vaultPath]);
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...workspace, drafts, missionDraft })); } catch { notify('Device storage is full. Copy important conversations before closing.'); } }, 250); return () => clearTimeout(timer); }, [workspace, drafts, missionDraft, notify]);
  useEffect(() => { const flush = () => { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...workspaceRef.current, drafts: draftsRef.current, missionDraft: missionDraftRef.current })); } catch { /* Device storage warnings are reported while the app is open. */ } }; window.addEventListener('beforeunload', flush); return () => window.removeEventListener('beforeunload', flush); }, []);
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
  const start = useCallback((who: Agent, prompt = '') => { const next = createSession(workspaceRef.current, who); next.state.sessions = next.state.sessions.map(session => session.id === next.id ? { ...session, window: newWindowLayout(next.state.sessions.length - 1), draft: prompt, contextPaths: [...contexts] } : session); updateWorkspace(next.state); setAgent(who); setComposerProvider(who); setMode('chat'); setDrafts(d => ({ ...d, [who]: prompt })); navigate('home'); record(who, 'Created a new conversation'); }, [navigate, updateWorkspace, record, contexts]);
  const openSession = useCallback((id: string) => { const session = workspaceRef.current.sessions.find(s => s.id === id); if (!session) return; updateWorkspace(w => ({ ...w, active: { ...w.active, [session.agent]: id }, sessions: w.sessions.map(item => item.id === id ? { ...item, window: { ...(item.window || newWindowLayout()), open: true, minimized: false, order: Date.now() } } : item) })); setAgent(session.agent); setComposerProvider(session.agent); navigate('home'); record(session.agent, `Opened conversation: ${session.title}`); }, [updateWorkspace, navigate, record]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { const control = event.ctrlKey || event.metaKey; if (control && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(open => !open); } if (control && event.shiftKey && ['c', 'x'].includes(event.key.toLowerCase())) { event.preventDefault(); setAgent(event.key.toLowerCase() === 'c' ? 'claude' : 'codex'); setComposerProvider(event.key.toLowerCase() === 'c' ? 'claude' : 'codex'); setMode('chat'); navigate('home'); } if (event.altKey && /^[1-6]$/.test(event.key)) { event.preventDefault(); navigate(routes[Number(event.key) - 1].id); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [navigate]);
  async function requireProject(): Promise<ProjectInfo | null> { const selected = project || await api.project(); if (selected) { setProject(selected); return selected; } setModule('projects'); notify('Connect or create a project first. Your prompt is preserved.'); return null; }
  async function send(promptInput?: string, agentOverride?: Agent, requestMode: 'chat' | 'plan' | 'build' = 'chat', sessionOverride?: string, fresh = false) {
    const who = agentOverride || agent, prompt = (promptInput ?? drafts[who]).trim(), vaultAtStart = vaultKey(statusRef.current.vaultPath); if (!prompt || preferencesSaving.current) return;
    if (!statusLoaded) { notify('Connections are still loading.'); return; }
    if (!status.connected[who]) { setDrafts(d => ({ ...d, [who]: prompt })); setAgent(who); notify(`Sign in to ${who === 'claude' ? 'Claude' : 'Codex'} with your subscription.`); navigate('settings'); return; }
    if (requestMode !== 'chat') { try { if (!await requireProject()) return; } catch (e) { notify((e as Error).message); return; } }
    if (vaultAtStart !== vaultKey(statusRef.current.vaultPath)) { notify('The vault changed. Your prompt is still saved in its original conversation.'); return; }
    if (sessionOverride && !workspaceRef.current.sessions.some(session => session.id === sessionOverride && session.agent === who)) { notify('Reopen this conversation before sending.'); return; }
    let current = workspaceRef.current, sessionId = sessionOverride || (fresh ? null : current.active[who]); if (!sessionId) { const next = createSession(current, who); current = next.state; sessionId = next.id; }
    if (jobs.current.size >= 4 || pending[sessionId] || [...jobs.current.values()].some(job => job.sessionId === sessionId)) { notify('Wait for the active response to finish.'); return; }
    const id = sessionId, requestId = crypto.randomUUID(), messageId = crypto.randomUUID();
    current = appendMessage(current, id, { id: crypto.randomUUID(), role: 'user', content: prompt });
    const messages = current.sessions.find(s => s.id === id)!.messages.filter(m => !m.error && !m.pending && !(m.role === 'assistant' && m.demo)).map(({ role, content }) => ({ role, content }));
    current = appendMessage(current, id, { id: messageId, role: 'assistant', content: '', pending: true }); current = { ...current, sessions: current.sessions.map(session => session.id === id ? { ...session, draft: '', mode: requestMode, contextPaths: session.contextPaths || [...contexts], window: { ...(session.window || newWindowLayout(current.sessions.length - 1)), open: true, minimized: false, order: Date.now() } } : session) }; updateWorkspace(current); if (promptInput === undefined) setDrafts(d => ({ ...d, [who]: '' }));
    const controller = new AbortController(); jobs.current.set(requestId, { sessionId: id, messageId, text: '', controller, agent: who, started: false }); setPending(p => ({ ...p, [id]: requestId })); record(who, `${requestMode} request launched: ${prompt.split('\n')[0].slice(0, 95)}`);
    try { const result = await api.chat({ agent: who, messages, requestId, mode: requestMode, contextPaths: current.sessions.find(session => session.id === id)?.contextPaths || contexts, sessionId: id, previousMemoryPath: current.sessions.find(session => session.id === id)?.memoryPath }); updateWorkspace(w => updateMessage(w, id, messageId, { content: result.text, demo: false, pending: false })); if (result.memoryPath) { updateWorkspace(w => ({ ...w, sessions: w.sessions.map(session => session.id === id ? { ...session, memoryPath: result.memoryPath } : session) })); await refreshNotes(); } if (result.memoryWarning) notify(result.memoryWarning, 'vault'); record(who, 'Agent response received'); }
    catch (e) { const text = jobs.current.get(requestId)?.text || '', error = (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''); updateWorkspace(w => updateMessage(w, id, messageId, { content: `${text}${text ? '\n\n' : ''}*${controller.signal.aborted ? 'Stopped.' : `Response failed: ${error}`}*`, pending: false, error: true })); record(who, controller.signal.aborted ? 'Response stopped · partial text retained' : `Response failed: ${error}`); }
    finally { jobs.current.delete(requestId); setPending(p => { const next = { ...p }; delete next[id]; return next; }); void refreshRuntime(); }
  }
  async function launchMission(taskInput?: string) {
    const task = (taskInput ?? missionDraft).trim(); if (!task || missionRef.current || preferencesSaving.current) return;
    if (!statusLoaded) { notify('Connections are still loading.'); return; }
    if (!status.connected.claude || !status.connected.codex) { notify('Connect both Claude and Codex subscriptions to launch a mission.'); navigate('settings'); return; }
    try { if (!await requireProject()) return; } catch (e) { notify((e as Error).message); return; }
    if (missionRef.current) return;
    if (jobs.current.size > 2) { notify('Wait for an active request to finish before starting both agents.'); return; }
    const requestId = crypto.randomUUID(), controller = new AbortController(); missionRef.current = { id: requestId, controller }; setMission({ id: requestId, task, phase: 'planning' });
    let current = workspaceRef.current; const ids: string[] = [];
    for (const who of ['claude', 'codex'] as const) { const created = createSession(current, who); current = created.state; const messageId = crypto.randomUUID(); current = appendMessage(current, created.id, { id: crypto.randomUUID(), role: 'user', content: task }); current = appendMessage(current, created.id, { id: messageId, role: 'assistant', content: '', pending: true }); current.sessions = current.sessions.map(session => session.id === created.id ? { ...session, window: newWindowLayout(ids.length), mode: who === 'claude' ? 'plan' : 'build', draft: '', contextPaths: [...contexts] } : session); jobs.current.set(`${requestId}-${who}`, { sessionId: created.id, messageId, text: '', controller, agent: who, started: false }); ids.push(created.id); }
    setMission(previous => previous ? { ...previous, sessionIds: ids } : previous);
    updateWorkspace(current); setPending(previous => ({ ...previous, [ids[0]]: `${requestId}-claude`, [ids[1]]: `${requestId}-codex` })); if (taskInput === undefined) setMissionDraft(''); navigate('home'); record('system', `Mission launched: ${task.split('\n')[0].slice(0, 100)}`);
    try { const result = await api.mission({ task, requestId, contextPaths: contexts }); for (const who of ['claude', 'codex'] as const) { const job = jobs.current.get(`${requestId}-${who}`); if (job) updateWorkspace(w => updateMessage(w, job.sessionId, job.messageId, { content: who === 'claude' ? result.plan : `${result.build}\n\n*Mission receipt saved: ${result.receiptPath}*`, pending: false, demo: false })); } setProject(result.project); await refreshNotes(); notify(`Mission complete. Receipt saved: ${result.receiptPath}`, 'vault'); }
    catch (e) { const error = (e as Error).message; for (const who of ['claude', 'codex'] as const) { const job = jobs.current.get(`${requestId}-${who}`); if (job) updateWorkspace(w => updateMessage(w, job.sessionId, job.messageId, { content: `${job.text}${job.text ? '\n\n' : ''}*${controller.signal.aborted ? 'Mission stopped. Partial output retained.' : `Mission failed: ${error}`}*`, pending: false, error: true })); } notify(controller.signal.aborted ? 'Mission stopped. Partial replies are saved.' : `Mission failed: ${error}`); }
    finally { for (const who of ['claude', 'codex'] as const) jobs.current.delete(`${requestId}-${who}`); setPending(previous => { const next = { ...previous }; for (const id of ids) delete next[id]; return next; }); missionRef.current = null; setMission(null); void refreshRuntime(); }
  }
  function stopMission() { const active = missionRef.current; if (!active) return; active.controller.abort(); setMission(previous => previous ? { ...previous, phase: 'stopping' } : previous); void api.cancel(active.id).catch(e => notify(e.message)); record('system', 'Requested mission cancellation'); }
  function stopAgent(who: Agent) { const id = workspace.sessions.find(session => session.agent === who && pending[session.id])?.id || workspace.active[who], requestId = id ? pending[id] : undefined; if (requestId) { const job = jobs.current.get(requestId); if (missionRef.current && requestId.startsWith(missionRef.current.id)) { stopMission(); return; } job?.controller.abort(); void api.cancel(requestId).catch(e => notify(e.message)); } }
  function stop() { stopAgent(agent); }
  async function saveText(content: string, prefix = 'Agent response') { try { await api.saveNote({ path: `${prefix} ${new Date().toISOString().replace(/[:.]/g, '-')} ${crypto.randomUUID().slice(0, 5)}.md`, content, title: prefix, modified: '', create: true }); await refreshNotes(); notify('Saved to your Obsidian vault.', 'vault'); } catch (e) { notify((e as Error).message); } }
  async function attach(path: string) { if (!path) return; if (mode === 'mission') { setContexts(previous => previous.includes(path) ? previous : [...previous, path]); record('vault', `Added mission context: ${path}`); return; } try { const note = await api.readNote(path); setDrafts(d => ({ ...d, [agent]: `${d[agent]}\n\nUse this note as context (quoted reference):\n<note title="${note.title}">\n${note.content}\n</note>\n\n` })); notify('Note attached. Review your prompt before sending.', 'vault'); } catch (e) { notify((e as Error).message); } }
  function useText(text: string) { setDrafts(d => ({ ...d, [agent]: text })); setMode('chat'); navigate('chat'); }
  function openAgent(who: Agent) { setAgent(who); setComposerProvider(who); navigate('chat'); record(who, 'Opened workbench'); }
  function retry(id: string) { const session = workspaceRef.current.sessions.find(s => s.id === id), prompt = session?.messages.filter(m => m.role === 'user').at(-1)?.content; if (!session || !prompt || pending[id]) return; updateWorkspace(w => ({ ...w, active: { ...w.active, [session.agent]: id } })); setAgent(session.agent); void send(prompt, session.agent); }
  async function checkConnections() { try { updateStatus(await api.status()); void refreshRuntime(); void refreshCatalog(); notify('Subscription connections checked.'); } catch (e) { notify((e as Error).message); } }
  async function openObsidian(path?: string) { try { await api.openObsidian(path); void refreshRuntime(); record('vault', path ? `Opened Obsidian note: ${path}` : 'Opened Obsidian app'); } catch (e) { notify((e as Error).message, 'vault'); } }
  const commands: Command[] = [...routes.map((r, i) => ({ title: `Open ${r.label}`, detail: `Open ${r.label.toLowerCase()}`, icon: r.icon, shortcut: `ALT ${i + 1}`, action: () => navigate(r.id) })), ...(['projects', 'automations', 'files', 'terminal', 'missions'] as const).map(name => ({ title: `Open ${name === 'missions' ? 'Sessions' : name}`, detail: 'Local engine module', icon: name === 'terminal' ? 'terminal' as const : 'folder' as const, action: () => setModule(name) })), { title: 'New Claude session', detail: 'Fresh conversation', icon: 'spark', action: () => start('claude') }, { title: 'New Codex session', detail: 'Fresh conversation', icon: 'terminal', action: () => start('codex') }];
  const current = workspace.sessions.find(s => s.id === workspace.active[agent]), route = routes.find(r => r.id === page)!, frontVisible = page === 'home' || page === 'chat' || page === 'vault';
  const connected = !!runtime && !runtimeError;
  function openChatGPT(mode: 'chat' | 'image', prompt = '', submit = false) {
    const id = crypto.randomUUID();
    updateWorkspace(current => ({ ...current, gptDrafts: submit ? { chat: '', image: '', ...current.gptDrafts, [mode]: '' } : current.gptDrafts, gptSessions: [{ id, title: prompt ? prompt.split('\n')[0].slice(0, 48) : mode === 'image' ? 'New image studio' : 'New ChatGPT chat', created: new Date().toISOString(), messages: [], draft: prompt, mode, contextPaths: [...contexts], window: newWindowLayout(current.sessions.filter(session => session.window?.open).length + (current.gptSessions || []).filter(session => session.window.open).length) }, ...(current.gptSessions || [])] }));
    if (submit) setGptLaunches(previous => [...previous, id]);
    navigate('home');
  }
  function selectComposerProvider(who: ComposerProvider) {
    setComposerProvider(who);
    if (who !== 'chatgpt') { setAgent(who); setMode('chat'); }
  }
  function changeComposerMode(next: ComposerMode) {
    if (composerProvider === 'chatgpt') { if (next === 'chat' || next === 'image') setGptMode(next); return; }
    if (next === 'image') return;
    setMode(next);
    if (next === 'plan') { setAgent('claude'); setComposerProvider('claude'); }
    if (next === 'build') { setAgent('codex'); setComposerProvider('codex'); }
  }
  function changeComposerDraft(draft: string) {
    if (composerProvider === 'chatgpt') updateWorkspace(current => ({ ...current, gptDrafts: { chat: '', image: '', ...current.gptDrafts, [gptMode]: draft } }));
    else if (mode === 'mission') setMissionDraft(draft);
    else setDrafts(previous => ({ ...previous, [agent]: draft }));
  }
  function launchComposer() {
    if (missionRef.current) return;
    if (composerProvider === 'chatgpt') {
      const prompt = workspaceRef.current.gptDrafts?.[gptMode]?.trim();
      if (!prompt) return;
      if (!statusLoaded) { notify('Connections are still loading.'); return; }
      openChatGPT(gptMode, prompt, true);
    } else if (mode === 'mission') void launchMission();
    else void send(undefined, agent, mode, undefined, true);
  }
  function stopSession(id: string) {
    const requestId = pending[id]; if (!requestId) return;
    if (missionRef.current && requestId.startsWith(missionRef.current.id)) { stopMission(); return; }
    jobs.current.get(requestId)?.controller.abort(); void api.cancel(requestId).catch(error => notify(error.message));
  }
  async function switchVault() {
    if (vaultDirty) { notify('Save your note draft before switching vault folders.'); return; }
    if (jobs.current.size || missionRef.current || openAIBusyRef.current) { notify('Finish or stop the active conversation before switching vaults.'); return; }
    try { const next = await api.selectVault(); if (next) { updateStatus(next); setContexts([]); await refreshNotes(); void refreshRuntime(); } }
    catch (error) { notify((error as Error).message, 'vault'); }
  }
  return <div className={`os observatory scene-os scene-route-${page}`} onClickCapture={event => { if (workspace.sound && (event.target as HTMLElement).closest('button')) clickSound(); }}>
    <VaultField active={page === 'home'} vaultPath={status.vaultPath} graph={vaultGraph} sessions={workspace.sessions} selectedPath={selectedMemory} selectNote={setSelectedMemory} activities={(['claude', 'codex'] as const).map(who => agentActivity(who, workspace.sessions, pending, status, connected, mission))} openSession={openSession} settings={() => navigate('settings')} />
    <CursorField />
    <header className="observatory-header"><button className="aphelion-brand" aria-label="Aphelion home" onClick={() => navigate('home')}><span>aphelion OS</span></button><nav className="observatory-nav" aria-label="Main navigation"><button className={page === 'home' && !module ? 'active' : ''} aria-current={page === 'home' && !module ? 'page' : undefined} onClick={() => navigate('home')}>Overview</button><button className={page === 'vault' ? 'active' : ''} aria-current={page === 'vault' ? 'page' : undefined} onClick={() => navigate('vault')}>Knowledge</button><button className={module === 'missions' ? 'active' : ''} onClick={() => setModule('missions')}>Sessions</button></nav><div className="workspace-switchers"><button disabled={!!mission || Object.keys(pending).length > 0 || openAIBusy > 0} onClick={() => void switchVault()} aria-label="Switch Obsidian vault" title={status.vaultPath || 'Connect a vault'}><PixelIcon name="book" size={19} /><span>{status.vaultPath.split(/[\\/]/).filter(Boolean).at(-1) || 'My vault'}</span><span className="chevron" aria-hidden="true">⌄</span></button><button onClick={() => setModule('projects')} aria-label="Switch project" title={project?.path || 'Select project'}><PixelIcon name="folder" size={19} /><span>{project?.name || 'Select project'}</span><span className="chevron" aria-hidden="true">⌄</span></button></div><button className="scene-menu" aria-label="Quick search" title="All tools · Ctrl K" onClick={() => setPalette(true)}><PixelIcon name="search" size={18} /></button></header>
    <main ref={main} className={`main-shell route-${page}`}><div className={`observatory-stage ${page === 'home' ? 'front-screen' : 'focus-screen'} focus-${page}`} >

      <div className="observatory-deck">
        <div className="home-module"><Home openChatGPT={openChatGPT} openTool={navigate} openSession={openSession} inspectNote={path => setSelectedMemory(path)} openTerminal={command => { setTerminalCommand(command); setModule('terminal'); }} openVault={() => navigate('vault')} switchVault={() => void switchVault()} catalog={catalog} preferencesBusy={!statusLoaded || preferencesBusy} changePreferences={(who, model, effort) => void changePreferences(who, model, effort)} drafts={drafts} setAgentDraft={(who, text) => setDrafts(previous => ({ ...previous, [who]: text }))} submitAgent={(who, mode) => void send(undefined, who, mode)} stopAgent={stopAgent} saveAgentResponse={(who, text) => void saveText(text, `${who === "claude" ? "Claude" : "Codex"} response`)} graph={vaultGraph} toggleContext={toggleContext} workspace={workspace} status={status} runtime={runtime} history={runtimeHistory} runtimeEvents={runtimeEvents} connected={connected} runtimeError={runtimeError} notes={notes} agent={agent} composerProvider={composerProvider} selectComposerProvider={selectComposerProvider} selectAgent={selectComposerProvider} draft={composerProvider === 'chatgpt' ? workspace.gptDrafts?.[gptMode] || '' : mode === 'mission' ? missionDraft : drafts[agent]} setDraft={changeComposerDraft} mode={composerProvider === 'chatgpt' ? gptMode : mode} setMode={changeComposerMode} pending={pending} mission={mission} project={project} contexts={contexts} launch={launchComposer} stop={mission ? stopMission : stop} start={start} openAgent={openAgent} attach={path => void attach(path)} settings={() => navigate('settings')} checkConnections={() => void checkConnections()} openModule={setModule} automationCount={automationCount} retryRuntime={() => void refreshRuntime()} /></div>
        <section className="workbench-module overview-inspector" hidden={page !== 'chat'} aria-label="Agent workbench"><button className="inspector-close" aria-label="Close workbench" onClick={() => navigate('home')}><PixelIcon name="x" size={18} /></button><Workbench agent={agent} active={page === 'chat'} setAgent={setAgent} sessions={workspace.sessions} current={current} draft={drafts[agent]} setDraft={draft => setDrafts(d => ({ ...d, [agent]: draft }))} status={status} notes={notes} pending={!!(current && pending[current.id])} send={() => void send()} stop={stop} start={() => start(agent)} openSession={openSession} save={text => void saveText(text)} attach={path => void attach(path)} settings={() => navigate('settings')} /></section>
        <section className="vault-module overview-inspector" hidden={page !== 'vault'}><button className="inspector-close" aria-label="Close vault" onClick={() => navigate('home')}><PixelIcon name="x" size={18} /></button><VaultHub onGraph={setVaultGraph} notes={notes} status={status} obsidian={runtime?.obsidian} focusMode={page === 'vault'} visible={page === 'home' || page === 'vault'} openAgent={openAgent} openObsidian={path => void openObsidian(path)} contextPaths={contexts} setContextPaths={setContexts} event={text => record('vault', text)} renderFiles={(focusPath, active) => <Vault focusPath={focusedNote || focusPath} activePage={active} onDirtyChange={setVaultDirty} notes={notes} refresh={refreshNotes} status={status} updateStatus={updateStatus} notify={text => notify(text, 'vault')} useNote={useText} />} /></section>

      </div></div>
      {page === 'workflows' && <div className="overview-inspector"><button className="inspector-close" aria-label="Close workflows" onClick={() => navigate('home')}><PixelIcon name="x" size={18} /></button><Workflows status={status} project={project} mission={mission} launch={task => void launchMission(task)} stop={stopMission} openProjects={() => setModule('projects')} /></div>}
      {page === 'voice' && <div className="overview-inspector"><button className="inspector-close" aria-label="Close voice" onClick={() => navigate('home')}><PixelIcon name="x" size={18} /></button><Voice status={status} notify={notify} useTranscript={useText} settings={() => navigate('settings')} /></div>}
      {page === 'settings' && <div className="overview-inspector"><button className="inspector-close" aria-label="Close settings" onClick={() => navigate('home')}><PixelIcon name="x" size={18} /></button>{(statusLoaded ? <Settings catalog={catalog} hasNoteDraft={vaultDirty} status={status} updateStatus={updateStatus} workspace={workspace} updateWorkspace={updateWorkspace} refreshNotes={refreshNotes} notify={notify} /> : <div className="loading-settings panel"><p>{runtimeError || 'Checking your local engine and subscription connections...'}</p><Button icon="flow" onClick={() => void checkConnections()}>Retry connections</Button></div>)}</div>}
    </main>
    <FloatingDesktop key={status.vaultPath} launches={gptLaunches} launched={finishGPTLaunches} workspace={workspace} update={updateWorkspace} pending={pending} contexts={contexts} notes={notes} send={(prompt, who, requestMode, id) => void send(prompt, who, requestMode, id)} stop={stopSession} openSession={openSession} busy={updateOpenAIBusy} refresh={refreshNotes} notify={notify} missionBusy={!!mission} />
    {selectedMemory && <MemoryInspector path={selectedMemory} attached={contexts.includes(selectedMemory)} toggle={() => toggleContext(selectedMemory)} close={() => setSelectedMemory(null)} edit={() => { setFocusedNote(selectedMemory); navigate('vault'); setSelectedMemory(null); }} />}
    {module && <ModulePanels key={`${module}-${terminalCommand}`} initialCommand={terminalCommand} module={module} project={project} close={() => setModule(null)} updateProject={setProject} refresh={() => void refreshRuntime()} notify={notify} sessions={workspace.sessions} pending={pending} openSession={openSession} retry={retry} />}
    {palette && <Palette commands={commands} close={() => setPalette(false)} />}
    {toast && <div className="toast" role="status"><span className="toast-icon"><PixelIcon name="check" size={14} /></span><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><PixelIcon name="x" size={10} /></button></div>}
  </div>;
}
