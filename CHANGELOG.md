# Changelog

## v2.7.1

### Downloads

- **Fixed: downloads failing on Windows with `SSL/TLS handshake failure … The token supplied to the function is invalid (80090308)`.** The catalog loaded fine but every download died at the TLS handshake. Cause: the bundled `aria2c` was the official Windows build, which links **Schannel** (the OS TLS stack); on affected machines Schannel couldn't negotiate the handshake with the files host (`SEC_E_INVALID_TOKEN`), even though Chromium — with its own bundled TLS — connected without issue. We now ship an **OpenSSL-linked `aria2c`** so TLS lives inside the downloader and no longer depends on the machine's Schannel state: downloads work wherever browsing already does. The OpenSSL build needs a trust store, so a Mozilla CA bundle (`cacert.pem`) is bundled and passed via `--ca-certificate` (without it OpenSSL fails every HTTPS request with "unable to get local issuer certificate"). `scripts/fetch-aria2.cjs` fetches both for fresh installs/CI.
- **Updated: the "whitelist your game folder" prompt now also covers the app itself.** Third-party antivirus (Avast, AVG, Kaspersky, ESET, Bitdefender…) can block downloads — sometimes by scanning encrypted connections — while leaving browsers untouched. The Windows Defender prompt now suggests excluding **UnionCrax.Direct** (and turning off HTTPS/SSL scanning for it), not just the download folder.

### Offline mode

- **Changed: offline mode now locks down online-only pages instead of letting them load into errors.** Previously every page tried to load while offline and collapsed into a generic error with only a small "offline" note. Now online-only pages (Browse, Search, Wishlist, Liked, History, Account, public collection browser) show a clear **full-page offline screen** — distinguishing "your device is offline" from "Union Crax isn't reachable", with a working **Try again** re-probe and a link to the status page. Pages that work offline stay open: **Library, Activity, Collections, Screenshots, Settings**.
- **Changed: launching offline opens on your Library, not the home page.** The Browse/home landing needs the catalogue, so while offline the app routes straight to the Library rather than an empty home.
- **Added: installed game pages — with their cover, hero art, logo, and screenshots — now open offline.** Opening an installed game while offline renders fully from its local manifest and locally-cached art (no network round trip). Non-installed games show the offline screen instead.
- **Added: the startup splash now reflects offline state.** It retries the server/mirror sweep once, and if nothing is reachable shows **"Starting offline."** in red before booting into offline mode (the update check is skipped, since the update feed is unreachable too).

## v2.7.0 — Launch Options & Linux

### Updates

- **Improved: app updates now finish installing on the splash, even large ones.** The startup update check used a fixed 20-second timer, so any update that took longer than that to download was abandoned mid-way — the splash closed, the main window opened, and the download restarted behind the in-app "Restart to update" pill. The check is now two-phase: a short timeout while contacting GitHub, then a progress-resetting stall watchdog once a download actually starts, so the update downloads and installs on the splash (Discord-style) regardless of size. It only gives up if the download genuinely stalls.
- **Added: a real progress bar to the in-app update notification.** While an update downloads in the background of the running app, the notification now shows a live progress bar instead of just a percentage in text. (Background re-checks already run hourly while the app is open.)

### Linux

- **Fixed: downloads failed on Linux with `aria2c … EACCES`.** The bundled `aria2c` is built on a Windows host (which has no Unix exec bit) and ships inside the AppImage's read-only squashfs mount, so it couldn't be made executable in place — every download errored with "aria2 downloader unavailable (aria2c binary not found)". The manager now guarantees an executable binary before spawning: use it as-is if already executable, else `chmod +x` in place, else stage an executable copy under `userData` and run that (the static-musl aria2c needs no sibling libraries). Robust regardless of build host or read-only mount.
- **Added: umu-launcher support for Windows games, and "Auto" now prefers Proton.** Games that launched fine once added to Steam as a non-Steam game but failed from UC.D were being run through bare Wine, which lacks the Proton runtime (DXVK/VKD3D, dependencies, protonfixes). UC.D now detects and uses **umu-launcher** (`umu-run`) — the same Proton + Steam Linux Runtime path Steam uses outside of Steam — when it's installed. The **Auto** launch mode now prefers umu → Proton → Wine (previously Wine only), with a new explicit **umu-launcher** mode and a per-game equivalent. Linux settings show whether umu is detected, with a link to the install guide when it isn't.
- **Fixed: misleading "not executable" warning for Wine/Proton launches.** The launch preflight no longer warns that a `.exe` isn't marked executable when it's being run through Wine/Proton/umu (where the exec bit is irrelevant) — only for native launches.

### Launch options

- **Added: per-game launch options in the launcher, sourced from Steam.** The admin "Fetch exes from Steam" picker already lists every launch config Steam exposes; UC.D now saves **all** of them to the game record (not just the one the admin picks), flagging the selected one as recommended. The launcher's **Launch options** dialog now shows these official options, pre-fills the recommended arguments, and lets you apply any of them with one click.
- **Added: optional, opt-in community launch options.** Players can explicitly **Publish to community** their executable + arguments (basename only — no absolute paths leave the machine) so others can see what worked; nothing is shared automatically on launch. Community options appear in a separate, clearly-labelled section with a `?` hover note that they're unverified and quality may vary — the official options stay recommended.

### Game pages

- **Added: "N in game now" live indicator on game detail pages.** A green pulsing dot, avatar stack, and player count appear under the hero title when any UC.D users are actively playing that game. Count is an anonymous aggregate (all online launchers); the avatar stack is visibility-gated to users who have opted into playtime sharing. Self-hides when the count is zero. Polls every 45 seconds and refreshes on window focus. Mirrored on the website under the same hero title. Backed by a new `/api/games/:appid/now-playing` endpoint reading the `user_direct_presence` heartbeat table (3-minute TTL).

### Downloads

- **Fixed: right-click "Add to queue" / "Download" no longer navigates to the game detail page.** A new app-wide `DownloadFlowProvider` (mounted once in `App.tsx`) exposes a `requestDownload(game)` action used by the right-click menu, the Library install overlay, and the Collections install overlay. With `downloadCheckMode: "skip"` (or the legacy `skipLinkCheck: true`) the action queues immediately and shows a toast — true one-click add-to-queue. With `"auto"` or `"always"` it opens the pre-download check modal as an overlay in place, without navigating. The `GameDetailPage` keeps its own richer download flow for the Play/Download button.

### Community & Ratings

- **Fixed: "You've played X — rate it" prompt kept reappearing after dismissal or rating.** The prompt now checks a server-confirmed `reviewed` flag from the viewer-state API (backed by the `linux_experiences` table) and suppresses itself when you've already rated. Clicking either the "Rate it" or "Leave a comment" CTA also immediately dismisses the prompt for the current session, so it can't reappear while you're still on the page. Mirrored fix on the website.

