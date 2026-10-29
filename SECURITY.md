# Security and privacy boundaries

Aphelion stores its vault, conversations, preferences and provider credentials on the user's computer. Source code and public Windows releases do not include those user-data folders. Installing someone else's copy of Aphelion does not connect it to the developer's vault or computer.

## Data sent to AI providers

Aphelion is not an offline AI model. Sending a chat or mission sends the prompt and included vault excerpts to the selected provider through its official client or API. Automatic memory includes background and relevant notes from the selected vault. Chat tools are disabled; Plan and Build intentionally allow the selected agent to inspect the connected project. Do not select an unrelated personal folder as a project.

Automatic memory excludes folders named `Private`, `Secrets`, or `Credentials`, plus notes with `private: true` or `aphelion_context: exclude` in YAML frontmatter. An explicit pin deliberately shares that note, including an excluded one. These retrieval exclusions do not restrict project tools in Plan/Build and are not a replacement for keeping credentials outside project folders.

## Local access

The desktop renderer is sandboxed, uses isolated IPC, and does not listen for incoming HTTP requests. Notes render without executable raw HTML, and the content policy blocks remote tracking images. The development browser preview binds only to loopback, rejects foreign origins for engine calls, uses an ephemeral session cookie, and disallows framing and cross-origin response reads.

The development preview is for a trusted local machine. Another local program can request its loopback bootstrap; it is not an authentication boundary against local malware or other local users. Close the preview server when not developing and use the installed desktop app for personal work. Neither version protects against a compromised operating-system account.

Credentials use Windows current-user encryption/Electron secure storage when available; otherwise connections are session-only. Credentials are not returned through the renderer bridge. Vault notes and local conversation storage are ordinary local data, not an encrypted database.

## Builds and updates

Installed updates come from this repository's public GitHub Releases over HTTPS, with updater checksum verification. The app downloads a newer stable version and installs on quit. Trust in updates includes trust in the repository account and GitHub build pipeline. Windows builds currently have no publisher signing certificate, so checksums alone are not independent publisher authentication. Keep repository accounts protected with strong authentication.

GitHub secret scanning and push protection are enabled. CI also scans Git history for secrets and checks known dependency advisories. Passing those checks is evidence of the checks performed, not a guarantee that no vulnerability exists.

Do not put credentials, private notes, or account data into public issues, screenshots, commits or release assets. Report sensitive findings privately to the repository owner.
