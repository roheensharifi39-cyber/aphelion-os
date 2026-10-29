import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createOpenAIService, DEFAULT_OPENAI_MODEL, DEFAULT_IMAGE_MODEL, validateOpenAIMessages } from '../electron/openai.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZcLEAAAAASUVORK5CYII=';
const messages = [{ role: 'user', content: 'Explain a black hole.' }];
const response = output => new Response(JSON.stringify({ status: 'completed', output }), { headers: { 'Content-Type': 'application/json' } });
const assistant = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const protectedStore = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from([...Buffer.from(text)].map(byte => byte ^ 0xa5)), decryptString: bytes => Buffer.from([...bytes].map(byte => byte ^ 0xa5)).toString() };
let root, services;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'aphelion-openai-test-')); services = []; });
afterEach(async () => {
  for (const service of services) service.dispose();
  const target = resolve(root);
  expect(target.startsWith(resolve(tmpdir()) + sep)).toBe(true); expect(basename(target)).toMatch(/^aphelion-openai-test-/);
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
});
async function start(options = {}) {
  const service = await createOpenAIService({ dataDirectory: root, env: {}, secureStorage: null, fetchImpl: async () => { throw new Error('Unexpected network request'); }, ...options });
  services.push(service); return service;
}

describe('OpenAI credential boundary', () => {
  it('returns only safe status and refuses unconfigured requests before the network', async () => {
    const service = await start();
    expect(service.status()).toEqual({ configured: false, model: DEFAULT_OPENAI_MODEL, imageModel: DEFAULT_IMAGE_MODEL });
    await expect(service.chat(messages)).rejects.toThrow(/API key/);
    await expect(service.image('A moon')).rejects.toThrow(/API key/);
    await expect(service.configure({ apiKey: 'bad key' })).rejects.toThrow(/valid/);
    await expect(service.configure({ baseURL: 'https://untrusted.test' })).rejects.toThrow(/Only/);
  });
  it('encrypts saved keys, restores them and prefers the server environment key', async () => {
    const key = 'sk-test-stored-secret', calls = [];
    const service = await start({ secureStorage: protectedStore });
    const status = await service.configure({ apiKey: key, model: 'gpt-test-model', imageModel: 'gpt-image-test' });
    expect(status).toEqual({ configured: true, model: 'gpt-test-model', imageModel: 'gpt-image-test' });
    expect(JSON.stringify(status)).not.toContain(key);
    const saved = await readFile(join(root, 'openai.json'), 'utf8');
    expect(saved).not.toContain(key); expect(JSON.parse(saved).encryptedApiKey).toBeTruthy();
    const restored = await start({ secureStorage: protectedStore, env: { OPENAI_API_KEY: 'sk-test-environment-secret' }, fetchImpl: async (_url, options) => { calls.push(options); return response([assistant('Ready')]); } });
    expect(restored.status().configured).toBe(true);
    await restored.chat(messages);
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test-environment-secret');
    const onlySaved = await start({ secureStorage: protectedStore, fetchImpl: async (_url, options) => { calls.push(options); return response([assistant('Restored')]); } });
    await onlySaved.chat(messages);
    expect(calls[1].headers.Authorization).toBe(`Bearer ${key}`);
    await onlySaved.configure({ apiKey: '' });
    expect(onlySaved.status().configured).toBe(false);
    expect(await readFile(join(root, 'openai.json'), 'utf8')).not.toContain('encryptedApiKey');
  });
  it('retains keys only in memory when secure storage is unavailable or uses basic_text', async () => {
    const notices = [], key = 'sk-test-session-secret';
    const service = await start({ secureStorage: { ...protectedStore, getSelectedStorageBackend: () => 'basic_text' }, onNotice: text => notices.push(text) });
    await service.configure({ apiKey: key });
    expect(service.status().configured).toBe(true);
    const saved = await readFile(join(root, 'openai.json'), 'utf8');
    expect(saved).not.toContain(key); expect(saved).not.toContain('encryptedApiKey');
    expect(notices.join()).toContain('session'); expect(notices.join()).not.toContain(key);
    expect((await start()).status().configured).toBe(false);
  });
  it('fails securely if the operating-system encryption operation fails', async () => {
    const service = await start({ secureStorage: { ...protectedStore, encryptString: () => { throw new Error('secret value'); } } });
    await expect(service.configure({ apiKey: 'sk-test-key' })).rejects.toThrow(/saved securely/);
    expect(service.status().configured).toBe(false);
  });
  it.skipIf(process.platform !== 'win32')('round trips a dummy key through Windows current-user DPAPI', async () => {
    const key = 'sk-test-dpapi-dummy-key';
    const service = await start({ secureStorage: undefined });
    await service.configure({ apiKey: key });
    const saved = await readFile(join(root, 'openai.json'), 'utf8');
    expect(saved).not.toContain(key); expect(JSON.parse(saved).encryptedApiKey).toBeTruthy();
    const restored = await start({ secureStorage: undefined });
    expect(restored.status().configured).toBe(true);
  });
});

