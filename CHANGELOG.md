# Changelog

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
