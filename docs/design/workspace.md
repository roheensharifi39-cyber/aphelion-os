# Workspace surfaces

Mode: **Operate**. Applies to the Overview, floating conversations and image previews, and Knowledge. This brief records the implemented surface strategy; DESIGN.md owns the shared visual system and PRODUCT.md owns product behavior.

## Direction contract

**Thesis:** Keep the supplied monochrome Neuron environment continuous while conversations and notes become usable floating work surfaces.

**Own world:** Black space, silver branching particles, pale Cormorant Garamond headings, Manrope reading and controls, and thin smoked glass. The brand is left-aligned text without an orbital SVG. Retain the ghost cursor trail and native pointer; omit the removed dot grid.

**Story:** The vault persists as the user moves between thinking, agent work, generated images, and saved notes. The selected vault owns its conversations and scene identity.

**First viewport:** Text brand and navigation at the upper left, actual vault/project switches at the right, peripheral Intelligence and vault identity, a broad shallow composer below, and independently placed saved chat windows when open.

**Form:** Independent movable/resizable chat and image windows over one scene. Knowledge is a single contained work surface with persistent search, a library/editor split, and optional discovery views. Phone layouts disclose the library; short layouts scroll to their actions.

**Interaction:** Main-composer sends start a fresh chat window. A window's composer continues that conversation. Window state, draft, mode, and attached notes belong to the saved conversation. Headings enter once; streaming and polling leave existing text steady.

## Overview and floating desktop

- Claude and Codex use the local official clients and their real subscription/sign-in state. Standalone windows support Chat, Plan, and Build; Plan/Build require a project. Each window can be moved, resized, renamed, focused, minimized, closed, and reopened from saved chats. Move/resize handles also accept arrow keys, with Shift for a larger step.
- The main composer offers Claude, Codex, and ChatGPT. ChatGPT exposes Chat and Create image modes; sending opens a new named floating window and submits there through the existing provider route. Chat and image drafts are saved independently per vault. A missing connection keeps the submitted prompt in its new window for sign-in and retry.
- The ChatGPT disclosure opens General chat or Create image. General chat defaults to official ChatGPT subscription OAuth with a Continue with ChatGPT action, account-specific model choices, and streamed replies. Images default to the installed Codex client's native image generator using its subscription sign-in. A window can explicitly choose API key (optional) as an alternative; errors never silently change the billing route. A separate link opens the ChatGPT website.
- The engine keeps API and OAuth credentials encrypted when secure storage is available, with a session-only fallback otherwise. OPENAI_API_KEY takes precedence only on the optional API route. The renderer receives connection status and model IDs, never stored keys or OAuth tokens. Browser sign-in opens through an expiring one-use local relay; the user reviews OpenAI's permission screen.
- Local workspace metadata persists Claude/Codex/ChatGPT sessions, per-chat contexts, drafts, and window placement per normalized vault path. Closing/minimizing preserves the record; switching back restores that vault's workspace.
- Successful text replies create Markdown notes at Aphelion/Conversations/<readable prompt title> - <UUID>.md, linked to attached context and an available previous turn. Saving failure preserves the reply and surfaces a warning.
- Generated PNGs are written to Aphelion/Images when possible. A separate image window supports Download and Close; its chat's Open image action reopens it. IndexedDB stores preview bytes by vault and image ID, while the workspace stores small metadata. Restoring a missing cache produces an unavailable state, without generating a replacement.

Default windows begin at (400 × 420px) with a staggered position. Image windows request (420 × 450px). The viewport constraint enforces margins, available height, and a minimum working size. The header is (45px), reducing on phones and short screens; messages scroll independently. Exact constraints live in src/lib/desktop.ts and src/components/FloatingWindow.tsx.

## Knowledge

One Knowledge heading and vault identity lead Notes, Recent, Tags, Context, and Graph. Search remains discoverable. Notes opens by default and provides folder connection, new note, library selection, Markdown source/preview, context quoting, and Save. Discovery views use real note rows plus a selected-note preview and Open in Obsidian action.

The editor stays mounted across views. Preserve unsaved-draft and pending-write guards, request ordering, draft-version checks against late reads, revision conflict detection, and Ctrl/Cmd-S. A cosmetic change must not reset note identity or replace newer typing with a delayed result.

The desktop library occupies roughly one quarter of the editor width. At (700px) or less, it moves behind a Library disclosure; search remains visible and searching reveals results. Knowledge is fixed within viewport insets, with a dedicated short-screen outer scroll so Save remains reachable. Its scoped styles remove the duplicate route background sheet without changing other tools.

## Vault visualization and data limits

The original Neuron generator is preserved. A normalized vault path derives a stable seed from the original base; changing notes does not randomize the form. Notes, real edges, and completed local-agent replies influence a modest development scale.

The overview positions up to (32) recent notes from the real graph and prioritizes the selected note. Its anchors and the memory inspector open actual note content. The graph service retains every note returned by the metadata scan as a selection candidate but reads full content only for the (32) newest notes. Resolved wiki/Markdown links and tags therefore reflect this bounded content index. Knowledge's optional SVG graph shows up to (24) notes. Do not imply all particles are files, that every metadata entry is rendered, or that every vault link has been indexed.

## Stability and sources

The shared Heading component owns the once-only spring entrance and reduced-motion fallback. Markdown renderers are defined once at module scope, preserving component identity across streaming, polling, and unrelated state updates. The ghost-trail canvas is additive and never replaces or captures the native pointer.

Implementation evidence: src/App.tsx, src/components/FloatingDesktop.tsx, src/components/FloatingWindow.tsx, src/components/VaultHub.tsx, src/pages/Vault.tsx, src/components/Markdown.tsx, src/components/Heading.tsx, src/components/CursorField.tsx, src/components/VaultField.tsx, src/lib/desktop.ts, src/lib/workspace.ts, src/lib/vault-visual.ts, electron/openai.mjs, electron/runtime.mjs, and electron/graph.mjs.
