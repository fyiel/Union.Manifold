# Union.Manifold Electron to Tauri migration

The desktop shell moved from Electron to Tauri v2. The React renderer under `renderer/`
is unchanged apart from its bridge layer. The Node main process (`electron/`, 15.7k line
`main.cjs` plus helpers) is replaced by a Rust backend under `src-tauri/`.

## What the port keeps

The live product surface, the multi source game launcher the fork is actually about.

- Multi source browse, search, detail, resolve, unified query with filters, facets and
  capability reporting. Ported near one to one to reqwest under `src-tauri/src/sources`.
- Downloads through a bundled `aria2c` sidecar with the same queue, pause, resume, cancel,
  CDN failover and crash safe manifest logic.
- Archive extraction through a bundled `7z` sidecar.
- Installed and installing library manifests, metadata, external games.
- Game launch on Windows and Linux, including Proton, Wine and umu config per game.
- Settings, themes and the separate theme editor window.
- Frameless window controls, deep links, tray, close confirmation.
- The `uc-asset` image disk cache served over a custom protocol.
- Storage precheck, buffered logs, desktop shortcuts, updater.

## What the port drops

Dead or vestigial upstream code the fork never wired up, plus native subsystems whose
cost dwarfs their value in a lean launcher. Every dropped renderer path was already
optional chained so the UI degrades instead of breaking.

- Account auth (`ucAuth`, `auth-context`) had zero consumers and still hit the network.
- `download-flow-context`, `DownloadCheckModal`, cloud collections, UC plus, user history
  and dead link reporting, all unreachable in the fork.
- The in game overlay window and its C++ injection DLL, shared memory and named pipe host,
  a Windows only subsystem with a known magic number mismatch.
- The native controller addon (gcpad) and controller navigation backend.
- VR detection, hardware system profile scanning, native volume control, screenshots,
  Discord rich presence and server side playtime sync.

## Layout

- `src-tauri/` Rust backend and Tauri config.
- `renderer/src/lib/bridge.ts` installs `window.uc*` over Tauri `invoke` and `listen`, so
  the rest of the renderer keeps calling the same API.
- `scripts/fetch-sidecars.mjs` downloads `aria2c` and `7z` into `src-tauri/binaries`.
