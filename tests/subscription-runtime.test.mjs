import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntime } from '../electron/runtime.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZcLEAAAAASUVORK5CYII=';
const originalMessages = [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }, { role: 'user', content: 'What is a black hole?' }];
const officialURL = 'https://auth.openai.com/api/accounts/authorize?client_id=oaiapp_test&state=test-state&id_token_hint=private-id-token';
const textResponse = () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Explicit API answer.' }] }] }));
const image = () => ({ id: 'test-codex-image', src: `data:image/png;base64,${PNG}`, prompt: 'A moon over water', created: '2026-10-28T12:00:00.000Z' });
let root, engine, events, deltas;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'aphelion-subscription-runtime-')); events = []; deltas = []; });
afterEach(async () => {
  engine?.dispose(); engine = null;
  const target = resolve(root);
  expect(target.startsWith(resolve(tmpdir()) + sep)).toBe(true); expect(basename(target)).toMatch(/^aphelion-subscription-runtime-/);
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
});

async function start(options = {}) {
  const calls = { api: [], chat: [], image: [], opened: [], login: 0, cancelLogin: 0, disconnect: 0, models: 0, chatDisposed: 0, imageDisposed: 0 };
  let chatState = { connected: true, connecting: false, account: 'alex@example.com', detail: 'Connected with your ChatGPT subscription.', model: 'account-model' };
  const subscription = {
    status: () => ({ ...chatState }),
    startLogin: async () => { calls.login += 1; chatState = { ...chatState, connecting: true }; return { authorizationUrl: officialURL, expiresAt: 1800000000000 }; },
    cancelLogin: () => { calls.cancelLogin += 1; chatState = { ...chatState, connecting: false }; return { ...chatState }; },
    disconnect: async () => { calls.disconnect += 1; chatState = { ...chatState, connected: false, connecting: false, detail: 'Disconnected from ChatGPT.' }; return { ...chatState }; },
    models: async () => { calls.models += 1; return [{ slug: 'account-model', display_name: 'Account model', visibility: 'list' }]; },
    chat: async (messages, settings) => { calls.chat.push({ messages, ...settings }); settings.onDelta('Subscription '); settings.onDelta('answer.'); return { text: 'Subscription answer.', model: 'account-model' }; },
    dispose: () => { calls.chatDisposed += 1; },
  };
  const codex = {
    status: async () => ({ connected: true, available: true, detail: 'Codex subscription ready.' }),
    image: async (prompt, settings) => { calls.image.push({ prompt, ...settings }); settings.onProcess(12345); return { ...image(), prompt }; },
    dispose: () => { calls.imageDisposed += 1; },
  };
  const { subscription: subscriptionOverrides, codex: codexOverrides, ...runtimeOptions } = options;
  Object.assign(subscription, subscriptionOverrides); Object.assign(codex, codexOverrides);
  engine = await createRuntime({
    dataDirectory: root, desktop: false,
    openaiEnvironment: { OPENAI_API_KEY: 'sk-test-available-but-optional' }, openaiSecureStorage: null,
    openaiFetch: async (url, settings) => { calls.api.push({ url, ...settings }); return url.endsWith('responses') ? textResponse() : new Response(JSON.stringify({ data: [{ b64_json: PNG }] })); },
    chatGPTFactory: async settings => { calls.chatFactory = settings; return subscription; },
    codexImageFactory: async settings => { calls.imageFactory = settings; return codex; },
    openExternal: async url => { calls.opened.push(url); },
    authProvider: async () => ({}),
    obsidianFactory: () => ({ watch: async () => {}, status: async () => ({ installed: false }), processes: async () => [], dispose: () => {} }),
    ...runtimeOptions,
  });
  engine.onEvent(event => events.push(event)); engine.onDelta(event => deltas.push(event));
  return { calls, subscription, codex };
}

