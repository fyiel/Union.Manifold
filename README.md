# UnionCrax.Direct
<img width="960" height="540" alt="main" src="https://github.com/user-attachments/assets/e6e7050a-3d7a-4f3c-9fb2-e466fd5f017b" />


A fast, standalone Electron desktop application for managing and launching games from the UnionCrax platform. Direct downloads with minimal overhead and full control over your gaming library.

![Version](https://img.shields.io/github/v/release/Union-Crax/UnionCrax.Direct?include_prereleases&style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-0078d4?style=flat-square)

## Features

- **Fast Downloads**: Direct game downloads with pause/resume support
- **Game Library**: Browse and manage your installed games
- **Updates**: game updates download system
- **Settings**: Customize download location and launch executables
- **Search**: Quick game search with intelligent filtering
- **History**: Track your recently played games
- **Sync**: In sync with the UC Website, browse your liked/wishlisted games and recently viewed directly inside the launcher.

## System Requirements
Windows:
- **OS**: Windows 10 or later (64-bit)
- **RAM**: 2GB minimum (4GB recommended)
- **Storage**: 500MB for standalone app.
Linux:
yes 👍
## Installation

### Windows Installation Options

#### Option 1: NSIS Installer (Recommended)
1. Go to [Releases](https://github.com/Union-Crax/UnionCrax.Direct/releases)
2. Download `UnionCrax.Direct.Setup.X.X.X.exe`
3. Run the installer and choose installation directory
4. Create desktop/Start Menu shortcuts
5. Launch UnionCrax.Direct from Start Menu or desktop

#### Option 2: Portable Executable
1. Go to [Releases](https://github.com/Union-Crax/UnionCrax.Direct/releases)
2. Download `UnionCrax.Direct.X.X.X.exe`
3. Run directly - no installation needed
4. Settings and data are stored alongside the executable

#### Option 3: ZIP Archive
1. Go to [Releases](https://github.com/Union-Crax/UnionCrax.Direct/releases)
2. Download `UnionCrax.Direct-X.X.X-win.zip`
3. Extract to your preferred location
4. Run `UnionCrax.Direct.exe` from the extracted folder

### Linux Installation

Run the one-line installer (downloads the latest AppImage and creates a desktop entry):

```bash
curl -sSL https://union-crax.xyz/linux-installer.sh | bash
```

This installs the AppImage to `~/.local/share/UnionCrax.Direct` and adds a launcher in your applications menu.

### Downloads fail?
- Check [UnionCrax Status](https://status.union-crax.xyz)

### Having issues?
- [Report an Issue](https://github.com/Union-Crax/UnionCrax.Direct/issues)
- [Post on our socials](https://union-crax.xyz/discord)

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

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.


## Acknowledgments

Built with:
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Radix UI](https://www.radix-ui.com/)
- [Lucide Icons](https://lucide.dev/)

---
<img width="1916" height="1079" alt="image" src="https://github.com/user-attachments/assets/d9ce9369-6971-4225-b194-3018f901c1c1" />
<img width="1916" height="1079" alt="image" src="https://github.com/user-attachments/assets/3d64ae31-4193-4326-ab06-e1dd1ec6f4c7" />
<img width="1060" height="722" alt="image" src="https://github.com/user-attachments/assets/88ecbce7-1a03-453f-a81b-9c13c67eed6b" />
<img width="1054" height="613" alt="image" src="https://github.com/user-attachments/assets/6611ca14-2b0f-4429-8a35-e8cfd4f518be" />


**Made with ❤️ by the [UnionCrax](https://union-crax.xyz) Team**
