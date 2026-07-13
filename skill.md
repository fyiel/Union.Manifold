# Union.Manifold — working notes for an LLM/agent

Everything a fresh agent needs before touching this repo. Read this first.

## What this is
- **Union.Manifold**: a multi-source game launcher. MIT-licensed fork of
  UnionCrax.Direct (v2.7.3). Tauri 2 desktop shell with a **Rust backend**
  (`src-tauri/`) and a **React 19 + Vite renderer** (`renderer/`). Ships as
  prebuilt binaries via GitHub Releases + `install.sh` + an Arch pacman package,
  and **self-updates** from GitHub Releases.
- It aggregates several third-party game sites into one library: browse / search
  / de-dupe, then resolve download links and download + extract **in-app**.
- Identifier: `fyi.pumg.unionmanifold`. Repo: `github.com/fyiel/Union.Manifold`.

## Layout
```
src-tauri/src/
  lib.rs            Tauri setup + ALL command registration (invoke_handler)
  sources/          the source subsystem (see below)
    mod.rs          SOURCES list + adapter_* dispatch + Registry + query cmds
    adapters/<id>.rs one file per source; adapters/mod.rs declares them
    hosts/          file-host resolvers + hosts/mod.rs dispatch + gate.rs
    schema.rs       SourceGame / UnifiedGame / DownloadOption + dedupe helpers
    filters.rs      finalize_pool: merge->filter->sort->facets (central layer)
    cache.rs        Cached<T> (single) + KeyedCache<T> (keyed), TTL'd
    steam.rs protondb.rs metacache.rs parse.rs
  downloads/        aria2c RPC engine (mod.rs) + aria2.rs; downloads-state.json
  install.rs        archive extraction pipeline (7z sidecar)
  launch/           game launch; linux.rs = Proton/Wine/umu
  mods/             nexus / thunderstore / workshop / steamcmd
  library.rs        installed/installing manifests, delete, scan roots
  slipgate.rs       self-hosted captcha/host resolver client
  updater.rs        in-app updater (Tauri + custom pacman path)
  http.rs           shared reqwest client: FetchOpts, fetch, map_limit,
                    get_text/get_json, decode_entities, strip_tags
  paths.rs state.rs bins.rs assets.rs import.rs settings.rs
renderer/src/
  lib/bridge.ts     installs window.uc* over Tauri invoke/listen (the API seam)
  lib/sources.ts    SOURCE_PRIORITY / _NAMES / _ABBR / _DIRECT maps (by source id)
  lib/catalog.ts downloads.ts utils.ts ; app/pages/ ; context/ ; hooks/
scripts/            fetch-sidecars.mjs, build-arch-pkg.sh
.github/workflows/  ci.yml (checks), build.yml (release)
```

## Build / dev / verify
```
pnpm install && pnpm fetch-sidecars   # aria2c + 7z into src-tauri/binaries (gitignored, SHA-pinned)
pnpm dev                              # tauri dev (vite @5173 + window)
pnpm build                            # packaged app
pnpm typecheck                        # tsc --noEmit on renderer  (CI gate)
cd src-tauri && cargo check --locked  # backend compile           (CI gate)
cd src-tauri && cargo test            # backend unit tests
```
Always run `cargo test` (backend) + `pnpm typecheck` (renderer) before pushing.

## COMMIT / VERSION / RELEASE RULES (do not deviate)
- **Version is single-source and CI-enforced.** These MUST all equal each other:
  `package.json` "version", `src-tauri/tauri.conf.json` "version",
  `src-tauri/Cargo.toml` [package] version — and `Cargo.lock`'s union-manifold
  entry. After any bump run `cargo check` (no `--locked`) to refresh `Cargo.lock`,
  or `cargo check --locked` (CI) fails. ci.yml `verify` job asserts the three agree.
- **Commit message style:** `(type): imperative lowercase subject`. Types in use:
  `feat`, `fix`, `chore`, `docs`. The change and the version bump are **two
  separate commits**, bump last:
  `(feat): add X`  then  `(chore): version bump to A.B.C`.
- **Bump + CHANGELOG on every change.** New/removed source = **minor**
  (e.g. 2.17.0 added RexaGames, 2.20.0 added AstralGames, 2.21.0 removed it).
  Bug fixes = **patch**.
- **CHANGELOG.md**: newest first, `## X.Y.Z` then `### Added/Fixed/Removed/
  Changed`; lowercase, present-tense, explain the *why*; append "verified
  end-to-end" only when you actually exercised it. Don't rewrite already-released
  entries except genuine doc corrections.
