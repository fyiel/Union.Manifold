# Changelog

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
