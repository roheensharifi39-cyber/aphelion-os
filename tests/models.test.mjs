import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createModelCatalog, discoverModels, normalizeModels } from '../electron/models.mjs';

it('keeps only safe client model metadata and provider-supported effort levels', () => {
  expect(normalizeModels('claude', [{ value: 'default', displayName: 'Default', resolvedModel: 'claude-test', supportedEffortLevels: ['high', 'ultra', 'max'], account: 'private' }])).toEqual([{ id: 'auto', name: 'Default', description: '', resolved: 'claude-test', efforts: ['high', 'max'], defaultEffort: 'auto', isDefault: true }]);
  const models = normalizeModels('codex', [{ id: 'model-one', displayName: 'One', supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'unexpected' }] }, { id: 'secret-model', hidden: true }, { id: 'invalid;value' }]);
  expect(models.map(model => model.id)).toEqual(['model-one']);
  expect(models[0].efforts).toEqual(['high']);
});
it('discovers Codex choices through initialization and model/list without starting an inference turn', async () => {
  const calls = [];
  const spawnImpl = () => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on('data', bytes => {
      const request = JSON.parse(bytes.toString()); calls.push(request.method);
      if (request.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
      if (request.id === 2) child.stdout.write('{"id":2,"result":{"data":[{"model":"from-client","displayName":"Client model","supportedReasoningEfforts":[{"reasoningEffort":"xhigh"}],"isDefault":true}]}}\n');
    }); return child;
  };
  const result = await discoverModels('codex', { getCliImpl: async () => ({ command: 'codex', args: [] }), spawnImpl });
  expect(calls).toEqual(['initialize', 'initialized', 'model/list']);
  expect(result[0]).toMatchObject({ id: 'from-client', efforts: ['xhigh'] });
});
it('reports missing clients without inventing models', async () => {
  await expect(discoverModels('claude', { getCliImpl: async () => null })).rejects.toThrow(/Install/);
});
it('retries missing clients on refresh so newly installed choices are immediately available', async () => {
  let installed = false;
  const catalog = createModelCatalog({ getCliImpl: async agent => installed ? { command: agent, args: [] } : null, spawnImpl: agent => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on('data', bytes => {
      const request = JSON.parse(bytes.toString());
      if (agent === 'claude') child.stdout.write('{"type":"control_response","response":{"request_id":"catalog","response":{"models":[{"value":"sonnet","displayName":"Installed Claude","supportedEffortLevels":["high"]}]}}}\n');
      else if (request.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
      else if (request.id === 2) child.stdout.write('{"id":2,"result":{"data":[{"model":"installed-codex","displayName":"Installed Codex"}]}}\n');
    }); return child;
  } });
  expect((await catalog()).claude.error).toContain('Install');
  installed = true;
  const refreshed = await catalog();
  expect(refreshed.claude.models[0]?.id).toBe('sonnet');
  expect(refreshed.codex.models[0]?.id).toBe('installed-codex');
});
