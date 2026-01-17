# UnionCrax.Direct

Standalone Electron app for the UnionCrax launcher experience with direct downloads.

## Prerequisites
- Node.js 20+
- pnpm 8+

## Setup
- `pnpm install`
- `pnpm run setup` (downloads Electron)

## Dev mode
- `pnpm dev`
  - Renderer on http://localhost:5173

## Build
- `pnpm run build`
- `pnpm run pack`
  - Outputs in `unioncrax.Direct/dist-packaged/`

## Environment
- `VITE_UC_BASE_URL` (optional): override API base (default `https://union-crax.xyz`)

## Notes
- Downloads default to `C:\UnionCrax.Direct` on Windows (falls back to Documents if needed). You can change the location in Settings.
- The app uses UnionCrax endpoints and data formats, matching the web experience.
