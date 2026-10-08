import { describe, expect, it } from 'vitest';
import { graphFromNotes } from '../electron/graph-data.mjs';

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
});
