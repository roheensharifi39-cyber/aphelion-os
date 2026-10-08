import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listNotes, readNote, saveNote } from '../electron/vault.mjs';

let root;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'aphelion-vault-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('vault confinement and preservation', () => {
  it('lists Markdown notes recursively and preserves frontmatter on writes', async () => {
    await mkdir(join(root, 'projects'));
    await writeFile(join(root, 'projects', 'castle.md'), '---\ntags: [build]\n---\n# Castle\n');
    await writeFile(join(root, 'image.txt'), 'ignored');
    const notes = await listNotes(root);
    expect(notes.map(n => n.path)).toEqual(['projects/castle.md']);
    const note = await readNote(root, 'projects/castle.md');
    await saveNote(root, { ...note, content: note.content + 'A new block.\n' });
    expect(await readFile(join(root, 'projects', 'castle.md'), 'utf8')).toBe('---\ntags: [build]\n---\n# Castle\nA new block.\n');
  });
  it('rejects traversal, absolute paths, non-Markdown and Windows separators', async () => {
    for (const path of ['../secret.md', '/secret.md', 'C:\\secret.md', '..\\secret.md', '.obsidian/config.md', 'file.txt']) {
      await expect(readNote(root, path)).rejects.toThrow();
      await expect(saveNote(root, { path, content: 'bad', create: true })).rejects.toThrow();
    }
  });
  it('rejects junction escapes from the selected folder', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'aphelion-outside-'));
    try {
      await writeFile(join(outside, 'secret.md'), 'private');
      await symlink(outside, join(root, 'linked'), 'junction');
      await expect(readNote(root, 'linked/secret.md')).rejects.toThrow(/outside|symbolic|link/i);
      expect(await listNotes(root)).toEqual([]);
    } finally { await rm(join(root, 'linked'), { force: true, recursive: true }); await rm(outside, { recursive: true, force: true }); }
  });
  it('does not overwrite externally modified notes or duplicate new notes', async () => {
    await saveNote(root, { path: 'new.md', content: 'one', create: true });
    const first = await readNote(root, 'new.md');
    await writeFile(join(root, 'new.md'), 'external changed content');
    await expect(saveNote(root, { ...first, content: 'stale' })).rejects.toThrow(/changed/i);
    expect(await readFile(join(root, 'new.md'), 'utf8')).toBe('external changed content');
    await expect(saveNote(root, { path: 'new.md', content: 'duplicate', create: true })).rejects.toThrow(/exists/i);
  });
});
