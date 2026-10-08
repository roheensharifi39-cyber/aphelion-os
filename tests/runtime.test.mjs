import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createRuntime, missionSteps, validRequestId, missionHasEvidence } from '../electron/runtime.mjs';
import { createObsidianAdapter } from '../electron/obsidian.mjs';
describe('runtime mission boundaries', () => {
  it('uses separate phase stream IDs under one cancellable mission', () => {
    expect(missionSteps('job-one')).toEqual({ planning: 'job-one-claude', building: 'job-one-codex' });
    expect(validRequestId('job-one')).toBe(true);
    expect(validRequestId('../outside')).toBe(false);
    expect(validRequestId('a'.repeat(101))).toBe(false);
  });
  it('does not declare an unexecuted permission-blocked build complete', () => {
    expect(missionHasEvidence([], 0)).toBe(false);
    expect(missionHasEvidence(['src/app.mjs'], 0)).toBe(true);
    expect(missionHasEvidence([], 1)).toBe(true);
  });
});

const execute = promisify(execFile);
const authenticated = {
  connected: { claude: true, codex: true },
  auth: {
    claude: { installed: true, signedIn: true, mode: 'subscription', detail: 'Test boundary' },
    codex: { installed: true, signedIn: true, mode: 'subscription', detail: 'Test boundary' },
  },
};
const response = text => ({ text, demo: false, usage: { input: 0, output: 0 } });
let root, project, dataDirectory, engine, events, restorePermissions;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aphelion-runtime-test-'));
  project = join(root, 'project'); dataDirectory = join(root, 'engine');
  events = []; restorePermissions = [];
  await mkdir(project);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'mission-fixture', private: true, type: 'module', scripts: { test: 'node verify.mjs', build: 'node build.mjs' } }));
  await writeFile(join(project, 'source.mjs'), 'export const answer = 0;\n');
  await writeFile(join(project, 'verify.mjs'), 'import assert from "node:assert/strict"; import { answer } from "./source.mjs"; assert.equal(answer, 42); console.log("TEST: actual source is correct");\n');
  await writeFile(join(project, 'build.mjs'), 'import { mkdir, writeFile } from "node:fs/promises"; import { answer } from "./source.mjs"; await mkdir("dist", { recursive: true }); await writeFile("dist/result.json", JSON.stringify({ answer })); console.log("BUILD: real artifact written");\n');
});
afterEach(async () => {
  engine?.dispose(); engine = null;
  for (const restore of restorePermissions) await restore();
  const absolute = resolve(root);
  expect(absolute.startsWith(resolve(tmpdir()) + sep)).toBe(true);
  expect(basename(absolute).startsWith('aphelion-runtime-test-')).toBe(true);
  await rm(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

async function start(agentRunner = async (request, _config, options) => {
  if (request.agent === 'claude') return response('Inspect source, implement answer 42, then run tests and build.');
  await writeFile(join(options.cwd, 'source.mjs'), 'export const answer = 42;\n');
  return response('Updated the real source file.');
}) {
  const isolatedEnvironment = { ...process.env, APPDATA: join(root, 'metadata'), LOCALAPPDATA: join(root, 'metadata') };
  engine = await createRuntime({
    dataDirectory,
    selectFolder: async () => project,
    agentRunner,
    authProvider: async () => authenticated,
    // Exercise the actual vault watcher against our owned vault. Obsidian's
    // registered-vault metadata is redirected to the temporary fixture.
    obsidianFactory: options => createObsidianAdapter({ ...options, env: isolatedEnvironment }),
  });
  engine.onEvent(event => events.push(event));
  await engine.invoke('selectProject');
  return engine;
}
async function receiptPaths() {
  return (await engine.invoke('listNotes')).map(note => note.path).filter(path => path.startsWith('Mission '));
}
function waitForEvent(predicate) {
  return new Promise((resolveEvent, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error('Expected runtime event did not arrive.')); }, 15000);
    const off = engine.onEvent(event => { if (predicate(event)) { clearTimeout(timeout); off(); resolveEvent(event); } });
  });
}

