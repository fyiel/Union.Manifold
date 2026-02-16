# Changelog

## Version 1.0.1 - 2026-02-16

### Fixes & Improvements

- **Removed noisy settings logs** — removed `Setting get: ...` messages from application logs that were cluttering output on every preference access.
- **Download queue state fix** — Resolved a bug where pausing the current download would inadvertently trigger the next queued game to start download.
- **Scoped pause controls** — The global pause button in the download bar is now correctly scoped to the active game group, preventing it from incorrectly pausing unrelated downloads.
- **TypeScript type safety fixes** — resolved multiple build errors in the downloads context:
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

- **Download resume actually works across app restarts** — previously, closing the app and resuming a download would restart it from byte 0, even for 10 GB files. The entire three-level resume system has been overhauled:
  - **Partial file preservation** — Chromium deletes partial download files when it cancels DownloadItems during app quit. The app now creates instant hardlinks (`.ucresume` backup files) in `before-quit` so the downloaded data survives. On next launch, resume handlers automatically restore the backup if the original was deleted.
  - **Level 3 resume with fresh URL** — when the stored URL chain has expired (CDN links rotate), the app re-resolves a fresh URL and now uses `createInterruptedDownload` with the actual file offset from disk instead of calling `downloadURL()` from byte 0. This sends a proper `Range` header so the server returns only the remaining bytes.
  - **`savePath` propagation** — the download start payload now carries `savePath` through to `pendingDownloads`, so `will-download` reuses the existing partial file path instead of generating a new one.
  - **URL chain matching fix** — `will-download` now matches against the full stored `urlChain` array, fixing a bug where redirect chains caused the pending download entry to be missed.
  - **Backup cleanup** — `.ucresume` files are automatically cleaned up when downloads complete, are cancelled by the user, or when the original file is still present.

- **Discord Rich Presence advanced options** — added collapsible advanced settings for Discord RPC customization:
  - **Hide NSFW content** — option to mask NSFW game names as "****" when viewing or downloading NSFW games (automatically detects games with "nsfw" genre while keeping the RPC activity visible)
  - **Show game name** - toggle display of game titles in your status
  - **Show activity status** — control whether your current activity (downloading, playing, browsing) is shown
  - **Show buttons** — control visibility of "Open on web" and "Download UC.D" buttons

- **New improved version selector & Version management** — enhanced version selection and management system

### Fixes & Improvements

- **Developer mode settings behavior** — disabling Developer Mode now reverts the API base URL to the default (union-crax.xyz) while preserving the custom URL setting. Re-enabling Developer Mode reapplies the previously saved custom URL. The Reset button now permanently clears the custom URL setting and returns to the default URL for fresh use.
- **Game launching from Downloads page** — fixed issue where launching downloaded games from the Downloads page would show the app ID instead of the game name in Discord Rich Presence. The launch function now properly looks up the game name from the games data before passing it to the main process.
- **Discord RPC settings sync to account** — advanced Discord RPC settings (Hide NSFW, Show game name, Show status, Show buttons) are saved to the user's account database and automatically restored when logging into different devices or reinstalling the app.
- **Loading animation during game fetch** — fixed brief flash of "No games available" error message during initial game loading. Added loading state management with debounce to ensure loading skeleton remains visible until games are fully loaded from the database.
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

- **FileQ & DataVaults hosts visible (coming soon)** — FileQ and DataVaults now appear in the host selector and network tests, marked as "soon". Download support for these hosts will be enabled in a future update once mirrors are populated.

### Fixes & Improvements

- **Generalized download resolution errors** — resolution failure messages are no longer Rootz-specific and will report the failing host name for clearer diagnostics.
- **Preferred host handling** — preferred-host override logic now uses the exported supported-hosts list instead of hardcoded checks, making it future-proof for added hosts.
- **Network tests extended** — the built-in network test now probes FileQ and DataVaults endpoints as part of mirror diagnostics.

### Files touched (UnionCrax.Direct)

- `renderer/src/lib/downloads.ts`
- `renderer/src/components/DownloadCheckModal.tsx`
- `renderer/src/context/downloads-context.tsx`
- `electron/main.cjs`

## Version 0.9.1 - 2026-02-12

### Features

