# Todo

- [completed] Add power-save blocker for downloads, extraction, and launch handoff
- [completed] Add library collections, tags, sorting, and batch actions
- [completed] Add Linux launch presets for global and per-game config
- [completed] Validate packaging and renderer behavior
- [completed] Make paused downloads resume cleanly after stale links and long delays
- [completed] Add custom extraction-close confirmation instead of silent quit/hide
- [completed] Surface interrupted extraction as install-ready on game pages
- [completed] Validate renderer and Electron changes for downloader recovery

## Notes

- `design-reference.md` does not exist in this repo, so implementation follows existing Electron/renderer patterns directly.
- Skip already-completed work: in-app updates, launch preflight, and overlay diagnostics.
- Current focus is downloader recovery after long idle periods and app-close behavior during extraction.

## Review

- Added a new sleep-prevention setting and main-process blocker lifecycle for downloads, extraction, and the first launch handoff window.
- Expanded the library with search, collection and tag metadata, last-played sorting, and batch actions for shortcut creation and deletions.
- Added shared Linux preset helpers so the global settings page and per-game Linux modal apply the same runner presets.
- Resume now refreshes per-app source links on demand, so long-paused UC.Files and Pixeldrain downloads no longer depend on stale signed URLs.
- Closing the app during extraction now routes through a custom renderer dialog, and approved quits preserve the download as install-ready instead of forcing a re-download.
- Game detail actions now expose an Install path for interrupted extractions, backed by a dedicated main-process handler that extracts already-downloaded archives.
- Verified the changed renderer and preload/main-process files with editor diagnostics and a successful `pnpm -s build:renderer` run.
- Activity now keeps interrupted extractions in a dedicated Install Ready section, with an explicit Install action instead of mixing them into ordinary completed downloads.
