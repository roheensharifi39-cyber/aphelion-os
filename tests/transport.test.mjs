import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { localRuntimePlugin } from '../server/local-runtime.mjs';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function engine() {
  let middleware, invocation = [], eventListener, deltaListener, disposed = false;
  const runtime = {
    methods: { runtime: async () => ({ heartbeat: 1, activeJobs: 0 }) },
    invoke: async (method, args) => { invocation.push({ method, args }); if (method !== 'project') throw new Error('This local engine action is unavailable.'); return { name: 'Real project' }; },
    onEvent: fn => { eventListener = fn; return () => { eventListener = null; }; },
    onDelta: fn => { deltaListener = fn; return () => { deltaListener = null; }; },
    dispose: () => { disposed = true; },
  };
  const server = createServer((req, res) => {
    req.url = req.url.replace(/^\/__aphelion/, '');
    void middleware(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await localRuntimePlugin({ runtimeFactory: async () => runtime }).configureServer({ config: { server: { port } }, httpServer: server, middlewares: { use: (_path, fn) => { middleware = fn; } } });
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${port}/__aphelion`;
  return { port, url, invocation, emit: event => eventListener?.(event), delta: event => deltaListener?.(event), disposed: () => disposed };
}
async function bootstrap(app) {
  const response = await fetch(`${app.url}/bootstrap`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, live: true });
  const header = response.headers.get('set-cookie');
  expect(header).toContain('HttpOnly; SameSite=Strict; Path=/__aphelion');
  return header.split(';')[0];
}
function rpc(app, cookie, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = request(`${app.url}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    client.on('error', reject); client.end(JSON.stringify(body));
  });
}

describe('live local transport', () => {
  it('requires the ephemeral session before any action and rejects cross-origin requests', async () => {
    const app = await engine();
    expect((await rpc(app, '', { method: 'project', args: [] })).status).toBe(401);
    const cookie = await bootstrap(app);
    for (const headers of [{ origin: 'https://untrusted.example' }, { 'sec-fetch-site': 'cross-site' }, { host: `untrusted.example:${app.port}` }]) {
      expect((await rpc(app, cookie, { method: 'project', args: [] }, headers)).status).toBe(403);
    }
    expect(app.invocation).toEqual([]);
    const response = await rpc(app, cookie, { method: 'project', args: [] }, { origin: `http://127.0.0.1:${app.port}` });
    expect(await response.json()).toEqual({ ok: true, result: { name: 'Real project' } });
    expect(app.invocation).toEqual([{ method: 'project', args: [] }]);
  });
  it('refuses malformed and unavailable calls without a successful result', async () => {
    const app = await engine(), cookie = await bootstrap(app);
    for (const body of [{ method: 'project', args: {} }, { method: 'project', args: [1, 2, 3, 4, 5] }, { method: '__proto__', args: [] }]) {
      const response = await rpc(app, cookie, body);
      expect(response.status).toBe(400);
      expect((await response.json()).ok).toBe(false);
    }
    expect(app.invocation).toEqual([{ method: '__proto__', args: [] }]);
  });
  it('streams a fresh snapshot plus actual events and closes the engine with the server', async () => {
    const app = await engine(), cookie = await bootstrap(app);
    let client, response;
    const chunks = [];
    await new Promise((resolve, reject) => {
      client = request(`${app.url}/events`, { headers: { cookie } }, res => {
        response = res;
        expect(res.headers['content-type']).toBe('text/event-stream');
        res.on('data', chunk => { chunks.push(chunk.toString()); if (chunks.join('').includes('heartbeat')) resolve(); });
      });
      client.on('error', reject); client.end();
    });
    app.emit({ id: 'actual', type: 'activity', text: 'Real command finished' });
    app.delta({ requestId: 'mission', delta: 'Live text' });
    await new Promise(resolve => { const timer = setTimeout(resolve, 500); response.on('data', () => { if (chunks.join('').includes('Live text')) { clearTimeout(timer); resolve(); } }); });
    const streamed = chunks.join('');
    expect(streamed).toContain('"channel":"runtime"');
    expect(streamed).toContain('Real command finished');
    expect(streamed).toContain('"channel":"delta"');
    expect(streamed).toContain('Live text');
    client.destroy();
    const close = cleanups.pop(); await close();
    expect(app.disposed()).toBe(true);
  });
});
