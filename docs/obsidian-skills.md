# Obsidian skills in Aphelion

The six skills from [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) are installed for Codex at `~/.codex/skills/`. They become discoverable on the next conversation turn. Installation used the Codex skill installer and pinned upstream commit [`3ccff5338ea700537839b21900aa5358a0402c98`](https://github.com/kepano/obsidian-skills/tree/3ccff5338ea700537839b21900aa5358a0402c98), reviewed on October 29, 2026.

| Skill | Use in this project |
| --- | --- |
| `obsidian-markdown` | Create compatible vault notes with properties, tags, wikilinks, embeds, and callouts. Use this first when changing note authoring or conversation memory. |
| `obsidian-bases` | Author native `.base` views for notes, tasks, projects, or conversation archives when requested. Validate YAML, formula names, and missing properties. |
| `json-canvas` | Author native `.canvas` project maps and research boards when requested. Validate unique IDs and every edge reference. |
| `obsidian-cli` | Work with the native Obsidian app when a task needs its commands. Discover the installed command set with `obsidian help` and explicitly select the intended vault. |
| `defuddle` | Extract readable web articles into Markdown for a requested research or clipping workflow. |
| `knap` | Turn structured data into consistent Markdown notes with templates, including optional Defuddle output. |

## Current integration

Aphelion's vault adapter reads and writes local Markdown directly. Conversation memory already uses frontmatter tags, a creation time, readable headings, and wikilinks to selected notes and the previous saved turn. This agrees with the Markdown skill; installation needs no change to saved notes or the filesystem adapter.

Use the Markdown skill when extending Knowledge or the archive writer. Keep generated notes within the selected vault, retain revision checks, preserve existing content, and connect related notes with wikilinks. Choose ordinary Markdown for content that must render in Aphelion's current preview; the native Obsidian app remains the complete renderer for Obsidian extensions.

The installed skills are development guidance for Codex. They are not an Obsidian plugin, and installation does not inject their instructions into every Claude, Codex, or ChatGPT request. The app's existing Chat, Plan, and Build modes retain their tool permissions.

## Native formats and optional tools

Knowledge currently indexes and edits `.md` files. Its particle field represents the bounded Markdown graph; installing these skills does not add a Bases or JSON Canvas renderer. Create those formats through a specifically requested authoring workflow and open them in Obsidian, rather than passing them to the Markdown editor.

The Obsidian CLI requires a running Obsidian app and its CLI to be enabled and available. The `obsidian`, `defuddle`, and `knap` commands were not on this session's PATH when checked. Defuddle and Knap are not app dependencies; install their CLIs only when a workflow needs them. The six installed skill directories contain Markdown instructions and references, with no executable hooks.

## Examples for follow-up work

- “Use obsidian-markdown to make saved conversations easier to link and search.”
- “Use obsidian-bases to create a conversation archive view in my selected vault.”
- “Use json-canvas to turn these selected project notes into an Obsidian canvas.”
- “Use defuddle and knap to save this article as a consistently formatted research note.”

For a specific file-writing request, read the matching installed `SKILL.md` and its relevant references, confirm the target vault through the existing app selection, and validate the resulting format. Do not treat an installed skill as a request to edit personal vault content.
