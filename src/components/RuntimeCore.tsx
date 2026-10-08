import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Agent, RuntimeEvent, RuntimeSnapshot, VaultGraph } from '../types';
import { WorkerFigure, type WorkerKind } from './MinecraftWorker';

function Voxel({ x, y, size = 12, height = 15, color = 'mint', grid = false }: { x: number; y: number; size?: number; height?: number; color?: string; grid?: boolean }) {
  const s = size, h = height;
  return <g className={`voxel ${color}`} transform={`translate(${x} ${y})`}><polygon className="voxel-top" points={`0,${-s / 2} ${s},0 0,${s / 2} ${-s},0`} /><polygon className="voxel-left" points={`${-s},0 0,${s / 2} 0,${s / 2 + h} ${-s},${h}`} /><polygon className="voxel-right" points={`0,${s / 2} ${s},0 ${s},${h} 0,${s / 2 + h}`} />{grid && <g className="voxel-grid">{[.2, .4, .6, .8].map(r => <g key={r}><path d={`M${-s + s * r} ${s * r / 2}v${h}M${s * r} ${s / 2 - s * r / 2}v${h}`} /><path d={`M${-s} ${h * r} 0 ${s / 2 + h * r} ${s} ${h * r}`} /><path d={`M${-s + s * r} ${-s * r / 2} ${s * r} ${s / 2 - s * r / 2}M${-s * r} ${s / 2 - s * r / 2} ${s - s * r} ${-s * r / 2}`} /></g>)}</g>}</g>;
}
const paths = { claude: 'M38 204 C128 203 179 273 290 280', codex: 'M46 463 C157 462 228 418 319 363', vault: 'M704 225 C627 239 564 271 430 283', system: 'M514 529 C491 478 440 408 407 358', project: 'M514 529 C491 478 440 408 407 358' };
const routes = { claude: 'M119 274 Q203 232 267 280 Q283 320 226 333 Q160 335 119 274', codex: 'M197 416 Q256 378 300 383 Q369 410 296 437 Q231 453 197 416', vault: 'M590 281 Q528 255 476 286 Q449 326 497 349 Q566 349 590 281', system: 'M497 418 Q431 423 414 388 Q395 364 456 362 Q515 379 497 418' };
const stations = { claude: { x: 112, y: 267, label: 'CLAUDE / REASON' }, codex: { x: 188, y: 414, label: 'CODEX / BUILD' }, vault: { x: 591, y: 276, label: 'OBSIDIAN / MEMORY' }, system: { x: 497, y: 415, label: 'VERIFY / ROUTE' } };
const notePositions = [{ x: 204, y: 122 }, { x: 336, y: 83 }, { x: 466, y: 105 }, { x: 564, y: 157 }, { x: 652, y: 199 }, { x: 638, y: 394 }, { x: 550, y: 473 }, { x: 357, y: 484 }];
type Props = { runtime: RuntimeSnapshot | null; events: RuntimeEvent[]; connected: boolean; phase?: string; graph: VaultGraph | null; contexts: string[]; toggleContext: (path: string) => void; working: Record<Agent, boolean> };

