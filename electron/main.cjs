const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

if (process.env.APHELION_TEST_HOME) app.setPath('userData', path.resolve(process.env.APHELION_TEST_HOME));
let window;
let config = { keys: {}, models: { claude: 'claude-sonnet-4-6', codex: 'gpt-6-sol' }, voiceId: 'JBFqnCBsd6RMkjVDRZzb', repo: 'https://github.com/roheensharifi39-cyber/aphelion-os', vaultPath: '' };
let credentialError = '';
const jobs = new Map();
const devURL = process.env.APHELION_DEV_URL === 'http://127.0.0.1:5173' ? process.env.APHELION_DEV_URL : null;
const indexURL = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const files = () => ({ preferences: path.join(app.getPath('userData'), 'preferences.json'), secrets: path.join(app.getPath('userData'), 'credentials.bin') });

function validSender(event) {
  const url = event.senderFrame?.url?.split('#')[0];
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame || (devURL ? url !== devURL && url !== devURL + '/' : url !== indexURL)) throw new Error('This request did not come from the Aphelion workspace.');
}
function handle(name, fn) { ipcMain.handle('aphelion:' + name, async (event, ...args) => { validSender(event); return fn(event, ...args); }); }
function encryptionReady() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
function status() { return { desktop: true, keys: { claude: !!config.keys.claude, codex: !!config.keys.codex, elevenlabs: !!config.keys.elevenlabs }, models: config.models, voiceId: config.voiceId, repo: config.repo, vaultPath: config.vaultPath, encryptionAvailable: encryptionReady(), credentialError }; }
async function persist(next) {
  const locations = files();
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  if (Object.values(next.keys).some(Boolean) && !encryptionReady()) throw new Error('Secure key storage is unavailable. Your keys have not been saved.');
  if (encryptionReady()) {
    await fs.writeFile(locations.secrets + '.tmp', safeStorage.encryptString(JSON.stringify(next.keys)), { mode: 0o600 });
    await fs.rename(locations.secrets + '.tmp', locations.secrets);
  }
  const { keys: _keys, ...preferences } = next;
  await fs.writeFile(locations.preferences + '.tmp', JSON.stringify(preferences, null, 2));
  await fs.rename(locations.preferences + '.tmp', locations.preferences);
  config = next;
  credentialError = '';
}
async function loadConfig() {
  try {
    const stored = JSON.parse(await fs.readFile(files().preferences, 'utf8'));
    for (const key of ['models', 'voiceId', 'repo', 'vaultPath']) if (stored[key]) config[key] = stored[key];
  } catch (error) { if (error.code !== 'ENOENT') credentialError = 'Saved settings could not be loaded. Review your connections.'; }
  try { config.keys = JSON.parse(safeStorage.decryptString(await fs.readFile(files().secrets))); }
  catch (error) { if (error.code !== 'ENOENT') credentialError = 'Saved keys could not be unlocked. Reconnect your providers in Settings.'; }
  if (!config.vaultPath) config.vaultPath = path.join(app.getPath('userData'), 'vault');
}
function validateConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid settings.');
  const next = { ...config, keys: { ...config.keys }, models: { ...config.models } };
  if (input.models) for (const provider of ['claude', 'codex']) {
    if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(input.models[provider])) throw new Error('Enter a valid model ID.');
    next.models[provider] = input.models[provider];
  }
  if (input.keys) for (const provider of ['claude', 'codex', 'elevenlabs']) {
    const key = input.keys[provider];
    if (key !== undefined && (typeof key !== 'string' || key.length > 4000)) throw new Error('Invalid API key.');
    if (key?.trim()) next.keys[provider] = key.trim();
  }
  if (input.clearKey && ['claude', 'codex', 'elevenlabs'].includes(input.clearKey)) delete next.keys[input.clearKey];
  if (input.voiceId !== undefined) {
    if (!/^[\w-]{1,100}$/.test(input.voiceId)) throw new Error('Enter a valid voice ID.');
    next.voiceId = input.voiceId;
  }
  if (input.repo !== undefined) {
    if (input.repo && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(input.repo)) throw new Error('Use a GitHub repository URL in https://github.com/owner/repo format.');
    next.repo = input.repo;
  }
  return next;
}

app.whenReady().then(async () => {
  const services = await import('./services.mjs');
  const vault = await import('./vault.mjs');
  await loadConfig();
  await vault.initializeVault(path.join(app.getPath('userData'), 'vault'));
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 940, minHeight: 680, frame: false, backgroundColor: '#121512', title: 'Aphelion OS', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== indexURL && url !== devURL && url !== devURL + '/') event.preventDefault(); });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === window?.webContents && permission === 'media' && !!details.mediaTypes?.length && details.mediaTypes.every(type => type === 'audio')));
  handle('status', () => status());
  handle('configure', async (_event, input) => { const next = validateConfig(input); await persist(next); return status(); });
  handle('chat', async (event, request) => {
    if (!request || typeof request.requestId !== 'string' || !/^[\w-]{1,100}$/.test(request.requestId) || jobs.has(request.requestId) || jobs.size >= 4) throw new Error('Start a valid request or wait for your current sessions.');
    const controller = new AbortController(); jobs.set(request.requestId, controller);
    try { return await services.runChat(request, config, { signal: controller.signal, onDelta: delta => { if (!event.sender.isDestroyed()) event.sender.send('aphelion:delta', { requestId: request.requestId, delta }); } }); }
    finally { jobs.delete(request.requestId); }
  });
  handle('cancel', (_event, id) => { jobs.get(id)?.abort(); });
  handle('selectVault', async () => {
    const selection = await dialog.showOpenDialog(window, { title: 'Choose your Obsidian or Markdown vault', properties: ['openDirectory'] });
    if (selection.canceled) return null;
    await vault.listNotes(selection.filePaths[0]);
    await persist({ ...config, vaultPath: selection.filePaths[0] });
    return status();
  });
  handle('listNotes', () => vault.listNotes(config.vaultPath));
  handle('readNote', (_event, file) => vault.readNote(config.vaultPath, file));
  handle('saveNote', (_event, note) => vault.saveNote(config.vaultPath, note));
  handle('speak', (_event, text) => services.synthesize(text, config));
  handle('transcribe', (_event, audio) => services.transcribe(audio, config));
  handle('openExternal', async (_event, raw) => {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['github.com', 'platform.openai.com', 'platform.claude.com', 'console.anthropic.com', 'elevenlabs.io', 'obsidian.md'].includes(url.hostname)) throw new Error('This external link is not supported.');
    await shell.openExternal(url.href);
  });
  handle('windowAction', (_event, action) => {
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  if (devURL) await window.loadURL(devURL); else await window.loadFile(path.join(__dirname, '../dist/index.html'));
}).catch(error => { dialog.showErrorBox('Aphelion could not start', error.message); app.quit(); });

app.on('window-all-closed', () => { for (const job of jobs.values()) job.abort(); app.quit(); });
