import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let obsidian;
try { obsidian = await import('../electron/obsidian.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' && !/cannot find|failed to load/i.test(error.message)) throw error; obsidian = {}; }

let root, vault, env;
const adapters = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aphelion-obsidian-'));
  vault = join(root, 'My vault');
  await mkdir(vault);
  env = { APPDATA: join(root, 'Roaming'), LOCALAPPDATA: join(root, 'Local'), ProgramFiles: join(root, 'Programs'), PATH: '' };
});
afterEach(async () => {
  for (const adapter of adapters.splice(0)) adapter.dispose();
  await rm(root, { recursive: true, force: true });
});
function adapter(options = {}) {
  expect(obsidian.createObsidianAdapter).toBeTypeOf('function');
  const result = obsidian.createObsidianAdapter({
    getVaultPath: () => vault,
    onEvent: () => {},
    env,
    platform: 'win32',
    execFileImpl: async () => ({ stdout: '', stderr: '' }),
    ...options,
  });
  adapters.push(result);
  return result;
}
async function installed(options = {}) {
  const executable = join(env.LOCALAPPDATA, 'Programs', 'Obsidian', 'Obsidian.exe');
  await mkdir(join(env.LOCALAPPDATA, 'Programs', 'Obsidian'), { recursive: true });
  await writeFile(executable, 'native app fixture');
  const launches = [], browser = [];
  const integration = adapter({
    execFileImpl: async command => ({ stdout: command === 'tasklist.exe' ? '"Obsidian.exe","404","Console","1","99,000 K"\r\n' : '', stderr: '' }),
    launchImpl: async (command, uri) => { launches.push({ command, uri }); },
    openExternalImpl: async url => { browser.push(url); },
    ...options,
  });
  return { integration, executable, launches, browser };
}
async function registerVault(extra = {}) {
  await mkdir(join(env.APPDATA, 'obsidian'), { recursive: true });
  await writeFile(join(env.APPDATA, 'obsidian', 'obsidian.json'), JSON.stringify({ vaults: { aabbccddeeff0011: { path: vault, open: true }, ...extra } }));
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const limit = Date.now() + 3500;
  while (!predicate()) { if (Date.now() > limit) throw new Error('Expected real vault event was not delivered.'); await delay(20); }
}