- **Pushing to `main` cuts a release.** `build.yml` triggers on push to `main`
  (and `v*` tags, and manual): builds Linux (AppImage/deb/pacman) + Windows
  (NSIS) + macOS and uploads to a **draft** GitHub release (publish manually).
  → **Confirm with the user before pushing to main.** Committing locally is safe
  and reversible; pushing is the consequential step.
- **`[skip ci]`** in the commit subject skips ALL Actions for that push — use it
  for docs-only / no-build pushes so you don't spawn a build run.
- **Archival pattern for removed code ("legacify"):** create a *local* branch
  `legacy/<thing>` at the pre-removal HEAD (do NOT push it), then remove. GitHub
  has no private branches; a local (or separate private-repo) branch is the only
  "private" archive. Example: `legacy/astralgames` holds the removed AstralGames
  adapter + Mocha resolver.

## Code conventions
- **Rust:** prefer `std::sync::LazyLock` over `once_cell::Lazy`/`OnceLock` when
  the initializer is known at declaration (enforced project rule). Tauri commands
  stay thin, return `Result`, never `unwrap` on user input. Reuse `http.rs`
  (shared client has a browser UA, retries/backoff, `manual_redirect`,
  `map_limit` for bounded concurrency). Don't reach for `once_cell` in new code.
- **TS:** strongly typed, avoid `any`; functional components; Tailwind 4.
- **Never run formatters** as part of an edit; don't reformat unrelated code.
- **Never write comments.** No `//`, `/* */`, `///`/`//!` doc comments, JSDoc, or
  `#` notes — in any source (Rust, TS/TSX, JS, shell, TOML). The codebase is
  intentionally comment-free; code self-documents via clear names and structure.
  The only comment-shaped things that stay are load-bearing directives, NOT prose:
  the `/// <reference ... />` in `vite-env.d.ts` and shell shebangs (`#!`).
- **Tests:** the harness Tester agent authors tests — don't hand-write them.
  Backend tests are in-crate `#[cfg(test)]`; **live/network** tests are
  `#[ignore]` in `hosts/livetest.rs` and `hosts/installtest.rs` (run with
  `-- --ignored`). The renderer has no test runner — verify via `pnpm typecheck`.

## Sources subsystem — the most common task
A "source" is a game site. To **add** one (`<id>`):
1. `src-tauri/src/sources/adapters/<id>.rs` implementing pub fns:
   `capabilities() -> Capabilities`, `query(&QueryParams) -> Option<Vec<SourceGame>>`,
   `search(q, limit) -> Vec<SourceGame>`, `get_detail(slug) -> Option<SourceGame>`,
   optional `list_tags()`, optional `resolve_download(&DownloadOption)`.
2. Declare it in `adapters/mod.rs` (`pub mod <id>;`).
3. Register in `sources/mod.rs`: add to `SOURCES` (id/name/homepage) **and** to
   the `capabilities_for`, `adapter_query`, `adapter_search`, `adapter_detail`,
   (and `adapter_tags` if it has tags) match blocks. Custom download resolution
   → add an arm to `adapter_resolve`; otherwise it falls through to
   `hosts::resolve_url`.
4. Frontend `renderer/src/lib/sources.ts`: add the id to `SOURCE_PRIORITY`,
   `SOURCE_NAMES`, `SOURCE_ABBR`, `SOURCE_DIRECT`. (Backend `sources_list` drives
   the Settings → Download Sources UI; a source is enabled unless it's in the
   `disabledSources` setting.)
5. `list_tags`/adapter_tags is optional — not every source is in adapter_tags.

To **remove**: reverse all of the above (delete the adapter file + any host
module added only for it), and also scrub `hosts/livetest.rs` +
`hosts/installtest.rs` references or the test build breaks.

**How the query layer works:** adapters return lightweight `SourceGame` stubs
(title, `steam_app_id`, `genres`, size where cheap). `filters.rs::finalize_pool`
merges them into `UnifiedGame` (union-find dedupe by steam appid / normalized
title) and applies text/tag/year/size filters + sort + facets centrally — so
adapters usually don't filter, they just populate fields. Results are cached
(`cache.rs`, ~90s search / ~600s catalog).

## Download hosts & resolution
- Each `DownloadOption.url` is routed by `hosts/mod.rs`:
  `detect_host_type` / `is_resolvable` / `resolve_url`. Native resolvers exist for
  buzzheavier, gofile, pixeldrain, datanodes, fuckingfast, mediafire, rootz,
  datavaults, fileditch, filekeeper.
- **Link containers**: some sites hide links behind a container service with a
  public JSON API — ZeiLink (`zeilink.net/api/public/container/<slug>`, used by
  RexaGames), Pearcrypt (`pearcrypt.lol/api/container/<id>/mirrors`, was used by
  AstralGames). The adapter expands the container into one `DownloadOption` per
  live mirror; each mirror then resolves through the shared host dispatch.
