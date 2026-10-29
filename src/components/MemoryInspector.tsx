import { useEffect, useState } from 'react';
import type { Note } from '../types';
import { api } from '../lib/bridge';
import { Heading } from './Heading';
import { Markdown } from './Markdown';
import { PixelIcon } from './PixelIcon';

export function MemoryInspector({ path, attached, toggle, close, edit }: { path: string; attached: boolean; toggle: () => void; close: () => void; edit: () => void }) {
  const [note, setNote] = useState<Note | null>(null), [error, setError] = useState('');
  useEffect(() => { let live = true; setNote(null); setError(''); void api.readNote(path).then(value => { if (live) setNote(value); }).catch(reason => { if (live) setError(reason.message); }); return () => { live = false; }; }, [path]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [close]);
  return <section className="memory-inspector floating-glass" role="region" aria-label="Selected vault memory"><div className="section-title"><Heading>{note?.title || 'Vault memory'}</Heading><button aria-label="Close memory" onClick={close}><PixelIcon name="x" size={18} /></button></div><p className="memory-path">{path}</p>{error ? <p role="alert">{error}</p> : note ? <div className="memory-preview">{note.content ? <Markdown>{note.content}</Markdown> : <p>This note is empty. Open it to add your first thought.</p>}</div> : <p role="status">Reading this memory…</p>}<div className="memory-actions"><button onClick={toggle} aria-pressed={attached}>{attached ? 'Remove from context' : 'Attach to conversation'}</button><button onClick={edit}>Edit note</button></div></section>;
}