export function RuntimeCore({ runtime, events, connected, phase, graph, contexts, toggleContext, working }: Props) {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  const recent = events.filter(e => e.type !== 'telemetry' && Date.now() - e.time < 5000);
  const packets = recent.slice(0, 9), vaultActive = connected && recent.some(event => event.source === 'vault');
  const active = { ...working, vault: vaultActive, system: phase === 'verifying' || phase === 'saving' };
  const busy = Object.values(active).some(Boolean), latest = events.find(event => event.type !== 'telemetry' && event.text);
  const notes = useMemo(() => (graph?.nodes || []).slice(0, 8).map((note, i) => ({ ...note, ...notePositions[i] })), [graph]);
  const ring = Array.from({ length: 48 }, (_, i) => { const angle = i / 48 * Math.PI * 2; return { x: 360 + Math.cos(angle) * 203, y: 319 + Math.sin(angle) * 88, i }; });
  const renderWorker = (kind: WorkerKind) => {
    const station = stations[kind], working = connected && active[kind];
    return <g key={kind} className={`core-worker ${kind}`} data-agent={kind} data-state={working ? 'working' : 'idle'} aria-hidden="true">
      <g transform={working && !reduced ? undefined : `translate(${station.x} ${station.y})`}>
        {working && !reduced && <animateMotion path={routes[kind]} dur={kind === 'vault' ? '5s' : '9s'} repeatCount="indefinite" />}
        <g transform="translate(-18 -49) scale(.72)"><WorkerFigure kind={kind} working={working} carrying={kind === 'claude' || kind === 'vault'} /></g>
      </g>
    </g>;
  };
  return <section className={`system-core living-core ${connected ? 'online' : 'offline'} ${busy ? 'processing' : ''} ${reduced ? 'reduced-motion' : ''}`} aria-label="Live system core" style={{ '--core-load': runtime?.cpu == null ? .35 : .25 + runtime.cpu / 140 } as CSSProperties}>
    <div className="core-title"><span>LOCAL ORCHESTRATION</span><h1>APHELION</h1><p>YOUR AGENTS. YOUR WORLD. YOUR MEMORY.</p></div>
    <div className="core-world-meta"><span><i />{connected ? 'WORLD ONLINE' : 'CONNECTING'}</span><span>{graph ? `${graph.total} NOTES · ${graph.edges.length} LINKS` : 'READING VAULT'}</span></div>
    <svg className="core-scene living-world" viewBox="0 0 720 555" fill="none" role="group" aria-label="Living voxel orchestration and vault memory">
      <defs><radialGradient id="core-light"><stop stopColor="#19e6b1" stopOpacity=".3" /><stop offset="1" stopColor="#19e6b1" stopOpacity="0" /></radialGradient><linearGradient id="world-beam" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#44ffc8" stopOpacity="0" /><stop offset=".75" stopColor="#31ffd0" stopOpacity=".16" /><stop offset="1" stopColor="#44ffc8" stopOpacity="0" /></linearGradient><filter id="core-bloom"><feGaussianBlur stdDeviation="5" /></filter><pattern id="world-grid" width="48" height="24" patternUnits="userSpaceOnUse"><path d="M0 12 24 0 48 12 24 24Z" fill="none" stroke="#72d6dc" strokeOpacity=".1" /></pattern></defs>
      <g aria-hidden="true"><ellipse cx="360" cy="328" rx="355" ry="215" fill="url(#core-light)" />
        <g className="world-stars">{Array.from({ length: 34 }, (_, i) => <rect key={i} x={36 + (i * 73 % 650)} y={30 + (i * 41 % 450)} width={i % 4 ? 1 : 3} height={i % 4 ? 1 : 3} style={{ animationDelay: `${i % 7}s` }} />)}</g>
        <path className="world-platform-side" d="M24 315 360 485 696 315V348L360 525 24 348Z" /><path className="world-platform" d="M24 315 360 143 696 315 360 485Z" /><path d="M24 315 360 143 696 315 360 485Z" fill="url(#world-grid)" />
        <g className="world-edge-lights"><path d="M24 327 360 504 696 327M70 318 360 465 650 318" />{Array.from({ length: 13 }, (_, i) => <path key={i} d={`M${65 + i * 22} ${350 + i * 11.4}v9M${655 - i * 22} ${350 + i * 11.4}v9`} />)}</g>
        <g className="world-towers">{[{ x: 66, y: 318, height: 28 }, { x: 112, y: 364, height: 40 }, { x: 611, y: 355, height: 35 }, { x: 548, y: 452, height: 27 }, { x: 396, y: 470, height: 36 }, { x: 292, y: 464, height: 27 }].map((tower, i) => <g key={i}><Voxel {...tower} size={13} color="dark" /><path d={`M${tower.x} ${tower.y + 7}v${tower.height - 5}`} stroke={i % 2 ? '#36cefa' : '#24f5b2'} strokeWidth="2" /></g>)}</g>
        <g className="core-connection-paths">{Object.entries(paths).map(([source, path]) => <path key={source} className={source} d={path} />)}</g>
        <g className="world-conveyors"><path className="claude" d="M112 267 215 316 269 289" /><path className="codex" d="M188 414 277 368 299 381" /><path className="vault" d="M591 276 500 319 450 297" /><path className="system" d="M497 415 427 380" /></g>
        {Object.entries(stations).map(([kind, station]) => <g key={kind} className={`world-station ${kind} ${active[kind as WorkerKind] ? 'active' : ''}`}><Voxel x={station.x} y={station.y - 3} size={38} height={18} color={kind === 'claude' ? 'amber' : kind === 'codex' ? 'cyan' : kind === 'vault' ? 'purple' : 'mint'} /><path className="station-light" d={`M${station.x - 38} ${station.y + 6} ${station.x} ${station.y + 25} ${station.x + 38} ${station.y + 6}`} /><text x={station.x} y={station.y + 48} textAnchor="middle">{station.label}</text></g>)}
        <g className="core-orbits"><ellipse cx="360" cy="319" rx="229" ry="103" /><ellipse cx="360" cy="319" rx="254" ry="117" /></g>
        {ring.filter(block => block.y < 319).map(block => <Voxel key={block.i} x={block.x} y={block.y} size={10} height={18} color={block.i % 4 ? 'stone' : 'mint'} />)}
        <g className="world-reactor-base"><Voxel x={360} y={304} size={106} height={49} color="dark" grid /><Voxel x={360} y={292} size={82} height={21} color="mint" grid /></g>
        <rect className="world-reactor-beam" x="302" y="24" width="116" height="380" fill="url(#world-beam)" />
        <g className="core-reactor"><path className="core-cage" d="M360 142 441 182V306L360 348 279 306V182Z M279 182 360 224 441 182M360 224V348" /><Voxel x={360} y={214} size={59} height={78} color="reactor" grid /><Voxel x={360} y={131} size={17} height={31} color="reactor" grid /><path className="core-stem" d="M360 164V182M299 243 279 232M421 243 441 232" /></g>
        <g className="core-ring-energy"><ellipse cx="360" cy="315" rx="171" ry="75" filter="url(#core-bloom)" /><ellipse cx="360" cy="315" rx="171" ry="75" /><ellipse cx="360" cy="325" rx="171" ry="75" /></g>
        <g className="world-holograms"><ellipse className="holo-high" cx="360" cy="207" rx="126" ry="57" /><ellipse className="holo-low" cx="360" cy="313" rx="153" ry="67" /><path d="M360 112v-18M465 193l15-9M253 192l-14-8" /></g>
        {ring.filter(block => block.y >= 319).map(block => <Voxel key={block.i} x={block.x} y={block.y} size={10} height={18} color={block.i % 4 ? 'stone' : 'mint'} />)}
      </g>
      <g className="world-memory-links" aria-hidden="true">{(graph?.edges || []).map((edge, i) => { const from = notes.find(node => node.id === edge.from), to = notes.find(node => node.id === edge.to); return from && to ? <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={contexts.includes(from.path) || contexts.includes(to.path) ? 'selected' : ''} /> : null; })}{notes.filter(node => contexts.includes(node.path)).map(node => <path className="context-route" key={node.id} d={`M${node.x} ${node.y}Q360 180 360 244`} />)}</g>
      <g className="world-memory-nodes">{notes.map((note, i) => <g key={note.id} className={`world-memory-node ${contexts.includes(note.path) ? 'selected' : ''}`} transform={`translate(${note.x} ${note.y})`}  onClick={() => toggleContext(note.path)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleContext(note.path); } }}><rect className="memory-hit-area" x="-24" y="-21" width="48" height="55" fill="transparent" role="button" tabIndex={0} aria-label={`Attach memory ${note.title}`} aria-pressed={contexts.includes(note.path)} /><title>{note.path}</title><g className="memory-hover" style={{ animationDelay: `${i * -.8}s` }}><ellipse className="memory-halo" cy="15" rx="24" ry="11" /><Voxel x={0} y={0} size={18} height={15} color="purple" /><path className="memory-page" d="M-8-9H3L8-4V8H-8ZM3-9V-4H8M-4-1H4M-4 3H3" /><text y="42" textAnchor="middle">{note.title.length > 19 ? note.title.slice(0, 17) + '…' : note.title}</text>{contexts.includes(note.path) && <text className="context-chip" y="55" textAnchor="middle">CONTEXT ATTACHED</text>}</g></g>)}</g>
      {(['claude', 'codex', 'vault', 'system'] as const).map(renderWorker)}
      {!reduced && <g className="core-live-packets" aria-hidden="true">{packets.map(event => <g key={event.id} className={`data-packet ${event.source}`}><rect x="-4" y="-4" width="8" height="8"><animateMotion path={paths[event.source]} dur="1.5s" fill="freeze" /><animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="1.8s" fill="freeze" /></rect><circle r="2" fill="#e5fff8"><animateMotion path={paths[event.source]} dur="1.5s" fill="freeze" /><animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="1.8s" fill="freeze" /></circle></g>)}</g>}
      <g className="world-caption" aria-hidden="true"><text x="360" y="548" textAnchor="middle">{notes.length ? 'CLICK A MEMORY BLOCK TO ATTACH REAL VAULT CONTEXT' : graph ? 'YOUR REAL VAULT IS EMPTY · ADD A NOTE TO GROW THIS WORLD' : 'CONNECTING YOUR REAL VAULT MEMORY'}</text></g>
    </svg>
    <div className="core-phase-rail" aria-label="Orchestration phases">{['planning', 'building', 'verifying', 'saving'].map((step, i) => <span key={step} className={phase === step ? 'active' : ''}><i />{['REASON', 'BUILD', 'VERIFY', 'REMEMBER'][i]}</span>)}</div>
    <div className="core-live-state"><span className={`core-heartbeat ${connected ? '' : 'disconnected'}`} /><strong>{connected ? phase ? `MISSION / ${phase.toUpperCase()}` : working.claude || working.codex ? 'AGENTS WORKING' : runtime?.activeJobs ? `${runtime.activeJobs} ACTIVE JOBS` : 'WORLD STANDING BY' : 'CONNECTING LOCAL ENGINE'}</strong><span>{latest?.text || (connected ? 'Prompt an agent. Watch the work flow through your world.' : 'Waiting for live telemetry.')}</span></div>
  </section>;
}
