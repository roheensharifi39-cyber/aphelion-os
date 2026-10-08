# Aphelion OS V1 design

The direct user request and later corrections are authoritative. Attached reports, video and screenshots are reference material. The final screenshot supersedes the earlier visual reference. The requested repository is aphelion-os; use existing Claude/ChatGPT subscriptions without API keys; no sidebar; keep the actual Obsidian vault in front; deliver a working, animated local application.

## Accepted product

A three-column cockpit: stacked amber Claude and cyan Codex panels, a mint animated voxel orchestration core and project modules in the center, and a purple Obsidian graph/editor plus live activity on the right. A measured system strip sits above; the prompt and Minecraft-style launch button sit below. Monocraft body text and Pixelify Sans headings are local font assets. SVG lights, orbiting blocks and network packets react to engine heartbeat and actual mission events. Reduced motion is respected.

Every control has a concrete action. Projects selects/creates a local folder. Files reads source. Terminal runs curated commands. Automations invokes explicit package recipes. Vault views index actual Markdown, resolve wiki links, select context, safely edit notes and open the installed Obsidian app. Workbench, workflows, settings and voice use top controls and a bottom hotbar.

## Engine and agents

React/TypeScript runs in either a sandboxed Electron renderer or the live loopback browser. Both connect to the same shared local engine. Electron uses allowlisted IPC; browser uses origin/session-protected RPC and server-sent events. There are no prepared replies or demo fallback.

The engine discovers the official Claude Code and Codex clients and checks subscription authentication. Tokens stay in the clients; paid API credentials and host-agent capabilities are removed from child environments. Prompts pass through stdin with shell parsing disabled. Chat has no filesystem tools. Plan inspects without changes. Build is scoped to the selected canonical project using official client workspace permissions.

A mission performs Claude plan → Codex implementation → available actual test/build checks → Markdown receipt in the connected vault. An agent response is not proof of completion: effects and commands are observed, failed checks reject completion, and cancellation preserves partial output while stopping owned processes. Missing clients, sign-in failures, usage limits and platform restrictions are surfaced honestly.

## Real data

CPU/memory come from OS sampling. Network counters measure local engine traffic. Process rows list real engine, agent, project and Obsidian PIDs. Job/activity states come from process/runtime events. No invented counts or completion percentages are shown.

Obsidian detection uses installed paths, process discovery and registered vault metadata. Integration is through the official URI and plain Markdown filesystem watching; no vault plugin or account API is required. Existing vaults and security settings are preserved. Only explicit context selections are included in agent prompts.

Preferences/default vault live under %APPDATA%/aphelion-os. Conversations live in client-local storage. Note operations enforce path confinement, visible Markdown files, size limits, symlink rejection and revision checks. Project browsing is confined to the selected canonical root. Packaged desktop has context isolation, sandboxing and no renderer Node access.

## Acceptance evidence

Unit and integration tests prove local commands, filesystem safety, auth filtering, event contracts, mission failure/cancellation, watching and transport checks. Browser interaction tests use a complete external bridge fixture to avoid subscription or personal data effects. Desktop smoke uses an isolated real filesystem profile and actual processes. Real signed-in provider calls are checked separately. Build and portable packaging must pass before delivery.
