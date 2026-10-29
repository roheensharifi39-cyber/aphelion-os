const { appendFile } = require('node:fs');
const { join } = require('node:path');

// electron-updater owns checksum validation and installation. Never restart work.
function startUpdates({ app, updater, notify = () => {}, platform = process.platform, env = process.env, intervalMs = 15 * 60 * 1000 }) {
  if (!app.isPackaged || platform !== 'win32' || env.APHELION_TEST_HOME || env.PORTABLE_EXECUTABLE_DIR) return () => {};
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.autoRunAppAfterInstall = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  let disposed = false, pending = false, ready = false;
  function record(state, detail = '') {
    appendFile(join(app.getPath('userData'), 'updates.log'), JSON.stringify({ time: new Date().toISOString(), version: app.getVersion(), state, detail }) + '\n', () => {});
  }
  const listeners = {
    'error': error => record('error', error.message),
    'update-available': info => record('available', info.version),
    'update-not-available': info => record('current', info.version),
    'update-downloaded': info => {
      ready = true;
      record('downloaded', info.version);
      if (!disposed) {
        try { notify('Aphelion update ready', 'The latest version will install when you close Aphelion.'); }
        catch { /* Disabled Windows notifications must not affect updating. */ }
      }
    },
  };
  for (const [event, listener] of Object.entries(listeners)) updater.on(event, listener);
  async function check() {
    if (disposed || pending || ready) return;
    pending = true;
    record('checking');
    try {
      const result = await updater.checkForUpdates();
      await result?.downloadPromise;
    } catch (error) { record('error', error.message); }
    finally { pending = false; }
  }
  const timer = setInterval(() => { void check(); }, intervalMs);
  timer.unref?.();
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    for (const [event, listener] of Object.entries(listeners)) updater.removeListener(event, listener);
    app.removeListener('before-quit', dispose);
    // A download may finish during shutdown; keep EventEmitter errors handled.
    updater.on('error', () => {});
  }
  app.once('before-quit', dispose);
  void check();
  return dispose;
}

module.exports = { startUpdates };
