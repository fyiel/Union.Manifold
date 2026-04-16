# UC.Direct Native Overlay System

Professional in-game overlay (like Steam/Discord) that injects into game processes to render the overlay UI directly in the game window - works in exclusive fullscreen, borderless, and windowed modes.

## Architecture

```
┌─────────────────────┐     Shared Memory       ┌──────────────────────┐
│  Electron Main      │ ──────────────────────> │  Injected DLL        │
│  (offscreen render) │     (BGRA pixels)       │  (game process)      │
│                     │                         │                      │
│  Overlay React UI   │     Named Pipe          │  D3D9/D3D11/GL Hook  │
│  → BrowserWindow    │ <─────────────────────> │  → Texture Upload    │
│    (offscreen:true) │     (input events)      │  → Fullscreen Quad   │
└─────────────────────┘                         └──────────────────────┘
```

1. **Electron** renders the overlay UI in an offscreen BrowserWindow
2. The `paint` event captures pixels and writes BGRA data to shared memory
3. A **Node native addon** handles DLL injection, shared memory, and pipe I/O
4. The **injected DLL** hooks graphics APIs (D3D9/D3D11/OpenGL) to composite the overlay
5. Input in the overlay area is captured via WndProc subclassing and forwarded back to Electron

## Components

| Component | Path | Language |
|-----------|------|----------|
| Overlay DLL | `overlay-dll/` | C++17 |
| Native Addon | `electron/native/` | C++ (N-API) |
| Overlay UI | `renderer/src/components/InGameOverlay.tsx` | React/TypeScript |
| Overlay Hook | `renderer/src/hooks/use-overlay.ts` | TypeScript |
| Main Process | `electron/main.cjs` | JavaScript |
| IPC Bridge | `electron/preload.cjs` | JavaScript |

## Prerequisites

- **Visual Studio 2022** (or Build Tools) with C++ Desktop workload
- **CMake** 3.20+
- **Node.js** 18+ with node-gyp

## Quick Install (First Time Setup)

If you don't have Visual Studio Build Tools installed yet, run this command first:

```powershell
# Install VS 2022 Build Tools with C++ workload (required for compiling DLL)
winget install Microsoft.VisualStudio.2022.BuildTools --silent --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
```

**This will take 5-10 minutes.** After installation completes, **restart PowerShell** and verify:

```powershell
# Should show MSBuild path if installed correctly
Get-Command msbuild -ErrorAction SilentlyContinue
```

Don't have `winget`? Download the installer manually:
- https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
- Select "Desktop development with C++" workload during installation

## Build Steps

### 1. Setup MinHook (one time)

```powershell
cd overlay-dll
.\setup-minhook.ps1
```

### 2. Build the Overlay DLL

```powershell
cd overlay-dll
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

If you previously configured with `NMake Makefiles`, remove the old cache first:

```powershell
Remove-Item -Recurse -Force .\build
```

The DLL is output to `build/Release/uc-overlay-x64.dll` when using the Visual Studio generator.

### 3. Build the Native Addon

```powershell
cd electron/native
node-gyp rebuild
```

Or from root:
```powershell
pnpm rebuild-native
```

### 4. Run the App

```powershell
pnpm dev
```

## Supported Graphics APIs

| API | Hook Target | Method |
|-----|-------------|--------|
| D3D11/D3D12 (DXGI) | `IDXGISwapChain::Present` (vtable[8]) | MinHook |
| D3D9 | `IDirect3DDevice9::Present` (vtable[17]) | MinHook |
| OpenGL | `gdi32!SwapBuffers` | MinHook |

## Overlay Toggle

Default hotkey: **Ctrl+Shift+Tab** (configurable in Settings → Overlay)

When toggled:
- DLL sets WndProc to consume mouse/keyboard input
- Input events get forwarded over named pipe to Electron
- Electron dispatches to offscreen BrowserWindow
- React UI re-renders → new pixels flow to shared memory → DLL composites on next frame

## Fallback Mode

If the native addon or DLL fails to load, the overlay falls back to a transparent always-on-top BrowserWindow (works for windowed/borderless games only).

## Troubleshooting

### "could not find any instance of Visual Studio"

**Error**: `Generator Visual Studio 17 2022 could not find any instance of Visual Studio.`

**Cause**: Visual Studio Build Tools are not installed (required to compile C++ code).

**Solution**: Run the Quick Install command from the Prerequisites section above, then restart PowerShell.

### CMake not found

**Error**: `cmake : The term 'cmake' is not recognized...`

**Solution**:
1. **Via Visual Studio Installer**: Open VS Installer → Modify → Individual Components → Check "C++ CMake tools for Windows"
2. **Standalone**: Download from https://cmake.org/download/ or run `winget install Kitware.CMake`
3. **Restart PowerShell** after installation

### MSBuild not found

**Error**: `The term 'MSBuild' is not recognized...`

**Solution**: Install Visual Studio 2022 Build Tools with "Desktop development with C++" workload from https://visualstudio.microsoft.com/downloads/

### MinHook download fails

**Error**: `Failed to download MinHook...`

**Solution**: Manually download v1.3.3 from https://github.com/TsudaKageyu/minhook/archive/refs/tags/v1.3.3.zip and extract to `overlay-dll/vendor/minhook/`

### Native addon build fails

**Error**: `node-gyp rebuild` fails with Python errors

**Solution**:
```powershell
npm install --global node-gyp
npm install --global --production windows-build-tools
```

### DLL injection fails

Check Windows Defender / antivirus - DLL injection triggers many security tools. Add UC.Direct to exclusions if safe.
