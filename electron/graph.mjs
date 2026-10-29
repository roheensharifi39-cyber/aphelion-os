import { listNotes, readNote } from './vault.mjs';
import { graphFromNotes } from './graph-data.mjs';
export async function buildVaultGraph(root) {
  const metadata = (await listNotes(root)).sort((a, b) => b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path));
  const notes = new Map();
  for (const note of metadata.slice(0, 32)) {
    try { notes.set(note.path, await readNote(root, note.path)); } catch { /* A changing note can still be listed without a stale excerpt. */ }
  }
  // Keep every listed note selectable while bounding content reads to recent memories.
  const graph = graphFromNotes(metadata.map(note => notes.get(note.path) || { ...note, content: '' }), metadata.length);
  return { ...graph, truncated: notes.size < metadata.length };
}
