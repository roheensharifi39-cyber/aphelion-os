import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_OPENAI_MODEL = 'gpt-6-astra';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare';
const API_ROOT = 'https://api.openai.com/v1';
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const PNG_HEADER = Buffer.from('89504e470d0a1a0a', 'hex');

// Browser development has no Electron safeStorage. Windows DPAPI provides the
// same current-user protection without putting the key in command arguments.
export function platformSecureStorage() {
  if (process.platform !== 'win32') return null;
  async function transform(value, encrypting) {
    const operation = encrypting ? 'Protect' : 'Unprotect';
    const script = `Add-Type -AssemblyName System.Security; $value = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $result = [Security.Cryptography.ProtectedData]::${operation}($value, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const chunks = []; let size = 0, settled = false;
      const timer = setTimeout(() => { child.kill(); finish(new Error('Secure storage is unavailable.')); }, 10000); timer.unref?.();
      function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
      child.on('error', () => finish(new Error('Secure storage is unavailable.')));
      child.stdin.on('error', () => finish(new Error('Secure storage is unavailable.')));
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 20000) { child.kill(); finish(new Error('Secure storage is unavailable.')); } else chunks.push(chunk); });
      child.on('close', code => { if (code !== 0) finish(new Error('Secure storage is unavailable.')); else finish(null, Buffer.from(Buffer.concat(chunks).toString().trim(), 'base64')); });
      child.stdin.end(Buffer.from(value).toString('base64'));
    });
  }
  return { isEncryptionAvailable: () => true, encryptString: text => transform(Buffer.from(text, 'utf8'), true), decryptString: async bytes => (await transform(bytes, false)).toString('utf8') };
}

function modelId(value) {
  if (typeof value !== 'string' || !/^[\w./:-]{1,100}$/.test(value)) throw new Error('Enter a valid OpenAI model ID.');
  return value;
}
function apiKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\s\x00-\x1f\x7f]/.test(value.trim())) throw new Error('Enter a valid OpenAI API key.');
  return value.trim();
}
export function validateOpenAIMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 100 || messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 100000) || messages.reduce((length, message) => length + message.content.length, 0) > 300000 || messages.at(-1).role !== 'user') throw new Error('Provide a user prompt and up to 100 text messages below 300,000 characters.');
  return messages.map(({ role, content }) => ({ role, content }));
}

// Only these fields cross the bridge. Neither saved nor environment keys are
// returned to the renderer, telemetry, or activity history.
export async function createOpenAIService({ dataDirectory, env = process.env, fetchImpl = globalThis.fetch, secureStorage = platformSecureStorage(), requestTimeoutMs = 180000, imageTimeoutMs = 300000, onNotice = () => {} } = {}) {
  const file = join(dataDirectory, 'openai.json');
  let config = { model: DEFAULT_OPENAI_MODEL, imageModel: DEFAULT_IMAGE_MODEL }, savedKey = '', sessionKey = '', writing = Promise.resolve();
  const controllers = new Set();
  const secure = () => { try { return Boolean(secureStorage?.isEncryptionAvailable()) && secureStorage?.getSelectedStorageBackend?.() !== 'basic_text'; } catch { return false; } };
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved.model) config.model = modelId(saved.model);
    if (saved.imageModel) config.imageModel = modelId(saved.imageModel);
    if (typeof saved.encryptedApiKey === 'string' && saved.encryptedApiKey.length <= 20000) config.encryptedApiKey = saved.encryptedApiKey;
  } catch { /* Missing or damaged preferences never expose a stored secret. */ }
  if (config.encryptedApiKey && secure()) {
    try { savedKey = apiKey(await secureStorage.decryptString(Buffer.from(config.encryptedApiKey, 'base64'))); }
    catch { onNotice('The saved OpenAI connection could not be unlocked. Enter its API key again.'); }
  }
  const key = () => (typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '') || sessionKey || savedKey;
  const status = () => ({ configured: Boolean(key()), model: config.model, imageModel: config.imageModel });
  async function configure(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => !['apiKey', 'model', 'imageModel'].includes(name))) throw new Error('Only an OpenAI API key and model preferences are supported.');
    const update = { ...input };
    if (update.model !== undefined) modelId(update.model);
    if (update.imageModel !== undefined) modelId(update.imageModel);
    if (update.apiKey !== undefined && update.apiKey !== '') apiKey(update.apiKey);
    writing = writing.catch(() => {}).then(async () => {
      const next = { ...config }; let nextSavedKey = savedKey, nextSessionKey = sessionKey;
      if (update.model !== undefined) next.model = update.model;
      if (update.imageModel !== undefined) next.imageModel = update.imageModel;
      if (update.apiKey !== undefined) {
        nextSavedKey = ''; nextSessionKey = ''; delete next.encryptedApiKey;
        if (update.apiKey !== '') {
          const value = apiKey(update.apiKey);
          if (secure()) {
            try { next.encryptedApiKey = Buffer.from(await secureStorage.encryptString(value)).toString('base64'); nextSavedKey = value; }
            catch { throw new Error('The OpenAI API key could not be saved securely. Use OPENAI_API_KEY or try again.'); }
          } else { nextSessionKey = value; onNotice('OpenAI is connected for this app session. Secure storage is unavailable on this device.'); }
        }
      }
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
      finally { await unlink(temporary).catch(() => {}); }
      config = next; savedKey = nextSavedKey; sessionKey = nextSessionKey;
      return status();
    });
    return writing;
  }
  async function post(endpoint, body, signal, timeoutMs) {
    const credential = key();
    if (!credential) throw new Error('Connect OpenAI in Connections with an API key before using ChatGPT or image generation.');
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const controller = new AbortController(); controllers.add(controller);
    let timedOut = false, rejectStop;
    const stopped = new Promise((_resolve, reject) => { rejectStop = reject; });
    controller.signal.addEventListener('abort', () => rejectStop(new DOMException('Stopped', 'AbortError')), { once: true });
    function abort() { controller.abort(); rejectStop(new DOMException('Stopped', 'AbortError')); }
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectStop(new Error('OpenAI took too long to respond. Try again.')); }, timeoutMs); timer.unref?.();
    const work = (async () => {
      let response;
      try { response = await fetchImpl(`${API_ROOT}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' }); }
      catch { if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError'); throw new Error('Could not reach OpenAI. Check your internet connection and try again.'); }
      if (!response.ok) {
        // Do not echo server bodies; they may contain submitted prompts or keys.
        const errors = { 400: 'OpenAI could not accept this request. Check the selected model and prompt.', 401: 'OpenAI rejected this API key. Update it in Connections.', 403: 'Your OpenAI account does not have access to this model. Check its permissions.', 404: 'The selected OpenAI model is unavailable. Update the model in Connections.', 429: 'OpenAI usage or rate limit reached. Check your API billing and try again later.' };
        await response.body?.cancel?.().catch(() => {});
        throw new Error(errors[response.status] || `OpenAI is temporarily unavailable (HTTP ${Number.isInteger(response.status) ? response.status : 'error'}). Try again.`);
      }
      let payload;
      try {
        if (response.body?.getReader) {
          const reader = response.body.getReader(), chunks = []; let size = 0;
          try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_IMAGE_BYTES * 1.4) throw new Error('large'); chunks.push(Buffer.from(value)); } payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          finally { reader.releaseLock(); }
        } else payload = await response.json();
      } catch { throw new Error('OpenAI returned an unreadable response. Try again.'); }
      if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      return payload;
    })();
    try { return await Promise.race([work, stopped]); }
    catch (error) { if (signal?.aborted) throw new DOMException('Stopped', 'AbortError'); if (timedOut) throw new Error('OpenAI took too long to respond. Try again.'); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); controllers.delete(controller); }
  }
  async function chat(messages, { signal } = {}) {
    const input = validateOpenAIMessages(messages);
    const result = await post('responses', { model: config.model, input, store: false }, signal, requestTimeoutMs);
    if (!result || typeof result !== 'object' || result.error || result.status && result.status !== 'completed') throw new Error('OpenAI could not complete this reply. Try again.');
    const output = Array.isArray(result.output) ? result.output : [];
    const text = output.filter(item => item?.type === 'message' && item.role === 'assistant').flatMap(item => Array.isArray(item.content) ? item.content : []).filter(item => item?.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('\n');
    if (!text.trim()) {
      const refused = output.some(item => item?.type === 'message' && Array.isArray(item.content) && item.content.some(block => block?.type === 'refusal'));
      throw new Error(refused ? 'OpenAI declined this request. Try a different prompt.' : 'OpenAI returned no text. Try again.');
    }
    return { text };
  }
  async function image(prompt, { signal } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) throw new Error('Describe an image below 32,000 characters.');
    const result = await post('images/generations', { model: config.imageModel, prompt: prompt.trim(), n: 1, size: '1024x1024', output_format: 'png' }, signal, imageTimeoutMs);
    const encoded = result?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > MAX_IMAGE_BYTES * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('OpenAI returned no valid image. Try again.');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES || bytes.length < PNG_HEADER.length || !bytes.subarray(0, PNG_HEADER.length).equals(PNG_HEADER) || bytes.toString('base64') !== encoded) throw new Error('OpenAI returned no valid PNG image. Try again.');
    const timestamp = typeof result.created === 'number' && Number.isFinite(result.created) ? new Date(result.created * 1000) : new Date();
    return { id: randomUUID(), src: `data:image/png;base64,${encoded}`, prompt: prompt.trim(), created: Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString() };
  }
  return { status, configure, chat, image, dispose: () => { for (const controller of controllers) controller.abort(); controllers.clear(); sessionKey = ''; savedKey = ''; } };
}
