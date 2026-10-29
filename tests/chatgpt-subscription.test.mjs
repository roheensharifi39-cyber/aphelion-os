import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createChatGPTSubscriptionService } from '../electron/chatgpt-subscription.mjs';

const ISSUER = 'https://auth.openai.com', API = 'https://api.openai.com/v1';
const CLIENT = 'oaiapp_aphelion_test', OTHER_CLIENT = 'oaiapp_other_workspace';
const DIRECT = 'chatgpt.tokens.use.direct';
const messages = [{ role: 'user', content: 'Explain a black hole.' }];
const protectedStore = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from([...Buffer.from(text)].map(byte => byte ^ 0xa5)), decryptString: bytes => Buffer.from([...bytes].map(byte => byte ^ 0xa5)).toString() };
const metadata = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/accounts/authorize`, token_endpoint: `${ISSUER}/api/accounts/oauth/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${ISSUER}/oauth/revoke` };
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const sse = (...events) => new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const delta = text => ({ type: 'response.output_text.delta', delta: text });
const completed = { type: 'response.completed', response: { status: 'completed' } };
let signingKey, wrongKey, jwk, root, services, clock;
beforeAll(async () => {
  const keys = await generateKeyPair('RS256'); signingKey = keys.privateKey;
  jwk = { ...await exportJWK(keys.publicKey), kid: 'official-test-key', alg: 'RS256', use: 'sig' };
  wrongKey = (await generateKeyPair('RS256')).privateKey;
});
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'aphelion-chatgpt-test-')); services = []; clock = Date.now(); });
afterEach(async () => {
  for (const service of services) service.dispose();
  const target = resolve(root);
  expect(target.startsWith(resolve(tmpdir()) + sep)).toBe(true); expect(basename(target)).toMatch(/^aphelion-chatgpt-test-/);
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
});
async function waitUntil(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Test condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function identity(nonce, options = {}) {
  const { key = signingKey, subject = 'verified-account', issuer = ISSUER, audience = CLIENT, expiry = clock / 1000 + 3600 } = options;
  return new SignJWT({ nonce, email: 'alex@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'official-test-key' }).setSubject(subject).setIssuer(issuer).setAudience(audience).setIssuedAt(Math.floor(clock / 1000)).setExpirationTime(Math.floor(expiry)).sign(key);
}
async function harness(options = {}) {
  const calls = []; let authorize, tokenOptions = {}, scope = `openid email offline_access resource.invoke ${DIRECT}`, responseFactory = () => sse(delta('Hello'), completed);
  let tokenHandler, modelHandler, customFetch;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), ...init });
    if (customFetch) { const response = await customFetch(url, init); if (response) return response; }
    if (url === `${ISSUER}/.well-known/openid-configuration`) return json(metadata);
    if (url === metadata.jwks_uri) return json({ keys: [jwk] });
    if (url === metadata.token_endpoint) {
      if (tokenHandler) return tokenHandler(url, init);
      const body = new URLSearchParams(init.body);
      return json({ access_token: 'test-access-secret', refresh_token: 'test-refresh-secret', id_token: await identity(authorize.searchParams.get('nonce'), { audience: body.get('client_id'), ...tokenOptions }), token_type: 'Bearer', expires_in: 3600, scope });
    }
    if (url === `${API}/models`) return modelHandler ? modelHandler(url, init) : json({ models: [{ slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'account-first', display_name: 'Account first', visibility: 'list' }, { slug: 'account-second', display_name: 'Account second', visibility: 'list' }] });
    if (url === `${API}/responses`) return responseFactory(url, init);
    if (url === metadata.revocation_endpoint) return new Response(null, { status: 200 });
    throw new Error('Unexpected test network request');
  };
  const statuses = [], notices = [];
  const service = await createChatGPTSubscriptionService({ dataDirectory: root, secureStorage: protectedStore, fetchImpl, now: () => clock, onStatus: status => statuses.push(status), onNotice: notice => notices.push(notice), ...options });
  services.push(service);
  async function begin(settings) { const result = await service.startLogin(settings); authorize = new URL(result.authorizationUrl); return result; }
  async function callback(params = {}, settings = {}) {
    const uri = new URL(authorize.searchParams.get('redirect_uri'));
    const values = { code: 'one-time-code', state: authorize.searchParams.get('state'), client_id: CLIENT, ...params };
    uri.search = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null)).toString();
    const response = await fetch(uri, { ...settings, headers: { Connection: 'close' } });
    await response.text(); await waitUntil(() => !service.status().connecting); return response;
  }
  async function connect(params) { await begin(); await callback(params); expect(service.status().connected).toBe(true); }
  return { service, calls, statuses, notices, begin, callback, connect, get authorize() { return authorize; }, set tokenOptions(value) { tokenOptions = value; }, set scope(value) { scope = value; }, set tokenHandler(value) { tokenHandler = value; }, set modelHandler(value) { modelHandler = value; }, set responseFactory(value) { responseFactory = value; }, set customFetch(value) { customFetch = value; } };
}

describe('ChatGPT official OAuth boundary', () => {
  it('persists one host, creates fresh S256/nonce/state, and binds the issued client to the exact loopback URI', async () => {
    const app = await harness();
    expect(app.service.status()).toEqual({ connected: false, connecting: false, detail: 'Continue with ChatGPT to use your subscription.', model: '' });
    const first = await app.begin(); const auth = app.authorize;
    expect(auth.origin + auth.pathname).toBe(metadata.authorization_endpoint);
    expect(auth.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(auth.searchParams.get('agent_name_hint')).toBe('Aphelion OS');
    expect(auth.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:[\da-f-]{36}$/);
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('scope').split(' ')).toEqual(['openid', 'profile', 'email', 'offline_access', 'resource.invoke', DIRECT]);
    expect(first.expiresAt).toBe(clock + 300000);
    await app.callback();
    const exchange = app.calls.find(call => call.url === metadata.token_endpoint), form = new URLSearchParams(exchange.body);
    expect(form.get('client_id')).toBe(CLIENT); expect(form.get('redirect_uri')).toBe(auth.searchParams.get('redirect_uri')); expect(form.get('resource')).toBe(API);
    expect(form.get('grant_type')).toBe('authorization_code'); expect(form.has('client_secret')).toBe(false);
    expect(createHash('sha256').update(form.get('code_verifier')).digest('base64url')).toBe(auth.searchParams.get('code_challenge'));
    expect(exchange.redirect).toBe('error');
    expect(app.service.status().account).toBe('alex@example.com');
    await app.begin();
    expect(app.authorize.searchParams.get('state')).not.toBe(auth.searchParams.get('state'));
    expect(app.authorize.searchParams.get('nonce')).not.toBe(auth.searchParams.get('nonce'));
    expect(app.authorize.searchParams.get('client_id')).toBe(CLIENT);
    expect(app.authorize.searchParams.has('agent_name_hint')).toBe(false);
    expect(app.authorize.searchParams.get('id_token_hint')).toBeTruthy();
    expect(app.authorize.searchParams.get('ext_agent_host_id')).toBe(auth.searchParams.get('ext_agent_host_id'));
    await app.callback({ client_id: null }); // Returning callbacks can omit an issued client ID.
    expect(app.service.status().connected).toBe(true);
  });
  it.each(['wrong-state', ''])('rejects mismatched state %s before token exchange and closes the listener', async state => {
    const app = await harness(); await app.begin(); const uri = app.authorize.searchParams.get('redirect_uri');
    const result = await app.callback({ state }); expect(result.status).toBe(400);
    expect(app.calls).toEqual([]); expect(app.service.status().connected).toBe(false);
    await expect(fetch(uri)).rejects.toThrow();
  });
  it.each([{ error: 'access_denied' }, { client_id: '' }, { client_id: 'dynamic_agent_client' }, { code: '' }])('rejects declined or incomplete registration %j', async callback => {
    const app = await harness(); await app.begin(); await app.callback(callback);
    expect(app.calls).toEqual([]); expect(app.service.status().connected).toBe(false);
  });
  it.each([
    { key: 'wrong' }, { issuer: 'https://attacker.test' }, { audience: 'oaiapp_wrong' }, { expiry: 0 }, { nonce: 'wrong' },
  ])('requires valid signature, issuer, audience, expiration, and nonce: %j', async bad => {
    const app = await harness();
    if (bad.key) app.tokenOptions = { key: wrongKey }; else if (bad.nonce) {
      app.tokenHandler = async (_url, init) => json({ access_token: 'test-access-secret', refresh_token: 'test-refresh-secret', id_token: await identity('wrong', { audience: new URLSearchParams(init.body).get('client_id') }), token_type: 'Bearer', expires_in: 3600, scope: DIRECT });
    } else app.tokenOptions = bad;
    await app.begin(); await app.callback();
    expect(app.service.status().connected).toBe(false); expect(app.service.status().detail).toMatch(/identity/);
    expect(JSON.stringify(app.statuses)).not.toMatch(/test-access-secret|test-refresh-secret|eyJ/);
  });
  it('uses the token grant rather than callback scopes and retains identity when plan use is not authorized', async () => {
    const app = await harness(); app.scope = 'openid email offline_access chatgpt.tokens.use.directly';
    await app.begin(); await app.callback({ scope: DIRECT });
    expect(app.service.status()).toMatchObject({ connected: false, account: 'alex@example.com' });
    await expect(app.service.chat(messages)).rejects.toThrow(/not granted/);
    expect(app.calls.some(call => call.url.startsWith(API))).toBe(false);
    await app.begin(); expect(app.authorize.searchParams.get('client_id')).toBe(CLIENT);
  });
  it('retains the callback-issued registration for fresh authorization after invalid_grant', async () => {
    const app = await harness();
    app.tokenHandler = () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    await app.begin(); await app.callback(); expect(app.service.status().connected).toBe(false);
    await app.begin(); expect(app.authorize.searchParams.get('client_id')).toBe(CLIENT); expect(app.authorize.searchParams.has('agent_name_hint')).toBe(false);
    app.tokenHandler = null; await app.callback({ client_id: null }); expect(app.service.status().connected).toBe(true);
  });
  it('rejects changed registrations and changed account identity during reauthorization', async () => {
    const app = await harness(); await app.connect(); const exchangeCount = app.calls.filter(call => call.url === metadata.token_endpoint).length;
    await app.begin(); await app.callback({ client_id: OTHER_CLIENT });
    expect(app.calls.filter(call => call.url === metadata.token_endpoint)).toHaveLength(exchangeCount);
    expect(app.service.status().connected).toBe(true);
    await app.begin(); app.tokenOptions = { subject: 'different-account' }; await app.callback();
    expect(app.service.status().detail).toMatch(/does not match/);
    expect(app.service.status().account).toBe('alex@example.com');
  });
  it('never overwrites a saved registration with a different subject when adding an account', async () => {
    const app = await harness(); await app.connect();
    await app.begin({ newAccount: true }); app.tokenOptions = { subject: 'another-account' }; await app.callback();
    expect(app.service.status().detail).toMatch(/belongs to another account/);
    const saved = JSON.parse(await readFile(join(root, 'chatgpt-subscription.json'), 'utf8'));
    expect(saved.registrations).toHaveLength(1); expect(saved.registrations[0].subject).toBe('verified-account');
    expect(app.service.status().connected).toBe(true);
  });
  it('encrypts all credentials, restores them, and never exposes secrets through status or files', async () => {
    const app = await harness(); await app.connect();
    const source = await readFile(join(root, 'chatgpt-subscription.json'), 'utf8');
    expect(source).not.toMatch(/test-access-secret|test-refresh-secret|eyJ/); expect(JSON.parse(source).registrations[0].encryptedCredentials).toBeTruthy();
    expect(JSON.stringify(app.statuses)).not.toMatch(/test-access-secret|test-refresh-secret|eyJ|one-time-code/);
    const restored = await harness(); expect(restored.service.status().connected).toBe(true);
    await restored.service.chat(messages);
    expect(restored.calls.find(call => call.url === `${API}/responses`).headers.Authorization).toBe('Bearer test-access-secret');
    expect((await readdir(root)).filter(file => file.endsWith('.tmp'))).toEqual([]);
  });
  it.each([null, { ...protectedStore, getSelectedStorageBackend: () => 'basic_text' }])('keeps session-only credentials without a secure platform store', async secureStorage => {
    const app = await harness({ secureStorage }); await app.connect();
    expect(app.notices.join()).toMatch(/session/);
    const source = await readFile(join(root, 'chatgpt-subscription.json'), 'utf8');
    expect(source).not.toMatch(/encryptedCredentials|test-access-secret|test-refresh-secret|eyJ/);
    const restored = await harness({ secureStorage }); expect(restored.service.status().connected).toBe(false);
    await restored.begin(); expect(restored.authorize.searchParams.get('client_id')).toBe(CLIENT); expect(restored.authorize.searchParams.has('id_token_hint')).toBe(false);
  });
  it('closes cancelled and expired callback listeners and invalidates their state', async () => {
    const app = await harness({ loginTimeoutMs: 40 }); await app.begin(); const first = app.authorize.searchParams.get('redirect_uri');
    app.service.cancelLogin(); expect(app.service.status().connecting).toBe(false); await expect(fetch(first)).rejects.toThrow();
    await app.begin(); const second = app.authorize.searchParams.get('redirect_uri');
    await waitUntil(() => !app.service.status().connecting); expect(app.service.status().detail).toMatch(/expired/); await expect(fetch(second)).rejects.toThrow();
  });
  it('does not persist credentials when cancellation happens during secure encryption', async () => {
    let unlock, encrypting = false;
    const app = await harness({ secureStorage: { ...protectedStore, encryptString: async value => { encrypting = true; await new Promise(resolve => { unlock = resolve; }); return protectedStore.encryptString(value); } } });
    await app.begin(); const callback = app.callback(); await waitUntil(() => encrypting);
    app.service.cancelLogin(); unlock(); await callback;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(app.service.status().connected).toBe(false);
    expect(await readFile(join(root, 'chatgpt-subscription.json'), 'utf8')).not.toMatch(/encryptedCredentials/);
  });
});

describe('ChatGPT model catalog and streaming', () => {
  it('uses visible account catalog order and streams text with the supported minimal request shape', async () => {
    const app = await harness(); await app.connect();
    const models = await app.service.models();
    expect(models.map(model => model.slug)).toEqual(['account-first', 'account-second']);
    expect(app.service.status().model).toBe('account-first');
    const chunks = [], result = await app.service.chat(messages, { onDelta: value => chunks.push(value), model: 'account-second' });
    expect(result).toEqual({ text: 'Hello', model: 'account-second' }); expect(chunks).toEqual(['Hello']);
    const call = app.calls.find(call => call.url === `${API}/responses`);
    expect(JSON.parse(call.body)).toEqual({ model: 'account-second', input: messages, store: false, stream: true });
    await expect(app.service.chat(messages, { model: 'hidden' })).rejects.toThrow(/available/);
  });
  it('decodes split UTF-8, CRLF boundaries, comments, and multiline SSE data correctly', async () => {
    const app = await harness(); await app.connect();
    app.responseFactory = () => {
      const source = `: heartbeat\r\n\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"Moon 🌕 café"}\r\n\r\ndata: ${JSON.stringify(completed)}\r\n\r\n`;
      const bytes = new TextEncoder().encode(source);
      return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    };
    const chunks = [], result = await app.service.chat(messages, { onDelta: chunk => chunks.push(chunk) });
    expect(result.text).toBe('Moon 🌕 café'); expect(chunks).toEqual(['Moon 🌕 café']);
  });
  it.each([
    [() => sse(delta('Partial')), /before completing/],
    [() => sse(delta('Partial'), { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'secret server response' } } }), /usage limit/],
    [() => sse(delta('Partial'), { type: 'response.incomplete' }), /could not complete/],
    [() => sse(delta('Partial'), { type: 'error', message: 'test-access-secret' }), /could not complete/],
    [() => new Response('data: invalid-json\n\n'), /unreadable/],
    [() => sse(completed), /no text/],
  ])('requires terminal response.completed and handles stream failures', async (factory, expected) => {
    const app = await harness(); await app.connect(); app.responseFactory = factory;
    await expect(app.service.chat(messages)).rejects.toThrow(expected);
  });
  it('stops at completed even when the server keeps its transport open', async () => {
    const app = await harness(); await app.connect(); let cancelled = false;
    app.responseFactory = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta('Done'))}\n\ndata: ${JSON.stringify(completed)}\n\n`)); }, cancel() { cancelled = true; } }));
    expect((await app.service.chat(messages)).text).toBe('Done'); expect(cancelled).toBe(true);
  });
  it('aborts active streaming and disposes network work even when fetch ignores cancellation', async () => {
    const app = await harness(); await app.connect(); await app.service.models();
    let requestStarted = false; app.responseFactory = () => { requestStarted = true; return new Promise(() => {}); };
    const controller = new AbortController(); const result = app.service.chat(messages, { signal: controller.signal });
    await waitUntil(() => requestStarted); controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    requestStarted = false; const second = app.service.chat(messages); await waitUntil(() => requestStarted); app.service.dispose();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cancels the stream reader when an interrupted server leaves the response transport open', async () => {
    const app = await harness(); await app.connect(); await app.service.models();
    let started = false, cancelled = false;
    app.responseFactory = () => new Response(new ReadableStream({ start(controller) { started = true; controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta('Partial'))}\n\n`)); }, cancel() { cancelled = true; } }));
    const controller = new AbortController(), result = app.service.chat(messages, { signal: controller.signal });
    await waitUntil(() => started); controller.abort(); await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });
  it('bounds transport timeouts and sanitizes untrusted error bodies', async () => {
    const app = await harness({ requestTimeoutMs: 30 }); await app.connect(); await app.service.models();
    app.responseFactory = () => new Promise(() => {});
    await expect(app.service.chat(messages)).rejects.toThrow(/too long/);
    app.responseFactory = () => new Response(JSON.stringify({ error: { code: 'invalid_request', message: 'test-access-secret and private prompt' } }), { status: 400 });
    await expect(app.service.chat(messages)).rejects.toThrow('ChatGPT could not accept this request. Check the selected model and try again.');
  });
});

describe('ChatGPT rotating refresh and sign-out', () => {
  it.each(['success', 'invalid_grant'])('never lets an older pending refresh %s replace or clear a reauthorized same-client session', async outcome => {
    const app = await harness(); await app.connect(); await app.service.models(); clock += 3590000;
    let release;
    app.tokenHandler = async (_url, init) => {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'refresh_token') {
        await new Promise(resolve => { release = resolve; });
        return outcome === 'success' ? json({ access_token: 'old-session-rotated-access', refresh_token: 'old-session-rotated-refresh', token_type: 'Bearer', expires_in: 3600, scope: DIRECT }) : new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      }
      return json({ access_token: 'reauthorized-access-secret', refresh_token: 'reauthorized-refresh-secret', id_token: await identity(app.authorize.searchParams.get('nonce')), token_type: 'Bearer', expires_in: 3600, scope: DIRECT });
    };
    const refresh = app.service.models().then(value => ({ value }), error => ({ error }));
    await waitUntil(() => Boolean(release)); await app.begin(); await app.callback();
    expect(app.service.status().connected).toBe(true); release(); await refresh;
    expect(app.service.status().connected).toBe(true);
    const saved = JSON.parse(await readFile(join(root, 'chatgpt-subscription.json'), 'utf8'));
    const tokens = JSON.parse(protectedStore.decryptString(Buffer.from(saved.registrations[0].encryptedCredentials, 'base64')));
    expect(tokens.accessToken).toBe('reauthorized-access-secret'); expect(tokens.refreshToken).toBe('reauthorized-refresh-secret');
  });
  it('prevents a refresh already encrypting credentials from committing after same-client reauthorization', async () => {
    let release, encrypting = false;
    const app = await harness({ secureStorage: { ...protectedStore, encryptString: async text => {
      if (JSON.parse(text).accessToken === 'old-refresh-access') { encrypting = true; await new Promise(resolve => { release = resolve; }); }
      return protectedStore.encryptString(text);
    } } });
    await app.connect(); await app.service.models(); clock += 3590000;
    app.tokenHandler = async (_url, init) => new URLSearchParams(init.body).get('grant_type') === 'refresh_token'
      ? json({ access_token: 'old-refresh-access', refresh_token: 'old-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: DIRECT })
      : json({ access_token: 'new-login-access', refresh_token: 'new-login-refresh', id_token: await identity(app.authorize.searchParams.get('nonce')), token_type: 'Bearer', expires_in: 3600, scope: DIRECT });
    const refresh = app.service.models().then(value => ({ value }), error => ({ error }));
    await waitUntil(() => encrypting); await app.begin(); await app.callback(); release(); await refresh;
    const saved = JSON.parse(await readFile(join(root, 'chatgpt-subscription.json'), 'utf8'));
    const tokens = JSON.parse(protectedStore.decryptString(Buffer.from(saved.registrations[0].encryptedCredentials, 'base64')));
    expect(tokens.accessToken).toBe('new-login-access'); expect(tokens.refreshToken).toBe('new-login-refresh');
  });
  it('serializes refresh, uses the issued client and resource, rotates credentials together, and restores the latest tokens', async () => {
    const app = await harness(); await app.connect(); await app.service.models(); clock += 3590000;
    let count = 0, release;
    app.tokenHandler = async (_url, init) => {
      count += 1; const form = new URLSearchParams(init.body);
      expect(Object.fromEntries(form)).toEqual({ grant_type: 'refresh_token', client_id: CLIENT, refresh_token: 'test-refresh-secret', resource: API });
      await new Promise(resolve => { release = resolve; });
      return json({ access_token: 'rotated-access-secret', refresh_token: 'rotated-refresh-secret', token_type: 'Bearer', expires_in: 3600, scope: DIRECT });
    };
    const one = app.service.models(), two = app.service.models(); await waitUntil(() => Boolean(release)); expect(count).toBe(1); release();
    await Promise.all([one, two]); expect(count).toBe(1);
    const restored = await harness(); expect(restored.service.status().connected).toBe(true);
    await restored.service.chat(messages);
    expect(restored.calls.find(call => call.url === `${API}/responses`).headers.Authorization).toBe('Bearer rotated-access-secret');
    const source = await readFile(join(root, 'chatgpt-subscription.json'), 'utf8'); expect(source).not.toMatch(/rotated-access-secret|rotated-refresh-secret/);
  });
  it('preserves credentials on temporary refresh failure and clears terminally invalid sessions while retaining registration', async () => {
    const app = await harness(); await app.connect(); clock += 3590000;
    app.tokenHandler = () => new Response('temporary private data', { status: 503 });
    await expect(app.service.models()).rejects.toThrow(/temporarily/); expect(app.service.status().connected).toBe(true);
    app.tokenHandler = () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'test-refresh-secret' }), { status: 400 });
    await expect(app.service.models()).rejects.toThrow(/session has ended/); expect(app.service.status().connected).toBe(false);
    await app.begin(); expect(app.authorize.searchParams.get('client_id')).toBe(CLIENT); expect(app.authorize.searchParams.has('id_token_hint')).toBe(false);
  });
  it('retains the refreshed identity but stops inference when the renewed grant loses plan permission', async () => {
    const app = await harness(); await app.connect(); clock += 3590000;
    app.tokenHandler = () => json({ access_token: 'renewed-access', refresh_token: 'renewed-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'openid email offline_access' });
    await expect(app.service.models()).rejects.toThrow(/no longer enabled/);
    expect(app.service.status().connected).toBe(false); expect(app.service.status().account).toBe('alex@example.com');
    expect(app.calls.some(call => call.url === `${API}/models`)).toBe(false);
  });
  it('signs out, revokes with the discovery endpoint, and clears credentials while retaining the host and issued registration', async () => {
    const app = await harness(); await app.connect(); const host = app.authorize.searchParams.get('ext_agent_host_id');
    const result = await app.service.disconnect(); expect(result.connected).toBe(false); expect(result.detail).toBe('Disconnected from ChatGPT.');
    const revoke = app.calls.find(call => call.url === metadata.revocation_endpoint);
    expect(Object.fromEntries(new URLSearchParams(revoke.body))).toEqual({ token: 'test-refresh-secret', token_type_hint: 'refresh_token', client_id: CLIENT });
    const source = await readFile(join(root, 'chatgpt-subscription.json'), 'utf8'); expect(source).not.toContain('encryptedCredentials');
    await app.begin(); expect(app.authorize.searchParams.get('ext_agent_host_id')).toBe(host); expect(app.authorize.searchParams.get('client_id')).toBe(CLIENT); expect(app.authorize.searchParams.has('id_token_hint')).toBe(false);
  });
  it('clears locally and explains unconfirmed revocation without exposing remote failures', async () => {
    const app = await harness(); await app.connect();
    app.customFetch = url => url === metadata.revocation_endpoint ? new Response('test-refresh-secret', { status: 503 }) : null;
    const status = await app.service.disconnect(); expect(status.connected).toBe(false); expect(status.detail).toMatch(/revocation was not confirmed/); expect(status.detail).not.toContain('test-refresh-secret');
    const restored = await harness(); expect(restored.service.status().connected).toBe(false);
  });
});
