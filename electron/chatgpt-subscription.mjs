import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { platformSecureStorage, validateOpenAIMessages } from './openai.mjs';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const JWKS = `${ISSUER}/.well-known/jwks.json`;
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`;
const APP_NAME = 'Aphelion OS';
const DYNAMIC_CLIENT = 'dynamic_agent_client';
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const TERMINAL_REFRESH_ERRORS = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

class ConnectionError extends Error {}
class HTTPError extends ConnectionError {
  constructor(status, code) {
    const message = status === 401 ? 'ChatGPT could not authorize this request. Sign in again.'
      : status === 403 ? 'This ChatGPT account does not allow this request or ChatGPT plan access.'
        : status === 429 ? 'Your ChatGPT usage limit was reached. Try again later or review ChatGPT Settings → Usage.'
          : status === 400 ? 'ChatGPT could not accept this request. Check the selected model and try again.'
            : 'ChatGPT is temporarily unavailable. Try again.';
    super(message); this.status = status; this.code = code;
  }
}
const stopped = () => new DOMException('Stopped', 'AbortError');
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 100000 && !/[\s\x00-\x1f\x7f]/.test(value);
const clientId = value => typeof value === 'string' && /^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(value);
const safeLabel = value => typeof value === 'string' && value.length <= 320 && !/[\x00-\x1f\x7f]/.test(value) ? value : '';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// The renderer receives status and text only. OAuth credentials stay in this
// service and are persisted only through an operating-system protected store.
export async function createChatGPTSubscriptionService({
  dataDirectory, secureStorage = platformSecureStorage(), fetchImpl = globalThis.fetch,
  requestTimeoutMs = 180000, authTimeoutMs = 20000, loginTimeoutMs = 300000,
  now = Date.now, onStatus = () => {}, onNotice = () => {},
} = {}) {
  const file = join(dataDirectory, 'chatgpt-subscription.json');
  let config = { version: 1, hostId: `urn:uuid:${randomUUID()}`, activeId: '', registrations: [] };
  let pending = null, starting = false, disposed = false, generation = 0, retryRegistration = null;
  let writing = Promise.resolve(), refreshPromise = null, discoveryCache = null, jwksCache = null;
  let detail = 'Continue with ChatGPT to use your subscription.';
  const requests = new Set(), catalogs = new Map(), credentials = new Map();
  const secure = () => { try { return Boolean(secureStorage?.isEncryptionAvailable()) && secureStorage?.getSelectedStorageBackend?.() !== 'basic_text'; } catch { return false; } };
  const active = () => config.registrations.find(record => record.clientId === config.activeId);
  const current = () => credentials.get(config.activeId);
  function status() {
    const account = active(), tokens = current();
    return { connected: Boolean(tokens?.accessToken && tokens.scopes.includes(DIRECT_SCOPE)), connecting: Boolean(pending || starting), ...(account ? { account: account.email || 'ChatGPT account' } : {}), detail, model: account?.model || '' };
  }
  function notify() { try { onStatus(status()); } catch { /* Consumer callbacks cannot change credential handling. */ } }
  function notice(text) { try { onNotice(text); } catch { /* Notices contain no remote response bodies. */ } }
  function alive() { if (disposed) throw new ConnectionError('The ChatGPT connection is closed.'); }
  async function persist() {
    const serialized = JSON.stringify(config, null, 2);
    writing = writing.catch(() => {}).then(async () => {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
      catch { throw new ConnectionError('The ChatGPT connection could not be saved. Check this app’s data folder.'); }
      finally { await unlink(temporary).catch(() => {}); }
    });
    return writing;
  }
  await mkdir(dataDirectory, { recursive: true });
  try {
    const bytes = await readFile(file);
    if (bytes.length > MAX_JSON_BYTES) throw new Error('large');
    const saved = JSON.parse(bytes.toString('utf8'));
    if (saved.version === 1 && /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.hostId) && Array.isArray(saved.registrations)) {
      config.hostId = saved.hostId;
      config.registrations = saved.registrations.filter(record => record && clientId(record.clientId) && safeLabel(record.subject) && typeof record.encryptedCredentials !== 'object').slice(0, 20).map(record => ({ clientId: record.clientId, subject: record.subject, email: safeLabel(record.email), model: safeLabel(record.model), ...(typeof record.encryptedCredentials === 'string' && record.encryptedCredentials.length <= 500000 ? { encryptedCredentials: record.encryptedCredentials } : {}) }));
      config.activeId = config.registrations.some(record => record.clientId === saved.activeId) ? saved.activeId : '';
    }
  } catch { /* Missing or damaged storage is never used as plaintext credentials. */ }
  for (const record of config.registrations) {
    if (!record.encryptedCredentials || !secure()) continue;
    try {
      const tokens = JSON.parse(await secureStorage.decryptString(Buffer.from(record.encryptedCredentials, 'base64')));
      if (!secret(tokens.accessToken) || !secret(tokens.refreshToken) || !secret(tokens.idToken) || !Number.isFinite(tokens.expiresAt) || !Array.isArray(tokens.scopes) || tokens.scopes.some(scope => typeof scope !== 'string')) throw new Error('invalid');
      credentials.set(record.clientId, tokens);
    } catch { detail = 'The saved ChatGPT connection could not be unlocked. Continue with ChatGPT again.'; }
  }
  if (current()) detail = current().scopes.includes(DIRECT_SCOPE) ? 'Connected with your ChatGPT subscription.' : 'Signed in. ChatGPT plan access was not granted; continue with ChatGPT to enable it.';
  await persist(); // Persist the stable host before opening any authorization attempt.

  async function request(url, options, consume, { signal, timeoutMs = authTimeoutMs } = {}) {
    if (signal?.aborted) throw stopped();
    const controller = new AbortController(); requests.add(controller);
    let timedOut = false, rejectStop;
    const interruption = new Promise((_resolve, reject) => { rejectStop = reject; });
    const abort = () => controller.abort();
    const abortRequest = () => rejectStop(stopped());
    controller.signal.addEventListener('abort', abortRequest, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs); timer.unref?.();
    const work = (async () => {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        let code = '';
        try { const data = await readJSON(response, controller.signal); const candidate = data?.error?.code || data?.error; if (typeof candidate === 'string' && /^[a-z0-9_]{1,100}$/.test(candidate)) code = candidate; } catch { /* Remote errors are deliberately not surfaced. */ }
        throw new HTTPError(response.status, code);
      }
      return consume(response, controller.signal);
    })();
    try { return await Promise.race([work, interruption]); }
    catch (error) {
      if (signal?.aborted) throw stopped();
      if (timedOut) throw new ConnectionError('ChatGPT took too long to respond. Try again.');
      if (controller.signal.aborted) throw stopped();
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError('Could not complete the ChatGPT request. Check your connection and try again.');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', abortRequest);
      controller.abort(); requests.delete(controller);
    }
  }
  async function readJSON(response, signal) {
    if (!response.body?.getReader) throw new ConnectionError('ChatGPT returned an unreadable response.');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_JSON_BYTES) throw new ConnectionError('ChatGPT returned an oversized response.'); chunks.push(Buffer.from(value)); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const jsonRequest = (url, options = {}, settings = {}) => request(url, options, readJSON, settings);
  async function discovery(signal) {
    if (discoveryCache) return discoveryCache;
    const result = await jsonRequest(DISCOVERY, {}, { signal });
    if (result?.issuer !== ISSUER || result.authorization_endpoint !== AUTHORIZE || result.token_endpoint !== TOKEN || result.jwks_uri !== JWKS) throw new ConnectionError('The ChatGPT sign-in configuration could not be verified.');
    discoveryCache = result; return result;
  }
  async function verifyIdentity(idToken, issuedId, nonce, signal) {
    await discovery(signal);
    async function keys(force) {
      if (force || !jwksCache || jwksCache.expiresAt <= now()) {
        const result = await jsonRequest(JWKS, {}, { signal });
        if (!Array.isArray(result?.keys) || result.keys.length > 100) throw new ConnectionError('ChatGPT identity could not be verified.');
        jwksCache = { resolver: createLocalJWKSet(result), expiresAt: now() + 60 * 60 * 1000 };
      }
      return jwksCache.resolver;
    }
    const options = { issuer: ISSUER, audience: issuedId, requiredClaims: ['sub', 'exp', 'iat'], currentDate: new Date(now()), clockTolerance: 5, algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'] };
    let payload;
    try {
      try { ({ payload } = await jwtVerify(idToken, await keys(false), options)); }
      catch (error) { if (error.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error; ({ payload } = await jwtVerify(idToken, await keys(true), options)); }
      if (!safeLabel(payload.sub).trim() || !Number.isFinite(payload.iat) || nonce !== undefined && !same(payload.nonce, nonce) || payload.iat > now() / 1000 + 5 || payload.sid !== undefined && (typeof payload.sid !== 'string' || !payload.sid.trim())) throw new Error('invalid identity');
    } catch { throw new ConnectionError('ChatGPT identity could not be verified. Continue with ChatGPT again.'); }
    return payload;
  }
  async function parseTokens(result, previous, nonce, issuedId, signal) {
    if (!result || !secret(result.access_token) || !secret(result.refresh_token) || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 86400 || result.token_type?.toLowerCase() !== 'bearer') throw new ConnectionError('ChatGPT returned an incomplete sign-in. Continue with ChatGPT again.');
    const idToken = result.id_token ?? previous?.idToken;
    if (!secret(idToken)) throw new ConnectionError('ChatGPT returned no account identity. Continue with ChatGPT again.');
    const identity = result.id_token ? await verifyIdentity(idToken, issuedId, nonce, signal) : null;
    if (!previous && !identity) throw new ConnectionError('ChatGPT identity could not be verified.');
    if (typeof result.scope !== 'string' && !previous) throw new ConnectionError('ChatGPT did not confirm the granted permissions. Continue with ChatGPT again.');
    const scopes = typeof result.scope === 'string' ? [...new Set(result.scope.split(/\s+/).filter(Boolean))] : previous.scopes;
    return { identity, tokens: { accessToken: result.access_token, refreshToken: result.refresh_token, idToken, scopes, expiresAt: now() + result.expires_in * 1000 } };
  }
  async function saveTokens(record, tokens, valid = () => !disposed, stage = () => {}) {
    let encryptedCredentials;
    if (secure()) {
      try { encryptedCredentials = Buffer.from(await secureStorage.encryptString(JSON.stringify(tokens))).toString('base64'); }
      catch { throw new ConnectionError('The ChatGPT connection could not be saved securely. Try again.'); }
    }
    if (!valid()) throw stopped();
    stage();
    const next = { ...record }; delete next.encryptedCredentials;
    if (encryptedCredentials) next.encryptedCredentials = encryptedCredentials;
    const index = config.registrations.findIndex(item => item.clientId === record.clientId);
    if (index < 0) config.registrations.push(next); else config.registrations[index] = next;
    credentials.set(record.clientId, tokens);
    await persist();
    if (!encryptedCredentials) notice('ChatGPT is connected for this app session. Secure storage is unavailable on this device.');
    return next;
  }
  function closeAttempt(attempt) {
    clearTimeout(attempt.timer); attempt.controller.abort();
    attempt.server.close(); attempt.server.closeAllConnections?.();
    for (const socket of attempt.sockets) socket.destroy();
    attempt.sockets.clear();
  }
  function finishAttempt(attempt, message, successful = false) {
    closeAttempt(attempt);
    if (pending === attempt) {
      if (!successful && attempt.rollback) attempt.rollback();
      pending = null; detail = message; notify();
    }
  }
  function cancelLogin() {
    generation += 1;
    if (pending) finishAttempt(pending, current() ? 'Sign-in cancelled. Your current ChatGPT connection is available.' : 'Sign-in cancelled. Continue with ChatGPT when ready.');
    return status();
  }
  async function startLogin({ newAccount = false } = {}) {
    alive();
    if (starting || pending) throw new ConnectionError('A ChatGPT sign-in is already open. Complete it or cancel it first.');
    starting = true;
    const epoch = generation, selected = newAccount ? null : active() || retryRegistration;
    const attempt = { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier: randomBytes(64).toString('base64url'), issuedId: selected?.clientId || '', selected, consumed: false, expiresAt: now() + loginTimeoutMs, controller: new AbortController(), sockets: new Set() };
    const browserReply = (response, code, text) => { response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'", Connection: 'close' }); response.end(text); };
    attempt.server = createServer((req, res) => {
      void (async () => {
        if (pending !== attempt || attempt.consumed || now() >= attempt.expiresAt) { browserReply(res, 400, 'This sign-in has expired. Return to Aphelion OS and try again.'); return; }
        let callback;
        try { callback = new URL(req.url, attempt.redirectUri); } catch { browserReply(res, 400, 'Invalid sign-in callback.'); return; }
        if (req.method !== 'GET' || callback.pathname !== '/auth/callback') { browserReply(res, 404, 'Not found.'); return; }
        attempt.consumed = true;
        if (!same(callback.searchParams.get('state'), attempt.state) || callback.searchParams.getAll('state').length !== 1) { browserReply(res, 400, 'Sign-in could not be verified. Return to Aphelion OS and try again.'); finishAttempt(attempt, 'ChatGPT sign-in could not be verified. Try again.'); return; }
        if (callback.searchParams.has('error')) { browserReply(res, 400, 'Sign-in was not completed. Return to Aphelion OS.'); finishAttempt(attempt, 'ChatGPT sign-in was not completed. Continue with ChatGPT to try again.'); return; }
        const returnedId = callback.searchParams.get('client_id'), code = callback.searchParams.get('code');
        if (!secret(code) || callback.searchParams.getAll('code').length !== 1 || callback.searchParams.getAll('client_id').length > 1 || attempt.issuedId && callback.searchParams.has('client_id') && returnedId !== attempt.issuedId || !attempt.issuedId && !clientId(returnedId)) { browserReply(res, 400, 'Sign-in registration could not be verified. Return to Aphelion OS.'); finishAttempt(attempt, 'ChatGPT sign-in registration was incomplete. Try again.'); return; }
        attempt.issuedId ||= returnedId;
        browserReply(res, 200, 'ChatGPT sign-in received. You can return to Aphelion OS.');
        const result = await jsonRequest(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: attempt.issuedId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }) }, { signal: attempt.controller.signal });
        const { identity, tokens } = await parseTokens(result, null, attempt.nonce, attempt.issuedId, attempt.controller.signal);
        if (attempt.selected?.subject && attempt.selected.subject !== identity.sub) throw new ConnectionError('This ChatGPT account does not match the selected connection. Add it as another account.');
        const existing = config.registrations.find(item => item.clientId === attempt.issuedId);
        if (existing && existing.subject !== identity.sub) throw new ConnectionError('This ChatGPT registration belongs to another account. Continue with ChatGPT again.');
        if (pending !== attempt || epoch !== generation || disposed) throw stopped();
        const record = { clientId: attempt.issuedId, subject: identity.sub, email: safeLabel(identity.email), model: attempt.selected?.model || '' };
        await saveTokens(record, tokens, () => pending === attempt && epoch === generation && !disposed, () => {
          const oldRecord = config.registrations.find(item => item.clientId === record.clientId), oldTokens = credentials.get(record.clientId), oldActive = config.activeId;
          attempt.rollback = () => {
            const index = config.registrations.findIndex(item => item.clientId === record.clientId);
            if (oldRecord && index >= 0) config.registrations[index] = oldRecord;
            else if (index >= 0) config.registrations.splice(index, 1);
            if (oldTokens) credentials.set(record.clientId, oldTokens); else credentials.delete(record.clientId);
            config.activeId = oldActive;
            void persist().catch(() => notice('The cancelled ChatGPT sign-in could not be removed from storage. Disconnect ChatGPT and try again.'));
          };
        });
        if (pending !== attempt || epoch !== generation || disposed) return;
        // A newly validated sign-in is a different renewable session even when
        // it uses the same issued client ID. Older refreshes must not commit.
        for (const controller of requests) controller.abort();
        generation += 1;
        config.activeId = record.clientId; await persist(); catalogs.delete(record.clientId);
        retryRegistration = null;
        finishAttempt(attempt, tokens.scopes.includes(DIRECT_SCOPE) ? 'Connected with your ChatGPT subscription.' : 'Signed in. ChatGPT plan access was not granted; continue with ChatGPT to enable it.', true);
      })().catch(error => {
        if (pending !== attempt) return;
        if (error instanceof HTTPError && error.code === 'invalid_grant' && !attempt.selected?.subject) retryRegistration = { clientId: attempt.issuedId };
        finishAttempt(attempt, error instanceof ConnectionError ? error.message : 'ChatGPT sign-in could not be completed. Try again.');
      });
    });
    attempt.server.on('connection', socket => { attempt.sockets.add(socket); socket.on('close', () => attempt.sockets.delete(socket)); });
    attempt.server.requestTimeout = Math.min(loginTimeoutMs, 10000); attempt.server.headersTimeout = Math.min(loginTimeoutMs, 10000); attempt.server.maxConnections = 8;
    try {
      await new Promise((resolve, reject) => { attempt.server.once('error', reject); attempt.server.listen(0, '127.0.0.1', () => { attempt.server.removeListener('error', reject); resolve(); }); });
      attempt.server.on('error', () => { if (pending === attempt) finishAttempt(attempt, 'ChatGPT sign-in could not continue. Try again.'); });
      if (disposed || epoch !== generation) { closeAttempt(attempt); throw stopped(); }
      attempt.redirectUri = `http://127.0.0.1:${attempt.server.address().port}/auth/callback`;
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({ client_id: attempt.issuedId || DYNAMIC_CLIENT, ...(attempt.issuedId ? {} : { agent_name_hint: APP_NAME }), ext_agent_host_id: config.hostId, response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'), ...(attempt.issuedId && credentials.get(attempt.issuedId)?.idToken ? { id_token_hint: credentials.get(attempt.issuedId).idToken } : {}), ...(attempt.selected?.email ? { login_hint: attempt.selected.email } : {}) }).toString();
      pending = attempt;
      attempt.timer = setTimeout(() => finishAttempt(attempt, 'ChatGPT sign-in expired. Continue with ChatGPT to try again.'), loginTimeoutMs); attempt.timer.unref?.();
      detail = 'Finish signing in with ChatGPT in your browser.';
      return { authorizationUrl: url.toString(), expiresAt: attempt.expiresAt };
    } catch (error) {
      closeAttempt(attempt);
      if (error?.name === 'AbortError') throw error;
      throw new ConnectionError('The local ChatGPT sign-in window could not open. Try again.');
    } finally { starting = false; notify(); }
  }
  async function token(signal) {
    alive();
    if (signal?.aborted) throw stopped();
    const record = active(), saved = current();
    if (!record || !saved) throw new ConnectionError('Continue with ChatGPT in Connections before using your subscription.');
    if (!saved.scopes.includes(DIRECT_SCOPE)) throw new ConnectionError('ChatGPT plan access was not granted. Continue with ChatGPT to enable it.');
    if (saved.expiresAt > now() + 60000) return saved.accessToken;
    if (!refreshPromise) {
      const epoch = generation;
      refreshPromise = (async () => {
        let expectedCredentials = saved;
        try {
          const result = await jsonRequest(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: record.clientId, refresh_token: saved.refreshToken, resource: RESOURCE }) });
          const { identity, tokens } = await parseTokens(result, saved, undefined, record.clientId);
          if (identity && identity.sub !== record.subject) throw new ConnectionError('The refreshed ChatGPT account could not be verified. Continue with ChatGPT again.');
          if (epoch !== generation || disposed || config.activeId !== record.clientId || credentials.get(record.clientId) !== saved) throw stopped();
          await saveTokens(record, tokens, () => epoch === generation && !disposed && config.activeId === record.clientId && credentials.get(record.clientId) === saved, () => { expectedCredentials = tokens; });
          if (epoch !== generation || disposed || config.activeId !== record.clientId || credentials.get(record.clientId) !== tokens) throw stopped();
          if (!tokens.scopes.includes(DIRECT_SCOPE)) { detail = 'ChatGPT plan access is no longer enabled. Continue with ChatGPT to enable it.'; notify(); throw new ConnectionError(detail); }
          return tokens.accessToken;
        } catch (error) {
          if (epoch !== generation || disposed || config.activeId !== record.clientId || credentials.get(record.clientId) !== expectedCredentials) throw stopped();
          if (error instanceof HTTPError && TERMINAL_REFRESH_ERRORS.has(error.code) && epoch === generation) {
            credentials.delete(record.clientId); delete record.encryptedCredentials; catalogs.delete(record.clientId); await persist();
            if (epoch !== generation || disposed || config.activeId !== record.clientId || credentials.has(record.clientId)) throw stopped();
            detail = 'Your ChatGPT session has ended. Continue with ChatGPT again.'; notify(); throw new ConnectionError(detail);
          }
          throw error;
        }
      })().finally(() => { refreshPromise = null; });
    }
    if (!signal) return refreshPromise;
    if (signal.aborted) throw stopped();
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(stopped()); };
      signal.addEventListener('abort', abort, { once: true });
      refreshPromise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  async function models({ signal } = {}) {
    const id = config.activeId, accessToken = await token(signal);
    if (id !== config.activeId || disposed) throw stopped();
    const result = await jsonRequest(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${accessToken}` } }, { signal });
    if (!Array.isArray(result?.models)) throw new ConnectionError('ChatGPT returned no model catalog. Try again.');
    const available = result.models.filter(model => model?.visibility === 'list' && typeof model.slug === 'string' && /^[\w./:-]{1,100}$/.test(model.slug) && safeLabel(model.display_name)).map(({ slug, display_name, visibility }) => ({ slug, display_name, visibility }));
    if (!available.length) throw new ConnectionError('This ChatGPT account has no available text models. Check ChatGPT plan access.');
    if (id !== config.activeId || disposed) throw stopped();
    catalogs.set(id, { models: available, expiresAt: now() + 300000 });
    if (!available.some(model => model.slug === active().model)) { active().model = available[0].slug; await persist(); notify(); }
    return available;
  }
  async function chat(messages, { signal, onDelta = () => {}, model } = {}) {
    const input = validateOpenAIMessages(messages);
    if (signal?.aborted) throw stopped();
    const id = config.activeId;
    let catalog = catalogs.get(config.activeId);
    if (!catalog || catalog.expiresAt <= now()) { await models({ signal }); catalog = catalogs.get(config.activeId); }
    const selected = model || active()?.model || catalog.models[0].slug;
    if (!catalog.models.some(item => item.slug === selected)) throw new ConnectionError('Choose a model available to this ChatGPT account.');
    const accessToken = await token(signal);
    if (id !== config.activeId || disposed) throw stopped();
    return request(`${RESOURCE}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ model: selected, input, store: false, stream: true }) }, async (response, requestSignal) => {
      if (!response.body?.getReader) throw new ConnectionError('ChatGPT returned no response stream.');
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
      const abort = () => { void reader.cancel().catch(() => {}); };
      requestSignal.addEventListener('abort', abort, { once: true });
      let buffer = '', data = [], text = '', completed = false, bytes = 0;
      function event() {
        if (!data.length) return;
        const raw = data.join('\n'); data = [];
        if (raw === '[DONE]') return;
        let payload; try { payload = JSON.parse(raw); } catch { throw new ConnectionError('ChatGPT returned an unreadable response stream.'); }
        if (payload.type === 'response.failed' || payload.type === 'response.incomplete' || payload.type === 'error') {
          const code = payload.response?.error?.code || payload.error?.code || payload.code;
          if (code === 'subscription_sharing_usage_limit_exceeded' || code === 'subscription_sharing_usage_unavailable') throw new ConnectionError('Your ChatGPT usage limit was reached. Try again later or review ChatGPT Settings → Usage.');
          throw new ConnectionError('ChatGPT could not complete this reply. Try again.');
        }
        if (payload.type === 'response.output_text.delta') {
          if (typeof payload.delta !== 'string' || completed) throw new ConnectionError('ChatGPT returned an invalid response stream.');
          text += payload.delta; if (text.length > MAX_TEXT_BYTES) throw new ConnectionError('The ChatGPT reply was too large. Try a shorter request.');
          onDelta(payload.delta);
        }
        if (payload.type === 'response.completed') {
          if (payload.response?.error || payload.response?.status && payload.response.status !== 'completed') throw new ConnectionError('ChatGPT could not complete this reply. Try again.');
          completed = true;
          if (!text && Array.isArray(payload.response?.output)) {
            text = payload.response.output.filter(item => item?.role === 'assistant' && item.type === 'message').flatMap(item => item.content || []).filter(item => item?.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('\n');
            if (text) onDelta(text);
          }
        }
      }
      function lines(final = false) {
        let newline;
        while ((newline = buffer.search(/\r\n|\n|\r/)) >= 0) {
          if (!final && buffer[newline] === '\r' && newline === buffer.length - 1) break;
          const line = buffer.slice(0, newline), length = buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1;
          buffer = buffer.slice(newline + length);
          if (!line) event(); else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (final) { if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, '')); buffer = ''; event(); }
      }
      try {
        while (true) {
          if (requestSignal.aborted) throw stopped();
          const { done, value } = await reader.read();
          if (done) { buffer += decoder.decode(); lines(true); break; }
          bytes += value.byteLength; if (bytes > MAX_TEXT_BYTES * 2) throw new ConnectionError('The ChatGPT reply was too large. Try a shorter request.');
          buffer += decoder.decode(value, { stream: true }); lines();
          if (completed) break;
        }
        if (requestSignal.aborted) throw stopped();
        if (!completed) throw new ConnectionError('ChatGPT stopped before completing this reply. Try again.');
        if (!text.trim()) throw new ConnectionError('ChatGPT returned no text. Try another request.');
        return { text, model: selected };
      } finally { requestSignal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }, { signal, timeoutMs: requestTimeoutMs });
  }
  async function disconnect() {
    alive(); cancelLogin();
    const epoch = generation;
    for (const controller of requests) controller.abort();
    const record = active(), refreshToken = current()?.refreshToken;
    credentials.clear(); catalogs.clear();
    for (const registration of config.registrations) delete registration.encryptedCredentials;
    detail = 'Disconnected from ChatGPT.'; await persist(); notify();
    if (refreshToken && record) {
      try {
        const metadata = await discovery();
        const endpoint = new URL(metadata.revocation_endpoint);
        if (endpoint.origin !== ISSUER || endpoint.username || endpoint.password) throw new Error('invalid endpoint');
        await request(endpoint.toString(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: record.clientId }) }, async response => { await response.body?.cancel().catch(() => {}); }, { timeoutMs: Math.min(authTimeoutMs, 5000) });
      } catch { if (epoch === generation && !disposed) { detail = 'Signed out locally. Remote revocation was not confirmed; disconnect Aphelion OS in ChatGPT Settings if needed.'; notify(); } }
    }
    return status();
  }
  function dispose() {
    if (disposed) return;
    cancelLogin(); disposed = true;
    for (const controller of requests) controller.abort();
    requests.clear(); credentials.clear(); catalogs.clear();
  }
  return { status, startLogin, cancelLogin, disconnect, models, chat, dispose };
}
