import { describe, expect, it } from 'vitest';
import { runChat, consumeSSE, synthesize, transcribe } from '../electron/services.mjs';

const config = { keys: { claude: 'test-anthropic-key', codex: 'test-openai-key', elevenlabs: 'test-voice-key' }, models: { claude: 'claude-sonnet-4-6', codex: 'gpt-6-sol' }, voiceId: 'test-voice' };
const messages = [{ role: 'user', content: 'Hello' }];
function streamResponse(text, cuts = [7, 21, 50]) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { let at = 0; for (const end of [...cuts, bytes.length]) { c.enqueue(bytes.slice(at, end)); at = end; } c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
describe('provider boundaries', () => {
  it('decodes SSE split across bytes, CRLF and multiline event data', async () => {
    const events = [];
    const response = streamResponse('event: message\r\ndata: {"text":\r\ndata: "café 🌍"}\r\n\r\ndata: [DONE]\n\n', [9, 40, 49, 51]);
    await consumeSSE(response.body, e => events.push(e));
    expect(events).toEqual([{ type: 'message', data: { text: 'café 🌍' } }]);
  });
  it('routes OpenAI auth and conversation to Responses and returns streamed text', async () => {
    let actual;
    const result = await runChat({ agent: 'codex', messages }, config, { fetchImpl: async (url, options) => {
      actual = { url, ...options };
      return streamResponse('data: {"type":"response.output_text.delta","delta":"Hi"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n');
    } });
    expect(actual.url).toBe('https://api.openai.com/v1/responses');
    expect(actual.headers.Authorization).toBe('Bearer test-openai-key');
    expect(JSON.parse(actual.body)).toMatchObject({ model: 'gpt-6-sol', input: messages, stream: true, store: false });
    expect(result).toMatchObject({ text: 'Hi', demo: false, usage: { input: 3, output: 1 } });
  });
  it('uses Anthropic Messages headers and text deltas', async () => {
    let actual;
    const result = await runChat({ agent: 'claude', messages }, config, { fetchImpl: async (url, options) => {
      actual = { url, ...options };
      return streamResponse('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A plan"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
    } });
    expect(actual.url).toBe('https://api.anthropic.com/v1/messages');
    expect(actual.headers['x-api-key']).toBe('test-anthropic-key');
    expect(JSON.parse(actual.body)).toMatchObject({ model: 'claude-sonnet-4-6', messages, max_tokens: 8192, stream: true });
    expect(result.text).toBe('A plan');
  });
  it('exposes connected provider failures without demo fallback or secret leakage', async () => {
    await expect(runChat({ agent: 'codex', messages }, config, { fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Unauthorized test-openai-key' } }), { status: 401 }) })).rejects.toThrow(/API key/i);
  });
  it('reports stream failures instead of claiming a partial answer complete', async () => {
    await expect(runChat({ agent: 'codex', messages }, config, { fetchImpl: async () => streamResponse('data: {"type":"response.failed","response":{"error":{"message":"failure"}}}\n\n') })).rejects.toThrow();
  });
  it('requires configured credentials and rejects empty prompts', async () => {
    await expect(runChat({ agent: 'claude', messages }, { ...config, keys: {} })).rejects.toThrow(/connect/i);
    await expect(runChat({ agent: 'codex', messages: [] }, config)).rejects.toThrow(/message/i);
  });
  it('sends TTS to a fixed ElevenLabs host and returns playable bytes', async () => {
    let requested;
    const result = await synthesize('Hello world', config, async (url, options) => {
      requested = { url, ...options }; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    });
    expect(requested.url).toContain('https://api.elevenlabs.io/v1/text-to-speech/test-voice');
    expect(JSON.parse(requested.body).text).toBe('Hello world');
    expect(result.data).toBe('AQID');
  });
  it('sends recorded audio as multipart and returns the real transcript', async () => {
    const text = await transcribe({ data: [1, 2, 3], type: 'audio/webm' }, config, async (url, options) => {
      expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
      expect(options.body.get('model_id')).toBe('scribe_v2');
      expect(options.body.get('file').size).toBe(3);
      return Response.json({ text: 'Build the castle' });
    });
    expect(text).toBe('Build the castle');
  });
});
