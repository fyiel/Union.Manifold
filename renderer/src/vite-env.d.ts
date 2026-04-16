/// <reference types="vite/client" />

type DownloadUpdatePayload = {
  downloadId: string
  status:
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "retrying"
  | "extracting"
  | "installing"
  | "install_ready"
  | "completed"
  | "extracted"
  | "extract_failed"
  | "failed"
  | "cancelled"
  receivedBytes?: number
  totalBytes?: number
  speedBps?: number
  etaSeconds?: number | null
  extractProgress?: number | null
  filename?: string
  savePath?: string
  appid?: string | null
  gameName?: string | null
  url?: string
  error?: string | null
  partIndex?: number
  partTotal?: number
  spaceCheck?: {
    archiveBytes: number
    estimatedExtractBytes: number
    requiredBytes: number
    freeBytes: number
    shortfallBytes: number
    targetPath: string
    drives: Array<{ id: string; name: string; path: string; totalBytes: number; freeBytes: number }>
    ok: boolean
  } | null
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

/** Per-game Linux/VR configuration stored as gameLinux:${appid} in settings */
type GameLinuxConfig = {
  /** Override launch mode for this game: 'auto' | 'native' | 'wine' | 'proton' | 'inherit' */
  launchMode?: 'auto' | 'native' | 'wine' | 'proton' | 'inherit'
  /** Override Wine binary path for this game */
  winePath?: string
  /** Override Proton script path for this game */
  protonPath?: string
  /** Override WINEPREFIX for this game */
  winePrefix?: string
  /** Override Proton prefix (STEAM_COMPAT_DATA_PATH) for this game */
  protonPrefix?: string
  /** Per-game extra environment variables (newline-separated KEY=VALUE) */
  extraEnv?: string
  /** Override VR support for this game: true=force on, false=force off, undefined=use global */
  vrEnabled?: boolean
  /** Override XR_RUNTIME_JSON for this game */
  vrXrRuntimeJson?: string
  /** SLSteam Steam App ID for this game */
  slsSteamAppId?: string
  /** Whether SLSteam is enabled for this game */
  slsSteamEnabled?: boolean
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
        authHeader?: string
        savePath?: string
      }) => Promise<{ ok: boolean; queued?: boolean; error?: string }>
      cancel: (downloadId: string) => Promise<{ ok: boolean; status?: DownloadUpdatePayload["status"]; preservedArchive?: boolean; error?: string; downloadId?: string; appid?: string | null }>
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
        authHeader?: string
      }) => Promise<{ ok: boolean; error?: string }>
      resumeWithFreshUrl: (payload: {
        downloadId: string
        url: string
        filename?: string
        appid?: string
        gameName?: string
        partIndex?: number
        partTotal?: number
        savePath?: string
        totalBytes?: number
        authHeader?: string
      }) => Promise<{ ok: boolean; actualOffset?: number; error?: string }>
      showInFolder: (path: string) => Promise<{ ok: boolean }>
      openPath: (path: string) => Promise<{ ok: boolean }>
      listDisks: () => Promise<
        { id: string; name: string; path: string; totalBytes: number; freeBytes: number }[]
      >
      getDownloadPath: () => Promise<{ path: string }>
      setDownloadPath: (targetPath: string) => Promise<{ ok: boolean; path?: string }>
      pickDownloadPath: () => Promise<{ ok: boolean; path?: string }>
      getDownloadUsage: (targetPath?: string) => Promise<{ ok: boolean; sizeBytes: number; path: string }>
      clearDownloadCache: () => Promise<{ ok: boolean; error?: string }>
      loadPersistedState: () => Promise<{ ok: boolean; downloads: any[]; error?: string }>
      savePersistedState: (downloads: any[]) => Promise<{ ok: boolean; count?: number; error?: string }>
      loadCatalogState: () => Promise<{ ok: boolean; games: any[]; stats: Record<string, { downloads: number; views: number }>; updatedAt: number; gamesUpdatedAt: number; statsUpdatedAt: number; error?: string }>
      saveCatalogState: (payload: { games: any[]; stats: Record<string, { downloads: number; views: number }>; gamesUpdatedAt?: number; statsUpdatedAt?: number }) => Promise<{ ok: boolean; games?: number; stats?: number; updatedAt?: number; gamesUpdatedAt?: number; statsUpdatedAt?: number; error?: string }>
      // Installed manifests written by the main process. Renderer can read/save installed metadata.
      listInstalled: () => Promise<any[]>
      getInstalled: (appid: string) => Promise<any | null>
      listInstalledByAppid: (appid: string) => Promise<any[]>
      listInstalling: () => Promise<any[]>
      getInstalling: (appid: string) => Promise<any | null>
      listInstalledGlobal: () => Promise<any[]>
      getInstalledGlobal: (appid: string) => Promise<any | null>
      listInstallingGlobal: () => Promise<any[]>
      getInstallingGlobal: (appid: string) => Promise<any | null>
      listGameExecutables: (appid: string) => Promise<{ ok: boolean; folder?: string; exes: { name: string; path: string; size?: number; depth?: number }[]; error?: string }>
      findGameSubfolder: (folder: string) => Promise<string | null>
      preflightGameLaunch: (appid: string, exePath: string) => Promise<{
        ok: boolean
        canLaunch: boolean
        checks: Array<{ level: 'error' | 'warning' | 'info'; code: string; message: string }>
        resolved?: { command: string; args: string[]; cwd: string } | null
      }>
      launchGameExecutable: (appid: string, exePath: string, gameName?: string, showGameName?: boolean) => Promise<{ ok: boolean; error?: string; pid?: number }>
      getRunningGame: (appid: string) => Promise<{ ok: boolean; running: boolean; pid?: number; exePath?: string }>
      quitGameExecutable: (appid: string) => Promise<{ ok: boolean; stopped?: boolean }>
      deleteInstalled: (appid: string) => Promise<{ ok: boolean }>
      deleteInstalling: (appid: string) => Promise<{ ok: boolean }>
      createUpdateBackup: (appid: string) => Promise<{ ok: boolean; backupPath?: string; error?: string }>
      dismissInstalling: (appid: string) => Promise<{ ok: boolean; prompted?: boolean }>
      saveInstalledMetadata: (appid: string, metadata: any) => Promise<{ ok: boolean }>
      setInstallingStatus: (appid: string, status: string, error?: string | null) => Promise<{ ok: boolean }>
      getActiveStatus: (appid: string) => Promise<{ extracting: boolean; downloading: boolean }>
      createDesktopShortcut: (gameName: string, exePath: string) => Promise<{ ok: boolean; error?: string }>
      deleteDesktopShortcut: (gameName: string) => Promise<{ ok: boolean; error?: string }>
      addExternalGame: (appid: string, metadata: any, gamePath: string) => Promise<{ ok: boolean; error?: string }>
      updateInstalledMetadata: (appid: string, updates: Record<string, any>) => Promise<{ ok: boolean; error?: string }>
      pickExternalGameFolder: () => Promise<string | null>
      pickImage: () => Promise<string | null>
      pickArchiveFiles: () => Promise<{ ok: boolean; cancelled?: boolean; files?: { path: string; name: string; size: number }[]; error?: string }>
      installFromArchive: (payload: {
        appid?: string
        gameName?: string
        archivePaths: string[]
        downloadId?: string
        metadata?: Record<string, any>
      }) => Promise<{ ok: boolean; downloadId?: string; extracted?: number; error?: string; code?: string; spaceCheck?: DownloadUpdatePayload["spaceCheck"] }>
      installDownloadedArchive: (appid: string) => Promise<{ ok: boolean; downloadId?: string; extracted?: number; error?: string; code?: string; spaceCheck?: DownloadUpdatePayload["spaceCheck"] }>
      deleteArchiveFiles: (payload: { archivePaths: string[] }) => Promise<{ ok: boolean; deletedCount?: number; error?: string }>
      browseForGameExe: (defaultPath?: string) => Promise<{ ok: boolean; path?: string }>
      onUpdate: (callback: (update: DownloadUpdatePayload) => void) => () => void
      onGameQuickExit: (callback: (data: { appid: string | null; exePath: string | null; elapsed: number }) => void) => () => void
      onArchiveDeletePrompt: (callback: (payload: { appid?: string | null; gameName?: string | null; archivePaths: string[]; totalBytes: number }) => void) => () => void
    }
    ucApp?: {
      respondToCloseRequest: (shouldProceed: boolean) => Promise<{ ok: boolean; proceeded: boolean }>
      onCloseRequest: (callback: (data: { mode: "quit" | "hide"; extractionCount?: number; appids?: string[] }) => void) => () => void
    }
    ucSettings?: {
      get: (key: string) => Promise<any>
      set: (key: string, value: any) => Promise<{ ok: boolean }>
      clearAll: () => Promise<{ ok: boolean }>
      exportSettings: () => Promise<{ ok: boolean; data?: string; error?: string }>
      importSettings: () => Promise<{ ok: boolean; error?: string }>
      runNetworkTest: (baseUrl?: string) => Promise<{ ok: boolean; results?: Array<{ label: string; url: string; ok: boolean; status: number; elapsedMs: number; error?: string }>; error?: string }>
      onChanged: (callback: (data: { key: string; value: any }) => void) => () => void
    }
    ucAuth?: {
      login: (baseUrl?: string, provider?: string) => Promise<{ ok: boolean; error?: string }>
      logout: (baseUrl?: string) => Promise<{ ok: boolean; error?: string }>
      getSession: (baseUrl?: string) => Promise<{ ok: boolean; discordId?: string | null }>
      emailLogin: (baseUrl: string, email: string, password: string) => Promise<{ ok: boolean; error?: string }>
      register: (baseUrl: string, email: string, username: string, password: string) => Promise<{ ok: boolean; error?: string }>
      forgotPassword: (baseUrl: string, email: string) => Promise<{ ok: boolean; error?: string }>
      resetPassword: (baseUrl: string, token: string, password: string) => Promise<{ ok: boolean; error?: string }>
      verifyEmail: (baseUrl: string, token: string) => Promise<{ ok: boolean; error?: string }>
      getMe: (baseUrl: string) => Promise<{ ok: boolean; error?: string; user?: any }>
      linkProvider: (baseUrl: string, provider: string) => Promise<{ ok: boolean; error?: string }>
      unlinkProvider: (baseUrl: string, provider: string) => Promise<{ ok: boolean; error?: string }>
      updateProfile: (baseUrl: string, data: any) => Promise<{ ok: boolean; error?: string }>
      updatePassword: (baseUrl: string, currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>
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
      checkForUpdates: () => Promise<{
        enabled: boolean
        state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'not-available' | 'error'
        currentVersion: string
        version?: string | null
        available: boolean
        downloaded: boolean
        progress: number
        error?: string | null
        checkedAt?: number | null
      }>
      installUpdate: () => Promise<{ ok: boolean; error?: string }>
      getVersion: () => Promise<string>
      getUpdateStatus: () => Promise<{
        enabled: boolean
        state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'not-available' | 'error'
        currentVersion: string
        version?: string | null
        available: boolean
        downloaded: boolean
        progress: number
        error?: string | null
        checkedAt?: number | null
      }>
      retryUpdate: () => Promise<{
        enabled: boolean
        state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'not-available' | 'error'
        currentVersion: string
        version?: string | null
        available: boolean
        downloaded: boolean
        progress: number
        error?: string | null
        checkedAt?: number | null
      }>
      onStatusChanged: (callback: (status: {
        enabled: boolean
        state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'not-available' | 'error'
        currentVersion: string
        version?: string | null
        available: boolean
        downloaded: boolean
        progress: number
        error?: string | null
        checkedAt?: number | null
      }) => void) => () => void
    }
    ucLogs?: {
      log: (level: string, message: string, data?: any) => Promise<void>
      getLogs: () => Promise<string>
      clearLogs: () => Promise<void>
      openLogsFolder: () => Promise<{ ok: boolean; error?: string }>
      shareLogs: (payload?: { baseUrl?: string }) => Promise<{ ok: boolean; error?: string; endpoint?: string; status?: number }>
    }
    ucRpc?: {
      setActivity: (payload: {
        details?: string
        state?: string
        startTimestamp?: number
        endTimestamp?: number
        largeImageKey?: string
        largeImageText?: string
        smallImageKey?: string
        smallImageText?: string
        buttons?: Array<{ label: string; url: string }>
      }) => Promise<{ ok: boolean }>
      clearActivity: () => Promise<{ ok: boolean }>
      getStatus: () => Promise<{ ok: boolean; enabled: boolean; ready: boolean; clientId?: string | null }>
    }
    electron?: {
      ipcRenderer: {
        on: (channel: string, func: (...args: any[]) => void) => void
        removeListener: (channel: string, func: (...args: any[]) => void) => void
      }
    }
    ucLinux?: {
      detectProton: () => Promise<{ ok: boolean; versions: Array<{ label: string; path: string }>; autoApplied?: boolean; appliedVersion?: { label: string; path: string }; error?: string }>
      detectWine: () => Promise<{ ok: boolean; versions: Array<{ label: string; path: string }>; error?: string }>
      runWinecfg: () => Promise<{ ok: boolean; pid?: number; error?: string }>
      runWinetricks: (packages?: string[]) => Promise<{ ok: boolean; pid?: number; error?: string }>
      runProtontricks: (appId?: string, packages?: string[]) => Promise<{ ok: boolean; pid?: number; error?: string }>
      createPrefix: (prefixPath: string, arch?: '32' | '64' | 'win32' | 'win64') => Promise<{ ok: boolean; code?: number; stdout?: string; stderr?: string; error?: string }>
      pickPrefixDir: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      pickBinary: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      pickSo: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      checkTool: (toolName: string) => Promise<{ ok: boolean; available: boolean; path?: string; error?: string }>
      getSteamPath: () => Promise<{ ok: boolean; path?: string; error?: string }>
      // Per-game Linux config
      getGameConfig: (appid: string) => Promise<{ ok: boolean; config: GameLinuxConfig; error?: string }>
      setGameConfig: (appid: string, config: GameLinuxConfig | null) => Promise<{ ok: boolean; error?: string }>
      // SLSteam
      detectSLSSteam: () => Promise<{ ok: boolean; found: boolean; dir?: string | null; slsSteamPath?: string | null; slsInjectPath?: string | null; error?: string }>
      slsSteamDownload: () => Promise<{ ok: boolean; error?: string }>
      slsSteamSetupGame: (appid: string, steamAppId?: string) => Promise<{ ok: boolean; path?: string; steamAppId?: string; error?: string }>
      slsSteamCheckGame: (appid: string) => Promise<{ ok: boolean; found: boolean; path?: string; steamAppId?: string; error?: string }>
    }
    ucVR?: {
      detectSteamVR: () => Promise<{ ok: boolean; found: boolean; dir?: string | null; vrserver?: string | null; startup?: string | null; error?: string }>
      detectOpenXR: () => Promise<{ ok: boolean; found: boolean; path?: string | null; error?: string }>
      launchSteamVR: () => Promise<{ ok: boolean; method?: string; error?: string }>
      pickRuntimeJson: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      pickSteamVRDir: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      getSettings: () => Promise<{
        ok: boolean
        vrEnabled?: boolean
        vrSteamVrPath?: string
        vrXrRuntimeJson?: string
        vrSteamVrRuntime?: string
        vrExtraEnv?: string
        vrAutoLaunchSteamVr?: boolean
        error?: string
      }>
    }
    ucOverlay?: {
      show: (appid?: string) => Promise<{ ok: boolean; error?: string }>
      hide: () => Promise<{ ok: boolean; error?: string }>
      toggle: (appid?: string) => Promise<{ ok: boolean; visible?: boolean; error?: string }>
      getStatus: () => Promise<{
        ok: boolean
        enabled: boolean
        visible: boolean
        hotkey: string
        autoShow: boolean
        position: 'left' | 'right'
        toastDurationMs: number
        toastVertical: 'top' | 'bottom'
        currentAppid: string | null
      }>
      getSettings: () => Promise<{
        ok: boolean
        enabled: boolean
        hotkey: string
        autoShow: boolean
        position: 'left' | 'right'
        toastDurationMs: number
        toastVertical: 'top' | 'bottom'
      }>
      getDiagnostics: () => Promise<{
        ok: boolean
        diagnostics?: {
          enabled: boolean
          autoShow: boolean
          hotkey: string
          hotkeyRegistered: boolean
          position: 'left' | 'right'
          currentMode: 'hidden' | 'toast' | 'panel'
          currentAppid: string | null
          overlayWindowCreated: boolean
          overlayWindowReady: boolean
          overlayWindowVisible: boolean
          nativeAddonAvailable: boolean
          dllPath: string
          dllExists: boolean
          injectionCount: number
          injections: Array<{ pid: number; appid: string | null; gameName: string | null }>
          runningGameCount: number
          lastEvent: string
          lastError: string | null
        }
        error?: string
      }>
      setSettings: (settings: {
        overlayEnabled?: boolean
        overlayHotkey?: string
        overlayAutoShow?: boolean
        overlayPosition?: 'left' | 'right'
        overlayToastDurationMs?: number
        overlayToastVertical?: 'top' | 'bottom'
      }) => Promise<{ ok: boolean; error?: string }>
      getGameInfo: (appid: string) => Promise<{
        ok: boolean
        gameName?: string
        pid?: number
        startedAt?: number
      }>
      getRunningGames: () => Promise<{
        ok: boolean
        games: Array<{
          appid: string | null
          gameName: string | null
          pid: number
          startedAt: number
        }>
      }>
      getDownloads: () => Promise<{
        ok: boolean
        downloads: Array<{
          downloadId: string
          status: string
          filename?: string
          gameName?: string
          appid?: string
          receivedBytes?: number
          totalBytes?: number
          speedBps?: number
          etaSeconds?: number | null
        }>
      }>
      pauseDownload: (downloadId: string) => Promise<{ ok: boolean; error?: string }>
      resumeDownload: (downloadId: string) => Promise<{ ok: boolean; error?: string }>
      onShow: (callback: (data: { appid: string | null }) => void) => () => void
      onHide: (callback: () => void) => () => void
      onStateChanged: (callback: (data: { visible: boolean; appid: string | null }) => void) => () => void
      onPositionChanged: (callback: (data: {
        position: 'left' | 'right'
        toastDurationMs?: number
        toastVertical?: 'top' | 'bottom'
      }) => void) => () => void
      onDownloadUpdate: (callback: (update: DownloadUpdatePayload) => void) => () => void
    }
    ucController?: {
      getSettings: () => Promise<{
        ok: boolean
        settings?: {
          enabled: boolean
          controllerType: 'xbox' | 'playstation' | 'generic'
          vibrationEnabled: boolean
          deadzone: number
          triggerDeadzone: number
          buttonLayout: 'default' | 'legacy'
        }
        error?: string
      }>
      setSettings: (settings: {
        enabled?: boolean
        controllerType?: 'xbox' | 'playstation' | 'generic'
        vibrationEnabled?: boolean
        deadzone?: number
        triggerDeadzone?: number
        buttonLayout?: 'default' | 'legacy'
      }) => Promise<{ ok: boolean; error?: string }>
      getConnected: () => Promise<{
        connected: boolean
        controllerId: string | null
        controllerName: string | null
        controllerType: string | null
      }>
    }
    ucSystem?: {
      getVolume: () => Promise<{ ok: boolean; volume: number }>
      setVolume: (level: number) => Promise<{ ok: boolean }>
      getMuted: () => Promise<{ ok: boolean; muted: boolean }>
      setMuted: (muted: boolean) => Promise<{ ok: boolean }>
      takeScreenshot: () => Promise<{ ok: boolean; path?: string }>
      getScreenshotPath: () => Promise<{ ok: boolean; path: string }>
      listScreenshots: () => Promise<{ ok: boolean; screenshots: Array<{ filename: string; path: string; size: number; takenAt: number }>; error?: string }>
      deleteScreenshot: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      openScreenshot: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      getNotifications: () => Promise<{ ok: boolean; notifications: SystemNotification[] }>
      onNotificationActivated: (callback: (data: { id: string }) => void) => () => void
    }
  }
}

export { }
