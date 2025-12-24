# UnionCrax.Direct

Standalone Electron app for the UnionCrax launcher experience with direct downloads.

## Prerequisites
- Node.js 20+
- pnpm 8+

## Setup
- `pnpm -C unioncrax-direct.app install --ignore-workspace`
- `pnpm -C unioncrax-direct.app run setup` (downloads Electron)

## Dev mode
- `pnpm -C unioncrax-direct.app dev`
  - Renderer on http://localhost:5173

## Build
- `pnpm -C unioncrax-direct.app run build`
- `pnpm -C unioncrax-direct.app run pack`
  - Outputs in `unioncrax-direct.app/dist-packaged/`

## Environment
- `VITE_UC_BASE_URL` (optional): override API base (default `https://union-crax.xyz`)

## Notes
- Downloads are saved under your system downloads folder in `UnionCrax.Direct/`.
- The app uses UnionCrax endpoints and data formats, matching the web experience.
