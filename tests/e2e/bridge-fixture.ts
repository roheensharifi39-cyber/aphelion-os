import { expect, type Page } from '@playwright/test';
import type { Agent, ChatRequest, AphelionBridge, ChatGPTModel, ChatGPTSubscriptionStatus, Note, OpenAIStatus, ProjectInfo, RuntimeEvent, RuntimeSnapshot, Status } from '../../src/types';

export type BridgeOptions = { connected?: { claude: boolean; codex: boolean }; project?: ProjectInfo | null; emptyVault?: boolean; deferredChat?: boolean; deferredOpenAIChat?: boolean; deferredMission?: boolean; deferredRead?: string; deferredSave?: boolean; deferredCreate?: boolean; deferredStatus?: boolean; statusDelay?: number; models?: { claude: string; codex: string }; reasoning?: { claude: string; codex: string }; repo?: string; obsidianRunning?: boolean; openaiConfigured?: boolean; chatGPTConnected?: boolean; codexConnected?: boolean };

// The external bridge owns paid CLI calls, native windows, and personal filesystem I/O.
// Every test installs this complete boundary before app startup. Production components
// and their state machines, effects, persistence, forms, and rendering stay real.
export async function openWorkspace(page: Page, options: BridgeOptions = {}, hash = '') {
  await page.route('**/__aphelion/**', route => route.abort('blockedbyclient'));
  await page.addInitScript((options: BridgeOptions) => {
    const key = 'aphelion.e2e.bridge.v1';
    const clone = <T,>(value: T): T => structuredClone(value);
    const initialNotes: Note[] = options.emptyVault ? [] : [
      { path: 'Project Memory.md', title: 'Project Memory', content: '# Project Memory\n\nKeep the launch context. See [[Architecture]].\n\n#memory #project', modified: '2020-01-01T00:00:00Z', revision: 'memory-1' },
      { path: 'Architecture.md', title: 'Architecture', content: '# Architecture\n\nThe core uses local event streams.\n\n#design', modified: '2020-01-02T00:00:00Z', revision: 'architecture-1' },
    ];
    const initialProject: ProjectInfo = { path: 'C:/FixtureProjects/Launchpad', name: 'Launchpad', branch: 'main', dirty: false };
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    const state: { vaultPath?: string; noteVaults?: Record<string, Note[]>; notes: Note[]; project: ProjectInfo | null; connected: { claude: boolean; codex: boolean }; models: { claude: string; codex: string }; reasoning?: { claude: string; codex: string }; repo: string; obsidianRunning: boolean; activeJobs: number; cpu: number; heartbeat: number; apiConfigured?: boolean; apiModel?: string; imageModel?: string; subscription?: ChatGPTSubscriptionStatus; codexImagesConnected?: boolean } = stored || {
      vaultPath: 'C:/FixtureVault', noteVaults: {}, notes: initialNotes, project: options.project === undefined ? initialProject : options.project,
      connected: options.connected || { claude: true, codex: true }, models: options.models || { claude: 'auto', codex: 'auto' }, reasoning: options.reasoning || { claude: 'auto', codex: 'auto' },
      repo: options.repo || 'https://github.com/example/launchpad', obsidianRunning: options.obsidianRunning ?? true, activeJobs: 0, cpu: 37, heartbeat: 1,
    };
    state.apiConfigured ??= options.openaiConfigured ?? true;
    state.apiModel ||= 'gpt-6-astra'; state.imageModel ||= 'gpt-image-2.5-flare';
    state.subscription ||= { connected: options.chatGPTConnected ?? true, connecting: false, account: options.chatGPTConnected === false ? undefined : 'fixture@chatgpt.test', detail: options.chatGPTConnected === false ? 'Sign in with your ChatGPT subscription.' : 'ChatGPT subscription connected', model: 'gpt-6-astra' };
    state.codexImagesConnected ??= options.codexConnected ?? true;
    const persist = () => localStorage.setItem(key, JSON.stringify(state));
    state.activeJobs = 0;
    persist();
    const deltaHandlers = new Set<(event: { requestId: string; delta: string }) => void>();
    const runtimeHandlers = new Set<(event: RuntimeEvent) => void>();
    const chats = new Map<string, { agent: Agent; request: ChatRequest; resolve: (value: any) => void; reject: (reason: Error) => void }>();
    type GPTRequest = Parameters<AphelionBridge['openaiChat']>[0];
    const openAIChats = new Map<string, { request: GPTRequest; resolve: (value: { text: string }) => void; reject: (reason: Error) => void }>();
    const openAIRequests: GPTRequest[] = [], imageRequests: Parameters<AphelionBridge['generateImage']>[0][] = [], cancelledRequests: string[] = [];
    const connectionCalls = { starts: 0, cancels: 0, disconnects: 0, status: 0, models: 0 };
    const failures = { chat: {} as Record<string, string>, image: {} as Record<string, string> };
    let subscriptionModels: ChatGPTModel[] = [{ slug: 'gpt-6-astra', display_name: 'GPT-6 Astra', visibility: 'visible' }, { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'visible' }];
    let mission: { request: { task: string; requestId: string; contextPaths?: string[] }; resolve: (value: any) => void; reject: (reason: Error) => void } | null = null;
    let read: (() => void) | null = null, write: (() => void) | null = null;
    const statusReads: (() => void)[] = [];
    const opens: (string | null)[] = [];
    function obsidian() { return { installed: true, running: state.obsidianRunning, vaultPath: state.vaultPath || 'C:/FixtureVault', watching: true, indexedAt: 1700000000000, noteCount: state.notes.length, detail: 'Native Obsidian fixture boundary' }; }
    function status(): Status { return { desktop: false, connected: clone(state.connected), auth: { claude: { installed: true, signedIn: state.connected.claude, mode: state.connected.claude ? 'subscription' : 'signed-out', detail: state.connected.claude ? 'Claude subscription connected' : 'Claude subscription sign-in required' }, codex: { installed: true, signedIn: state.connected.codex, mode: state.connected.codex ? 'subscription' : 'signed-out', detail: state.connected.codex ? 'Codex subscription connected' : 'Codex subscription sign-in required' } }, models: clone(state.models), reasoning: clone(state.reasoning || { claude: 'auto', codex: 'auto' }), vaultPath: state.vaultPath || 'C:/FixtureVault', repo: state.repo }; }
    function snapshot(): RuntimeSnapshot { return { time: Date.now(), cpu: state.cpu, memory: { used: 6_442_450_944, total: 10_737_418_240, percent: 60 }, network: { online: true, clients: 2, received: 2048, sent: 1024 }, processes: [{ pid: 5001, name: 'Local engine', role: 'system' }, { pid: 5002, name: 'Obsidian', role: 'vault' }], activeJobs: state.activeJobs, project: clone(state.project), obsidian: obsidian(), heartbeat: state.heartbeat }; }
    function emit(event: Omit<RuntimeEvent, 'id' | 'time'>) { const complete = { ...event, id: crypto.randomUUID(), time: Date.now() }; runtimeHandlers.forEach(handler => handler(complete)); }
    function telemetry() { state.heartbeat++; emit({ type: 'telemetry', source: 'system', data: snapshot() }); }
    function delta(requestId: string, text: string) { deltaHandlers.forEach(handler => handler({ requestId, delta: text })); }
    const result = (text: string) => ({ text, demo: false, usage: { input: 12, output: 18 } });
    function settleChat(agent: Agent, text?: string, error?: string) { const entry = [...chats].find(([, job]) => job.agent === agent); if (!entry) throw new Error('No pending chat for this agent'); const [id, job] = entry; chats.delete(id); state.activeJobs--; telemetry(); if (error) job.reject(new Error(error)); else { const reply = text || `${agent} completed reply`; job.resolve({ ...result(reply), memoryPath: remember(job.request, reply) }); } }
    function save(note: Note & { content: string }): Note { const saved: Note = { ...note, create: undefined, modified: new Date().toISOString(), revision: crypto.randomUUID() }; const index = state.notes.findIndex(existing => existing.path === note.path); if (index >= 0) state.notes[index] = saved; else state.notes.push(saved); persist(); return clone(saved); }
    function remember(request: ChatRequest, text: string) {
      const path = `Aphelion/Conversations/${request.agent}-${request.requestId}.md`;
      const prompt = request.messages.filter(message => message.role === 'user').at(-1)?.content || '';
      save({path, title:`Conversation ${prompt.slice(0,32)}`, modified:'', content:`# ${prompt}\n\n${text}`});
      emit({type:'vault',source:'vault',text:'Conversation remembered',data:{path}});
      return path;
    }
    function finishMission() {
      if (!mission) throw new Error('No pending mission');
      const entry = mission; mission = null;
      const context = entry.request.contextPaths?.join(', ') || 'none';
      const plan = `Claude implementation plan for ${entry.request.task}.\n\nContext: ${context}`;
      const build = `Codex wrote src/index.ts for ${entry.request.task}.`;
      save({ path: 'Mission receipt.md', title: 'Mission receipt', modified: '', content: `# Mission receipt\n\n${plan}\n\n${build}`, create: true });
      state.activeJobs = 0; persist(); emit({ type: 'mission', source: 'vault', requestId: entry.request.requestId, phase: 'completed', text: 'Mission receipt saved' }); telemetry();
      entry.resolve({ plan, build, project: clone(state.project), receiptPath: 'Mission receipt.md' });
    }
    function openaiStatus(): OpenAIStatus { return { configured: !!state.apiConfigured, model: state.apiModel!, imageModel: state.imageModel!, subscription: clone(state.subscription!), codex: { connected: !!state.codexImagesConnected, available: !!state.codexImagesConnected, detail: state.codexImagesConnected ? 'Codex image generation is ready through your ChatGPT subscription.' : 'Sign in to Codex with your ChatGPT subscription to generate images.' } }; }
    function pendingOpenAIChat(idOrPrompt: string) {
      const entry = [...openAIChats].find(([id, job]) => id === idOrPrompt || job.request.messages.filter(message => message.role === 'user').at(-1)?.content === idOrPrompt);
      if (!entry) throw new Error('No pending ChatGPT chat'); return entry;
    }
    function settleOpenAIChat(idOrPrompt: string, text?: string, error?: string) {
      const [id, job] = pendingOpenAIChat(idOrPrompt); openAIChats.delete(id); state.activeJobs--; telemetry();
      if (error) job.reject(new Error(error)); else job.resolve({ text: text || 'ChatGPT completed reply' });
    }
    const api: AphelionBridge = {
      async openaiStatus() { connectionCalls.status++; return openaiStatus(); },
      async startChatGPTLogin() { connectionCalls.starts++; state.subscription = { ...state.subscription!, connected: false, connecting: true, account: undefined, detail: 'Finish signing in with ChatGPT.' }; persist(); return { authorizationUrl: '', expiresAt: Date.now() + 300000 }; },
      async cancelChatGPTLogin() { connectionCalls.cancels++; state.subscription = { ...state.subscription!, connected: false, connecting: false, detail: 'ChatGPT sign-in cancelled.' }; persist(); return clone(state.subscription); },
      async disconnectChatGPT() { connectionCalls.disconnects++; state.subscription = { ...state.subscription!, connected: false, connecting: false, account: undefined, detail: 'Sign in with your ChatGPT subscription.' }; persist(); return clone(state.subscription); },
      async chatGPTModels() { connectionCalls.models++; if (!state.subscription?.connected) throw new Error('Sign in with ChatGPT first.'); return clone(subscriptionModels); },
      async configureOpenAI(input) { if (input.apiKey !== undefined) state.apiConfigured = !!input.apiKey; if (input.model) state.apiModel = input.model; if (input.imageModel) state.imageModel = input.imageModel; persist(); return openaiStatus(); },
      async openaiChat(request) {
        openAIRequests.push(clone(request)); const source = request.source || 'subscription';
        if (source === 'api' ? !state.apiConfigured : !state.subscription?.connected) throw new Error(source === 'api' ? 'Connect an OpenAI API key first.' : 'Sign in with your ChatGPT subscription first.');
        if (failures.chat[source]) throw new Error(failures.chat[source]);
        state.activeJobs++; telemetry();
        if (options.deferredOpenAIChat) return new Promise((resolve, reject) => openAIChats.set(request.requestId, { request: clone(request), resolve, reject }));
        const text = `${source === 'api' ? 'OpenAI' : 'ChatGPT'} response: ${request.messages.filter(message => message.role === 'user').at(-1)?.content}`;
        delta(request.requestId, text); state.activeJobs--; telemetry(); return { text };
      },
      async generateImage(request) {
        imageRequests.push(clone(request)); const source = request.source || 'codex';
        if (source === 'api' ? !state.apiConfigured : !state.codexImagesConnected) throw new Error(source === 'api' ? 'Connect an OpenAI API key first.' : 'Sign in to Codex with your ChatGPT subscription first.');
        if (failures.image[source]) throw new Error(failures.image[source]);
        return {id: crypto.randomUUID(), prompt: request.prompt, created: new Date().toISOString(), src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S+kAAAAASUVORK5CYII='};
      },
      async modelCatalog() { return {
        claude: { models: [{ id: 'sonnet', name: 'Sonnet', description: 'Claude catalog boundary', efforts: ['low', 'medium', 'high', 'max'], isDefault: true }, { id: 'haiku', name: 'Haiku', description: 'Claude catalog boundary', efforts: [] }] },
        codex: { models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra', description: 'Codex catalog boundary', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], isDefault: true }, { id: 'gpt-6-luna', name: 'GPT-6 Luna', description: 'Codex catalog boundary', efforts: ['low', 'medium', 'high'] }] }
      }; },
      async status() { if (options.deferredStatus) return new Promise(resolve => statusReads.push(() => resolve(status()))); if (options.statusDelay) await new Promise(resolve => setTimeout(resolve, options.statusDelay)); return status(); },
      async configure(input) { if (input.models) state.models = clone(input.models); if (input.reasoning) state.reasoning = clone(input.reasoning); if (input.repo !== undefined) state.repo = input.repo; persist(); return status(); },
      async login(agent) { state.connected[agent] = true; if (agent === 'codex') state.codexImagesConnected = true; persist(); return status(); },
      async runtime() { return snapshot(); },
      onRuntimeEvent(handler) { runtimeHandlers.add(handler); return () => runtimeHandlers.delete(handler); },
      onDelta(handler) { deltaHandlers.add(handler); return () => deltaHandlers.delete(handler); },
      async chat(request) {
        if (!state.connected[request.agent]) throw new Error('Subscription sign-in required');
        if (request.mode && request.mode !== 'chat' && !state.project) throw new Error('Select a project first');
        const prompt = request.messages.filter(message => message.role === 'user').at(-1)?.content || '';
        const text = `${request.agent === 'claude' ? 'Claude' : 'Codex'} ${request.mode || 'chat'} response: ${prompt}`;
        state.activeJobs++; telemetry();
        if (options.deferredChat) return new Promise((resolve, reject) => chats.set(request.requestId, { agent: request.agent, request: clone(request), resolve, reject }));
        delta(request.requestId, text); state.activeJobs--; telemetry(); return { ...result(text), memoryPath: remember(request,text) };
      },
      async mission(request) {
        if (!state.project) throw new Error('Select a project first');
        if (!state.connected.claude || !state.connected.codex) throw new Error('Connect both subscriptions');
        state.activeJobs = 2;
        return new Promise((resolve, reject) => {
          mission = { request: clone(request), resolve, reject };
          queueMicrotask(() => { emit({ type: 'mission', source: 'claude', requestId: request.requestId, phase: 'planning', text: 'Claude reading project context' }); telemetry(); delta(`${request.requestId}-claude`, 'Planner read the selected context.'); if (!options.deferredMission) { emit({ type: 'mission', source: 'codex', requestId: request.requestId, phase: 'building', text: 'Codex writing project files' }); delta(`${request.requestId}-codex`, 'Builder editing src/index.ts.'); emit({ type: 'mission', source: 'vault', requestId: request.requestId, phase: 'saving', text: 'Saving mission receipt' }); finishMission(); } });
        });
      },
      async cancel(id) { cancelledRequests.push(id); setTimeout(() => { if (openAIChats.has(id)) settleOpenAIChat(id, undefined, 'Stopped'); else if (mission?.request.requestId === id) { const entry = mission; mission = null; state.activeJobs = 0; telemetry(); entry.reject(new Error('Cancelled by user')); } else { const entry = chats.get(id); if (entry) { chats.delete(id); state.activeJobs--; telemetry(); entry.reject(new Error('Cancelled by user')); } } }, 650); },
      async project() { return clone(state.project); },
      async selectProject() { state.project = { path: 'C:/FixtureProjects/Selected', name: 'Selected project', branch: 'feature/selected', dirty: true }; persist(); telemetry(); return clone(state.project); },
      async createProject(name) { state.project = { path: `C:/FixtureProjects/${name}`, name, branch: 'main', dirty: false }; persist(); telemetry(); return clone(state.project); },
      async listProjectFiles(path = '') { if (!state.project) throw new Error('Select a project first'); if (!path) return [{ path: 'src', name: 'src', kind: 'directory' }, { path: 'README.md', name: 'README.md', kind: 'file' }]; if (path === 'src') return [{ path: 'src/index.ts', name: 'index.ts', kind: 'file' }]; throw new Error('Directory not found'); },
      async readProjectFile(path) { const contents: Record<string, string> = { 'README.md': '# Launchpad\n\nA working local project.', 'src/index.ts': 'export const answer = 42;\n' }; if (!(path in contents)) throw new Error('File not found'); return { path, content: contents[path] }; },
      async runProjectCommand(command) { if (!state.project) throw new Error('Select a project first'); const outputs: Record<string, string> = { status: 'On branch main\nnothing to commit, working tree clean', files: 'README.md\nsrc/index.ts', diff: 'diff --git a/src/index.ts b/src/index.ts\n+export const answer = 42;', test: '2 tests passed', build: 'Build finished: dist/index.js' }; if (!(command in outputs)) throw new Error('Unsupported project command'); emit({ type: 'terminal', source: 'project', text: outputs[command] }); return { code: 0, output: outputs[command] }; },
      async automations() { return [{ id: 'verify-project', name: 'Verify project', status: 'idle', detail: 'Runs the selected project tests.' }, { id: 'index-vault', name: 'Index vault', status: 'idle', detail: 'Reads the connected Markdown notes.' }]; },
      async runAutomation(id) { if (id === 'verify-project') { const output = 'Automated verification: 2 checks passed'; emit({ type: 'terminal', source: 'project', text: output }); return { code: 0, output }; } if (id === 'index-vault') return { code: 0, output: `Indexed ${state.notes.length} Markdown notes` }; throw new Error('Unknown automation'); },
      async obsidian() { return obsidian(); },
      async openObsidian(path) { opens.push(path || null); state.obsidianRunning = true; persist(); telemetry(); return obsidian(); },
      async selectVault() { if (state.activeJobs) throw new Error('Stop the active request first'); state.noteVaults ||= {}; state.noteVaults[state.vaultPath || 'C:/FixtureVault'] = clone(state.notes); state.vaultPath = state.vaultPath === 'C:/OtherFixtureVault' ? 'C:/FixtureVault' : 'C:/OtherFixtureVault'; state.notes = clone(state.noteVaults[state.vaultPath] || []); persist(); return status(); },
      async listNotes() { return clone(state.notes); },
      async vaultGraph() { const nodes = state.notes.map(note => ({ id: note.path, path: note.path, title: note.title, tags: note.path === 'Architecture.md' ? ['design'] : note.path === 'Project Memory.md' ? ['memory', 'project'] : [], excerpt: note.content || '', modified: note.modified })); return { nodes, edges: nodes.some(node => node.id === 'Project Memory.md') && nodes.some(node => node.id === 'Architecture.md') ? [{ from: 'Project Memory.md', to: 'Architecture.md' }] : [], total: nodes.length, truncated: false }; },
      async readNote(path) { const note = state.notes.find(note => note.path === path); if (!note) throw new Error('Note not found'); if (path === options.deferredRead) return new Promise(resolve => { read = () => { read = null; resolve(clone(note)); }; }); return clone(note); },
      async saveNote(note) { if ((note.create && options.deferredCreate) || (!note.create && options.deferredSave)) return new Promise(resolve => { write = () => { write = null; resolve(save(note)); }; }); return save(note); },
      async openExternal() {}, async windowAction() {},
    };
    window.aphelion = api;
    (window as any).__aphelionE2E = {
      streamChat(agent: Agent, text: string) { const entry = [...chats].find(([, job]) => job.agent === agent); if (!entry) throw new Error('No pending chat'); delta(entry[0], text); },
      finishChat: (agent: Agent, text: string) => settleChat(agent, text), failChat: (agent: Agent, error: string) => settleChat(agent, undefined, error),
      missionPhase(phase: string, source: 'claude' | 'codex' | 'vault') { if (!mission) throw new Error('No pending mission'); emit({ type: 'mission', source, requestId: mission.request.requestId, phase, text: `Mission ${phase}` }); },
      streamMission(agent: Agent, text: string) { if (!mission) throw new Error('No pending mission'); delta(`${mission.request.requestId}-${agent}`, text); },
      finishMission,
      failMission(error: string) { if (!mission) throw new Error('No pending mission'); const entry = mission; mission = null; state.activeJobs = 0; telemetry(); entry.reject(new Error(error)); },
      finishRead() { if (!read) throw new Error('No pending note read'); read(); },
      finishWrite() { if (!write) throw new Error('No pending note write'); write(); },
      finishStatus() { statusReads.splice(0).forEach(resolve => resolve()); },
      streamOpenAIChat(idOrPrompt: string, text: string) { delta(pendingOpenAIChat(idOrPrompt)[0], text); },
      finishOpenAIChat: (idOrPrompt: string, text: string) => settleOpenAIChat(idOrPrompt, text),
      failOpenAIChat: (idOrPrompt: string, error: string) => settleOpenAIChat(idOrPrompt, undefined, error),
      openAIRequests: () => clone(openAIRequests), imageRequests: () => clone(imageRequests), cancelledRequests: () => clone(cancelledRequests), connectionCalls: () => clone(connectionCalls),
      failOpenAISource(source: 'subscription' | 'api', error: string) { failures.chat[source] = error; },
      failImageSource(source: 'codex' | 'api', error: string) { failures.image[source] = error; },
      finishChatGPTLogin(account = 'fixture@chatgpt.test') { state.subscription = { ...state.subscription!, connected: true, connecting: false, account, detail: 'ChatGPT subscription connected' }; persist(); },
      setChatGPTModels(models: ChatGPTModel[]) { subscriptionModels = clone(models); },
      updateTelemetry(cpu: number) { state.cpu = cpu; telemetry(); },
      activity(source: RuntimeEvent['source'], text: string) { emit({ type: 'activity', source, text }); },
      openedNativeNotes: () => clone(opens),
    };
  }, options);
  await page.goto(`/${hash}`);
  await expect(page.locator('.workspace-footnote')).toContainText('Vault connected');
}

export const prompt = (page: Page) => page.getByRole('textbox', { name: 'Your prompt', exact: true });
export const vault = (page: Page) => page.getByRole('region', { name: 'Obsidian vault', exact: true });
export async function moduleDialog(page: Page, name: 'Projects' | 'Automations' | 'Files' | 'Terminal') {
  await page.getByRole('group', { name: 'Local engine modules' }).getByRole('button', { name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
