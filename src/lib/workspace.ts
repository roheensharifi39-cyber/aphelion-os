import type { Agent, Message, Workspace } from '../types';
export const WORKSPACE_KEY = 'aphelion.workspace.v1';
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
    clean.sessions = clean.sessions.map(s => ({ ...s, messages: s.messages.map(m => m.pending ? { ...m, pending: false, error: true, content: m.content || 'This response was interrupted. Please send your prompt again.' } : m) }));
    for (const agent of ['claude', 'codex'] as const) if (!clean.sessions.some(s => s.id === clean.active[agent] && s.agent === agent)) clean.active[agent] = clean.sessions.find(s => s.agent === agent)?.id || null;
    return clean;
  } catch { return newWorkspace(); }
}
