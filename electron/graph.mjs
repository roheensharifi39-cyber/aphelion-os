import { listNotes, readNote } from './vault.mjs';
import { graphFromNotes } from './graph-data.mjs';
export async function buildVaultGraph(root) {
  const metadata = await listNotes(root);
  const notes = [];
  for (const note of metadata.slice(0, 32)) {
    try { notes.push(await readNote(root, note.path)); } catch { /* Files removed or changed during indexing are excluded. */ }
  }
  return graphFromNotes(notes, metadata.length);
}
