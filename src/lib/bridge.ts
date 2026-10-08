import type { AphelionBridge, Note, Status } from '../types';
import { runDemo } from './demo';

const NOTES_KEY = 'aphelion.demo-notes.v1';
const SETTINGS_KEY = 'aphelion.demo-settings.v1';
const initialNotes: Note[] = [
  { path: 'Welcome.md', title: 'Welcome', modified: '2026-10-08T00:00:00Z', content: '# Welcome to your world\n\nA little space for your biggest ideas. Your notes are the shared memory between you and your agents.\n\n## Start here\n\n- Craft a conversation in the Workbench.\n- Switch between Claude and Codex without losing context.\n- Save a useful answer to this vault.\n- Run a plan-to-code workflow.\n\n**One block at a time.**\n' },
  { path: 'Project ideas.md', title: 'Project ideas', modified: '2026-10-08T00:00:00Z', content: '# Project ideas\n\n## Things worth building\n\n- A cozy home for all my AI tools\n- A game mechanic that makes someone smile\n- A daily briefing from my own notes\n\n## The next small step\n\nPick one idea. Find its first useful version. Start there.\n' },
  { path: 'Build log.md', title: 'Build log', modified: '2026-10-08T00:00:00Z', content: '# Build log\n\n## Day one\n\nA new world. A blank inventory. A good place to start.\n\n- [x] Create the workspace\n- [ ] Craft the first session\n- [ ] Connect my agents\n- [ ] Make something worth saving\n' },
];
function getNotes(): Note[] {
  try { const saved = JSON.parse(localStorage.getItem(NOTES_KEY) || 'null'); if (Array.isArray(saved) && saved.every(n => typeof n.path === 'string' && typeof n.content === 'string')) return saved; } catch { /* Recover sample notes from corrupt preview data. */ }
  return initialNotes.map(n => ({ ...n, revision: n.modified }));
}
const baseStatus: Status = { desktop: false, keys: { claude: false, codex: false, elevenlabs: false }, models: { claude: 'claude-sonnet-4-6', codex: 'gpt-6-sol' }, voiceId: 'JBFqnCBsd6RMkjVDRZzb', vaultPath: 'Local preview vault', repo: 'https://github.com/roheensharifi39-cyber/aphelion-os', encryptionAvailable: false };
const browserBridge: AphelionBridge = {
  async status() { try { const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); return { ...baseStatus, models: saved.models || baseStatus.models, voiceId: saved.voiceId || baseStatus.voiceId, repo: saved.repo ?? baseStatus.repo }; } catch { return baseStatus; } },
  async configure(input) {
    if (input.keys && Object.values(input.keys).some(Boolean)) throw new Error('Open the desktop app to store keys securely.');
    const next = { ...await this.status(), ...input, keys: baseStatus.keys };
    if (input.repo && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(input.repo)) throw new Error('Use https://github.com/owner/repo.');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ models: next.models, voiceId: next.voiceId, repo: next.repo })); return next;
  },
  async chat(request) { return runDemo(request.agent, request.messages, () => {}); },
  async cancel() {}, onDelta() { return () => {}; },
  async selectVault() { throw new Error('Open the desktop app to choose your Obsidian folder.'); },
  async listNotes() { return getNotes(); },
  async readNote(path) { const note = getNotes().find(n => n.path === path); if (!note) throw new Error('This note could not be found.'); return note; },
  async saveNote(note) {
    if (!note.path.endsWith('.md') || /[\\:\x00-\x1f]/.test(note.path) || note.path.split('/').some(part => !part || part.startsWith('.')) || note.content.length > 1_000_000) throw new Error('Enter a valid Markdown note below 1 MB.');
    const notes = getNotes(); const existing = notes.find(n => n.path === note.path);
    if (note.create && existing) throw new Error('A note with that name already exists.');
    if (!note.create && (!existing || note.revision !== existing.revision)) throw new Error('This note changed. Reopen it before saving.');
    const next = { ...note, title: note.path.split('/').pop()!.slice(0, -3), modified: new Date().toISOString(), revision: crypto.randomUUID(), create: undefined };
    localStorage.setItem(NOTES_KEY, JSON.stringify(existing ? notes.map(n => n.path === note.path ? next : n) : [...notes, next]));
    return next;
  },
  async speak() { throw new Error('Use System voice in preview, or connect ElevenLabs in the desktop app.'); },
  async transcribe() { throw new Error('Connect ElevenLabs in the desktop app for transcription.'); },
  async openExternal(url) { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !['github.com', 'platform.openai.com', 'platform.claude.com', 'console.anthropic.com', 'elevenlabs.io', 'obsidian.md'].includes(parsed.hostname)) throw new Error('Unsupported link.'); window.open(url, '_blank', 'noopener,noreferrer'); },
  async windowAction() {},
};
export const api = window.aphelion || browserBridge;
