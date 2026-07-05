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
  warning?: string | null
  skippedFiles?: string[]
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
  /** Override launch mode for this game: 'auto' | 'native' | 'wine' | 'proton' | 'umu' | 'inherit' */
  launchMode?: 'auto' | 'native' | 'wine' | 'proton' | 'umu' | 'inherit'
  /** umu-launcher GAMEID for protonfixes (e.g. 'umu-xxxx'); defaults to '0' (generic) */
  umuGameId?: string
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
  // ── Multi-source catalog (GameVault fork) ──
  // A resolvable download for a game on a given source.
  type SourceDownloadOption = {
    label: string
    hostType: string
    url?: string
    pageUrl?: string
    fileName?: string
    sizeBytes?: number
    sizeText?: string
    resolvable: boolean
  }
  // One source's record for a game (a unified game has one per contributing site).
  type SourceGame = {
    sourceId: string
    sourceSlug: string
    sourceUrl: string
    steamAppId: number | null
    dedupKey: string
    title: string
    description?: string
    image?: string
    heroImage?: string
    genres?: string[]
    developer?: string
    releaseDate?: string
    // sort/filter signals (null when the source doesn't expose them)
    releaseYear?: number | null
    addedAt?: number | null
    updatedAt?: number | null
    popularity?: number | null
    version?: string
    sizeBytes?: number
    sizeText?: string
    nsfw?: boolean
    downloadOptions?: SourceDownloadOption[]
  }
  // A deduped game merged across sources, sources lists every contributor.
  type UnifiedSourceGame = {
    dedupKey: string
    steamAppId: number | null
    title: string
    description?: string
    image?: string
    heroImage?: string
    genres?: string[]
    developer?: string
    releaseDate?: string
    releaseYear?: number | null
    addedAt?: number | null
    updatedAt?: number | null
    popularity?: number | null
    version?: string
    sizeBytes?: number
    sizeText?: string
    nsfw?: boolean
    sources: SourceGame[]
    // set by registry.detail() once this game has been cross-source surfaced
    // (every source that has the title merged in) + Steam-enriched, so the
    // detail page treats it as complete and serves it from cache without re-hydrating
    fullyResolved?: boolean
  }
  // What a source can do, drives the filter/sort UI and "unsupported" notices.
  type SourceCapabilityFlags = {
    search?: boolean
    catalog?: boolean
    appid?: boolean
    bulkBrowse?: boolean
    tags?: boolean
    releaseDate?: boolean
    size?: boolean
    sort?: Array<"popular" | "latest" | "updated" | "title">
  }
  type SourceInfo = {
    id: string
    name: string
    homepage: string
    capabilities: SourceCapabilityFlags
    enabled: boolean
  }
  type SourceSortKey = "popular" | "latest" | "updated" | "title" | "relevance"
  // Parameters for the unified cross-source query.
  type SourceQueryParams = {
    text?: string
    tags?: string[]
    tagMode?: "and" | "or"
    minYear?: number | null
    maxYear?: number | null
    minSizeBytes?: number | null
    maxSizeBytes?: number | null
    sort?: SourceSortKey
    order?: "asc" | "desc"
    offset?: number
    limit?: number
    sources?: string[]
    // round-robin results across sources so no single prolific source dominates
    // the first page, used for the default (text-less) Browse
    balanced?: boolean
  }
  type SourceFacets = {
    tags: Array<{ tag: string; count: number }>
    years: { min: number | null; max: number | null }
    size: { min: number | null; max: number | null }
  }
  type FeatureCoverage = "full" | "partial" | "none"
  // Per-source + aggregate capability report for the active source set.
  type SourceCapabilityReport = {
    perSource: Array<{ id: string; name: string; enabled: boolean } & SourceCapabilityFlags>
    scope: string[]
    coverage: Record<string, FeatureCoverage>
    supports: Record<string, string[]>
  }
  type SourceQueryResult = {
    ok: boolean
    games: UnifiedSourceGame[]
    total: number
    facets: SourceFacets
    applied: SourceQueryParams
    capabilities: SourceCapabilityReport
    error?: string
    sourcesErrored?: boolean
  }
  // Result of resolving a download option to an aria2-ready target.
  type SourceResolveResult = {
    resolvable: boolean
    url?: string
    files?: Array<{ url: string; fileName?: string; sizeBytes?: number }>
    fileName?: string
    sizeBytes?: number
    headers?: Record<string, string>
    ephemeral?: boolean
    openUrl?: string
    reason?: string
  }

  type ProtonDbSummary = {
    tier: string
    trendingTier: string
    bestReportedTier: string
    confidence: string
    score: number
    total: number
  }

  type Movie = {
    id: number
    name: string
    thumbnail: string
    mp4: string
    webm: string
  }

  type SteamMeta = {
    screenshots: string[]
    movies: Movie[]
    requirements: { minimum: string; recommended: string }
  }

  /** Pre-download storage reservation check result from window.ucStorage.precheck. */
  type StoragePrecheckResult = {
    ok: boolean
    requiredBytes: number
    freeBytes: number
    shortfallBytes: number
    downloadBytes: number
    extractBytes: number
    alreadyReservedBytes: number
    availableAfterReservation: number
    mountRoot: string | null
    humanRequired?: string
    humanFree?: string
    humanShortfall?: string
    humanAvailable?: string
    error?: string
  }

  type StorageSummaryResult = {
    ok: boolean
    mountRoot?: string | null
    freeBytes?: number
    reservedBytes?: number
    reservedDownloadBytes?: number
    reservedExtractBytes?: number
    availableBytes?: number
    humanFree?: string
    humanReserved?: string
    humanAvailable?: string
    error?: string
  }

  interface Window {
    // frameless window controls, was declared in the now removed TopBar
    ucWindow?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
    }
    ucDownloads?: {
      start: (payload: {
        downloadId: string
        url: string
        filename?: string
        appid?: string
        gameName?: string
        partIndex?: number
        partTotal?: number
        savePath?: string
        totalBytes?: number
        /** Per-download request headers (e.g. a Referer a source's host needs). */
        headers?: Record<string, string>
      }) => Promise<{ ok: boolean; queued?: boolean; error?: string }>
      cancel: (downloadId: string) => Promise<{ ok: boolean; status?: DownloadUpdatePayload["status"]; preservedArchive?: boolean; error?: string; downloadId?: string; appid?: string | null }>
      pause: (downloadId: string) => Promise<{ ok: boolean }>
      resume: (downloadId: string) => Promise<{ ok: boolean }>
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
      }) => Promise<{ ok: boolean; actualOffset?: number; error?: string }>
      showInFolder: (path: string) => Promise<{ ok: boolean }>
      openPath: (path: string) => Promise<{ ok: boolean }>
      getDownloadPath: () => Promise<{ path: string }>
      setDownloadPath: (targetPath: string) => Promise<{ ok: boolean; path?: string }>
      pickDownloadPath: () => Promise<{ ok: boolean; path?: string }>
      loadPersistedState: () => Promise<{ ok: boolean; downloads: any[]; error?: string }>
      savePersistedState: (downloads: any[]) => Promise<{ ok: boolean; count?: number; error?: string }>
      loadCatalogState: () => Promise<{ ok: boolean; games: any[]; stats: Record<string, { downloads: number; views: number }>; updatedAt: number; gamesUpdatedAt: number; statsUpdatedAt: number; error?: string }>
      saveCatalogState: (payload: { games: any[]; stats: Record<string, { downloads: number; views: number }>; gamesUpdatedAt?: number; statsUpdatedAt?: number }) => Promise<{ ok: boolean; games?: number; stats?: number; updatedAt?: number; gamesUpdatedAt?: number; statsUpdatedAt?: number; error?: string }>
      // Installed manifests written by the main process. Renderer can read/save installed metadata.
      listInstalled: () => Promise<any[]>
      getInstalled: (appid: string) => Promise<any | null>
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
      listRunningGameAppids: () => Promise<{ ok: boolean; appids: string[] }>
      quitGameExecutable: (appid: string) => Promise<{ ok: boolean; stopped?: boolean }>
      deleteInstalled: (appid: string) => Promise<{ ok: boolean }>
      deleteInstalling: (appid: string) => Promise<{ ok: boolean }>
      dismissInstalling: (appid: string) => Promise<{ ok: boolean; prompted?: boolean }>
      saveInstalledMetadata: (appid: string, metadata: any) => Promise<{ ok: boolean }>
      setInstallingStatus: (appid: string, status: string, error?: string | null) => Promise<{ ok: boolean }>
      getActiveStatus: (appid: string) => Promise<{ extracting: boolean; downloading: boolean }>
      createDesktopShortcut: (gameName: string, appid: string, exePath?: string) => Promise<{ ok: boolean; error?: string; existed?: boolean }>
      deleteDesktopShortcut: (gameName: string) => Promise<{ ok: boolean; error?: string }>
      updateInstalledMetadata: (appid: string, updates: Record<string, any>) => Promise<{ ok: boolean; error?: string }>
      pickImage: () => Promise<string | null>
      pickArchiveFiles: () => Promise<{ ok: boolean; cancelled?: boolean; files?: { path: string; name: string; size: number }[]; error?: string }>
      statArchiveFiles: (paths: string[]) => Promise<{ ok: boolean; files?: { path: string; name: string; size: number }[] }>
      onFileDrop: (callback: (payload: { paths: string[] }) => void) => () => void
      onFileDragEnter: (callback: (payload: unknown) => void) => () => void
      onFileDragLeave: (callback: (payload: unknown) => void) => () => void
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
      onBlocked: (callback: (data: { host: string; gameName: string | null; appid: string | null; reason: string }) => void) => () => void
      onGameQuickExit: (callback: (data: { appid: string | null; exePath: string | null; elapsed: number }) => void) => () => void
      onArchiveDeletePrompt: (callback: (payload: { appid?: string | null; gameName?: string | null; archivePaths: string[]; totalBytes: number }) => void) => () => void
    }
    ucApp?: {
      respondToCloseRequest: (shouldProceed: boolean) => Promise<{ ok: boolean; proceeded: boolean }>
      onCloseRequest: (callback: (data: { mode: "quit" | "hide"; extractionCount?: number; appids?: string[] }) => void) => () => void
      onNavigationAction?: (callback: (data: { path: string }) => void) => () => void
    }
    ucSettings?: {
      get: (key: string) => Promise<any>
      set: (key: string, value: any) => Promise<{ ok: boolean }>
      clearAll: () => Promise<{ ok: boolean; shortcutsRemoved?: number }>
      onChanged: (callback: (data: { key: string; value: any }) => void) => () => void
    }
    ucThemeEditor?: {
      open: (seed: { theme: import("./lib/themes/types").ThemeDef; mode: "new" | "edit" | "duplicate" }) => Promise<boolean>
      close: () => Promise<void>
      sendPreview: (theme: import("./lib/themes/types").ThemeDef) => void
      endPreview: () => void
      onSeed: (callback: (seed: { theme: import("./lib/themes/types").ThemeDef; mode: "new" | "edit" | "duplicate" }) => void) => () => void
      onPreview: (callback: (theme: import("./lib/themes/types").ThemeDef) => void) => () => void
      onPreviewEnd: (callback: () => void) => () => void
    }
    ucAuth?: {
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
      onUpdateAvailable: (callback: (data: { version?: string }) => void) => () => void
    }
    ucLogs?: {
      log: (level: string, message: string, data?: any) => Promise<void>
      shareLogs: (payload?: { baseUrl?: string }) => Promise<{ ok: boolean; error?: string; endpoint?: string; status?: number }>
    }
    ucAutostart?: {
      get: () => Promise<{ ok: boolean; enabled: boolean }>
      set: (enabled: boolean) => Promise<{ ok: boolean; enabled?: boolean; error?: string }>
    }
    ucDialogs?: {
      pickFolder: () => Promise<{ ok: boolean; path?: string }>
    }
    ucLinux?: {
      detectProton: () => Promise<{ ok: boolean; versions: Array<{ label: string; path: string }>; autoApplied?: boolean; appliedVersion?: { label: string; path: string }; error?: string }>
      pickPrefixDir: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      pickBinary: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      // Per-game Linux config
      getGameConfig: (appid: string) => Promise<{ ok: boolean; config: GameLinuxConfig; error?: string }>
      setGameConfig: (appid: string, config: GameLinuxConfig | null) => Promise<{ ok: boolean; error?: string }>
      // SLSteam
    }
    ucStorage?: {
      precheck: (opts: { targetPath?: string; downloadBytes: number; declaredInstallBytes?: number }) => Promise<StoragePrecheckResult>
      summary: (targetPath?: string) => Promise<StorageSummaryResult>
      snapshot: () => Promise<{ ok: boolean; reservations?: Array<{ id: string; mountRoot: string; downloadBytes: number; extractBytes: number; status: string; createdAt: number }>; error?: string }>
    }
    ucPresence?: {
      heartbeat: (
        baseUrl: string,
        appVersion?: string,
        opts?: { currentAppid?: string | null; currentGameName?: string | null }
      ) => Promise<{ ok: boolean; status?: number; error?: string }>
      onChanged?: (handler: (detail: { reason?: string; appid?: string | null; gameName?: string | null }) => void) => () => void
    }
    ucSystem?: {
      openExternal?: (target: string) => Promise<{ ok: boolean; error?: string }>
      launchSteam?: () => Promise<{ ok: boolean; method?: string; error?: string }>
      getNotifications: () => Promise<{ ok: boolean; notifications: SystemNotification[] }>
      onNotificationActivated: (callback: (data: { id: string }) => void) => () => void
    }
    ucSources?: {
      list: () => Promise<{ ok: boolean; sources: SourceInfo[]; error?: string }>
      setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
      search: (query: string, limit?: number) => Promise<{ ok: boolean; games: UnifiedSourceGame[]; error?: string }>
      catalog: (offset?: number, limit?: number) => Promise<{ ok: boolean; games: UnifiedSourceGame[]; error?: string }>
      detail: (sources: Array<{ sourceId: string; sourceSlug: string }>) => Promise<{ ok: boolean; game: UnifiedSourceGame | null; error?: string }>
      resolve: (sourceId: string, option: SourceDownloadOption) => Promise<{ ok: boolean; result: SourceResolveResult; error?: string }>
      steamArt: (appid: number) => Promise<{ ok: boolean; art: { header: string; background: string } }>
      protondb: (appid: number) => Promise<{ ok: boolean; data: ProtonDbSummary | null }>
      steamMeta: (appid: number) => Promise<{ ok: boolean; meta: SteamMeta }>
      query: (params: SourceQueryParams, reqId?: number) => Promise<SourceQueryResult>
      onBrowsePartial: (cb: (payload: { reqId: number; games: UnifiedSourceGame[]; total: number; doneSources: string[] }) => void) => () => void
      capabilities: (sourceIds?: string[]) => Promise<{ ok: boolean; capabilities: SourceCapabilityReport; error?: string }>
      tags: () => Promise<{ ok: boolean; tags: string[]; bySource: Record<string, string[]>; error?: string }>
    }
    ucAssets?: {
      size: () => Promise<{ ok: boolean; bytes: number; error?: string }>
      clear: () => Promise<{ ok: boolean; freed: number; error?: string }>
    }
  }
}

export { }