describe('subscription defaults and optional API opt-in', () => {
  it('sends selected-vault identity to ChatGPT without manual attachments', async () => {
    const { calls } = await start();
    await engine.invoke('saveNote', [{ path: 'Home.md', create: true, content: 'The user is Alex, a Example University engineering student.' }]);
    const messages = [{ role: 'user', content: 'Who am I?' }];
    await engine.invoke('openaiChat', [{ requestId: 'automatic-chatgpt-memory', messages }]);
    expect(calls.chat[0].messages[0].content).toContain('Alex');
    expect(calls.chat[0].messages[0].content).toContain('Active vault memory');
    expect(messages[0].content).toBe('Who am I?');
    expect(events.find(event => event.data?.automaticPaths?.includes('Home.md'))).toBeTruthy();
  });
  it('uses the ChatGPT subscription by default despite an available API key, forwards deltas, and archives full history plus vault links', async () => {
    const { calls } = await start();
    const memory = await engine.invoke('readNote', ['Project Memory.md']);
    await engine.invoke('saveNote', [{ path: 'Project Memory.md', revision: memory.revision, content: '# Project Memory\n\nOur telescope is named Meridian.' }]);
    const messages = structuredClone(originalMessages);
    const first = await engine.invoke('openaiChat', [{ requestId: 'subscription-chat', messages, contextPaths: ['Project Memory.md'], model: 'account-model' }]);
    expect(calls.api).toEqual([]); expect(calls.chat).toHaveLength(1); expect(calls.image).toEqual([]);
    expect(calls.chat[0].messages.slice(0, 2)).toEqual(originalMessages.slice(0, 2));
    expect(calls.chat[0].messages.at(-1).content).toContain('Selected vault context (quoted reference)');
    expect(calls.chat[0].messages.at(-1).content).toContain('Our telescope is named Meridian.');
    expect(calls.chat[0].model).toBe('account-model'); expect(calls.chat[0].signal).toBeInstanceOf(AbortSignal);
    expect(messages).toEqual(originalMessages);
    expect(deltas).toEqual([{ requestId: 'subscription-chat', delta: 'Subscription ' }, { requestId: 'subscription-chat', delta: 'answer.' }]);
    expect(first).toMatchObject({ text: 'Subscription answer.', model: 'account-model' });
    expect(first.memoryPath).toMatch(/^Aphelion\/Conversations\/What is a black hole - [\w-]+\.md$/);
    const archive = await readFile(join(root, 'vault', first.memoryPath), 'utf8');
    for (const text of ['Earlier question', 'Earlier answer', 'What is a black hole?', '## ChatGPT', 'Subscription answer.', '[[Project Memory]]']) expect(archive).toContain(text);
    expect(archive).not.toContain('Selected vault context (quoted reference)');
    const second = await engine.invoke('openaiChat', [{ requestId: 'subscription-followup', messages: [{ role: 'user', content: 'Continue the conversation' }], previousMemoryPath: first.memoryPath }]);
    expect(await readFile(join(root, 'vault', second.memoryPath), 'utf8')).toContain(`[[${first.memoryPath.replace(/\.md$/, '')}]]`);
    const graph = await engine.invoke('vaultGraph'); expect(graph.edges.some(edge => edge.from === second.memoryPath && edge.to === first.memoryPath)).toBe(true);
    expect(JSON.stringify(engine.history())).not.toContain('sk-test-available-but-optional');
  });

  it('uses Codex by default and writes the returned PNG into the active vault without invoking API billing', async () => {
    const { calls } = await start();
    const result = await engine.invoke('generateImage', [{ requestId: 'codex-image', prompt: 'A moon over water' }]);
    expect(result.src).toBe(`data:image/png;base64,${PNG}`); expect(calls.api).toEqual([]); expect(calls.chat).toEqual([]);
    expect(calls.image).toHaveLength(1); expect(calls.image[0].prompt).toBe('A moon over water'); expect(calls.image[0].signal).toBeInstanceOf(AbortSignal);
    const folder = join(root, 'vault', 'Aphelion', 'Images'), files = await readdir(folder);
    expect(files).toEqual([`A moon over water - ${result.id}.png`]);
    expect(await readFile(join(folder, files[0]))).toEqual(Buffer.from(PNG, 'base64'));
    expect(events.some(event => event.requestId === 'codex-image' && event.phase === 'completed')).toBe(true);
    expect(events.some(event => event.requestId === 'codex-image' && event.data?.path === `Aphelion/Images/${files[0]}`)).toBe(true);
  });

  it('preserves explicit API opt-in for both text and images', async () => {
    const { calls } = await start();
    const chat = await engine.invoke('openaiChat', [{ source: 'api', requestId: 'optional-api-chat', messages: [{ role: 'user', content: 'Use the API explicitly' }] }]);
    const generated = await engine.invoke('generateImage', [{ source: 'api', requestId: 'optional-api-image', prompt: 'An explicit API image' }]);
    expect(chat.text).toBe('Explicit API answer.'); expect(generated.src).toBe(`data:image/png;base64,${PNG}`);
    expect(calls.chat).toEqual([]); expect(calls.image).toEqual([]);
    expect(calls.api.map(call => call.url)).toEqual(['https://api.openai.com/v1/responses', 'https://api.openai.com/v1/images/generations']);
    expect(calls.api.every(call => call.headers.Authorization === 'Bearer sk-test-available-but-optional')).toBe(true);
  });

  it.each(['openaiChat', 'generateImage'])('surfaces %s subscription failures without falling back to a configured API key', async method => {
    const { calls } = await start({
      subscription: { chat: async () => { throw new Error('Your ChatGPT usage limit was reached.'); } },
      codex: { image: async () => { throw new Error('Native Codex image generation is unavailable.'); } },
    });
    const input = { requestId: 'no-paid-fallback', messages: [{ role: 'user', content: 'A question' }], prompt: 'A moon' };
    await expect(engine.invoke(method, [input])).rejects.toThrow(method === 'openaiChat' ? /usage limit/ : /unavailable/);
    expect(calls.api).toEqual([]);
    expect(events.some(event => event.requestId === input.requestId && event.phase === 'failed')).toBe(true);
    expect(events.some(event => event.requestId === input.requestId && event.phase === 'completed')).toBe(false);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  });

  it.each([['openaiChat', 'codex'], ['generateImage', 'subscription']])('rejects invalid source %s/%s before provider work', async (method, source) => {
    const { calls } = await start();
    await expect(engine.invoke(method, [{ source, requestId: 'invalid-source', messages: [{ role: 'user', content: 'A question' }], prompt: 'A moon' }])).rejects.toThrow(/Choose/);
    expect(calls.api).toEqual([]); expect(calls.chat).toEqual([]); expect(calls.image).toEqual([]);
  });
});

