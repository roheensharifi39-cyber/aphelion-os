import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { childEnvironment, findCLI, inspectSubscription } from './subscriptions.mjs';

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_EVENT_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024 * 1024;
const PNG_HEADER = Buffer.from('89504e470d0a1a0a', 'hex');
const DISABLED_FEATURES = ['shell_tool', 'apps', 'plugins', 'multi_agent', 'view_image', 'browser_use', 'computer_use'];
const CLIENT_ARGS = ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', '--enable', 'image_generation', ...DISABLED_FEATURES.flatMap(feature => ['--disable', feature])];

function stopped() { return new DOMException('Stopped', 'AbortError'); }
function inside(root, file) {
  const path = relative(root, file);
  return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}
function clientError(error) {
  const text = String(error?.message || '');
  if (/usage|quota|rate.limit/i.test(text)) return new Error('Your Codex image generation usage limit was reached. Try again after it resets.');
  if (/unauthorized|authentication|not.logged.in|sign.in/i.test(text)) return new Error('Sign in to Codex with your ChatGPT subscription, then try again.');
  if (/method.not.found|unknown.method|not.supported|unsupported/i.test(text)) return new Error('This Codex client does not support native image generation. Update Codex and try again.');
  return new Error('Codex could not complete image generation. Check your connection, subscription access, and usage limits.');
}

// Wait for taskkill before removing a job folder; a cancelled native tool must
// not keep writing after its owning request has finished.
async function terminate(child) {
  try { child.stdin.destroy(); } catch { /* A failed spawn may already have closed stdin. */ }
  if (process.platform === 'win32' && Number.isSafeInteger(child.pid) && child.pid > 0) {
    await new Promise(resolveStop => execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolveStop()));
  } else {
    try {
      if (process.platform !== 'win32' && Number.isSafeInteger(child.pid) && child.pid > 0) process.kill(-child.pid, 'SIGTERM');
      else child.kill?.('SIGTERM');
    } catch { try { child.kill?.('SIGTERM'); } catch { /* The owned process has already exited. */ } }
  }
}

function withClient(spec, cwd, { signal, timeoutMs, onNotification = () => {}, onProcess = () => {} }, work) {
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise((resolveJob, rejectJob) => {
    let child;
    try { child = (spec.spawnImpl || spawn)(spec.command, [...spec.args, ...CLIENT_ARGS], { env: childEnvironment(spec), cwd, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { rejectJob(new Error('The Codex client could not start. Check its installation.')); return; }
    let buffer = '', stderr = '', nextId = 0, done = false;
    const requests = new Map();
    const timer = setTimeout(() => finish(new Error('Codex image generation timed out. Try again with a simpler prompt.')), timeoutMs);
    function send(value) { if (!done) child.stdin.write(`${JSON.stringify(value)}\n`); }
    function request(method, params) {
      if (done) return Promise.reject(stopped());
      return new Promise((resolveRequest, rejectRequest) => {
        const id = ++nextId; requests.set(id, { resolve: resolveRequest, reject: rejectRequest });
        send({ id, method, params });
      });
    }
    function finish(error, value) {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      for (const pending of requests.values()) pending.reject(error || stopped());
      requests.clear();
      terminate(child).finally(() => error ? rejectJob(error) : resolveJob(value));
    }
    function abort() { finish(stopped()); }
    function accept(raw) {
      if (!raw.trim()) return;
      let event;
      try { event = JSON.parse(raw); } catch { finish(new Error('Codex returned an unreadable image generation event. Update Codex and try again.')); return; }
      if (event.id !== undefined && requests.has(event.id)) {
        const pending = requests.get(event.id); requests.delete(event.id);
        event.error ? pending.reject(clientError(event.error)) : pending.resolve(event.result);
      } else if (event.id !== undefined && event.method) {
        // Image jobs never grant tool approvals or execute client-side tools.
        send({ id: event.id, error: { code: -32601, message: 'This image client does not execute additional tools.' } });
        finish(new Error('Codex requested an additional tool or approval. This image job can only use native image generation.'));
      } else if (event.method) {
        try { onNotification(event); } catch (error) { finish(error); }
      }
    }
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (done) return;
      buffer += chunk;
      let newline;
      while (!done && (newline = buffer.indexOf('\n')) !== -1) {
        if (newline > MAX_EVENT_BYTES) { finish(new Error('Codex returned an oversized image generation event.')); return; }
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); accept(line);
      }
      if (buffer.length > MAX_EVENT_BYTES) finish(new Error('Codex returned an oversized image generation event.'));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
    child.stdin.on('error', () => { if (!done) finish(new Error('The Codex connection closed before image generation completed.')); });
    child.on('error', () => finish(new Error('The Codex client could not start. Check its installation.')));
    child.on('close', () => { if (!done) finish(clientError({ message: stderr })); });
    try { onProcess(child.pid, 'codex'); } catch (error) { finish(error); return; }
    if (signal.aborted) { abort(); return; }
    (async () => {
      await request('initialize', { clientInfo: { name: 'aphelion_os_images', version: '0.2.0' }, capabilities: { experimentalApi: true } });
      send({ method: 'initialized' });
      return work({ request });
    })().then(value => finish(null, value), finish);
  });
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function validPNG(bytes) {
  if (bytes.length < 57 || bytes.length > MAX_IMAGE_BYTES || !bytes.subarray(0, 8).equals(PNG_HEADER)) return false;
  let offset = 8, hasData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) return false;
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset === 8 && (kind !== 'IHDR' || length !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12))) return false;
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end - 4; index++) crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) return false;
    if (kind === 'IDAT') hasData = true;
    if (kind === 'IEND') return length === 0 && end === bytes.length && hasData;
    offset = end;
  }
  return false;
}

