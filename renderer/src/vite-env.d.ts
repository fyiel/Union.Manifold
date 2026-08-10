/// <reference types="vite/client" />

type DownloadUpdatePayload = {
  downloadId: string
  status:
  | "queued"
  | "downloading"
  | "paused"
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
  update?: boolean
  installMetadata?: Record<string, unknown>
}

type GameLinuxConfig = {
  launchMode?: 'auto' | 'native' | 'wine' | 'proton' | 'umu' | 'inherit'
  umuGameId?: string
  winePath?: string
  protonPath?: string
  winePrefix?: string
  protonPrefix?: string
  extraEnv?: string
  vrEnabled?: boolean
  vrXrRuntimeJson?: string
  slsSteamAppId?: string
  slsSteamEnabled?: boolean
}

declare global {
  type SourceDownloadOption = {
    label: string
    hostType: string
    url?: string
    pageUrl?: string
    sizeBytes?: number
    sizeText?: string
    resolvable: boolean
    parts?: string[]
  }
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
    releaseYear?: number | null
    updatedAt?: number | null
    version?: string
    sizeBytes?: number
    sizeText?: string
    downloadOptions?: SourceDownloadOption[]
    direct?: boolean
  }
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
    version?: string
    sizeBytes?: number
    sizeText?: string
    sources: SourceGame[]
    fullyResolved?: boolean
  }
  type SourceCapabilityFlags = {
    search?: boolean
    catalog?: boolean
    bulkBrowse?: boolean
    tags?: boolean
    releaseDate?: boolean
    size?: boolean
    sort?: Array<"latest" | "title">
  }
  type SourceInfo = {
    id: string
    name: string
    homepage: string
    capabilities: SourceCapabilityFlags
    enabled: boolean
    requiresSlipgate: boolean
    available: boolean
    torrentOnly: boolean
    hiddenByTorrentFilter: boolean
  }
  type LocalAchievement = {
    apiName: string
    displayName: string
    description: string
    hidden: boolean
    icon?: string | null
    iconLocked?: string | null
    unlocked: boolean
    unlockedAt?: number | null
  }
  type LocalAchievementGame = {
    appid: string
    steamAppId?: number | null
    title: string
    image?: string | null
    provider: string
    catalogComplete: boolean
    achievements: LocalAchievement[]
  }
  type LocalAchievementUnlock = {
    gameTitle: string
    achievement: LocalAchievement
  }
  type RepairProgress = {
    appid: string
    phase: "resolving" | "downloading" | "extracting" | "done" | "failed"
    percent?: number | null
    error?: string | null
  }
  type SourceSortKey = "popular" | "latest" | "updated" | "title" | "relevance"
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
    balanced?: boolean
  }
  type SourceFacets = {
    tags: Array<{ tag: string; count: number }>
  }
  type SourceCapabilityReport = {
    perSource: Array<{ id: string; name: string; enabled: boolean } & SourceCapabilityFlags>
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
    perSourceStatus?: Array<{ id: string; ok: boolean; games: number; reason?: string }>
  }
  type SourceResolveResult = {
    resolvable: boolean
    url?: string
    files?: Array<{ url: string; fileName?: string; sizeBytes?: number }>
    fileName?: string
    sizeBytes?: number
    headers?: Record<string, string>
    ephemeral?: boolean
    cancelled?: boolean
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

  type StoragePrecheckResult = {
    ok: boolean
    downloadBytes: number
    extractBytes: number
    alreadyReservedBytes: number
    humanRequired?: string
    humanShortfall?: string
    humanAvailable?: string
  }


  type SteamScannedApp = {
    steamAppId: number
    name: string
    installPath?: string
    sizeBytes?: number
    imported: boolean
  }

  type ModEntry = {
    id: string
    provider: "nexus" | "workshop" | "thunderstore"
    fileId: number | null
    name: string
    version: string
    author: string
    picture: string | null
    summary: string | null
    enabled: boolean
    order: number
    installedAt: number
    sizeBytes: number
    pageUrl: string
    deployPrefix: string
    deployReason: string
    deployConfidence: "high" | "medium" | "low" | "manual" | string
    deployBlocked: boolean
  }

  type ModLoaderCompatibility = {
    id: "mod-engine-3" | "lennys-mod-loader" | "melonloader" | "fluffy" | string
    name: string
    compatible: boolean
    reason: string
  }

  type ModGameState = {
    ok: boolean
    error?: string
    nexusDomain?: string | null
    nexusDomainAuto?: boolean
    steamAppid?: number | null
    workshopSupported?: boolean
    thunderstoreCommunity?: string | null
    thunderstoreCommunityAuto?: boolean
    thunderstoreSupported?: boolean
    deployTarget?: string
    deployed?: boolean
    loaderCompatibility?: ModLoaderCompatibility[]
    mods?: ModEntry[]
  }

  type BrowseMod = {
    remoteId: string
    name: string
    author?: string
    picture?: string | null
    downloads?: number
    endorsements?: number
    installed?: boolean
  }

  type NexusModFile = {
    fileId: number
    name: string
    version?: string
    sizeBytes?: number
    category?: string
    uploadedAt?: number
    description?: string
  }

  type WorkshopBrowseItem = {
    remoteId: string
    name: string
    author?: string
    picture?: string | null
  }

  type ThunderstoreCommunity = {
    identifier: string
    name: string
  }

  type ThunderstoreVersion = {
    version: string
    sizeBytes?: number
    uploadedAt?: number
    dependencyCount?: number
    description?: string
  }

  type ModInstallProgress = {
    appid: string
    modId: string
    name: string
    phase: "downloading" | "extracting" | "installing" | "done" | "error"
    progress: number | null
    error?: string
  }

  type ManagedSlipgateStatus = {
    ok: boolean
    dockerAvailable: boolean
    composeAvailable: boolean
    dockerVersion?: string
    composeVersion?: string
    installed: boolean
    running: boolean
    healthy: boolean
    url?: string | null
    version?: string
    flaresolverrOk: boolean
    recipes?: string[]
    slipgateImage: string
    flaresolverrImage: string
    error?: string | null
  }

  type WandGameMatch = {
    titleId: string
    gameId: string
    name: string
    slug: string
    platformId: string
    cheatCount: number
    pageUrl: string
  }

  type WandControl = {
    uuid: string
    target: string
    name: string
    category: string
    kind: string
  }

  type WandLookupResult = {
    ok: boolean
    supported: boolean
    game?: WandGameMatch | null
    error?: string
  }

  type WandTrainerResult = WandLookupResult & {
    authenticated?: boolean
    needsAuth?: boolean
    controls?: WandControl[]
  }

  interface Window {
    ucWindow?: {
      minimize: () => void
      maximize: () => void
      close: () => void
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
        headers?: Record<string, string>
        update?: boolean
        installMetadata?: Record<string, unknown>
      }) => Promise<{ ok: boolean; queued?: boolean; error?: string }>
      cancel: (downloadId: string) => Promise<{ ok: boolean; status?: DownloadUpdatePayload["status"]; preservedArchive?: boolean; error?: string; downloadId?: string; appid?: string | null }>
      pause: (downloadId: string) => Promise<{ ok: boolean }>
      resume: (downloadId: string) => Promise<{ ok: boolean }>
      openPath: (path: string) => Promise<{ ok: boolean }>
      getDownloadPath: () => Promise<{ path: string }>
      pickDownloadPath: () => Promise<{ ok: boolean; path?: string }>
      loadPersistedState: () => Promise<{ ok: boolean; downloads: any[]; error?: string }>
      savePersistedState: (downloads: any[]) => Promise<{ ok: boolean; count?: number; error?: string }>
      loadCatalogState: () => Promise<{ ok: boolean; games: any[]; stats: Record<string, { downloads: number; views: number }>; updatedAt: number; gamesUpdatedAt: number; statsUpdatedAt: number; error?: string }>
      saveCatalogState: (payload: { games: any[]; gamesUpdatedAt?: number }) => Promise<{ ok: boolean; games?: number; updatedAt?: number; error?: string }>
      listLibrary: () => Promise<{ installed: any[]; installing: any[] }>
      listInstalled: () => Promise<any[]>
      listInstalledAppids: () => Promise<string[]>
      getInstalled: (appid: string) => Promise<any | null>
      listInstalling: () => Promise<any[]>
      getInstalling: (appid: string) => Promise<any | null>
      listGameExecutables: (appid: string) => Promise<{ ok: boolean; folder?: string; exes: { name: string; path: string; size?: number; depth?: number }[]; error?: string }>
      findGameSubfolder: (folder: string) => Promise<string | null>
      preflightGameLaunch: (appid: string, exePath: string) => Promise<{
        ok: boolean
        canLaunch: boolean
        checks: Array<{ level: 'error' | 'warning' | 'info'; code: string; message: string }>
        resolved?: { command: string; args: string[]; cwd: string } | null
      }>
      launchGameExecutable: (appid: string, exePath: string, gameName?: string, showGameName?: boolean, runAsAdmin?: boolean) => Promise<{
        ok: boolean
        error?: string
        pid?: number
        elevated?: boolean
        requiresElevation?: boolean
        elevationCancelled?: boolean
      }>
      listRunningGameAppids: () => Promise<{ ok: boolean; appids: string[] }>
      quitGameExecutable: (appid: string) => Promise<{ ok: boolean; stopped?: boolean }>
      deleteInstalled: (appid: string) => Promise<{ ok: boolean }>
      deleteInstalling: (appid: string) => Promise<{ ok: boolean }>
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
      }) => Promise<{ ok: boolean; downloadId?: string; extracted?: number; error?: string; code?: string;  }>
      installDownloadedArchive: (appid: string) => Promise<{ ok: boolean; downloadId?: string; extracted?: number; error?: string; code?: string;  }>
      deleteArchiveFiles: (payload: { archivePaths: string[] }) => Promise<{ ok: boolean; deletedCount?: number; error?: string }>
      browseForGameExe: (defaultPath?: string) => Promise<{ ok: boolean; path?: string }>
      importExe: (exePath: string, name?: string) => Promise<{ ok: boolean; appid?: string; name?: string; exePath?: string; existed?: boolean; steamAppId?: number | null; error?: string }>
      importSetSteamAppId: (appid: string, steamAppid: number) => Promise<{ ok: boolean }>
      importCustomImage: (path: string) => Promise<{ ok: boolean; url?: string; error?: string }>
      steamLibraryScan: () => Promise<{ ok: boolean; steamFound?: boolean; found: boolean; apps: SteamScannedApp[] }>
      steamLibraryImport: (apps: Array<Pick<SteamScannedApp, "steamAppId" | "name" | "installPath" | "sizeBytes">>) => Promise<{ ok: boolean; imported: number; errors: Array<{ name: string; error: string }> }>
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
      mergeLibraryGameMeta: (appid: string, patch: Record<string, unknown>, playTimeDeltaMs?: number) => Promise<{ ok: boolean; entry: Record<string, unknown> }>
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
        bodyText?: string
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
      onUpdateProgress: (callback: (data: { phase: "downloading" | "installing"; received: number; total?: number | null }) => void) => () => void
    }
    ucLogs?: {
      log: (level: string, message: string, data?: any) => Promise<void>
    }
    ucAutostart?: {
      get: () => Promise<{ ok: boolean; enabled: boolean }>
      set: (enabled: boolean) => Promise<{ ok: boolean; enabled?: boolean; error?: string }>
    }
    ucDialogs?: {
      pickFolder: () => Promise<{ ok: boolean; path?: string }>
    }
    ucLinux?: {
      detectProton: () => Promise<{ ok: boolean; versions: Array<{ label: string; path: string; source?: 'steam' | 'protonplus' | 'community'; newest?: boolean }>; autoApplied?: boolean; appliedVersion?: { label: string; path: string }; error?: string }>
      pickPrefixDir: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      pickBinary: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
      getGameConfig: (appid: string) => Promise<{ ok: boolean; config: GameLinuxConfig; error?: string }>
      setGameConfig: (appid: string, config: GameLinuxConfig | null) => Promise<{ ok: boolean; error?: string }>
    }
    ucStorage?: {
      precheck: (opts: { targetPath?: string; downloadBytes: number; declaredInstallBytes?: number }) => Promise<StoragePrecheckResult>
    }
    ucPresence?: {
      onChanged?: (handler: (detail: { reason?: string; appid?: string | null; gameName?: string | null; startedAt?: number; activityRecorded?: boolean }) => void) => () => void
    }
    ucSystem?: {
      openExternal?: (target: string) => Promise<{ ok: boolean; error?: string }>
      launchSteam?: () => Promise<{ ok: boolean; method?: string; error?: string }>
      runSteamGame?: (appid: string, steamAppid: number, installPath: string) => Promise<{ ok: boolean; error?: string }>
    }
    ucWand?: {
      lookup: (title: string, steamAppid?: number) => Promise<WandLookupResult>
      connect: () => Promise<{ ok: boolean; error?: string }>
      disconnect: () => Promise<{ ok: boolean }>
      trainer: (title: string, steamAppid?: number) => Promise<WandTrainerResult>
      launch: (appid: string, title: string, steamAppid?: number) => Promise<{ ok: boolean; game?: WandGameMatch; needsAuth?: boolean; error?: string }>
      control: (appid: string, name: string, value: number) => Promise<{ ok: boolean; error?: string }>
      stop: (appid: string) => Promise<{ ok: boolean }>
      onRuntime: (callback: (data: { appid: string; status: "active" | "value" | "error" | "stopped"; name?: string; value?: number; message?: string }) => void) => () => void
      onAuthChanged: (callback: (data: { ok: boolean; error?: string }) => void) => () => void
    }
    ucAchievements?: {
      list: () => Promise<{ ok: boolean; games: LocalAchievementGame[]; error?: string }>
      testNotification: () => Promise<{ ok: boolean; error?: string }>
      hideToast: () => Promise<{ ok: boolean }>
      onUnlocked: (callback: (data: LocalAchievementUnlock) => void) => () => void
      onUpdated: (callback: (data: { reason?: string }) => void) => () => void
      onToast: (callback: (data: LocalAchievementUnlock) => void) => () => void
    }
    ucSources?: {
      list: () => Promise<{ ok: boolean; sources: SourceInfo[]; error?: string }>
      setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
      search: (query: string, limit?: number) => Promise<{ ok: boolean; games: UnifiedSourceGame[]; error?: string }>
      detail: (sources: Array<{ sourceId: string; sourceSlug: string }>) => Promise<{ ok: boolean; game: UnifiedSourceGame | null; error?: string }>
      resolve: (sourceId: string, option: SourceDownloadOption) => Promise<{ ok: boolean; result: SourceResolveResult; error?: string }>
      steamArt: (appid: number, name?: string) => Promise<{ ok: boolean; art: { header: string; background: string; cover?: string } }>
      protondb: (appid: number) => Promise<{ ok: boolean; data: ProtonDbSummary | null }>
      refresh: () => Promise<{ ok: boolean; error?: string }>
      onRefreshProgress: (cb: (p: { state: "start" | "fetching" | "done" | "failed" | "complete"; id?: string; name?: string; index?: number; total: number; games?: number | null; ms?: number; etaMs?: number; sources?: Array<{ id: string; name: string }> }) => void) => () => void
      onSourcesUpdated: (cb: (p: unknown) => void) => () => void
      steamMeta: (appid: number) => Promise<{ ok: boolean; meta: SteamMeta }>
      query: (params: SourceQueryParams, reqId?: number) => Promise<SourceQueryResult>
      cancelQuery: (reqId: number) => Promise<{ ok: boolean }>
      onBrowsePartial: (cb: (payload: { reqId: number; games: UnifiedSourceGame[]; total: number; doneSources: string[]; failedSources: string[] }) => void) => () => void
      capabilities: (sourceIds?: string[]) => Promise<{ ok: boolean; capabilities: SourceCapabilityReport; error?: string }>
      onlinefixStatus: () => Promise<{ ok: boolean; enabled: boolean; available: boolean; error?: string }>
      onlinefixSetEnabled: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>
      onlinefixRepair: (appid: string, title: string) => Promise<{ ok: boolean; error?: string }>
      onRepairProgress: (cb: (p: RepairProgress) => void) => () => void
    }
    ucAssets?: {
      size: () => Promise<{ ok: boolean; bytes: number; error?: string }>
      clear: () => Promise<{ ok: boolean; freed: number; error?: string }>
    }
    ucMods?: {
      gameGet?: (appid: string) => Promise<ModGameState>
      gameSet?: (appid: string, config: { nexusDomain?: string | null; deployTarget?: string; thunderstoreCommunity?: string | null }) => Promise<{ ok: boolean; error?: string }>
      deployTargetPick?: (appid: string) => Promise<{ ok: boolean; target?: string; error?: string }>
      toggle?: (appid: string, modId: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
      reorder?: (appid: string, orderedIds: string[]) => Promise<{ ok: boolean; error?: string }>
      uninstall?: (appid: string, modId: string) => Promise<{ ok: boolean; error?: string }>
      deploy?: (appid: string) => Promise<{ ok: boolean; fileCount?: number; error?: string }>
      undeploy?: (appid: string) => Promise<{ ok: boolean; error?: string }>
      openFolder?: (appid: string) => Promise<{ ok: boolean; error?: string }>
      nexusValidate?: () => Promise<{ ok: boolean; user?: { name: string; premium: boolean; profileUrl?: string }; error?: string }>
      nexusSearch?: (domain: string, query: string, page: number) => Promise<{ ok: boolean; mods?: BrowseMod[]; hasMore?: boolean; error?: string }>
      nexusBrowse?: (domain: string, sort: string, order: string, period: string, offset: number) => Promise<{ ok: boolean; mods?: BrowseMod[]; hasMore?: boolean; total?: number; offset?: number; error?: string }>
      nexusModFiles?: (domain: string, modId: string) => Promise<{ ok: boolean; files?: NexusModFile[]; error?: string }>
      nexusInstall?: (appid: string, domain: string, modId: string, fileId: number) => Promise<{ ok: boolean; started?: boolean; needsNxm?: boolean; needsSession?: boolean; sessionError?: string; slipgateError?: string; modPageUrl?: string; error?: string }>
      slipgateCheck?: (url: string, key: string) => Promise<{ ok: boolean; version?: string; flaresolverrOk?: boolean; recipes?: string[]; error?: string }>
      managedSlipgateStatus?: () => Promise<ManagedSlipgateStatus>
      managedSlipgateInstall?: () => Promise<ManagedSlipgateStatus>
      managedSlipgateStart?: () => Promise<ManagedSlipgateStatus>
      managedSlipgateStop?: () => Promise<ManagedSlipgateStatus>
      managedSlipgateUpdate?: () => Promise<ManagedSlipgateStatus>
      managedSlipgateUninstall?: () => Promise<ManagedSlipgateStatus>
      workshopBrowse?: (steamAppid: number, sort: string, period: string, page: number, query: string) => Promise<{ ok: boolean; items?: WorkshopBrowseItem[]; hasMore?: boolean; error?: string }>
      workshopInstall?: (appid: string, steamAppid: number, publishedFileId: string) => Promise<{ ok: boolean; started?: boolean; error?: string }>
      workshopStatus?: () => Promise<{ ok: boolean; steamcmd?: "absent" | "bootstrapping" | "ready"; error?: string }>
      thunderstoreCommunities?: () => Promise<{ ok: boolean; communities?: ThunderstoreCommunity[]; error?: string }>
      thunderstoreBrowse?: (community: string, sort: string, period: string, page: number, query: string) => Promise<{ ok: boolean; mods?: BrowseMod[]; hasMore?: boolean; error?: string }>
      thunderstoreVersions?: (community: string, fullName: string) => Promise<{ ok: boolean; versions?: ThunderstoreVersion[]; error?: string }>
      thunderstoreInstall?: (appid: string, community: string, fullName: string, version: string) => Promise<{ ok: boolean; started?: boolean; error?: string }>
      onInstallProgress?: (callback: (data: ModInstallProgress) => void) => () => void
      onChanged?: (callback: (data: { appid: string }) => void) => () => void
      onNxmUnmatched?: (callback: (data: { domain: string; modId: string }) => void) => () => void
    }
  }
}

export { }
