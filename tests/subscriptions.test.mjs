import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { subscriptionEnvironment, parseAuthentication, createEventDecoder, runSubscriptionChat } from '../electron/subscriptions.mjs';

describe('subscription-only authentication', () => {
  it('removes API billing and gateway credentials from child processes', () => {
    const env = subscriptionEnvironment({ PATH: 'tools', HOME: 'home', OPENAI_API_KEY: 'a', CODEX_API_KEY: 'b', ANTHROPIC_API_KEY: 'c', ANTHROPIC_AUTH_TOKEN: 'd', CLAUDE_CODE_OAUTH_TOKEN: 'e', OPENAI_BASE_URL: 'gateway', CLAUDE_CODE_USE_BEDROCK: '1' });
    expect(env).toMatchObject({ PATH: 'tools', HOME: 'home' });
    for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','OPENAI_BASE_URL','CLAUDE_CODE_USE_BEDROCK']) expect(env[key]).toBeUndefined();
  });
  it('isolates product clients from the host agents tool pipe and permission profile', () => {
    const env = subscriptionEnvironment({ PATH: 'tools', CODEX_HOME: 'account-home', CODEX_PERMISSION_PROFILE: 'read-only', CODEX_APP_TOOLS_PIPE_PATH: 'host-pipe', CODEX_SESSION_ID: 'host-session' });
    expect(env.CODEX_HOME).toBe('account-home');
    expect(env.CODEX_PERMISSION_PROFILE).toBeUndefined();
    expect(env.CODEX_APP_TOOLS_PIPE_PATH).toBeUndefined();
    expect(env.CODEX_SESSION_ID).toBeUndefined();
  });
  it('recognizes ChatGPT and Claude account sign-in while refusing API modes', () => {
    expect(parseAuthentication('codex', 'Logged in using ChatGPT').mode).toBe('subscription');
    expect(parseAuthentication('codex', 'Logged in using an API key').signedIn).toBe(false);
    expect(parseAuthentication('claude', JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })).signedIn).toBe(true);
    expect(parseAuthentication('claude', JSON.stringify({ loggedIn: true, authMethod: 'api_key' })).mode).toBe('api-key');
    expect(parseAuthentication('claude', JSON.stringify({ loggedIn: false, authMethod: 'none' })).signedIn).toBe(false);
  });
});
describe('official CLI event contracts', () => {
  it('collects Codex message updates without duplication and requires completion', () => {
    const chunks = []; const decoder = createEventDecoder('codex', text => chunks.push(text));
    decoder.accept({ type: 'item.updated', item: { id: 'one', type: 'agent_message', text: 'Hello' } });
    decoder.accept({ type: 'item.completed', item: { id: 'one', type: 'agent_message', text: 'Hello world' } });
    decoder.accept({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 3 } });
    expect(chunks.join('')).toBe('Hello world');
    expect(decoder.finish()).toEqual({ text: 'Hello world', demo: false, usage: { input: 12, output: 3 } });
  });
  it('decodes Claude partial text and avoids repeating its final result', () => {
    const chunks = []; const decoder = createEventDecoder('claude', text => chunks.push(text));
    decoder.accept({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A plan' } } });
    decoder.accept({ type: 'result', subtype: 'success', is_error: false, result: 'A plan', usage: { input_tokens: 8, output_tokens: 2 } });
    expect(chunks.join('')).toBe('A plan');
    expect(decoder.finish().text).toBe('A plan');
  });
  it('rejects interrupted or failed CLI turns', () => {
    const unfinished = createEventDecoder('codex');
    unfinished.accept({ type: 'item.completed', item: { id: 'one', type: 'agent_message', text: 'Partial answer' } });
    expect(() => unfinished.finish()).toThrow(/complete|ended/i);
    const failed = createEventDecoder('claude');
    expect(() => failed.accept({ type: 'result', is_error: true, subtype: 'error_max_turns' })).toThrow();
  });
  it('never launches a chat when the current account is using API authentication', async () => {
    let spawned = false;
    await expect(runSubscriptionChat({ agent: 'codex', messages: [{ role: 'user', content: 'Hello' }] }, { models: { codex: 'auto' } }, { getCliImpl: async () => ({ command: 'codex', args: [] }), inspectImpl: async () => ({ installed: true, signedIn: false, mode: 'api-key' }), spawnImpl: () => { spawned = true; } })).rejects.toThrow(/subscription|ChatGPT/i);
    expect(spawned).toBe(false);
  });
  it('passes prompts through stdin, disables shell parsing, and returns real streamed events', async () => {
    let options, args, stdin = '';
    const spawnImpl = (_command, commandArgs, spawnOptions) => {
      options = spawnOptions; args = commandArgs;
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.pid = 999999;
      child.stdin.on('data', chunk => stdin += chunk);
      child.stdin.on('finish', () => { child.stdout.write('{"type":"item.completed","item":{"id":"one","type":"agent_message","text":"Done"}}\n'); child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n'); child.stdout.end(); child.emit('close', 0); });
      return child;
    };
    const result = await runSubscriptionChat({ agent: 'codex', messages: [{ role: 'user', content: '`danger`; $secret' }] }, { models: { codex: 'auto' } }, { getCliImpl: async () => ({ command: 'codex', args: [] }), inspectImpl: async () => ({ installed: true, signedIn: true, mode: 'subscription' }), spawnImpl, cwd: '.' });
    expect(options.shell).toBe(false);
    expect(args).toContain('read-only');
    expect(args).not.toContain('`danger`; $secret');
    expect(stdin).toContain('`danger`; $secret');
    expect(result.text).toBe('Done');
  });
  it('does not load or allow the users MCP tools in a text-only Claude turn', async () => {
    let args;
    const spawnImpl = (_command, commandArgs) => {
      args = commandArgs;
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.pid = 999999;
      child.stdin.on('finish', () => { child.stdout.write('{"type":"result","subtype":"success","is_error":false,"result":"Done","usage":{"input_tokens":1,"output_tokens":1}}\n'); child.stdout.end(); child.emit('close', 0); });
      child.stdin.resume(); return child;
    };
    await runSubscriptionChat({ agent: 'claude', messages: [{ role: 'user', content: 'Hello' }] }, { models: { claude: 'auto' } }, { getCliImpl: async () => ({ command: 'claude', args: [] }), inspectImpl: async () => ({ installed: true, signedIn: true, mode: 'subscription' }), spawnImpl });
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__*');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
  });
});
