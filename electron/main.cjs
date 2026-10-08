const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
if (process.env.APHELION_TEST_HOME) app.setPath('userData', path.resolve(process.env.APHELION_TEST_HOME));
let window, runtime, offEvent, offDelta;
let sent = 0, received = 0;
const devURL = process.env.APHELION_DEV_URL === 'http://127.0.0.1:5173' ? process.env.APHELION_DEV_URL : null;
const indexURL = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
function validSender(event) {
  const url = event.senderFrame?.url?.split('#')[0];
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame || (devURL ? url !== devURL && url !== devURL + '/' : url !== indexURL)) throw new Error('This action did not come from the Aphelion command center.');
}
app.whenReady().then(async () => {
  const { createRuntime } = await import('./runtime.mjs');
  runtime = await createRuntime({ dataDirectory: app.getPath('userData'), desktop: true, openExternal: url => shell.openExternal(url), getNetwork: () => ({ online: true, clients: window && !window.isDestroyed() ? 1 : 0, sent, received }), selectFolder: async () => { const result = await dialog.showOpenDialog(window, { title: 'Choose project or Obsidian vault folder', properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; } });
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1660, height: 1050, minWidth: 1000, minHeight: 700, frame: false, backgroundColor: '#060f15', title: 'Aphelion OS', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== indexURL && url !== devURL && url !== devURL + '/') event.preventDefault(); });
  for (const name of Object.keys(runtime.methods)) ipcMain.handle('aphelion:' + name, async (event, ...args) => { validSender(event); received += Buffer.byteLength(JSON.stringify(args)); const result = await runtime.invoke(name, args); sent += Buffer.byteLength(JSON.stringify(result) || ''); return result; });
  ipcMain.handle('aphelion:windowAction', (event, action) => { validSender(event); if (action === 'minimize') window.minimize(); if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize(); if (action === 'close') window.close(); });
  function forward(channel, payload) { if (!window.webContents.isDestroyed()) { sent += Buffer.byteLength(JSON.stringify(payload)); window.webContents.send(channel, payload); } }
  offEvent = runtime.onEvent(event => forward('aphelion:runtimeEvent', event));
  offDelta = runtime.onDelta(event => forward('aphelion:delta', event));
  if (devURL) await window.loadURL(devURL); else await window.loadFile(path.join(__dirname, '../dist/index.html'));
}).catch(error => { dialog.showErrorBox('Aphelion could not start', error.message); app.quit(); });
app.on('window-all-closed', () => { offEvent?.(); offDelta?.(); runtime?.dispose(); app.quit(); });
