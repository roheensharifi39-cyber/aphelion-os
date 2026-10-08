import { describe, expect, it } from 'vitest';
import { newWorkspace, createSession, appendMessage, updateMessage, hydrateWorkspace } from '../src/lib/workspace';

describe('persistent workspace', () => {
  it('keeps two agents and simultaneous sessions isolated', () => {
    let state = newWorkspace();
    const claude = createSession(state, 'claude'); state = claude.state;
    const codex = createSession(state, 'codex'); state = codex.state;
    state = appendMessage(state, claude.id, { id: 'reply', role: 'assistant', content: '', demo: true });
    state = updateMessage(state, claude.id, 'reply', { content: 'Claude plan' });
    expect(state.sessions.find(s => s.id === claude.id).messages[0].content).toBe('Claude plan');
    expect(state.sessions.find(s => s.id === codex.id).messages).toEqual([]);
    expect(state.active.codex).toBe(codex.id);
    expect(state.active.claude).toBe(claude.id);
  });
  it('round-trips saved history and recovers malformed storage', () => {
    const session = createSession(newWorkspace(), 'codex');
    const state = appendMessage(session.state, session.id, { id: 'prompt', role: 'user', content: 'A castle' });
    expect(hydrateWorkspace(JSON.stringify(state)).sessions[0].messages[0].content).toBe('A castle');
    expect(hydrateWorkspace('{broken').sessions).toEqual([]);
    expect(hydrateWorkspace(JSON.stringify({ sessions: [{ messages: 'wrong' }] })).sessions).toEqual([]);
  });
});
