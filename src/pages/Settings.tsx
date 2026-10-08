import { useState } from 'react';
import type { Agent, Status, Workspace } from '../types';
import { api } from '../lib/bridge';
import { Badge, Button, ErrorNote, SectionHeading } from '../components/UI';
import { PixelIcon } from '../components/PixelIcon';

type Props = { hasNoteDraft: boolean; status: Status; updateStatus: (status: Status) => void; workspace: Workspace; updateWorkspace: (update: Workspace | ((w: Workspace) => Workspace)) => void; refreshNotes: () => Promise<void>; notify: (text: string) => void };
export function Settings({ hasNoteDraft, status, updateStatus, workspace, updateWorkspace, refreshNotes, notify }: Props) {
  const [models, setModels] = useState(status.models);
  const [name, setName] = useState(workspace.name);
  const [repo, setRepo] = useState(status.repo);
  const [busy, setBusy] = useState<'save' | 'check' | Agent | null>(null);
  const [error, setError] = useState('');
  async function save() {
    if (!name.trim()) { setError('Give your workspace a name.'); return; }
    setBusy('save'); setError('');
    try {
      const next = await api.configure({ models, repo }); updateStatus(next);
      updateWorkspace(w => ({ ...w, name: name.trim() })); notify('Workspace preferences saved.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function login(agent: Agent) {
    setBusy(agent); setError('');
    try {
      const next = await api.login(agent); updateStatus(next);
      notify(next.connected[agent] ? `${agent === 'claude' ? 'Claude' : 'Codex'} subscription connected.` : next.auth[agent].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function check() {
    setBusy('check'); setError('');
    try { updateStatus(await api.status()); notify('Subscription connections refreshed.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function folder() {
    if (hasNoteDraft) { notify('Save your note draft before switching vault folders.'); return; }
    try { const next = await api.selectVault(); if (next) { updateStatus(next); await refreshNotes(); notify('Vault folder connected.'); } }
    catch (e) { setError((e as Error).message); }
  }
  return <div className="settings-page page-content"><div className="page-intro"><div><div className="eyebrow">SYSTEM CONFIGURATION</div><h1>Connect your orbit.</h1><p>Your existing subscriptions. Your real local workspace.</p></div><Badge tone="green">LOCAL ENGINE</Badge></div>
    <ErrorNote text={error} />
    <section className="panel settings-panel"><SectionHeading eyebrow="EXISTING ACCOUNTS" title="Subscription connections"><Button icon="link" variant="ghost" disabled={!!busy} onClick={() => void check()}>{busy === 'check' ? 'Checking...' : 'Check connections'}</Button></SectionHeading>
      <div className="connection-grid">{([{ id: 'claude', name: 'Claude', description: 'Claude subscription through Claude Code.', icon: 'spark', tone: 'peach' }, { id: 'codex', name: 'Codex', description: 'ChatGPT subscription through Codex.', icon: 'terminal', tone: 'blue' }] as const).map(provider => <div className={`connection-card ${provider.tone}`} key={provider.id}><div className="connection-heading"><div className="item-slot"><PixelIcon name={provider.icon} size={24} /></div><Badge tone={status.connected[provider.id] ? 'green' : 'muted'}>{status.connected[provider.id] ? 'CONNECTED' : 'SIGN-IN REQUIRED'}</Badge></div><h3>{provider.name}</h3><p>{provider.description}</p><div className="connection-detail"><span className={`status-dot ${status.connected[provider.id] ? '' : 'idle'}`} /><span>{status.auth[provider.id].detail}</span></div><Button variant={status.connected[provider.id] ? 'stone' : 'green'} icon="link" disabled={!!busy} onClick={() => void login(provider.id)}>{busy === provider.id ? 'Opening sign-in...' : status.connected[provider.id] ? `Manage ${provider.name} sign-in` : `Sign in to ${provider.name}`}</Button></div>)}</div>
      <div className="settings-security"><PixelIcon name="check" size={13} /><span>Official subscription login. Authentication stays with your installed agents.</span></div>
    </section>
    <div className="settings-bottom-grid"><section className="panel settings-panel"><SectionHeading eyebrow="AGENT PREFERENCES" title="Models" /><p className="field-help">Use auto to follow the model available to your subscription.</p><div className="model-fields"><div><label className="field-label" htmlFor="claude-model">Claude model</label><input id="claude-model" value={models.claude} onChange={e => setModels(m => ({ ...m, claude: e.target.value }))} placeholder="auto" /></div><div><label className="field-label" htmlFor="codex-model">Codex model</label><input id="codex-model" value={models.codex} onChange={e => setModels(m => ({ ...m, codex: e.target.value }))} placeholder="auto" /></div></div><label className="field-label" htmlFor="workspace-name">Workspace name</label><input id="workspace-name" value={name} maxLength={32} onChange={e => setName(e.target.value)} /><label className="field-label" htmlFor="github-repo">GitHub repository</label><input id="github-repo" value={repo} onChange={e => setRepo(e.target.value)} placeholder="https://github.com/owner/repo" /><div className="setting-toggle"><div><strong>Button sounds</strong><p>Pixel clicks throughout your command center.</p></div><button role="switch" aria-checked={workspace.sound} aria-label="Button sounds" className={`pixel-toggle ${workspace.sound ? 'on' : ''}`} onClick={() => updateWorkspace(w => ({ ...w, sound: !w.sound }))}><span /></button></div></section>
      <section className="panel settings-panel"><SectionHeading eyebrow="LOCAL SHARED MEMORY" title="Obsidian vault" /><div className="vault-settings-icon"><PixelIcon name="book" size={34} /></div><p className="vault-settings-description">Connect a folder of Markdown notes.<br />Edit the same files you use in Obsidian.</p><div className="vault-path">{status.vaultPath || 'Aphelion vault'}</div><Button icon="folder" onClick={() => void folder()}>Choose vault folder</Button><p className="field-help">Changes made in other apps are checked before saving.</p><div className="settings-voice-link"><PixelIcon name="mic" size={18} /><div><strong>ElevenLabs studio</strong><p>Open your subscription in the official voice studio.</p></div><Button icon="arrow" variant="ghost" aria-label="Open ElevenLabs" onClick={() => void api.openExternal('https://elevenlabs.io/app').catch(e => setError(e.message))} /></div></section></div>
    <div className="settings-save"><span>Preferences stay on this device.</span><Button variant="green" icon="save" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving...' : 'Save settings'}</Button></div><section className="shortcuts-panel"><span className="eyebrow">FLIGHT CONTROLS</span><span><kbd>Ctrl K</kbd> Command search</span><span><kbd>Alt 1–6</kbd> Open a tool</span><span><kbd>Ctrl ⇧ C / X</kbd> Claude / Codex</span><span><kbd>Ctrl S</kbd> Save a note</span></section>
  </div>;
}
