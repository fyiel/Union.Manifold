# Contributing to UnionCrax.Direct

Thank you for your interest in contributing! This guide will help you set up the development environment and understand how to contribute.

## Prerequisites

- Node.js 20 or higher
- pnpm 8 or higher
- Windows 10+ (Linux support later on)

## Setup

### 1. Clone the repository
```bash
git clone https://github.com/Union-Crax/UnionCrax.Direct.git
cd UnionCrax.Direct
```

### 2. Install dependencies
```bash
pnpm install
pnpm run setup  # downloads electron
```

## Development

### Start development server
```bash
pnpm dev
```

This starts:
- React renderer on `http://localhost:5173`
- Electron app connected to the dev server

### Build the application
```bash
pnpm run build
```

### Package the installer
```bash
pnpm run pack
```

Output: `dist-packaged/UnionCrax.Direct Setup X.X.X.exe`

## Project Structure

```
UnionCrax.Direct/
├── electron/           # Main process (Electron)
│   ├── main.cjs       # App entry point, window management, downloads
│   └── preload.cjs    # Preload script for IPC
├── renderer/          # Renderer process (React + Vite)
│   ├── src/
│   │   ├── app/       # Page components and routes
│   │   ├── components/# Shared UI components
│   │   ├── lib/       # Utilities (API, downloads, storage)
│   │   ├── context/   # React context providers
│   │   ├── hooks/     # Custom React hooks
│   │   └── main.tsx   # React entry point
│   └── vite.config.ts # Vite configuration
├── scripts/           # Build and dev scripts
├── .github/workflows/ # GitHub Actions CI/CD
└── assets/           # App icon and resources
```

## Code Style

- **TypeScript**: Strongly typed, no `any` unless necessary
- **React**: Functional components with hooks
- **Styling**: Tailwind CSS with @layer utilities
- **Components**: Follow existing patterns in `renderer/src/components/`

## Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes with meaningful commits
3. Push to your fork and create a Pull Request

### Commit Message Format
```
type: description

- Bullet points for changes
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`

## Releases

Releases are automated via GitHub Actions. To create a new release:

1. Update `version` in `package.json`
2. Commit: `git commit -am "Release vX.X.X - Description"`
3. Create tag: `git tag vX.X.X`
4. Push: `git push origin main && git push origin vX.X.X`

GitHub Actions will:
- Build the Windows installer
- Create a GitHub Release
- Upload artifacts

The app auto-updates users to new versions via the UpdateNotification component.

## Architecture

### Main Process (Electron)
- Window management
- File system operations (downloads, settings)
- IPC communication with renderer
- Auto-update checks
- Game execution via 7-Zip extraction and launch

### Renderer Process (React)
- UI components and pages
- Game library management
- Download management
- Settings and preferences
- API communication with UnionCrax backend

### Communication
- IPC channels for main/renderer process communication
- REST API calls to `https://union-crax.xyz`
- Auth handled via cookies (credentials: 'include')

## API Integration

The app communicates with UnionCrax backend API:
- Games list: `GET /api/games`
- Download token: `POST /api/downloads/{appid}/token`
- Download links: `GET /api/downloads/{appid}?fetchLinks=true`

Base URL: `https://union-crax.xyz` (configurable via env)

## Troubleshooting

### Dev server not connecting
```bash
# Kill port 5173 if something else is using it
# Then restart
pnpm dev
```

### Build fails
```bash
rm -r node_modules pnpm-lock.yaml
pnpm install
pnpm run pack
```

### Electron won't start
```bash
pnpm run setup  # Reinstall Electron
pnpm dev
```

## Need Help?

- Check existing issues and PRs
- Open an issue with:
  - Steps to reproduce
  - Expected vs actual behavior
  - OS and version info
  - Node/pnpm versions

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
