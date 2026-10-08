import { spawn, execFile } from 'node:child_process';
import { lstat, mkdir, open, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { subscriptionEnvironment } from './subscriptions.mjs';

const execute = promisify(execFile);
const TEXT_LIMIT = 1_000_000, OUTPUT_LIMIT = 512_000;
const aliases = new Map([
  ['status', 'status'], ['aphelion status', 'status'], ['git status', 'git-status'],
  ['files', 'files'], ['diff', 'diff'], ['git diff', 'diff'],
  ['test', 'test'], ['npm test', 'test'], ['build', 'build'], ['npm run build', 'build'],
  ['check', 'check'], ['npm run check', 'check'],
]);

function inside(root, target) {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('This path is outside the selected project.');
}
function checkRelative(path, allowRoot = false) {
  if (allowRoot && path === '') return;
  if (typeof path !== 'string' || path.length > 1000 || isAbsolute(path) || /[\\:\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Choose a visible file or folder inside the selected project.');
  }
}
async function projectRoot(path) {
  if (typeof path !== 'string' || !path || !isAbsolute(path)) throw new Error('Select or create a project first.');
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Select a project folder without symbolic links.');
  const actual = await realpath(path);
  if (relative(resolve(path), actual) !== '') throw new Error('Project folders cannot contain linked ancestors.');
  return actual;
}
async function ensureProjectsRoot(path) {
  let ancestor = resolve(path);
  while (true) {
    try { await lstat(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      ancestor = dirname(ancestor);
    }
  }
  await projectRoot(ancestor);
  await mkdir(path, { recursive: true });
  return projectRoot(path);
}
async function safePath(root, path = '', allowRoot = false) {
  checkRelative(path, allowRoot);
  let target = root;
  for (const part of path ? path.split('/') : []) {
    target = resolve(target, part);
    inside(root, target);
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed in project files.');
    inside(root, await realpath(target));
  }
  return target;
}
async function textFile(target) {
  const file = await open(target, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > TEXT_LIMIT) throw new Error('Project text files must be below the 1 MB limit.');
    const buffer = Buffer.alloc(TEXT_LIMIT + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > TEXT_LIMIT) throw new Error('Project text files must be below the 1 MB limit.');
    if (buffer.subarray(0, bytesRead).includes(0)) throw new Error('This is a binary file. Open a text file instead.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)); }
    catch { throw new Error('This file is not UTF-8 text.'); }
  } finally { await file.close(); }
}
async function exists(path) {
  try { return (await stat(path)).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function npmCommand() {
  const directories = (process.env.PATH || process.env.Path || '').split(delimiter).filter(Boolean);
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...directories.map(path => join(path, 'node_modules', 'npm', 'bin', 'npm-cli.js'))].filter(path => path && /npm-cli\.js$/i.test(path));
  for (const path of candidates) if (await exists(path)) {
    const env = subscriptionEnvironment();
    let command = process.execPath;
    if (process.versions.electron) {
      const nodeCandidates = [process.env.npm_node_execpath, ...directories.map(directory => join(directory, process.platform === 'win32' ? 'node.exe' : 'node'))].filter(Boolean);
      const node = (await Promise.all(nodeCandidates.map(async path => await exists(path) ? path : null))).find(Boolean);
      if (node) { command = node; delete env.ELECTRON_RUN_AS_NODE; }
      else env.ELECTRON_RUN_AS_NODE = '1';
    } else delete env.ELECTRON_RUN_AS_NODE;
    return { command, prefix: [path], env };
  }
  if (process.platform !== 'win32') return { command: 'npm', prefix: [], env: subscriptionEnvironment() };
  throw new Error('Install Node.js and npm to run this project recipe.');
}

export function createProjectManager({ getProjectPath, setProjectPath, projectsRoot, selectFolder, onEvent = () => {} }) {
  let running = null, changing = false, disposed = false;
  const emit = event => { try { onEvent({ source: 'project', ...event }); } catch { /* Event listeners cannot interrupt child cleanup. */ } };
  function available() {
    if (disposed) throw new Error('The project workspace is disposed.');
    if (running || changing) throw new Error('A project task is running. Wait before changing projects or starting another command.');
  }
  async function selectedRoot() {
    if (disposed) throw new Error('The project workspace is disposed.');
    return projectRoot(getProjectPath());
  }
  async function inspect(root) {
    let branch = null, dirty = false;
    const git = await lstat(join(root, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (git) {
      if (git.isSymbolicLink()) throw new Error('Linked Git metadata is not allowed.');
      const options = { cwd: root, env: subscriptionEnvironment(), windowsHide: true, timeout: 5000, maxBuffer: OUTPUT_LIMIT };
      const result = await execute('git', ['status', '--porcelain', '--untracked-files=normal'], options);
      dirty = Boolean(result.stdout.trim());
      try { branch = (await execute('git', ['symbolic-ref', '--short', 'HEAD'], options)).stdout.trim(); }
      catch { branch = (await execute('git', ['rev-parse', '--short', 'HEAD'], options)).stdout.trim(); }
    }
    return { path: root, name: basename(root), branch, dirty };
  }
  async function listFrom(root, path = '') {
    const folder = await safePath(root, path, true);
    if (!(await lstat(folder)).isDirectory()) throw new Error('Choose a project directory.');
    return (await readdir(folder, { withFileTypes: true }))
      .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules' && !entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 500)
      .map(entry => ({ path: path ? `${path}/${entry.name}` : entry.name, name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }));
  }
  async function recipes(root) {
    let manifest;
    try { manifest = JSON.parse(await textFile(await safePath(root, 'package.json'))); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const scripts = manifest.scripts || {};
    const available = ['test', 'build', 'check'].filter(name => typeof scripts[name] === 'string' && scripts[name].trim());
    if (!available.includes('check') && available.includes('test') && available.includes('build')) available.push('check');
    return available.map(id => ({ id, name: id === 'test' ? 'Run tests' : id === 'build' ? 'Build project' : 'Check project', status: running?.recipe === id ? 'running' : 'idle', detail: id === 'check' && !scripts.check ? 'npm test → npm run build' : id === 'test' ? 'npm test' : `npm run ${id}`, steps: id === 'check' && !scripts.check ? ['test', 'build'] : [id] }));
  }
  function stopOwned(child) {
    if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0 || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
  }
  function runChild(record, root, command, args, env = subscriptionEnvironment(), signal) {
    if (disposed) return Promise.reject(new Error('The project workspace is disposed.'));
    if (signal?.aborted) return Promise.reject(new DOMException('Stopped', 'AbortError'));
    return new Promise(resolveResult => {
      let output = '', size = 0, truncated = false, settled = false;
      function append(chunk) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        const remaining = Math.max(0, OUTPUT_LIMIT - size);
        if (remaining) {
          const text = bytes.subarray(0, remaining).toString('utf8');
          output += text; size += Math.min(bytes.length, remaining);
          emit({ type: 'terminal', text, data: { command: record.label, pid: record.child?.pid, status: 'running' } });
        }
        if (bytes.length > remaining && !truncated) { truncated = true; output += '\n[Output capped at 512 KB.]\n'; emit({ type: 'terminal', text: '[Output capped at 512 KB.]', data: { command: record.label } }); }
      }
      const child = spawn(command, args, { cwd: root, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      record.child = child;
      const abort = () => stopOwned(child);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on('data', append); child.stderr.on('data', append);
      const timeout = setTimeout(() => { append('\nProject command timed out after 3 minutes.\n'); stopOwned(child); }, 180000);
      timeout.unref();
      child.once('spawn', () => emit({ type: 'activity', text: `Started ${record.label}`, data: { command: record.label, pid: child.pid, status: 'running' } }));
      function finish(code) {
        if (settled) return;
        settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', abort); record.child = null;
        resolveResult({ code, output });
      }
      child.once('error', error => { append(`Could not run the project command: ${error.message}\n`); finish(1); });
      child.once('close', (code, signal) => { if (signal) append(`\nCommand stopped (${signal}).\n`); finish(Number.isInteger(code) ? code : 1); });
    });
  }
  async function command(input, { signal } = {}) {
    available();
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    if (typeof input !== 'string' || input.length > 100 || !aliases.has(input.trim())) throw new Error('Supported commands: status, files, diff, test, build, check.');
    const recipe = aliases.get(input.trim());
    const record = { recipe, label: input.trim(), child: null };
    running = record;
    emit({ type: 'terminal', text: `$ ${record.label}\n`, data: { command: record.label, status: 'running' } });
    try {
      const root = await selectedRoot();
      let result;
      if (recipe === 'files') {
        result = { code: 0, output: (await listFrom(root)).map(file => `${file.name}${file.kind === 'directory' ? '/' : ''}`).join('\n') || '(empty folder)' };
        emit({ type: 'terminal', text: result.output, data: { command: record.label } });
      } else if (recipe === 'status') {
        const info = await inspect(root);
        result = info.branch ? await runChild(record, root, 'git', ['status', '--short', '--branch'], subscriptionEnvironment(), signal) : { code: 0, output: `Project: ${info.name}\nPath: ${info.path}\nGit: no repository in this folder\nVisible entries: ${(await listFrom(root)).length}` };
        if (!info.branch) emit({ type: 'terminal', text: result.output, data: { command: record.label } });
      } else if (recipe === 'git-status' || recipe === 'diff') {
        if (!(await inspect(root)).branch) throw new Error('The selected folder has no Git repository.');
        result = await runChild(record, root, 'git', recipe === 'diff' ? ['--no-pager', 'diff', '--', '.'] : ['status', '--short', '--branch', '--', '.'], subscriptionEnvironment(), signal);
      } else {
        const selected = (await recipes(root)).find(item => item.id === recipe);
        if (!selected) throw new Error(`This project has no ${recipe} recipe in package.json.`);
        const npm = await npmCommand();
        result = { code: 0, output: '' };
        for (const step of selected.steps) {
          if (disposed) throw new Error('The project workspace is disposed.');
          if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
          const current = await runChild(record, root, npm.command, [...npm.prefix, ...(step === 'test' ? ['test'] : ['run', step])], npm.env, signal);
          result = { code: current.code, output: (result.output + current.output).slice(0, OUTPUT_LIMIT + 100) };
          if (current.code !== 0) break;
        }
      }
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      emit({ type: 'activity', text: `${record.label} ${result.code === 0 ? 'completed' : `exited with code ${result.code}`}`, data: { command: record.label, status: result.code === 0 ? 'complete' : 'error' } });
      return result;
    } catch (error) { emit({ type: 'activity', text: error.message, data: { command: record.label, status: 'error' } }); throw error; }
    finally { running = null; }
  }
  return {
    async info() { return getProjectPath() ? inspect(await selectedRoot()) : null; },
    async select() {
      available(); changing = true;
      try {
        const chosen = await selectFolder();
        if (!chosen) return null;
        if (disposed) throw new Error('The project workspace is disposed.');
        const root = await projectRoot(chosen), info = await inspect(root);
        await setProjectPath(root);
        emit({ type: 'activity', text: `Connected project ${info.name}` });
        return info;
      } finally { changing = false; }
    },
    async create(name) {
      available();
      if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9 _-]{0,79}$/i.test(name)) throw new Error('Use a project name with letters, numbers, spaces, dashes or underscores.');
      checkRelative(name);
      if (!isAbsolute(projectsRoot)) throw new Error('The project creation root must be an absolute folder.');
      changing = true;
      try {
        const base = await ensureProjectsRoot(projectsRoot), root = resolve(base, name);
        inside(base, root);
        try { await mkdir(root); } catch (error) { if (error.code === 'EEXIST') throw new Error('A project with that name already exists.'); throw error; }
        await writeFile(join(root, 'README.md'), `# ${name}\n\nYour local project workspace. Add source files here, then connect its package.json test, build, or check scripts to Aphelion.\n`, { flag: 'wx' });
        await writeFile(join(root, '.gitignore'), 'node_modules/\ndist/\n.env\n.env.*\n*.log\n', { flag: 'wx' });
        if (disposed) throw new Error('The project workspace is disposed.');
        await setProjectPath(root);
        const info = await inspect(root);
        emit({ type: 'activity', text: `Created project ${name}` });
        return info;
      } finally { changing = false; }
    },
    async list(path = '') { return listFrom(await selectedRoot(), path); },
    async read(path) { const root = await selectedRoot(); return { path, content: await textFile(await safePath(root, path)) }; },
    command,
    async automations() { if (!getProjectPath()) return []; return (await recipes(await selectedRoot())).map(({ steps, ...info }) => info); },
    async runAutomation(id, options) { if (!['test', 'build', 'check'].includes(id)) throw new Error('Choose an available project automation.'); return command(id, options); },
    processes() {
      const child = running?.child;
      return child?.pid && child.exitCode === null && child.signalCode === null ? [{ pid: child.pid, name: running.label, role: 'project' }] : [];
    },
    activeJobs() { return running ? 1 : 0; },
    dispose() { disposed = true; stopOwned(running?.child); },
  };
}
