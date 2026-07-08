# CV CLIP

CV CLIP is a local-first Chrome/Edge extension for clipping selected web content into Clairvoyance Notes through a small localhost bridge.

Windows-only for now. The MVP uses a local Node bridge between the browser extension and the filesystem; longer term, this could become a first-party Clairvoyance integration and drop the bridge entirely.

## Status

This is a `v1.0` MVP/spike baseline, not a packaged store release.

Validated so far:

- Local bridge starts on `127.0.0.1:43119`.
- Markdown notes are written under `%APPDATA%\clairvoyance\notes`.
- Create, update, append, folder-change, pairing-token, stale-token retry, and title-fallback flows are covered by local tests.
- Edge workflow logic has been validated through an extension-page harness.

Still caveated:

- A final true Edge side-panel user-gesture check remains outstanding.
- Clean-profile Chrome extension-load smoke testing remains outstanding.
- The pairing token is a lightweight internal-testing guard, not authentication and not a shipping security boundary.

## MVP Features

- Manifest V3 extension with a persistent side-panel workflow.
- Multi-page clipping into one running Markdown note.
- Folder picker rooted under the Clairvoyance notes folder.
- Local Node bridge for filesystem writes; the extension does not write files directly.
- Bridge-backed note create, update, and clip append.
- Folder changes on an existing saved draft create a new note in the selected folder instead of moving or mutating the old note.
- Smart note title UX:
  - editable title field with a real placeholder
  - `Use page title` helper
  - soft save nudge when saving with the placeholder title
- Source ledger deduplicated by URL.
- Lightweight APA/Harvard-style reference formatting support.
- CV theme sync groundwork.

## Requirements

- Windows
- Node.js
- Microsoft Edge or Google Chrome
- Clairvoyance installed locally

## Test Install

There is no packaged `.crx`, installer, or store listing yet. Test CV CLIP as an unpacked developer-mode extension.

Edge is the recommended first test target. Chrome should work as a Chromium target, but clean-profile Chrome smoke testing is still outstanding.

### 1. Start the bridge

Open PowerShell:

```powershell
cd path\to\cv-clip
npm install
npm run bridge:up
```

The bridge listens on `127.0.0.1:43119`, confines writes to `%APPDATA%\clairvoyance\notes`, and creates `notes\clips` automatically when needed.

Bridge lifecycle helpers:

```powershell
npm run bridge:status
npm run bridge:up
npm run bridge:stop
npm run bridge:restart
```

For foreground/debug mode, use:

```powershell
npm run bridge:start
```

Leave that terminal running while you test.

To check the bridge manually:

```powershell
Invoke-RestMethod http://127.0.0.1:43119/health
```

### 2. Load the unpacked extension in Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:

```text
path\to\cv-clip\extension
```

### 3. Clip a test selection

1. Open a normal web page.
2. Open the CV CLIP side panel from the extension/action button.
3. Confirm the bridge status is online.
4. Select text on the page.
5. Use CV CLIP to add the current selection.
6. Confirm a Markdown note appears under:

```text
%APPDATA%\clairvoyance\notes\clips
```

Repeat on two more pages to verify multi-page clipping into one active note.

### Chrome Smoke Test

Use the same process in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `path\to\cv-clip\extension`.

Chrome support is part of the MVP target, but the current `v1.0` baseline still needs a clean-profile Chrome smoke pass before calling it fully verified.

## Development Setup

Install dependencies if needed:

```powershell
npm install
```

Start the local bridge:

```powershell
npm run bridge:up
```

Load the extension during development:

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select the `extension/` folder from this repo.

## Usage

1. Start the bridge.
2. Open the CV CLIP side panel.
3. Choose a destination folder.
4. Select text on a web page.
5. Use the side-panel action, context menu, or keyboard shortcut to add the selection.
6. Continue clipping from additional pages into the same active note, or start a new note when the research topic changes.

## Commands

```powershell
npm run bridge:status
npm run bridge:up
npm run bridge:stop
npm run bridge:restart
npm run extension:check
npm run bridge:test
npm run bridge-client:test
npm run title:test
npm test
```

## Troubleshooting

- **Side panel says bridge is offline:** run `npm run bridge:status`, then `npm run bridge:up` or `npm run bridge:restart`.
- **No note appears:** check `%APPDATA%\clairvoyance\notes\clips`, then rerun `npm test` to verify bridge writes still work.
- **Extension does not appear after Load unpacked:** confirm you selected the `extension` folder, not the repo root.
- **Chrome behaves oddly:** close all Chrome windows and retry from `chrome://extensions`; Chrome may reuse an existing profile/session and ignore some launch assumptions.

## Bridge API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Bridge status and current lightweight write token |
| `GET` | `/folders` | List Clairvoyance note folders |
| `POST` | `/notes` | Create a Markdown note |
| `PATCH` | `/notes/:id` | Update a note |
| `POST` | `/notes/:id/clips` | Append a clip to an existing note |

## Security Notes

The `v1.0` bridge is suitable for trusted same-user MVP testing only.

The current write token is intentionally lightweight:

- `GET /health` returns the active write token.
- Originless local callers can obtain that token and write notes.
- Other installed Chromium extensions with localhost access may also be able to obtain the token and write notes.

That means the token helps prevent accidental writes from clients that do not know the current session token, but it does **not** protect against hostile local software, another extension, or another process running under the same user account.

Before broader daily use, the bridge should move to a stronger local trust model:

- do not expose the live write token from unauthenticated `/health`
- reject missing origins on browser write paths unless a separate authenticated local-client path exists
- pin browser callers to explicit extension IDs instead of trusting all `chrome-extension://` or `edge-extension://` origins
- add realpath/junction-aware filesystem confinement
- escape generated Markdown structure and allowlist safe source URL schemes

## Repo Layout

- `extension/` - Manifest V3 extension
- `bridge/` - localhost Node bridge
- `scripts/` - validation helpers
- `tests/` - smoke and behavior tests
- `archive/` - session history

## Limitations

- The bridge is manually started; no installer, service wrapper, or native host is included.
- The pairing-token model is intentionally lightweight and process-local; it is not meaningful protection against hostile local callers.
- Realpath/junction hardening and stronger caller binding are future hardening work.
- Browser validation is not yet complete enough to call this a daily-use release.
- Linux and macOS are not supported in this MVP.

## Future Ideas

- First-party Clairvoyance/PWA integration.
- Stronger local trust model or native messaging.
- Full browser-side workflow tests for Edge and Chrome.
- Image URL capture and optional local image mirroring.
- Folder suggestions based on domain or title.
- Send clips to an existing Clairvoyance note.
