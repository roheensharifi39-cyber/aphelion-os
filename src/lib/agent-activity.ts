import type { Agent, Session, Status } from '../types';

export type MissionActivity = { id: string; task: string; phase: string; sessionIds?: string[] } | null;
export type AgentActivity = {
  agent: Agent; state: 'checking' | 'offline' | 'ready' | 'working' | 'queued' | 'complete' | 'error';
  label: string; session?: Session; contextPaths: string[]; outputPath?: string; count: number;
};

// Request ownership, rather than the selected provider, determines activity.
export function agentActivity(agent: Agent, sessions: Session[], pending: Record<string, string>, status: Status, engineOnline: boolean, mission: MissionActivity): AgentActivity {
  const active = sessions.filter(session => session.agent === agent && pending[session.id]);
  const session = active.find(session => !mission || !pending[session.id].startsWith(mission.id)) || active[0]
    || sessions.find(session => session.agent === agent && mission?.sessionIds?.includes(session.id))
    || sessions.find(session => session.agent === agent);
  const base = { agent, session, contextPaths: session?.contextPaths || [], count: active.length };
  if (!engineOnline) return { ...base, state: 'offline', label: 'Engine unavailable' };
  if (active.length || mission?.sessionIds?.includes(session?.id || '')) {
    const missionOnly = !!mission && active.every(session => pending[session.id].startsWith(mission.id));
    if (missionOnly && mission.phase === 'stopping') return { ...base, state: 'working', label: 'Stopping' };
    if (missionOnly && mission.phase === 'planning') return { ...base, state: agent === 'claude' ? 'working' : 'queued', label: agent === 'claude' ? 'Planning' : 'Queued for plan' };
    if (missionOnly && mission.phase === 'building') return { ...base, state: agent === 'codex' ? 'working' : 'complete', label: agent === 'codex' ? 'Building' : 'Plan ready' };
    if (missionOnly && ['verifying', 'saving', 'completed'].includes(mission.phase)) return { ...base, state: 'queued', label: mission.phase === 'verifying' ? 'Project verification' : mission.phase === 'saving' ? 'Saving receipt' : 'Finishing mission' };
    return { ...base, state: 'working', label: active.length > 1 ? `Working · ${active.length} tasks` : 'Working' };
  }
  if (status.auth[agent].detail.startsWith('Checking')) return { ...base, state: 'checking', label: 'Checking connection' };
  if (!status.connected[agent]) return { ...base, state: 'offline', label: status.auth[agent].installed ? 'Sign-in required' : 'Not installed' };
  const reply = session?.messages.filter(message => message.role === 'assistant').at(-1);
  if (reply?.error) return { ...base, state: 'error', label: 'Request interrupted' };
  if (reply && !reply.pending && reply.content.trim()) return { ...base, state: 'complete', label: 'Response ready', outputPath: session?.memoryPath };
  return { ...base, state: 'ready', label: 'Ready' };
}
