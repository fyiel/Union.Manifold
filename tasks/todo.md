# Todo

## Mirror auth block policy (2026-03-30)

- [x] Trace Direct auth entry points that still target the active API base URL.
- [x] Reject mirror-domain auth requests in the Electron auth bridge with the main-site message.
- [x] Update the primary auth UI to show that mirror login is blocked.
- [x] Verify renderer diagnostics and `pnpm -s build:renderer`.

### Review

- Added a shared renderer auth-origin helper plus a reusable blocked-auth card, and now the app login, forgot-password, verify-email, and reset-password pages stop immediately with the main-site-only message when the active API base is a mirror.
- Hardened the Electron auth bridge so mirror-domain login, registration, password-reset, email-verification, and provider-link requests all reject before opening an auth window or posting credentials. OAuth-style flows also surface the same message through a native dialog for secondary login buttons that do not render inline errors.
- Verification: focused diagnostics reported no errors in the touched renderer and Electron files, and `pnpm -s build:renderer` completed successfully in 4.45s.

## Screenshot viewer quality + zoom + mobile nav fix (2026-03-30)

- [x] Audit game detail screenshot lightbox behavior and constraints.
- [x] Upgrade lightbox source to prefer higher-quality screenshot variants.
- [x] Expand lightbox canvas sizing and add zoom controls with keyboard support.
- [x] Fix previous and next navigation visibility on smaller screens.
- [x] Verify renderer diagnostics and summarize behavior changes.

### Review

- Updated game-detail screenshot lightbox URLs to prefer higher-quality IGDB variants (`t_original`) before proxying.
- Increased the lightbox canvas to `98vw/92vh` with a `1600px` image container cap to allow larger screenshot rendering.
- Added zoom functionality via buttons, mouse wheel, keyboard shortcuts (`+`, `-`, `0`), and click-to-zoom.
- Added drag-to-pan support when zoomed in, with bounded panning and drag-safe click behavior.
- Fixed small-screen navigation reliability by removing hidden side controls and adding mobile fallback prev/next controls in the bottom toolbar.
- Verification: editor diagnostics report no errors in `renderer/src/app/pages/GameDetailPage.tsx`.

## Hydra UX Phase 3.1 - UDL chrome polish

- [completed] Replace white enabled toggle tracks in Settings with zinc track color for contrast
- [completed] Align TopBar shell with shared glass utility and stronger blur depth
- [completed] Align DownBar shell with shared glass utility and matching chrome treatment
- [completed] Validate build with pnpm -s build:renderer

### Review

Settings toggles no longer flip to pure white tracks, which removes white-on-white glare and keeps contrast legible.
- Replaced repeated enabled track state classes from `bg-white` to `bg-zinc-300` for custom toggles in Settings.
- Updated TopBar shell container to use the shared `.glass` utility with consistent border and depth shadow.
- Updated both DownBar variants to use the same `.glass` shell treatment and hover behavior.
- Build verification passed: 1772 modules, built in 4.06s

## Hydra UX Phase 3 — Overlay toast configurability

- [completed] Add main-process overlay settings for toast duration and vertical anchor
- [completed] Persist new overlay settings through settings load/save and overlay IPC
- [completed] Update overlay renderer to honor dynamic toast duration and top/bottom anchoring
- [completed] Add Settings UI controls for toast duration and toast anchor
- [completed] Validate build with pnpm build:renderer

### Review

Overlay launch toasts are now configurable end-to-end from Settings.
- Added `overlayToastDurationMs` and `overlayToastVertical` to overlay runtime settings, IPC responses, and persisted app settings.
- Toast dispatch now includes duration and vertical anchor, and main-process auto-hide timing follows the configured duration.
- In-game overlay toast UI now uses configurable duration for progress/fade timing and can anchor at top or bottom.
- Settings page now exposes quick duration presets (3s, 5s, 8s) and top/bottom toast anchor controls.
- Overlay initialization now correctly loads persisted overlay settings even when overlay is disabled.
- Build verification passed: 1772 modules, built in 4.06s

