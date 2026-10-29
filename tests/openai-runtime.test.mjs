import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntime, conversationTitle } from '../electron/runtime.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZcLEAAAAASUVORK5CYII=';
const textResponse = () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A useful general answer.' }] }] }));
let root, engine, events;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'aphelion-openai-runtime-')); events = []; });
afterEach(async () => {
  engine?.dispose(); engine = null;
  const target = resolve(root); expect(target.startsWith(resolve(tmpdir()) + sep)).toBe(true); expect(basename(target)).toMatch(/^aphelion-openai-runtime-/);
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
});
async function start(options = {}) {
  engine = await createRuntime({ dataDirectory: root, openaiEnvironment: { OPENAI_API_KEY: 'sk-test-key' }, openaiSecureStorage: null, openaiFetch: async () => textResponse(), authProvider: async () => ({}), codexImageFactory: () => ({ status: async () => ({ connected: false, available: false, detail: 'Isolated test client' }), dispose: () => {} }), obsidianFactory: () => ({ watch: async () => {}, status: async () => ({ installed: false }), processes: async () => [], dispose: () => {} }), ...options });
  engine.onEvent(event => events.push(event)); return engine;
}

describe('OpenAI runtime integration', () => {
  it('archives general chat history with readable safe names and related memory links', async () => {
    let sent;
    await start({ openaiFetch: async (_url, options) => { sent = JSON.parse(options.body); return textResponse(); } });
    const input = { source: 'api', requestId: 'general-one', messages: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }, { role: 'user', content: 'What is a black hole?' }], contextPaths: ['Project Memory.md'] };
    const first = await engine.invoke('openaiChat', [input]);
    expect(first.memoryPath).toMatch(/^Aphelion\/Conversations\/What is a black hole - [\w-]+\.md$/);
    expect(sent.input.at(-1).content).toContain('Selected vault context (quoted reference)');
    expect(input.messages.at(-1).content).toBe('What is a black hole?');
    const firstNote = await engine.invoke('readNote', [first.memoryPath]);
    for (const text of ['Earlier question', 'Earlier answer', '## ChatGPT', 'A useful general answer.', '[[Project Memory]]']) expect(firstNote.content).toContain(text);
    const second = await engine.invoke('openaiChat', [{ ...input, requestId: 'general-two', previousMemoryPath: first.memoryPath }]);
    expect(second.memoryPath).not.toBe(first.memoryPath);
    const note = await engine.invoke('readNote', [second.memoryPath]);
    expect(note.content).toContain(`[[${first.memoryPath.replace(/\.md$/, '')}]]`);
    const graph = await engine.invoke('vaultGraph'); expect(graph.edges.some(edge => edge.from === second.memoryPath && edge.to === first.memoryPath)).toBe(true);
    expect(conversationTitle('../bad\\name:*? [wiki]\nsecond line')).toBe('.. bad name wiki');
    expect(conversationTitle(' /:*? ')).toBe('Conversation');
    expect(conversationTitle('a'.repeat(500)).length).toBe(64);
    expect(JSON.stringify(engine.history())).not.toContain('sk-test-key');
  });
  it('saves a generated PNG in the active vault and returns a safe downloadable source', async () => {
    await start({ openaiFetch: async () => new Response(JSON.stringify({ created: 1700000000, data: [{ b64_json: PNG }] })) });
    const result = await engine.invoke('generateImage', [{ source: 'api', requestId: 'image-one', prompt: 'A moon over water' }]);
    expect(result.src).toBe(`data:image/png;base64,${PNG}`);
    const folder = join(root, 'vault', 'Aphelion', 'Images'), files = await readdir(folder);
    expect(files).toEqual([`A moon over water - ${result.id}.png`]);
    expect(await readFile(join(folder, files[0]))).toEqual(Buffer.from(PNG, 'base64'));
    expect(events.some(event => event.phase === 'completed' && event.requestId === 'image-one')).toBe(true);
  });
  it('retains successful responses when memory or image persistence is blocked', async () => {
    await start({ openaiFetch: async url => url.endsWith('responses') ? textResponse() : new Response(JSON.stringify({ data: [{ b64_json: PNG }] })) });
    await writeFile(join(root, 'vault', 'Aphelion'), 'Blocks the archive directory');
    const chat = await engine.invoke('openaiChat', [{ source: 'api', requestId: 'memory-blocked', messages: [{ role: 'user', content: 'Explain a black hole' }] }]);
    expect(chat.text).toBe('A useful general answer.'); expect(chat.memoryWarning).toContain('could not be saved');
    const image = await engine.invoke('generateImage', [{ source: 'api', requestId: 'image-blocked', prompt: 'A moon' }]);
    expect(image.src).toBe(`data:image/png;base64,${PNG}`);
    expect(events.some(event => event.text.includes('Use Download'))).toBe(true);
  });
  it.each(['openaiChat', 'generateImage'])('blocks vault switches during %s and releases the job after cancellation', async method => {
    let started, signal;
    const ready = new Promise(resolve => { started = resolve; });
    await start({ openaiFetch: async (_url, options) => { signal = options.signal; started(); return new Promise(() => {}); } });
    const request = { source: 'api', requestId: 'pending-request', prompt: 'A moon', messages: [{ role: 'user', content: 'Tell me about moons' }] };
    const run = engine.invoke(method, [request]), rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await ready;
    await expect(engine.invoke('selectVault')).rejects.toThrow(/Finish or stop/);
    await expect(engine.invoke(method, [request])).rejects.toThrow(/valid request/);
    await engine.invoke('cancel', [request.requestId]); await rejected;
    expect(signal.aborted).toBe(true);
    expect(events.some(event => event.requestId === request.requestId && event.phase === 'stopped')).toBe(true);
    expect(events.some(event => event.requestId === request.requestId && event.phase === 'completed')).toBe(false);
    expect((await engine.invoke('listNotes')).some(note => note.path.startsWith('Aphelion/Conversations/'))).toBe(false);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  });
  it('writes future conversations to the selected vault', async () => {
    const otherVault = join(root, 'other-vault'); await mkdir(otherVault);
    await start({ selectFolder: async () => otherVault });
    await engine.invoke('selectVault');
    const result = await engine.invoke('openaiChat', [{ source: 'api', requestId: 'new-vault', messages: [{ role: 'user', content: 'A new conversation' }] }]);
    expect(await readFile(join(otherVault, result.memoryPath), 'utf8')).toContain('A new conversation');
    expect((await engine.invoke('listNotes')).map(note => note.path)).toEqual([result.memoryPath]);
  });
});
