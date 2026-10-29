---
name: Aphelion OS
description: A black-and-white Neuron vault environment with a floating glass AI command center.
colors:
  field-graphite: "#333333"
  particle-white: "#ffffff"
  dust-silver: "#b8b8b8"
  scene-black: "#000000"
  background: "#050505"
  surface: "#151515"
  text: "#ededed"
  muted: "#aaaaaa"
  silver: "#cccccc"
  line: "#ffffff14"
  interface-white: "#f1f1f1"
  prompt-white: "#f1f1f1"
  focus: "#777777"
  input-background: "#101010"
  control-background: "#252525"
  control-hover: "#444444"
  connected: "#eeeeee"
typography:
  display:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-.025em"
  brand:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "29px"
    fontWeight: 400
    letterSpacing: "-.025em"
  prompt:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.35
  body:
    fontFamily: "'Manrope', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
  content:
    fontFamily: "'Manrope', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.8
  label:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "12px"
    fontWeight: 400
  utility:
    fontFamily: "'Manrope', sans-serif"
    fontSize: "11px"
    fontWeight: 400
rounded:
  badge: "4px"
  control: "6px"
  surface: "12px"
  floating: "15px"
  work-surface: "16px"
  composer: "19px"
  circular: "50%"
spacing:
  compact: "8px"
  control: "12px"
  surface: "20px"
  work-surface: "25px"
  desktop-edge: "28px"
components:
  utility-button:
    backgroundColor: "{colors.control-background}"
    textColor: "#e0e0e0"
    typography: "{typography.utility}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  utility-button-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "#ffffff"
  utility-button-prominent:
    backgroundColor: "#dddddd"
    textColor: "#111111"
    typography: "{typography.utility}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  utility-button-ghost:
    backgroundColor: "transparent"
    textColor: "#e0e0e0"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.input-background}"
    textColor: "#eeeeee"
    rounded: "{rounded.control}"
    padding: "9px"
  floating-glass:
    backgroundColor: "linear-gradient(125deg, #ffffff0d, #0a0a0a38)"
    rounded: "{rounded.floating}"
  composer:
    backgroundColor: "linear-gradient(125deg, #ffffff12, #10101033 60%, #08080833)"
    textColor: "{colors.prompt-white}"
    rounded: "{rounded.composer}"
    width: "61.4%"
  send-button:
    backgroundColor: "#ffffff13"
    textColor: "#ffffff"
    rounded: "{rounded.circular}"
    size: "42px"
    padding: "8px"
  workspace-switcher:
    backgroundColor: "#08080826"
    textColor: "#eeeeee"
    rounded: "{rounded.surface}"
    padding: "9px 14px"
  badge:
    backgroundColor: "#252525"
    textColor: "#dddddd"
    rounded: "{rounded.badge}"
---

# Design System: Aphelion OS

## Overview

**Creative North Star: "The Living Vault Observatory"**

Aphelion is a black observatory inhabited by the user's supplied Neuron particle form. Curling silver filaments, dendrite branches, and bright tip beads occupy the viewport; pale serif typography and thin neutral glass give the user a quiet place to act within it. The supplied Neuron generator and the explicit black-and-white correction are the authority for the particle form and palette. [The earlier reference image](docs/design/aphelion-reference-v1.png) remains a reference for the floating composition only: environment first, composer second, then peripheral agent and vault controls, then navigation.

The world is spacious at rest and becomes denser only when the user opens a working surface, response, inspector, or dialog. Glass remains visibly permeable to the environment. The sculpture is a vault metaphor; particles do not claim a one-to-one mapping to notes. Connection indicators, selected vaults, projects, and agent states must come from the actual runtime.

**Key Characteristics:**

- A continuous, full-viewport Neuron field with curling filaments, dendrite branches, tip beads, and open black space.
- Low-opacity peripheral glass with a slightly frostier command composer.
- Pale Cormorant Garamond paired with restrained Manrope utility and reading text.
- Slow procedural motion, exact spring heading entrances, and an additive fine-pointer ghost cursor trail.
- Quiet working controls with real state and explicit context attachment.

## Colors

A strictly neutral particle palette runs from graphite to white over black. Scene and interface colors begin in `src/monochrome.css`; the later workspace, floating desktop, and Knowledge styles define their current working surfaces. Frontmatter values are normative; complete material recipes live in the sidecar snippets.

### Primary

- **Field Graphite / Particle White:** The supplied Neuron field's endpoints; white highlights distinguish its fine branches and beads.

### Neutral