- Resolved links can be **`ephemeral`** (signed/expiring, e.g. Mocha/DataVaults)
  → re-resolve on retry.

## Capabilities / operational knowledge
- **Slipgate** (`slipgate.rs` + `hosts/gate.rs`): an OPTIONAL user-configured
  **self-hosted resolver** for captcha-/browser-gated hosts. `gate.rs` is the
  taxonomy of gated hosts (fileq.net, mocha.my, zerofs.link, …). A gated host is
  only resolvable in-app when `slipgate::cfg().is_some()` (Slipgate configured)
  or a native resolver exists; otherwise it's browser-only (`open_url`).
  Configure in Settings → Mods (slipgate URL + key).
- **Sidecars**: bundled `aria2c` (download engine, RPC) + `7-Zip` (extraction),
  fetched by `pnpm fetch-sidecars` into `src-tauri/binaries/` (gitignored, SHA-256
  pinned in `scripts/fetch-sidecars.mjs`).
- **Mods**: NexusMods (API key; an OPT-IN website-session-cookie mode that the app
  itself warns breaks NexusMods ToS), Steam Workshop (anonymous SteamCMD, bootstrapped
  into `data_dir/steamcmd`), Thunderstore. Stored under `data_dir/mods/<appid>/`.
  The deployment planner recognizes REFramework Lua autorun scripts, preserves
  Fluffy-style `reframework`/`natives`/`pak_mods` trees and retains
  manifest-backed MelonLoader package folders under `Mods`.
- **In-app updater** (`updater.rs`): Tauri updater plugin for most targets, but the
  **Arch/pacman path is custom** (`is_pacman_install()` = no `$APPIMAGE` +
  `/usr/bin/pacman`): it downloads the versioned `.pkg.tar.zst` from the release
  and runs `pkexec pacman -U --noconfirm`. This **needs a running polkit
  authentication agent**; stdin is closed so with no agent it fails fast (with a
  manual `sudo pacman -U <file>` message) instead of hanging, behind a timeout.
- **Privileged package-manager ops (Arch)**: system install/update needs root via
  a polkit agent (pkexec) or `sudo pacman -U`. On minimal WMs (e.g. **Hyprland**)
  no polkit agent auto-starts — add
  `exec-once = /usr/lib/polkit-gnome/polkit-gnome-authentication-agent-1` (or
  `hyprpolkitagent`/`lxqt-policykit`). `install.sh` uses `sudo` in a terminal and
  works without an agent. Never hardcode a sudo password anywhere.
- **Paths**: data dir `~/.local/share/fyi.pumg.unionmanifold/` — `installing/`
  (install root; per-game `installed.json` manifest keyed by string `appid`),
  `downloads-state.json` (persisted queue; `downloads_state_load` prunes dead rows
  whose install folder is gone), `mods/`, `steamcmd/`, `metadata/`, `uc-asset/`.
  Config dir `~/.config/fyi.pumg.unionmanifold/settings.json`.
- **Library/appid model**: games are keyed by a string `appid` (`steam-<id>` when
  a Steam appid is known, else a dedupe key). `installed_delete(appid)` removes by
  appid; `installing_delete` = `remove_dir_unless_installed` (never touches a dir
  whose manifest status is `installed`). The frontend must delete with the SAME
  appid the manifest stores.

## Reverse-engineering a live source (before writing an adapter)
- Use `read` for static HTML/JSON/sitemaps; use the **browser** tool to capture
  network (XHR / RSC flight payloads / server actions) for JS-driven sites.
- Sites vary: WordPress sitemaps (SteamRIP), Invision forums (RexaGames),
  Laravel Livewire (AnkerGames), Next.js App Router (AstralGames). Next.js
  **server-action IDs are build-versioned** — discover them at runtime, never
  hardcode. Verify a resolver end-to-end with a `Range: bytes=0-1` probe (expect
  a non-HTML body + `content-disposition`).

## GitHub / release ops
- `gh` is the tool (authed with repo/workflow/delete_repo scopes).
- Draft releases come from `build.yml`; publish manually. Delete a release **and
  its tag** with `gh release delete <tag> --yes --cleanup-tag` (draft releases
  have no tag → cleanup errors 422, but the release still deletes).
- Delete workflow runs with `gh run delete <id>`. Go gentle (batch/sleep) to
  avoid secondary rate limits.
- **Commits pushed to a public repo persist by SHA** (and across fork networks)
  even after you delete the branch/tag — deletion is NOT a privacy mechanism.
  Keep anything sensitive local or in a private repo.
