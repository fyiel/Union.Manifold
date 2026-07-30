# Contributing to Union.Manifold

Thanks for your interest in contributing! This guide covers setting up the development environment and how the project fits together.

## Prerequisites

- Bun 1.3.14 (pinned via `packageManager` in `package.json`)
- Rust (stable toolchain)
- Tauri Linux deps on Linux: `webkit2gtk-4.1`, `librsvg`, `libappindicator`

## Setup

### 1. Clone the repository
```bash
git clone https://github.com/fyiel/Union.Manifold.git
cd Union.Manifold
```

### 2. Install dependencies and sidecars
```bash
bun install
bun run fetch-sidecars   # downloads the aria2c and 7z binaries the app shells out to
```

Sidecar downloads are pinned to SHA-256 checksums. If you override `ARIA2_VERSION` or `SEVENZIP_VERSION`, set `SIDECAR_ALLOW_UNVERIFIED=1` or add new pins in `renderer/scripts/fetch-sidecars.mjs`.

## Development

### Start the app in dev mode
```bash
bun run dev
```

This starts the Vite renderer on `http://localhost:5173` and a Tauri window connected to it.

### Build the application
```bash
bun run build
```

### Other useful commands
```bash
bun run typecheck        # TypeScript check for the renderer
cargo check --locked      # from src-tauri/, checks the Rust backend
cargo test                # from src-tauri/, runs backend unit tests
```

## Project Structure

```
Union.Manifold/
├── src-tauri/          # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── sources/    # Game sources, dedupe, metadata, filters
│   │   ├── downloads/  # Download engine + aria2 RPC wrapper
│   │   ├── launch/     # Game launching, Linux Proton support
│   │   ├── install.rs  # Archive extraction pipeline (7z sidecar)
│   │   └── lib.rs      # Tauri setup, command registration
│   ├── binaries/       # Fetched sidecars (gitignored)
│   └── tauri.conf.json # Tauri configuration
├── renderer/           # React 19 + Vite frontend
│   └── src/
│       ├── app/        # Page components and routes
│       ├── components/ # Shared UI components
│       ├── lib/        # Bridge to Rust, query layer, utilities
│       ├── context/    # React context providers
│       └── hooks/      # Custom React hooks
├── scripts/            # fetch-sidecars, arch package build
└── .github/workflows/  # CI (ci.yml) and release (build.yml)
```

## Code Style

- **TypeScript**: strongly typed, no `any` unless necessary
- **React**: functional components with hooks
- **Rust**: keep commands thin, return `Result`, no `unwrap` on user input
- **Styling**: Tailwind CSS 4

## Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes with meaningful commits
3. Push to your fork and create a Pull Request

CI runs a 3-OS build check (renderer build + `cargo check --locked`), the renderer typecheck, and asserts that `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` agree on the version.

## Releases

Releases are automated via GitHub Actions (`build.yml`):

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` (all three must match)
2. Commit and push to `main`, or tag `vX.X.X`, or trigger the workflow manually

The workflow builds Linux (AppImage, deb, pacman), Windows (NSIS), and macOS bundles, and uploads them to a draft GitHub release.

## Need Help?

- Check existing issues and PRs
- Open an issue with:
  - Steps to reproduce
  - Expected vs actual behavior
  - OS and version info

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
