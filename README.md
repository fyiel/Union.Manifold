# Union.Manifold

This is my fork of UnionCrax.Direct. I wanted one launcher that pulled from more than one source and looked the way I like, so I rebuilt the front end and wired up a multi source backend behind it.

What changed from the original:
- it now reads from several sources at once and dedupes them into one library
- the whole UI is redesigned, monochrome and minimal
- the library page got a proper card menu, launch options and Linux Proton config
- browse, search and filters all run through one query layer
- local Steam-compatible achievement tracking, a progress library and in-game unlock popups

The desktop shell is now Tauri and Rust instead of Electron, so the whole backend is one lean Rust crate under `src-tauri`. The React front end is the same, it just talks to Rust over the Tauri bridge now.

### running it
You need Rust, Node and pnpm, plus the usual Tauri Linux deps (webkit2gtk 4.1, librsvg, libappindicator).
```
pnpm install
pnpm fetch-sidecars
pnpm dev
```
`pnpm fetch-sidecars` grabs the aria2c and 7z binaries the app shells out to. `pnpm build` produces a packaged app.

### local Slipgate resolver
Slipgate-dependent sources can run locally without changing the app installer size. Install Docker Desktop or Docker Engine with Compose, then open Settings, Sources and choose **Install with Docker**. Union.Manifold builds Slipgate from its pinned public release commit, pulls the pinned FlareSolverr image, binds the resolver to loopback with a generated key and manages start, stop, update and removal. A remote Slipgate URL remains supported.

### automatic mod deployment
Nexus, Workshop and Thunderstore installs share a per-mod deployment planner. It recognizes game-relative archive trees, BepInEx, Mod Engine 3, Lenny's Mod Loader, MelonLoader, Bethesda Data folders, Unreal Engine Paks, structured Mods folders, REFramework autorun scripts and Fluffy packages. The Mods page reports compatible loaders from official Steam title IDs and installed game files: Mod Engine 3 is limited to its five supported FromSoftware titles, Lenny's Mod Loader to Grand Theft Auto V Legacy and Red Dead Redemption 2, MelonLoader to detected Windows Unity games, and Fluffy to known titles or RE Engine/MT Framework layouts.

Mod Engine 3 installs are isolated under `.union-manifold-me3`, generate `.union-manifold.me3`, and launch through the official `me3` executable when the game is started from Manifold. Install Mod Engine 3 from its official release and keep `me3` on `PATH`. Lenny packages preserve their `install.xml` folder under `lml`; manifest-backed MelonLoader packages retain their folder under `Mods`; Fluffy metadata stays out of the game directory. Each mod shows its inferred destination and confidence. Unknown layouts use the game root and are marked **check target**; the folder control remains available as a game-wide manual override. Interactive FOMOD archives are rejected instead of deploying every optional file.

### local achievements
The Achievements page records progress reported by local Steam-compatible
achievement stores while a game runs. It recognizes common Goldberg/GSE,
CODEX, SmartSteamEmu, CreamAPI and INI/JSON layouts, keeps unlock history in
Manifold's application data and displays a Steam-style popup plus an optional
desktop-notification fallback.

This is local tracking, not Steam account synchronization: a launcher cannot
grant an achievement on your Steam profile without the game using Steamworks
and Steam accepting it. Launch the title through Steam when you want Steam's
genuine overlay and account unlock. Manifold's transparent popup works in
windowed and borderless modes and on most desktop environments, but no normal
desktop window is guaranteed above every exclusive-fullscreen game or Wayland
compositor.

### install / update on linux
```
curl -fsSL https://raw.githubusercontent.com/fyiel/Union.Manifold/main/install.sh | bash
```
Picks the right artifact for your distro (pacman package on Arch, deb on Debian/Ubuntu, AppImage anywhere else). Run it again to update. Prefer manual? Everything's on [releases](https://github.com/fyiel/Union.Manifold/releases).

### credit
Built on [UnionCrax.Direct](https://github.com/UnionCrax-Team/UnionCrax.Direct) v2.7.3. Huge thanks to the original team, none of this exists without their work.

