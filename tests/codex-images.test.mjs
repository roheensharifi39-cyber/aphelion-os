import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { createCodexImageService } from '../electron/codex-images.mjs';

const folders = [], services = [];
const subscription = { installed: true, signedIn: true, mode: 'subscription' };
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(kind, bytes) {
  const name = Buffer.from(kind), header = Buffer.alloc(4), crc = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([header, name, bytes, crc]);
}
function png() {
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.from([0, 245, 245, 245, 255]))), pngChunk('IEND', Buffer.alloc(0))]);
}
const PNG = png();

async function setup(options = {}) {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aphelion-codex-images-')); folders.push(dataDirectory);
  const clients = [];
  const spawnImpl = vi.fn((command, args, spawnOptions) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = vi.fn(() => true);
    const client = { child, command, args, options: spawnOptions, requests: [] }; clients.push(client);
    const send = value => child.stdout.write(`${JSON.stringify(value)}\n`);
    const notify = (method, params) => send({ method, params });
    child.stdin.on('data', chunk => {
      for (const raw of chunk.toString().split('\n').filter(Boolean)) {
        const request = JSON.parse(raw); client.requests.push(request);
        if (request.id === undefined) continue;
        if (options.intercept?.({ request, client, send, notify })) continue;
        if (request.method === 'initialize') send({ id: request.id, result: {} });
        else if (request.method === 'modelProvider/capabilities/read') send({ id: request.id, result: { imageGeneration: options.capable !== false, webSearch: true } });
        else if (request.method === 'config/read') send({ id: request.id, result: { config: { mcp_servers: { contacts: { command: 'private-client', env: { PRIVATE_KEY: 'do not expose' } } } } } });
        else if (request.method === 'thread/start') send({ id: request.id, result: { thread: { id: 'thread-one' } } });
        else if (request.method === 'turn/start') {
          send({ id: request.id, result: { turn: { id: 'turn-one' } } });
          if (options.pending) continue;
          setImmediate(async () => {
            try {
              const item = options.generate ? await options.generate(client) : { type: 'imageGeneration', id: 'image-one', status: 'completed', savedPath: join(spawnOptions.cwd, 'image.png') };
              if (!options.generate) await writeFile(item.savedPath, PNG);
              notify('item/started', { threadId: 'thread-one', turnId: 'turn-one', item: { type: 'imageGeneration', id: 'image-one', status: 'in_progress' } });
              if (item) notify('item/completed', { threadId: 'thread-one', turnId: 'turn-one', completedAtMs: Date.now(), item });
              notify('turn/completed', { threadId: 'thread-one', turn: { id: 'turn-one', status: options.turnStatus || 'completed', items: item ? [item] : [] } });
            } catch (error) { child.emit('error', error); }
          });
        }
      }
    });
    return child;
  });
  const getCliImpl = vi.fn(async () => options.missing ? null : { command: 'official-codex', args: ['--boundary'] });
  const inspectImpl = options.inspectImpl || vi.fn(async () => options.auth || subscription);
  const service = createCodexImageService({ dataDirectory, getCliImpl, spawnImpl, inspectImpl, timeoutMs: options.timeoutMs || 1000 }); services.push(service);
  return { service, dataDirectory, clients, spawnImpl, getCliImpl, inspectImpl };
}
async function waitUntil(predicate) {
  for (let attempts = 0; attempts < 100 && !predicate(); attempts++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(predicate()).toBe(true);
}
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  for (const directory of folders.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('Codex subscription image availability', () => {
  it.each([
    { missing: true, detail: /Install Codex CLI/ },
    { auth: { signedIn: false, mode: 'signed-out' }, detail: /Sign in.*ChatGPT subscription/ },
    { auth: { signedIn: false, mode: 'api-key' }, detail: /API authentication/ },
  ])('does not launch a generator for missing or non-subscription authentication', async options => {
    const { service, spawnImpl } = await setup(options);
    expect(await service.status()).toEqual({ connected: false, available: false, detail: expect.stringMatching(options.detail) });
    await expect(service.image('A moon')).rejects.toThrow(options.detail);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
  it('probes the native capability once for concurrent checks and caches it', async () => {
    const { service, clients, spawnImpl } = await setup();
    const values = await Promise.all([service.status(), service.status()]);
    expect(values[0]).toEqual({ connected: true, available: true, detail: expect.stringMatching(/ChatGPT subscription/) });
    expect(values[1]).toEqual(values[0]);
    expect(await service.status()).toEqual(values[0]);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(clients[0].requests.map(request => request.method)).toEqual(['initialize', 'initialized', 'modelProvider/capabilities/read']);
    expect(clients[0].child.kill).toHaveBeenCalledOnce();
  });
  it('reports unsupported clients accurately without guessing account availability', async () => {
    const { service } = await setup({ capable: false });
    expect(await service.status()).toEqual({ connected: true, available: false, detail: expect.stringMatching(/unavailable.*Update Codex/) });
    await expect(service.image('A moon')).rejects.toThrow(/unavailable/);
  });
  it('returns a sanitized update instruction when the capability method is missing', async () => {
    const { service } = await setup({ intercept: ({ request, send }) => {
      if (request.method !== 'modelProvider/capabilities/read') return false;
      send({ id: request.id, error: { message: 'Method not found: internal secret endpoint' } }); return true;
    } });
    const status = await service.status();
    expect(status).toMatchObject({ connected: true, available: false });
    expect(status.detail).toMatch(/Update Codex/); expect(status.detail).not.toContain('secret');
  });
});

describe('native Codex image jobs', () => {
  it('returns a real PNG, confines the session, strips API billing credentials, and cleans the job', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'never send this key'); vi.stubEnv('CODEX_API_KEY', 'another key'); vi.stubEnv('OPENAI_BASE_URL', 'https://private.invalid'); vi.stubEnv('CODEX_APP_TOOLS_PIPE_PATH', 'host-tool-pipe');
    const { service, clients, dataDirectory, inspectImpl } = await setup();
    const progress = [], prompt = '  A moon with the words `hello`; $secret  ';
    const result = await service.image(prompt, { onDelta: text => progress.push(text) });
    expect(result).toEqual({ id: expect.any(String), src: `data:image/png;base64,${PNG.toString('base64')}`, prompt: prompt.trim(), created: expect.any(String) });
    expect(Date.parse(result.created)).not.toBeNaN(); expect(progress.join('')).toMatch(/Codex subscription/);
    const client = clients[0];
    expect(client.command).toBe('official-codex'); expect(client.args[0]).toBe('--boundary'); expect(client.args).toContain('forced_login_method="chatgpt"');
    for (const feature of ['shell_tool', 'apps', 'plugins', 'multi_agent', 'view_image', 'browser_use', 'computer_use']) expect(client.args).toContain(feature);
    expect(client.options).toMatchObject({ shell: false, windowsHide: true });
    expect(client.options.cwd.startsWith(join(dataDirectory, 'codex-image-jobs'))).toBe(true);
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'CODEX_APP_TOOLS_PIPE_PATH']) expect(client.options.env[key]).toBeUndefined();
    expect(client.args.join(' ')).not.toContain(prompt.trim());
    const start = client.requests.find(request => request.method === 'thread/start').params;
    expect(start).toMatchObject({ ephemeral: true, approvalPolicy: 'never', sandbox: 'workspace-write', modelProvider: 'openai', config: { mcp_servers: { contacts: { enabled: false } }, web_search: 'disabled' } });
    expect(JSON.stringify(start)).not.toContain('do not expose');
    const turn = client.requests.find(request => request.method === 'turn/start').params;
    expect(turn.input[0].text).toContain(prompt.trim());
    expect(turn.sandboxPolicy).toEqual({ type: 'workspaceWrite', writableRoots: [client.options.cwd], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true });
    expect(inspectImpl).toHaveBeenCalledWith('codex', { getCliImpl: expect.any(Function) });
    expect(await readdir(join(dataDirectory, 'codex-image-jobs'))).toEqual([]);
    expect(client.child.kill).toHaveBeenCalledOnce();
  });
  it('accepts validated native inline output without reading an external saved path', async () => {
    const { service } = await setup({ generate: async () => ({ id: 'native-inline', type: 'imageGeneration', status: 'completed', result: PNG.toString('base64'), savedPath: join(tmpdir(), 'never-read-this-file.png') }) });
    expect((await service.image('A moon')).src).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });
  it('checks the current sign-in again for every generation', async () => {
    const inspectImpl = vi.fn().mockResolvedValueOnce(subscription).mockResolvedValue({ signedIn: true, mode: 'api-key' });
    const { service, spawnImpl } = await setup({ inspectImpl });
    expect((await service.status()).available).toBe(true);
    await expect(service.image('A moon')).rejects.toThrow(/API authentication/);
    expect(spawnImpl).toHaveBeenCalledOnce();
  });
  it.each(['', ' '.repeat(10), 'x'.repeat(32001), null])('rejects invalid prompts before starting the client', async prompt => {
    const { service, spawnImpl } = await setup();
    await expect(service.image(prompt)).rejects.toThrow(/32,000/); expect(spawnImpl).not.toHaveBeenCalled();
  });
  it.each(['bad-crc', 'truncated', 'oversized', 'not-completed', 'no-image', 'bad-base64'])('rejects invalid native outcomes: %s', async kind => {
    const { service, dataDirectory } = await setup({ generate: async client => {
      if (kind === 'no-image') return null;
      const item = { type: 'imageGeneration', id: 'invalid', status: kind === 'not-completed' ? 'failed' : 'completed', savedPath: join(client.options.cwd, 'image.png') };
      if (kind === 'bad-base64') return { ...item, result: 'not an image!' };
      const bytes = kind === 'oversized' ? Buffer.alloc(24 * 1024 * 1024 + 1) : Buffer.from(PNG);
      if (kind === 'bad-crc') bytes[bytes.length - 1] ^= 1;
      await writeFile(item.savedPath, kind === 'truncated' ? bytes.subarray(0, 24) : bytes); return item;
    } });
    await expect(service.image('A moon')).rejects.toThrow(/valid PNG|completed native image/);
    expect(await readdir(join(dataDirectory, 'codex-image-jobs'))).toEqual([]);
  });
  it('rejects external file paths and leaves those files untouched', async () => {
    const { service, dataDirectory } = await setup({ generate: async () => ({ type: 'imageGeneration', id: 'outside', status: 'completed', savedPath: join(dataDirectory, 'outside.png') }) });
    await writeFile(join(dataDirectory, 'outside.png'), PNG);
    await expect(service.image('A moon')).rejects.toThrow(/outside this generation job/);
    expect(await readFile(join(dataDirectory, 'outside.png'))).toEqual(PNG);
  });
  it('rejects a junction that points from the job folder to an external image', async () => {
    const { service, dataDirectory } = await setup({ generate: async client => {
      await symlink(dataDirectory, join(client.options.cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      return { type: 'imageGeneration', id: 'linked', status: 'completed', savedPath: join(client.options.cwd, 'linked', 'outside.png') };
    } });
    await writeFile(join(dataDirectory, 'outside.png'), PNG);
    await expect(service.image('A moon')).rejects.toThrow(/unsafe image path/);
    expect(await readFile(join(dataDirectory, 'outside.png'))).toEqual(PNG);
  });
  it('reports subscription usage failures without exposing native error text', async () => {
    const { service } = await setup({ generate: async () => ({ type: 'imageGeneration', id: 'limited', status: 'failed', failure: { type: 'usageLimitExceeded', limitId: 'private-internal-id', resetsAt: null } }) });
    await expect(service.image('A moon')).rejects.toThrow(/usage limit was reached/);
  });
  it.each(['abort', 'dispose', 'timeout'])('terminates and cleans an unfinished native generation on %s', async reason => {
    const { service, clients, dataDirectory } = await setup({ pending: true, timeoutMs: reason === 'timeout' ? 40 : 1000 });
    const controller = new AbortController();
    const pending = service.image('A moon', { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow(reason === 'timeout' ? /timed out/ : /Stopped/);
    await waitUntil(() => clients[0]?.requests.some(request => request.method === 'turn/start'));
    if (reason === 'abort') controller.abort();
    if (reason === 'dispose') service.dispose();
    await rejected;
    expect(clients[0].child.kill).toHaveBeenCalledOnce();
    expect(await readdir(join(dataDirectory, 'codex-image-jobs'))).toEqual([]);
  });
  it('refuses server-requested extra tools and does not include sensitive details in the error', async () => {
    const { service, clients } = await setup({ pending: true });
    const pending = service.image('A moon'); const rejected = expect(pending).rejects.toThrow(/only use native image generation/);
    await waitUntil(() => clients[0]?.requests.some(request => request.method === 'turn/start'));
    clients[0].child.stdout.write(`${JSON.stringify({ id: 999, method: 'item/tool/call', params: { name: 'sensitive-contact-tool' } })}\n`);
    await rejected;
    expect(clients[0].requests.at(-1)).toMatchObject({ id: 999, error: { code: -32601 } });
  });
  it('stops an unexpected external tool event before accepting an image result', async () => {
    const { service, clients } = await setup({ pending: true });
    const pending = service.image('A moon'); const rejected = expect(pending).rejects.toThrow(/only use native image generation/);
    await waitUntil(() => clients[0]?.requests.some(request => request.method === 'turn/start'));
    clients[0].child.stdout.write(`${JSON.stringify({ method: 'item/started', params: { threadId: 'thread-one', turnId: 'turn-one', item: { type: 'mcpToolCall' } } })}\n`);
    await rejected; expect(clients[0].child.kill).toHaveBeenCalledOnce();
  });
});
