import { Heading } from '../components/Heading';
import { useEffect, useRef, useState } from 'react';
import type { Note, Status } from '../types';
import { api } from '../lib/bridge';
import { ErrorNote } from '../components/UI';
import { BookOpen, Check, ChevronDown, FileText, FolderOpen, MessageSquare, Plus, Save, Search, X } from 'lucide-react';
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
  const [libraryOpen, setLibraryOpen] = useState(false);
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
  const matchingNotes = notes.filter(note => `${note.title} ${note.path}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={`vault-page knowledge-page ${libraryOpen ? 'library-is-open' : ''}`}>
    <div className="knowledge-library-toolbar">
      <button className="knowledge-button knowledge-library-toggle" aria-label="Toggle note library" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(current => !current)}><BookOpen size={15} /><span>Library</span><ChevronDown size={13} /></button>
      <div className="knowledge-search note-search"><Search size={15} /><input type="search" aria-label="Search notes" placeholder="Find a note…" value={query} onChange={event => { setQuery(event.target.value); setLibraryOpen(true); }} />{query && <button className="knowledge-icon-button" aria-label="Clear note search" onClick={() => setQuery('')}><X size={13} /></button>}</div>
      <div className="knowledge-library-actions"><button className="knowledge-button" aria-label="Connect folder" onClick={() => void selectVault()}><FolderOpen size={15} /><span className="knowledge-action-label">Connect folder</span></button><button className="knowledge-button knowledge-button-primary" aria-label="New note" disabled={busy || opening} onClick={() => { if (dirty) notify('Save your current note first.'); else { setError(''); setCreating(true); } }}><Plus size={15} /><span>New note</span></button></div>
    </div>
    <div className="vault-shell knowledge-editor-shell">
      <aside className="note-explorer" aria-label="Note library"><div className="knowledge-explorer-heading"><span>Library</span><span>{query ? `${matchingNotes.length} / ${notes.length}` : notes.length}</span></div>
        <div className="note-list">{matchingNotes.map(note => <button key={note.path} className={active?.path === note.path ? 'active' : ''} aria-current={active?.path === note.path ? 'true' : undefined} aria-label={`Open note ${note.title}`} onClick={() => { void open(note.path); if (!dirty && !busy) setLibraryOpen(false); }}><FileText size={15} /><span><strong>{note.title}</strong><small>{note.path}</small></span>{active?.path === note.path && <span className="knowledge-current-note" />}</button>)}{!matchingNotes.length && <p className="knowledge-empty-copy">{query ? 'No notes match your search.' : 'Your library is ready. Create your first note to begin.'}</p>}</div>
        <div className="knowledge-explorer-footer"><BookOpen size={13} /><span>Plain Markdown, always yours.</span></div>
      </aside>
      <section className="note-editor" aria-label="Note editor">{active ? <>
        <div className="note-toolbar"><div className="knowledge-note-identity"><FileText size={17} /><div><strong>{active.title}</strong><span>{active.path}</span></div>{dirty && <span className="unsaved-dot" title="Unsaved changes" />}</div><div className="editor-tabs" aria-label="Editor mode"><button className={mode === 'edit' ? 'active' : ''} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Write</button><button className={mode === 'preview' ? 'active' : ''} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</button></div></div>
        <ErrorNote text={error} />
        {mode === 'edit' ? <textarea className="note-content" aria-label="Note content" aria-busy={opening} value={content} spellCheck={false} onChange={event => { draftVersion.current++; setContent(event.target.value); }} /> : <div className="note-preview"><Markdown>{content}</Markdown></div>}
        <div className="note-footer"><span className="knowledge-save-state">{dirty ? <span className="knowledge-unsaved-indicator" /> : <Check size={13} />}<span>{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span><span className="knowledge-word-count">{content.trim().split(/\s+/).filter(Boolean).length} words</span></span><div><button className="knowledge-button knowledge-button-ghost" aria-label="Use in workbench" onClick={() => useNote(`Use this note as context (quoted reference):\n\n<note title="${active.title}">\n${content}\n</note>\n\nMy question: `)}><MessageSquare size={14} /><span>Use in workbench</span></button><button className="knowledge-button knowledge-button-primary" aria-label="Save note" disabled={!dirty || busy} onClick={() => void save()}><Save size={14} />{busy ? 'Saving…' : 'Save'}</button></div></div>
      </> : <div className="knowledge-empty"><BookOpen size={30} /><Heading as="h3">A home for your ideas</Heading><p>Open a note from your library, or create one to keep your next thought.</p><ErrorNote text={error} /></div>}</section>
    </div>
    {creating && <dialog ref={dialog} className="small-dialog knowledge-note-dialog" aria-label="Create a note" onCancel={event => { if (busy) event.preventDefault(); else { writeRequest.current++; setCreating(false); } }}><div className="knowledge-dialog-heading"><Heading as="h2">New note</Heading><button className="knowledge-icon-button" aria-label="Close new note" disabled={busy} onClick={() => { writeRequest.current++; setCreating(false); }}><X size={18} /></button></div><p>Give your idea a name. The rest can follow.</p><form onSubmit={event => { event.preventDefault(); void create(); }}><label className="field-label" htmlFor="note-name">Note name</label><input id="note-name" autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="My next idea" /><ErrorNote text={error} /><div className="dialog-actions"><button type="button" className="knowledge-button" disabled={busy} onClick={() => { writeRequest.current++; setCreating(false); }}>Cancel</button><button type="submit" className="knowledge-button knowledge-button-primary" disabled={!name.trim() || busy}><Plus size={14} />{busy ? 'Creating…' : 'Create note'}</button></div></form></dialog>}
  </div>;
}
