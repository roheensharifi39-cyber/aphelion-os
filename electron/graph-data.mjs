function canonical(path) {
  const parts = [];
  for (const part of path.replaceAll('\\', '/').split('/')) { if (!part || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); }
  return parts.join('/').replace(/\.md$/i, '').toLowerCase();
}
function noteTags(content) {
  const tags = [];
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] || '';
  const declared = /^tags:\s*\[([^\]]*)\]/m.exec(frontmatter)?.[1];
  if (declared) tags.push(...declared.split(',').map(tag => tag.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  for (const match of content.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.push(match[1]);
  return [...new Set(tags)].slice(0, 16);
}
export function graphFromNotes(notes, total = notes.length) {
  const nodes = notes.map(note => ({ id: note.path, path: note.path, title: note.title || note.path.replace(/\.md$/i, ''), modified: note.modified || '', tags: noteTags(note.content || ''), excerpt: (note.content || '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim().slice(0, 500) }));
  const byPath = new Map(nodes.map(node => [canonical(node.path), node.id]));
  const byTitle = new Map();
  for (const node of nodes) { const key = canonical(node.title); byTitle.set(key, byTitle.has(key) ? null : node.id); }
  const edges = new Map();
  notes.forEach(note => {
    const content = note.content || '';
    const references = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => ({ link: match[1].split('|')[0], wiki: true }));
    references.push(...[...content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match => ({ link: match[1], wiki: false })));
    for (const reference of references) {
      let link;
      try { link = decodeURIComponent(reference.link).split('#')[0].split('?')[0]; } catch { continue; }
      if (!link || /^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('//')) continue;
      const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/') + 1) : '';
      const to = reference.wiki ? byPath.get(canonical(link)) || byPath.get(canonical(folder + link)) || byTitle.get(canonical(link)) : byPath.get(canonical(folder + link));
      if (to && to !== note.path) edges.set(`${note.path}\0${to}`, { from: note.path, to });
    }
  });
  return { nodes, edges: [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)), total, truncated: nodes.length < total };
}
