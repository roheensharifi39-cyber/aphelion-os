import type { Session, VaultGraph } from '../types';
import { vaultKey } from './workspace';

export function hashMemory(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function seedForVault(path: string): number { return path ? (690702840 ^ hashMemory(vaultKey(path))) >>> 0 : 690702840; }
export type MemoryLayoutNode = { path: string; title: string; position: [number, number, number] };
export function memoryLayout(graph: VaultGraph | null, path: string, selected?: string | null): MemoryLayoutNode[] {
  return [...(graph?.nodes || [])].sort((a,b) => Number(b.path === selected) - Number(a.path === selected) || b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path)).slice(0,32).map(node => {
    const hash = hashMemory(`${vaultKey(path)}:${node.path}`);
    const angle = (hash % 10000) / 10000 * Math.PI * 2;
    const vertical = ((hash >>> 12) % 10000) / 10000 * 1.6 - .8;
    const radius = .75 + ((hash >>> 19) % 100) / 100 * .45;
    return { path: node.path, title: node.title, position: [Math.cos(angle) * radius, vertical * radius, Math.sin(angle) * radius * .65] };
  });
}
export function vaultDevelopment(graph: VaultGraph | null, sessions: Session[]): number {
  const replies = sessions.reduce((count, session) => count + session.messages.filter(message => message.role === 'assistant' && !message.pending && !message.error && !!message.content.trim()).length,0);
  return Math.min(1, Math.log1p((graph?.total || 0) + (graph?.edges.length || 0) + replies * 2) / 7);
}