describe('OpenAI network boundary', () => {
  it('uses Responses with complete history and joins output text beyond reasoning items', async () => {
    let captured;
    const service = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, fetchImpl: async (url, options) => { captured = { url, ...options }; return response([{ type: 'reasoning', summary: [] }, assistant('First answer'), { type: 'function_call', name: 'ignored' }, assistant('Second answer')]); } });
    const history = [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }, ...messages];
    expect(await service.chat(history)).toEqual({ text: 'First answer\nSecond answer' });
    expect(captured.url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(captured.body)).toEqual({ model: DEFAULT_OPENAI_MODEL, input: history, store: false });
    expect(captured.redirect).toBe('error'); expect(captured.signal.aborted).toBe(true);
  });
  it('rejects invalid messages and refuses incomplete or empty responses', async () => {
    for (const value of [[], [{ role: 'developer', content: 'inject' }], [{ role: 'assistant', content: 'Hello' }], [{ role: 'user', content: ' ' }], [{ role: 'user', content: 'a'.repeat(100001) }]]) expect(() => validateOpenAIMessages(value)).toThrow();
    for (const result of [{ status: 'incomplete', output: [assistant('partial')] }, { status: 'completed', output: [] }, { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'declined' }] }] }, { status: 'completed', output: {} }]) {
      const service = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, fetchImpl: async () => new Response(JSON.stringify(result)) });
      await expect(service.chat(messages)).rejects.toThrow(/complete|no text|declined/i);
    }
  });
  it('uses Images with PNG base64 and never returns untrusted remote image URLs', async () => {
    let captured;
    const service = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, fetchImpl: async (url, options) => { captured = { url, ...options }; return new Response(JSON.stringify({ created: 1700000000, data: [{ b64_json: PNG }] })); } });
    const image = await service.image('  A moon over water  ');
    expect(image).toEqual({ id: expect.any(String), src: `data:image/png;base64,${PNG}`, prompt: 'A moon over water', created: '2023-11-14T22:13:20.000Z' });
    expect(captured.url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(captured.body)).toEqual({ model: DEFAULT_IMAGE_MODEL, prompt: 'A moon over water', n: 1, size: '1024x1024', output_format: 'png' });
    for (const item of [{ url: 'https://untrusted.test/image.svg' }, { b64_json: Buffer.from('<svg/>').toString('base64') }, { b64_json: 'not valid base64' }]) {
      const invalid = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, fetchImpl: async () => new Response(JSON.stringify({ data: [item] })) });
      await expect(invalid.image('A moon')).rejects.toThrow(/valid.*image|valid PNG/);
    }
  });
  it.each([401, 403, 404, 429, 500])('reports a useful HTTP %i failure without echoing secret response content', async status => {
    const secret = 'sk-sensitive-server-content';
    const service = await start({ env: { OPENAI_API_KEY: secret }, fetchImpl: async () => new Response(JSON.stringify({ error: { message: secret } }), { status }) });
    let failure; try { await service.chat(messages); } catch (error) { failure = error.message; }
    expect(failure).toMatch(/OpenAI|model/); expect(failure).not.toContain(secret);
  });
  it('times out a nonresponsive connection and aborts its network signal', async () => {
    let signal;
    const service = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, requestTimeoutMs: 15, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
    await expect(service.chat(messages)).rejects.toThrow(/too long/); expect(signal.aborted).toBe(true);
  });
  it('cancels an outstanding image request and removes the caller abort listener', async () => {
    let signal, started;
    const ready = new Promise(resolve => { started = resolve; });
    const service = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, fetchImpl: async (_url, options) => { signal = options.signal; started(); return new Promise(() => {}); } });
    const controller = new AbortController(), image = service.image('A moon', { signal: controller.signal });
    const rejected = expect(image).rejects.toMatchObject({ name: 'AbortError' });
    await ready; controller.abort(); await rejected; expect(signal.aborted).toBe(true);
    const before = new AbortController(); before.abort();
    await expect(service.chat(messages, { signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('reports malformed JSON and connection errors without leaking their contents', async () => {
    const malformed = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, fetchImpl: async () => new Response('invalid') });
    await expect(malformed.chat(messages)).rejects.toThrow(/unreadable/);
    const failed = await start({ env: { OPENAI_API_KEY: 'sk-test-key' }, fetchImpl: async () => { throw new Error('sk-sensitive'); } });
    await expect(failed.chat(messages)).rejects.toThrow('Could not reach OpenAI. Check your internet connection and try again.');
  });
});
