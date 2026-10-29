import type { Agent, Message, Workspace } from '../types';
import { validWindow } from './desktop';
const cleanContexts = (value: unknown): string[] | undefined => Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string').slice(0,8) : undefined;
export const WORKSPACE_KEY = 'aphelion.workspace.v1';
export function vaultKey(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}
export function switchWorkspaceVault(state: Workspace, path: string): Workspace {
  const key = vaultKey(path);
  if (!key || key === vaultKey(state.vaultPath || '')) return state;
  // Legacy conversations are adopted by the first real vault, never discarded.
  if (!state.vaultPath) return { ...state, vaultPath: path };
  const vaults = { ...state.vaults, [vaultKey(state.vaultPath)]: { sessions: state.sessions, active: state.active, drafts: state.drafts, missionDraft: state.missionDraft, gptDrafts: state.gptDrafts, gptSessions: state.gptSessions, imageWindows: state.imageWindows } };
  const saved = vaults[key];
  return { ...state, vaults, vaultPath: path, sessions: saved?.sessions || [], active: saved?.active || { claude: null, codex: null }, drafts: saved?.drafts || { claude: '', codex: '' }, missionDraft: saved?.missionDraft || '', gptDrafts: saved?.gptDrafts || { chat: '', image: '' }, gptSessions: saved?.gptSessions || [], imageWindows: saved?.imageWindows || [] };
}
export function newWorkspace(): Workspace {
  return { version: 1, sessions: [], active: { claude: null, codex: null }, name: 'Overworld', sound: true };
}
export function createSession(state: Workspace, agent: Agent): { state: Workspace; id: string } {
  const id = crypto.randomUUID();
  return { id, state: { ...state, active: { ...state.active, [agent]: id }, sessions: [{ id, agent, title: 'Untitled session', created: new Date().toISOString(), messages: [] }, ...state.sessions] } };
}
export function appendMessage(state: Workspace, sessionId: string, message: Message): Workspace {
  return { ...state, sessions: state.sessions.map(s => s.id === sessionId ? { ...s, title: s.title === 'Untitled session' && message.role === 'user' ? message.content.slice(0, 48) : s.title, messages: [...s.messages, message] } : s) };
}
export function updateMessage(state: Workspace, sessionId: string, messageId: string, patch: Partial<Message>): Workspace {
  return { ...state, sessions: state.sessions.map(s => s.id === sessionId ? { ...s, messages: s.messages.map(m => m.id === messageId ? { ...m, ...patch } : m) } : s) };
}
export function hydrateWorkspace(raw: string | null): Workspace {
  try {
    const state = JSON.parse(raw || 'null');
    if (!state || state.version !== 1 || !Array.isArray(state.sessions) || !state.active || typeof state.name !== 'string' || typeof state.sound !== 'boolean') return newWorkspace();
    if (state.sessions.some((s: any) => !s || typeof s.id !== 'string' || !['claude', 'codex'].includes(s.agent) || typeof s.title !== 'string' || typeof s.created !== 'string' || !Array.isArray(s.messages) || s.messages.some((m: any) => !m || typeof m.id !== 'string' || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string'))) return newWorkspace();
    const clean = state as Workspace;
    if (typeof clean.vaultPath !== 'string') delete clean.vaultPath;
    if (clean.drafts && (typeof clean.drafts.claude !== 'string' || typeof clean.drafts.codex !== 'string')) delete clean.drafts;
    if (typeof clean.missionDraft !== 'string') delete clean.missionDraft;
    if (clean.gptDrafts && (typeof clean.gptDrafts.chat !== 'string' || typeof clean.gptDrafts.image !== 'string')) delete clean.gptDrafts;
    clean.gptSessions = Array.isArray(clean.gptSessions) ? clean.gptSessions.filter(session => session && typeof session.id === 'string' && typeof session.title === 'string' && typeof session.created === 'string' && typeof session.draft === 'string' && ['chat','image'].includes(session.mode) && validWindow(session.window) && Array.isArray(session.messages) && session.messages.every(message => message && typeof message.id === 'string' && ['user','assistant'].includes(message.role) && typeof message.content === 'string')).map(session => ({ ...session, messages: session.messages.map(message => message.pending ? { ...message, pending: false, error: true, content: message.content || 'This response was interrupted. Send your prompt again.' } : message) })) : [];
    clean.imageWindows = Array.isArray(clean.imageWindows) ? clean.imageWindows.filter(image => image && typeof image.id === 'string' && typeof image.prompt === 'string' && typeof image.created === 'string' && validWindow(image.window)) : [];
    if (clean.vaults && typeof clean.vaults === 'object' && !Array.isArray(clean.vaults)) {
      clean.vaults = Object.fromEntries(Object.entries(clean.vaults).flatMap(([key, saved]) => {
        if (!saved || !Array.isArray(saved.sessions) || !saved.active) return [];
        const restored = hydrateWorkspace(JSON.stringify({ sessions: saved.sessions, active: saved.active, drafts: saved.drafts, missionDraft: saved.missionDraft, gptDrafts: saved.gptDrafts, gptSessions: saved.gptSessions, imageWindows: saved.imageWindows, version: 1, name: clean.name, sound: clean.sound }));
        return [[key, { sessions: restored.sessions, active: restored.active, drafts: restored.drafts, missionDraft: restored.missionDraft, gptDrafts: restored.gptDrafts, gptSessions: restored.gptSessions, imageWindows: restored.imageWindows }]];
      }));
    } else delete clean.vaults;
    clean.gptSessions = clean.gptSessions.map(session => ({...session,contextPaths:cleanContexts(session.contextPaths),chatSource:session.chatSource==='api'?'api':'subscription',imageSource:session.imageSource==='api'?'api':'codex',model:typeof session.model==='string'?session.model:undefined}));
    clean.sessions = clean.sessions.map(s => ({ ...s, window: validWindow(s.window) ? s.window : undefined, contextPaths: cleanContexts(s.contextPaths), draft: typeof s.draft === 'string' ? s.draft : '', messages: s.messages.map(m => m.pending ? { ...m, pending: false, error: true, content: m.content || 'This response was interrupted. Please send your prompt again.' } : m) }));
    for (const agent of ['claude', 'codex'] as const) if (!clean.sessions.some(s => s.id === clean.active[agent] && s.agent === agent)) clean.active[agent] = clean.sessions.find(s => s.agent === agent)?.id || null;
    return clean;
  } catch { return newWorkspace(); }
}
