import type { Agent, RuntimeSnapshot, Status, Workspace } from '../types';
import { AgentGlyph } from './AgentGlyph';
import { PixelIcon } from './PixelIcon';
import { Button } from './UI';

type Props = { workspace: Workspace; status: Status; runtime?: RuntimeSnapshot | null; mission?: { id: string; task: string; phase: string } | null; agent: Agent; pending: Record<string, string>; select: (agent: Agent) => void; open: (agent: Agent) => void; start: (agent: Agent) => void; settings: () => void; check: () => void };
export function AgentCards(p: Props) {
  return <div className="agent-card-grid">{(['claude', 'codex'] as const).map(agent => {
    const name = agent === 'claude' ? 'Claude' : 'Codex';
    const sessions = p.workspace.sessions.filter(s => s.agent === agent);
    const running = sessions.find(s => !!p.pending[s.id]);
    const current = running || sessions.find(s => s.id === p.workspace.active[agent]);
    const connected = p.status.connected[agent];
    const checking = p.status.auth[agent].detail.startsWith('Checking');
    const inMission = !!p.mission && current?.title === p.mission.task.slice(0, 48);
    const phase = checking ? 'CHECKING' : running ? inMission ? agent === 'codex' && p.mission?.phase === 'planning' ? 'WAITING' : p.mission?.phase === 'stopping' ? 'STOPPING' : agent === 'claude' ? 'REASONING' : 'BUILDING' : 'RESPONDING' : connected ? 'READY' : 'SIGN IN';
    const process = p.runtime?.processes.find(process => process.role === agent);
    const response = current?.messages.filter(message => message.role === 'assistant').at(-1)?.content;
    return <section key={agent} className={`reference-panel agent-card ${agent} ${p.agent === agent ? 'selected' : ''} ${running ? 'processing' : ''}`} aria-label={`${name} agent status`}>
      <div className="agent-card-heading"><button className="agent-card-identity" aria-label={`Select ${name}`} onClick={() => p.select(agent)}><AgentGlyph agent={agent} size={39} /><div><h2>{name.toUpperCase()}</h2><span>{agent === 'claude' ? 'REASON · PLAN · REFINE' : 'IMPLEMENT · TEST · SHIP'}</span></div></button><span className="agent-card-state"><i />{phase}</span><details className="agent-menu"><summary aria-label={`${name} actions`}>⋮</summary><div onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}><button onClick={() => p.start(agent)}><PixelIcon name="plus" size={11} />New {name} session</button><button onClick={p.settings}><PixelIcon name="link" size={11} />{connected ? 'Manage connection' : 'Subscription sign-in'}</button><button onClick={p.check}><PixelIcon name="check" size={11} />Check connection</button></div></details></div>
      <div className="agent-card-body"><div className="agent-current"><span>{running ? 'CURRENT TASK' : current ? 'CURRENT SESSION' : 'MISSION CHANNEL'}</span><strong>{current?.title || 'No active mission.'}</strong>{running && <span className="processing-track" role="progressbar" aria-label={`${name} response in progress`} aria-valuetext={phase}><i /><i /><i /><i /><i /></span>}</div><div className="agent-facts"><p><PixelIcon name={connected ? 'check' : 'link'} size={11} /><span>{checking ? 'Checking subscription status' : connected ? 'Subscription connected' : 'Subscription sign-in required'}</span></p><p><PixelIcon name="terminal" size={11} /><span>{process ? `Process ${process.pid} · ${process.name}` : p.runtime ? 'No agent process active' : 'Awaiting process telemetry'}</span></p></div><div className="agent-response-preview"><span>{response ? 'LATEST AGENT OUTPUT' : agent === 'claude' ? 'REASONING CHANNEL' : 'BUILD CHANNEL'}</span><p>{response?.replace(/^#+\s*/gm, '').slice(0, 220) || (checking ? 'Waiting for subscription status from the local engine.' : connected ? agent === 'claude' ? 'Ready to read project context and plan a real implementation.' : 'Ready to implement in your connected project directory.' : 'Sign in with your existing subscription to connect this agent.')}</p></div></div>
      <div className="agent-card-footer"><Button variant="ghost" icon="terminal" onClick={() => p.open(agent)} aria-label={`Open ${name} conversation`}>Open workbench</Button><span>{sessions.length} SAVED {sessions.length === 1 ? 'SESSION' : 'SESSIONS'}</span></div>
    </section>;
  })}</div>;
}