### Fixes

- **Fixed: "Game couldn't start" popup no longer fires when a game exits almost instantly.** On Windows, the launcher-to-game handoff grace period (`WINDOWS_GAME_HANDOFF_GRACE_MS`, 12 s) was inflating the `elapsed` time used to detect quick exits — genuine instant crashes measured at ~12 s+ instead of ~0 ms, so the 5-second quick-exit gate was never crossed and the popup never fired. The death timestamp is now stamped at first detection in `handleTrackedExit` (and reset to zero on successful successor adoption), so `elapsed` correctly reflects the game's actual lifetime. The popup is also suppressed when the user explicitly quit the game (`userQuitRequested`). Renderer-side, the IPC handler now fires whenever the game-just-launched watch is still armed rather than re-checking an already-expired wall-clock deadline.

## v2.6.1 — Performance & Manifest Stability

A comprehensive sweep addressing performance regressions, manifest corruption risk, and child-process lifecycle issues.

### Catalog & Game Data

- **Fixed: full catalog was re-downloaded and re-normalized on every online/offline flip.** The 6-hour TTL on `/api/games` was imported but never checked; `shouldRefreshGames` was hardwired to `connectivity.isOnline`. The entire catalog and all game entries were re-normalized (regex extraction, NFD, searchText) on every online transition and page mount. Now correctly gates on `isCatalogGamesStale()`, matching the stats TTL already in place. This alone cuts catalog churn by ~99% on the home screen.
- **Fixed: catalog games were normalized twice on every persist.** `persistCatalogCache` pre-normalized games, then `setCatalogCache` normalized the same array again — expensive regex work (developer extraction, NFD searchText, spreads) running 2× per game per save. Now normalizes once. Combined with the TTL fix, main-thread catalog work drops ~95%.

### Manifests & Storage

- **Fixed: installed.json could be corrupted on crash mid-write.** `uc_writeJsonSync` overwrote the live file directly; a crash/power-loss/full-disk mid-write left a truncated manifest → game vanishes from library or loses saved executable path. All manifest writes now use atomic temp-file + rename. Same fix applied to the download engine's manifest snapshots. Plus: removed the torn-write fallback (direct overwrite on rename failure) that re-introduced corruption.
- **Fixed: storage reservation over-counted during extraction.** `markExtracting()` was exported but never called, so every reservation held `downloadBytes + extractBytes` for its entire lifetime and falsely rejected concurrent downloads as out-of-space. Now wired at extraction start (both pipeline paths). Reservation space is correctly freed once the archive is on disk.

### Download Engine & Child Processes

- **Fixed: the aria2 daemon could be orphaned on app quit.** `stop()` relied on a post-quit `setTimeout(1500)` kill that Electron's `will-quit` never keeps alive. The daemon kept writing to disk and holding the RPC port. Now kills deterministically via `taskkill /T /F` on Windows (`spawnSync`, not async) and `SIGTERM` on Unix.
- **Fixed: overlapping poll ticks could race manifest writes and double-fire completion.** The 700ms `_pollAria2` interval fired regardless of whether the previous async poll finished. Under RPC latency, ticks overlapped, issuing concurrent `tellStatus` calls and corrupting the manifest via simultaneous writes. Added re-entrancy guard: the poller skips if a tick is in-flight.
- **Fixed: cancelled downloads left stale aria2 control files.** `cancel()` deleted the partial + `.crdownload` + resume backup but not the `.aria2 control file`, so a re-download resumed against stale segmented-download metadata and produced a corrupt file. Now also deletes the control file.
- **Fixed: an unhandled error could crash the main process.** `terminateChildProcess` spawned `taskkill` with no `error` listener. If the binary wasn't launchable (e.g. not on PATH in a stripped environment), an unhandled `error` event hard-crashed the main process. Added the listener + fallback kill.

### Image & Resource Loading

- **Fixed: the image-failure cache used O(n log n) eviction on a hot path.** Every `<img>` onError during a CDN outage called `Array.from(cache.entries()).sort()` to drop the oldest entries. Now uses the Map's insertion-order iterator — O(n) and negligible on a 1024-entry cache.
- **Fixed: uc-local:// image serving blocked the main thread.** The (already-async) protocol handler used `fs.existsSync` + `fs.readFileSync`, blocking the event loop on every local game image request. Now uses `fs.promises.access` + `readFile`. This unblocks the launcher UI while waiting for disk I/O during local asset loads.

### React Performance & Re-renders

- **Fixed: LibraryPage re-rendered ~5×/sec during any download.** The 2400-line page subscribed to the raw `downloads` array via `useDownloads()`, so every batched progress tick (200ms cadence) re-rendered the entire page and its 24-card grid. The library's download-derived logic (membership scan, failed-appids, status signatures) only needs `{appid, status}`, not byte counters. Now uses a narrow `useDownloadsSelector` with content-equality, keeping the page un-rendered except on real membership/status changes. `GameCard`'s memo is now effective.
- **Fixed: GameDetailPage re-issued disk IPC on every download progress byte.** Two effects keyed on the raw `downloads` array re-ran `getInstalled`/`listInstalledByAppid` many times per second during active downloads. Now keys on a narrow per-appid status signature (`id:status`) string, so meaningful transitions re-trigger the effects but byte-progress ticks don't.
- **Fixed: SearchPage filter sidebar remounted on every keystroke.** `FilterPanel` was a React component *defined inside the render body*, so its identity changed on every keystroke and the entire filter sidebar (genres + ~200 developer buttons) unmounted and remounted. Now invoked inline as `{FilterPanel()}` so it reconciles in place.
- **Fixed: DownloadsPage running-games check issued N sequential IPC calls every 3 seconds.** With N installed games this stalled the whole polling thread. Now parallelizes with `Promise.all` + a Map lookup.
- **Fixed: CollectionsPage re-ran expensive per-card loops on every parent render.** Membership scan, update-version check per installed appid, and cover-mosaic build recomputed for every collection card (search typing, menu toggles) even though they only depend on that collection + the stable lookup maps. Now memoized.

### Search & Sorting

- **Fixed: SearchPage sorted React state in place.** When no size/online filter narrowed the games array, `filtered` was the raw `games` state and `filtered.sort()` mutated React state directly. This can desync derived arrays and causes inconsistent renders. Now clones before sorting.
- **Fixed: SearchPage random sort re-shuffled the grid when stats arrived.** The shuffle seed was `Date.now()` — so when `gameStats` landed (a separate fetch after games), the entire grid reshuffled and every card remounted. Now uses a deterministic content-derived seed, keeping the order stable across re-renders.

### Download UI & Progress

