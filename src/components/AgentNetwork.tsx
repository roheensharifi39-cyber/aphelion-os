import { useEffect, useRef, useState } from 'react';
import type { AgentActivity } from '../lib/agent-activity';
import type { Agent } from '../types';
import { PixelIcon } from './PixelIcon';

type Props = { activities: AgentActivity[]; active: boolean; paused: boolean; notes: number; links: number;
  project: (path: string) => { x: number; y: number; visible: boolean } | null;
  openSession: (id: string) => void; settings: () => void; selectNote?: (path: string) => void };

export function AgentNetwork(p: Props) {
  const [selected, setSelected] = useState<Agent | null>(null);
  const layer = useRef<HTMLDivElement>(null), detail = useRef<HTMLElement>(null);
  const buttons = useRef(new Map<Agent, HTMLButtonElement>());
  const paths = useRef(new Map<string, SVGPathElement>());
  const activity = p.activities.find(item => item.agent === selected);
  const connections = p.activities.flatMap(item => [...new Set([...item.contextPaths, ...(item.outputPath ? [item.outputPath] : [])])].slice(0, 9).map(path => ({ key: `${item.agent}:${path}`, path, agent: item.agent, working: item.state === 'working', output: path === item.outputPath })));
  const projection = useRef(p.project); projection.current = p.project;
  const connectionRef = useRef(connections); connectionRef.current = connections;
  useEffect(() => {
    if (!p.active) { setSelected(null); return; }
    let frame = 0, previous = 0;
    const draw = (now: number) => {
      if (connectionRef.current.length && now - previous >= 32 && !document.hidden && layer.current) {
        previous = now;
        const bounds = layer.current.getBoundingClientRect();
        const origins = new Map([...buttons.current].map(([agent, button]) => {
          const rect = button.getBoundingClientRect();
          return [agent, { x: rect.x - bounds.x + rect.width / 2, y: rect.y - bounds.y + rect.height / 2 }];
        }));
        const updates = connectionRef.current.map(connection => ({ connection, origin: origins.get(connection.agent), point: projection.current(connection.path) }));
        for (const { connection, origin, point } of updates) {
          const path = paths.current.get(connection.key); if (!path) continue;
          const visible = origin && point?.visible && point.x >= 0 && point.x <= bounds.width && point.y >= 80 && point.y <= bounds.height - 120;
          path.style.visibility = visible ? 'visible' : 'hidden';
          if (visible) path.setAttribute('d', `M ${origin.x} ${origin.y} Q ${origin.x} ${point.y} ${point.x} ${point.y}`);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [p.active]);
  useEffect(() => {
    if (!selected) return;
    detail.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSelected(null); buttons.current.get(selected)?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [selected]);
  return <div ref={layer} className="agent-network" hidden={!p.active} data-paused={p.paused}>
    <svg className="agent-connections" aria-hidden="true">{connections.map(connection => <path key={connection.key} ref={element => { if (element) paths.current.set(connection.key, element); else paths.current.delete(connection.key); }} className={`${connection.working ? 'is-working' : ''} ${connection.output ? 'is-output' : ''}`} style={{ visibility: 'hidden' }} />)}</svg>
    <div className="membrane-legend">Ambient membrane <span>·</span> {p.notes} notes <span>·</span> {p.links} note links<small>Dashed: submitted context · Solid: saved response</small></div>
    {p.activities.map(item => <button key={item.agent} ref={element => { if (element) buttons.current.set(item.agent, element); else buttons.current.delete(item.agent); }} className={`membrane-agent ${item.agent}`} data-state={item.state} aria-label={`Inspect ${item.agent === 'claude' ? 'Claude' : 'Codex'} activity`} aria-expanded={selected === item.agent} aria-controls="membrane-agent-detail" onClick={() => setSelected(selected === item.agent ? null : item.agent)}>
      <span className="agent-orbit-mark" aria-hidden="true"><PixelIcon name={item.agent === 'claude' ? 'spark' : 'terminal'} size={18} /></span><span><strong>{item.agent === 'claude' ? 'Claude' : 'Codex'}</strong><small>{item.label}</small></span>
    </button>)}
    {activity && <section ref={detail} id="membrane-agent-detail" tabIndex={-1} className="agent-activity-detail" aria-label={`${activity.agent === 'claude' ? 'Claude' : 'Codex'} activity`}>
      <div><strong>{activity.agent === 'claude' ? 'Claude' : 'Codex'} · {activity.label}</strong><button aria-label="Close agent activity" onClick={() => { setSelected(null); buttons.current.get(activity.agent)?.focus(); }}><PixelIcon name="x" size={16} /></button></div>
      <p>{activity.session?.title || 'No task yet. Choose this agent in the composer to start.'}</p>
      <span className="agent-context-caption">{activity.contextPaths.length} submitted context notes{activity.count > 1 ? ' · Showing one active task' : ''}</span>
      {!!activity.contextPaths.length && <ul>{activity.contextPaths.map(path => <li key={path}><button onClick={() => p.selectNote?.(path)}>{path}</button></li>)}</ul>}
      {activity.outputPath && <button className="agent-detail-action" onClick={() => p.selectNote?.(activity.outputPath!)}>Open saved response</button>}
      {activity.session && <button className="agent-detail-action" onClick={() => p.openSession(activity.session!.id)}>Open conversation</button>}
      {activity.state === 'offline' && <button className="agent-detail-action" onClick={p.settings}>Open connections</button>}
      <small>Paths show submitted context, not proof that an agent has read or changed a note.</small>
    </section>}
  </div>;
}
