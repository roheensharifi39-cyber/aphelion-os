import { describe, expect, it } from 'vitest';
import { agentActivity } from '../src/lib/agent-activity';

const status = { connected: { claude: true, codex: true }, auth: { claude: { installed: true, detail: 'Connected' }, codex: { installed: true, detail: 'Connected' } } };
const session = (id, agent, messages = []) => ({ id, agent, title: id, messages, created: '', contextPaths: ['Architecture.md'] });
describe('observed membrane activity', () => {
  it('does not infer work from a saved pending message after reconnect', () => {
    expect(agentActivity('codex', [session('old', 'codex', [{ role: 'assistant', pending: true }])], {}, status, true, null).state).toBe('ready');
  });
  it('shows a mission builder queued while the planner is running', () => {
    const sessions = [session('a', 'claude'), session('b', 'codex')], pending = { a: 'mission-claude', b: 'mission-codex' };
    const mission = { id: 'mission', phase: 'planning', task: 'Build' };
    expect(agentActivity('claude', sessions, pending, status, true, mission).state).toBe('working');
    expect(agentActivity('codex', sessions, pending, status, true, mission).state).toBe('queued');
    expect(agentActivity('claude', sessions, pending, status, true, { ...mission, phase: 'building' }).label).toBe('Plan ready');
    expect(agentActivity('codex', sessions, pending, status, true, { ...mission, phase: 'verifying' }).state).toBe('queued');
    const owned = { ...mission, sessionIds: ['a', 'b'], phase: 'building' };
    expect(agentActivity('claude', sessions, { b: 'mission-codex' }, status, true, owned).label).toBe('Plan ready');
    expect(agentActivity('codex', sessions, {}, status, true, { ...owned, phase: 'saving' }).label).toBe('Saving receipt');
  });
  it('keeps independent requests working during a mission', () => {
    const activity = agentActivity('codex', [session('b', 'codex'), session('other', 'codex')], { b: 'mission-codex', other: 'request' }, status, true, { id: 'mission', phase: 'planning' });
    expect(activity.state).toBe('working'); expect(activity.session.id).toBe('other'); expect(activity.count).toBe(2);
  });
  it('only exposes saved output for a successful settled response', () => {
    const saved = { ...session('a', 'claude', [{ role: 'assistant', content: 'Done' }]), memoryPath: 'Saved.md' };
    expect(agentActivity('claude', [saved], {}, status, true, null).outputPath).toBe('Saved.md');
    saved.messages[0].error = true;
    expect(agentActivity('claude', [saved], {}, status, true, null).state).toBe('error');
    expect(agentActivity('claude', [saved], {}, status, true, null).outputPath).toBeUndefined();
    expect(agentActivity('claude', [saved], {}, status, false, null).label).toBe('Engine unavailable');
  });
});
