import { describe, expect, it } from 'vitest';
import { newWorkspace, createSession, appendMessage, updateMessage, hydrateWorkspace, switchWorkspaceVault } from '../src/lib/workspace';

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
  it('restores independent conversations and drafts when returning to a vault', () => {
    let state = switchWorkspaceVault(newWorkspace(), 'C:/Vaults/First');
    const first = createSession(state,'claude'); state = first.state;
    state = appendMessage(state,first.id,{id:'one',role:'user',content:'First vault only'});
    state.drafts = {claude:'Unsent idea',codex:''};
    state.gptDrafts = {chat:'A ChatGPT question',image:'A lunar landscape'};
    state = switchWorkspaceVault(state,'C:/Vaults/Second');
    expect(state.sessions).toEqual([]); expect(state.drafts.claude).toBe('');
    expect(state.gptDrafts).toEqual({chat:'',image:''});
    state = createSession(state,'codex').state;
    state = hydrateWorkspace(JSON.stringify(state));
    state = switchWorkspaceVault(state,'c:\\vaults\\first\\');
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].messages[0].content).toBe('First vault only');
    expect(state.drafts.claude).toBe('Unsent idea');
    expect(state.gptDrafts).toEqual({chat:'A ChatGPT question',image:'A lunar landscape'});
    expect(state.active.claude).toBe(first.id);
  });
  it('adopts legacy conversations into the first real vault without losing them', () => {
    const legacy = createSession(newWorkspace(),'codex').state;
    expect(switchWorkspaceVault(legacy,'C:/Vault').sessions).toEqual(legacy.sessions);
  });
  it('ignores malformed ChatGPT composer drafts without losing saved conversations', () => {
    const state = createSession(newWorkspace(),'codex').state;
    state.gptDrafts = {chat:42,image:'Keep this image idea'};
    const restored = hydrateWorkspace(JSON.stringify(state));
    expect(restored.gptDrafts).toBeUndefined();
    expect(restored.sessions).toHaveLength(1);
  });
  it('keeps named OpenAI windows and image layouts scoped through vault switching and reload', () => {
    const layout = {x:120,y:140,width:380,height:400,order:8,open:true,minimized:false};
    let state = switchWorkspaceVault(newWorkspace(),'C:/First');
    state.gptSessions = [{id:'gpt-one',title:'Launch directions',created:'today',mode:'chat',draft:'Continue here',contextPaths:['Architecture.md'],messages:[{id:'reply',role:'assistant',content:'A partial reply',pending:true}],window:layout}];
    state.imageWindows = [{id:'image-one',prompt:'A moonlit lake',created:'today',window:{...layout,open:false}}];
    state = switchWorkspaceVault(state,'C:/Second');
    expect(state.gptSessions).toEqual([]); expect(state.imageWindows).toEqual([]);
    state = switchWorkspaceVault(hydrateWorkspace(JSON.stringify(state)),'c:\\first');
    expect(state.gptSessions[0]).toMatchObject({title:'Launch directions',draft:'Continue here',window:layout,contextPaths:['Architecture.md']});
    expect(state.gptSessions[0].messages[0]).toMatchObject({content:'A partial reply',pending:false,error:true});
    expect(state.imageWindows[0]).toMatchObject({id:'image-one',window:{...layout,open:false}});
  });
});
