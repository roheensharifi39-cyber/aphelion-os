import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Agent, Note, ObsidianInfo, Status, VaultGraph } from '../types';
import { api } from '../lib/bridge';
import { AgentGlyph, CrystalIcon } from './AgentGlyph';
import { PixelIcon } from './PixelIcon';
import { Button, ErrorNote } from './UI';

type GraphNode = VaultGraph['nodes'][number];
type Tab = 'graph' | 'files' | 'recent' | 'tags' | 'context';
type Props = { notes: Note[]; status: Status; obsidian?: ObsidianInfo; focusMode: boolean; visible: boolean; renderFiles: (focusPath: string | undefined, active: boolean) => ReactNode; openAgent: (agent: Agent) => void; openObsidian: (path?: string) => void; contextPaths: string[]; setContextPaths: (paths: string[]) => void; event: (text: string) => void };
function labelLines(title: string): string[] {
  const words = title.split(/\s+/); const lines = [''];
  for (const word of words) { const current = lines.at(-1)!; if (current && current.length + word.length > 19) { if (lines.length === 2) { lines[1] = `${lines[1].slice(0, 16)}…`; break; } lines.push(word); } else lines[lines.length - 1] += `${current ? ' ' : ''}${word}`; }
  return lines.map(line => line.length > 20 ? `${line.slice(0, 18)}…` : line);
}
function previewText(node: GraphNode): string {
  const excerpt = node.excerpt.trim(), heading = `# ${node.title}`;
  const body = excerpt.toLowerCase().startsWith(heading.toLowerCase()) ? excerpt.slice(heading.length).trim() : excerpt;
  return body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label || target).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '');
}
function KnowledgeGraph({ nodes, edges, selected, select, openAgent }: { nodes: GraphNode[]; edges: VaultGraph['edges']; selected?: string; select: (id: string) => void; openAgent: (agent: Agent) => void }) {
  const drawn = nodes.slice(0, 24);
  const positions = useMemo(() => new Map(drawn.map((node, i) => {
    const ring = Math.floor(i / 10), inRing = Math.min(10, drawn.length - ring * 10), angle = -Math.PI / 2 + (i % 10) / inRing * Math.PI * 2;
    const rx = ring ? 204 : drawn.length < 5 ? 151 : 160, ry = ring ? 160 : drawn.length < 5 ? 132 : 130;
    return [node.id, { x: 280 + Math.cos(angle) * rx, y: 182 + Math.sin(angle) * ry }];
  })), [nodes]);
  return <div className="knowledge-graph"><svg viewBox="0 0 560 378" role="group" aria-label="Vault knowledge graph">
    <defs><pattern id="vault-grid" width="17" height="17" patternUnits="userSpaceOnUse"><rect x="1" y="1" width="1" height="1" fill="#536079" fillOpacity=".2" /></pattern><radialGradient id="memory-glow"><stop stopColor="#7847b1" stopOpacity=".25" /><stop offset="1" stopColor="#7847b1" stopOpacity="0" /></radialGradient><filter id="selected-glow"><feGaussianBlur stdDeviation="2.5" /></filter></defs>
    <rect width="560" height="378" fill="url(#vault-grid)" /><circle cx="280" cy="182" r="158" fill="url(#memory-glow)" />
    <g className="graph-context-links">{drawn.map(node => { const point = positions.get(node.id)!; return <line key={node.id} x1="280" y1="182" x2={point.x} y2={point.y} />; })}<path d="M88 191 235 182M325 182l147 9" /></g>
    <g className="graph-note-links">{edges.map((edge, i) => { const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return null; return <line key={`${edge.from}-${edge.to}-${i}`} className={edge.from === selected || edge.to === selected ? 'selected' : ''} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />; })}</g>
    <g className="graph-agent claude" role="button" tabIndex={0} aria-label="Claude shared memory hub" onClick={() => openAgent('claude')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAgent('claude'); } }} transform="translate(75 182)"><path d="m-27-12 14-14h26l14 14v24L13 26h-26l-14-14z" /><foreignObject x="-17" y="-17" width="34" height="34"><AgentGlyph agent="claude" size={34} /></foreignObject><text y="45" textAnchor="middle">Claude</text></g>
    <g className="graph-agent codex" role="button" tabIndex={0} aria-label="Codex shared memory hub" onClick={() => openAgent('codex')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAgent('codex'); } }} transform="translate(485 182)"><path d="m-27-12 14-14h26l14 14v24L13 26h-26l-14-14z" /><foreignObject x="-17" y="-17" width="34" height="34"><AgentGlyph agent="codex" size={34} /></foreignObject><text y="45" textAnchor="middle">Codex</text></g>
    <g className="graph-core" transform="translate(280 182)"><path d="M0-49 43-24V24L0 49-43 24V-24Z" /><path d="M0-43 37-21V21L0 43-37 21V-21Z" /><foreignObject x="-17" y="-28" width="34" height="41"><CrystalIcon size={34} /></foreignObject><text y="28" textAnchor="middle">APHELION</text></g>
    {drawn.map(node => { const point = positions.get(node.id)!, active = selected === node.id; return <g className={`graph-note ${active ? 'selected' : ''}`} key={node.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`Select note ${node.title}`} onClick={() => select(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); } }}><title>{node.title}</title><circle className="node-halo" r="23" /><circle r="18" /><path d="M-6-9H3L7-5V9H-6zM3-9v4h4M-3-1h7M-3 3h7M-3 6h5" fill="none" strokeWidth="1.8" />{labelLines(node.title).map((line, i) => <text key={i} y={35 + i * 14} textAnchor="middle">{line}</text>)}</g>; })}
  </svg><div className="graph-legend"><span><i />NOTE LINKS</span><span><i />SHARED CONTEXT · CONCEPTUAL</span>{nodes.length > drawn.length && <span>{drawn.length} OF {nodes.length} SHOWN</span>}</div></div>;
}

