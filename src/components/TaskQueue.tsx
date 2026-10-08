import { useState } from 'react';
import type { Session } from '../types';
import { PixelIcon } from './PixelIcon';

type MissionState = 'active' | 'completed' | 'failed' | 'ready';
export function missionState(session: Session, pending: Record<string, string>): MissionState {
  if (pending[session.id]) return 'active';
  const last = session.messages.at(-1);
  if (last?.error) return 'failed';
  if (last?.role === 'assistant' && last.content.trim()) return 'completed';
  return 'ready';
}
export function TaskQueue({ sessions, pending, open, retry }: { sessions: Session[]; pending: Record<string, string>; open: (id: string) => void; retry: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const filtered = sessions.filter(session => filter === 'all' || missionState(session, pending) === filter);
  return <section className="reference-panel task-queue" aria-label="Task queue"><div className="reference-heading"><div><PixelIcon name="flow" size={15} /><h2>TASK QUEUE</h2><span className="queue-count">{filtered.length}</span></div><div className="panel-filters" aria-label="Task queue filters">{(['all', 'active', 'completed'] as const).map(state => <button key={state} aria-label={state[0].toUpperCase() + state.slice(1)} className={filter === state ? 'active' : ''} aria-pressed={filter === state} onClick={() => setFilter(state)}>{state.toUpperCase()}</button>)}</div></div><div className="queue-list">{filtered.length ? filtered.map((session, i) => {
    const state = missionState(session, pending), last = session.messages.at(-1);
    const detail = state === 'active' ? 'Response in progress' : state === 'failed' ? 'Response interrupted · retry available' : state === 'completed' ? last?.demo ? 'Demo response received' : 'Agent response received' : 'Ready for a prompt';
    return <div className={`queue-row ${session.agent} ${state}`} key={session.id}><span className="queue-number">{String(i + 1).padStart(2, '0')}</span><i className="queue-light" /><button className="queue-session" aria-label={`Open session ${session.title}`} onClick={() => open(session.id)}><strong>{session.title}</strong><span>{detail}</span></button><span className={`queue-agent ${session.agent}`}>{session.agent.toUpperCase()}</span><span className={`queue-state ${state}`}>{state === 'active' ? 'WORKING' : state === 'completed' ? 'DONE' : state.toUpperCase()}</span>{state === 'failed' ? <button className="queue-action" aria-label={`Retry ${session.title}`} title="Retry this prompt" onClick={() => retry(session.id)}><PixelIcon name="play" size={12} /></button> : <button className="queue-action" aria-label={`View ${session.title}`} title="Open conversation" onClick={() => open(session.id)}><PixelIcon name="arrow" size={12} /></button>}</div>;
  }) : <div className="queue-empty"><PixelIcon name="terminal" size={24} /><div><strong>{sessions.length ? 'No missions in this view.' : 'Your next mission starts here.'}</strong><p>{sessions.length ? 'Choose All to see your saved sessions.' : 'Describe your idea above and launch a conversation.'}</p></div></div>}</div></section>;
}
