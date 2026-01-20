# UnionCrax.Direct

A fast, standalone Electron desktop application for managing and launching games from the UnionCrax platform. Direct downloads with minimal overhead and full control over your gaming library.

![Version](https://img.shields.io/github/v/release/Union-Crax/UnionCrax.Direct?include_prereleases&style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square)

## Features

- **Fast Downloads**: Direct game downloads with pause/resume support
- **Game Library**: Browse and manage your installed games
- **Auto-Update**: Automatic update checks with one-click install
- **Settings**: Customize download location and launch executables
- **Search**: Quick game search with intelligent filtering
- **History**: Track your recently played games
- **Lightweight**: Minimal resource usage compared to web browser

## System Requirements

- **OS**: Windows 10 or later (64-bit)
- **RAM**: 2GB minimum (4GB recommended)
- **Storage**: 500MB for app, plus space for game downloads

## Installation

### Option 1: Download Installer (Recommended)
1. Go to [Releases](https://github.com/Union-Crax/UnionCrax.Direct/releases)
2. Download the latest `UnionCrax.Direct Setup X.X.X.exe`
3. Run the installer
4. Launch UnionCrax.Direct from Start Menu

### Option 2: Portable (No Installation)
1. Extract the downloaded ZIP
2. Run `UnionCrax.Direct.exe` directly

## Usage

### Downloading Games
1. Browse the game library
2. Click **Download**
3. Wait for download to complete
4. Extraction begins automatically

### Launching Games
1. Go to **Library**
2. Click the **Play button** on an installed game
3. Choose the game executable if prompted
4. Game launches directly

### Managing Downloads
1. Go to **Activity**
2. View active, completed, and failed downloads
3. Pause/resume/cancel downloads as needed (currenlty the host **rootz** does not support download resume)

### Settings
1. Click **Settings** (gear icon)
2. Change download location
3. View storage usage
4. Check for updates

## Updates

UnionCrax.Direct automatically checks for updates every hour. When a new version is available:
- A notification appears in the top-right corner
- Click **Download & Install** to update
- App restarts with the new version

Manual check: Settings → **Check for Updates**

## Configuration

### Custom Download Location

Use **Settings** → **Download Location** in the app to choose where games are installed.

## Troubleshooting

### App won't start
- Verify Windows 10+ (64-bit)
- Reinstall the latest version
- Check Windows Defender isn't blocking it

### Downloads fail
- Check internet connection
- Verify sufficient disk space
- Check [UnionCrax Status](https://status.union-crax.xyz)

### Game won't launch
- Ensure all files are fully extracted
- Try setting the executable manually in game details
- Check game-specific requirements

### Still having issues?
- [Report an Issue](https://github.com/Union-Crax/UnionCrax.Direct/issues)
- [Join Discord](https://union-crax.xyz/discord)

## Development

Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and development guidelines.

### Quick Start (Developers)

```bash
# Clone repository
git clone https://github.com/Union-Crax/UnionCrax.Direct.git
cd UnionCrax.Direct

# Install dependencies
pnpm install
pnpm run setup

# Start development
pnpm dev

# Build installer
pnpm run pack
```

For detailed development information, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Desktop**: Electron 33 + Node.js
- **Styling**: Tailwind CSS v4
- **Build**: electron-builder (NSIS installer for Windows)
- **Updates**: electron-updater (GitHub Releases)

### How It Works
1. **Main Process**: Electron handles file operations, downloads, and game launching
2. **Renderer Process**: React UI communicates with main process via IPC
3. **Backend**: API calls to UnionCrax for game metadata and download links
4. **Updates**: Checks GitHub Releases for new versions

## Project Structure

```
UnionCrax.Direct/
├── electron/          # Main Electron process
├── renderer/          # React UI (Vite)
│   ├── src/
│   │   ├── app/      # Pages and routes
│   │   ├── components/ # UI components
│   │   ├── lib/      # Utilities and helpers
│   │   └── context/  # React context
│   └── public/       # Static assets
├── scripts/          # Build and dev scripts
├── .github/workflows/# GitHub Actions CI/CD
└── assets/          # App icon
```

## Releases & Auto-Updates

### How Releases Work
- Tag a commit: `git tag vX.X.X`
- GitHub Actions automatically builds the installer
- Release appears on [GitHub Releases](https://github.com/Union-Crax/UnionCrax.Direct/releases)
- All users automatically see the update notification

### Version Scheme
We use [Semantic Versioning](https://semver.org/):
- `MAJOR.MINOR.PATCH` (e.g., 1.2.3)
- Major: Breaking changes
- Minor: New features (backward compatible)
- Patch: Bug fixes

## Security

For security vulnerabilities, please see [SECURITY.md](SECURITY.md).

### Security Highlights
- No hardcoded secrets or API keys
- HTTPS-only API communication
- Auto-updates verified via GitHub Releases
- No telemetry or tracking

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Code style guidelines
- Pull request process
- Reporting issues

## Support

- **GitHub Issues**: [Report bugs or suggest features](https://github.com/Union-Crax/UnionCrax.Direct/issues)
- **Discord**: [Join UnionCrax Community](https://union-crax.xyz/discord)
- **Website**: [union-crax.xyz](https://union-crax.xyz)

## Acknowledgments

Built with:
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Radix UI](https://www.radix-ui.com/)
- [Lucide Icons](https://lucide.dev/)

---

**Made with ❤️ by the [UnionCrax](https://union-crax.xyz) Team**
