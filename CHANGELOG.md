# Changelog

## Version 1.8.0 - 2026-04-16

### Fixes & Improvements

- Fixed Linux CI failures in `rebuild-native` by making `electron/native/binding.gyp` platform-aware: Windows-only native sources now compile only on Windows.
- Added non-Windows native stubs (`electron/native/stubs_nonwin.cpp`) so the addon still links and loads on Linux/macOS, with unsupported Windows-only features returning clear runtime errors.

## Version 1.7.3 - 2026-04-16

### Fixes & Improvements

- Replaced all inline per-handler feedback states in Settings with a centralized UDL toast system. Toasts appear as pill-shaped notifications at the bottom of the screen (rounded-full, zinc palette, anim entry, fade exit) with contextual icons for success, error, and info states.
- Fixed UDL color violations in the update notification banner: replaced all slate-* Tailwind classes with their zinc equivalents and corrected rounded-xl to rounded-2xl.
- Removed eight stale state declarations from SettingsPage (updateCheckResult, linuxToolFeedback, slsToolFeedback, vrToolFeedback, clearDataFeedback, diagnosticsFeedback, devActionFeedback, bioSaved) and all associated JSX feedback blocks.
- Added centralized batch download controls in the downloads context: pauseGroup(appid), pauseAll(), and resumeAll().
- Added global Pause all and Resume all actions in the Activity header, with automatic disabled states when no eligible groups exist.
- Updated primary and secondary active download cards to use the shared pauseGroup action for consistent queue and pause semantics.
- Added a global keyboard shortcut registry for launcher navigation and command actions: Ctrl/Cmd+K (search), Ctrl/Cmd+, (settings), and Ctrl/Cmd+1..4 (Browse, Library, Activity, Wishlist).
- Added a Library productivity shortcut: Ctrl/Cmd+Shift+S cycles sort mode between Name, Recent Install, and Recent Play.
- Updated keyboard handling to skip non-search shortcuts while typing in editable inputs, reducing accidental route jumps.
- Added configurable in-game overlay toast behavior with Settings controls for toast duration (3s/5s/8s) and vertical anchor (top/bottom), plus persisted runtime propagation through main-process overlay IPC.


## Unreleased - 2026-03-24

### Fixes & Improvements

- Refreshed the renderer shell with a launcher-first layout: persistent left navigation, route-aware top chrome, stronger visual treatment, and removal of website-style primary links that only redirected users out of the app.
- Reworked the home page into a desktop launcher surface with a spotlight panel, in-app quick actions, clearer stats, and a faster search entry flow.
- Improved the library UX with a new overview header, better filter rail hierarchy, cleaner search and selection controls, and upgraded card styling for installed and installing titles.
- Polished shared renderer surfaces including navigation cards, game cards, typography, background treatments, and the bottom activity bar so the app feels more cohesive and less like a wrapped website.
- Fixed single-instance behavior so launching the app a second time (e.g. double-clicking the exe) always brings the existing window to the foreground rather than opening a second window. If the app is hidden in the tray it is restored automatically.
- Fixed Windows focus-stealing prevention blocking the restore: the second-instance handler now briefly sets `alwaysOnTop` to force the window to the front, then immediately clears it.
- Added a splash screen shown immediately on launch while the main window loads.
- Added automatic domain detection on startup: the app probes `union-crax.xyz` and the mirror domains in order, picks the first reachable one, and pre-configures the renderer to use it before any requests are made. This ensures the app works on networks that block the primary domain.
- Added mirror domains `hardquestions.explosionlearning.org` and `note-tool.study` to the candidate list for automatic failover.
- Splash screen shows live status text during domain detection ("Checking union-crax.xyz...", etc.) so users know what is happening on slow networks.

## Unreleased - 2026-03-18

### Fixes & Improvements

- Added a sleep-prevention option that keeps the launcher awake during downloads, extraction, and the first part of game launch handoff.
- Added library organization tools with collections, tags, recent-install and recent-play sorting, plus batch actions for shortcut creation and cleanup.
- Added shared Linux launch presets in both global settings and the per-game Linux configuration modal.
- Added install-ready recovery flows for interrupted archive installs, including a dedicated Activity section, game-page install action, and a main-process path that can continue from already-downloaded archives.
- Improved download recovery across restarts and long pauses by normalizing stuck manifest states, refreshing stale resume links, preserving resumable paused states, and teaching the UC.Files engine to resume from per-chunk checkpoints instead of trusting preallocated file size.
- Fixed development shutdown behavior so Ctrl+C and other terminal stop signals trigger a graceful Electron quit, preserving partial downloads and pause state the same way packaged builds do.
- Fixed interrupt handling so paused or interrupted downloads reopen as resumable instead of failed, while interrupted extraction work is surfaced as install-ready rather than forcing a full re-download.
- Improved close and quit behavior around active work, keeping normal window-close as a tray hide while still protecting real app quits and persisting download or extraction state correctly.
- Improved archive install handling by reusing a shared extraction job, tracking extraction state in manifests, cleaning up downloaded archives after successful installs, and exposing install-from-downloaded-archive APIs through preload and renderer types.
- Fixed Windows game launches that could start hidden with audio only by disabling hidden-window startup for tracked game processes.
- Improved desktop shortcut consistency and executable detection by using shared shortcut naming and filtering out more helper, anti-cheat, crash-reporting, and engine-side executables from launcher picks.
- Removed the admin-launch system; games now launch with standard user-level permissions. The launcher maintains all other functionality including executable auto-detection, desktop shortcut creation, and process tracking.
- Fixed UC.Files compatibility after the stricter hotlink-protection rollout by making the desktop client recognize UC.Files host aliases when selecting mirrors, resolving signed download URLs, and choosing the native range downloader.
- Fixed Electron-authenticated API calls so the UC.Files resolver endpoints receive the same `X-UC-Client` identity header as the download APIs.
- Fixed the website direct-download flow to keep showing the UC.Files button when a mirror is already a signed `/dl/` URL instead of only handling landing-page `/f/` links.

## Version 1.3.0 - 2026-03-08

### Features & Improvements

- **UC.Files (files.union-crax.xyz) added as in-app download host**:
  - Resolves via server-side `UCFILES_API_KEY` - no Turnstile, no browser-based auth
  - Full resume support via HTTP Range requests
  - Set as the default download host in settings

- **Parallel range download engine for UC.Files**:
  - Bypasses Chromium's single-connection downloader entirely
  - Opens 6 concurrent HTTP Range connections against the same signed `/dl/` token URL
  - Achieves ~11 MB/s aggregate throughput (vs ~2–5 MB/s with a single connection)
  - Pre-allocates the output file and writes each connection's bytes at the correct offset
  - Progress reported every 500ms with smoothed speed and ETA
  - Pause/resume/cancel fully supported - pause blocks all worker connections, resume wakes them all atomically
  - File-size integrity check after all chunks complete before extraction begins
  - Falls back to Chromium's downloader if the server doesn't return `Accept-Ranges: bytes`
  - Strict 206 validation and `Content-Range` header verification to prevent corruption

- **Bug fixes**:
  - Fixed data corruption caused by Chromium caching parallel Range requests - all fetch calls now use `cache: 'no-store'` and `Cache-Control: no-cache` headers to force fresh per-worker connections
  - Fixed "UC.Files link could not be resolved" false error - main process now sends an immediate `status: 'downloading'` update before the async parallel download starts, preventing the renderer from re-triggering resolution
  - Fixed already-resolved `/dl/` token URLs being re-resolved (returning `resolved: false`) - `resolveUCFilesDownload` now short-circuits for `/dl/` URLs
  - Fixed missing splash image and screenshots after UC.Files downloads - `migrateInstallingExtras` now runs before archive extraction, moving cached metadata images from `installing/` to `installed/`
  - Fixed file descriptor leak on cancel/abort - `fd` is now closed in a `try/finally` path

