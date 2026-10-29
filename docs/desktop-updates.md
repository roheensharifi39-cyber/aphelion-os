# Windows desktop updates

Install the `Aphelion-OS-<version>-setup.exe` release once. Desktop and Start Menu shortcuts point to the installed app. Portable copies remain manual-update backups.

Every push to `main` starts **Release Windows app** in GitHub Actions. It runs tests and the production build, packages a per-user NSIS installer, and publishes the installer, blockmap and `latest.yml` together to a GitHub Release. No GitHub credential is bundled in the public desktop app. Feature branches do not ship updates.

Release versions use the source package's major/minor and the release workflow's increasing run number (for example `0.3.1`, `0.3.2`). Raise the source major/minor for a new release line; do not reset the workflow's numbering. Re-running the same run replaces its artifacts, so use a new workflow dispatch when shipping a changed build.

Installed Windows apps check at startup and every 15 minutes while open. Stable newer versions download in the background with electron-updater's checksum validation. A Windows notification says when the update is ready. Closing the app installs it silently; the next launch uses the new version. There is no forced restart, downgrade, or prerelease installation. Offline failures retry at the next check and do not block the app. Diagnostics are in the app user-data folder's `updates.log`.

User data and the connected Obsidian vault stay outside the installation folder. The installer preserves app data. Credentials and account sign-in are local to the user. Development and automated-test copies skip checks.

The update feed is the public `roheensharifi39-cyber/aphelion-os` GitHub repository. Releases must remain public for token-free updates. Windows builds currently use the existing unsigned packaging configuration; no certificate checks are disabled in the updater.
