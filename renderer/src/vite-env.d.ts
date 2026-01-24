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
  resumeData?: {
    urlChain?: string[]
    mimeType?: string
    etag?: string
    lastModified?: string
    startTime?: number
    offset?: number
    totalBytes?: number
    savePath?: string
  }
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
      resumeInterrupted: (payload: {
        downloadId: string
        url: string
        filename?: string
        appid?: string
        gameName?: string
        partIndex?: number
        partTotal?: number
        savePath?: string
        resumeData?: DownloadUpdatePayload["resumeData"]
      }) => Promise<{ ok: boolean; error?: string }>
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
      findGameSubfolder: (folder: string) => Promise<string | null>
      launchGameExecutable: (appid: string, exePath: string) => Promise<{ ok: boolean; error?: string; pid?: number }>
      launchGameExecutableAsAdmin: (appid: string, exePath: string) => Promise<{ ok: boolean; error?: string; pid?: number }>
      getRunningGame: (appid: string) => Promise<{ ok: boolean; running: boolean; pid?: number; exePath?: string }>
      quitGameExecutable: (appid: string) => Promise<{ ok: boolean; stopped?: boolean }>
      deleteInstalled: (appid: string) => Promise<{ ok: boolean }>
      deleteInstalling: (appid: string) => Promise<{ ok: boolean }>
      saveInstalledMetadata: (appid: string, metadata: any) => Promise<{ ok: boolean }>
      setInstallingStatus: (appid: string, status: string, error?: string | null) => Promise<{ ok: boolean }>
      onUpdate: (callback: (update: DownloadUpdatePayload) => void) => () => void
    }
    ucSettings?: {
      get: (key: string) => Promise<any>
      set: (key: string, value: any) => Promise<{ ok: boolean }>
      onChanged: (callback: (data: { key: string; value: any }) => void) => () => void
    }
    ucAuth?: {
      login: (baseUrl?: string) => Promise<{ ok: boolean; error?: string }>
      logout: (baseUrl?: string) => Promise<{ ok: boolean; error?: string }>
      getSession: (baseUrl?: string) => Promise<{ ok: boolean; discordId?: string | null }>
      fetch: (
        baseUrl: string,
        path: string,
        init?: { method?: string; headers?: Record<string, string>; body?: string | null }
      ) => Promise<{
        ok: boolean
        status: number
        statusText: string
        headers: [string, string][]
        body?: string
      }>
    }
    ucUpdater?: {
      checkForUpdates: () => Promise<{ available: boolean; version?: string; message?: string; error?: string }>
      installUpdate: () => void
      getVersion: () => Promise<string>
      getUpdateStatus: () => Promise<any>
      retryUpdate: () => Promise<{ ok: boolean; error?: string }>
    }
    ucLogs?: {
      log: (level: string, message: string, data?: any) => Promise<void>
      getLogs: () => Promise<string>
      clearLogs: () => Promise<void>
    }
    electron?: {
      ipcRenderer: {
        on: (channel: string, func: (...args: any[]) => void) => void
        removeListener: (channel: string, func: (...args: any[]) => void) => void
      }
    }
  }
}

export {}
