import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectManager } from '../electron/projects.mjs';

const execute = promisify(execFile);
let root, project, selected, chooser, manager, events, onProcessStarted;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aphelion-project-test-'));
  project = join(root, 'connected');
  await mkdir(project);
  selected = ''; chooser = project; events = []; onProcessStarted = null;
  manager = createProjectManager({
    getProjectPath: () => selected,
    setProjectPath: async path => { selected = path; },
    projectsRoot: join(root, 'created'),
    selectFolder: async () => chooser,
    onEvent: event => { events.push(event); if (event.type === 'activity' && event.data?.pid) onProcessStarted?.(event.data.pid); },
  });
});
afterEach(async () => {
  manager.dispose();
  const absolute = resolve(root);
  expect(absolute.startsWith(resolve(tmpdir()) + sep)).toBe(true);
  expect(basename(absolute).startsWith('aphelion-project-test-')).toBe(true);
  await rm(absolute, { recursive: true, force: true });
});

describe('real confined project workspace', () => {
  it('starts disconnected and persists only a supplied folder choice', async () => {
    expect(await manager.info()).toBeNull();
    await expect(manager.list()).rejects.toThrow(/select|connect|project/i);
    expect(await manager.select()).toMatchObject({ path: project, name: 'connected', branch: null, dirty: false });
    chooser = null;
    expect(await manager.select()).toBeNull();
    expect(selected).toBe(project);
  });

  it('creates a useful owned folder without overwriting an existing project', async () => {
    const created = await manager.create('First Mission');
    expect(created.path).toBe(join(root, 'created', 'First Mission'));
    expect(await readFile(join(created.path, 'README.md'), 'utf8')).toContain('First Mission');
    expect(await readFile(join(created.path, '.gitignore'), 'utf8')).toContain('node_modules');
    await writeFile(join(created.path, 'keep.txt'), 'preserve');
    await expect(manager.create('First Mission')).rejects.toThrow(/exists/i);
    expect(await readFile(join(created.path, 'keep.txt'), 'utf8')).toBe('preserve');
    for (const name of ['../escape', 'CON', 'hidden/name', '.private']) await expect(manager.create(name)).rejects.toThrow();
  });

  it('lists real entries and rejects hidden, traversal, junction and oversized reads', async () => {
    await manager.select();
    await mkdir(join(project, 'src'));
    await mkdir(join(project, 'node_modules'));
    await writeFile(join(project, 'src', 'main.mjs'), 'export const ready = true;');
    await writeFile(join(project, '.env'), 'private');
    const outside = join(root, 'outside');
    await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'private');
    await symlink(outside, join(project, 'linked'), 'junction');
    expect(await manager.list()).toEqual([{ path: 'src', name: 'src', kind: 'directory' }]);
    expect(await manager.read('src/main.mjs')).toEqual({ path: 'src/main.mjs', content: 'export const ready = true;' });
    for (const path of ['../outside/secret.txt', '.env', 'node_modules/file.js', 'src\\main.mjs', 'linked/secret.txt']) await expect(manager.read(path)).rejects.toThrow();
    await writeFile(join(project, 'large.txt'), 'x'.repeat(1_000_001));
    await expect(manager.read('large.txt')).rejects.toThrow(/limit|large|1 MB/i);
    await writeFile(join(project, 'binary.dat'), Buffer.from([0, 1, 2]));
    await expect(manager.read('binary.dat')).rejects.toThrow(/text|binary/i);
  });

  it('runs the actual selected package script, emits its output, and refuses arbitrary commands', async () => {
    await manager.select();
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'local-fixture', scripts: { test: 'node recipe.mjs', build: 'node --check recipe.mjs' } }));
    await writeFile(join(project, 'recipe.mjs'), 'import { writeFileSync } from "node:fs"; writeFileSync("proof.txt", process.cwd()); console.log("real recipe output");');
    expect((await manager.automations()).map(item => item.id)).toEqual(['test', 'build', 'check']);
    const result = await manager.command('npm test');
    expect(result.code).toBe(0);
    expect(result.output).toContain('real recipe output');
    expect(await readFile(join(project, 'proof.txt'), 'utf8')).toBe(project);
    expect(events.some(event => event.type === 'terminal' && event.text.includes('real recipe output'))).toBe(true);
    await expect(manager.command('npm test && echo injected')).rejects.toThrow(/supported|allowed|command/i);
    expect((await manager.runAutomation('check')).code).toBe(0);
    expect(manager.processes()).toEqual([]);
    expect(manager.activeJobs()).toBe(0);
  }, 20000);

  it('blocks folder changes and overlapping tasks while its actual child is running', async () => {
    await manager.select();
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'slow-fixture', scripts: { test: 'node slow.mjs' } }));
    await writeFile(join(project, 'slow.mjs'), 'console.log("started"); setTimeout(() => console.log("finished"), 300);');
    const started = new Promise(resolve => { onProcessStarted = resolve; });
    const run = manager.command('test');
    expect(manager.activeJobs()).toBe(1);
    await expect(manager.create('Blocked')).rejects.toThrow(/running|busy/i);
    await expect(manager.select()).rejects.toThrow(/running|busy/i);
    await expect(manager.command('files')).rejects.toThrow(/running|busy/i);
    expect((await manager.automations()).find(item => item.id === 'test').status).toBe('running');
    const pid = await started;
    expect(manager.processes()).toEqual([{ pid, name: 'test', role: 'project' }]);
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect((await run).output).toContain('finished');
    expect(manager.activeJobs()).toBe(0);
  }, 20000);

  it('reports the actual Git branch and working tree state', async () => {
    await execute('git', ['init', '-q'], { cwd: project, windowsHide: true });
    await writeFile(join(project, 'README.md'), 'changed');
    await manager.select();
    const info = await manager.info();
    expect(typeof info.branch).toBe('string');
    expect(info.dirty).toBe(true);
    expect((await manager.command('git status')).output).toContain('README.md');
    expect((await manager.command('diff')).code).toBe(0);
  });

  it('rejects linked ancestors and Git commands that would inspect an enclosing repository', async () => {
    const target = join(root, 'actual');
    await mkdir(target); await mkdir(join(target, 'nested'));
    await symlink(target, join(root, 'alias'), 'junction');
    chooser = join(root, 'alias', 'nested');
    await expect(manager.select()).rejects.toThrow(/link/i);
    await execute('git', ['init', '-q'], { cwd: root, windowsHide: true });
    chooser = project; await manager.select();
    await expect(manager.command('git status')).rejects.toThrow(/repository/i);
    await expect(manager.command('diff')).rejects.toThrow(/repository/i);
  });
});