- **Archive install system** - new universal drag-and-drop / file-picker dialog for installing games from local archive files:
  - Support for `.7z`, `.rar`, `.tar`, `.gz`, `.tgz`, and multipart archives (`.7z.001`, `.7z.002`, etc.)
  - Automatic sibling part detection when only `.001` is selected
  - 6-step modal wizard: choose method → select files → confirm → install → done/error
  - Live progress tracking with speed, ETA, and extraction status
  - Modal can be closed during extraction; process continues in background
  - Installed games are registered in the manifest with file inventory

- **Web-only host guidance** - when in-app hosts (Pixeldrain, FileQ, Rootz) have no alive links but external hosts do:
  - Shows "Not available in-app" modal instead of false "all dead" message
  - Lists available web-only hosts (VikingFile, DataVaults, etc.)
  - 3-step guide: visit game page on website → download → come back and install from archive
  - Archive install option always available as fallback
  - Server-side check for web-only hosts; responsive UI on both availability states

- **UI/UX improvements**:
  - Download button now disabled when selected host has no parts (shows "Host unavailable")
  - Archive extract progress capped at 99% until completion (prevents > 100% display)
  - DownloadCheckModal message is context-aware (distinguishes "truly unavailable" from "not on in-app hosts")

- **Removed deprecated hosts**:
  - DataVaults removed from in-app download options (broken/non-functional)
  - Support for `.zip` archives removed; `.7z` is the primary format
  - Host list simplified to Pixeldrain, FileQ, Rootz (all marked retiring)

- **Website (union-crax.xyz)**:
  - "Download via UC.Files Direct" button now correctly shown in bin-links modal
  - UC.Files no longer shows "retiring" tag
  - Host normalization correctly maps `files.union-crax.xyz` → `UC.Files`

### Files touched

#### New
- `union-crax.xyz/app/api/ucfiles/resolve/route.ts` - server-side resolver: parallel-fetches metadata + signed DL token, returns `{ url, filename, size }`
- `renderer/src/components/ArchiveInstallModal.tsx`

#### Modified (UnionCrax.Direct)
- `electron/main.cjs` - `ucfilesParallelDownload`, `handleUCFilesDownloadComplete`, `isUCFilesUrl`, `ucfilesActiveDownloads` map; cancel/pause/resume IPC handlers extended for parallel downloads; `hasAnyActiveOrPendingDownloads` includes UC.Files active downloads; `uc:pick-archive-files` and `uc:install-from-archive` IPC handlers; extraction polling with live progress updates
- `electron/preload.cjs` - exposed archive install methods to renderer
- `renderer/src/vite-env.d.ts` - TypeScript types for archive install APIs
- `renderer/src/lib/downloads.ts` - `ucfiles` host type, `resolveUCFilesDownload`, `extractUCFilesFileId`, `isUCFilesUrl`, `isUCFilesDlTokenUrl` (short-circuit for already-resolved tokens), `pickHostLinks`, `resolveDownloadSize`; removed DataVaults, added `webOnlyHosts` to AvailabilityResult
- `renderer/src/lib/settings-constants.ts` - `ucfiles` added to `MirrorHost` type and `MIRROR_HOSTS` as first entry (default)
- `renderer/src/components/DownloadCheckModal.tsx` - UC.Files in `HOST_OPTIONS`, `hostMatchesKey` helper for case-insensitive matching; web-only host guidance, improved messaging, disabled state handling

#### Modified (union-crax.xyz)
- `app/api/downloads/check-availability/route.ts` - `APP_HOSTS` includes `ucfiles`; matching is case-insensitive with non-alphanumeric stripping; universal web-only host detection (routes unsupported hosts to separate `webOnlyHosts` object), parallel HEAD checks with 12s timeout
- `lib/url-utils.ts` - `files.union-crax.xyz` → `UC.Files` in `knownHosts`
- `components/bin-links-modal.tsx` - `isUCFilesHost` helper, UC.Files excluded from retiring tag, direct download button shown

## Version 1.1.3 - 2026-02-24

### Features & Improvements

- **Simplified NSFW reveal system** - replaced the three-state hover-based system with a clearer two-state toggle:
  - **Toggle OFF**: images are blurred (`blur-xl brightness-50`) with a "Reveal" button overlay that unblurs the specific game for the current page session
  - **Toggle ON**: NSFW covers show immediately with no blur - no more intermediate hover-to-unblur state that looked identical to OFF
  - **Session reveals now truly ephemeral** - clicking "Reveal" on a blurred cover now adds the game to an in-memory `Set` instead of `sessionStorage`, so reveals reset on every page refresh (not just when closing the tab). This prevents the "mom walked in" scenario where refreshing the page is the natural escape hatch.
  - **Updated settings label** - changed from "NSFW hover reveal / Allow NSFW covers to unblur on hover" to **"Show NSFW covers / Unblur NSFW game cover images"** to reflect the new direct-reveal behavior

### Files touched

#### Web (union-crax.xyz)
- `lib/nsfw-session.ts` (new shared in-memory Set)
- `components/game-card.tsx`
- `components/game-card-compact.tsx`
- `components/quick-view-modal.tsx`
- `app/settings/page.tsx`

#### Desktop (UnionCrax.Direct)
- `renderer/src/lib/nsfw-session.ts` (new shared in-memory Set)
- `renderer/src/components/GameCard.tsx`
- `renderer/src/components/GameCardCompact.tsx`
- `renderer/src/app/pages/SettingsPage.tsx`

## Version 1.1.2 - 2026-02-21

### Features & Improvements

- **Synced flow with new backend** - updated application to work seamlessly with the new backend infrastructure, ensuring smooth communication and data synchronization across all features

### Fixes & Improvements

