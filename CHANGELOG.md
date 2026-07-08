# Changelog

All notable changes to CV CLIP are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Pending
- True Edge side-panel user-gesture validation.
- Clean-profile Chrome extension-load smoke test.
- Browser-level title UX validation for `Use page title`, `Save anyway`, reopen, and autosave.
- Stronger local trust model for the bridge: no token exposure from unauthenticated `/health`, stricter origin handling, and explicit extension-ID allowlisting.
- Realpath/junction-aware notes-root confinement.
- Markdown escaping and safe source URL scheme validation.

---

## [1.0.0] — 2026-07-08 — MVP Baseline

### Added
- Windows bridge lifecycle helpers:
  - `npm run bridge:status`
  - `npm run bridge:up`
  - `npm run bridge:stop`
  - `npm run bridge:restart`
- Manifest V3 extension scaffold:
  - side panel UI
  - content script for selected-text capture
  - context menu and keyboard command plumbing
- Local Node bridge on `127.0.0.1:43119`.
- Bridge-backed note persistence:
  - create notes
  - update notes
  - append clips to existing notes
  - create a new note when the selected folder changes during a saved session
- Safe notes-root path resolution under `%APPDATA%\clairvoyance\notes`.
- Automatic `notes\clips` folder creation.
- Lightweight pairing-token guard on bridge write endpoints for accidental-misuse reduction during MVP testing.
- One bridge-session refresh and one request retry on stale-token `401`.
- Smart note title UX in the side panel:
  - editable placeholder/default title behavior
  - `Use page title` action for the active browser tab
  - soft save nudge for unchanged placeholder title with `Save anyway` vs `Edit title`
- `README.md`

### Tested
- Manifest validation script.
- Bridge smoke tests (`tests/bridge.smoke.js`) covering:
  - Token rejection
  - Persisted clip append and update
  - Notes-root path confinement
- Bridge-client behavior tests (`tests/bridge-client.behavior.js`) covering:
  - folder-change new-note behavior
  - stale-token retry
  - placeholder-title save followed by append
- Title-logic behavior tests (`tests/title-logic.behavior.js`) covering placeholder, effective-title, and save-nudge rules.
- Edge workflow logic through an extension-page harness, including three clips into one note and folder-change copy behavior.
- Code review by Max; security/architecture review by Nova.

### Decisions
- Bridge binds to `127.0.0.1` only
- All filesystem writes confined to `%APPDATA%\clairvoyance\notes`
- Extension does not write local files directly; all writes go through the bridge
- MVP bridge is manually started; extension-launched lifecycle is deferred
- One Markdown note per clipping session with explicit New Session action
- Source ledger entries deduplicated by URL

### Known limitations
- Pairing-token protection is intentionally lightweight and is not a final security boundary.
- The current token can be obtained from `/health`; hostile local processes or other extensions with localhost access should be assumed able to write notes.
- True side-panel user-gesture validation in Edge remains outstanding.
- Clean-profile Chrome extension-load smoke testing remains outstanding.
- APA/Harvard-style reference formatting is lightweight, not citation-grade.
