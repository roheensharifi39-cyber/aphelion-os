# Product
<!-- impeccable:product-schema 1 -->
## Platform
web
## Product Purpose
Aphelion OS is a local AI workspace joining movable conversations, projects, and Obsidian memory in one continuous Neuron environment.
## Capabilities and Constraints
React and TypeScript, with a Vite browser preview and Electron desktop. The local runtime uses the official Claude Code and Codex clients and their actual sign-in state. Their standalone chat windows support Chat, Plan, and Build; project work requires a connected project. The main composer starts a fresh movable conversation, while each window continues its own thread. Missions coordinate the two local agents.

The ChatGPT menu opens General chat or Create image in floating windows. General chat defaults to the official Continue with ChatGPT subscription sign-in, including account-specific models and streamed replies. The user completes OpenAI sign-in and consent to use the plan; no API key is required for this route. Images default to native image generation through the installed Codex client and its ChatGPT subscription sign-in. Each window can explicitly select an optional API key instead; failed subscription requests never fall back to API billing. Credentials stay in the local engine: encrypted storage is used when available, an unavailable secure store permits session-only credentials, and local OPENAI_API_KEY takes precedence for the optional API route. The browser receives only sanitized connection state and a one-use local sign-in link; OAuth tokens and ID-token hints never cross the frontend bridge.

Claude, Codex, and ChatGPT sessions, drafts, selected context, and window placement are saved per vault. Closing a window keeps its conversation; saved chats can be reopened. Successful text replies are archived as readable Markdown under Aphelion/Conversations with a prompt-derived title and UUID. Related memory links include attached notes and the previous saved turn when available. An archive failure preserves the reply and reports a warning.

Generated PNGs are saved under Aphelion/Images when the vault is writable. Image previews have movable windows, Download and Close actions, and can reopen from their chat. IndexedDB caches image bytes separately from saved window metadata so previews can restore after reload. A missing cache reports an unavailable preview; it does not recreate the image.

Knowledge provides note search, editing, Markdown preview, tags, recent notes, graph selection, mission context, folder connection, and native Obsidian opening. Preserve draft and pending-write guards, stale-read protection, and revision conflict checks. The graph keeps all listed note metadata selectable while reading content for only the 32 newest notes. The overview renders up to 32 memory nodes, prioritizing a selected note, with links resolved from available real content. The vault path determines a stable scene seed; the surrounding particles remain a visual metaphor.
## Automatic Vault Memory
Text requests to Claude, Codex and ChatGPT, plus project missions, read background notes and query-relevant Markdown from the selected vault automatically on every turn. Context is bounded to 24,000 automatic excerpt characters and up to eight explicit pins. Source/archive/attachment/generated-conversation folders are excluded from automatic retrieval; pins remain available for exact reference. Notes are quoted data, not permission or higher-priority instructions. Runtime events list notes actually read, and saved reply links include the context used. Changing vault changes memory scope; chat mode does not need filesystem tools.

## Desktop Delivery
Windows installs use a per-user NSIS installer. Every push to main runs tests/build and publishes a versioned GitHub release with its update metadata. Installed copies check at launch and every 15 minutes, download stable upgrades, and install on normal app quit. Never force a restart during work. Preserve user data and vaults across installs. Portable, development and test copies skip automatic updates. See docs/desktop-updates.md.

## Brand Commitments
The supplied Neuron particle generator, black-and-white palette, pale Cormorant Garamond headings, Manrope reading text, and neutral smoked glass define the workspace. Preserve the source generator and stable per-vault form. The brand is the text-only aphelion OS label aligned at the left; the orbital SVG mark was removed. Keep the ghost cursor trail and native pointer; the dot grid was removed.
## Accessibility & Inclusion
The native cursor remains visible and effect canvases do not intercept input. Respect reduced motion and fine-pointer capability. Window movement and resizing support keyboard arrows as well as dragging. Keep visible focus, reachable controls, and scrollable small-screen surfaces. Semantic headings enter once; stable Markdown component identity must prevent polling or streaming updates from replaying the entrance. Body text remains steady.

## Confirmed Reference Composition
The vault particle environment fills the viewport, and low-opacity glass controls and working windows float over it. docs/design/aphelion-reference-v1.png remains a reference for this composition only. The supplied Neuron generator and black-and-white correction supersede its particle form and palette; the added ribbon atmosphere was rejected. Keep the scene continuous, with no enclosing scene card, giant headline, or opaque sidebar. Route-specific implementation details live in docs/design/workspace.md.
