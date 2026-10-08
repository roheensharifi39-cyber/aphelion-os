import { watch as watchFilesystem } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readNote } from './vault.mjs';

const execute = promisify(execFile);
const DOWNLOAD = 'https://obsidian.md/download';
const ignored = path => path.split(/[\\/]/).some(part => !part || part.startsWith('.') || part.toLowerCase() === 'node_modules' || part.startsWith('~$') || part.endsWith('~') || /\.(?:tmp|temp|swp|swo|bak)$/i.test(part));
const environment = (env, name) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';

async function regularFile(path) { try { return (await lstat(path)).isFile(); } catch { return false; } }
async function findApp(env, platform, execFileImpl) {
  const local = environment(env, 'LOCALAPPDATA'), programs = environment(env, 'ProgramFiles'), programs32 = environment(env, 'ProgramFiles(x86)');
  const candidates = platform === 'win32'
    ? [local && join(local, 'Programs', 'Obsidian', 'Obsidian.exe'), local && join(local, 'Obsidian', 'Obsidian.exe'), programs && join(programs, 'Obsidian', 'Obsidian.exe'), programs32 && join(programs32, 'Obsidian', 'Obsidian.exe')]
    : [...environment(env, 'PATH').split(delimiter).filter(Boolean).map(dir => join(dir, 'obsidian')), ...(platform === 'darwin' ? ['/Applications/Obsidian.app/Contents/MacOS/Obsidian'] : [])];
  for (const candidate of candidates.filter(Boolean)) if (await regularFile(candidate)) return candidate;
  if (platform !== 'win32') return null;
  for (const key of ['HKEY_CURRENT_USER\\Software\\Classes\\obsidian\\shell\\open\\command', 'HKEY_CLASSES_ROOT\\obsidian\\shell\\open\\command']) {
    try {
      const result = await execFileImpl('reg.exe', ['query', key, '/ve'], { windowsHide: true, timeout: 5000, maxBuffer: 64000 });
      const command = /REG_(?:SZ|EXPAND_SZ)\s+([^\r\n]+)/i.exec(result.stdout)?.[1]?.trim();
      const value = command && (/^"([^"]+\.exe)"/i.exec(command)?.[1] || /^(.+?\.exe)(?:\s|$)/i.exec(command)?.[1]);
      const candidate = value?.replace(/%([^%]+)%/g, (_all, name) => environment(env, name));
      if (candidate && basename(candidate).toLowerCase() === 'obsidian.exe' && await regularFile(candidate)) return candidate;
    } catch { /* A missing registration is normal before the first native launch. */ }
  }
  return null;
}

async function nativeProcesses(platform, execFileImpl) {
  try {
    if (platform === 'win32') {
      const result = await execFileImpl('tasklist.exe', ['/FI', 'IMAGENAME eq Obsidian.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 100000 });
      return [...result.stdout.matchAll(/^"Obsidian\.exe","(\d+)"/gmi)].map(match => ({ pid: Number(match[1]), name: 'Obsidian', role: 'obsidian' })).filter(item => Number.isSafeInteger(item.pid) && item.pid > 0);
    }
    const result = await execFileImpl('pgrep', ['-ix', 'obsidian'], { timeout: 5000, maxBuffer: 100000 });
    return result.stdout.trim().split(/\s+/).map(Number).filter(pid => Number.isSafeInteger(pid) && pid > 0).map(pid => ({ pid, name: 'Obsidian', role: 'obsidian' }));
  } catch { return []; }
}

async function registeredVaults(env, platform) {
  const appData = environment(env, 'APPDATA');
  if (!appData) return [];
  const file = join(appData, 'obsidian', 'obsidian.json');
  let data;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 1000000) throw new Error('Obsidian vault metadata is not a valid configuration file.');
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Obsidian vault metadata could not be read. Open its vault manager to review your folders.');
  }
  const seen = new Set(), vaults = [];
  for (const [id, value] of Object.entries(data?.vaults || {})) {
    if (!value || typeof value.path !== 'string' || !isAbsolute(value.path)) continue;
    try {
      const path = await realpath(value.path);
      if (!(await lstat(path)).isDirectory()) continue;
      const key = platform === 'win32' ? path.toLowerCase() : path;
      if (seen.has(key)) continue;
      seen.add(key);
      vaults.push({ id, path, name: basename(path), ...(typeof value.open === 'boolean' ? { open: value.open } : {}) });
    } catch { /* Removed or unavailable folders cannot be opened by this adapter. */ }
  }
  return vaults.sort((a, b) => Number(!!b.open) - Number(!!a.open) || a.path.localeCompare(b.path));
}

