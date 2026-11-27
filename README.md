# Google Drive Sync

Google Drive Sync provides secure, frictionless, and zero-server synchronization between your local Obsidian vault and Google Drive across desktop and mobile devices.

Designed around a local-first philosophy, the plugin establishes a direct connection between your device and Google Drive without routing your notes through any proprietary intermediate backend or proxy servers. Your files, revision metadata, and authentication tokens remain strictly between your Obsidian client and your personal Google account.

For users demanding complete confidentiality, Google Drive Sync includes optional zero-knowledge end-to-end encryption (E2EE). Vault files are encrypted locally using AES-256-GCM and PBKDF2-SHA256 before upload, ensuring that neither Google nor anyone else can inspect your notes without your master passphrase.

Built-in safety features protect against data loss in multi-device workflows: visual side-by-side conflict resolution ensures conflicting edits are never overwritten silently, Google Drive revision history allows restoring older snapshots on demand, and resilient network retry mechanisms ensure reliable syncing even on unstable mobile connections.

## Features

- **One-click connect**: Sign in with your Google account in seconds.
- **Automatic sync**: Sync notes in the background, or manually on demand.
- **Conflict resolution**: Compare conflicting changes side by side without losing notes.
- **Version history**: Browse and restore past revisions from Google Drive.
- **Activity log**: View real-time sync actions in a dedicated sidebar view.
- **Exclusion rules**: Ignore specific files or folders.
- **Optional end-to-end encryption**: Encrypt notes with AES-256 before uploading to Google Drive.
- **Direct and private**: Direct transfer to Google Drive. No third-party servers, no tracking.

## Getting started

1. Install and enable **Google Drive Sync** from Community plugins.
2. Select **Connect with Google Drive** in the plugin settings.
3. Approve access in your browser.

Your vault is connected and ready to sync.

## How to use

- **Sync**: Click the sync icon to upload changes, or enable automatic sync in settings.
- **Revisions**: Right-click any note and select **Google Drive: Version history** to restore older versions.
- **Activity**: Open the sync log view to inspect uploaded or deleted files.
- **Conflicts**: If a note is edited on two devices at once, a comparison window lets you pick what to keep.

## Privacy

- Files stay inside your vault.
- Direct connection to Google Drive only.
- No analytics, telemetry, or accounts required.
