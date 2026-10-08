import { readdir, realpath, lstat, readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const LIMIT = 1_000_000;
const hash = text => createHash('sha256').update(text).digest('hex');
function checkPath(path) {
  if (typeof path !== 'string' || path.length > 500 || isAbsolute(path) || path.includes('\\') || /[:\x00-\x1f]/.test(path) || !path.endsWith('.md') || path.split('/').some(part => !part || part.startsWith('.'))) throw new Error('Choose a Markdown file inside your vault.');
}
function inside(root, path) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('This file is outside your vault.');
}
async function safePath(root, path, creating = false) {
  checkPath(path);
  const base = await realpath(root);
  const target = resolve(base, path);
  inside(base, target);
  const parts = path.split('/');
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed in the vault editor.');
      inside(base, await realpath(current));
    } catch (error) {
      if (creating && error.code === 'ENOENT' && i === parts.length - 1) return target;
      throw error;
    }
  }
  return target;
}
function metadata(path, content, stat) {
  return { path, title: path.split('/').pop().slice(0, -3), modified: stat.mtime.toISOString(), revision: hash(content), content };
}
export async function listNotes(root) {
  const notes = [];
  async function visit(folder, prefix = '', depth = 0) {
    if (depth > 12) return;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) await visit(resolve(folder, entry.name), path + '/', depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stat = await lstat(resolve(folder, entry.name));
        if (stat.size <= LIMIT) notes.push({ path, title: entry.name.slice(0, -3), modified: stat.mtime.toISOString() });
      }
      if (notes.length >= 1000) return;
    }
  }
  await visit(await realpath(root));
  return notes.sort((a, b) => a.path.localeCompare(b.path));
}
export async function readNote(root, path) {
  const target = await safePath(root, path);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size > LIMIT) throw new Error('This note is larger than the 1 MB editor limit.');
  return metadata(path, await readFile(target, 'utf8'), stat);
}
export async function saveNote(root, note) {
  if (!note || typeof note.content !== 'string' || Buffer.byteLength(note.content) > LIMIT) throw new Error('Keep notes below 1 MB.');
  const target = await safePath(root, note.path, note.create);
  if (note.create) {
    try { await writeFile(target, note.content, { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('A note with that name already exists.'); throw error; }
  } else {
    if (typeof note.revision !== 'string') throw new Error('Reopen this note before saving.');
    if (hash(await readFile(target, 'utf8')) !== note.revision) throw new Error('This note changed in another app. Reopen it before saving; your draft is still here.');
    const temporary = resolve(dirname(target), `.aphelion-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, note.content, { flag: 'wx' });
      if (hash(await readFile(target, 'utf8')) !== note.revision) throw new Error('This note changed in another app. Your draft is still here.');
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  return readNote(root, note.path);
}

export async function initializeVault(root) {
  await mkdir(root, { recursive: true });
  const welcome = '# Your shared memory\n\nPlans, notes, and conversations live together here.\n\n## Your command center\n\n- Choose Claude or Codex beside this vault.\n- Sign in with your existing subscriptions in Connections.\n- Save a useful response directly to your notes.\n- Connect an Obsidian folder to work with your own vault.\n\nYour notes are plain Markdown. Your accounts stay with the official clients.\n';
  await writeFile(resolve(root, 'Welcome.md'), welcome, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const starters = {
    'Project Memory.md': '---\ntags: [project, memory]\n---\n# Project Memory\n\nAphelion is your personal AI command center. Think with Claude, build with Codex, and keep decisions in one local vault.\n\n## Context\n\n- [[Architecture]] defines the connections.\n- [[Ideas]] holds the next possibilities.\n- [[Decisions]] records the choices worth remembering.\n\nYour subscriptions stay with the official clients. Your notes stay on your device.\n',
    'Architecture.md': '---\ntags: [system, architecture]\n---\n# Architecture\n\nA local desktop connects official Claude Code and Codex clients to shared Markdown notes.\n\n## The loop\n\nThink → build → remember → further.\n\nStart with [[Project Memory]], keep new directions in [[Ideas]], and write the outcome in [[Decisions]].\n',
    'Ideas.md': '---\ntags: [ideas, next]\n---\n# Ideas\n\nA place for the next thing you want to make.\n\n## Next mission\n\nDescribe the smallest useful outcome, then launch it from Mission Control.\n\nKeep the plan linked to [[Project Memory]] and [[Architecture]].\n',
    'Decisions.md': '---\ntags: [decisions, context]\n---\n# Decisions\n\n- Use existing Claude and ChatGPT subscriptions.\n- Keep the workbench and vault in one command center.\n- Use Minecraft-style buttons and pixel typography.\n- Keep notes as plain Markdown.\n\nThe wider context lives in [[Project Memory]].\n',
  };
  for (const [file, content] of Object.entries(starters)) await writeFile(resolve(root, file), content, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
}