async function launchNative(command, uri) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(command, [uri], { windowsHide: true, shell: false, detached: true, stdio: 'ignore', env });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function openBrowser(url) {
  const electron = await import('electron');
  const shell = electron.shell || electron.default?.shell;
  if (!shell?.openExternal) throw new Error(`Open ${DOWNLOAD} in your browser to install Obsidian.`);
  await shell.openExternal(url);
}

async function indexVault(root) {
  const notes = [];
  async function visit(folder, prefix = '', depth = 0) {
    if (depth > 12 || notes.length >= 1000) return;
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if (folder !== root && error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = prefix + entry.name;
      if (ignored(path) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(resolve(folder, entry.name), path + '/', depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const note = await readNote(root, path);
          notes.push({ path: note.path, revision: note.revision, modified: note.modified });
        } catch (error) {
          if (error.code !== 'ENOENT' && !/outside|symbolic|larger than/i.test(error.message)) throw error;
        }
      }
      if (notes.length >= 1000) break;
    }
  }
  await visit(root);
  return notes.sort((a, b) => a.path.localeCompare(b.path));
}

export function createObsidianAdapter({ getVaultPath, onEvent = () => {}, env = process.env, platform = process.platform, execFileImpl = execute, launchImpl = launchNative, openExternalImpl = openBrowser }) {
  if (typeof getVaultPath !== 'function' || typeof onEvent !== 'function') throw new Error('Provide a selected vault and an event handler.');
  let disposed = false, requested = false, generation = 0, watcher = null, timer = null;
  let indexed = [], queued = Promise.resolve(), selected = '', starting = null, vaultError = '';
  let processSnapshot = null, processesAt = 0, processRequest = null;
  const changes = new Set();
  const info = { installed: false, running: false, vaultPath: '', watching: false, indexedAt: 0, noteCount: 0, detail: 'Obsidian is not installed. Download it from https://obsidian.md/download.' };
  function selection() {
    const path = getVaultPath();
    if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) throw new Error('Choose an existing Markdown vault folder first.');
    return resolve(path);
  }
  function emit(event) { if (!disposed) onEvent({ source: 'vault', ...event }); }
  function reportError(error) {
    const detail = `Live vault sync is unavailable: ${error.message}`;
    if (detail !== vaultError) emit({ type: 'activity', text: detail });
    vaultError = detail;
  }
  async function processes() {
    if (processSnapshot && Date.now() - processesAt < 2000) return processSnapshot.map(item => ({ ...item }));
    if (!processRequest) processRequest = nativeProcesses(platform, execFileImpl).then(result => { processSnapshot = result; processesAt = Date.now(); return result; }).finally(() => { processRequest = null; });
    return (await processRequest).map(item => ({ ...item }));
  }
  async function status() {
    if (requested && !disposed && selection() !== selected) { try { await watch(); } catch (error) { reportError(error); } }
    const [app, records] = await Promise.all([findApp(env, platform, execFileImpl), processes()]);
    const running = records.length > 0;
    if (info.running !== running) emit({ type: 'activity', text: running ? 'Obsidian is running.' : 'Obsidian has stopped.', data: { running } });
    info.installed = !!app; info.running = running;
    info.detail = vaultError || (!app ? `Obsidian is not installed. Download it from ${DOWNLOAD}.` : running ? 'Obsidian is running. Vault files are shared directly from disk.' : 'Obsidian is installed. Open your vault to start the native app.');
    return { ...info, vaultPath: info.vaultPath || selection() };
  }
  function closeWatcher() {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher?.close(); watcher = null;
    changes.clear(); info.watching = false;
  }
  function reindex(token, initial = false) {
    queued = queued.catch(() => {}).then(async () => {
      if (disposed || token !== generation) return;
      const paths = [...changes]; changes.clear();
      const notes = await indexVault(info.vaultPath);
      if (disposed || token !== generation) return;
      const before = new Set(indexed.map(note => note.path)), after = new Set(notes.map(note => note.path));
      const changed = paths.filter(path => before.has(path) || after.has(path));
      const different = JSON.stringify(indexed) !== JSON.stringify(notes);
      indexed = notes; info.noteCount = notes.length; info.indexedAt = Date.now(); vaultError = '';
      if (initial || changed.length || different) emit({ type: 'vault', text: initial ? `Watching ${notes.length} Markdown notes.` : 'Your vault changed on disk.', data: { vaultPath: info.vaultPath, indexedAt: info.indexedAt, noteCount: info.noteCount, paths: changed } });
    });
    return queued;
  }
  async function watch() {
    if (disposed) throw new Error('The Obsidian integration has been closed.');
    requested = true;
    const path = selection();
    if (starting?.path === path) return starting.promise;
    if (path === selected && info.watching) { await queued; return; }
    const current = { path, promise: null };
    current.promise = startWatching(path).finally(() => { if (starting === current) starting = null; });
    starting = current;
    return current.promise;
  }
  async function startWatching(path) {
    const token = ++generation; closeWatcher(); selected = path;
    info.vaultPath = path; info.indexedAt = 0; info.noteCount = 0; indexed = []; vaultError = '';
    try {
      const root = await realpath(path);
      if (!(await lstat(root)).isDirectory()) throw new Error('Choose an existing vault folder.');
      if (disposed || token !== generation) return;
      info.vaultPath = root;
      watcher = watchFilesystem(root, { recursive: true, persistent: false }, (_event, filename) => {
        if (disposed || token !== generation) return;
        const path = filename?.toString().replace(/\\/g, '/');
        if (path && ignored(path)) return;
        if (path?.endsWith('.md')) changes.add(path);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; void reindex(token).catch(reportError); }, 150);
        timer.unref?.();
      });
      watcher.on('error', error => { if (token !== generation) return; closeWatcher(); reportError(error); });
      info.watching = true;
      await reindex(token, true);
    } catch (error) {
      if (token === generation) { closeWatcher(); reportError(error); }
      throw error;
    }
  }
  const monitor = setInterval(() => {
    if (!requested || disposed) return;
    try { if (selection() !== selected || (!info.watching && !starting)) void watch().catch(reportError); }
    catch (error) { reportError(error); }
  }, 1000);
  monitor.unref?.();
  return {
    status,
    watch,
    async open(path) {
      if (disposed) throw new Error('The Obsidian integration has been closed.');
      const root = await realpath(selection());
      if (!(await lstat(root)).isDirectory()) throw new Error('Choose an existing vault folder first.');
      if (path !== undefined) await readNote(root, path);
      const app = await findApp(env, platform, execFileImpl);
      if (!app) {
        await openExternalImpl(DOWNLOAD);
        throw new Error(`Obsidian is not installed. Install it from ${DOWNLOAD}, then open your vault again.`);
      }
      const vaults = await registeredVaults(env, platform);
      const key = platform === 'win32' ? root.toLowerCase() : root;
      const registered = vaults.find(vault => (platform === 'win32' ? vault.path.toLowerCase() : vault.path) === key);
      const uri = registered ? path === undefined ? `obsidian://open?vault=${encodeURIComponent(registered.id)}` : `obsidian://open?path=${encodeURIComponent(join(root, path))}` : 'obsidian://choose-vault';
      try { await launchImpl(app, uri); }
      catch { throw new Error('Obsidian could not start. Open the installed app and try again.'); }
      processesAt = 0;
      const detail = registered ? path === undefined ? 'Sent your vault to the native Obsidian app.' : `Sent ${path} to the native Obsidian app.` : `In Obsidian, choose “Open folder as vault” and select ${root}. Then open your note again.`;
      emit({ type: 'activity', text: detail, data: { vaultPath: root, ...(registered && path !== undefined ? { path } : {}) } });
      return { ...await status(), detail };
    },
    async discoverVaults() { return (await registeredVaults(env, platform)).map(({ id: _id, ...vault }) => vault); },
    processes,
    dispose() { disposed = true; generation++; clearInterval(monitor); closeWatcher(); },
  };
}
