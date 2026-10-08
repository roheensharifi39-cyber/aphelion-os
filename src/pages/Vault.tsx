import { useEffect, useRef, useState } from 'react';
import type { Note, Status } from '../types';
import { api } from '../lib/bridge';
import { Badge, Button, ErrorNote } from '../components/UI';
import { PixelIcon } from '../components/PixelIcon';
import { Markdown } from '../components/Markdown';
type Props = { notes: Note[]; refresh: () => Promise<void>; status: Status; updateStatus: (status: Status) => void; notify: (message: string) => void; useNote: (text: string) => void; activePage: boolean; onDirtyChange: (dirty: boolean) => void; focusPath?: string };
export function Vault({ notes, refresh, status, updateStatus, notify, useNote, activePage, onDirtyChange, focusPath }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [opening, setOpening] = useState(false);
  const openRequest = useRef(0);
  const draftVersion = useRef(0);
  const writeRequest = useRef(0);
  const activeRef = useRef<Note | null>(active);
  activeRef.current = active;
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = !!active && content !== active.content;
  const previousRoot = useRef(status.vaultPath);
  useEffect(() => { onDirtyChange(dirty || busy || opening); }, [dirty, busy, opening, onDirtyChange]);
  useEffect(() => { if (previousRoot.current !== status.vaultPath) { previousRoot.current = status.vaultPath; openRequest.current++; draftVersion.current++; setOpening(false); setActive(null); setContent(''); setError(''); } }, [status.vaultPath]);
  useEffect(() => { if (!active && notes[0]) void open(notes[0].path); }, [notes, active?.path, status.vaultPath]);
  useEffect(() => { const changed = active && notes.find(note => note.path === active.path); if (active && changed && changed.modified !== active.modified && !dirty && !busy && !opening) void open(active.path); }, [notes]);
  useEffect(() => { if (activePage && focusPath && focusPath !== activeRef.current?.path) void open(focusPath); }, [focusPath, activePage]);
  useEffect(() => { if (creating) dialog.current?.showModal(); else dialog.current?.close(); }, [creating]);
  useEffect(() => {
    function saveKey(e: KeyboardEvent) { if (activePage && (e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (dirty && !busy) void save(); } }
    function leaving(e: BeforeUnloadEvent) { if (dirty) e.preventDefault(); }
    window.addEventListener('keydown', saveKey); window.addEventListener('beforeunload', leaving);
    return () => { window.removeEventListener('keydown', saveKey); window.removeEventListener('beforeunload', leaving); };
  }, [dirty, busy, active, content, activePage]);
  async function open(path: string) {
    if (busy) { notify('Finish the current note save before opening another.'); return; }
    if (dirty) { notify('Save your current note before opening another.'); return; }
    const request = ++openRequest.current;
    const version = draftVersion.current;
    setOpening(true);
    try { const note = await api.readNote(path); if (request !== openRequest.current || version !== draftVersion.current) return; setActive(note); setContent(note.content || ''); setMode('edit'); setError(''); } catch (e) { if (request === openRequest.current) setError((e as Error).message); }
    finally { if (request === openRequest.current) setOpening(false); }
  }
  async function save() {
    if (!active || busy) return; setBusy(true); setError('');
    const request = ++writeRequest.current, root = status.vaultPath, opened = openRequest.current, file = active.path;
    try { const note = await api.saveNote({ ...active, content }); if (request === writeRequest.current && root === previousRoot.current && opened === openRequest.current && activeRef.current?.path === file) setActive(note); await refresh(); notify('Note saved.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function create() {
    if (busy) return;
    const title = name.trim().replace(/\.md$/i, '');
    if (!title || /[\\/:*?"<>|]/.test(title) || title.startsWith('.')) { setError('Use a note name without special path characters.'); return; }
    setBusy(true);
    const request = ++writeRequest.current, root = status.vaultPath, opened = openRequest.current, version = draftVersion.current;
    try { const note = await api.saveNote({ path: title + '.md', title, modified: '', content: `# ${title}\n\n`, create: true }); if (request === writeRequest.current && root === previousRoot.current && opened === openRequest.current && version === draftVersion.current) { setActive(note); setContent(note.content || ''); setMode('edit'); setCreating(false); setName(''); setError(''); } await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function selectVault() { if (dirty || busy || opening) { notify('Finish your current note before switching vaults.'); return; } try { const result = await api.selectVault(); if (result) { updateStatus(result); setActive(null); await refresh(); notify('Your vault is connected.'); } } catch (e) { notify((e as Error).message); } }
  return <div className="vault-page page-content"><div className="page-intro"><div><div className="eyebrow">YOUR SHARED MEMORY</div><h1>Obsidian vault</h1><p>Your notes and shared memory, directly in your command center.</p></div><div className="intro-actions"><Button icon="link" onClick={() => void selectVault()}>Connect folder</Button><Button icon="plus" variant="green" onClick={() => { if (dirty) notify('Save your current note first.'); else { setError(''); setCreating(true); } }}>New note</Button></div></div><div className="vault-shell panel"><aside className="note-explorer"><div className="note-search"><PixelIcon name="search" size={13} /><input aria-label="Search notes" placeholder="Find a note..." value={query} onChange={e => setQuery(e.target.value)} /></div><div className="explorer-label"><PixelIcon name="folder" size={13} /><span>LOCAL VAULT</span><span>{notes.length}</span></div><div className="note-list">{notes.filter(n => `${n.title} ${n.path}`.toLowerCase().includes(query.toLowerCase())).map(note => <button key={note.path} className={active?.path === note.path ? 'active' : ''} aria-label={`Open note ${note.title}`} onClick={() => void open(note.path)}><PixelIcon name="book" size={14} /><span>{note.title}</span><small>.md</small></button>)}{notes.length === 0 && <p className="empty-explorer">Your vault is empty.<br />Place the first note.</p>}</div><div className="explorer-footer"><PixelIcon name="save" size={14} /><p>{'Plain Markdown.\nLive Obsidian folder.'}</p></div></aside><section className="note-editor">{active ? <><div className="note-toolbar"><div><PixelIcon name="book" size={15} /><strong>{active.title}</strong>{dirty && <span className="unsaved-dot" title="Unsaved changes" />}</div><div className="editor-tabs"><button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Write</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button></div></div><ErrorNote text={error} />{mode === 'edit' ? <textarea className="note-content" aria-label="Note content" aria-busy={opening} value={content} spellCheck={false} onChange={e => { draftVersion.current++; setContent(e.target.value); }} /> : <div className="note-preview"><Markdown>{content}</Markdown></div>}<div className="note-footer"><span>{content.trim().split(/\s+/).filter(Boolean).length} words <span className="footer-divider">/</span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span><div><Button icon="chat" variant="ghost" onClick={() => useNote(`Use this note as context (quoted reference):\n\n<note title="${active.title}">\n${content}\n</note>\n\nMy question: `)}>Use in workbench</Button><Button variant="green" icon="save" aria-label="Save note" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save'}</Button></div></div></> : <div className="chat-empty"><div className="large-item-slot gold"><PixelIcon name="book" size={40} /></div><h2>A home for your ideas.</h2><p>Open a note or create one to get started.</p><Badge tone="gold">SHARED BETWEEN YOUR AGENTS</Badge><ErrorNote text={error} /></div>}</section></div>{creating && <dialog ref={dialog} className="small-dialog" aria-label="Create a note" onCancel={event => { if (busy) event.preventDefault(); else { writeRequest.current++; setCreating(false); } }}><div className="dialog-heading"><PixelIcon name="book" size={22} /><h2>A new block of memory.</h2></div><p>Give your idea a name. You can make it bigger later.</p><form onSubmit={e => { e.preventDefault(); void create(); }}><label className="field-label" htmlFor="note-name">Note name</label><input id="note-name" autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="My next big idea" /><ErrorNote text={error} /><div className="dialog-actions"><Button disabled={busy} onClick={() => { writeRequest.current++; setCreating(false); }}>Cancel</Button><Button type="submit" variant="green" icon="plus" disabled={!name.trim() || busy}>Create note</Button></div></form></dialog>}</div>;
}
