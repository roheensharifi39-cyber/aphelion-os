import { describe, expect, it } from 'vitest';
import { memoryLayout, seedForVault, vaultDevelopment } from '../src/lib/vault-visual';

const node = (path) => ({id:path,path,title:path,tags:[],excerpt:'',modified:'2026-10-28'});
describe('vault-linked visual memory', () => {
  it('uses a stable distinct form for each folder, including Windows path aliases', () => {
    expect(seedForVault('C:/First')).toBe(seedForVault('c:\\first\\'));
    expect(seedForVault('C:/First')).not.toBe(seedForVault('C:/Second'));
  });
  it('keeps existing note positions while new conversation notes are added', () => {
    const first = { nodes:[node('Idea.md')], edges:[], total:1, truncated:false };
    const expanded = {...first,nodes:[...first.nodes,node('Conversation.md')],total:2};
    expect(memoryLayout(expanded,'C:/Vault').find(n=>n.path==='Idea.md').position).toEqual(memoryLayout(first,'C:/Vault')[0].position);
    expect(vaultDevelopment(expanded,[])).toBeGreaterThan(vaultDevelopment(first,[]));
  });
});