- **Fixed: progress flush timer could leak, allowing stale updates to fire post-unmount.** The batched-progress `setTimeout` was never cleared when the provider unmounted or the onUpdate effect re-subscribed, so a pending flush could call `setDownloads` after component unmount (silent error in dev, potential state corruption in prod). Now clears on cleanup. Also: drops stale pending progress entries when a status-changing update arrives, so a queued byte-update can't clobber newer state on the next flush.

### Type Safety

- **Fixed: 3 pre-existing TypeScript errors in DownloadsPage.** The `primaryStatsRef` type was missing the `phase` field (it was hand-written and had drifted from `computeGroupStats`'s return shape), producing `TS2339` errors on every `stats.phase` read. Now derives the ref type from `computeGroupStats` so it stays in sync.

## v2.6.0 - Launch Reliability

### Game launching

- **Admin-selected executable is now used automatically.** When staff pick the launch executable for a release in the website admin panel, UC.D resolves that file inside the install folder and launches it directly — instead of guessing with the heuristic exe detector. This matters because our releases' real binary often differs from Steam's (emulator/repack), so the staff choice is authoritative. Resolution is case-insensitive and slash-agnostic: exact relative path first, then a unique basename match, then a path-suffix match (`matchAdminExecutable`). The choice is persisted into the installed manifest at download time, so it's honoured everywhere — game page, every card/activity surface, the downloads list, and deep-link/shortcut launches — even offline.
- **No executable set? You're asked when it's ambiguous.** When our team hasn't configured the launch file for a release (and you haven't picked one before): if the folder has exactly one real executable, UC.D just launches it; if there are several candidates, it opens the executable picker — best guess highlighted — instead of silently auto-launching a heuristic match that might be the wrong .exe. Your pick is saved, so the prompt only appears on the first launch.
- **Fixed: a failed launch did nothing.** Clicking Play on a broken or missing executable previously hit a silent `if (res.ok)` with no else, so nothing happened — most visible on cards/activity feeds and the downloads list. Launch failures now surface: the game page and cards show the "Game couldn't start" modal, and the downloads page shows an error toast with a *Pick executable* action.
- **Updated the "Game couldn't start" copy.** The modal previously said UC.D "has no system to determine if the right executable was chosen." It now explains that UC.D launches the staff-configured executable when one is set, and asks the user to pick manually when it isn't set for this release.
- **Fixed: launcher-based games (DELTARUNE, KSP) lost playtime and showed a false "couldn't start" popup.** Games behind a launcher stub spawn the launcher, which exits and hands off to the real game process. The main process marked a 12-second handoff grace window (`handoffPendingUntil`), but the `uc:game-exe-running` IPC handler (polled every 3s by the renderer) didn't respect it. During the gap the launcher PID was dead, so the handler incorrectly reported the game as not running and fired a second finalize loop that raced the real one — clearing the session before adoption bound the real game PID, so the session was never recorded and playtime never synced to the leaderboard. The handler now respects the handoff window, returning `running: true` until the grace period closes, so the adoption completes cleanly and playtime records on real exit.
- **Added "Launch Steam" action to the "Game couldn't start" modal for online games.** Games with multiplayer/online support often fail to launch when Steam isn't already running in the background (they can't reach the Steam client to bootstrap online services). When a game with online modes fails to launch, the modal now shows a blue notice: *"We detected that this game might have online support. For the game to launch, you may need to run Steam in the background."* with a one-click **Launch Steam** button that starts (or focuses) the Steam client via the `steam://open/main` protocol, then tells the user to retry Play.

### Right-click / action menu

- **Fixed: the Download row showed the wrong state mid-download.** Depending on timing it would say "Add to download queue" (a no-op for a game already downloading) or even "Download". The row is now a single source of truth: while a download/install for that game is in flight — any non-terminal state, including the previously-missed `install_ready` — it's shown **disabled** as "Downloading…"; otherwise it's an enabled "Download". The confusing "Add to download queue" wording is gone.

### Downloads