describe('subscription jobs and vault ownership', () => {
  it.each(['openaiChat', 'generateImage'])('guards vault switches and request IDs during %s, then cancels the owned provider signal', async method => {
    let ready, signal;
    const started = new Promise(resolve => { ready = resolve; });
    const pending = (_input, options) => new Promise((_resolve, reject) => {
      signal = options.signal; ready();
      options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    });
    const other = join(root, 'other-vault'); await mkdir(other);
    const { calls } = await start({ selectFolder: async () => other, subscription: { chat: pending }, codex: { image: pending } });
    const input = { requestId: 'subscription-pending', prompt: 'A moon', messages: [{ role: 'user', content: 'Tell me about moons' }] };
    const run = engine.invoke(method, [input]), rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    await expect(engine.invoke('selectVault')).rejects.toThrow(/Finish or stop/);
    await expect(engine.invoke(method, [input])).rejects.toThrow(/valid request/);
    await expect(engine.invoke('startChatGPTLogin')).rejects.toThrow(/Finish or stop/);
    await expect(engine.invoke('disconnectChatGPT')).rejects.toThrow(/Finish or stop/);
    await engine.invoke('cancel', [input.requestId]); await rejected;
    expect(signal.aborted).toBe(true); expect(calls.api).toEqual([]);
    expect(events.some(event => event.requestId === input.requestId && event.phase === 'stopped')).toBe(true);
    expect(events.some(event => event.requestId === input.requestId && event.phase === 'completed')).toBe(false);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
    await engine.invoke('selectVault'); expect(await engine.invoke('listNotes')).toEqual([]);
  });

  it.each(['openaiChat', 'generateImage'])('does not archive cancelled %s results when a provider resolves after cancellation', async method => {
    let release, ready;
    const started = new Promise(resolve => { ready = resolve; });
    const pending = () => new Promise(resolve => { release = resolve; ready(); });
    await start({ subscription: { chat: pending }, codex: { image: pending } });
    const input = { requestId: 'late-subscription-result', prompt: 'A moon', messages: [{ role: 'user', content: 'A late answer' }] };
    const run = engine.invoke(method, [input]), rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await started; await engine.invoke('cancel', [input.requestId]); release(method === 'openaiChat' ? { text: 'Late cancelled reply' } : image()); await rejected;
    const notes = await engine.invoke('listNotes'); expect(notes.some(note => note.path.startsWith('Aphelion/Conversations/'))).toBe(false);
    await expect(readdir(join(root, 'vault', 'Aphelion', 'Images'))).rejects.toThrow();
    expect(events.some(event => event.requestId === input.requestId && event.phase === 'completed')).toBe(false);
  });

  it('archives future subscription conversations and Codex images in the newly selected vault', async () => {
    const other = join(root, 'new-active-vault'); await mkdir(other);
    const { calls } = await start({ selectFolder: async () => other });
    await engine.invoke('selectVault');
    const chat = await engine.invoke('openaiChat', [{ requestId: 'selected-vault-chat', messages: [{ role: 'user', content: 'A new vault conversation' }] }]);
    const generated = await engine.invoke('generateImage', [{ requestId: 'selected-vault-image', prompt: 'A new vault moon' }]);
    expect(await readFile(join(other, chat.memoryPath), 'utf8')).toContain('Subscription answer.');
    expect(await readFile(join(other, 'Aphelion', 'Images', `A new vault moon - ${generated.id}.png`))).toEqual(Buffer.from(PNG, 'base64'));
    expect((await engine.invoke('listNotes')).map(note => note.path)).toEqual([chat.memoryPath]);
    expect(calls.api).toEqual([]);
  });
});

