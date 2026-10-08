import { randomBytes } from 'node:crypto';
import { createRuntime } from '../electron/runtime.mjs';

export function localRuntimePlugin({ runtimeFactory = createRuntime } = {}) {
  return {
    name: 'aphelion-local-engine',
    async configureServer(server) {
      const sessions = new Set(), clients = new Set();
      const counters = { online: true, clients: 0, received: 0, sent: 0 };
      const cookieName = 'aphelion-local-session';
      const runtime = await runtimeFactory({ desktop: false, getNetwork: () => ({ ...counters, clients: clients.size }) });
      function write(client, payload) { if (client.destroyed || client.writableEnded) return; const text = `data: ${JSON.stringify(payload)}\n\n`; counters.sent += Buffer.byteLength(text); client.write(text); }
      const offEvent = runtime.onEvent(event => { for (const client of clients) write(client, { channel: 'runtime', event }); });
      const offDelta = runtime.onDelta(event => { for (const client of clients) write(client, { channel: 'delta', event }); });
      const port = server.config.server.port || 5173;
      function trusted(req) {
        if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return false;
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return false;
        return !req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']);
      }
      function authorized(req) { const match = new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]+)`).exec(req.headers.cookie || ''); return match && sessions.has(match[1]); }
      function json(res, status, data) { const body = JSON.stringify(data); counters.sent += Buffer.byteLength(body); res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); }
      server.middlewares.use('/__aphelion', async (req, res) => {
        try {
          if (!trusted(req)) { json(res, 403, { ok: false, error: 'Only this local command center can use the engine.' }); return; }
          const path = (req.url || '').split('?')[0];
          if (path === '/bootstrap' && req.method === 'GET') {
            if (sessions.size >= 100) sessions.clear();
            const token = randomBytes(24).toString('hex'); sessions.add(token);
            res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/__aphelion`);
            json(res, 200, { ok: true, live: true }); return;
          }
          if (!authorized(req)) { json(res, 401, { ok: false, error: 'Reconnect to the local engine.' }); return; }
          if (path === '/events' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
            res.write(': local-engine-connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
            const snapshot = await runtime.methods.runtime(); write(res, { channel: 'runtime', event: { id: 'connection', time: Date.now(), type: 'telemetry', source: 'system', data: snapshot } }); return;
          }
          if (path !== '/rpc' || req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) { json(res, 404, { ok: false, error: 'Unknown local engine route.' }); return; }
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; counters.received += chunk.length; if (size > 2000000) throw new Error('This request is too large.'); chunks.push(chunk); }
          const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof request.method !== 'string' || !Array.isArray(request.args) || request.args.length > 4) throw new Error('Invalid local engine request.');
          const result = await runtime.invoke(request.method, request.args); json(res, 200, { ok: true, result });
        } catch (error) { if (!res.headersSent) json(res, 400, { ok: false, error: error.message }); else res.end(); }
      });
      server.httpServer?.once('close', () => { counters.online = false; offEvent(); offDelta(); runtime.dispose(); for (const client of clients) client.end(); clients.clear(); });
    },
  };
}