describe('real Obsidian filesystem integration', () => {
  it('indexes and watches actual Markdown even when the native app is missing', async () => {
    await writeFile(join(vault, 'First.md'), '# A real note');
    const integration = adapter();
    await integration.watch();
    const status = await integration.status();
    expect(status).toMatchObject({ installed: false, running: false, vaultPath: vault, watching: true, noteCount: 1 });
    expect(status.indexedAt).toBeGreaterThan(0);
    expect(status.detail).toMatch(/not installed|install Obsidian/i);
  });

  it('discovers the installed native app and measures its current process state', async () => {
    const { integration } = await installed();
    expect(await integration.status()).toMatchObject({ installed: true, running: true });
  });

  it('finds a registered official executable outside the default install folders', async () => {
    const executable = join(root, 'Portable Obsidian', 'Obsidian.exe');
    await mkdir(join(root, 'Portable Obsidian'));
    await writeFile(executable, 'native app fixture');
    const integration = adapter({ execFileImpl: async command => ({ stdout: command === 'reg.exe' ? `    (Default)    REG_SZ    "${executable}" "%1"\r\n` : '', stderr: '' }) });
    expect(await integration.status()).toMatchObject({ installed: true, running: false });
  });

  it('discovers actual vault folders from normal metadata and ignores stale registrations', async () => {
    await registerVault({ stale: { path: join(root, 'missing') }, relative: { path: '../outside' }, malformed: null });
    const integration = adapter();
    expect(await integration.discoverVaults()).toEqual([{ path: vault, name: 'My vault', open: true }]);
  });

  it('opens a registered vault by ID and an existing confined note by official URI', async () => {
    await registerVault();
    await mkdir(join(vault, 'Ideas'));
    await writeFile(join(vault, 'Ideas', 'Moon & stars.md'), '# Moon');
    const { integration, launches, executable } = await installed();
    await integration.open();
    await integration.open('Ideas/Moon & stars.md');
    expect(launches[0]).toEqual({ command: executable, uri: 'obsidian://open?vault=aabbccddeeff0011' });
    expect(launches[1].command).toBe(executable);
    expect(new URL(launches[1].uri).searchParams.get('path')).toBe(join(vault, 'Ideas', 'Moon & stars.md'));
    expect(launches[1].uri).toContain('Moon%20%26%20stars.md');
  });

  it('opens the official vault manager for an unregistered folder without fabricating registration', async () => {
    const { integration, launches } = await installed();
    const status = await integration.open();
    expect(launches[0].uri).toBe('obsidian://choose-vault');
    expect(status.detail).toMatch(/Open folder as vault/);
    expect(status.detail).toContain(vault);
    expect(await integration.discoverVaults()).toEqual([]);
  });

  it('refuses nonexistent or escaping note paths before launching another app', async () => {
    await registerVault();
    const { integration, launches } = await installed();
    for (const path of ['../outside.md', 'missing.md', '/outside.md', '..\\outside.md']) await expect(integration.open(path)).rejects.toThrow();
    expect(launches).toEqual([]);
  });

  it('opens only the HTTPS download page when the native app is missing', async () => {
    const browser = [];
    const integration = adapter({ openExternalImpl: async url => { browser.push(url); } });
    await expect(integration.open()).rejects.toThrow(/install|download/i);
    expect(browser).toEqual(['https://obsidian.md/download']);
  });

  it('ignores hidden, dependency and temporary files both when indexing and watching', async () => {
    await writeFile(join(vault, 'First.md'), 'A');
    for (const folder of ['.obsidian', 'NODE_MODULES']) { await mkdir(join(vault, folder)); await writeFile(join(vault, folder, 'Ignored.md'), 'ignored'); }
    await writeFile(join(vault, '.hidden.md'), 'ignored');
    await writeFile(join(vault, 'First.md.tmp'), 'ignored');
    const events = [], integration = adapter({ onEvent: event => events.push(event) });
    await integration.watch();
    expect((await integration.status()).noteCount).toBe(1);
    events.length = 0;
    await writeFile(join(vault, '.obsidian', 'Ignored.md'), 'changed');
    await writeFile(join(vault, 'NODE_MODULES', 'Ignored.md'), 'changed');
    await writeFile(join(vault, 'First.md.tmp'), 'changed');
    await delay(350);
    expect(events.filter(event => event.type === 'vault')).toEqual([]);
  });

  it('debounces real note edits into one event with a fresh timestamp and actual count', async () => {
    await writeFile(join(vault, 'A.md'), 'Before');
    const events = [], integration = adapter({ onEvent: event => events.push(event) });
    await integration.watch();
    const original = await integration.status(); events.length = 0;
    await writeFile(join(vault, 'A.md'), 'After');
    await writeFile(join(vault, 'B.md'), 'New note');
    await until(() => events.some(event => event.type === 'vault' && event.data.noteCount === 2));
    await delay(250);
    const changes = events.filter(event => event.type === 'vault');
    expect(changes).toHaveLength(1);
    expect(new Set(changes[0].data.paths)).toEqual(new Set(['A.md', 'B.md']));
    expect(changes[0].data.indexedAt).toBeGreaterThan(original.indexedAt);
    expect((await integration.status()).noteCount).toBe(2);
    expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('After');
  });

  it('restarts observation automatically when the selected vault changes', async () => {
    const other = join(root, 'Other vault'); await mkdir(other);
    await writeFile(join(vault, 'A.md'), 'A'); await writeFile(join(other, 'B.md'), 'B');
    let current = vault;
    const events = [], integration = adapter({ getVaultPath: () => current, onEvent: event => events.push(event) });
    await integration.watch();
    current = other;
    await until(() => events.some(event => event.type === 'vault' && event.data.vaultPath === other));
    events.length = 0;
    await writeFile(join(vault, 'A.md'), 'Old vault must not be observed');
    await delay(250);
    expect(events.filter(event => event.type === 'vault')).toEqual([]);
    await writeFile(join(other, 'C.md'), 'C');
    await until(() => events.some(event => event.type === 'vault' && event.data.vaultPath === other && event.data.noteCount === 2));
  });

  it('never opens or indexes a symlink that escapes the selected vault', async () => {
    const outside = join(root, 'Outside'); await mkdir(outside); await writeFile(join(outside, 'Secret.md'), 'Private outside content');
    await symlink(outside, join(vault, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const { integration, launches } = await installed();
    await integration.watch();
    expect((await integration.status()).noteCount).toBe(0);
    await expect(integration.open('linked/Secret.md')).rejects.toThrow(/outside|symbolic|link/i);
    expect(launches).toEqual([]);
  });

  it('closes the observer and prevents late file events after disposal', async () => {
    const events = [], integration = adapter({ onEvent: event => events.push(event) });
    await integration.watch(); events.length = 0;
    integration.dispose();
    await writeFile(join(vault, 'After.md'), 'After close'); await delay(250);
    expect(events).toEqual([]);
    expect((await integration.status()).watching).toBe(false);
    await expect(integration.watch()).rejects.toThrow(/closed/);
  });

  it('shares a measured process snapshot across concurrent status and telemetry requests', async () => {
    let processQueries = 0;
    const { integration } = await installed({ execFileImpl: async command => { if (command === 'tasklist.exe') { processQueries++; await delay(10); return { stdout: '"Obsidian.exe","404","Console","1","99,000 K"\r\n', stderr: '' }; } return { stdout: '', stderr: '' }; } });
    const [status, records] = await Promise.all([integration.status(), integration.processes()]);
    expect(status.running).toBe(true);
    expect(records).toEqual([{ pid: 404, name: 'Obsidian', role: 'obsidian' }]);
    records[0].pid = -1;
    expect(await integration.processes()).toEqual([{ pid: 404, name: 'Obsidian', role: 'obsidian' }]);
    expect(processQueries).toBe(1);
  });
});