export function VaultHub(p: Props) {
  const [tab, setTab] = useState<Tab>(p.focusMode ? 'files' : 'graph');
  const homeTab = useRef<Tab>('graph');
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [focusPath, setFocusPath] = useState<string>();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [selectedTag, setSelectedTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const previousRoot = useRef(p.status.vaultPath);
  useEffect(() => { setTab(p.focusMode ? 'files' : homeTab.current); }, [p.focusMode]);
  useEffect(() => {
    if (previousRoot.current === p.status.vaultPath) return;
    previousRoot.current = p.status.vaultPath; setGraph(null); setSelectedId(''); setFocusPath(undefined); setQuery(''); setSelectedTag('');
  }, [p.status.vaultPath]);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void Promise.resolve().then(() => api.vaultGraph()).then(next => { if (!active) return; setGraph(next); setSelectedId(previous => next.nodes.some(node => node.id === previous) ? previous : next.nodes[0]?.id || ''); }).catch(e => { if (active) setError((e as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [p.notes, p.status.vaultPath, revision]);
  useEffect(() => { if (searching) search.current?.focus(); }, [searching, tab]);
  const nodes = graph?.nodes || [];
  const filtered = nodes.filter(node => `${node.title} ${node.path} ${node.tags.join(' ')} ${node.excerpt}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find(node => node.id === selectedId) || filtered[0];
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) for (const tag of new Set(node.tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);
  const recent = [...filtered].sort((a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0));
  function choose(id: string) { setSelectedId(id); const node = nodes.find(n => n.id === id); if (node) p.event(`Selected note: ${node.title}`); }
  function changeView(next: Tab) { setTab(next); if (!p.focusMode) homeTab.current = next; }
  function openNote(node: GraphNode | undefined) { if (!node) return; setFocusPath(node.path); changeView('files'); p.event(`Opened note editor: ${node.title}`); }
  function find() { changeView('graph'); setSearching(true); }
  function switchTab(next: Tab) { changeView(next); p.event(`Opened vault ${next} view`); }
  return <section className={`reference-panel vault-hub ${p.focusMode ? 'vault-focus' : ''}`} aria-label="Obsidian vault">
    <div className="vault-hub-heading"><CrystalIcon size={33} /><div><h2>OBSIDIAN VAULT</h2><span>KNOWLEDGE · CONTEXT · CONTINUITY</span></div><span className="vault-hub-status"><i />{loading ? 'READING' : p.obsidian?.watching ? 'WATCHED' : 'LOCAL'}</span><button className="hub-refresh" aria-label="Refresh vault graph" title="Refresh vault graph" onClick={() => { setRevision(r => r + 1); p.event('Requested vault graph refresh'); }} disabled={loading}><PixelIcon name="flow" size={13} /></button></div>
    <div className="obsidian-app-link"><span><i className={p.obsidian?.running ? 'running' : ''} />{p.obsidian ? p.obsidian.running ? 'OBSIDIAN APP OPEN' : p.obsidian.installed ? 'OBSIDIAN INSTALLED' : 'OBSIDIAN NOT INSTALLED' : 'CHECKING OBSIDIAN APP'}</span>{p.obsidian?.installed ? <button aria-label="Open Obsidian" onClick={() => p.openObsidian()}>OPEN APP ↗</button> : <button aria-label="Install Obsidian" onClick={() => void api.openExternal('https://obsidian.md/download')}>INSTALL ↗</button>}</div>
    <div className="vault-hub-tabs" aria-label="Vault views">{(['graph', 'files', 'recent', 'tags', 'context'] as const).map(view => <button key={view} aria-label={view[0].toUpperCase() + view.slice(1)} className={tab === view ? 'active' : ''} aria-pressed={tab === view} onClick={() => switchTab(view)}>{view === 'files' ? 'NOTES' : view.toUpperCase()}</button>)}</div>
    <div className="vault-file-view" hidden={tab !== 'files'}>{p.renderFiles(focusPath, p.visible && tab === 'files')}</div>
    <div className="vault-visual-view" hidden={tab === 'files'}>
      {searching && <div className="hub-search"><PixelIcon name="search" size={14} /><input ref={search} aria-label="Search vault" placeholder="Search titles, tags, or content..." value={query} onChange={event => setQuery(event.target.value)} /><button aria-label="Close vault search" onClick={() => { setSearching(false); setQuery(''); }}><PixelIcon name="x" size={10} /></button></div>}
      <div className="vault-graph-area" hidden={tab !== 'graph'}>{loading && !graph ? <div className="graph-empty"><div className="loading-blocks"><i /><i /><i /></div><p>Reading your shared memory...</p></div> : filtered.length ? <KnowledgeGraph nodes={filtered} edges={graph?.edges || []} selected={selected?.id} select={choose} openAgent={p.openAgent} /> : <div className="graph-empty"><CrystalIcon size={42} /><h3>{query ? 'No matching notes.' : error ? 'Graph unavailable.' : 'Your memory starts here.'}</h3><p>{query ? 'Try another title or tag.' : error ? 'You can still use the file editor.' : 'Create a note or connect your Obsidian folder.'}</p><Button icon="book" onClick={() => setTab('files')}>Open files</Button></div>}</div>
      {tab === 'recent' && <div className="hub-note-browser"><div className="hub-browser-label"><PixelIcon name="save" size={13} /><span>RECENTLY MODIFIED</span></div>{recent.length ? recent.map(node => <button key={node.id} className={selected?.id === node.id ? 'active' : ''} onClick={() => choose(node.id)}><PixelIcon name="book" size={15} /><div><strong>{node.title}</strong><span>{node.path}</span></div><time>{Number.isFinite(Date.parse(node.modified)) ? new Date(node.modified).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}</time></button>) : <p className="hub-empty-list">No notes to show yet.</p>}</div>}
      {tab === 'tags' && <div className="hub-note-browser tag-browser"><div className="hub-browser-label"><PixelIcon name="folder" size={13} /><span>YOUR VAULT TAGS</span></div><div className="vault-tag-cloud">{tags.map(([tag, count]) => <button key={tag} className={selectedTag === tag ? 'active' : ''} onClick={() => setSelectedTag(current => current === tag ? '' : tag)}>#{tag}<span>{count}</span></button>)}</div>{!tags.length ? <p className="hub-empty-list">Add #tags or frontmatter tags to your Markdown notes.</p> : nodes.filter(node => !selectedTag || node.tags.includes(selectedTag)).map(node => <button key={node.id} className={selected?.id === node.id ? 'active' : ''} onClick={() => choose(node.id)}><PixelIcon name="book" size={14} /><div><strong>{node.title}</strong><span>{node.tags.map(tag => `#${tag}`).join(' · ')}</span></div><PixelIcon name="arrow" size={11} /></button>)}</div>}
      {tab === 'context' && <div className="hub-note-browser context-browser"><div className="hub-browser-label"><PixelIcon name="link" size={13} /><span>SAVED VAULT CONTEXT / {p.contextPaths.length} SELECTED</span></div><p>Selected notes are read from this vault when you launch a mission.</p>{nodes.map(node => <label key={node.id}><input type="checkbox" aria-label={`Use ${node.title} as mission context`} checked={p.contextPaths.includes(node.path)} onChange={event => { p.setContextPaths(event.target.checked ? [...p.contextPaths, node.path] : p.contextPaths.filter(path => path !== node.path)); p.event(`${event.target.checked ? 'Added' : 'Removed'} mission context: ${node.title}`); }} /><div><strong>{node.title}</strong><span>{node.path}</span></div></label>)}</div>}
      <ErrorNote text={error} />
      <div className="vault-node-preview"><div className="node-preview-heading"><PixelIcon name="book" size={23} /><h3>{selected?.title || 'Shared memory'}</h3><span>{selected ? `${(graph?.edges || []).filter(edge => edge.from === selected.id || edge.to === selected.id).length} LINKS` : `${nodes.length} FILES`}</span></div><p>{selected ? previewText(selected) || 'This note is empty. Open it to add your context.' : 'Choose a node to inspect the real note behind it.'}</p>{selected && <div className="node-preview-tags">{selected.tags.length ? selected.tags.slice(0, 5).map(tag => <button key={tag} onClick={() => { setSelectedTag(tag); changeView('tags'); }}>#{tag}</button>) : <span>{selected.path}</span>}</div>}<div className="node-preview-actions"><Button variant="stone" icon="search" onClick={find}>Search vault</Button><Button className="violet" variant="stone" icon="arrow" aria-label="Open note" disabled={!selected} onClick={() => openNote(selected)}>Open note</Button><Button icon="link" variant="ghost" aria-label="Open note in Obsidian" disabled={!selected || !p.obsidian?.installed} onClick={() => p.openObsidian(selected?.path)} /></div></div>
    </div>
    <div className="vault-hub-footer"><span><i />{graph?.total ?? p.notes.length} {((graph?.total ?? p.notes.length) === 1) ? 'file' : 'files'}{graph?.truncated ? ' · graph capped' : ''}</span>{(['claude', 'codex'] as const).map(agent => <span key={agent} className={agent}><i />{agent === 'claude' ? 'Claude' : 'Codex'}: {p.status.connected[agent] ? 'Connected' : 'Sign in'}</span>)}</div>
  </section>;
}