- **Dust Silver:** The source engine's faint ambient dust.
- **Scene Black:** The full-viewport environment behind the live graphics.
- **Background / Surface:** Neutral black and charcoal foundations for utility surfaces and fallback views.
- **Text / Muted / Silver:** Shared reading, supporting, and fine-detail roles.
- **Interface White / Prompt White:** Pale brand, navigation, panel titles, and composer text.
- **Line:** The inherited low-opacity white divider; floating surfaces use brighter translucent white edges.
- **Input Background / Control Background / Control Hover:** Compact tool surfaces and their immediate state response.
- **Connected:** White for confirmed connections; unconfirmed dots use darker gray. Text labels remain the source of meaning.
- **Focus:** A quiet one-pixel gray keyboard outline. Pointer clicks have no white focus flash; text entry uses a subtle inset line.

**The Monochrome Field Rule.** Keep Neuron, dust, provider marks, connection indicators, glass, and focus treatments neutral. Preserve the supplied generator's branching form.

**The Honest Signal Rule.** A status dot or label reports observed runtime state; a decorative particle never implies a real note or connection.

## Typography

**Display Font:** Cormorant Garamond, with Georgia and serif fallbacks. Local font packages load regular (400), medium (500), and regular italic (400).

**Body Font:** Manrope, with sans-serif fallback. Local assets load regular (400), medium (500), and semibold (600).

**Character:** The serif gives the world an astronomical, editorial delicacy. Manrope supports reading, configuration, and utility work. The immersive overview also uses the serif for navigation, provider names, selectors, and connection labels, as implemented; it is not an all-sans control surface.

### Hierarchy

- **Display:** Semantic work-surface headings use the display role. The overview has no giant hero headline. Shared headings have normal case, balanced wrapping, and no margin by default.
- **Brand:** The text-only aphelion OS label begins at the left header inset. The orbital SVG mark is removed. The label scales down with compact layouts.
- **Prompt:** The composer uses the prompt role in italic. It becomes (34px) at widths at least (1800px), (28px) at widths at most (1150px), (25px) at widths at most (600px), and (23px) at widths at most (390px).
- **Titles:** Intelligence is (21px) on desktop, while its provider names are (16px). The compact vault label is (14px), its “Obsidian” title (21px), and its state (13px).
- **Body and content:** Use the body role for the interface and the content role for overview responses. Markdown retains generous line spacing; source editing uses Consolas/monospace where implemented.
- **Labels and utilities:** Serif connection labels use the label role. Dense secondary tools use the utility role and preserve readable note content at (14px).

**The Heading Motion Rule.** Semantic headings use the shared Heading component and spring-text-engine pinned to (0.1.5), with its @react-spring/web peer. The entrance runs once: opacity (0 → 1), scale (1.4 → 1), blur (6px → 0px), tension (200), friction (24), and word stagger (55ms). Reduced motion renders ordinary visible headings. Body copy stays static. Markdown renderer identities stay stable so streaming and telemetry updates cannot remount settled headings. Center the engine's flex container only for centered headings; retain left alignment elsewhere.

## Layout

The overview is one full-viewport environment (100dvh) with controls suspended at its edges. Its final minimum height is (0), so short screens keep the composer reachable within the actual viewport. The field is fixed edge to edge beneath all interface layers. The overview main surface passes pointer input through empty space; actionable glass surfaces explicitly receive it.

The desktop header is (86px) tall with (28px) side padding. Brand and three navigation actions sit at the upper left; vault/project switches occupy the upper right. The Intelligence panel starts at (10vh), sits (28px) from the right, and uses `clamp(230px, 16.6vw, 285px)` width. The vault panel is (218px) wide at the left edge and sits above the composer at (22vh) from the bottom. The composer is centered using (19.3%) insets on both sides, yielding the frontmatter width, and sits (4.3vh) above the bottom. Its prompt region starts at (76px) minimum height; the option bar starts at (58px). Scene controls sit at the lower left.

At widths at most (1150px), composer side insets become (15%); at (850px), they become (6%) and the header wraps to (113px). At (600px), composer insets become (16px), its bottom offset becomes (6vh), and the header stacks to (137px). Intelligence becomes a compact collapsed disclosure by default; vault and scene controls remain reachable. Mobile navigation, switchers, composer selectors, and attachment actions receive at least (40px) height; scene controls are at least (34px) square and Intelligence disclosure targets at least (32px) square. The (390px) adjustment tightens navigation and attachment labels. At widths at least (1800px), outer edge alignment becomes (2%).

A short-desktop rule at heights at most (650px) reduces header and composer height. For landscape screens at heights at most (500px) and widths at least (601px), the header is a single (64px) row, Intelligence sits at (76px) from the top, and the vault panel sits (35vh) above the bottom. The composer shifts to (25%) left and (4%) right insets with a (16px) bottom offset; its prompt minimum height is (50px). This prevents the landscape controls from competing for the same central space.