## Hydra UX Phase 2 — Keyboard shortcut registry

- [completed] Create global keyboard shortcut hook for app-wide navigation/search/sort actions
- [completed] Wire global shortcut hook into app layout lifecycle
- [completed] Add Library sort-cycle event handling (Ctrl/Cmd+Shift+S on Library)
- [completed] Validate build with pnpm build:renderer

### Review

Keyboard shortcuts are now centralized in one hook instead of being scattered.
- Ctrl/Cmd+K opens global search popup
- Ctrl/Cmd+, opens Settings
- Ctrl/Cmd+1..4 jump to Browse, Library, Activity, Wishlist
- Ctrl/Cmd+Shift+S cycles Library sort mode (name -> recent-install -> recent-play)
- Shortcut handling safely ignores editable fields for non-search shortcuts
- Build verification passed: 1772 modules, built in 4.11s

## Hydra UX Phase 2 — Download batch controls

- [completed] Add context-level batch actions for download groups (pauseGroup, pauseAll, resumeAll)
- [completed] Add global Pause all and Resume all controls in Downloads page header
- [completed] Replace per-card loop pause handlers with shared pauseGroup action
- [completed] Validate build with pnpm build:renderer

### Review

Batch controls are now unified through the downloads context and exposed in the Activity header.
- Context API now includes pauseGroup(appid), pauseAll(), and resumeAll()
- Global controls are disabled automatically when no matching groups exist
- Group-level pause buttons now call the shared pauseGroup action for consistent behavior
- Build verification passed: 1771 modules, built in 4.04s

## Hydra UX Phase 1 — Toast system + UDL fixes

- [completed] Create renderer/src/context/toast-context.tsx (ToastProvider + useToast)
- [completed] Create renderer/src/components/Toaster.tsx (UDL pill toasts)
- [completed] Wire ToastProvider + Toaster into App.tsx
- [completed] Fix UpdateNotification.tsx UDL color violations (slate → zinc)
- [completed] Refactor SettingsPage.tsx: remove 8 inline feedback states, wire useToast
- [completed] Validate build with pnpm build:renderer

### Review

All Phase 1 items shipped and verified. Build: 1771 modules, 5.21s, zero TS errors.
- toast-context.tsx: useReducer-backed ADD/REMOVE, auto-dismiss after duration+800ms, throws if used outside provider
- Toaster.tsx: UDL pill (rounded-full, zinc, anim entry, opacity fade exit), bottom-center stack, CheckCircle2/XCircle/Info icons
- SettingsPage.tsx: 8 inline feedback states removed (updateCheckResult, linuxToolFeedback, slsToolFeedback, vrToolFeedback, clearDataFeedback, diagnosticsFeedback, devActionFeedback, bioSaved), all handlers wired to toast()
- UpdateNotification.tsx: slate-* → zinc-*, rounded-xl → rounded-2xl

## Previous work (all completed)

- [completed] Persist the remote catalogue and stats in the main-process LevelDB store with TTL-based refreshes
- [completed] Hydrate launcher and library game data from the persisted catalogue before hitting the website
- [completed] Align the launcher hero and card carousel behavior with union-crax.xyz

- [completed] Move download activity persistence from renderer localStorage to main-process LevelDB
- [completed] Add preload and type-safe IPC bridge for persisted download snapshots
- [completed] Migrate the downloads provider with one-time legacy snapshot import
- [completed] Validate diagnostics and renderer build after the persistence migration
- [completed] Mirror installing manifests into main-process LevelDB-backed launcher state
- [completed] Persist queued download metadata and restore it during app startup
- [completed] Repair the corrupted 7zip extraction close handler and revalidate the build

- [completed] Replace automatic archive cleanup with an explicit delete-archive prompt
- [completed] Make user-paused downloads stop queue auto-switching and auto-resume
- [completed] Validate archive-prompt and queue-behavior changes

