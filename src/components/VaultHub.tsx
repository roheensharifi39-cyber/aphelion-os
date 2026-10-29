import { Heading } from './Heading';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, Check, Clock3, ExternalLink, FileText, Layers, Network, RefreshCw, Search, Tag, X } from 'lucide-react';
import type { Agent, Note, ObsidianInfo, Status, VaultGraph } from '../types';
import { api } from '../lib/bridge';
import { ErrorNote } from './UI';
import '../knowledge.css';

type GraphNode = VaultGraph['nodes'][number];
type Tab = 'graph' | 'files' | 'recent' | 'tags' | 'context';
type Props = { onGraph?: (graph: VaultGraph | null) => void; notes: Note[]; status: Status; obsidian?: ObsidianInfo; focusMode: boolean; visible: boolean; renderFiles: (focusPath: string | undefined, active: boolean) => ReactNode; openAgent: (agent: Agent) => void; openObsidian: (path?: string) => void; contextPaths: string[]; setContextPaths: (paths: string[]) => void; event: (text: string) => void };

const views = [
  { id: 'files', label: 'Notes', Icon: BookOpen },
  { id: 'recent', label: 'Recent', Icon: Clock3 },
  { id: 'tags', label: 'Tags', Icon: Tag },
  { id: 'context', label: 'Context', Icon: Layers },
  { id: 'graph', label: 'Graph', Icon: Network },
] as const;

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

function KnowledgeGraph({ nodes, edges, selected, select }: { nodes: GraphNode[]; edges: VaultGraph['edges']; selected?: string; select: (id: string) => void }) {
  const drawn = nodes.slice(0, 24);
  const positions = useMemo(() => new Map(drawn.map((node, i) => {
    if (drawn.length === 1) return [node.id, { x: 280, y: 172 }];
    const ring = Math.floor(i / 10), inRing = Math.min(10, drawn.length - ring * 10), angle = -Math.PI / 2 + (i % 10) / inRing * Math.PI * 2;
    const rx = ring ? 220 : drawn.length < 5 ? 155 : 160, ry = ring ? 130 : drawn.length < 5 ? 94 : 100;
    return [node.id, { x: 280 + Math.cos(angle) * rx, y: 167 + Math.sin(angle) * ry }];
  })), [nodes]);
  return <div className="knowledge-graph">
    <svg viewBox="0 0 560 350" role="group" aria-label="Vault knowledge graph">
      <g className="graph-note-links">{edges.map((edge, i) => { const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return null; return <line key={`${edge.from}-${edge.to}-${i}`} className={edge.from === selected || edge.to === selected ? 'selected' : ''} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />; })}</g>
      {drawn.map(node => { const point = positions.get(node.id)!; return <g className={`graph-note ${selected === node.id ? 'selected' : ''}`} key={node.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`Select note ${node.title}`} onClick={() => select(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); } }}>
        <title>{node.title}</title><circle className="node-halo" r="23" /><circle r="16" /><path d="M-5-8H2L6-4V8H-5zM2-8v4h4M-2 0h5M-2 4h5" fill="none" strokeWidth="1.4" />{labelLines(node.title).map((line, i) => <text key={i} y={35 + i * 15} textAnchor="middle">{line}</text>)}
      </g>; })}
    </svg>
    <div className="graph-legend"><span><i />Note links</span><span>{nodes.length > drawn.length ? `${drawn.length} of ${nodes.length} notes shown` : edges.length ? 'Select a note to explore' : 'No note links yet · Add [[wiki links]] in your notes'}</span></div>
  </div>;
}

