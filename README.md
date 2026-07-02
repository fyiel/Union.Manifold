# Union.Manifold

This is my fork of UnionCrax.Direct. I wanted one launcher that pulled from more than one source and looked the way I like, so I rebuilt the front end and wired up a multi source backend behind it.

What changed from the original:
- it now reads from several sources at once and dedupes them into one library
- the whole UI is redesigned, monochrome and minimal
- the library page got a proper card menu, launch options and Linux Proton config
- browse, search and filters all run through one query layer

The desktop shell is now Tauri and Rust instead of Electron, so the whole backend is one lean Rust crate under `src-tauri`. The React front end is the same, it just talks to Rust over the Tauri bridge now.

### running it
You need Rust, Node and pnpm, plus the usual Tauri Linux deps (webkit2gtk 4.1, librsvg, libappindicator).
```
pnpm install
pnpm fetch-sidecars
pnpm dev
```
`pnpm fetch-sidecars` grabs the aria2c and 7z binaries the app shells out to. `pnpm build` produces a packaged app.

### credit
Built on [UnionCrax.Direct](https://github.com/UnionCrax-Team/UnionCrax.Direct) v2.7.3. Huge thanks to the original team, none of this exists without their work.

v1.0.0b
