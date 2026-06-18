# UnionCrax.Direct
<img width="960" height="540" alt="main" src="https://github.com/user-attachments/assets/e6e7050a-3d7a-4f3c-9fb2-e466fd5f017b" />


A fast, standalone Electron desktop application for managing and launching games from the UnionCrax platform. Direct downloads with minimal overhead and full control over your gaming library.

![Version](https://img.shields.io/github/v/release/UnionCrax-Team/UnionCrax.Direct?include_prereleases&style=flat-square)
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

### Windows

* **OS**: Windows 10 or later (64-bit)
* **RAM**: 2GB minimum (4GB recommended)
* **Storage**: 500MB for standalone app

---

### Linux

* **Support**: Yes 👍

---

## Installation

### Windows Installation Options

#### Option 1: NSIS Installer (Recommended)
1. Go to [Releases](https://github.com/UnionCrax-Team/UnionCrax.Direct/releases)
2. Download `UnionCrax.Direct.Setup.X.X.X.exe`
3. Run the installer and choose installation directory
4. Create desktop/Start Menu shortcuts
5. Launch UnionCrax.Direct from Start Menu or desktop

#### Option 2: ZIP Archive
1. Go to [Releases](https://github.com/UnionCrax-Team/UnionCrax.Direct/releases)
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
- [Report an Issue](https://github.com/UnionCrax-Team/UnionCrax.Direct/issues)
- [Post on our socials](https://union-crax.xyz/discord)

## Development

Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and development guidelines.

### Quick Start (Developers)

```bash
# Clone repository
git clone https://github.com/UnionCrax-Team/UnionCrax.Direct.git
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
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/6899606d-8632-404e-bfac-106c3a67b947" />
<img width="1920" height="1080" alt="Screenshot (77)" src="https://github.com/user-attachments/assets/0d01a1cf-012f-4cf3-b25b-7a136678df0f" />
<img width="1920" height="1080" alt="Screenshot (78)" src="https://github.com/user-attachments/assets/ec9f0a64-7add-43d9-b74c-aeb560500a95" />
<img width="1920" height="1080" alt="Screenshot (84)" src="https://github.com/user-attachments/assets/a268bbb5-42d9-4f1a-98c9-8d089c1cbdd7" />
<img width="1920" height="1080" alt="Screenshot (85)" src="https://github.com/user-attachments/assets/fee9d423-5c32-4552-93b2-3a0364a4bf77" />
<img width="1920" height="1080" alt="Screenshot (80)" src="https://github.com/user-attachments/assets/e839ad2e-de57-43a7-893c-6f8769f11b03" />

**Made with ❤️ by the [UnionCrax](https://union-crax.xyz) Team**
