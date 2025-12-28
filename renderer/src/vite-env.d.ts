/// <reference types="vite/client" />

type DownloadUpdatePayload = {
  downloadId: string
  status:
    | "queued"
    | "downloading"
    | "paused"
    | "extracting"
    | "installing"
    | "completed"
    | "extracted"
    | "extract_failed"
    | "failed"
    | "cancelled"
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
  partIndex?: number
  partTotal?: number
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
        partIndex?: number
        partTotal?: number
      }) => Promise<{ ok: boolean; queued?: boolean; error?: string }>
      cancel: (downloadId: string) => Promise<{ ok: boolean }>
      pause: (downloadId: string) => Promise<{ ok: boolean }>
      resume: (downloadId: string) => Promise<{ ok: boolean }>
      showInFolder: (path: string) => Promise<{ ok: boolean }>
      openPath: (path: string) => Promise<{ ok: boolean }>
      listDisks: () => Promise<
        { id: string; name: string; path: string; totalBytes: number; freeBytes: number }[]
      >
      getDownloadPath: () => Promise<{ path: string }>
      setDownloadPath: (targetPath: string) => Promise<{ ok: boolean; path?: string }>
      pickDownloadPath: () => Promise<{ ok: boolean; path?: string }>
      getDownloadUsage: (targetPath?: string) => Promise<{ ok: boolean; sizeBytes: number; path: string }>
      // Installed manifests written by the main process. Renderer can read/save installed metadata.
      listInstalled: () => Promise<any[]>
      getInstalled: (appid: string) => Promise<any | null>
      listInstalling: () => Promise<any[]>
      getInstalling: (appid: string) => Promise<any | null>
      listInstalledGlobal: () => Promise<any[]>
      getInstalledGlobal: (appid: string) => Promise<any | null>
      listInstallingGlobal: () => Promise<any[]>
      getInstallingGlobal: (appid: string) => Promise<any | null>
      listGameExecutables: (appid: string) => Promise<{ ok: boolean; folder?: string; exes: { name: string; path: string }[]; error?: string }>
      launchGameExecutable: (exePath: string) => Promise<{ ok: boolean; error?: string }>
      deleteInstalled: (appid: string) => Promise<{ ok: boolean }>
      deleteInstalling: (appid: string) => Promise<{ ok: boolean }>
      saveInstalledMetadata: (appid: string, metadata: any) => Promise<{ ok: boolean }>
      onUpdate: (callback: (update: DownloadUpdatePayload) => void) => () => void
    }
    ucSettings?: {
      get: (key: string) => Promise<any>
      set: (key: string, value: any) => Promise<{ ok: boolean }>
      onChanged: (callback: (data: { key: string; value: any }) => void) => () => void
    }
  }
}

export {}