- [completed] Make extraction cancel non-destructive and keep archives install-ready
- [completed] Align renderer cancel flows with preserved archive semantics
- [completed] Validate Electron and renderer download changes

- [completed] Seed archive installs into shared activity immediately
- [completed] Restore resume and pause controls for secondary activity groups
- [completed] Validate renderer diagnostics for the touched files

- [completed] Remove the extra gutter beside the custom shell scrollbar
- [completed] Apply the rounded custom scrollbar to the search suggestions popup

- [completed] Replace shell native scrollbars with a real custom scrollbar component
- [completed] Surface active download ETA in the down bar activity UI

- [completed] Remove the homepage reshuffle on focus and stabilize launcher refresh behavior
- [completed] Update launcher pagination to the current union-crax.xyz style
- [completed] Increase homepage game density and force website-style rounded scrollbars

- [completed] Fix custom title bar integration so it does not overlap the shell
- [completed] Restore full-width desktop content layout after the title bar change
- [completed] Make Chromium scrollbars match the rounded union-crax.xyz style

- [completed] Add power-save blocker for downloads, extraction, and launch handoff
- [completed] Add library collections, tags, sorting, and batch actions
- [completed] Add Linux launch presets for global and per-game config
- [completed] Validate packaging and renderer behavior
- [completed] Make paused downloads resume cleanly after stale links and long delays
- [completed] Add custom extraction-close confirmation instead of silent quit/hide
- [completed] Surface interrupted extraction as install-ready on game pages
- [completed] Validate renderer and Electron changes for downloader recovery
- [completed] Refresh the launcher shell and homepage UI around a desktop-first layout
- [completed] Remove website-style primary navigation and keep launcher flows in-app
- [completed] Rework the library page hierarchy, filters, and visual polish
- [completed] Validate the renderer build for the UI/UX refresh

## Notes

- `design-reference.md` does not exist in this repo, so implementation follows existing Electron/renderer patterns directly.
- Current focus for this pass is making the catalogue local-first with a Hydra-style persisted snapshot, and bringing the launcher sliders back in line with union-crax.xyz.
- Current focus for this pass is making archive installs show up in shared activity immediately and keeping paused secondary downloads resumable from the downloads page.
- Skip already-completed work: in-app updates, launch preflight, and overlay diagnostics.
- Current focus is downloader recovery after long idle periods and app-close behavior during extraction.
- Current focus for this pass was a launcher-style UI refresh: stronger shell, cleaner browse flow, and a more usable library surface.
- Current focus for this pass is correcting the custom window chrome integration, restoring the desktop content width, and forcing rounded Chromium scrollbars across the launcher shell.
- Current focus for this pass is removing the home-page reshuffle, updating pagination to the current website pattern, increasing homepage game density, and making the rounded scrollbar styling stick in Electron on Windows.
- Current focus for this pass is replacing the shell's remaining native scrollbars with a guaranteed custom scrollbar implementation and exposing ETA in the persistent down bar.

## Review

