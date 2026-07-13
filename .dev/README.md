# .dev — Union.Manifold test suite

All test code authored for this repo lives here. Nothing in `.dev/` ships with the app.

## Layout

```
.dev/
  rust/       backend test bodies, mounted into the crate via #[cfg(test)] #[path] hooks
  renderer/   vitest + testing-library suite for the React renderer
```

## Running

Backend (includes the pre-existing in-crate tests plus everything in `.dev/rust/`):

```
cd src-tauri && cargo test
```

Live network tests (hit steampowered.com / protondb.com / third-party hosts; never run in CI):

```
cd src-tauri && cargo test -- --ignored
```

Renderer:

```
pnpm test:renderer
```

## Why the Rust tests need `#[path]` hooks

Every module in `src-tauri/src/lib.rs` is private (`mod x;`), so an external
integration test (`src-tauri/tests/` or a file compiled from `.dev/`) cannot
reach any of the code under test. Almost all of the interesting surface
(`strip_wrapper_dir`, `bepinex_root`, `apply_bepinex_layout`, `game_layout`,
`relativize_target`, `deploy_to`, `finalize_pool`, `prune_dead_downloads`,
`remove_dir_unless_installed`, cache internals, …) is private or `pub(crate)`.

Instead of widening visibility, each tested module carries a three-line hook:

```
#[cfg(test)]
#[path = "../../.dev/rust/<file>.rs"]
mod dev_<name>_tests;
```

The test bodies stay in `.dev/rust/`; the hook compiles them in-crate (test
builds only) with `use super::*;` access to private items.

Hooked modules:

| source module | test file |
| --- | --- |
| `src/mods/mod.rs` | `rust/mods_layout_tests.rs` |
| `src/sources/cache.rs` | `rust/cache_tests.rs` |
| `src/http.rs` | `rust/http_tests.rs` |
| `src/sources/hosts/mod.rs` | `rust/hosts_tests.rs` |
| `src/sources/filters.rs` | `rust/filters_tests.rs` |
| `src/sources/schema.rs` | `rust/schema_tests.rs` |
| `src/library.rs` | `rust/library_tests.rs` |
| `src/downloads/mod.rs` | `rust/downloads_tests.rs` |
| `src/settings.rs` | `rust/settings_tests.rs` |
| `src/slipgate.rs` | `rust/slipgate_tests.rs` |
| `src/sources/parse.rs` | `rust/parse_tests.rs` |
| `src/sources/metacache.rs` | `rust/metacache_tests.rs` |
| `src/sources/mod.rs` | `rust/live_tests.rs` (`#[ignore]`, network) |

## Renderer suite

Config: `renderer/vitest.config.ts` (jsdom, `@` alias onto `renderer/src`,
Tauri API modules mocked in `renderer/setup.ts`). The Tauri bridge is mocked at
the `window.uc*` seam per test, so no backend is needed.

- `sources-maps-sync.test.ts` — parses `src-tauri/src/sources/mod.rs` and
  asserts `SOURCE_PRIORITY` / `SOURCE_NAMES` / `SOURCE_ABBR` / `SOURCE_DIRECT`
  match the backend `SOURCES` table exactly (both directions).
- `sources-logic.test.ts` — host friendliness order (GoFile last resort),
  primary-download picking, download fallback chain, multi-part downloads,
  source ordering, unified→Game mapping, remembered-game cache.
- `utils.test.ts` — formatting, search suggestions, media/image proxying,
  executable filtering and admin-exe matching for launch.
- `downloads.test.ts` — filename inference, ucfiles URL/id handling, host
  selection.
- `game-mods-search.test.tsx` — mounts the real `GameModsPage` and verifies
  the Nexus tab trims search whitespace (regression check for the suspected
  Windows whitespace bug — not reproducible; trim happens on Enter and again
  in the backend).

## Conventions

- No comments in test sources (repo rule); test names carry the meaning.
- Filesystem behavior uses real temp dirs (`tempfile`), never mocks.
- HTTP behavior uses throwaway local `TcpListener` servers.
- Anything touching a live third-party site is `#[ignore]`d.
