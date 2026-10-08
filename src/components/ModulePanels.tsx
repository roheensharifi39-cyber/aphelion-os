import { useEffect, useRef, useState } from 'react';
import type { AutomationInfo, ProjectFile, ProjectInfo, Session } from '../types';
import { api } from '../lib/bridge';
import { Button, ErrorNote } from './UI';
import { PixelIcon } from './PixelIcon';
import { TaskQueue } from './TaskQueue';

export type ModuleName = 'projects' | 'automations' | 'files' | 'terminal' | 'missions';
type Props = { module: ModuleName; project: ProjectInfo | null; close: () => void; updateProject: (project: ProjectInfo | null) => void; refresh: () => void; notify: (text: string) => void; sessions: Session[]; pending: Record<string, string>; openSession: (id: string) => void; retry: (id: string) => void };
const names = { projects: 'Projects', automations: 'Automations', files: 'Files', terminal: 'Terminal', missions: 'Mission history' };
export function ModulePanels(p: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [project, setProject] = useState(p.project);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [directory, setDirectory] = useState('');
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [automations, setAutomations] = useState<AutomationInfo[]>([]);
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('status');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const mounted = useRef(true);
  const commandRunning = useRef(false);
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal();
    void api.project().then(next => { if (mounted.current) setProject(next); }).catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; dialog.current?.close(); };
  }, []);
  useEffect(() => {
    if (p.module === 'files' && project) void loadFiles('');
    if (p.module === 'automations') void api.automations().then(next => { if (mounted.current) setAutomations(next); }).catch(e => { if (mounted.current) setError(e.message); });
  }, [p.module, project?.path]);
  useEffect(() => api.onRuntimeEvent(event => { if (event.type === 'terminal' && event.text && commandRunning.current && mounted.current) setOutput(previous => previous + event.text); }), []);
  async function choose() {
    setBusy(true); setError('');
    try { const next = await api.selectProject(); if (next) { setProject(next); p.updateProject(next); p.refresh(); p.notify(`Connected project: ${next.name}`); } }
    catch (e) { setError((e as Error).message); } finally { if (mounted.current) setBusy(false); }
  }
  async function create() {
    if (!name.trim()) return; setBusy(true); setError('');
    try { const next = await api.createProject(name.trim()); setProject(next); p.updateProject(next); p.refresh(); p.notify(`Created project: ${next.name}`); setName(''); }
    catch (e) { setError((e as Error).message); } finally { if (mounted.current) setBusy(false); }
  }
  async function loadFiles(path: string) {
    setBusy(true); setError('');
    try { const next = await api.listProjectFiles(path || undefined); if (mounted.current) { setFiles(next); setDirectory(path); } }
    catch (e) { if (mounted.current) setError((e as Error).message); } finally { if (mounted.current) setBusy(false); }
  }
  async function read(path: string) {
    setBusy(true); setError('');
    try { const next = await api.readProjectFile(path); if (mounted.current) setFile(next); }
    catch (e) { if (mounted.current) setError((e as Error).message); } finally { if (mounted.current) setBusy(false); }
  }
  async function run(value = command) {
    setBusy(true); setError(''); setOutput(''); setExitCode(null); commandRunning.current = true;
    try { const result = await api.runProjectCommand(value); if (mounted.current) { setOutput(result.output); setExitCode(result.code); } p.refresh(); }
    catch (e) { if (mounted.current) setError((e as Error).message); } finally { commandRunning.current = false; if (mounted.current) setBusy(false); }
  }
  async function automate(id: string) {
    setBusy(true); setError(''); setOutput(''); setExitCode(null); commandRunning.current = true;
    try { const result = await api.runAutomation(id); if (mounted.current) { setOutput(result.output); setExitCode(result.code); setAutomations(await api.automations()); } p.refresh(); }
    catch (e) { if (mounted.current) setError((e as Error).message); } finally { commandRunning.current = false; if (mounted.current) setBusy(false); }
  }
  const connect = <div className="project-connect"><div className="module-empty-icon"><PixelIcon name="folder" size={30} /></div><h3>{project ? 'Project connection' : 'Connect a working directory.'}</h3><p>Your agents plan and build in this real local folder.</p><Button icon="folder" onClick={() => void choose()} disabled={busy}>Select project folder</Button><form onSubmit={event => { event.preventDefault(); void create(); }}><label className="field-label" htmlFor="project-name">Project name</label><div><input id="project-name" value={name} onChange={event => setName(event.target.value)} placeholder="my-next-build" maxLength={80} disabled={busy} /><Button type="submit" icon="plus" variant="green" disabled={busy || !name.trim()}>Create project</Button></div></form></div>;
  return <dialog ref={dialog} className="module-dialog" aria-label={names[p.module]} onCancel={p.close}><div className="module-dialog-heading"><div><PixelIcon name={p.module === 'terminal' ? 'terminal' : p.module === 'automations' ? 'flow' : p.module === 'missions' ? 'chat' : 'folder'} size={22} /><h2>{names[p.module].toUpperCase()}</h2></div><button aria-label="Close module" onClick={p.close}><PixelIcon name="x" size={13} /></button></div><div className="module-dialog-content"><ErrorNote text={error} />
    {p.module === 'projects' && <>{project && <section className="connected-project"><span className="eyebrow">CONNECTED PROJECT</span><h3>{project.name}</h3><p>{project.path}</p><div><span><PixelIcon name="flow" size={12} />{project.branch || 'No Git branch'}</span><span className={project.dirty ? 'dirty' : ''}>{project.branch ? project.dirty ? 'Uncommitted changes' : 'Working tree clean' : 'Local project directory'}</span></div><div className="project-command-actions"><Button icon="terminal" disabled={busy} onClick={() => void run('status')}>Git status</Button><Button icon="eye" disabled={busy} onClick={() => void run('diff')}>Show diff</Button></div></section>}{connect}</>}
    {p.module === 'files' && (project ? <><div className="module-project-line"><span>{project.name} / {directory || '.'}</span><div><Button variant="ghost" icon="folder" disabled={busy} onClick={() => void loadFiles(directory.split('/').slice(0, -1).join('/'))}>Up</Button><Button variant="ghost" icon="flow" disabled={busy} onClick={() => void loadFiles(directory)}>Refresh files</Button></div></div><div className="project-files-view"><div className="project-file-list" aria-label="Project files">{files.map(entry => <button key={entry.path} disabled={busy} onClick={() => entry.kind === 'directory' ? void loadFiles(entry.path) : void read(entry.path)} aria-label={`Open ${entry.kind} ${entry.name}`}><PixelIcon name={entry.kind === 'directory' ? 'folder' : 'book'} size={12} /><span>{entry.name}</span></button>)}{!files.length && <p>{busy ? 'Reading files...' : 'This directory has no visible files.'}</p>}</div><div className="project-file-preview"><div>{file?.path || 'SELECT A FILE'}</div><pre aria-label="File content">{file?.content ?? 'Select a source file to inspect its real contents.'}</pre></div></div></> : connect)}
    {p.module === 'terminal' && <><div className="module-project-line"><span>{project?.name || 'LOCAL ENGINE'}</span><span>{busy ? 'COMMAND RUNNING' : 'READY'}</span></div><form className="terminal-command" onSubmit={event => { event.preventDefault(); void run(); }}><span>›</span><select aria-label="Terminal command" value={command} onChange={event => setCommand(event.target.value)} disabled={busy}><option value="status">status</option><option value="files">files</option><option value="diff">diff</option><option value="test">test</option><option value="build">build</option></select><Button type="submit" variant="green" icon="play" disabled={busy || !project}>Run command</Button></form><div className="terminal-quick-actions"><Button disabled={busy || !project} onClick={() => void run('test')}>Run tests</Button><Button disabled={busy || !project} onClick={() => void run('build')}>Build project</Button><Button disabled={busy || !project} onClick={() => void run('diff')}>Show diff</Button><Button disabled={busy || !project} onClick={() => void run('files')}>List files</Button></div>{!project && <div className="terminal-connect-note">{connect}</div>}</>}
    {p.module === 'automations' && <><p className="module-description">Available actions execute against the connected project and local vault.</p><div className="automation-list">{automations.map(automation => <div key={automation.id}><PixelIcon name="flow" size={21} /><div><strong>{automation.name}</strong><p>{automation.detail}</p></div><span>{automation.status.toUpperCase()}</span><Button variant="green" icon="play" aria-label={`Run ${automation.name}`} disabled={busy || automation.status === 'running'} onClick={() => void automate(automation.id)}>Run</Button></div>)}{!automations.length && <p>No automations are available from the local engine.</p>}</div></>}
    {p.module === 'missions' && <TaskQueue sessions={p.sessions} pending={p.pending} open={id => { p.openSession(id); p.close(); }} retry={p.retry} />}
    {(output || busy || exitCode !== null) && p.module !== 'files' && p.module !== 'missions' && <div className="command-output"><div><span>REAL COMMAND OUTPUT</span><span>{busy ? 'RUNNING' : exitCode !== null ? `EXIT ${exitCode}` : ''}</span></div><pre aria-label="Terminal output">{output || (busy ? 'Waiting for process output...' : 'The command produced no output.')}</pre></div>}
  </div></dialog>;
}
