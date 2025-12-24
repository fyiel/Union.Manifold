/// <reference types="vite/client" />

type DownloadUpdatePayload = {
  downloadId: string
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled"
  receivedBytes?: number
  totalBytes?: number
  speedBps?: number
  etaSeconds?: number | null
  filename?: string
  savePath?: string
  appid?: string | null
  gameName?: string | null
  url?: string
  error?: string | null
}

declare global {
  interface Window {
    ucDownloads?: {
      start: (payload: {
        downloadId: string
        url: string
        filename?: string
        appid?: string
        gameName?: string
      }) => Promise<{ ok: boolean }>
      cancel: (downloadId: string) => Promise<{ ok: boolean }>
      showInFolder: (path: string) => Promise<{ ok: boolean }>
      openPath: (path: string) => Promise<{ ok: boolean }>
      listDisks: () => Promise<
        { id: string; name: string; path: string; totalBytes: number; freeBytes: number }[]
      >
      getDownloadPath: () => Promise<{ path: string }>
      setDownloadPath: (targetPath: string) => Promise<{ ok: boolean; path?: string }>
      pickDownloadPath: () => Promise<{ ok: boolean; path?: string }>
      getDownloadUsage: (targetPath?: string) => Promise<{ ok: boolean; sizeBytes: number; path: string }>
      onUpdate: (callback: (update: DownloadUpdatePayload) => void) => () => void
    }
  }
}

export {}
