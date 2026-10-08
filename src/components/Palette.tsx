import { useEffect, useRef, useState } from 'react';
import { PixelIcon, type IconName } from './PixelIcon';
export type Command = { title: string; detail: string; icon: IconName; action: () => void; shortcut?: string };
export function Palette({ commands, close }: { commands: Command[]; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const results = commands.filter(c => `${c.title} ${c.detail}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  function choose(command: Command) { close(); command.action(); }
  return <dialog ref={dialog} className="command-dialog" aria-label="Command palette" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="palette-search"><PixelIcon name="search" /><input aria-label="Find a command" placeholder="Where do you want to go?" autoFocus value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(results.length - 1, i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(0, i - 1)); } if (e.key === 'Enter' && results[selected]) { e.preventDefault(); choose(results[selected]); } }} /><kbd>ESC</kbd></div><div className="palette-results">{results.map((c, i) => <button key={c.title} className={selected === i ? 'selected' : ''} onMouseEnter={() => setSelected(i)} onClick={() => choose(c)}><PixelIcon name={c.icon} /><div><strong>{c.title}</strong><span>{c.detail}</span></div>{c.shortcut && <kbd>{c.shortcut}</kbd>}</button>)}{!results.length && <p>No commands found. Try “vault” or “Claude”.</p>}</div><div className="palette-footer">↑ ↓ to explore <span>↵ to open</span></div></dialog>;
}