- **Fixed download payload type validation in Electron** - the `uc:download-start` and `uc:download-resume-with-fresh-url` IPC handlers now defensively coerce non-string `url` values (e.g., persisted `DownloadHostEntry` objects from old builds) to strings before calling `.includes()`, preventing "url.includes is not a function" errors ([#15](https://github.com/Union-Crax/UnionCrax.Direct/issues/15))
- **Fixed stale download restoration from localStorage** - download items persisted by older builds that had `url` as an object (`{url: string, part: number|null}`) are now sanitized on app startup, extracting the string URL before resuming
- **Added type coercion in resolveDownloadUrl** - the `resolveDownloadUrl` function now coerces non-string `url` inputs at entry point, ensuring old persisted state can never produce a falsely-resolved download URL object

### Files touched (UnionCrax.Direct)

- `electron/main.cjs`
- `renderer/src/context/downloads-context.tsx`
- `renderer/src/lib/downloads.ts`

## Version 1.1.1 - 2026-02-20

### Fixes & Improvements

- **Fixed exe picker opening in wrong folder** - the exe picker browse dialog was opening inside the version-specific subfolder (e.g. `versions/latest_b537082/`) instead of the game's root folder. The `listGameExecutables` IPC now returns a separate `gameRoot` field pointing to the top-level game folder, which is used as the default path for both the launch flow and the gear-icon exe picker.
- **Fixed Play/Download Now button flickering** - resolved a logic error in `isSelectedVersionInstalled` where the button would briefly flash "Download Now" then change back to "Play", even when the game was fully installed. Current versions are now always treated as installed.
- **Added game launch failure detection and modal** - when a game exits within 12 seconds of launch (indicating a failed start), a helpful modal now appears suggesting to:
  - Check that the correct executable is selected via the gear icon
  - Enable "Launch as Administrator" (Windows only, shown only if not already enabled)
  - The modal displays the actual game name being launched instead of a hardcoded example
- **Improved launch tracking** - replaced hardcoded 5-second timeout with a timestamp-based 12-second detection window, so normal game exits that take longer won't falsely trigger the failure modal. The window automatically expires after 12 seconds.
- **Fixed admin launch UX** - when a user declines a UAC prompt, the launcher now correctly fails rather than silently falling back to a non-admin launch, giving clear feedback that admin privileges are required.
- **Fixed false quick-exit modal on Windows** - removed the cmd.exe wrapper from non-admin Windows launches, which was causing all GUI games to immediately trigger the "couldn't start" modal (cmd.exe exits quickly when launching GUI apps). Games now launch directly and are tracked correctly.
- **Improved IPC listener cleanup** - launch tracking listeners are now properly subscribed and unsubscribed, eliminating listener leaks across multiple game launches.

## Version 1.1.0 - 2026-02-20

### Features

- **New game page and game card design** - redesigned the game detail page and card components for an improved user experience
- **Settings page redesign** - replaced the monolithic scrolling settings layout with a modern two-column sidebar navigation system
  - Added sticky sidebar with four organized sections: Account, Downloads, Game Launch, and Advanced
  - Each sidebar item shows descriptive text for quick identification
  - Update check button moved to sidebar footer for easy access
  - Eliminates endless scrolling while preserving all existing functionality
- **Linux gaming and VR support** - added comprehensive support for Windows games on Linux via Wine/Proton, and set up SteamVR/OpenXR for VR games ([#14](https://github.com/Union-Crax/UnionCrax.Direct/pull/14))
  - Added `ucLinux` and `ucVR` IPC APIs in the Electron preload script
  - Introduced `LINUX_SETTINGS_KEYS` and `VR_SETTINGS_KEYS` constants for persistent storage
  - Implemented comprehensive UI controls in SettingsPage for Wine/Proton and VR runtime configuration

## Version 1.0.1 - 2026-02-16

### Fixes & Improvements

- **Removed noisy settings logs** - removed `Setting get: ...` messages from application logs that were cluttering output on every preference access.
- **Download queue state fix** - Resolved a bug where pausing the current download would inadvertently trigger the next queued game to start download.
- **Scoped pause controls** - The global pause button in the download bar is now correctly scoped to the active game group, preventing it from incorrectly pausing unrelated downloads.
- **TypeScript type safety fixes** - resolved multiple build errors in the downloads context:
  - Added missing `versionLabel` to the main process `start()` IPC payload type in `vite-env.d.ts`.
  - Fixed host selection type mismatch in `downloads-context.tsx` by correctly casting the resolved download host to `PreferredDownloadHost`.
  - Fixed state narrowing issues where `"queued"` status was being widened to `string` during object spreads in `resumeGroup`.

### Files touched (UnionCrax.Direct)

- `electron/main.cjs`
- `renderer/src/context/downloads-context.tsx`
- `renderer/src/components/DownBar.tsx`
- `renderer/src/vite-env.d.ts`

## Version 1.0.0 - 2026-02-16

### Features

- **Download resume actually works across app restarts** - previously, closing the app and resuming a download would restart it from byte 0, even for 10 GB files. The entire three-level resume system has been overhauled:
  - **Partial file preservation** - Chromium deletes partial download files when it cancels DownloadItems during app quit. The app now creates instant hardlinks (`.ucresume` backup files) in `before-quit` so the downloaded data survives. On next launch, resume handlers automatically restore the backup if the original was deleted.
  - **Level 3 resume with fresh URL** - when the stored URL chain has expired (CDN links rotate), the app re-resolves a fresh URL and now uses `createInterruptedDownload` with the actual file offset from disk instead of calling `downloadURL()` from byte 0. This sends a proper `Range` header so the server returns only the remaining bytes.
  - **`savePath` propagation** - the download start payload now carries `savePath` through to `pendingDownloads`, so `will-download` reuses the existing partial file path instead of generating a new one.
  - **URL chain matching fix** - `will-download` now matches against the full stored `urlChain` array, fixing a bug where redirect chains caused the pending download entry to be missed.
  - **Backup cleanup** - `.ucresume` files are automatically cleaned up when downloads complete, are cancelled by the user, or when the original file is still present.

- **Discord Rich Presence advanced options** - added collapsible advanced settings for Discord RPC customization:
  - **Hide NSFW content** - option to mask NSFW game names as "****" when viewing or downloading NSFW games (automatically detects games with "nsfw" genre while keeping the RPC activity visible)
  - **Show game name** - toggle display of game titles in your status
  - **Show activity status** - control whether your current activity (downloading, playing, browsing) is shown
  - **Show buttons** - control visibility of "Open on web" and "Download UC.D" buttons

- **New improved version selector & Version management** - enhanced version selection and management system

### Fixes & Improvements

- **Developer mode settings behavior** - disabling Developer Mode now reverts the API base URL to the default (union-crax.xyz) while preserving the custom URL setting. Re-enabling Developer Mode reapplies the previously saved custom URL. The Reset button now permanently clears the custom URL setting and returns to the default URL for fresh use.
- **Game launching from Downloads page** - fixed issue where launching downloaded games from the Downloads page would show the app ID instead of the game name in Discord Rich Presence. The launch function now properly looks up the game name from the games data before passing it to the main process.
- **Discord RPC settings sync to account** - advanced Discord RPC settings (Hide NSFW, Show game name, Show status, Show buttons) are saved to the user's account database and automatically restored when logging into different devices or reinstalling the app.
- **Loading animation during game fetch** - fixed brief flash of "No games available" error message during initial game loading. Added loading state management with debounce to ensure loading skeleton remains visible until games are fully loaded from the database.
- **Files touched (UnionCrax.Direct)**
- `electron/main.cjs`
- `electron/preload.cjs`
- `renderer/src/context/downloads-context.tsx`
- `renderer/src/vite-env.d.ts`
- `renderer/src/app/pages/SettingsPage.tsx`
- `renderer/src/hooks/use-discord-rpc.ts`
- `renderer/src/app/pages/GameDetailPage.tsx`
- `renderer/src/app/pages/DownloadsPage.tsx`
- `renderer/src/components/GameCard.tsx`
- `renderer/src/app/pages/LauncherPage.tsx`

### Files touched (union-crax.xyz)

- `app/api/account/preferences/route.ts`

## Version 0.9.2 - 2026-02-13

### Features

- **FileQ & DataVaults hosts visible (coming soon)** - FileQ and DataVaults now appear in the host selector and network tests, marked as "soon". Download support for these hosts will be enabled in a future update once mirrors are populated.

### Fixes & Improvements

- **Generalized download resolution errors** - resolution failure messages are no longer Rootz-specific and will report the failing host name for clearer diagnostics.
- **Preferred host handling** - preferred-host override logic now uses the exported supported-hosts list instead of hardcoded checks, making it future-proof for added hosts.
- **Network tests extended** - the built-in network test now probes FileQ and DataVaults endpoints as part of mirror diagnostics.

### Files touched (UnionCrax.Direct)

- `renderer/src/lib/downloads.ts`
- `renderer/src/components/DownloadCheckModal.tsx`
- `renderer/src/context/downloads-context.tsx`
- `electron/main.cjs`

## Version 0.9.1 - 2026-02-12

### Features

- **Version selector in downloads** - users can now choose which version to download when multiple archived versions are available. The selected version label is displayed throughout the download flow (in the downloads page, active downloads, completed downloads) so users always know which version they're downloading.
- **Installed version tracking** - downloaded version is now persisted to the install manifest and displayed on the game detail page as "Installed version". When a newer version is available on the API, both "Installed version" and "Latest version" are shown separately, making it easy to see if an update is available at a glance.
- **Version info in downloads activity** - the downloads page now shows the version label for each download:
  - Primary active download hero section displays version
  - Queued download groups show version label before part count
  - Completed downloads show the downloaded version (from the DownloadItem) instead of always showing the latest API version
  - Failed/cancelled downloads show version in the status line

### Fixes

- **Download cancel not working** - when clicking cancel during a multi-part download, the download continued after cancellation with the file growing in the downloads folder. Root cause: the cancel handler only checked `activeDownloads` and queues but never checked `pendingDownloads` (the limbo state between Electron's `downloadURL()` and `will-download` firing). Fixed by checking all 5 states (active, pending, app queues, global queue, and newly added `cancelledDownloadIds` tracking set). Also fixed pixeldrain delay race condition where a delayed download couldn't be cancelled during its timeout period. Now immediately cancels downloads that were cancelled while pending.
- **Verbose download logs missing** - when "Verbose download logging" was enabled in settings, download progress wasn't being logged. `sendDownloadUpdate` was logging every single progress tick (hundreds/second) via `uc_log`, creating duplicate/concatenated output. Fixed logging to distinguish between settings: when verbose is OFF, only log state transitions (started, completed, cancelled, failed); when ON, log compact summaries per update (ID, status, bytes, speed, filename). Prevents log flooding while keeping useful diagnostics available.
- **"Don't show this again" toggle simplified** - removed the per-download "don't show this again" toggle from the link checker modal. Modal now always shows before download unless "Skip link availability check" is disabled in Settings. This ensures users always see link status before committing to a download, unless they explicitly opt out via settings. Removed `dontShowAgain` from DownloadConfig type and related `dontShowHostSelector` bypass logic.

### Files touched

- [electron/main.cjs](electron/main.cjs)
- [renderer/src/lib/downloads.ts](renderer/src/lib/downloads.ts)
- [renderer/src/context/downloads-context.tsx](renderer/src/context/downloads-context.tsx)
- [renderer/src/components/DownloadCheckModal.tsx](renderer/src/components/DownloadCheckModal.tsx)
- [renderer/src/app/pages/GameDetailPage.tsx](renderer/src/app/pages/GameDetailPage.tsx)
- [renderer/src/app/pages/DownloadsPage.tsx](renderer/src/app/pages/DownloadsPage.tsx)
- [renderer/src/app/pages/SettingsPage.tsx](renderer/src/app/pages/SettingsPage.tsx)
- [renderer/src/app/pages/LibraryPage.tsx](renderer/src/app/pages/LibraryPage.tsx)

## Version 0.9.0 - 2026-02-12

### Features

- **Automatic link availability checker** - before downloading, the app now verifies that all download links are alive via server-side HEAD checks. A modal displays per-host health with color-coded indicators (🟢 all alive, 🟡 some dead, 🔴 all dead) and shows exact part counts (e.g. "7/15 parts alive"). Prevents wasted time on games with dead links by catching issues before download starts.
- **Smart cross-host fallback** - when multi-part games have dead parts on your selected host, the modal shows exactly which parts are dead and offers one-click "Use Pixeldrain" / "Use Rootz" buttons to download individual dead parts from an alternative host where they're alive. Fully transparent about what's dead and where to get it.
- **Per-part status indicators** - each downloadable link shows a live status dot (🟢 alive, 🔴 dead) updated during the download check, so you can see at a glance which specific parts are problematic before commitment.
- **Dead parts messaging** - when a part is dead on every available host, the modal clearly states "dead on all hosts" and suggests reporting the broken link on the game page or trying the website (which may have more mirrors). For unavailable games, shows a prominent message encouraging users to report dead links.
- **Version selector in modal** - games with multiple archived versions now show a dropdown to choose specific versions to download, making it easy to grab older builds without navigating away from the download flow.
- **"Don't show this again" toggle** - the availability check modal includes a checkbox to skip the dialog on future downloads, going straight to your preferred host while still protecting against obviously dead games (fully unavailable titles still show the error).
- **Settings: Skip link checks entirely** - new toggle in Settings → Download checks to disable availability checking completely for users who prefer to download without verification.
- **Settings: Reset "don't show again"** - new button to re-enable the availability check dialog after opting out.

### Backend

- **New endpoint `POST /api/downloads/check-availability`** - server-side link health checker that HEAD-checks all URLs in parallel (12s timeout per link), returns per-host availability with actual part numbers, cross-host alternatives for dead parts (showing which OTHER hosts have each dead part alive), and a `gameAvailable` flag. Correctly handles legacy data by assigning sequential part numbers to NULL entries.
- **Fixed part numbering bug** - when part column is NULL (legacy games), backend now assigns sequential 1-based part numbers per host instead of always using "Part 1", preventing display confusion.

### Fixes

- **"Don't show this again" not working** - the setting previously required both `skipLinkCheck` AND `dontShowHostSelector` to be true, now correctly uses `dontShowHostSelector` alone to skip the modal while still serving fully-dead games as errors.
- **Missing `fetchDownloadLinks` export** - re-added the original `fetchDownloadLinks` function alongside new `fetchDownloadLinksForVersion` to prevent crashes in components still using the original function signature.

### Files touched

- [package.json](package.json)
- [renderer/src/components/DownloadCheckModal.tsx](renderer/src/components/DownloadCheckModal.tsx) (new)
- [renderer/src/lib/downloads.ts](renderer/src/lib/downloads.ts)
- [renderer/src/app/pages/GameDetailPage.tsx](renderer/src/app/pages/GameDetailPage.tsx)
- [renderer/src/context/downloads-context.tsx](renderer/src/context/downloads-context.tsx)
- [renderer/src/app/pages/SettingsPage.tsx](renderer/src/app/pages/SettingsPage.tsx)
- [renderer/src/components/DownloadHostModal.tsx](renderer/src/components/DownloadHostModal.tsx) (deleted)

## Version 0.8.3 - 2026-02-12

### Fixes

- **Comment endpoints returning 404** - fixed incorrect API endpoint URLs for comment operations. Pin, like, and report endpoints were calling wrong URLs with incorrect request methods. Pin now correctly uses `PATCH /api/comments/{appid}` with `{ id, pinned }` body. Like now uses `POST/DELETE /api/comments/like` with `{ appid, commentId }` body. Report now uses `POST /api/comments/report` with `{ appid, commentId, reason }` body.
- **View history not syncing between app and web** - Direct app was only recording anonymous view counts but not syncing to user's personal view history. Now calls `/api/view-history` POST alongside the anonymous `/api/views/{appid}` call, matching the web app behavior for cross-device history sync.
- **Removed account stats from settings page** - removed the "Account overview" card showing wishlist, favorites, view history, and search history counts as this data was not useful and cluttered the settings interface.

### Files touched

- [package.json](package.json)
- [renderer/src/components/GameComments.tsx](renderer/src/components/GameComments.tsx)
- [renderer/src/app/pages/GameDetailPage.tsx](renderer/src/app/pages/GameDetailPage.tsx)
- [renderer/src/app/pages/SettingsPage.tsx](renderer/src/app/pages/SettingsPage.tsx)
- [renderer/src/lib/api.ts](renderer/src/lib/api.ts)

## Version 0.8.2 - 2026-02-11

### Fixes

- **Installer desktop shortcut recreation** - added `deleteAppFolder: false` to NSIS configuration to prevent unnecessary deletion and recreation of desktop shortcuts during app updates.
- **App not opening on second instance** - improved single-instance handler with better error handling, proper window focusing using `setImmediate()`, and fallback window creation. App now reliably shows and focuses when double-clicking the shortcut while already running.
- **Game exe picker broken state** - fully rebuilt exe picker with critical React Hooks fix (early return before state calls), proper deduplication by normalized path, single-exe visibility bug (now shows when 1 exe exists), and improved filtering of redistributables/junk executables. Added "Browse..." button fallback for manual exe selection when scanner finds nothing. Backend now uses proper BFS (not DFS) with higher depth (6) and result limits (100) to find exes in deeply nested game folders. Auto-detects single-subfolder game structures. Added symlink loop protection to prevent infinite recursion.
- **Download system stuck after completion** - fixed critical bug where downloads would finish but extraction never started. Root cause: `reconcileInstalledState` was called during `extracting` status and would prematurely mark the download as `completed` (because the installed manifest already existed on disk mid-extraction). The terminal-state guard then blocked all subsequent `extracting` progress updates from the main process. Now reconciliation only runs after `completed`/`extracted` status, and active items (`downloading`/`extracting`/`installing`) are never force-completed.
- **Stats bars still active after download** - speed chart kept showing blue bars after download finished because: (1) the terminal status update from main process sent stale `speedBps` instead of 0, (2) the renderer's `??` merge preserved the last non-zero speed, (3) the chart interval kept sampling. Fixed by always zeroing `speedBps`/`etaSeconds` on terminal states, and stopping chart sampling when progress is 100% with zero speed.
- **Stale pendingDownloads blocking queue** - when Electron's `will-download` failed to match a pending entry (URL normalization mismatch after redirects), the entry stayed in `pendingDownloads` forever, making `hasActiveDownloadsForApp()` return true and blocking both multipart extraction and queue progression. Added safety cleanup in the `done` handler and staleness timeout (60s) for pending entries.
- **Terminal state guard too aggressive** - the guard blocked ALL non-terminal status updates once an item reached any terminal state, including legitimate `extracting` → `extracted` → `completed` transitions from the main process. Relaxed to only block true regressions (`downloading`/`queued`/`paused` after `completed`/`failed`).
- **Duplicate `flushQueuedGlobalDownloads` function** - removed duplicate definition that silently overrode the first.
- **Debug console.logs left in production** - removed `startNextQueuedPart` and `onUpdate` debug logging from downloads context.
- **"Download already exists" infinite spam blocking all downloads** - when a download's `will-download` event never fired (bad URL, server block, etc.), the pending entry stayed forever. On retry, `getKnownDownloadState` found the stale entry and returned "already exists", but the renderer never handled this response - the item stayed "queued", causing the useEffect to retry thousands of times per second. Fixed on three levels: (1) `getKnownDownloadState` now auto-cleans pending entries older than 30s instead of blocking on them, (2) renderer's `startNextQueuedPart` now marks items as "downloading" when main process responds with `already` or `queued`, breaking the retry loop, (3) periodic cleanup interval (15s) removes stale pending entries, sends failure updates to renderer, and unblocks the download queue.
- **Extraction crash: `entry is not defined`** - the download `done` handler called `activeDownloads.delete(downloadId)` *before* saving a reference to the entry, then tried to use `entry.savePath` to find the file for extraction. This ReferenceError silently killed the entire done handler, so downloads completed but extraction never started (no error shown to user). Fixed by retrieving the entry reference before deletion.
- **Network speed bars persisting after download** - the last few `updated` events before `done` sent non-zero `speedBps` even though `receivedBytes === totalBytes`. The chart kept displaying these stale values. Fixed by zeroing `speedBps` in the `updated` callback when `received >= total`.
- **Downloads page chart resetting on navigation** - navigating away from the downloads page and back reset the speed chart, peak speed, and history to empty. Now chart data is persisted at module level and restored when returning to the page (as long as the same download is still active).

### Files touched

- [package.json](package.json)
- [electron/main.cjs](electron/main.cjs)
- [electron/preload.cjs](electron/preload.cjs)
- [renderer/src/components/ExePickerModal.tsx](renderer/src/components/ExePickerModal.tsx)
- [renderer/src/lib/utils.ts](renderer/src/lib/utils.ts)
- [renderer/src/context/downloads-context.tsx](renderer/src/context/downloads-context.tsx)
- [renderer/src/app/pages/DownloadsPage.tsx](renderer/src/app/pages/DownloadsPage.tsx)

---

## Version 0.8.1 - 2026-02-10

### Highlights

Account and preference handling were tightened up across the app. Discord session detection now gates account screens correctly, NSFW toggles are labeled based on actual behavior, and app settings can sync across devices when you sign in.

---

### Improvements

- **Account reliability** - account overview and settings now load only when a real session exists, avoiding false "unable to load" errors.
- **Preferences sync** - app preferences (mirror host, RPC, launch settings, developer mode, custom base URL, verbose logging) sync across devices when logged in.
- **NSFW wording cleanup** - labels now describe hover-reveal behavior and NSFW-only filters more accurately.
- **Custom profile image removal** - all remaining avatar/banner customization UI and storage hooks are removed in Direct.
- **API fetch stability** - auth fetches now map network errors to a safe status code to avoid crashes.

### Fixes

- Removed stale settings paths and legacy UI around download speed limits.
- Download pause/resume now clears any pending speed-limit timers to prevent unintended auto-resume.

### Files touched (selected)

- [electron/main.cjs](electron/main.cjs)
- [renderer/src/app/Layout.tsx](renderer/src/app/Layout.tsx)
- [renderer/src/app/pages/AccountOverviewPage.tsx](renderer/src/app/pages/AccountOverviewPage.tsx)
- [renderer/src/app/pages/SettingsPage.tsx](renderer/src/app/pages/SettingsPage.tsx)
- [renderer/src/app/pages/SearchPage.tsx](renderer/src/app/pages/SearchPage.tsx)
- [renderer/src/components/TopBar.tsx](renderer/src/components/TopBar.tsx)
- [renderer/src/hooks/use-app-preferences-sync.ts](renderer/src/hooks/use-app-preferences-sync.ts)
- [renderer/src/hooks/use-discord-account.ts](renderer/src/hooks/use-discord-account.ts)
- [renderer/src/lib/api.ts](renderer/src/lib/api.ts)
- [renderer/src/lib/settings-constants.ts](renderer/src/lib/settings-constants.ts)

---

## Version 0.8.0 - 2026-02-07

### Highlights

Introducing the **External Games System** - you can now add any game from your PC to UnionCrax Direct, even if it's not in the UC catalog. Use the **+** button in the bottom bar to point at any game folder, optionally match it to a UC title, or keep it fully custom. Once added, external games appear in your library with play, shortcut, and settings support just like regular installs.

A full **metadata editor** lets you set the name, description, developer, genres, and pick local images for both the card thumbnail and the detail page banner. Games that matched a UC catalog entry show a subtle blur on details to signal the metadata came from a different source, while fully custom entries display your info as-is with an "Externally Added" badge.

---

### New Features

- **Add External Games** - plus button in the bottom bar opens a modal to select any game folder on your PC. Auto-detects executables and optionally matches against the UC catalog via image lookup.
- **Edit Game Metadata modal** - full editor for external game details: name, description, developer, version, size, genres, card image, and banner image. Accessible from the game detail page and the library card settings.
- **Image file picker** - native file dialog to pick local images (jpg, png, gif, webp, bmp) for card art and banners.
- **Metadata persistence** - metadata updates are saved into the installed manifest and survive app restarts.
- **Edit Details in Library** - external games show an "Edit Details" option in the library card settings popup, with context-aware "Unlink Game" labeling.
- **Conditional detail blur** - UC-matched external games show blurred stats/details (since catalog data may not match the actual installed version), while fully custom entries do not.
- **"Externally Added" badge** - yellow badge in the hero section for all external games.

### Improvements

- **Hover-to-change image previews** - card and banner image slots sit side-by-side in the editor; hover to reveal a "Change" overlay, click to pick a new file.
- **Local image path support** - `proxyImageUrl` now correctly converts Windows paths to `file:///` URLs instead of routing them through the remote image proxy.
- **External games skip API fetch** - games with `external-` IDs load directly from the local manifest, eliminating 404 network errors.
- **Desktop shortcut exe auto-detection** - "Create Desktop Shortcut" now runs auto-detection before falling back to the exe picker.

### Fixes

- Fixed `proxyImageUrl` regex that failed to detect single-backslash Windows paths, causing local images to be sent to the remote proxy and return 403s.
- Fixed `DownBar.tsx` missing opening JSX Fragment tag causing a build error.
- Fixed nested `<button>` inside `<button>` hydration error in the metadata modal image clear buttons.
- Fixed external games triggering repeated 404 API fetches on the game detail page.
- Fixed `AddGameModal` closing prematurely and the bottom bar plus button navigating away instead of opening the modal.

### Files touched

- [electron/main.cjs](electron/main.cjs)
- [electron/preload.cjs](electron/preload.cjs)
- [renderer/src/vite-env.d.ts](renderer/src/vite-env.d.ts)
- [renderer/src/lib/utils.ts](renderer/src/lib/utils.ts)
- [renderer/src/components/EditGameMetadataModal.tsx](renderer/src/components/EditGameMetadataModal.tsx)
- [renderer/src/components/DownBar.tsx](renderer/src/components/DownBar.tsx)
- [renderer/src/app/pages/GameDetailPage.tsx](renderer/src/app/pages/GameDetailPage.tsx)
- [renderer/src/app/pages/LibraryPage.tsx](renderer/src/app/pages/LibraryPage.tsx)

---

## Version 0.7.2 - 2026-01-31

### Highlights

- Developer & diagnostics: added settings export/import, network test, and an easy way to open the app logs folder from the UI.
- Download manager reliability: improved download root handling, added download-cache clearing, and clearer debug logging options.
- Executable detection: richer exe discovery with size/depth scoring and a redesigned exe picker with recommendations and search.

---

### New Features

- **Settings export & import** (`electron/main.cjs`, `electron/preload.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) - export current JSON settings and import from a file.
- **Network test** (`electron/main.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) - probe API and mirror endpoints and show timing/status results.
- **Open logs folder** (`electron/main.cjs`, `electron/preload.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) - open the app logs directory from Settings.
- **Download cache clear** (`electron/main.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) - remove temporary installing parts when no downloads are active.

### Improvements

- **Settings sync**: added `uc:setting-changed` broadcasts so renderer windows are notified when settings change (`electron/main.cjs`).
- **Verbose download logging**: new developer toggle to enable debug-level download logs for troubleshooting (`electron/main.cjs`, `renderer/src/app/pages/SettingsPage.tsx`).
- **Download root handling**: prefer the system `Downloads` folder, improved normalization of chosen download paths, and better fallback behavior (`electron/main.cjs`).
- **Executable discovery**: `listGameExecutables` now returns `size` and `depth`; ranking/scoring was added and the `ExePickerModal` was redesigned to recommend and search executables (`renderer/src/lib/utils.ts`, `renderer/src/components/ExePickerModal.tsx`).
- **Exe picker UX**: recommended item, helper toggles, relative path display and search make selecting the correct exe easier (`renderer/src/components/ExePickerModal.tsx`, `renderer/src/app/pages/*`).
- **Game launch robustness**: spawn environment now ensures working directory is in `PATH` on Windows for DLL resolution and includes optional verbose logging of launch details (`electron/main.cjs`).
- **Installed/Installing cleanup**: deletion handlers search all download roots (global + per-root) before removing installing/installed folders, improving multi-root support (`electron/main.cjs`).
- **Executable listing**: `listExecutables` now returns richer entries and sorts candidates by depth/size to pick more appropriate executables (`electron/main.cjs`, `renderer/src/lib/utils.ts`).

### Fixes

- Fixed several edge cases around download folder creation and fallbacks when creating directories (`electron/main.cjs`).
- Avoid logging debug-level download messages unless `verboseDownloadLogging` is enabled (`electron/main.cjs`).
- Ensure desktop shortcut and launch flows log useful context when verbose logging is enabled (`electron/main.cjs`).

### Files touched (selected)

- [electron/main.cjs](electron/main.cjs)
- [electron/preload.cjs](electron/preload.cjs)
- [renderer/src/lib/utils.ts](renderer/src/lib/utils.ts)
- [renderer/src/components/ExePickerModal.tsx](renderer/src/components/ExePickerModal.tsx)
- [renderer/src/app/pages/SettingsPage.tsx](renderer/src/app/pages/SettingsPage.tsx)
- [renderer/src/app/pages/DownloadsPage.tsx](renderer/src/app/pages/DownloadsPage.tsx)
- [renderer/src/app/pages/GameDetailPage.tsx](renderer/src/app/pages/GameDetailPage.tsx)
- [renderer/src/components/GameCard.tsx](renderer/src/components/GameCard.tsx)

---

## Version 0.7.1 - Performance Improvements

### Performance

- **Deferred UI updates** (`renderer/src/app/pages/LauncherPage.tsx`)
  - Use React `startTransition` when applying large game list and stats updates to keep the UI responsive.

- **Stats caching & debouncing** (`renderer/src/app/pages/LauncherPage.tsx`)
  - Cache game stats for short periods and avoid redundant API calls during rapid UI interactions.

- **Image progressive loading (blur-up)** (`renderer/src/components/GameCard.tsx`)
  - Added a blur-up effect and `loading="lazy"` for game artwork to improve perceived load times.

- **Download state selector** (`renderer/src/context/downloads-context.tsx`)
  - Introduced a lightweight external store and `useDownloadsSelector` to let `GameCard` subscribe to only the download fields it needs, reducing re-renders.

- **Memoization & reduced work** (`renderer/src/app/pages/LauncherPage.tsx`, `renderer/src/components/GameCardCompact.tsx`)
  - Memoized compact cards, avoided in-place sorts, and only shuffled featured lists on explicit refresh.

- **Reduced polling frequency** (`renderer/src/components/GameCard.tsx`)
  - Lowered running-state polling frequency and skip polling when not installed.

These changes reduce UI jank, lower CPU usage during large updates, and make scrolling and interactions noticeably smoother.


---

## Version 0.7.0 - UI Alignment & Navigation Improvements

### UI Improvements

- **Home Page Redesign** (`renderer/src/app/pages/LauncherPage.tsx`)
  - Updated hero section with responsive text sizing matching web version
  - Refined announcement banner with gradient styling and updated links
  - Improved stats section with responsive font sizes and spacing
  - Adjusted section padding for better mobile/desktop consistency
  - Simplified search bar UI - now shows "Click to search" with platform-specific shortcut hint
  - Search bar opens global search popup (Ctrl+K / Cmd+K) instead of inline form

- **Font System Overhaul** (`renderer/src/fonts.css`, `renderer/src/globals.css`)
  - Migrated to Google Fonts CDN for Geist and Geist Mono (matches Next.js web version)
  - Updated font stack with proper fallbacks
  - Enhanced heading font weights for better visual hierarchy
  - Applied Geist Mono as primary body font for consistent monospace aesthetic

- **Navigation Behavior** (`renderer/src/components/TopBar.tsx`, `renderer/src/app/pages/LauncherPage.tsx`)
  - Added smart scroll behavior - Home nav button scrolls to "All Games" section
  - Logo click scrolls to hero section when on home page
  - Smooth scrolling with proper event handling for both desktop and mobile
  - Matches web version navigation patterns exactly

- **Search Experience** (`renderer/src/components/SearchSuggestions.tsx`)
  - Body scroll locking when search popup is open
  - Compensates for scrollbar width to prevent layout shift
  - Improved keyboard accessibility

### Technical Changes

- Synchronized all home page layouts and styling with union-crax.xyz web version
- Added hero section ID for targeted scrolling
- Implemented custom window events for navigation communication
- Enhanced responsive breakpoints across all sections

---

## Version 0.6.34 - Developer Mode & Custom Base URL

### New Features

- **Developer Mode** (`renderer/src/app/pages/SettingsPage.tsx`)
  - Added new "Developer Mode" section at the bottom of settings page
  - Toggle to enable/disable advanced developer features
  - Settings persist across app restarts
  - Amber-colored UI to indicate advanced/experimental nature

- **Custom API Base URL** (`renderer/src/app/pages/SettingsPage.tsx`, `renderer/src/lib/api.ts`)
  - New setting (visible only when Developer Mode is enabled)
  - Allows overriding the default API base URL (union-crax.xyz)
  - Useful for proxying through custom domains to bypass restrictions
  - Marked with "DANGEROUS" badge for user awareness
  - URL validation enforces http:// or https:// protocol
  - Apply and Reset buttons for easy URL management
  - Shows current active URL vs default
  - Automatically loads custom URL on app startup
  - Resets to default when clearing all user data

---

## Version 0.6.32 - Installer Fixes

### Fixes

- **Setup executable stays in use after installation** (#12)
  - Added proper NSIS installer configuration with `oneClick: false` and `allowToChangeInstallationDirectory`
  - Fixed setup file remaining locked after installation
  - Setup now properly installs to system directories instead of running from temp location
  - Users can now delete the setup executable after installation

- **App now closes when setup is re-run during update**
  - Detects when setup installer is executed while app is running
  - Gracefully closes running instance to allow installer to proceed
  - Prevents file lock conflicts during updates and reinstalls

- **Discord RPC hidden when app is minimized or in tray** (`electron/main.cjs`)
  - Added window visibility tracking to Discord RPC system
  - Automatically clears Discord RPC when window is minimized or hidden
  - Restores Discord RPC when window is shown or restored
  - Prevents Discord RPC from displaying outdated status when app is in background

---

## Version 0.6.31 - Enhanced Logging & UX Improvements

### New Features

- **Game details action menu** (`renderer/src/app/pages/GameDetailPage.tsx`)
  - Added settings gear popover next to Play button with three actions
  - Set Executable: Choose or change the game's launch executable
  - Create Desktop Shortcut: Quickly create a desktop shortcut
  - Open Game Files: Open the game's installation folder in file explorer
  - Centralized executable picker with "set-only" mode for non-launch flows

### Improvements

- **Enhanced logging system** (`electron/main.cjs`)
  - Added safer log serialization to prevent circular reference errors
  - Process lifecycle logging: uncaught exceptions, unhandled rejections, app quit events
  - Window lifecycle logging: crashes, unresponsive state, renderer process gone
  - Renderer console logging: automatic capture of warnings and errors
  - Extraction/download logs now mirrored to main app log
  - Logs preserved on app ready (no longer cleared at startup)

- **Application Logs modal overhaul** (`renderer/src/components/LogViewer.tsx`, `renderer/src/components/ui/scroll-area.tsx`)
  - Wider, taller modal with stable layout on small screens
  - Reliable vertical and horizontal scrolling for large log output
  - Added copy-to-clipboard button for logs

- **User action feedback** (`renderer/src/app/pages/SettingsPage.tsx`, `renderer/src/app/pages/GameDetailPage.tsx`, `renderer/src/app/pages/LibraryPage.tsx`)
  - Success/error messages when clearing user data
  - Feedback when creating desktop shortcuts across all pages
  - Messages persist for 3 seconds with auto-clear

- **Discord RPC web buttons now follow current page** (`renderer/src/hooks/use-discord-rpc.ts`)
  - "Open on web" maps to the matching union-crax.xyz route (Search, Library, Settings, Game pages)
  - "Download UC.D" is always shown and links to the Direct download page

- **Library page shortcut consistency** (`renderer/src/app/pages/LibraryPage.tsx`)
  - Auto-detects executables before prompting, matching game details behavior
  - No longer asks to "set exe first" when executables can be found automatically

- **Discord RPC enabled by default** (`electron/main.cjs`, `renderer/src/app/pages/SettingsPage.tsx`, `renderer/src/hooks/use-discord-rpc.ts`)
  - Discord presence now enabled for new installations
  - Settings defaults applied at read-time for backward compatibility

### Fixes

- **Version reporting** (`electron/main.cjs`)
  - Fixed app version showing Electron runtime version instead of package version
  - Added `getAppVersion()` helper using package.json version
  - Corrects update check logic and version display in logs

---

## Version 0.6.30 - Linux Support (Beta)

### New Features

- **Linux game launching (beta)** (`electron/main.cjs`, `renderer/src/app/pages/SettingsPage.tsx`)
  - Added launch modes: Auto / Native / Wine / Proton
  - Added optional Wine + Proton path overrides in Settings

- **Linux executable discovery** (`electron/main.cjs`, `renderer/src/lib/utils.ts`)
  - Detects AppImage, shell scripts, ELF binaries, and common Linux launchers
  - Improved executable scoring on Linux

- **Linux desktop shortcuts** (`electron/main.cjs`)
  - Generates .desktop files for installed games

### Improvements

- **OS-aware launch prompts** (`renderer/src/components/GameCard.tsx`, `renderer/src/app/pages/DownloadsPage.tsx`, `renderer/src/app/pages/GameDetailPage.tsx`)
  - Admin prompt is now Windows-only

---

## Version 0.6.29 - Linux Builds

### New Features

- **Linux packaging (AppImage)** (`package.json`)
  - Added `linux` target for electron-builder

### CI/CD

- **Cross-platform release builds** (`.github/workflows/build.yml`)
  - Added Ubuntu build job alongside Windows
  - Uploads Linux artifacts for tagged releases

---

## Version 0.6.28 - Discord Rich Presence & Web Links

### New Features

- **Discord Rich Presence** (`electron/main.cjs`, `electron/preload.cjs`, `renderer/src/hooks/use-discord-rpc.ts`)
  - IPC-backed presence updates with a settings toggle
  - Activity shows downloads, queues, and page context
  - Game launch updates presence with game name and start time

- **RPC Web Buttons** (`electron/main.cjs`, `renderer/src/hooks/use-discord-rpc.ts`)
  - “Open on web” for UnionCrax pages
  - “Download UC.D” linking to the new Direct download page

### Improvements

- **Game name resolution for RPC** (`renderer/src/app/pages/GameDetailPage.tsx`)
  - Cache game names locally to avoid showing app IDs
  - Pushes name updates to the RPC hook

### Technical Changes

- Added `discord-rpc` dependency
- Added RPC IPC handlers and cleanup on quit
- Added periodic pruning for stale running game PIDs

---

## Version 0.5.28 - Game Stop Reliability (Issue #9)

### Fixes

- **Accurate running state** (`electron/main.cjs`)
  - Added a process-existence check to clear stale running entries
  - `Stop` now reports success if the game already exited

- **Admin launch & stop UX** (`electron/main.cjs`)
  - Hidden PowerShell windows for admin launch/kill flows
  - Admin launch now returns the elevated game PID (not the PowerShell PID)

### User-Facing Improvements

1. Closing a game properly clears the “running” state
2. Stop button no longer flashes a terminal window

---

## Version 0.5.25 - Desktop Shortcuts & Settings Management

### New Features

#### Desktop Shortcut System
- **Created Desktop Shortcut Modal** (`renderer/src/components/DesktopShortcutModal.tsx`)
  - New modal component for prompting users to create desktop shortcuts
  - Shows after exe selection, before game launch
  - Options to create or skip

- **Desktop Shortcut Prompt Flow** (GameCard, GameDetailPage, DownloadsPage)
  - Integrated two-step desktop shortcut prompt into game launch flow
  - Shows BEFORE game launches (after admin prompt if needed)
  - Per-game tracking to ask only once per game
  - Respects "always create shortcuts" setting

- **Desktop Shortcut Creation** (`electron/main.cjs`)
  - IPC handler `uc:create-desktop-shortcut` creates Windows .lnk files
  - Shortcuts named as "{gameName} - UC.lnk" on desktop
  - Validates executable path before creating

- **Desktop Shortcut Deletion** (`electron/main.cjs`)
  - IPC handler `uc:delete-desktop-shortcut` removes shortcuts from desktop
  - Automatically called when game is uninstalled from library
  - Logs all operations for debugging

- **Manual Shortcut Creation** (LibraryPage Game Settings Modal)
  - "Create Desktop Shortcut" button in game settings modal
  - Allows users to recreate shortcuts if manually deleted
  - Uses saved executable path

#### Settings Management
- **Always Create Desktop Shortcuts** (SettingsPage)
  - Toggle to automatically create shortcuts without prompting
  - Skips the desktop shortcut modal when enabled

- **Clear User Data** (SettingsPage)
  - Two-step confirmation process to reset all settings
  - Clears all user preferences back to defaults
  - Does NOT affect downloaded game files
  - Located in "Danger Zone" section with destructive styling

### Fixes

#### React Warnings
- **Fixed DialogOverlay Ref Warning** (`renderer/src/components/ui/dialog.tsx`)
  - Wrapped DialogOverlay with React.forwardRef
  - Properly typed with ElementRef and ComponentPropsWithoutRef
  - Added displayName for debugging

### Technical Changes

#### Electron Backend (`electron/main.cjs`)
- Added `uc:create-desktop-shortcut` IPC handler
- Added `uc:delete-desktop-shortcut` IPC handler
- Added `uc:setting-clear-all` IPC handler
- PowerShell script execution for Windows .lnk file creation

#### Preload Bridge (`electron/preload.cjs`)
- Exposed `createDesktopShortcut(gameName, exePath)`
- Exposed `deleteDesktopShortcut(gameName)`
- Exposed `clearAll()` for settings reset

#### Renderer Components

**SettingsPage** (`renderer/src/app/pages/SettingsPage.tsx`)
- Added state: `alwaysCreateDesktopShortcut`, `clearingData`, `showClearConfirm`
- Added "Always create desktop shortcuts" toggle in Game Launch section
- Added "Clear User Data" in new Danger Zone section
- Added effect hook to load and monitor shortcut setting changes

**GameCard** (`renderer/src/components/GameCard.tsx`)
- Imported `DesktopShortcutModal`, `gameLogger`
- Added state: `shortcutModalOpen`
- Added helper functions: `getShortcutAskedForGame()`, `setShortcutAskedForGame()`, `getAlwaysCreateShortcut()`, `createDesktopShortcut()`
- Added `handleAdminDecision()` function to check shortcut status before launching
- Updated `launchGame()` to not show shortcut modal
- Updated admin prompt handlers to use `handleAdminDecision()`
- Updated shortcut modal handlers to launch game after decision

**GameDetailPage** (`renderer/src/app/pages/GameDetailPage.tsx`)
- Imported `DesktopShortcutModal`, `gameLogger`, `ExternalLink` icon
- Added state: `shortcutModalOpen`
- Added helper functions: same as GameCard
- Added `handleAdminDecision()` function
- Updated launch and admin prompt logic
- ~~Removed "Create Desktop Shortcut" button from main detail area~~ (moved to modal)

**DownloadsPage** (`renderer/src/app/pages/DownloadsPage.tsx`)
- Imported `DesktopShortcutModal`, `gameLogger`
- Added state: `shortcutModalOpen`
- Added helper functions: same as GameCard
- Added `handleAdminDecision()` function
- Updated launch and admin prompt logic with appid parameter

**LibraryPage** (`renderer/src/app/pages/LibraryPage.tsx`)
- Imported `gameLogger`, `ExternalLink` icon
- Added "Create Desktop Shortcut" button to Game Settings modal
- Updated `handleDeleteInstalled()` to call `deleteDesktopShortcut()` when game is removed
- Calls async shortcut deletion for cleanup

**Dialog UI** (`renderer/src/components/ui/dialog.tsx`)
- Added `React.forwardRef` wrapper to `DialogOverlay`
- Proper TypeScript typing for ref forwarding
- Added `displayName` property

### User-Facing Improvements

1. **First-time game launch**: Users see desktop shortcut prompt after exe selection, before game starts
2. **Automatic shortcuts**: Can enable "always create shortcuts" to skip prompts entirely
3. **Manual shortcut creation**: Game settings modal has button to recreate deleted shortcuts
4. **Clean uninstalls**: Deleting a game also removes its desktop shortcut
5. **Settings reset**: Users can reset all preferences while keeping downloaded games
6. **Better UX**: No ref warnings in console when opening modals

### Database/Storage Changes
- Added per-game settings key: `shortcutAsked:{appid}` (boolean)
- Added global setting: `alwaysCreateDesktopShortcut` (boolean)
- Desktop shortcuts stored as Windows .lnk files on user's desktop

### Breaking Changes
None - fully backward compatible

### Migration Notes
- Existing games will be prompted to create shortcuts on next launch
- Users can disable prompts in Settings
- No data loss or conflicts

---

## Detailed File Changes

### New Files
- `renderer/src/components/DesktopShortcutModal.tsx` - Modal component for shortcut creation prompt

### Modified Files
- `electron/main.cjs` - Added 2 new IPC handlers, 1 settings handler
- `electron/preload.cjs` - Exposed 3 new methods
- `renderer/src/components/ui/dialog.tsx` - Fixed ref warning
- `renderer/src/components/GameCard.tsx` - Added shortcut flow, refactored launch logic
- `renderer/src/app/pages/GameDetailPage.tsx` - Added shortcut flow, refactored launch logic
- `renderer/src/app/pages/DownloadsPage.tsx` - Added shortcut flow, refactored launch logic
- `renderer/src/app/pages/SettingsPage.tsx` - Added 2 new settings sections
- `renderer/src/app/pages/LibraryPage.tsx` - Added shortcut button, delete handler

---

## Known Issues
None reported

## Future Improvements
- Support for other platforms (macOS desktop links, Linux .desktop files)
- Shortcut customization (icon, description)
- Batch shortcut creation for multiple games
- Shortcut management panel to view/delete shortcuts