describe('ChatGPT connection controls', () => {
  it('returns combined sanitized connection status and delegates model, cancel, and disconnect controls', async () => {
    const { calls } = await start();
    const status = await engine.invoke('openaiStatus');
    expect(status).toMatchObject({ configured: true, subscription: { connected: true, account: 'alex@example.com', model: 'account-model' }, codex: { connected: true, available: true } });
    expect(JSON.stringify(status)).not.toContain('sk-test-available-but-optional');
    expect(await engine.invoke('chatGPTModels')).toEqual([{ slug: 'account-model', display_name: 'Account model', visibility: 'list' }]);
    await engine.invoke('cancelChatGPTLogin'); expect(calls.cancelLogin).toBe(1);
    expect((await engine.invoke('disconnectChatGPT')).connected).toBe(false); expect(calls.disconnect).toBe(1); expect(calls.models).toBe(1);
    expect(calls.chatFactory.dataDirectory).toBe(root); expect(calls.imageFactory.dataDirectory).toBe(root);
    expect(calls.api).toEqual([]);
  });

  it('opens native sign-in in the backend and returns an empty URL to the renderer', async () => {
    const { calls } = await start({ desktop: true });
    const result = await engine.invoke('startChatGPTLogin');
    expect(calls.opened).toEqual([officialURL]); expect(result).toEqual({ authorizationUrl: '', expiresAt: 1800000000000 });
    expect(JSON.stringify(result)).not.toMatch(/private-id-token|test-state|auth\.openai/);
    expect(JSON.stringify(engine.history())).not.toMatch(/private-id-token|test-state/);
    expect(calls.login).toBe(1); expect(calls.api).toEqual([]);
  });

  it('cancels pending authorization if the native sign-in browser fails', async () => {
    const { calls } = await start({ desktop: true, openExternal: async () => { throw new Error('private-id-token'); } });
    await expect(engine.invoke('startChatGPTLogin')).rejects.toThrow('The sign-in browser could not open. Try again.');
    expect(calls.cancelLogin).toBe(1); expect((await engine.invoke('openaiStatus')).subscription.connecting).toBe(false);
  });

  it('disposes both subscription services and aborts their in-flight owned jobs', async () => {
    let ready, signal;
    const started = new Promise(resolve => { ready = resolve; });
    const { calls } = await start({ subscription: { chat: (_messages, options) => new Promise((_resolve, reject) => { signal = options.signal; ready(); signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }); }) } });
    const run = engine.invoke('openaiChat', [{ requestId: 'dispose-subscription', messages: [{ role: 'user', content: 'A question' }] }]);
    const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await started; engine.dispose(); await rejected;
    expect(signal.aborted).toBe(true); expect(calls.chatDisposed).toBe(1); expect(calls.imageDisposed).toBe(1);
    await expect(engine.invoke('openaiStatus')).rejects.toThrow(/unavailable/); engine = null;
  });
});