async function readJobPNG(directory, savedPath) {
  if (typeof savedPath !== 'string' || !isAbsolute(savedPath) || !inside(directory, resolve(savedPath))) throw new Error('Codex returned an image path outside this generation job. Try again.');
  const file = resolve(savedPath), root = await realpath(directory);
  let segment = directory;
  for (const part of relative(directory, file).split(sep)) {
    segment = join(segment, part);
    if ((await lstat(segment)).isSymbolicLink()) throw new Error('Codex returned an unsafe image path. Try again.');
  }
  if (!inside(root, await realpath(file))) throw new Error('Codex returned an image path outside this generation job. Try again.');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_IMAGE_BYTES || info.size < 57) throw new Error('Codex returned no valid PNG image below 24 MB. Try again.');
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0, count;
    while (length < bytes.length && (count = (await handle.read(bytes, length, bytes.length - length, length)).bytesRead)) length += count;
    const after = await handle.stat();
    if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('The generated image changed before it could be read. Try again.');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

export function createCodexImageService({ dataDirectory, getCliImpl = findCLI, spawnImpl, inspectImpl = inspectSubscription, timeoutMs = 300000 } = {}) {
  if (typeof dataDirectory !== 'string' || !isAbsolute(dataDirectory)) throw new Error('Codex image generation needs an absolute app data folder.');
  const controllers = new Set();
  let disposed = false, cached, checking;
  // Keep the process boundary injectable without replacing authentication or
  // loading private OAuth files into this application.
  const launch = spawnImpl || spawn;
  async function session(spec, cwd, options, work) {
    return withClient({ ...spec, spawnImpl: launch }, cwd, options, work);
  }
  async function owned(signal, work) {
    if (disposed || signal?.aborted) throw stopped();
    const controller = new AbortController(); controllers.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try { return await work(controller.signal); }
    finally { signal?.removeEventListener('abort', abort); controllers.delete(controller); }
  }
  async function connection() {
    const spec = await getCliImpl('codex');
    if (!spec) return { detail: 'Install Codex CLI and sign in with your ChatGPT subscription to generate images.' };
    const auth = await inspectImpl('codex', { getCliImpl });
    if (!auth.signedIn || auth.mode !== 'subscription') return { detail: auth.mode === 'api-key' ? 'Codex is using API authentication. Sign in with your ChatGPT subscription for subscription image generation.' : 'Sign in to Codex with your ChatGPT subscription to generate images.' };
    return { spec };
  }
  async function status() {
    if (disposed) return { connected: false, available: false, detail: 'Codex image generation is closed.' };
    if (cached && Date.now() - cached.time < 15000) return { ...cached.value };
    if (!checking) checking = owned(null, async signal => {
      const { spec, detail } = await connection();
      if (!spec) return { connected: false, available: false, detail };
      try {
        await mkdir(dataDirectory, { recursive: true });
        const capable = await session(spec, dataDirectory, { signal, timeoutMs: Math.min(timeoutMs, 15000) }, client => client.request('modelProvider/capabilities/read', {}));
        return { connected: true, available: capable?.imageGeneration === true, detail: capable?.imageGeneration === true ? 'Codex image generation is ready through your ChatGPT subscription.' : 'Native image generation is unavailable in this Codex client. Update Codex and check your account access.' };
      } catch (error) { return { connected: true, available: false, detail: error.name === 'AbortError' ? 'Codex image generation is closed.' : error.message }; }
    }).catch(() => ({ connected: false, available: false, detail: 'Could not check Codex image generation. Check the Codex installation and ChatGPT sign-in.' })).then(value => { cached = { time: Date.now(), value }; return { ...value }; }).finally(() => { checking = null; });
    return checking;
  }
  async function image(prompt, { signal, onDelta = () => {}, onProcess = () => {} } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) throw new Error('Describe an image below 32,000 characters.');
    return owned(signal, async ownedSignal => {
      const { spec, detail } = await connection();
      if (!spec) throw new Error(detail);
      if (ownedSignal.aborted) throw stopped();
      const jobs = join(dataDirectory, 'codex-image-jobs'); await mkdir(jobs, { recursive: true });
      const directory = await mkdtemp(join(jobs, 'generation-'));
      let threadId, turnId, generated, finishTurn;
      const completed = new Promise((resolveTurn, rejectTurn) => { finishTurn = { resolve: resolveTurn, reject: rejectTurn }; });
      // A process failure before turn/start must not leave an unobserved promise.
      completed.catch(() => {});
      try {
        const output = await session(spec, directory, {
          signal: ownedSignal, timeoutMs, onProcess,
          onNotification(event) {
            const params = event.params;
            if (!threadId || params?.threadId !== threadId || turnId && params.turnId && params.turnId !== turnId) return;
            if (event.method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall'].includes(params.item?.type)) throw new Error('Codex requested an additional tool. This image job can only use native image generation.');
            if (event.method === 'item/started' && params.item?.type === 'imageGeneration') onDelta('Generating image with your Codex subscription…');
            if (event.method === 'item/completed' && params.item?.type === 'imageGeneration') generated = params.item;
            if (event.method === 'turn/completed') {
              if (turnId && params.turn?.id !== turnId) return;
              if (params.turn?.status !== 'completed') finishTurn.reject(clientError(params.turn?.error));
              else finishTurn.resolve(generated || params.turn.items?.find(item => item.type === 'imageGeneration'));
            }
          },
        }, async client => {
          const capabilities = await client.request('modelProvider/capabilities/read', {});
          if (capabilities?.imageGeneration !== true) throw new Error('Native image generation is unavailable in this Codex client. Update Codex and check your account access.');
          const settings = await client.request('config/read', { cwd: directory, includeLayers: false });
          const mcp = settings?.config?.mcp_servers || {};
          const config = { mcp_servers: Object.fromEntries(Object.keys(mcp).map(name => [name, { enabled: false }])), web_search: 'disabled', ...Object.fromEntries(DISABLED_FEATURES.map(feature => [`features.${feature}`, false])) };
          const start = await client.request('thread/start', { cwd: directory, ephemeral: true, approvalPolicy: 'never', sandbox: 'workspace-write', modelProvider: 'openai', config, developerInstructions: 'Generate exactly one raster PNG using the built-in image generation tool. Use the user text only as the visual description. Do not execute commands, use MCP/apps, access unrelated files, or call paid API fallbacks. Do not substitute SVG, HTML, screenshots, or a text description. Save output inside the current job directory if the native tool supports choosing a path.' });
          threadId = start?.thread?.id;
          if (typeof threadId !== 'string' || !threadId) throw new Error('Codex did not start an image generation session.');
          const turn = await client.request('turn/start', { threadId, input: [{ type: 'text', text: `Generate one image using native image generation. Visual description:\n${prompt.trim()}`, text_elements: [] }], sandboxPolicy: { type: 'workspaceWrite', writableRoots: [directory], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true } });
          turnId = turn?.turn?.id;
          return completed;
        });
        if (ownedSignal.aborted) throw stopped();
        if (output?.failure?.type === 'usageLimitExceeded') throw new Error('Your Codex image generation usage limit was reached. Try again after it resets.');
        if (!output || output.status !== 'completed') throw new Error('Codex returned no completed native image. Try a different prompt.');
        let bytes;
        if (typeof output.result === 'string' && output.result.length) {
          if (output.result.length > MAX_EVENT_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(output.result)) throw new Error('Codex returned no valid PNG image below 24 MB. Try again.');
          bytes = Buffer.from(output.result, 'base64');
          if (bytes.toString('base64') !== output.result) throw new Error('Codex returned no valid PNG image. Try again.');
        } else bytes = await readJobPNG(directory, output.savedPath);
        if (!validPNG(bytes)) throw new Error('Codex returned no valid PNG image below 24 MB. Try again.');
        if (ownedSignal.aborted) throw stopped();
        return { id: randomUUID(), src: `data:image/png;base64,${bytes.toString('base64')}`, prompt: prompt.trim(), created: new Date().toISOString() };
      } finally {
        if (!inside(resolve(jobs), resolve(directory))) throw new Error('The image job folder could not be safely cleaned up.');
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
  return { status, image, dispose() { disposed = true; cached = null; for (const controller of controllers) controller.abort(); } };
}
