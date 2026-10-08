import { useState } from 'react';
import type { Agent } from '../types';
import { PixelIcon } from './PixelIcon';

export type ActivityScope = Agent | 'vault' | 'system';
export type Activity = { id: string; time: number; scope: ActivityScope; text: string };
export const ACTIVITY_KEY = 'aphelion.activity.v1';
export function readActivity(): Activity[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(e => e && typeof e.id === 'string' && typeof e.time === 'number' && Number.isFinite(e.time) && ['claude', 'codex', 'vault', 'system'].includes(e.scope) && typeof e.text === 'string').slice(0, 60);
  } catch { return []; }
}
export function ActivityFeed({ events }: { events: Activity[] }) {
  const [filter, setFilter] = useState<ActivityScope | 'all'>('all');
  const filtered = events.filter(event => filter === 'all' || event.scope === filter);
  return <section className="reference-panel activity-panel" aria-label="Live activity"><div className="reference-heading"><div><PixelIcon name="bolt" size={18} /><h2>LIVE ACTIVITY</h2></div><div className="panel-filters" aria-label="Activity filters">{(['all', 'claude', 'codex', 'vault', 'system'] as const).map(scope => <button key={scope} aria-label={`${scope[0].toUpperCase() + scope.slice(1)} activity`} className={filter === scope ? 'active' : ''} aria-pressed={filter === scope} onClick={() => setFilter(scope)}>{scope.toUpperCase()}</button>)}</div></div><div className="activity-list" role="log" aria-live="polite">{filtered.length ? filtered.map(event => <div className={`activity-event ${event.scope}`} key={event.id}><time dateTime={new Date(event.time).toISOString()}>{new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time><span>[{event.scope.toUpperCase()}]</span><p>{event.text}</p></div>) : <div className="activity-empty"><PixelIcon name="eye" size={18} /><p>{events.length ? 'No events in this channel yet.' : 'Standing by. Your workspace activity will appear here.'}</p></div>}</div></section>;
}
