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

Only works for public Pixeldrain files

Subject to Pixeldrain rate limits

Endpoint may change in the future
