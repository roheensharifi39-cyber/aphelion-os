import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initializeVault, listNotes, readNote, saveNote, ensureVaultDirectory } from './vault.mjs';
import { buildVaultGraph } from './graph.mjs';
import { runSubscriptionChat, subscriptionStatus, loginSubscription, validateReasoning } from './subscriptions.mjs';
import { createModelCatalog } from './models.mjs';
import { createOpenAIService, validateOpenAIMessages } from './openai.mjs';
import { createChatGPTSubscriptionService } from './chatgpt-subscription.mjs';
import { createCodexImageService } from './codex-images.mjs';
import { buildVaultContext, formatVaultContext } from './vault-context.mjs';
const execute = promisify(execFile);

export function missionSteps(id) { return { planning: `${id}-claude`, building: `${id}-codex` }; }
export function validRequestId(id) { return typeof id === 'string' && /^[\w-]{1,100}$/.test(id); }
export function missionHasEvidence(changedFiles, successfulCommands) { return changedFiles.length > 0 || successfulCommands > 0; }
export function conversationTitle(prompt) {
  const title = String(prompt || '').normalize('NFKC').split('\n')[0].replace(/[<>:"/\\|?*\[\]#\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64).replace(/[. ]+$/, '');
  return title || 'Conversation';
}
async function projectSnapshot(root) {
  const result = new Map();
  async function walk(folder, depth = 0) {
    if (depth > 10 || result.size >= 4000) return;
    const actual = await realpath(folder), rel = relative(root, actual);
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile()) { const info = await stat(path); result.set(relative(root, path), `${info.size}:${info.mtimeMs}`); }
      if (result.size >= 4000) break;
    }
  }
  await walk(root); return result;
}
export function defaultDataDirectory() { return process.env.APHELION_TEST_HOME || (process.platform === 'win32' ? join(process.env.APPDATA || homedir(), 'aphelion-os') : join(homedir(), '.local', 'share', 'aphelion-os')); }
export async function chooseNativeFolder() {
  if (process.platform !== 'win32') throw new Error('Use the desktop app folder picker on this device.');
  const script = "Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = 'Choose a project or Obsidian vault folder'; if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($picker.SelectedPath) }; $picker.Dispose()";
  const result = await execute('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, maxBuffer: 10000 });
  return result.stdout.trim() || null;
}
export async function createRuntime({ dataDirectory = defaultDataDirectory(), desktop = false, selectFolder = chooseNativeFolder, openExternal = async () => {}, getNetwork = () => ({ online: true, clients: 0, received: 0, sent: 0 }), agentRunner = runSubscriptionChat, authProvider = subscriptionStatus, obsidianFactory, openaiSecureStorage, openaiEnvironment = process.env, openaiFetch = globalThis.fetch, openaiRequestTimeoutMs, openaiImageTimeoutMs, chatGPTFactory = createChatGPTSubscriptionService, codexImageFactory = createCodexImageService } = {}) {
  const [{ createProjectManager }, { createTelemetry }, { createObsidianAdapter }] = await Promise.all([import('./projects.mjs'), import('./telemetry.mjs'), import('./obsidian.mjs')]);
  const root = resolve(dataDirectory); await mkdir(root, { recursive: true });
  const file = join(root, 'preferences.json');
  let config = { models: { claude: 'auto', codex: 'auto' }, reasoning: { claude: 'auto', codex: 'auto' }, repo: 'https://github.com/roheensharifi39-cyber/aphelion-os', vaultPath: join(root, 'vault'), projectPath: '' };
  try { const saved = JSON.parse(await readFile(file, 'utf8')); for (const key of ['models', 'reasoning', 'repo', 'vaultPath', 'projectPath']) if (saved[key]) config[key] = saved[key]; } catch { /* Fresh local installation. */ }
  await initializeVault(join(root, 'vault'));
  const workbench = join(root, 'workbench'); await mkdir(workbench, { recursive: true });
  const events = new EventEmitter(), jobs = new Map(), logins = new Map();
  let disposed = false, switching = false, auth = null, authAt = 0, authPending = null, writing = Promise.resolve(), snapshotPending = null;
  const modelCatalog = createModelCatalog({ cwd: workbench });
  const history = [];
  function emit(partial) {
    if (disposed) return;
    const event = { id: randomUUID(), time: Date.now(), source: 'system', ...partial, text: partial.text || partial.message };
    if (event.type !== 'telemetry') { history.push(event); if (history.length > 100) history.shift(); }
    events.emit('event', event);
  }
  const openai = await createOpenAIService({ dataDirectory: root, env: openaiEnvironment, fetchImpl: openaiFetch, secureStorage: openaiSecureStorage, requestTimeoutMs: openaiRequestTimeoutMs, imageTimeoutMs: openaiImageTimeoutMs, onNotice: text => emit({ type: 'activity', source: 'system', text }) });
  const chatGPT = await chatGPTFactory({ dataDirectory: root, secureStorage: openaiSecureStorage, fetchImpl: openaiFetch, requestTimeoutMs: openaiRequestTimeoutMs, onStatus: state => emit({ type: 'activity', source: 'system', text: state.connected ? 'ChatGPT subscription connected' : 'ChatGPT connection updated' }) });
  const codexImages = await codexImageFactory({ dataDirectory: root, timeoutMs: openaiImageTimeoutMs });
  async function openaiConnections() { return { ...openai.status(), subscription: chatGPT.status(), codex: await codexImages.status() }; }
  async function persist(next) {
    writing = writing.catch(() => {}).then(async () => { const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx' }); await rename(temporary, file); config = next; });
    await writing;
  }
  function idle() { if (switching || jobs.size || projects.activeJobs()) throw new Error('Finish or stop the current operation before changing projects or vaults.'); }
  async function switchWorkspace(action) { idle(); switching = true; try { return await action(); } finally { switching = false; } }
  const projects = createProjectManager({ getProjectPath: () => config.projectPath, setProjectPath: async path => persist({ ...config, projectPath: path }), projectsRoot: join(root, 'projects'), selectFolder, onEvent: emit });
  const obsidian = (obsidianFactory || createObsidianAdapter)({ getVaultPath: () => config.vaultPath, onEvent: emit });
  if (!process.env.APHELION_TEST_HOME && resolve(root) === resolve(defaultDataDirectory()) && config.vaultPath === join(root, 'vault')) {
    const discovered = await obsidian.discoverVaults();
    const active = discovered.find(vault => vault.open && /aphelion/i.test(vault.name)) || discovered.find(vault => vault.open);
    if (active) { const path = await realpath(active.path); await listNotes(path); await persist({ ...config, vaultPath: path }); emit({ type: 'activity', source: 'vault', text: `Connected active Obsidian vault: ${active.name}` }); }
  }
  await obsidian.watch();
  let obsidianProcesses = [];
  const telemetry = createTelemetry({ getProcesses: () => [{ pid: process.pid, name: 'Aphelion local engine', role: 'system' }, ...[...jobs.values()].filter(job => job.pid).map(job => ({ pid: job.pid, name: job.agent === 'claude' ? 'Claude Code' : 'Codex', role: job.agent })), ...projects.processes(), ...obsidianProcesses], getActiveJobs: () => jobs.size + projects.activeJobs(), getProject: () => projects.info(), getObsidian: async () => { const [info, processes] = await Promise.all([obsidian.status(), obsidian.processes?.() || []]); obsidianProcesses = processes; return info; }, getNetwork });
  async function status(force = false) {
    if (force || !auth || Date.now() - authAt > 10000) {
      authPending ||= authProvider().then(value => { auth = value; authAt = Date.now(); return value; }).finally(() => { authPending = null; });
      await authPending;
    }
    return { desktop, ...auth, models: config.models, reasoning: config.reasoning, repo: config.repo, vaultPath: config.vaultPath };
  }
  function normalizeClientEvent(agent, requestId, event) {
    const item = event.item;
    const job = jobs.get(requestId);
    if (job && item?.type === 'command_execution' && item.status === 'completed' && item.exit_code === 0) job.successfulCommands = (job.successfulCommands || 0) + 1;
    if (item?.type === 'command_execution') emit({ type: 'terminal', source: agent, requestId, text: [item.command, item.aggregated_output].filter(Boolean).join('\n').slice(-50000), data: { status: item.status, exitCode: item.exit_code } });
    else if (item?.type === 'file_change') emit({ type: 'activity', source: agent, requestId, text: 'Updated project files', data: item.changes });
    else if (event.type === 'assistant') for (const block of event.message?.content || []) if (block.type === 'tool_use') emit({ type: 'activity', source: agent, requestId, text: `Using ${block.name}`, data: { tool: block.name } });
  }
  async function run(request, job, cwd, snapshot) {
    try { return await agentRunner(request, snapshot, { cwd, signal: job.controller.signal, onProcess: pid => { job.pid = pid; job.agent = request.agent; emit({ type: 'activity', source: request.agent, requestId: job.id, text: `${request.agent === 'claude' ? 'Claude Code' : 'Codex'} process started`, data: { pid } }); }, onDelta: delta => events.emit('delta', { requestId: request.requestId, delta }), onEvent: event => normalizeClientEvent(request.agent, job.id, event) }); }
    finally { job.pid = null; }
  }
  function take(id, agent) { if (switching) throw new Error('Finish choosing your project or vault before starting an agent.'); if (!validRequestId(id) || jobs.has(id) || jobs.size >= 4) throw new Error('Start a valid request or wait for an active mission.'); const job = { id, agent, controller: new AbortController(), pid: null }; jobs.set(id, job); return job; }
  async function quotedContext(paths, vaultPath, requestId, messages, signal) {
    const context = await buildVaultContext(vaultPath, messages, paths, signal);
    const job = jobs.get(requestId);
    if (job) job.contextPaths = context.notes.map(note => note.path);
    for (const warning of context.warnings) emit({ type: 'activity', source: 'vault', requestId, text: warning });
    if (context.notes.length) emit({ type: 'activity', source: 'vault', requestId, text: 'Read ' + context.automaticPaths.length + ' automatic and ' + (context.notes.length - context.automaticPaths.length) + ' pinned vault notes', data: { paths: context.notes.map(note => note.path), automaticPaths: context.automaticPaths } });
    return formatVaultContext(context);
  }
  async function rememberConversation(request, result, job, vaultPath, agent) {
    if (job.controller.signal.aborted || !result.text?.trim()) return {};
    try {
      await ensureVaultDirectory(vaultPath, 'Aphelion/Conversations');
      const links = [...new Set(job.contextPaths || request.contextPaths || [])];
      if (request.previousMemoryPath) {
        try { await readNote(vaultPath, request.previousMemoryPath); links.push(request.previousMemoryPath); } catch { /* Missing previous notes never block a reply. */ }
      }
      const prompt = request.messages.findLast(message => message.role === 'user')?.content || '';
      const title = conversationTitle(prompt), memoryPath = `Aphelion/Conversations/${title} - ${randomUUID()}.md`;
      const label = { claude: 'Claude', codex: 'Codex', openai: 'ChatGPT' }[agent];
      const transcript = agent === 'openai' ? request.messages.map(message => `## ${message.role === 'user' ? 'You' : label}\n\n${message.content}`).join('\n\n') : `## You\n\n${prompt}`;
      if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      await saveNote(vaultPath, { path: memoryPath, create: true, content: `---\ntags: [aphelion, conversation, ${agent}]\ncreated: ${new Date().toISOString()}\n---\n# ${title}\n\n${transcript}\n\n## ${label}\n\n${result.text}\n\n${links.length ? '## Related memory\n\n' + [...new Set(links)].map(path => '- [[' + path.replace(/\.md$/, '') + ']]').join('\n') : ''}\n` });
      emit({ type: 'vault', source: 'vault', requestId: job.id, text: 'Conversation remembered in the active vault', data: { path: memoryPath } });
      return { memoryPath };
    } catch (error) {
      if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const memoryWarning = `Reply received, but vault memory could not be saved: ${error.message}`;
      emit({ type: 'activity', source: 'vault', requestId: job.id, text: memoryWarning });
      return { memoryWarning };
    }
  }
  async function sample() { snapshotPending ||= telemetry.sample().finally(() => { snapshotPending = null; }); return snapshotPending; }
  const pulse = setInterval(() => { void sample().then(data => emit({ type: 'telemetry', data })).catch(error => emit({ type: 'activity', text: `Telemetry unavailable: ${error.message}` })); }, 1000); pulse.unref?.();
  const methods = {
    status: () => status(true),
    openaiStatus: openaiConnections,
    startChatGPTLogin: async () => { idle(); const login = await chatGPT.startLogin(); if (desktop) { try { await openExternal(login.authorizationUrl); } catch { chatGPT.cancelLogin(); throw new Error('The sign-in browser could not open. Try again.'); } return { authorizationUrl: '', expiresAt: login.expiresAt }; } return login; },
    cancelChatGPTLogin: () => chatGPT.cancelLogin(),
    disconnectChatGPT: async () => { idle(); return chatGPT.disconnect(); },
    chatGPTModels: () => chatGPT.models(),
    configureOpenAI: async input => { await openai.configure(input); emit({ type: 'activity', text: 'Updated the optional OpenAI API connection' }); return openaiConnections(); },
    openaiChat: async request => {
      const messages = validateOpenAIMessages(request?.messages);
      const source = request.source || 'subscription'; if (!['subscription','api'].includes(source)) throw new Error('Choose ChatGPT subscription or API key for this conversation.');
      const job = take(request.requestId, 'openai'), vaultPath = config.vaultPath;
      emit({ type: 'mission', source: 'system', requestId: job.id, phase: 'chat', text: 'ChatGPT request started' });
      try {
        const context = await quotedContext(request.contextPaths, vaultPath, job.id, messages, job.controller.signal);
        if (context) messages.at(-1).content += `\n\nSelected vault context (quoted reference):\n${context}`;
        const result = source === 'api' ? await openai.chat(messages, { signal: job.controller.signal }) : await chatGPT.chat(messages, { signal: job.controller.signal, model: request.model, onDelta: delta => events.emit('delta', { requestId: job.id, delta }) });
        const memory = await rememberConversation(request, result, job, vaultPath, 'openai');
        if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        emit({ type: 'mission', source: 'system', requestId: job.id, phase: 'completed', text: 'ChatGPT response completed' });
        return { ...result, ...memory };
      } catch (error) { emit({ type: 'mission', source: 'system', requestId: job.id, phase: job.controller.signal.aborted ? 'stopped' : 'failed', text: error.message }); throw error; }
      finally { jobs.delete(job.id); }
    },
    generateImage: async request => {
      if (!request || typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 32000) throw new Error('Describe an image below 32,000 characters.');
      const source = request.source || 'codex'; if (!['codex','api'].includes(source)) throw new Error('Choose Codex subscription or API key for image generation.');
      const job = take(request.requestId, source === 'codex' ? 'codex' : 'openai'), vaultPath = config.vaultPath;
      emit({ type: 'mission', source: 'system', requestId: job.id, phase: 'image', text: source === 'codex' ? 'Generating an image with your Codex subscription' : 'Generating an image with the optional API connection' });
      try {
        const image = source === 'api' ? await openai.image(request.prompt, { signal: job.controller.signal }) : await codexImages.image(request.prompt, { signal: job.controller.signal, onProcess: pid => { job.pid = pid; } });
        if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        try {
          await ensureVaultDirectory(vaultPath, 'Aphelion/Images');
          const filename = `${conversationTitle(image.prompt)} - ${image.id}.png`;
          await writeFile(join(vaultPath, 'Aphelion', 'Images', filename), Buffer.from(image.src.split(',')[1], 'base64'), { flag: 'wx' });
          emit({ type: 'vault', source: 'vault', requestId: job.id, text: 'Generated image saved in the active vault', data: { path: `Aphelion/Images/${filename}` } });
        } catch { emit({ type: 'activity', source: 'vault', requestId: job.id, text: 'Image received, but it could not be saved in the vault. Use Download to keep a copy.' }); }
        if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        emit({ type: 'mission', source: 'system', requestId: job.id, phase: 'completed', text: 'Image generation completed' });
        return image;
      } catch (error) { emit({ type: 'mission', source: 'system', requestId: job.id, phase: job.controller.signal.aborted ? 'stopped' : 'failed', text: error.message }); throw error; }
      finally { jobs.delete(job.id); }
    },
    modelCatalog,
    configure: async input => {
      if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['models', 'reasoning', 'repo'].includes(key))) throw new Error('Only model, reasoning and repository preferences are supported. API keys are not accepted.');
      const next = { ...config, models: { ...config.models }, reasoning: { ...config.reasoning } };
      if (input.models) for (const agent of ['claude', 'codex']) { if (!/^[\w./:-]{1,100}$/.test(input.models[agent])) throw new Error('Enter a model ID or auto.'); next.models[agent] = input.models[agent]; }
      if (input.reasoning) for (const agent of ['claude', 'codex']) { validateReasoning(agent, input.reasoning[agent]); next.reasoning[agent] = input.reasoning[agent]; }
      if (input.repo !== undefined) { if (input.repo && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(input.repo)) throw new Error('Use https://github.com/owner/repo.'); next.repo = input.repo; }
      await persist(next); emit({ type: 'activity', text: 'Updated local preferences' }); return status();
    },
    login: async agent => { if (!['claude', 'codex'].includes(agent)) throw new Error('Choose Claude or Codex.'); if (!logins.has(agent)) logins.set(agent, loginSubscription(agent).finally(() => logins.delete(agent))); await logins.get(agent); return status(true); },
    runtime: sample,
    chat: async request => {
      const mode = request.mode || 'chat', project = mode === 'chat' ? null : await projects.info();
      if (mode !== 'chat' && !project) throw new Error('Connect or create a project before planning or building.');
      const job = take(request.requestId, request.agent), snapshot = { ...config, models: { ...config.models }, reasoning: { ...config.reasoning } };
      emit({ type: 'mission', source: request.agent, requestId: job.id, phase: mode, text: `${mode} request started` });
      try {
        const context = await quotedContext(request.contextPaths, snapshot.vaultPath, job.id, request.messages, job.controller.signal);
        const messages = request.messages.map(message => ({ ...message }));
        if (context) { const lastUser = messages.findLast(message => message.role === 'user'); if (!lastUser) throw new Error('Provide a user prompt.'); lastUser.content += `\n\nSelected vault context (quoted reference):\n${context}`; }
        const result = await run({ ...request, messages }, job, project?.path || workbench, snapshot);
        const memory = await rememberConversation(request, result, job, snapshot.vaultPath, request.agent);
        if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        emit({ type: 'mission', source: request.agent, requestId: job.id, phase: 'completed', text: 'Agent response completed' });
        return { ...result, ...memory };
      }
      catch (error) { emit({ type: 'mission', source: request.agent, requestId: job.id, phase: job.controller.signal.aborted ? 'stopped' : 'failed', text: error.message }); throw error; }
      finally { jobs.delete(job.id); }
    },
    mission: async request => {
      if (!request || typeof request.task !== 'string' || !request.task.trim() || request.task.length > 20000) throw new Error('Describe a mission below 20,000 characters.');
      const project = await projects.info(); if (!project) throw new Error('Connect or create a project first. Your mission will build files in that folder.');
      const job = take(request.requestId, 'claude'), steps = missionSteps(job.id), snapshot = { ...config, models: { ...config.models }, reasoning: { ...config.reasoning } };
      try {
        const before = await projectSnapshot(project.path);
        const context = await quotedContext(request.contextPaths, snapshot.vaultPath, job.id, [{ role: 'user', content: request.task }], job.controller.signal);
        emit({ type: 'mission', source: 'claude', requestId: job.id, phase: 'planning', text: `Planning in ${project.name}` });
        const plan = await run({ agent: 'claude', mode: 'plan', requestId: steps.planning, messages: [{ role: 'user', content: `Plan this mission for the current project. Inspect source files as needed. Give a concrete implementation and verification plan.\n\nMission: ${request.task}\n\nSelected vault context (quoted):\n${context}` }] }, job, project.path, snapshot);
        if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        emit({ type: 'mission', source: 'codex', requestId: job.id, phase: 'building', text: `Building real files in ${project.name}` });
        const build = await run({ agent: 'codex', mode: 'build', requestId: steps.building, messages: [{ role: 'user', content: `Implement this mission in the current project using the plan below. Make real files, run meaningful checks, and report actual results.\n\nMission: ${request.task}\n\nPlan:\n${plan.text}\n\nSelected vault context (quoted):\n${context}` }] }, job, project.path, snapshot);
        if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const after = await projectSnapshot(project.path);
        const changedFiles = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path));
        const checks = [];
        const recipes = await projects.automations();
        for (const recipe of recipes.filter(recipe => ['test', 'build'].includes(recipe.id))) {
          emit({ type: 'mission', source: 'system', requestId: job.id, phase: 'verifying', text: `Running actual ${recipe.name}` });
          const check = await projects.runAutomation(recipe.id, { signal: job.controller.signal }); checks.push({ name: recipe.name, code: check.code, output: check.output.slice(-30000) });
          if (check.code !== 0) throw new Error(`Mission verification failed: ${recipe.name}. Partial output is retained; the mission is not complete.`);
        }
        if (job.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        if (!missionHasEvidence(changedFiles, job.successfulCommands || 0)) throw new Error('The agent did not change files or complete a command. Review its permission report; this mission is not complete.');
        emit({ type: 'mission', source: 'vault', requestId: job.id, phase: 'saving', text: 'Saving the mission receipt to shared memory' });
        const receiptPath = `Mission ${new Date().toISOString().replace(/[:.]/g, '-')} ${job.id.slice(0, 6)}.md`;
        await saveNote(snapshot.vaultPath, { path: receiptPath, create: true, content: `---\ntags: [mission, receipt]\n---\n# ${request.task.slice(0, 100)}\n\nProject: ${project.name}\n\n## Verified effects\n\nChanged files: ${changedFiles.join(', ') || 'No file changes'}\n\n${checks.map(check => `${check.name}: exit ${check.code}\n\n\`\`\`text\n${check.output}\n\`\`\``).join('\n\n') || 'No package test/build recipes configured; inspect the actual agent command results below.'}\n\n## Claude plan\n\n${plan.text}\n\n## Codex result\n\n${build.text}\n\n[[Project Memory]]\n` });
        emit({ type: 'mission', source: 'system', requestId: job.id, phase: 'completed', text: 'Mission completed; receipt saved', data: { receiptPath } });
        return { plan: plan.text, build: build.text, project: await projects.info(), receiptPath };
      } catch (error) { emit({ type: 'mission', source: 'system', requestId: job.id, phase: job.controller.signal.aborted ? 'stopped' : 'failed', text: error.message }); throw error; }
      finally { jobs.delete(job.id); }
    },
    cancel: async id => { jobs.get(id)?.controller.abort(); },
    selectVault: () => switchWorkspace(async () => { const path = await selectFolder(); if (!path) return null; const resolved = await realpath(path); await listNotes(resolved); await persist({ ...config, vaultPath: resolved }); await obsidian.watch(); emit({ type: 'vault', source: 'vault', text: 'Connected a real vault folder' }); return status(); }),
    listNotes: () => listNotes(config.vaultPath), vaultGraph: () => buildVaultGraph(config.vaultPath), readNote: path => readNote(config.vaultPath, path),
    saveNote: async note => { const result = await saveNote(config.vaultPath, note); emit({ type: 'vault', source: 'vault', text: `Saved note: ${result.title}`, data: { path: result.path } }); return result; },
    project: () => projects.info(), selectProject: () => switchWorkspace(() => projects.select()), createProject: name => switchWorkspace(() => projects.create(name)),
    listProjectFiles: path => projects.list(path), readProjectFile: path => projects.read(path), runProjectCommand: command => projects.command(command), automations: () => projects.automations(), runAutomation: id => projects.runAutomation(id),
    obsidian: () => obsidian.status(), openObsidian: path => obsidian.open(path),
    openExternal: async raw => { const url = new URL(raw); if (url.protocol !== 'https:' || !['github.com','chatgpt.com','claude.ai','code.claude.com','learn.chatgpt.com','developers.openai.com','elevenlabs.io','obsidian.md'].includes(url.hostname)) throw new Error('Unsupported external link.'); await openExternal(url.href); },
  };
  return { methods, invoke: async (name, args = []) => { if (disposed || !Object.hasOwn(methods, name)) throw new Error('This local engine action is unavailable.'); return methods[name](...args); }, onEvent: callback => { events.on('event', callback); return () => events.off('event', callback); }, onDelta: callback => { events.on('delta', callback); return () => events.off('delta', callback); }, history: () => [...history], dispose: () => { disposed = true; clearInterval(pulse); for (const job of jobs.values()) job.controller.abort(); openai.dispose(); chatGPT.dispose(); codexImages.dispose(); projects.dispose(); obsidian.dispose(); telemetry.dispose(); events.removeAllListeners(); } };
}
