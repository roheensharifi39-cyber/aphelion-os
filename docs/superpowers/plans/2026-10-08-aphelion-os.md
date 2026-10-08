# Aphelion OS Implementation Plan

> **For agentic workers:** Use executing-plans for inline implementation and one independent whole-project review. Steps use checkbox syntax.

**Goal:** A runnable Minecraft-inspired desktop AI workspace with working sessions, notes, workflows and voice.

**Architecture:** React/TypeScript renderer, sandboxed Electron preload, main-process provider and vault services. Browser preview uses a clearly labeled local demo bridge. Keys are encrypted outside the renderer.

**Tech Stack:** React, Vite, Electron, TypeScript, react-markdown, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-aphelion-os-design.md`

## Global Constraints
- Pixel typography throughout: locally bundled Monocraft, with its SIL OFL license.
- Never place provider keys in renderer storage, bundles, source control, or logs.
- Browser preview accepts no secrets; live connections use the desktop bridge.
- Do not silently fall back to demo on provider failures.
- Notes must remain inside the selected vault.
- GitHub repository creation defaults to private.

## Review Focus
- Agent switching while a response is pending must update the correct session.
- Provider errors must retain the user's prompt and expose an actionable error.
- Path traversal and symlink/junction escapes must not expose external files.
- External note edits must not be overwritten by stale editor content.
- Reload and session changes must preserve histories and local notes without keys.

### Task 1: Provider and vault boundaries
**Files:** `electron/services.mjs`, `electron/vault.mjs`, `tests/services.test.mjs`, `tests/vault.test.mjs`.
**Interfaces:** `runChat(request, config, {fetchImpl, onDelta, signal}) → {text, demo, usage}`; `listNotes(root)`, `readNote(root,path)`, `saveNote(root,note)`; provider config contains `keys`, `models`, `voiceId`.
- [ ] Write and run failing tests for real SSE chunk decoding, provider request/auth, errors, traversal, symlink escape, note read/write and stale-write preservation.
- [ ] Implement bounded services and rerun the suite.

### Task 2: Desktop bridge and persistent workspace
**Files:** `electron/main.cjs`, `electron/preload.cjs`, `src/types.ts`, `src/lib/bridge.ts`, `src/lib/workspace.ts`, `scripts/dev.mjs`.
**Interfaces:** `AphelionBridge`: status/configure/chat/cancel/onDelta/vault read-write/voice/repo/window methods. Workspace holds session IDs, agent ownership, messages, and demo notes; settings hold no secrets.
- [ ] Write and run session-isolation and persistence tests.
- [ ] Build explicit IPC boundaries, encrypted settings, and browser demo behavior.
- [ ] Verify renderer types and Electron launch.

### Task 3: Pixel workspace interface
**Files:** `src/App.tsx`, `src/components/*`, `src/pages/*`, `src/styles.css`, `public/landscape.svg`, `public/fonts/*`, `tests/e2e/workspace.spec.ts`.
**Consumes:** Task 2 bridge and workspace.
- [ ] Write browser acceptance tests for launch, navigation, chat isolation/reload, demo labels, note saving, workflow execution and keyboard palette.
- [ ] Implement home, chat, vault, workflows, voice, settings, palette and hotbar; preserve pending-task session ownership.
- [ ] Run browser acceptance tests and inspect desktop/mobile screenshots; fix visible layout defects.

### Task 4: Delivery
**Files:** `README.md`, `.github/workflows/ci.yml`, `playwright.config.ts`, lockfile.
- [ ] Run all tests and production build; independently review changes and address significant findings.
- [ ] Package a portable Windows app, exercise the packaged desktop and verify encryption/status boundaries.
- [ ] Create and populate the requested GitHub repository when authentication is available; otherwise report the precise external blocker and preserve a ready local Git project.
- [ ] Deliver preview and launcher with concise setup instructions and verified limitations.
