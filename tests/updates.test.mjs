import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { startUpdates } from '../electron/updates.cjs';

const disposers = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.useRealTimers(); });
function fixture(options = {}) {
  const app = Object.assign(new EventEmitter(), { isPackaged: true, getPath: () => tmpdir(), getVersion: () => '0.3.0' });
  const updater = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn().mockResolvedValue(null) });
  const notify = vi.fn();
  const dispose = startUpdates({ app, updater, notify, platform: 'win32', env: {}, intervalMs: 1000, ...options });
  disposers.push(dispose);
  return { app, updater, notify, dispose };
}
describe('desktop update lifecycle', () => {
  it('downloads stable upgrades at startup and on a timer, installing only on normal quit', async () => {
    vi.useFakeTimers();
    const { updater } = fixture();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true, autoRunAppAfterInstall: false, allowDowngrade: false, allowPrerelease: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it('waits for an in-flight download and stops checking after it is ready', async () => {
    vi.useFakeTimers();
    let finish;
    const updater = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn().mockResolvedValue({ downloadPromise: new Promise(resolve => { finish = resolve; }) }) });
    const { notify } = fixture({ updater });
    await vi.advanceTimersByTimeAsync(4000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.emit('update-downloaded', { version: '0.3.1' }); finish();
    await vi.advanceTimersByTimeAsync(2000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Aphelion update ready', expect.stringContaining('close Aphelion'));
  });
  it('recovers from offline checks and cleans up its timer and listeners', async () => {
    vi.useFakeTimers();
    const updater = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(null) });
    const { app, dispose } = fixture({ updater });
    updater.emit('error', new Error('offline'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    app.emit('before-quit'); dispose();
    await vi.advanceTimersByTimeAsync(4000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(updater.listenerCount('update-downloaded')).toBe(0);
    expect(app.listenerCount('before-quit')).toBe(0);
    expect(() => updater.emit('error', new Error('shutdown'))).not.toThrow();
  });
  it.each([{ isPackaged: false }, { platform: 'linux' }, { env: { APHELION_TEST_HOME: 'test' } }, { env: { PORTABLE_EXECUTABLE_DIR: 'portable' } }])('does not update development, test or portable copies: %j', options => {
    const app = Object.assign(new EventEmitter(), { isPackaged: options.isPackaged ?? true });
    const { updater } = fixture({ ...options, app });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(app.listenerCount('before-quit')).toBe(0);
  });
});
