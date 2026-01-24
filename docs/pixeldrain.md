Pixeldrain Direct Downloads (Electron)

This project shows how to directly download files from pixeldrain.com inside an Electron app using Pixeldrain’s raw file API.

It avoids the Pixeldrain website UI and streams files straight to disk.

✅ Confirmed Working Endpoint

For a Pixeldrain link:

https://pixeldrain.com/u/FILE_ID


Use this direct file endpoint:

https://pixeldrain.com/api/file/FILE_ID


✔ Returns raw file data
✔ Works in Node.js / Electron


📦 Requirements

Electron

Node.js 18+ (native fetch)

Access to Electron main process


📁 Basic Download Function (Main Process)
```js
import fs from "fs"
import path from "path"
import { app } from "electron"

export async function downloadFromPixeldrain(fileId) {
  const url = `https://pixeldrain.com/api/file/${fileId}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`)
  }

  // Try to get filename from headers
  const disposition = res.headers.get("content-disposition")
  let filename = fileId

  if (disposition) {
    const match = disposition.match(/filename="?(.+?)"?/)
    if (match) filename = match[1]
  }

  const outputPath = path.join(app.getPath("downloads"), filename)

  const fileStream = fs.createWriteStream(outputPath)
  res.body.pipe(fileStream)

  await new Promise(resolve => fileStream.on("finish", resolve))
  return outputPath
}
```

▶️ Example Usage
```js
await downloadFromPixeldrain("NUYAjuRK")
```

The file will be saved to the user’s Downloads folder.


🔌 Renderer → Main (IPC Example)

preload.js
```js
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("pixeldrain", {
  download: (fileId) => ipcRenderer.invoke("pixeldrain-download", fileId)
})
```

main.js
```js
import { ipcMain } from "electron"
import { downloadFromPixeldrain } from "./pixeldrain.js"

ipcMain.handle("pixeldrain-download", async (_, fileId) => {
  return await downloadFromPixeldrain(fileId)
})
```

renderer.js
```js
await window.pixeldrain.download("NUYAjuRK")
```


📊 Large Files (Important)

Always stream the response body:

```js
res.body.pipe(fs.createWriteStream(path))
```


❌ Do NOT use arrayBuffer() for large files
✔ Streaming avoids memory crashes


⚠️ Notes & Limitations

- Only works for public Pixeldrain files
- **Subject to Pixeldrain rate limits** - requires 2+ second delay between successive downloads
- **Requires Referer and Origin headers** to prevent 403 errors (optional but recommended)
- Use Electron's `session.webRequest.onBeforeSendHeaders` to add required headers
- **Implement download delays** to avoid rate limiting when downloading multiple files
- Endpoint may change in the future

## 🔐 Required Headers (Recommended)

Pixeldrain may require proper headers to prevent 403 Forbidden errors:

```js
mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
  { urls: ['https://pixeldrain.com/api/file/*'] },
  (details, callback) => {
    details.requestHeaders['Referer'] = 'https://pixeldrain.com/'
    details.requestHeaders['Origin'] = 'https://pixeldrain.com'
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    callback({ requestHeaders: details.requestHeaders })
  }
)
```

## ⏱️ Rate Limiting (Critical for Multi-Part Downloads)

**Pixeldrain aggressively rate limits successive downloads.** When downloading multiple files (e.g., multi-part archives), you must add a delay between downloads:

```js
let lastPixeldrainDownloadTime = 0
const PIXELDRAIN_DELAY_MS = 2000 // 2 seconds minimum

function startPixeldrainDownload(url) {
  const timeSinceLastDownload = Date.now() - lastPixeldrainDownloadTime
  
  if (timeSinceLastDownload < PIXELDRAIN_DELAY_MS) {
    const delayNeeded = PIXELDRAIN_DELAY_MS - timeSinceLastDownload
    setTimeout(() => {
      startPixeldrainDownload(url)
    }, delayNeeded)
    return
  }
  
  lastPixeldrainDownloadTime = Date.now()
  // Start the download
  win.webContents.downloadURL(url)
}
```

**Without delay:** Downloads 2+ will fail immediately with `interrupted` status and `mimeType: "application/json"` (403 error page).

**With delay:** All downloads succeed sequentially.