- Added a new sleep-prevention setting and main-process blocker lifecycle for downloads, extraction, and the first launch handoff window.
- Expanded the library with search, collection and tag metadata, last-played sorting, and batch actions for shortcut creation and deletions.
- Added shared Linux preset helpers so the global settings page and per-game Linux modal apply the same runner presets.
- Resume now refreshes per-app source links on demand, so long-paused UC.Files and Pixeldrain downloads no longer depend on stale signed URLs.
- Closing the app during extraction now routes through a custom renderer dialog, and approved quits preserve the download as install-ready instead of forcing a re-download.
- Game detail actions now expose an Install path for interrupted extractions, backed by a dedicated main-process handler that extracts already-downloaded archives.
- Verified the changed renderer and preload/main-process files with editor diagnostics and a successful `pnpm -s build:renderer` run.
- Activity now keeps interrupted extractions in a dedicated Install Ready section, with an explicit Install action instead of mixing them into ordinary completed downloads.
- Replaced the website-style top navigation with a launcher-first shell: persistent desktop rail, route-aware header, stronger background treatment, and no primary links that bounce users out to the web.
- Rebuilt the browse page around a spotlight hero, in-app quick actions, better search entry, and clearer catalogue stats so the launcher feels closer to a dedicated game hub.
- Reframed the library page into an overview dashboard plus control rail, while keeping the existing batch actions, collections, tags, and install-management logic intact.
- Corrected the custom window chrome pass by offsetting the fixed desktop rail beneath the title bar, restoring the main content column to `flex-1 min-w-0`, and hard-targeting Chromium scrollbar pseudos with rounded thumbs that match the website shell.
- Removed the launcher home-page reshuffle on window focus, updated pagination to the current website style with first/last controls, expanded the featured grid to a denser `auto-fill` layout with 30 items per page, and disabled Chromium overlay scrollbars so Electron can respect the rounded website scrollbar styling on Windows.
- Replaced the shell's remaining native scroll containers with a real Radix scroll area so the launcher uses guaranteed rounded custom thumbs, and surfaced active download ETA directly in the persistent down bar.
- Tightened the custom scrollbar track so it no longer leaves a dark gutter beside the thumb, and moved the search suggestions popup onto the same rounded scroll area implementation as the main shell.
- Manual archive installs now seed a shared download entry before extraction starts, so progress remains visible in the global activity UI even if the first backend update arrives late.
- Secondary activity cards now expose Resume when paused and Pause while active, and the primary activity card only flips to Resume when the whole group is actually paused.
- Added a persisted catalogue snapshot for games and stats in the main-process LevelDB store, exposed it over preload, and switched renderer catalogue consumers to hydrate locally before doing stale-while-revalidate refreshes.
- The launcher now reuses the persisted catalogue instead of cold-fetching the site on every startup, which keeps the library and homepage usable offline and reduces repeated calls to union-crax.xyz.
- Updated the launcher's card-carousel controls to the current union-crax.xyz styling and improved the hero slider with immediate fallback art, adjacent-slide preloading, and better keyboard/touch behavior.
- Verified the catalogue cache and slider changes with editor diagnostics and a successful full `pnpm -s build`.
- Verified the touched renderer files with editor diagnostics and a successful `pnpm -s build:renderer` run.
- Extraction cancel now follows Hydra's safer archive-management principle: stop the install, remove partial extracted output, keep the source archive, and return the item to Install Ready instead of deleting the archive from the installing folder.
- Updated the renderer cancel handlers to respect backend preservation results instead of force-marking preserved installs as cancelled.
- Verified the touched Electron and renderer files with editor diagnostics and another successful `pnpm -s build:renderer` run.
- Successful downloaded-archive installs now keep their installer cache and raise an explicit keep-or-delete archive prompt, instead of auto-deleting the archive or installer folder behind the user's back.
- User pause no longer auto-starts the next queued download, and an empty queue no longer auto-resumes paused downloads, so queue flow stays explicit and closer to Hydra's model.
- Verified the archive prompt and queue changes with editor diagnostics and another successful `pnpm -s build:renderer` run.
- Download activity snapshots now persist through a main-process LevelDB store, and the renderer performs a one-time import of the old `uc_direct_downloads` localStorage snapshot before removing that legacy copy.
- Verified the persistence migration with editor diagnostics, a successful `pnpm -s build:renderer`, and a direct `classic-level` open/read/write smoke test on Windows.
- Installing manifests now mirror into the same main-process LevelDB cache, and install queries hydrate from that cache instead of repeatedly scanning the installing folders on demand.
- Global and per-app queue state now persist alongside the launcher snapshot, restore on startup, and can resume scheduling against the active window after restart.
- Repaired an accidental patch splice inside the 7zip extraction close handler, restoring proper non-zero exit handling before re-running a successful full `pnpm -s build`.
