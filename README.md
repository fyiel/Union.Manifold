# Union.Manifold

This is my fork of UnionCrax.Direct. I wanted one launcher that pulled from more than one source and looked the way I like, so I rebuilt the front end and wired up a multi source backend behind it.

What changed from the original:
- it now reads from several sources at once and dedupes them into one library
- the whole UI is redesigned, monochrome and minimal
- the library page got a proper card menu, launch options and Linux Proton config
- browse, search and filters all run through one query layer

Everything the original did well is still here. I just reshaped it for how I actually use it.

### running it
```
pnpm install
pnpm dev
```
`pnpm pack` builds a packaged app.

### credit
Built on [UnionCrax.Direct](https://github.com/UnionCrax-Team/UnionCrax.Direct) v2.7.3. Huge thanks to the original team, none of this exists without their work.

v1.0.0b
