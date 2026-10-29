import { describe, expect, it } from 'vitest';
import { graphFromNotes } from '../electron/graph-data.mjs';
import { buildVaultGraph } from '../electron/graph.mjs';
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('vault knowledge graph', () => {
  it('connects actual wiki and relative Markdown links without fabricating missing notes', () => {
    const graph = graphFromNotes([
      { path: 'Project Memory.md', title: 'Project Memory', modified: 'today', content: '# Project\n\nSee [[Architecture|the design]] and [Ideas](notes/Ideas.md). [[Missing]]' },
      { path: 'Architecture.md', title: 'Architecture', modified: 'today', content: '---\ntags: [system, planning]\n---\n# Architecture\n\n[[Project Memory#Start]] #design' },
      { path: 'notes/Ideas.md', title: 'Ideas', modified: 'today', content: '[Design](../Architecture.md)\n[Web](https://example.com/Architecture.md)' },
    ], 3);
    expect(graph.edges).toEqual(expect.arrayContaining([{ from: 'Architecture.md', to: 'Project Memory.md' }, { from: 'Project Memory.md', to: 'Architecture.md' }, { from: 'Project Memory.md', to: 'notes/Ideas.md' }, { from: 'notes/Ideas.md', to: 'Architecture.md' }]));
    expect(graph.edges).toHaveLength(4);
    expect(graph.nodes[1].tags).toEqual(['system', 'planning', 'design']);
    expect(graph.nodes[1].excerpt).not.toContain('tags:');
    expect(graph.total).toBe(3);
    expect(graph.truncated).toBe(false);
  });
  it('reports truncation and rejects external or self links', () => {
    const graph = graphFromNotes([{ path: 'A.md', title: 'A', modified: 'now', content: '[[A]] [remote](https://example.com/A.md) #hello' }], 40);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes[0].tags).toEqual(['hello']);
    expect(graph.total).toBe(40);
    expect(graph.truncated).toBe(true);
  });
  it('indexes newest memories before alphabetic files and keeps older notes selectable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aphelion-graph-'));
    try {
      for (let i = 0; i < 35; i++) {
        const path = join(root, `A${String(i).padStart(2, '0')}.md`);
        await writeFile(path, `# Older note ${i}`);
        await utimes(path, new Date('2020-01-01'), new Date('2020-01-01'));
      }
      await writeFile(join(root, 'Z-newest-conversation.md'), '# New memory\n\n[[A34]] #conversation');
      const graph = await buildVaultGraph(root);
      expect(graph.nodes).toHaveLength(36);
      expect(graph.nodes[0]).toMatchObject({ path: 'Z-newest-conversation.md', tags: ['conversation'] });
      expect(graph.nodes.some(node => node.path === 'A34.md')).toBe(true);
      expect(graph.edges).toContainEqual({ from: 'Z-newest-conversation.md', to: 'A34.md' });
      expect(graph.truncated).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
