import { spawn } from 'node:child_process';
import { findCLI, childEnvironment, killOwnedProcess, validateReasoning } from './subscriptions.mjs';

export function normalizeModels(agent, entries) {
  if (!Array.isArray(entries)) throw new Error('The installed client did not return a model catalog.');
  return entries.filter(item => !item.hidden).map(item => {
    const id = agent === 'claude' ? item.value === 'default' ? 'auto' : item.value : item.model || item.id;
    if (typeof id !== 'string' || !/^[\w./:-]{1,100}$/.test(id)) return null;
    const efforts = (agent === 'claude' ? item.supportedEffortLevels || [] : (item.supportedReasoningEfforts || []).map(value => value.reasoningEffort)).filter(value => { try { validateReasoning(agent, value); return value !== 'auto'; } catch { return false; } });
    return { id, name: String(item.displayName || id).slice(0, 100), description: String(item.description || '').slice(0, 500), efforts: [...new Set(efforts)], defaultEffort: item.defaultReasoningEffort || 'auto', isDefault: agent === 'claude' ? id === 'auto' : !!item.isDefault, resolved: item.resolvedModel || id };
  }).filter(Boolean);
}

export async function discoverModels(agent, { getCliImpl = findCLI, spawnImpl = spawn, cwd, timeoutMs = 15000 } = {}) {
  const spec = await getCliImpl(agent);
  if (!spec) throw new Error(`Install ${agent === 'claude' ? 'Claude Code' : 'Codex'} to load its models.`);
  const args = agent === 'codex' ? ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"'] : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--setting-sources', '', '--settings', '{"disableAllHooks":true}'];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(spec.command, [...spec.args, ...args], { env: childEnvironment(spec), cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', done = false;
    const timer = setTimeout(() => finish(new Error('The model catalog timed out. Refresh the choices to retry.')), timeoutMs);
    function finish(error, models) { if (done) return; done = true; clearTimeout(timer); child.stdin.end(); killOwnedProcess(child); if (error) reject(error); else resolve(models); }
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdout.setEncoding('utf8'); child.stderr.resume();
    child.stdout.on('data', chunk => {
      if (done) return;
      buffer += chunk;
      if (buffer.length > 2000000) return finish(new Error('The client returned an oversized model catalog.'));
      let index;
      while (!done && (index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (agent === 'codex' && event.id === 1) {
            if (event.error) throw new Error('initialize');
            send({ method: 'initialized' }); send({ id: 2, method: 'model/list', params: { limit: 100, includeHidden: false } });
          } else if (agent === 'codex' && event.id === 2) finish(null, normalizeModels(agent, event.result?.data));
          else if (agent === 'claude' && event.type === 'control_response' && event.response?.request_id === 'catalog') finish(null, normalizeModels(agent, event.response.response?.models));
        } catch { finish(new Error('The installed client could not load its model choices.')); }
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('The installed subscription client could not start.')));
    child.on('close', () => { if (!done) finish(new Error('The subscription client closed before returning model choices.')); });
    send(agent === 'codex' ? { id: 1, method: 'initialize', params: { clientInfo: { name: 'aphelion_os', version: '0.2.0' }, capabilities: { experimentalApi: true } } } : { type: 'control_request', request_id: 'catalog', request: { subtype: 'initialize' } });
  });
}

export function createModelCatalog(options = {}) {
  const cached = new Map(), pending = new Map();
  return async () => Object.fromEntries(await Promise.all(['claude', 'codex'].map(async agent => {
    let entry = cached.get(agent);
    if (!entry || Date.now() - entry.time > 300000) {
      if (!pending.has(agent)) pending.set(agent, discoverModels(agent, options).then(models => ({ models })).catch(error => ({ models: [], error: error.message })).then(value => { const next = { time: Date.now(), value }; if (value.error) cached.delete(agent); else cached.set(agent, next); return next; }).finally(() => pending.delete(agent)));
      entry = await pending.get(agent);
    }
    return [agent, entry.value];
  })));
}