export function VaultHub(p: Props) {
  const [tab, setTab] = useState<Tab>(p.focusMode ? 'files' : 'graph');
  const homeTab = useRef<Tab>('graph');
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [focusPath, setFocusPath] = useState<string>();
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const previousRoot = useRef(p.status.vaultPath);
  useEffect(() => { setTab(p.focusMode ? 'files' : homeTab.current); }, [p.focusMode]);
  useEffect(() => {
    if (previousRoot.current === p.status.vaultPath) return;
    previousRoot.current = p.status.vaultPath; setGraph(null); p.onGraph?.(null); setSelectedId(''); setFocusPath(undefined); setQuery(''); setSelectedTag('');
  }, [p.status.vaultPath]);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void Promise.resolve().then(() => api.vaultGraph()).then(next => { if (!active) return; setGraph(next); p.onGraph?.(next); setSelectedId(previous => next.nodes.some(node => node.id === previous) ? previous : next.nodes[0]?.id || ''); }).catch(e => { if (active) setError((e as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [p.notes, p.status.vaultPath, revision, p.onGraph]);
  const nodes = graph?.nodes || [];
  const filtered = nodes.filter(node => `${node.title} ${node.path} ${node.tags.join(' ')} ${node.excerpt}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find(node => node.id === selectedId) || filtered[0];
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) for (const tag of new Set(node.tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);
  const recent = [...filtered].sort((a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0));
  const tagged = filtered.filter(node => !selectedTag || node.tags.includes(selectedTag));
  const vaultName = p.status.vaultPath.split(/[\\/]/).filter(Boolean).at(-1) || 'Your vault';
  function choose(id: string) { setSelectedId(id); const node = nodes.find(n => n.id === id); if (node) p.event(`Selected note: ${node.title}`); }
  function changeView(next: Tab) { setTab(next); if (!p.focusMode) homeTab.current = next; }
  function openNote(node: GraphNode | undefined) { if (!node) return; setFocusPath(node.path); changeView('files'); p.event(`Opened note editor: ${node.title}`); }
  function switchTab(next: Tab) { changeView(next); p.event(`Opened vault ${next} view`); }
  function noteRow(node: GraphNode, showDate = false) {
    return <button key={node.id} className={`knowledge-note-row ${selected?.id === node.id ? 'active' : ''}`} onClick={() => choose(node.id)}><FileText size={16} /><div><strong>{node.title}</strong><span>{node.path}</span></div>{showDate && <time>{Number.isFinite(Date.parse(node.modified)) ? new Date(node.modified).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}</time>}<ArrowUpRight className="knowledge-row-arrow" size={14} /></button>;
  }
  return <section className={`reference-panel vault-hub knowledge-hub ${p.focusMode ? 'vault-focus' : ''}`} aria-label="Obsidian vault">
    <header className="knowledge-header">
      <div className="knowledge-title"><Heading as="h2">Knowledge</Heading><div className="knowledge-vault-name" title={p.status.vaultPath}><BookOpen size={13} /><span>{vaultName}</span><span className="knowledge-vault-type">Markdown vault</span></div></div>
      <div className="knowledge-header-actions"><div className="obsidian-app-link"><span><i className={p.obsidian?.running ? 'running' : ''} />{p.obsidian ? p.obsidian.running ? 'Obsidian open' : p.obsidian.installed ? 'Obsidian available' : 'Obsidian not installed' : 'Checking Obsidian'}</span>{p.obsidian?.installed ? <button className="knowledge-button" aria-label="Open Obsidian" onClick={() => p.openObsidian()}>Open Obsidian<ExternalLink size={13} /></button> : <button className="knowledge-button" aria-label="Install Obsidian" onClick={() => void api.openExternal('https://obsidian.md/download')}>Install Obsidian<ExternalLink size={13} /></button>}</div><button className="knowledge-icon-button" aria-label="Refresh vault graph" title="Refresh vault" onClick={() => { setRevision(r => r + 1); p.event('Requested vault graph refresh'); }} disabled={loading}><RefreshCw size={15} /></button></div>
    </header>
    <nav className="knowledge-tabs" aria-label="Vault views">{views.map(({ id, label, Icon }) => <button key={id} aria-label={id === 'files' ? 'Files' : label} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => switchTab(id)}><Icon size={14} /><span>{label}</span>{id === 'context' && p.contextPaths.length > 0 && <small>{p.contextPaths.length}</small>}</button>)}</nav>
    <div className="vault-file-view knowledge-file-view" hidden={tab !== 'files'}>{p.renderFiles(focusPath, p.visible && tab === 'files')}</div>
    <div className="vault-visual-view knowledge-visual-view" hidden={tab === 'files'}>
      <div className="knowledge-discovery-toolbar"><div className="knowledge-search"><Search size={15} /><input type="search" aria-label="Search vault" placeholder="Search titles, tags, or content…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="knowledge-icon-button" aria-label="Clear vault search" onClick={() => setQuery('')}><X size={13} /></button>}</div><span>{filtered.length} {filtered.length === 1 ? 'note' : 'notes'}</span></div>
      <ErrorNote text={error} />
      <div className={`knowledge-browser-layout ${tab === 'graph' ? 'knowledge-graph-layout' : ''}`}>
        <div className="knowledge-browser-content">
          {tab === 'graph' && <div className="vault-graph-area"><div className="knowledge-section-label"><Network size={14} /><span>Note connections</span><span>{graph?.edges.length || 0} links</span></div>{loading && !graph ? <div className="knowledge-empty" role="status"><div className="knowledge-loading-line" /><p>Reading your vault…</p></div> : filtered.length ? <KnowledgeGraph nodes={filtered} edges={graph?.edges || []} selected={selected?.id} select={choose} /> : <div className="knowledge-empty"><Network size={28} /><Heading as="h3">{query ? 'No matching notes' : error ? 'Graph unavailable' : 'Make your first connection'}</Heading><p>{query ? 'Try another title, tag, or phrase.' : error ? 'Your notes are still available in the editor.' : 'Create notes and link them with [[wiki links]] to see their connections.'}</p><button className="knowledge-button" onClick={() => changeView('files')}>Open notes<ArrowUpRight size={14} /></button></div>}</div>}
          {tab === 'recent' && <div className="hub-note-browser knowledge-note-browser"><div className="knowledge-section-label"><Clock3 size={14} /><span>Recently modified</span></div>{recent.length ? recent.map(node => noteRow(node, true)) : <p className="knowledge-empty-copy">{query ? 'No notes match your search.' : 'Your recently edited notes will appear here.'}</p>}</div>}
          {tab === 'tags' && <div className="hub-note-browser knowledge-note-browser"><div className="knowledge-section-label"><Tag size={14} /><span>Browse by tag</span>{selectedTag && <button onClick={() => setSelectedTag('')}>Clear filter<X size={12} /></button>}</div><div className="knowledge-tag-cloud">{tags.map(([tag, count]) => <button key={tag} className={selectedTag === tag ? 'active' : ''} aria-pressed={selectedTag === tag} onClick={() => setSelectedTag(current => current === tag ? '' : tag)}>#{tag}<span>{count}</span></button>)}</div>{!tags.length ? <p className="knowledge-empty-copy">Add #tags or frontmatter tags to your Markdown notes to organize your library.</p> : tagged.length ? tagged.map(node => noteRow(node)) : <p className="knowledge-empty-copy">No notes match this tag and search.</p>}</div>}
          {tab === 'context' && <div className="hub-note-browser context-browser knowledge-note-browser"><div className="knowledge-section-label"><Layers size={14} /><span>Mission context</span><span>{p.contextPaths.length} selected</span></div><p className="knowledge-context-explanation">Choose the notes your agents read when you launch a mission.</p>{filtered.map(node => <label className="knowledge-context-row" key={node.id}><input type="checkbox" aria-label={`Use ${node.title} as mission context`} checked={p.contextPaths.includes(node.path)} onChange={event => { p.setContextPaths(event.target.checked ? [...p.contextPaths, node.path] : p.contextPaths.filter(path => path !== node.path)); p.event(`${event.target.checked ? 'Added' : 'Removed'} mission context: ${node.title}`); }} /><FileText size={16} /><div><strong>{node.title}</strong><span>{node.path}</span></div>{p.contextPaths.includes(node.path) && <Check size={14} />}</label>)}{!filtered.length && <p className="knowledge-empty-copy">{query ? 'No notes match your search.' : 'Create a note to start building shared context.'}</p>}</div>}
        </div>
        <aside className="vault-node-preview knowledge-preview" aria-label="Selected note preview"><div className="knowledge-preview-caption"><FileText size={14} />Note preview</div><div className="node-preview-heading"><Heading as="h3">{selected?.title || 'A place for your ideas'}</Heading></div>{selected && <span className="knowledge-preview-path">{selected.path}</span>}<p>{selected ? previewText(selected) || 'This note is empty. Open it to add your context.' : 'Select a note to read a preview, open the editor, or continue in Obsidian.'}</p>{selected && <div className="knowledge-preview-tags">{selected.tags.map(tag => <button key={tag} onClick={() => { setSelectedTag(tag); changeView('tags'); }}>#{tag}</button>)}<span>{(graph?.edges || []).filter(edge => edge.from === selected.id || edge.to === selected.id).length} linked notes</span></div>}<div className="knowledge-preview-actions"><button className="knowledge-button knowledge-button-primary" aria-label="Open note" disabled={!selected} onClick={() => openNote(selected)}>Open note<ArrowUpRight size={14} /></button><button className="knowledge-button" aria-label="Open note in Obsidian" disabled={!selected || !p.obsidian?.installed} onClick={() => p.openObsidian(selected?.path)}><ExternalLink size={14} /><span>Obsidian</span></button></div></aside>
      </div>
    </div>
    <footer className="knowledge-footer"><span><i className={p.obsidian?.watching ? 'is-connected' : ''} />{loading ? 'Reading vault…' : `${graph?.total ?? p.notes.length} ${(graph?.total ?? p.notes.length) === 1 ? 'note' : 'notes'} · ${p.obsidian?.watching ? 'Live sync' : 'Local files'}`}{graph?.truncated ? ' · Graph capped' : ''}</span><div>{(['claude', 'codex'] as const).map(agent => <button key={agent} onClick={() => p.openAgent(agent)} aria-label={`Open ${agent === 'claude' ? 'Claude' : 'Codex'} conversation`}><i className={p.status.connected[agent] ? 'is-connected' : ''} />{agent === 'claude' ? 'Claude' : 'Codex'}<span>{p.status.connected[agent] ? 'Connected' : 'Sign in'}</span></button>)}</div></footer>
  </section>;
}