Secondary tools use scrollable glass working surfaces over the same fixed world, with (25px) inner padding and (28px) side margins on desktop. Mobile tools tighten to (15px) padding and (12px) margins. Main-composer sends create independent floating chat windows. Each window has its own scrollable exchange, composer, name, mode, context selection, and saved placement; closing it keeps it available in the saved-chat tray.

**The Continuous Environment Rule.** Keep the overview's environment full bleed. Do not wrap it in a visualization card, bordered hero, opaque sidebar, statistics strip, or dashboard card grid.

## Elevation & Depth

Depth comes primarily from layered particles, dark spatial pockets, thin translucent tint, and selective backdrop blur. Peripheral glass uses blur (15px) with saturation (0); the composer uses blur (22px) with saturation (0). Switchers use blur (14px) with saturation (0), scene controls blur (10px), and popovers, responses, secondary work surfaces, and dialogs blur (25px) with saturation (0). These differences preserve the distinction between light peripheral controls and a more readable active work surface.

### Shadow Vocabulary

- **Floating glass:** A soft ambient shadow plus a faint inset highlight; use the exact `floating-glass` sidecar recipe.
- **Popover:** A compact local depth shadow, with the exact `glass-popover` shadow token in the sidecar.
- **Dialog:** A broader ambient shadow establishes modal priority. Its backdrop darkens and softly blurs the world.
- **Utility controls:** Flat at rest and on hover; no inherited block shadows, bevels, or hover lifts.

**The Thin Material Rule.** Preserve visible scene continuity through glass. Resolve readability through local tint and brightness control, not opaque panels or decorative glow.

## Shapes

Use fine one-pixel boundaries, modest rounded rectangles, and circular send/status details. The frontmatter radius scale distinguishes compact controls, surface controls, floating panels, secondary work surfaces, and the broad composer. At mobile widths, the composer adopts the floating radius and compact panels adopt the surface radius. Status dots and the send action are circular. The vault crystal identifies Obsidian; the brand remains plain text. Icons are small functional controls rather than repeated decoration.

## Components

### Buttons

Primary overview action is the circular send control with a translucent silver fill and fine bright outline. It grows brighter immediately on hover. Disabled send is visibly subdued (opacity .62); active work replaces the arrow with a stop action and a brighter neutral fill. Secondary tool buttons use the utility recipe, with an immediate tonal hover and no movement; ghost buttons remove the resting fill and border. Keyboard-focusable controls receive a quiet one-pixel gray outline with (3px) offset. Pointer focus has no bright white highlight.

### Inputs / Fields

Utility inputs use the compact control radius, dark input fill, pale text, and a thin translucent edge. Placeholders are visibly muted. The composer field is borderless within the glass shell, uses the italic prompt style, and uses a subtle inset gray line during text entry. Its option bar has a fine horizontal divider. Advanced model/reasoning and context selection open in compact popovers above the composer; the resting state stays shallow.

### Navigation

Overview, Knowledge, and Sessions use quiet serif labels with generous spacing. Active navigation has pale text, a fine fading silver underline, and a small light-catching dot. Header switchers are compact smoked glass with a thin icon, ellipsized active name, and disclosure mark. They invoke actual folder/project actions. Mobile reflows the switches to their own row and preserves all three navigation labels.

### Chips / Tags

Secondary utility badges use the badge recipe, a one-pixel translucent border, and small sans-serif text. They are supporting status details rather than overview decoration. Note context selection stays explicit and removable in the context popover.

### Floating Panels / Work Surfaces

The shared floating material defines Intelligence, vault identity, and the composer. Intelligence is a compact provider list with honest state labels; on mobile, its disclosure controls the list. The vault identity opens Knowledge. Standalone chat windows hold their real conversations and independent drafts. Sending from the main composer starts a fresh window; typing inside a window continues that thread. Secondary tools use a denser neutral charcoal work surface; nested panels stay tonally subordinate.

### Living Vault Environment

The user's supplied Neuron generator is preserved verbatim in `src/lib/particle-field/generators.ts`. Its main field uses `neuron`, base seed (690702840) combined with the normalized vault path for a stable per-vault form, particle size (2.7), speed (1.4), opacity (.7), graphite/white endpoints from the frontmatter, bloom strength (.75), radius (.08), threshold (.21), and camera autorotation off. The source camera retains its (40°) field of view and landscape home distance (4.8). Portrait framing uses min(12, 4.8 × max(1, .9 / aspect)) to keep the branching silhouette visible; resize preserves relative user zoom, and Reset view restores the current responsive home distance. Its original sampling, normalization, branching, and procedural motion define the form.

