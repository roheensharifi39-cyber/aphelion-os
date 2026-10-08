import type { AphelionBridge, RuntimeEvent } from '../types';

let boot: Promise<void> | null = null;
let source: EventSource | null = null;
let connection: Promise<void> | null = null;
const runtimeHandlers = new Set<(event: RuntimeEvent) => void>();
const deltaHandlers = new Set<(event: { requestId: string; delta: string }) => void>();
async function bootstrap() {
  boot ||= fetch('/__aphelion/bootstrap', { credentials: 'same-origin', cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok || !data.live) throw new Error('Start the Aphelion local engine to use this command center.'); }).catch(error => { boot = null; throw error; });
  await boot;
}
async function stream() {
  await bootstrap();
  if (source?.readyState === EventSource.OPEN) return;
  connection ||= new Promise<void>((resolve, reject) => {
    source ||= new EventSource('/__aphelion/events');
    source.onopen = () => resolve();
    source.onmessage = message => {
      try { const data = JSON.parse(message.data); if (data.channel === 'delta') deltaHandlers.forEach(handler => handler(data.event)); else if (data.channel === 'runtime') runtimeHandlers.forEach(handler => handler(data.event)); } catch { /* A malformed event never changes saved local content. */ }
    };
    source.onerror = () => { runtimeHandlers.forEach(handler => handler({ id: 'engine-offline', time: Date.now(), type: 'activity', source: 'system', text: 'Local engine connection interrupted. Reconnecting.' })); connection = null; reject(new Error('The local engine connection is interrupted.')); };
  });
  await connection;
}
async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  await bootstrap();
  if (method === 'chat' || method === 'mission') await stream();
  const invoke = () => fetch('/__aphelion/rpc', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
  let response = await invoke();
  if (response.status === 401) { boot = null; source?.close(); source = null; connection = null; await bootstrap(); if (method === 'chat' || method === 'mission') await stream(); response = await invoke(); }
  const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || 'The local engine action failed.'); return data.result as T;
}
const browserBridge: AphelionBridge = {
  status: () => rpc('status'), configure: input => rpc('configure', input), login: agent => rpc('login', agent),
  runtime: () => rpc('runtime'), mission: request => rpc('mission', request),
  onRuntimeEvent: handler => { runtimeHandlers.add(handler); void stream().catch(() => {}); return () => runtimeHandlers.delete(handler); },
  chat: request => rpc('chat', request), cancel: id => rpc('cancel', id),
  onDelta: handler => { deltaHandlers.add(handler); void stream().catch(() => {}); return () => deltaHandlers.delete(handler); },
  selectVault: () => rpc('selectVault'), listNotes: () => rpc('listNotes'), vaultGraph: () => rpc('vaultGraph'), readNote: path => rpc('readNote', path), saveNote: note => rpc('saveNote', note),
  project: () => rpc('project'), selectProject: () => rpc('selectProject'), createProject: name => rpc('createProject', name), listProjectFiles: path => rpc('listProjectFiles', path), readProjectFile: path => rpc('readProjectFile', path), runProjectCommand: command => rpc('runProjectCommand', command), automations: () => rpc('automations'), runAutomation: id => rpc('runAutomation', id),
  obsidian: () => rpc('obsidian'), openObsidian: path => rpc('openObsidian', path),
  async openExternal(raw) { const url = new URL(raw); if (url.protocol !== 'https:' || !['github.com','chatgpt.com','claude.ai','code.claude.com','learn.chatgpt.com','developers.openai.com','elevenlabs.io','obsidian.md'].includes(url.hostname)) throw new Error('Unsupported external link.'); window.open(url.href, '_blank', 'noopener,noreferrer'); },
  async windowAction() {},
};
export const api: AphelionBridge = window.aphelion || browserBridge;