describe('shared mission engine integration', () => {
  it('verifies real changes with actual npm recipes and saves an evidence-backed receipt', async () => {
    const calls = [];
    await start(async (request, _config, options) => {
      calls.push({ agent: request.agent, mode: request.mode, requestId: request.requestId, cwd: options.cwd });
      if (request.agent === 'claude') return response('Implement 42 and check the actual project.');
      await writeFile(join(options.cwd, 'source.mjs'), 'export const answer = 42;\n');
      return response('Source updated.');
    });
    const result = await engine.invoke('mission', [{ requestId: 'success-one', task: 'Implement answer 42' }]);
    expect(calls).toEqual([
      { agent: 'claude', mode: 'plan', requestId: 'success-one-claude', cwd: project },
      { agent: 'codex', mode: 'build', requestId: 'success-one-codex', cwd: project },
    ]);
    expect(await readFile(join(project, 'source.mjs'), 'utf8')).toContain('42');
    expect(JSON.parse(await readFile(join(project, 'dist', 'result.json'), 'utf8'))).toEqual({ answer: 42 });
    expect(await receiptPaths()).toEqual([result.receiptPath]);
    const receipt = await engine.invoke('readNote', [result.receiptPath]);
    expect(receipt.content).toContain('Changed files: source.mjs');
    expect(receipt.content).toContain('Run tests: exit 0');
    expect(receipt.content).toContain('Build project: exit 0');
    expect(receipt.content).toContain('TEST: actual source is correct');
    expect(receipt.content).toContain('BUILD: real artifact written');
    expect(events.some(event => event.type === 'mission' && event.phase === 'completed')).toBe(true);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  }, 30000);

  it('refuses a no-effect response even when the existing project checks already pass', async () => {
    await writeFile(join(project, 'source.mjs'), 'export const answer = 42;\n');
    await start(async request => response(request.agent === 'claude' ? 'Apply the requested change.' : 'I need permission; I did not run a command or edit a file.'));
    await expect(engine.invoke('mission', [{ requestId: 'no-effect', task: 'Implement the requested source change' }])).rejects.toThrow(/did not change|no effect|not complete/i);
    expect(await receiptPaths()).toEqual([]);
    expect(events.some(event => event.type === 'mission' && event.phase === 'completed')).toBe(false);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  }, 30000);

  it.each(['test', 'build'])('refuses completion and receipts when the actual %s recipe fails', async failing => {
    if (failing === 'build') await writeFile(join(project, 'build.mjs'), 'console.error("BUILD: intentional real failure"); process.exit(7);\n');
    await start(async (request, _config, options) => {
      if (request.agent === 'claude') return response('Implement and verify.');
      await writeFile(join(options.cwd, 'source.mjs'), `export const answer = ${failing === 'test' ? 17 : 42};\n`);
      return response('Modified source; verification still required.');
    });
    await expect(engine.invoke('mission', [{ requestId: `failed-${failing}`, task: 'Implement answer 42' }])).rejects.toThrow(/verification failed/i);
    expect(await receiptPaths()).toEqual([]);
    expect(events.some(event => event.type === 'mission' && event.phase === 'completed')).toBe(false);
    expect(events.some(event => event.type === 'terminal' && (failing === 'test' ? /AssertionError|17/.test(event.text || '') : /intentional real failure/.test(event.text || '')))).toBe(true);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  }, 30000);

  it('cancels the external agent boundary without starting a build or saving success', async () => {
    let started;
    const planning = new Promise(resolveStarted => { started = resolveStarted; });
    const agents = [];
    await start((request, _config, options) => {
      agents.push(request.agent); started();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
    });
    const run = engine.invoke('mission', [{ requestId: 'cancel-agent', task: 'Implement answer 42' }]);
    const rejected = expect(run).rejects.toThrow(/Stopped|abort/i);
    await planning;
    await engine.invoke('cancel', ['cancel-agent']);
    await rejected;
    expect(agents).toEqual(['claude']);
    expect(await receiptPaths()).toEqual([]);
    expect(events.some(event => event.type === 'mission' && event.phase === 'stopped')).toBe(true);
    expect(events.some(event => event.type === 'mission' && event.phase === 'completed')).toBe(false);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  }, 30000);

  it.each(['test', 'build'])('cancels the running real %s verification process and prevents delayed effects and a receipt', async stage => {
    await writeFile(join(project, stage === 'test' ? 'verify.mjs' : 'build.mjs'), 'import { writeFile } from "node:fs/promises"; console.log("VERIFYING: owned process is waiting"); setTimeout(async () => { await writeFile("verification-finished.txt", "should not run after cancellation"); console.log("verification finished"); }, 1500);\n');
    await start();
    const verifying = waitForEvent(event => event.type === 'terminal' && event.text?.includes('VERIFYING: owned process is waiting'));
    const requestId = `cancel-${stage}`;
    const run = engine.invoke('mission', [{ requestId, task: 'Implement answer 42' }]);
    const rejected = expect(run).rejects.toThrow(/Stopped|abort|cancel/i);
    const event = await verifying;
    expect(Number.isSafeInteger(event.data.pid)).toBe(true);
    expect(() => process.kill(event.data.pid, 0)).not.toThrow();
    await engine.invoke('cancel', [requestId]);
    await rejected;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1800));
    expect(() => process.kill(event.data.pid, 0)).toThrow();
    expect(await receiptPaths()).toEqual([]);
    expect((await readdir(project)).includes('verification-finished.txt')).toBe(false);
    expect((await readdir(project)).includes('dist')).toBe(false);
    expect(events.some(event => event.type === 'mission' && event.phase === 'completed')).toBe(false);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  }, 30000);

  it.skipIf(process.platform !== 'win32' && process.getuid?.() === 0)('releases the mission job when the real project snapshot cannot read a folder', async () => {
    const restricted = join(project, 'restricted');
    await mkdir(restricted); await writeFile(join(restricted, 'file.txt'), 'owned fixture');
    if (process.platform === 'win32') {
      await execute('icacls.exe', [restricted, '/deny', '*S-1-1-0:(RD)'], { windowsHide: true });
      restorePermissions.push(() => execute('icacls.exe', [restricted, '/remove:d', '*S-1-1-0'], { windowsHide: true }));
    } else {
      await chmod(restricted, 0);
      restorePermissions.push(() => chmod(restricted, 0o700));
    }
    await expect(readdir(restricted)).rejects.toThrow();
    await start();
    await expect(engine.invoke('mission', [{ requestId: 'snapshot-failure', task: 'Inspect this project' }])).rejects.toThrow();
    expect(await receiptPaths()).toEqual([]);
    expect((await engine.invoke('runtime')).activeJobs).toBe(0);
  }, 30000);
});