The main particle count is (250,000) on desktop or (150,000) for coarse pointers or widths below (700px). A measured desktop average above (.042s) over (120) samples reduces the count to (125,000). A single main Points object renders the generator output alongside the source engine's (2,600) ambient dust points. There is no separate ribbon atmosphere, repeated echo geometry, or extra exposure override. Actual notes become selectable points; existing wiki links provide visible connections. Note/reply development adds a bounded growth scale of up to (16%). Small pointer translation remains; the managed rendering loop owns the source animation.

Scene controls offer drag-to-orbit, plus/minus zoom, reset, and persistent pause. Initial rendering settles directly into the final composition. Reduced motion freezes environmental time and uses no heading entrance or cursor effect. Motion freezes away from Overview, rendering skips hidden documents and out-of-view scenes, and pixel ratio is capped at (2). WebGL failure shows a visible status while working controls remain accessible.

### Additive Cursor Field

The native arrow, pointer, and text cursors remain visible. A single fixed, aria-hidden, pointer-transparent canvas owns the ghost trail in one managed frame loop. The dot-grid warp is removed. It runs only for `(hover: hover) and (pointer: fine)` with reduced motion off. Six (26px) arrow ghosts follow with head factor (.26), increasing blur to (5px), and opacity scaled by `min(1, distance / 13)` so they disappear at rest. Hover uses `closest('a, button, input')`. Media-query changes, listeners, observers, frames, workers, and graphics resources have cleanup paths.

## Do's and Don'ts

### Do:

- **Do** keep the luminous vault environment dominant, continuous, and visible through peripheral glass.
- **Do** preserve the reference's open space, edge-aligned controls, and broad shallow composer.
- **Do** use actual runtime state and real vault/project actions for every visible control.
- **Do** keep note attachment deliberate and show the selected context before sending.
- **Do** use the exact shared heading entrance, native cursor, visible keyboard focus, and reduced-motion fallbacks.
- **Do** preserve the supplied Neuron generator, stable vault-specific seed, source camera, and neutral palette.
- **Do** preserve the stylesheet layering: legacy scaffold, observatory, immersive, monochrome, workspace interactions, and floating desktop. Knowledge overrides stay scoped to its route.

### Don't:

- **Don't** enclose the overview environment in a card, hero panel, opaque sidebar, card grid, or statistics strip.
- **Don't** add a giant marketing headline, heavy neon, thick outlines, or ornamental panel glow.
- **Don't** replace the live WebGL environment with the reference image as a flattened background.
- **Don't** restore the rejected ribbon atmosphere or use the earlier image to override the supplied Neuron form and black-and-white palette.
- **Don't** describe decorative particles as individually mapped notes.
- **Don't** fabricate ready/connected labels or treat ChatGPT website sign-in as an OpenAI API connection. General chat uses official subscription sign-in and images use the native Codex client by default; the API alternative and website link stay explicit.
- **Don't** replace the supplied heading spring with CSS keyframes, CSS transitions, or a different animation library.
- **Don't** hide or replace the native cursor, intercept input with effects, or run pointer decoration on touch/coarse devices.

## Floating Workspace and Knowledge

Floating chat windows use a neutral (67%) charcoal tint, a (28px) backdrop blur, a thin translucent boundary, and (14px) corners. Default geometry begins at (400 x 420px) and is constrained to the viewport. A compact header provides name editing, a drag handle, minimize/restore, and Close. Arrow keys move or resize through the corresponding handles. Closing preserves the conversation and its per-vault draft, mode, context, and position. Messages scroll independently above the window composer. Main-composer sends can run concurrently in separate windows.

The ChatGPT disclosure opens General chat or Create image. General chat defaults to Continue with ChatGPT subscription sign-in; Create image defaults to Codex subscription image generation. A compact connection surface offers an explicit API key alternative and account-specific ChatGPT models. No credentials are kept in browser storage and failed plan requests never silently use an API key. Generated images open in separate movable previews with Download and Close actions. Image bytes live in IndexedDB for preview restoration and are saved in Aphelion/Images by the local engine when possible. A chat's Open image action restores a closed preview.

Knowledge uses one clear heading, persistent search, Notes/Recent/Tags/Context/Graph, and a library/editor split. At (700px) and below, Library is a disclosure; short screens scroll to the note actions. Keep the mounted editor's draft, late-read, pending-write, and revision guards. The graph indexes content for the newest (32) notes while retaining all listed metadata candidates; the overview draws up to (32) real nodes and promotes a selected note. Ordinary particles remain a visual metaphor.

Successful text turns archive under Aphelion/Conversations with readable prompt titles and collision-safe UUIDs. The active vault owns its saved Claude/Codex/ChatGPT windows and scene identity. See [the workspace surface brief](docs/design/workspace.md) for interaction behavior.