- **Version selector in downloads** — users can now choose which version to download when multiple archived versions are available. The selected version label is displayed throughout the download flow (in the downloads page, active downloads, completed downloads) so users always know which version they're downloading.
- **Installed version tracking** — downloaded version is now persisted to the install manifest and displayed on the game detail page as "Installed version". When a newer version is available on the API, both "Installed version" and "Latest version" are shown separately, making it easy to see if an update is available at a glance.
- **Version info in downloads activity** — the downloads page now shows the version label for each download:
  - Primary active download hero section displays version
  - Queued download groups show version label before part count
  - Completed downloads show the downloaded version (from the DownloadItem) instead of always showing the latest API version
  - Failed/cancelled downloads show version in the status line

### Fixes

- **Download cancel not working** — when clicking cancel during a multi-part download, the download continued after cancellation with the file growing in the downloads folder. Root cause: the cancel handler only checked `activeDownloads` and queues but never checked `pendingDownloads` (the limbo state between Electron's `downloadURL()` and `will-download` firing). Fixed by checking all 5 states (active, pending, app queues, global queue, and newly added `cancelledDownloadIds` tracking set). Also fixed pixeldrain delay race condition where a delayed download couldn't be cancelled during its timeout period. Now immediately cancels downloads that were cancelled while pending.
- **Verbose download logs missing** — when "Verbose download logging" was enabled in settings, download progress wasn't being logged. `sendDownloadUpdate` was logging every single progress tick (hundreds/second) via `uc_log`, creating duplicate/concatenated output. Fixed logging to distinguish between settings: when verbose is OFF, only log state transitions (started, completed, cancelled, failed); when ON, log compact summaries per update (ID, status, bytes, speed, filename). Prevents log flooding while keeping useful diagnostics available.
- **"Don't show this again" toggle simplified** — removed the per-download "don't show this again" toggle from the link checker modal. Modal now always shows before download unless "Skip link availability check" is disabled in Settings. This ensures users always see link status before committing to a download, unless they explicitly opt out via settings. Removed `dontShowAgain` from DownloadConfig type and related `dontShowHostSelector` bypass logic.

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

- **Automatic link availability checker** — before downloading, the app now verifies that all download links are alive via server-side HEAD checks. A modal displays per-host health with color-coded indicators (🟢 all alive, 🟡 some dead, 🔴 all dead) and shows exact part counts (e.g. "7/15 parts alive"). Prevents wasted time on games with dead links by catching issues before download starts.
- **Smart cross-host fallback** — when multi-part games have dead parts on your selected host, the modal shows exactly which parts are dead and offers one-click "Use Pixeldrain" / "Use Rootz" buttons to download individual dead parts from an alternative host where they're alive. Fully transparent about what's dead and where to get it.
- **Per-part status indicators** — each downloadable link shows a live status dot (🟢 alive, 🔴 dead) updated during the download check, so you can see at a glance which specific parts are problematic before commitment.
- **Dead parts messaging** — when a part is dead on every available host, the modal clearly states "dead on all hosts" and suggests reporting the broken link on the game page or trying the website (which may have more mirrors). For unavailable games, shows a prominent message encouraging users to report dead links.
- **Version selector in modal** — games with multiple archived versions now show a dropdown to choose specific versions to download, making it easy to grab older builds without navigating away from the download flow.
- **"Don't show this again" toggle** — the availability check modal includes a checkbox to skip the dialog on future downloads, going straight to your preferred host while still protecting against obviously dead games (fully unavailable titles still show the error).
- **Settings: Skip link checks entirely** — new toggle in Settings → Download checks to disable availability checking completely for users who prefer to download without verification.
- **Settings: Reset "don't show again"** — new button to re-enable the availability check dialog after opting out.

### Backend

- **New endpoint `POST /api/downloads/check-availability`** — server-side link health checker that HEAD-checks all URLs in parallel (12s timeout per link), returns per-host availability with actual part numbers, cross-host alternatives for dead parts (showing which OTHER hosts have each dead part alive), and a `gameAvailable` flag. Correctly handles legacy data by assigning sequential part numbers to NULL entries.
- **Fixed part numbering bug** — when part column is NULL (legacy games), backend now assigns sequential 1-based part numbers per host instead of always using "Part 1", preventing display confusion.

### Fixes

- **"Don't show this again" not working** — the setting previously required both `skipLinkCheck` AND `dontShowHostSelector` to be true, now correctly uses `dontShowHostSelector` alone to skip the modal while still serving fully-dead games as errors.
- **Missing `fetchDownloadLinks` export** — re-added the original `fetchDownloadLinks` function alongside new `fetchDownloadLinksForVersion` to prevent crashes in components still using the original function signature.

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

- **Comment endpoints returning 404** — fixed incorrect API endpoint URLs for comment operations. Pin, like, and report endpoints were calling wrong URLs with incorrect request methods. Pin now correctly uses `PATCH /api/comments/{appid}` with `{ id, pinned }` body. Like now uses `POST/DELETE /api/comments/like` with `{ appid, commentId }` body. Report now uses `POST /api/comments/report` with `{ appid, commentId, reason }` body.
- **View history not syncing between app and web** — Direct app was only recording anonymous view counts but not syncing to user's personal view history. Now calls `/api/view-history` POST alongside the anonymous `/api/views/{appid}` call, matching the web app behavior for cross-device history sync.
- **Removed account stats from settings page** — removed the "Account overview" card showing wishlist, favorites, view history, and search history counts as this data was not useful and cluttered the settings interface.

### Files touched

- [package.json](package.json)
- [renderer/src/components/GameComments.tsx](renderer/src/components/GameComments.tsx)
- [renderer/src/app/pages/GameDetailPage.tsx](renderer/src/app/pages/GameDetailPage.tsx)
- [renderer/src/app/pages/SettingsPage.tsx](renderer/src/app/pages/SettingsPage.tsx)
- [renderer/src/lib/api.ts](renderer/src/lib/api.ts)

## Version 0.8.2 - 2026-02-11

### Fixes

- **Installer desktop shortcut recreation** — added `deleteAppFolder: false` to NSIS configuration to prevent unnecessary deletion and recreation of desktop shortcuts during app updates.
- **App not opening on second instance** — improved single-instance handler with better error handling, proper window focusing using `setImmediate()`, and fallback window creation. App now reliably shows and focuses when double-clicking the shortcut while already running.
- **Game exe picker broken state** — fully rebuilt exe picker with critical React Hooks fix (early return before state calls), proper deduplication by normalized path, single-exe visibility bug (now shows when 1 exe exists), and improved filtering of redistributables/junk executables. Added "Browse..." button fallback for manual exe selection when scanner finds nothing. Backend now uses proper BFS (not DFS) with higher depth (6) and result limits (100) to find exes in deeply nested game folders. Auto-detects single-subfolder game structures. Added symlink loop protection to prevent infinite recursion.
- **Download system stuck after completion** — fixed critical bug where downloads would finish but extraction never started. Root cause: `reconcileInstalledState` was called during `extracting` status and would prematurely mark the download as `completed` (because the installed manifest already existed on disk mid-extraction). The terminal-state guard then blocked all subsequent `extracting` progress updates from the main process. Now reconciliation only runs after `completed`/`extracted` status, and active items (`downloading`/`extracting`/`installing`) are never force-completed.
- **Stats bars still active after download** — speed chart kept showing blue bars after download finished because: (1) the terminal status update from main process sent stale `speedBps` instead of 0, (2) the renderer's `??` merge preserved the last non-zero speed, (3) the chart interval kept sampling. Fixed by always zeroing `speedBps`/`etaSeconds` on terminal states, and stopping chart sampling when progress is 100% with zero speed.
- **Stale pendingDownloads blocking queue** — when Electron's `will-download` failed to match a pending entry (URL normalization mismatch after redirects), the entry stayed in `pendingDownloads` forever, making `hasActiveDownloadsForApp()` return true and blocking both multipart extraction and queue progression. Added safety cleanup in the `done` handler and staleness timeout (60s) for pending entries.
- **Terminal state guard too aggressive** — the guard blocked ALL non-terminal status updates once an item reached any terminal state, including legitimate `extracting` → `extracted` → `completed` transitions from the main process. Relaxed to only block true regressions (`downloading`/`queued`/`paused` after `completed`/`failed`).
- **Duplicate `flushQueuedGlobalDownloads` function** — removed duplicate definition that silently overrode the first.
- **Debug console.logs left in production** — removed `startNextQueuedPart` and `onUpdate` debug logging from downloads context.
- **"Download already exists" infinite spam blocking all downloads** — when a download's `will-download` event never fired (bad URL, server block, etc.), the pending entry stayed forever. On retry, `getKnownDownloadState` found the stale entry and returned "already exists", but the renderer never handled this response — the item stayed "queued", causing the useEffect to retry thousands of times per second. Fixed on three levels: (1) `getKnownDownloadState` now auto-cleans pending entries older than 30s instead of blocking on them, (2) renderer's `startNextQueuedPart` now marks items as "downloading" when main process responds with `already` or `queued`, breaking the retry loop, (3) periodic cleanup interval (15s) removes stale pending entries, sends failure updates to renderer, and unblocks the download queue.
- **Extraction crash: `entry is not defined`** — the download `done` handler called `activeDownloads.delete(downloadId)` *before* saving a reference to the entry, then tried to use `entry.savePath` to find the file for extraction. This ReferenceError silently killed the entire done handler, so downloads completed but extraction never started (no error shown to user). Fixed by retrieving the entry reference before deletion.
- **Network speed bars persisting after download** — the last few `updated` events before `done` sent non-zero `speedBps` even though `receivedBytes === totalBytes`. The chart kept displaying these stale values. Fixed by zeroing `speedBps` in the `updated` callback when `received >= total`.
- **Downloads page chart resetting on navigation** — navigating away from the downloads page and back reset the speed chart, peak speed, and history to empty. Now chart data is persisted at module level and restored when returning to the page (as long as the same download is still active).

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

- **Account reliability** — account overview and settings now load only when a real session exists, avoiding false "unable to load" errors.
- **Preferences sync** — app preferences (mirror host, RPC, launch settings, developer mode, custom base URL, verbose logging) sync across devices when logged in.
- **NSFW wording cleanup** — labels now describe hover-reveal behavior and NSFW-only filters more accurately.
- **Custom profile image removal** — all remaining avatar/banner customization UI and storage hooks are removed in Direct.
- **API fetch stability** — auth fetches now map network errors to a safe status code to avoid crashes.

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

Introducing the **External Games System** — you can now add any game from your PC to UnionCrax Direct, even if it's not in the UC catalog. Use the **+** button in the bottom bar to point at any game folder, optionally match it to a UC title, or keep it fully custom. Once added, external games appear in your library with play, shortcut, and settings support just like regular installs.

A full **metadata editor** lets you set the name, description, developer, genres, and pick local images for both the card thumbnail and the detail page banner. Games that matched a UC catalog entry show a subtle blur on details to signal the metadata came from a different source, while fully custom entries display your info as-is with an "Externally Added" badge.

---

### New Features

- **Add External Games** — plus button in the bottom bar opens a modal to select any game folder on your PC. Auto-detects executables and optionally matches against the UC catalog via image lookup.
- **Edit Game Metadata modal** — full editor for external game details: name, description, developer, version, size, genres, card image, and banner image. Accessible from the game detail page and the library card settings.
- **Image file picker** — native file dialog to pick local images (jpg, png, gif, webp, bmp) for card art and banners.
- **Metadata persistence** — metadata updates are saved into the installed manifest and survive app restarts.
- **Edit Details in Library** — external games show an "Edit Details" option in the library card settings popup, with context-aware "Unlink Game" labeling.
- **Conditional detail blur** — UC-matched external games show blurred stats/details (since catalog data may not match the actual installed version), while fully custom entries do not.
- **"Externally Added" badge** — yellow badge in the hero section for all external games.

### Improvements

- **Hover-to-change image previews** — card and banner image slots sit side-by-side in the editor; hover to reveal a "Change" overlay, click to pick a new file.
- **Local image path support** — `proxyImageUrl` now correctly converts Windows paths to `file:///` URLs instead of routing them through the remote image proxy.
- **External games skip API fetch** — games with `external-` IDs load directly from the local manifest, eliminating 404 network errors.
- **Desktop shortcut exe auto-detection** — "Create Desktop Shortcut" now runs auto-detection before falling back to the exe picker.

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

- **Settings export & import** (`electron/main.cjs`, `electron/preload.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) — export current JSON settings and import from a file.
- **Network test** (`electron/main.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) — probe API and mirror endpoints and show timing/status results.
- **Open logs folder** (`electron/main.cjs`, `electron/preload.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) — open the app logs directory from Settings.
- **Download cache clear** (`electron/main.cjs`, `renderer/src/app/pages/SettingsPage.tsx`) — remove temporary installing parts when no downloads are active.

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
