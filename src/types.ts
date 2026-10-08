export type Agent = 'claude' | 'codex';
export type Page = 'home' | 'chat' | 'vault' | 'workflows' | 'voice' | 'settings';
export type Message = { id: string; role: 'user' | 'assistant'; content: string; demo?: boolean; error?: boolean; pending?: boolean };
export type Session = { id: string; agent: Agent; title: string; created: string; messages: Message[] };
export type Workspace = { version: 1; sessions: Session[]; active: Record<Agent, string | null>; name: string; sound: boolean };
export type Note = { path: string; title: string; modified: string; content?: string; revision?: string; create?: boolean };
export type Status = { desktop: boolean; keys: Record<Agent | 'elevenlabs', boolean>; models: Record<Agent, string>; voiceId: string; vaultPath: string; repo: string; encryptionAvailable: boolean; credentialError?: string };
export type ChatRequest = { agent: Agent; messages: Pick<Message, 'role' | 'content'>[]; requestId: string };
export type ChatResult = { text: string; demo: boolean; usage: { input: number; output: number } };
export type SettingsInput = { keys?: Partial<Record<Agent | 'elevenlabs', string>>; models?: Record<Agent, string>; voiceId?: string; repo?: string; clearKey?: Agent | 'elevenlabs' };
export interface AphelionBridge {
  status(): Promise<Status>;
  configure(input: SettingsInput): Promise<Status>;
  chat(request: ChatRequest): Promise<ChatResult>;
  cancel(requestId: string): Promise<void>;
  onDelta(handler: (event: { requestId: string; delta: string }) => void): () => void;
  selectVault(): Promise<Status | null>;
  listNotes(): Promise<Note[]>;
  readNote(path: string): Promise<Note>;
  saveNote(note: Note & { content: string }): Promise<Note>;
  speak(text: string): Promise<{ data: string; type: string }>;
  transcribe(audio: { data: number[]; type: string }): Promise<string>;
  openExternal(url: string): Promise<void>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
}
declare global { interface Window { aphelion?: AphelionBridge } }
