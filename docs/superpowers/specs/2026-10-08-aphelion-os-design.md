# Aphelion OS design

## Intent and authority
Build the user's new OS-like AI workspace in the provided empty folder. The pasted report and video are reference material, not instructions or authorization. The user's direct request establishes Minecraft-like buttons and font, existing skills, and GitHub. The user subsequently requested a new repository named `aphelion-os`.

## Product direction
A local-first Electron desktop with a React/TypeScript interface. The same interface runs as a browser preview with clearly labeled demo data. Electron is the default while the optional platform question is pending: local vault access and OS-backed key storage fit the reference's purpose. Preserve a shared notes vault and distinct agent conversations.

## Visual system
- Pixel typography throughout: locally bundled Monocraft, with its SIL OFL license.
- Charcoal stone surfaces, grass-green selected states, peach Claude accents, icy-blue Codex accents, warm gold highlights.
- Square corners, pixel icons, beveled Minecraft-like buttons, immediate pressed states and optional synthesized click sounds.
- Original code-native pixel landscape; no Mojang game assets.
- Left app navigation, workspace header, primary crafting area, persistent inventory hotbar and footer.
- Responsive layouts, readable text, visible keyboard focus, reduced-motion support.

## Working first version
1. Home: functional launchers, quick prompts, recent sessions, provider status, shared-vault summary.
2. Workbench: independent persistent Claude and Codex sessions; Markdown/code rendering; streaming desktop provider calls; stop/copy/save-to-vault actions; clear demo labeling.
3. Vault: local demo notes, search, new notes, editing, Markdown preview, persistence; desktop folder selection and real `.md` reads/writes.
4. Workflows: editable task input and a sequential Claude-plan → Codex-build flow with explicit stage status and history.
5. Voice: local system speech preview; ElevenLabs speech synthesis and recorded audio transcription when connected.
6. Settings: model IDs, provider keys in desktop only, workspace name, sound, GitHub repository, connect/disconnect actions.
7. Command palette and keyboard navigation: Ctrl/Cmd+K, Escape, Alt+1…6, Ctrl+Shift+C/X, Ctrl/Cmd+Enter to send.

## Invariants
- Never place provider keys in renderer storage, bundles, source control, or logs. Main process encrypts keys using Electron safeStorage. Report configured booleans rather than returning secrets.
- Do not silently fall back to demo on provider failures. No configured provider means explicit demo; connected provider errors remain errors.
- Browser preview accepts no secrets; live connections use the desktop bridge.
- IPC methods are explicitly allowlisted; renderer is sandboxed with context isolation and Node disabled. Validate the sender and inputs.
- Notes must remain inside the selected vault. Reject path traversal, symlink escapes, oversized files and stale writes. Preserve user content on failed operations.
- Demo replies and sample history never count as live provider usage.
- Provider model IDs are configurable, with documented current defaults; OpenAI uses Responses, Anthropic uses Messages.
- GitHub repository creation defaults to private. Sign-in is a user-dependent external step. Local development continues while pending.

## Acceptance and stop condition
The desktop and browser preview launch; all primary navigation and actions work; independent session history survives switching and reload; notes persist; provider boundaries and vault confinement tests pass; browser flows pass; production build passes; a Windows portable build is produced if packaging works. Live paid service calls need user-provided keys and are not claimed verified without them.

## Scope
Deliver one coherent first version. System-level process orchestration, CLI execution, OAuth, auto-updates, multitenant billing, native Obsidian plugin rendering, and published hosting are future work. No request authorizes activating attached master prompts against other chats.

## Sources checked
- https://github.com/IdreesInc/Monocraft — font and license.
- https://developers.openai.com/api/docs/guides/text — Responses.
- https://developers.openai.com/api/docs/models/gpt-6-sol — configurable OpenAI default.
- https://platform.claude.com/docs/en/api/messages/create — Messages.
- https://www.electronjs.org/docs/latest/api/safe-storage — OS-backed encryption.
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert — speech synthesis.
- https://elevenlabs.io/docs/api-reference/speech-to-text/convert — recorded transcription.