- **Fixed: downloading from outside the game page skipped the pre-download check.** The availability/host-selector modal only existed on the game detail page, so right-click → **Download** (and other card/list download entries) queued silently with defaults — no storage/sysreq/host check. A fresh download started from the universal menu now routes to the game page with `?download=1`, which runs the same pre-download check modal everywhere (respecting the user's `auto`/`always`/`skip` setting). "Add to queue" for an already-downloading game stays a direct in-place action.

### Version status

- **Non-public beta builds are now flagged instead of nagged.** When the installed build number is higher than Steam's public build (a non-public beta), the Version Status card no longer says "A newer build is available" — it reads up-to-date and marks the build red with a **BETA** badge plus a "This is a non-public beta release." line. A `- BETA` suffix entered by staff is preserved (it was previously stripped) and surfaces the same red treatment in both the Version Status card and the game's Details section.

## v2.5.3 — Tray Menu Fix · 2026-06-04

### Tray

- **Fixed: tray right-click menu showed the raw app ID instead of the game name while a game was running.** `pickCurrentRunningGame()` looked for `payload.name` and `payload.title`, but `registerRunningGame()` stores the name under `payload.gameName`. The lookup now checks `gameName` first.

## v2.5.2 — Overlay, Presence & Download Fixes · 2026-06-01

A bug-fix release squashing four issues around Discord Rich Presence, the in-game overlay, and the smart pre-download check.

### Discord Rich Presence

- **Fixed: minimising UC.D to the tray while playing a game stopped the Discord presence.** The window `hide`/`minimize` handlers cleared *all* presence — including the active game. Presence is now resolved from a single source of truth (`resolveRpcActivity`): a running game always wins and stays visible regardless of window state, while the launcher ("browsing UC.D") presence is the only thing suppressed when the window is hidden. So putting the launcher in the tray mid-game keeps Discord showing the game.
- **Fixed: the presence thumbnail used the wrong art.** The `largeImageKey` now prefers the game's logo when UC has one — the `hero_logo` the detail API resolves (admin `hero_logo_override`, else the SteamGridDB static logo) and which is saved into the installed manifest at download time — since it reads far better as a presence thumbnail than a cropped wide hero. It then falls back through `hero_logo_override` → `hero_image` → `image` → `splash`, and finally to the default app icon.

### In-game overlay

- **Fixed: the overlay dim + mouse capture lingered after closing a game and opening another, forcing an Escape press to interact.** Two changes: the renderer's `game-exited` handler now also tells the main process to hide the native overlay window (releasing its `ignoreMouseEvents=false` panel capture instead of only clearing the React state), and the main process now hides the overlay when the game it was bound to exits — even if another game is still running.
- **Fixed: launching a game flashed the full overlay panel for a moment before the toast.** `enterMode` set the React `mode` inside `requestAnimationFrame`, leaving one painted frame on the *previous* mode; with the overlay window's timers throttled while hidden, that stale frame showed the dimmed panel. The target mode is now committed synchronously and only the enter animation is deferred to the next frame.
- **Fixed: the full overlay panel sometimes failed to appear over exclusive-fullscreen games even though the launch toast did.** `showOverlay` now re-asserts the top-most (`screen-saver`) level before showing, matching what the toast path already did.

### Smart pre-download

- **Fixed: the pre-download check popup still appeared on the all-green happy path instead of auto-confirming.** The auto-confirm effect depended on the inline `onConfirm` callback (recreated every render), so the storage / sysreq / driver state updates that land during the 300ms grace re-ran the effect, whose cleanup cancelled the pending timer — and the fired-guard then blocked a reschedule. The effect now depends only on eligibility + open state (callback/host read from refs) and re-checks eligibility at fire time, so a clean check (enough storage, sysreq pass, no HV) starts the download without an extra click.

### Archive install

- **Fixed: some valid archives failed install with `7zip exited with code 2` even though most files extracted correctly.** Extraction now treats warning code `1` as non-fatal, and treats code `2` as usable when every `ERROR:` line is `Unsupported Method` and files were actually extracted (for example ARM64-only plugin DLLs inside otherwise-working x64 game archives).
- **Added install warning surfacing for skipped incompatible files.** When extraction succeeds with non-fatal skipped entries, the download/install UI now shows a compact note like `2 files skipped (incompatible archive method)` instead of failing the whole install.

## v2.5.1 — Polish & Parity · 2026-05-30

A follow-up to v2.5.0 that pops the theme editor out into its own window, brings the website's community/social context onto the desktop game page, refreshes the Linux experiences cards, and finishes migrating the UI onto the animated icon set.

### What's New modal

- **Fixed: the "What's new" modal showed "No changelog available right now" in installed builds.** `CHANGELOG.md` was never bundled into the packaged app (it wasn't in electron-builder's `files` list), so the `uc:get-changelog` handler couldn't find it anywhere on disk and the modal fell back to its empty state. The changelog is now packaged with the app, so release notes render in production the same way they do in dev.

### Theme editor

- **Pop-out theme editor window** — editing a theme now opens a dedicated, full-size Electron window (`ThemeEditorWindow`) instead of an in-page panel, so the main window stays visible and previews your draft live as you drag colour pickers. Unsaved drafts are streamed to the main window over a `uc:theme-preview` relay and automatically reverted when the editor closes; saves ride the normal `ucSettings` broadcast so every window updates together.
- **Live preview in `useActiveTheme`** — the active-theme hook now accepts a transient `previewTheme` that takes priority over the persisted theme while the editor window is open, then clears itself on preview-end.
- `ThemeEditor` was split into a reusable `ThemeEditorBody` so both the settings tab and the standalone window share one implementation.

### Game community section

- **Top players & community activity on the game page** — the desktop game detail page gains new **Community** and **You** tabs backed by `GameTopPlayers` and `GameCommunityActivity`, which hit the same `/api/games/:appid/top-players` and `/community-activity` endpoints the website uses. Both panels self-hide when there's nothing to show, so the launcher's game page now mirrors the social context you see on union-crax.xyz.

### Linux experiences

- **Redesigned experience cards** — the per-game Linux experiences list now uses coloured rating pills (red → sky by score) and a tightened card layout that surfaces the Proton version and report date at a glance, matching the website's experiences redesign.

### Icons & polish

- **Animated icon migration** — components and pages across the launcher (game detail, settings, search, library, collections, overlay, and more) now import from the shared animated `@/components/icons` set instead of raw `lucide-react`, for consistent hover/active motion.
- Added animated wrappers for `X`, `BatteryFull`, `CloudUpload`, `GitFork`, `MessageCircle`, `Reply`, `UserPlus`, `UserRound`, and `Share2`.

## v2.5.0 — Themes, Tools & Infrastructure

A major quality-of-life release centred on UI personalisation, per-game tooling, and a rewritten download backend. Every page now inherits a live token-based theme, the download engine is a proper standalone class, and a first-run onboarding flow makes sure new users land somewhere useful.

### Custom Themes & Appearance

- **Full theme engine** — a token-based CSS-variable system (`lib/themes/`) with preset themes, schema versioning, encode/decode for shareable theme codes, contrast validation, and per-token font selection from a curated font registry.
- **Appearance settings tab** — new Settings → Appearance section (deep-linkable via `?section=appearance`) with theme cards showing colour swatches, active-state indicators, and a context-menu for Edit / Duplicate / Export / Publish / Delete per theme.
- **Theme editor** — full per-token colour picker built with memoised `ColorRow` components and rAF-coalesced updates so dragging a picker doesn't stutter even across all 28 CSS tokens. Tokens are grouped into Surface / Accent / Neutral / Danger / Sidebar panels. Live preview is applied instantly via CSS variable injection.
- **Theme import/export** — themes can be exported as a compact encoded string and re-imported on any device. Import validates schema and contrast before adding to the library.
- **Community theme browser** — in-app gallery backed by `/api/themes` with sort-by-popular / sort-by-new, search, one-click install with install-count display, and persistence of installed community themes in `ucSettings` so they survive restarts.
- **Theme publishing** — custom themes can be published to the community gallery from within the editor.
- **`useActiveTheme` / `useCustomThemes` hooks** — reactive hooks keep theme selection and the custom-theme library in sync across tabs and restarts via `localStorage` events and `ucSettings.onChanged`.
- **UC+ theme slots** — free accounts get 10 custom theme slots; UC+ members get 100.

### Per-Game Tools (Game Detail Page)

- **Game notes panel** (`GameNotesPanel`) — per-game scratchpad that persists locally to `libraryGameMeta[appid].notes` for offline access and syncs to `/api/account/game-notes` (debounced 600ms + on blur). Shows sync state (cloud / local-only / anonymous).
- **Playtime sparkline** (`PlaytimeChart`) — 30-day daily bar chart fetched from `/api/playtime/chart`. Shows hover tooltip with session count. Hidden when no sessions are recorded for the game.
- **Per-game launch options** (`LaunchOptionsModal`) — Steam-style custom launch arguments persisted under `settings.gameLaunchArgs[appid]` and appended to the process argv at spawn.

### Keyboard Shortcuts

- **Rebindable keyboard shortcuts** — `use-keyboard-shortcuts.ts` is rewritten with a `SHORTCUT_DEFINITIONS` registry shared across the handler, the rebind UI, and the cheat-sheet dialog. Every shortcut stores a user-chosen binding in `ucSettings` and the module-level cache is invalidated on change so bindings take effect immediately.
- **Keyboard shortcuts dialog** (`KeyboardShortcutsDialog`) — press `?` anywhere outside a text field to open an overlay listing every action with its current binding (default or custom). Renderable binding strings show individual `<kbd>` caps.
- **Keybindings panel** (`KeybindingsPanel`) — new Settings section for rebinding each shortcut; persists to `ucSettings`.

### Onboarding & What's New

- **First-run onboarding modal** (`OnboardingModal`) — four-step flow (Welcome → Discord sign-in → Install drive → First game). Fires once per device on first launch (keyed to `uc_onboarding_completed_v1`), skips if already completed, and can be re-opened via the `uc_open_onboarding` window event for a future "Walk me through the launcher again" settings entry.
- **What's New modal** (`WhatsNewModal`) — auto-opens after an update when the current version is higher than `lastSeenWhatsNewVersion` in settings. Parses `CHANGELOG.md` at runtime as the single source of truth — no separate data file. Highlights are classified as `feature` / `fix` / `polish` with matching icons and accent colours. Re-openable via the `uc_open_whats_new` event.

### Download Engine

- **Standalone download engine** (`electron/download-engine.cjs`) — the ad-hoc download logic in `main.cjs` has been extracted into a proper `DownloadEngine` `EventEmitter` class. It owns the queue, the active slot, pause/resume/cancel, and the `.ucresume` partial-file hardlink strategy. Sidecar metadata files (cover art, screenshots, JSON manifests) are detected by stem and extension and never mistaken for resumable partials.

### Running-Games Tracking

- **Module-level running-games cache** (`use-running-games.ts`) — a singleton `Set` hydrated by one IPC round-trip on first subscription and kept live by `ucPresence.onChanged` push events. All `GameCard` components read the same Set so there's no per-card polling. Session start times are tracked for every appid so elapsed-session durations are available synchronously.

### Library & Storage

- **Disk usage breakdown** (`DiskUsageBreakdown`) — shows total bytes used by all installed games plus a sorted proportional-bar list of the biggest contributors. Reads from manifest `sizeBytes` (no filesystem walk). Updates on `uc_game_installed` events. Mountable in Library footer, Settings → Downloads, or a sidebar.
- **Installed-games sync hook** (`use-installed-games-sync.ts`) — keeps the in-memory installed-games list in sync with `ucSettings` without a full context re-render on every mutation.

### UC+ Integration

- **UC+ panel in Settings** (`UcPlusPanel`) — native claim-code flow (Ko-fi webhook → server-side activation). Shows subscription status, expiry date, days-remaining countdown, copy-code button, and a refresh action. Previously required bouncing to the website.

### Settings Restructuring

- Settings now has a full sidebar navigation with nine sections: Account, Downloads, Game Launch, Overlay, Controller, System Profile, **Appearance** (new), Advanced, and **Membership / UC+** (new). Each section is deep-linkable via `?section=<id>`.

### Misc Fixes & Improvements

- **Image failure cache** (`lib/image-failure-cache.ts`) — failed CDN image URLs are cached in memory so the same broken URL doesn't trigger repeated network requests per render cycle.
- **Game detail prefetch** (`lib/game-detail-prefetch.ts`) — preloads game-detail API responses on hover so the page transition feels instant.
- **RPC game cache** (`lib/rpc-game-cache.ts`) — Discord Rich Presence game-art lookups are memoised to avoid redundant API calls per status change.
- **NSFW reveal hook** (`use-nsfw-reveal.ts`) — per-session NSFW content reveal tracking, prevents the confirmation prompt re-appearing within the same app session.
- **Pause-on-launch hook** (`use-pause-on-launch.ts`) — pauses active downloads when a game launches to free bandwidth, resumes when the game exits.
- **RPC game mute hook** (`use-rpc-game-mute.ts`) — per-game opt-out of Discord Rich Presence presence, persisted in `ucSettings`.
- **`ThemeBoundary` component** — error boundary wrapping theme application; falls back to the default preset if a custom theme fails to apply rather than crashing the renderer.
- **`EmptyState` component** — shared empty-state illustration used consistently across Library, Wishlist, Collections, and Search pages.
- **`media-image` UI primitive** — image component with built-in failure-cache integration, skeleton loading state, and crossfade transition.
## v2.3.0

### Aura color effect

- **Introduced aura color effect across the app.** Game cards now emit a per-card colored halo sourced from dominant colors extracted from the cover art. A matching full-page aura overlay fades in when hovering game cards, active on the home, search, library, wishlist, liked, view history, coming soon, collection, and game detail pages.

### System Profile scanner

- **Replaced custom scanner implementation with `systeminformation` v5.31.6.** The ~1380-line hand-rolled PowerShell/WMI + native CLI scanner has been rewritten to ~306 lines using the cross-platform `systeminformation` npm package. Exports, SPEC_VERSION (3), cache format, and spec shape are identical — `main.cjs` and the renderer require no changes. Vulkan version is still probed via `vulkaninfo --summary` since `systeminformation` does not expose graphics-API version strings.

## v2.2.0 — Crossroads · 2026-05-19

Linux gets first-class treatment across the launcher, the system scanner gets sharper teeth, and the updater + installer stop tripping over themselves. Picks up the system-profile groundwork laid in v2.1.0 and makes that data actually matter cross-platform — sysreq panels auto-pick your OS, the runnable filter respects it, the scanner reports DDR/NVMe types correctly on both platforms, and the launcher no longer pretends a Linux user lives in a Windows world.

### Linux system requirements

- **"Will it run on my PC?" panel auto-picks Linux on Linux.** The pre-download check on game detail pages and inside the Download dialog now reads `spec.os.platform` from your scanned profile — Linux users get Linux requirements compared by default, Windows users get Windows. When the game publishes both, a Steam-style segmented pill in the panel header lets you flip between them; when only one is published the pill collapses to a label so it's still clear which OS the verdict is against. A Linux user looking at a Windows-only title still gets a panel — the comparison is meaningful via Proton — but cross-platform fallback no longer renders a hard "fail" verdict, since the storefront never published a peer-platform spec for us to judge against.
- **"Can my PC run" filter on Search respects your OS.** Linux users no longer see Windows specs evaluated against their Linux hardware in the Search-page filter results. Cross-platform fallback is generous: a game whose preferred-OS row is empty still passes the filter on the other-OS row, so you don't lose catalog rows because the storefront only published one platform.

### Updater + installer

- **Splash auto-install no longer hijacks the in-app "Restart to update" pill.** The startup splash check used to leave its `update-downloaded` listener attached after the 20-second safety timer fired, so when a background download finished later the stale listener would call `quitAndInstall` — even though the user was already looking at the click-to-install pill in the running app. `settle()` now detaches every listener it registered (`update-available`, `update-downloaded`, `update-not-available`, `error`, `download-progress`), and `autoInstallOnAppQuit` is set to `false` so closing the app for unrelated reasons can't sneak in an install either. The pill is now the *only* path to install, exactly as the button advertises.
- **Mid-publish GitHub releases no longer surface a long "Update failed" pill.** When a release was being uploaded and the launcher hit it between the `latest.yml` and `.exe` going live, the auto-updater would throw a download or signature error that the global handler immediately wrote into the in-app update state. The error pill then sat there until the user dismissed it. The global error handler now suppresses errors while the splash-phase update check is in flight; the splash already had its own quiet error path, so a half-published release just falls through to "Almost there…" and is retried on next launch.
- **NSIS finish-page "Run UnionCrax.Direct" closes the installer instantly.** The default behaviour returned control to NSIS only after Windows finished spawning the .exe — and on a fresh install that includes Authenticode verification + a Defender on-access scan, which can visibly freeze the installer dialog for several seconds. Users assumed nothing had happened and spammed the button. The installer now hides its window the moment the click registers and UC.D's own splash takes over.

### System Profile scanner

- **No longer crashes the main process on startup** — a JSDoc block comment in `electron/system-profile.cjs` included a literal path whose `*/` closed the comment early and produced a `SyntaxError: Invalid or unexpected token` on require. Rewritten to keep the actual glob unchanged.
- **GPU picker no longer crowns virtual displays** — Windows scans were promoting "Meta Oculus Virtual" (and other paravirtual adapters like Parsec, Microsoft Basic Display, IddSampleDriver, Hyper-V, DisplayLink, spacedesk, VMware/VirtualBox) above real GPUs because Win32_VideoController returns adapters in enumeration order. GPUs are now ranked: real silicon (NVIDIA/AMD/Intel/Apple) before virtual, active before inactive, then by VRAM and currently-driven resolution. The "primary GPU" the renderer reads from `gpus[0]` is now the card actually rendering your games.
- **Linux "Device 1111" GPU labels fixed** — `lspci -mm` returns the literal string `Device 1111` (or whatever the device ID is) when the local `pci.ids` database is older than your kernel, which is the norm on rolling-release distros. Linux GPU detection now: parses `lspci -nn -mm` to keep the numeric vendor:device IDs alongside the name, enriches from `/sys/class/drm/card*/device/uevent` (kernel-resolved PCI IDs + driver name), pulls marketing names + VRAM + driver version from `nvidia-smi` when present, and uses the OpenGL renderer string as a final fallback. If every source still comes up empty, the label falls back to `Vendor [10de:2684]` instead of "Device 2684".
- **Cold-scan reliability** — PowerShell + WMI cold-start could take 10+ seconds on the first scan after boot, and our 8s budget was truncating it into half-empty results that the user "fixed" by clicking Rescan. The Windows probe now has a 30s budget, retries once on a structurally empty result, and wraps each CIM query in its own try/catch so one slow class (e.g. Storage Spaces on Server Core) can't blank out the others.
- **All drives reported, not just one** — Win32_DiskDrive correlation against Get-PhysicalDisk now happens server-side in the PS probe at depth-8 JSON, so multi-drive rigs no longer collapse to a single entry. The Storage tile now lists every drive (with model/size/media type) rather than the first two.
- **Real SSD/NVMe/HDD detection on Windows** — Win32_DiskDrive's `MediaType` reports "Fixed hard disk media" for SSDs too, which was bucketing every drive as `hdd`. Drives are now matched to their `Get-PhysicalDisk` row by index, so NVMe drives report `nvme`, SATA SSDs report `ssd`, and spinners report `hdd`. The bus type (`nvme`/`sata`/`usb`/etc.) is captured too.
- **RAM type detected (DDR3/DDR4/DDR5, LPDDR4/5)** — the scanner now decodes `Win32_PhysicalMemory.SMBIOSMemoryType` on Windows and parses `dmidecode -t memory` on Linux (best-effort, silent skip when not root). Form factor (DIMM/SODIMM) is captured too. The RAM tile now reads `32 GB DDR5 · 6000 MHz · dual · DIMM` instead of just `32 GB · 6000 MHz`. The summary chip surfaces it as well (`RTX 4070 · i7-13700K · 32GB DDR5 · Win11`).
- **Linux drive enumeration cross-check** — when `lsblk` hid a drive (mmcblk on Chromebooks, some virtio-blk configs, NVMe namespaces reported with unexpected types), the scanner now backstops with `/sys/block` so the drive still shows up. Loop / ram / dm / sr devices are filtered out either way.
- **Spec version bumped to 2** — existing cached profiles still load; new fields (`ram.type`, `ram.formFactor`, `drive.busType`, `drive.serial`) are optional in the type definition.

### Community Leaderboard + Playtime tracking

- **Playtime tracking in UC.D** — sessions are now timed on every game launch (with proper accounting for the Windows successor-PID handoff used by Unity-style launchers) and persisted in a local `playtime.json` queue. Per-game totals and session counts are written into `libraryGameMeta` so library UI can show a "12h played" chip without a network roundtrip. Sessions shorter than 30s are dropped to avoid polluting totals; sessions longer than 36h are clamped.
- **Server sync** — when signed in, UC.D auto-flushes pending sessions to a new `/api/playtime/sessions` endpoint every 5 minutes and immediately after each game exit. Uploads are idempotent on a UC.D-generated `clientSessionId` so a flaky network can't double-count.
- **Share-a-spec links removed** — removed UC.D support for mint/list/revoke share links and removed the in-app `/specs/:shortCode` landing route. System Profile now keeps scan/visibility, multi-rig device controls, and upgrade suggestions without short-link sharing.
- **`/leaderboard` page** (replaces `/stats/hardware`) — community leaderboard with two tabs:
  - **Playtime** — all-time and this-week boards with rank, avatar, total/week split, a horizontal bar, and the user's top-3 most-played games as inline chips. Restricted to users with the Public profile tier set to summary or full.
  - **Hardware** — top GPUs, CPUs, vendors, RAM buckets, OS, and storage media. Top GPU and CPU rows now surface the usernames + avatars of owners who opted into a public profile (anonymous contributors still count toward percentages but don't appear in the owner chip list).
- **Public profile playtime card** (`/user/[username]`) — when a user has a public profile and any recorded playtime, their profile shows total + this-week totals, both ranks vs. the rest of the community, session count, last session date, and their top-5 most-played games with cover-art-friendly progress bars. Old `/stats/hardware` URLs redirect to `/leaderboard?tab=hardware`.
- **Stuck "currently playing" fix** — when a game was closed from inside its own UI, UC.D could continue thinking the game was running (the spawned launcher handle's `exit` event sometimes never fired under `detached: true` + `unref()` on Windows). Tracked PIDs are now actively polled every 3s, and the 15s `pruneRunningGames` sweep routes dead PIDs through the same finalisation path as `proc.on('exit')` — so the playtime session is recorded, RPC clears, and the overlay hides whether the game exits cleanly or vanishes silently.

### Wishlist

- **PC compatibility card on the Wishlist page** — the upgrade-suggestions card from Settings → System Profile is now surfaced directly on the Wishlist page. When all wishlisted games pass minimum requirements it shows the "Your PC clears every wishlist game" good-news banner; otherwise it shows the bottleneck breakdown with per-component suggestions. The card is skipped entirely when no system profile has been scanned or the wishlist has no evaluable games.

## v2.1.0 — System Profile - 2026-05-14 - 2026-05-19

### UC System Profile — UC.D consumer-side parity (2026-05-19)

Round-trip on the System Profile work: the launcher now consumes the same hardware data that's already being scanned and shared with the website, so users don't need to bounce to the web to benefit from their scan.

- **"Can my PC run" filter on Search** — `/search` gains a new "My PC" filter section with three pill buttons (All games · Can run (min) · Smooth (rec)). Filtered results come from the website's `/api/games?canRun=...` endpoint, which resolves the caller's session and active profile server-side. When the filter is selected without a scan on file, an inline banner offers a one-click "Scan now" CTA that deep-links to `/settings?section=system&autoScan=1`.
- **Per-game requirement check on game pages** — game detail pages now render a "Will it run on my PC?" card above the raw Steam-HTML requirements block when the game has structured `min_requirements` / `recommended_requirements` published. Comparison runs locally against the cached profile (no network roundtrip), shows per-component pass/warn/fail (CPU, GPU, RAM, Storage, OS, DirectX), and the same scan CTA when no profile is cached.
- **"Attach my specs" toggle on comments** — comment forms (both top-level and reply) now render a per-post specs toggle next to the Post button when the viewer is signed in and has an active profile. The toggle defaults to the user's global comment-visibility tier and only overrides it for the current post — the persistent setting in Settings is untouched. Posted comments from any UC surface now render an inline `Cpu · RTX 4070 · 32GB · Win11` chip next to the author's name when the poster opted in for that post.
- **Shared spec landing page** — `/specs/:shortCode` links minted from Settings → System Profile → Share-a-spec now open inside UC.D and render the same summary/full spec card as the website. Previously the link could only be viewed on the web.

### New Features — UC System Profile

The launcher can now scan your PC's hardware and use it across the whole UC ecosystem: pre-download requirement checks, library filtering, opt-in spec badges on comments/forums, multi-rig device switching, and crash-report enrichment. Nothing leaves your machine until you flip an online sharing switch.

- **Hardware scanner** (Settings → System Profile → Scan now). Detects CPU, GPU(s) with VRAM and driver date, RAM (total / speed / channels), all drives with NVMe/SSD/HDD media type, OS build, displays (resolution + refresh rate), and DirectX/Vulkan versions. Uses platform-native tools only — no new npm dependencies, no native rebuild required. PowerShell-based on Windows, `/proc` + `lscpu`/`lspci` on Linux. A fingerprint hash detects when the PC has changed and prompts for a rescan.
- **Pre-download requirement check** in the Download dialog. When a game has system requirements published, the modal now shows a per-component pass/warn/fail comparison against your scanned hardware. Can be disabled from Settings → System Profile → Pre-download requirement check.
- **Storage reservation for downloads**. UC.D now refuses to start a download when the target drive doesn't have room for the archive PLUS the extracted install (estimated as 2× archive size, or the declared install size when known, plus a 5%/2GB safety buffer). Concurrent downloads now correctly account for each other's reservations on the same drive — no more double-booking free space. Reservations are released on cancel, error, or extraction completion.
- **Storage-type hint** in the Download dialog. When you're installing a 30GB+ game to an HDD and you have an SSD/NVMe drive available, the dialog now suggests switching the download path. Best-effort on Windows (uses Storage Spaces cmdlets to map drive letters to physical media); not yet wired on Linux.
- **GPU driver staleness warning** in the Download dialog. Warns when your GPU driver is more than 6 months old and links to the NVIDIA / AMD / Intel / Apple driver page based on the detected vendor.
- **System Profile settings panel** (new section in Settings sidebar) with per-surface visibility toggles: Comment badge / Forum posts (off · summary) and Public profile card (off · summary · full). The pre-download check toggle is local-only and on by default.
- **Server sync** — when at least one online surface is set above "Off", scans are automatically uploaded to UC. Visibility state is mirrored to the server so other UC surfaces (game pages, forum posts) can render your specs at the tier you allowed. Clearing the local cache or flipping every surface back to "Off" deletes the server copy.
- **Multi-rig device picker** — when you've scanned more than one device, a "My PCs" card lets you pick which rig is treated as your active profile. Rename and forget controls per device. Uploads tag the device with `hostname()` by default.
- **Share-a-spec links** — mint a short URL (`/specs/abc12345`) anyone can open to see your specs frozen at create time. Useful for "can your friend's PC run this?" conversations. Summary or Full tier per link, revokable from Settings.
- **Upgrade suggester** — analyses your UC wishlist against your active profile, identifies the biggest bottleneck component, and suggests a coarse next-tier upgrade (e.g. "Upgrade GTX 1060 → RTX 3060 / RX 6700-class card · would unlock 7 wishlisted games"). Only shown when at least one online surface is on.
- **Per-post specs toggle** on comment and forum forms — each post can override the global visibility setting. Defaults match your global tier so unchanged behavior stays consistent.
- **Crash report enrichment** — when sharing diagnostics (Settings → Account → Privacy → Send error reports), an optional one-line hardware summary ("RTX 4070 · 32GB · Win11") is attached so the dev team can reproduce platform-specific issues. Opt-out via the new "Include hardware summary in error reports" toggle.
- **`unioncrax://scan` deep link** — clicking "Scan in UC.Direct" from the website now opens UC.D, navigates straight to Settings → System Profile, and triggers a fresh scan. Extends the existing `unioncrax://launch` handler with a navigation-action queue that drains once the main window finishes loading.
- **Website parity surfaces** (cross-repo with `union-crax.xyz`): the website's download dialog now shows the same per-component pass/warn/fail sysreq comparison UC.D's download modal does, the `/settings` page gains a full "System Profile" section mirroring UC.D's panel (visibility toggles, multi-rig device picker, share-a-spec links, upgrade suggestions) — minus scanning, which it delegates back to UC.D via the deep link. Web "Scan in UC.Direct" buttons follow the same install-detection pattern as the existing "Open in UC.D" button.

### Fixes & Improvements

- Updated multiplayer wording across game surfaces for consistency: game detail badges now read `Multiplayer`, compact game-card badges now read `MP`, and search filter labels/chips now use `Multiplayer` language on both website and desktop search pages.
- Always refresh Windows `unioncrax://` protocol metadata at startup, even when protocol re-registration returns false, so browser "Open this application" prompts keep showing the short `UC.D` label instead of stale long handler names from older installs.
- Reduced overlay-related freeze/crash risk by removing native overlay DLL injection from the panel-open path for now (toast/panel continue using the window overlay path), and keeping the native injection safety denylist protections in place while the DLL path is stabilized.
- Added one-time renderer self-recovery for the critical `ReferenceError: games is not defined` failure path: the app now auto-reloads once per session and logs the event for diagnostics.

## v2.0.2 - 2026-05-14

### Fixes & Improvements

- Fixed overlay DLL stability issues across multiple graphics APIs (D3D9, D3D11, OpenGL) and improved memory management in shared frame buffer and IPC pipe client.

## v2.0.1 - 2026-05-13

### Fixes & Improvements

- Persisted API reachability across app restarts and switched shared catalog refresh logic to the app's connectivity state, preventing offline mode from briefly loading online content or immediately retrying stale catalog fetches on startup.
- Extended update visibility beyond the game details page: launcher, search, library, and custom collection cards now surface update-available state, with collection tiles showing per-collection update counts for installed games.
- Hardened game-card media fallback behavior and cleared stale installed-image/version state after delete actions, so removed games stop trying to render missing local artwork and cards recover more cleanly from bad cached assets.
- Added a one-time Windows Defender guidance prompt on Windows first launch, including quick actions to open the configured game folder and jump directly into Windows Security exclusion settings.

## v2.0.0 - 2026-04-16 - 2026-05-13

### New Features

- Added `unioncrax://` deep-link protocol support. Clicking `unioncrax://launch?appid=<appid>` from a browser or shortcut opens UC.D and launches (or prompts for) that game.
- Registered `unioncrax://` protocol handler in electron-builder config for Windows and Linux packaged builds.
- Desktop shortcuts now target UC.D itself (`--launch-appid=<appid>`) rather than the game executable directly, making shortcuts work regardless of where the game is installed.
- Added deep-link intake queue (`pendingAppLaunchRequests`) that processes on first window load, on second-instance activation, and on macOS `open-url` events.

### Fixes & Improvements

- Regenerate `icon.ico` with a dark background so the UC mark is visible in the NSIS installer title bar and on light-themed Windows surfaces (previously white-on-white).
- Remove auto-detected custom installer BMP assets; NSIS installer now uses standard electron-builder UI without custom header/sidebar bitmaps.
- Fix custom title bar icon in packaged builds: `TitleBar.tsx` now loads `icon.svg` via `import.meta.env.BASE_URL` so it resolves correctly under `file://`; also labels the title bar as `UC.D`.
- Stop `unioncrax://launch` from forcing an EXE lookup for games that are not installed; undownloaded games now open their UC.D detail page without the misleading no-EXE flow.
- Resolve packaged brand image paths relative to the bundled renderer base so navbar/loading logos keep rendering in packaged Windows builds.
- Add dedicated NSIS branding assets and refresh the Windows `.ico` bundle so installer screens, shortcuts, and shell surfaces use clearer high-resolution branding.
- Shorten Windows shell-facing titles and installer copy to `UC.D`, while keeping the app's internal identity stable so existing user data paths continue to resolve.
- Prevent development builds from re-registering `unioncrax://` on Windows, so local packaged installs keep the intended handler instead of Electron dev metadata.
- Stamp Windows deep-link metadata with a friendly UC.D label/icon, and make owned desktop shortcuts prefer the selected game executable icon instead of the UC.D app icon.
- Persist known game names during shortcut creation and launch so deep-link launches and Discord/Now Playing surfaces stop falling back to raw appids.
- Improved game-media parity between UC.D and the website by enriching install metadata with the full `/api/games/:appid` payload before downloads start, so installed manifests keep richer artwork and metadata fields.
- Expanded local media caching during install to persist additional assets (`hero_image`, `background_image`, `hero_logo`, `hero_animated`) plus screenshots, with URL normalization for scheme-less media hosts.
- Updated launcher card-art selection to prioritize richer current media fields (`hero_image`, `background_image`, `splash`) before legacy/stale local cover paths, with local cache paths retained as fallback.
- Matched launcher card artwork selection to website parity and replaced in-card old-image fallback flashes with skeleton-first loading, so cards no longer briefly show stale/local low-quality art before the final image resolves.
- Hardened catalog normalization for co-op/HV flags by accepting `hasCoOp`/`has_coop` (and legacy `online_fix`) so Online badges render consistently across launcher cards and filters.
- Improved offline/installed screenshot behavior on game Details pages by falling back to locally cached screenshots when API screenshot arrays are missing.
- Reworked installed-game actions so Library covers now support right-click context menus, visible hover tools, and a shared action surface across Library and game Details instead of hiding everything behind a tiny settings gear.
- Polished the Library command header with clearer hierarchy, better search guidance, and direct affordance hints so advanced actions are easier to discover.
- Simplified UC.Files download behavior to use Electron's standard downloader path (same flow as other hosts) now that storage is Backblaze-backed, removing reliance on the custom parallel UC.Files path.
- Fixed UC.Files share-link resolution for `/download/{token}` URLs by treating them as share tokens (not file IDs), preventing false "link could not be resolved" failures during game downloads.
- Fixed UC.Files-backed artwork and animated hero media on mirror domains by routing them through the active website domain instead of loading `files.union-crax.xyz` directly. This also covers remaining overlay and avatar media paths that were still bypassing the shared proxy helper.
- Updated game Details panel metadata flow to include `Date Added` and relative `Edited` timestamps for clearer change visibility.
- Reordered game Details fields for better scan order: Released, Date Added, Edited, Version, Size, Source.
- Matched Source display behavior to web parity in game Details: outlined source badge plus hover tooltip (`Source: ...`) with truncation and Unknown fallback.
- Redesigned threaded comments for scale and mobile readability: capped visual nesting depth, added mobile flat-thread presentation with `Replying to @...` context labels, introduced progressive reply reveal (`View X more replies`), and added deep-thread continuation controls (`Continue thread ->`) to prevent long-thread overload.

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

- **Fixed download payload type validation in Electron** - the `uc:download-start` and `uc:download-resume-with-fresh-url` IPC handlers now defensively coerce non-string `url` values (e.g., persisted `DownloadHostEntry` objects from old builds) to strings before calling `.includes()`, preventing "url.includes is not a function" errors ([#15](https://github.com/UnionCrax-Team/UnionCrax.Direct/issues/15))
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
- **Linux gaming and VR support** - added comprehensive support for Windows games on Linux via Wine/Proton, and set up SteamVR/OpenXR for VR games ([#14](https://github.com/UnionCrax-Team/UnionCrax.Direct/pull/14))
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
