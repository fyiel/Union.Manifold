import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

type Cb = (payload: any) => void

function on(event: string, cb: Cb): () => void {
  let unlisten = () => {}
  let cancelled = false
  listen(event, (e) => cb((e as any).payload)).then((fn) => {
    if (cancelled) fn()
    else unlisten = fn
  })
  return () => {
    cancelled = true
    unlisten()
  }
}

function call<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args).catch((err) => {
    throw err instanceof Error ? err : new Error(String(err))
  })
}

const noop = () => () => {}

function apiBaseUrl(): string {
  try {
    return (
      localStorage.getItem("uc_custom_api_base_url") ||
      localStorage.getItem("uc_detected_api_base_url") ||
      "https://union-crax.xyz"
    )
  } catch {
    return "https://union-crax.xyz"
  }
}

export function installBridge(): void {
  const w = window as any

  w.ucWindow = {
    minimize: () => call("window_minimize"),
    maximize: () => call("window_maximize"),
    close: () => call("window_close"),
    isMaximized: () => call<boolean>("window_is_maximized"),
  }

  w.ucDownloads = {
    start: (payload: any) => call("download_start", { payload }),
    resumeWithFreshUrl: (payload: any) => call("download_start", { payload }),
    cancel: (downloadId: string) => call("download_cancel", { downloadId }),
    pause: (downloadId: string) => call("download_pause", { downloadId }),
    resume: (downloadId: string) => call("download_resume", { downloadId }),
    showInFolder: (path: string) => call("download_show", { path }),
    openPath: (path: string) => call("download_open", { path }),
    getDownloadPath: () => call("download_path_get"),
    setDownloadPath: (targetPath: string) => call("download_path_set", { targetPath }),
    pickDownloadPath: () => call("download_path_pick"),
    loadPersistedState: () => call("downloads_state_load"),
    savePersistedState: (downloads: any[]) => call("downloads_state_save", { downloads }),
    loadCatalogState: () => call("catalog_state_load"),
    saveCatalogState: (payload: any) => call("catalog_state_save", { payload }),
    listInstalled: () => call("installed_list"),
    getInstalled: (appid: string) => call("installed_get", { appid }),
    listInstalling: () => call("installing_list"),
    getInstalling: (appid: string) => call("installing_get", { appid }),
    listInstalledGlobal: () => call("installed_list"),
    getInstalledGlobal: (appid: string) => call("installed_get", { appid }),
    listInstallingGlobal: () => call("installing_list"),
    getInstallingGlobal: (appid: string) => call("installing_get", { appid }),
    listGameExecutables: (appid: string) => call("game_exe_list", { appid }),
    findGameSubfolder: (folder: string) => call("game_subfolder_find", { folder }),
    preflightGameLaunch: (appid: string, exePath: string) =>
      call("game_exe_preflight", { appid, exePath }),
    launchGameExecutable: (appid: string, exePath: string, gameName?: string, showGameName?: boolean, runAsAdmin?: boolean) =>
      call("game_exe_launch", { appid, exePath, gameName, showGameName, runAsAdmin }),
    listRunningGameAppids: () => call("game_exe_running_list"),
    quitGameExecutable: (appid: string) => call("game_exe_quit", { appid }),
    deleteInstalled: (appid: string) => call("installed_delete", { appid }),
    deleteInstalling: (appid: string) => call("installing_delete", { appid }),
    dismissInstalling: (appid: string) => call("installing_dismiss", { appid }),
    saveInstalledMetadata: (appid: string, metadata: any) =>
      call("installed_save", { appid, metadata }),
    setInstallingStatus: (appid: string, status: string, error?: string | null) =>
      call("installing_status_set", { appid, status, error }),
    getActiveStatus: (appid: string) => call("download_active_status", { appid }),
    createDesktopShortcut: (gameName: string, appid: string, exePath?: string) =>
      call("create_desktop_shortcut", { gameName, appid, exePath }),
    deleteDesktopShortcut: (gameName: string) => call("delete_desktop_shortcut", { gameName }),
    updateInstalledMetadata: (appid: string, updates: any) =>
      call("installed_update_metadata", { appid, updates }),
    pickImage: () => call("pick_image"),
    pickArchiveFiles: () => call("pick_archive_files"),
    statArchiveFiles: (paths: string[]) => call("archive_files_stat", { paths }),
    onFileDrop: (cb: Cb) => on("tauri://drag-drop", cb),
    onFileDragEnter: (cb: Cb) => on("tauri://drag-enter", cb),
    onFileDragLeave: (cb: Cb) => on("tauri://drag-leave", cb),
    installFromArchive: (payload: any) => call("install_from_archive", { payload }),
    installDownloadedArchive: (appid: string) => call("install_downloaded_archive", { appid }),
    deleteArchiveFiles: (payload: any) => call("delete_archive_files", { payload }),
    browseForGameExe: (defaultPath?: string) => call("browse_for_game_exe", { defaultPath }),
    importExe: (exePath: string, name?: string) => call("import_exe", { exePath, name }),
    importSetSteamAppId: (appid: string, steamAppid: number) => call("import_set_steam_appid", { appid, steamAppid }),
    importCustomImage: (path: string) => call("custom_image_import", { path }),
    steamLibraryScan: () => call("steam_library_scan"),
    steamLibraryImport: (apps: Array<{ steamAppId: number; name: string; installPath?: string; sizeBytes?: number }>) =>
      call("steam_library_import", { apps }),
    onUpdate: (cb: Cb) => on("uc:download-update", cb),
    onBlocked: (cb: Cb) => on("uc:download-blocked", cb),
    onGameQuickExit: (cb: Cb) => on("uc:game-quick-exit", cb),
    onArchiveDeletePrompt: (cb: Cb) => on("uc:archive-delete-prompt", cb),
  }

  w.ucApp = {
    respondToCloseRequest: (shouldProceed: boolean) =>
      call("app_close_response", { shouldProceed }),
    onCloseRequest: (cb: Cb) => on("uc:app-close-requested", cb),
    onNavigationAction: (cb: Cb) => on("uc:navigation-action", cb),
    getBaseUrl: () => apiBaseUrl(),
  }

  w.ucSettings = {
    get: (key: string) => call("setting_get", { key }),
    set: (key: string, value: any) => call("setting_set", { key, value }),
    mergeLibraryGameMeta: (appid: string, patch: Record<string, unknown>, playTimeDeltaMs?: number) =>
      call("setting_merge_library_game_meta", { appid, patch, playTimeDeltaMs }),
    clearAll: () => call("setting_clear_all"),
    onChanged: (cb: Cb) => on("uc:setting-changed", cb),
  }

  w.ucThemeEditor = {
    open: (seed: any) => call("theme_editor_open", { seed }),
    close: () => call("theme_editor_close"),
    sendPreview: (theme: any) => call("theme_preview", { theme }),
    endPreview: () => call("theme_preview_end"),
    onSeed: (cb: Cb) => on("uc:theme-editor-seed", cb),
    onPreview: (cb: Cb) => on("uc:theme-preview", cb),
    onPreviewEnd: (cb: Cb) => on("uc:theme-preview-end", () => (cb as any)()),
  }

  w.ucAuth = {
    fetch: (baseUrl: string, path: string, init?: any) =>
      call("auth_fetch", { baseUrl, path, init }),
  }

  w.ucUpdater = {
    checkForUpdates: () => call("check_for_updates"),
    installUpdate: () => call("install_update"),
    getVersion: () => call("get_version"),
    onUpdateAvailable: (cb: Cb) => on("uc:update-available", cb),
    onUpdateProgress: (cb: Cb) => on("uc:update-progress", cb),
  }

  w.ucLogs = {
    log: (level: string, message: string, data?: any) => call("log", { level, message, data }),
  }

  w.ucAutostart = {
    get: () => call("autostart_get"),
    set: (enabled: boolean) => call("autostart_set", { enabled }),
  }

  w.ucDialogs = {
    pickFolder: () => call("folder_pick"),
  }

  w.ucLinux = {
    detectProton: () => call("linux_detect_proton"),
    pickPrefixDir: () => call("linux_pick_prefix_dir"),
    pickBinary: () => call("linux_pick_binary"),
    getGameConfig: (appid: string) => call("game_linux_config_get", { appid }),
    setGameConfig: (appid: string, config: any) => call("game_linux_config_set", { appid, config }),
  }

  w.ucStorage = {
    precheck: (opts: any) => call("storage_precheck", { opts }),
    summary: (targetPath?: string) => call("storage_summary", { targetPath }),
    snapshot: () => call("storage_snapshot"),
  }

  w.ucSystem = {
    openExternal: (target: string) => call("system_open_external", { target }),
    launchSteam: () => call("system_launch_steam"),
    runSteamGame: (appid: string, steamAppid: number, installPath: string) =>
      call("steam_game_run", { appid, steamAppid, installPath }),
    getNotifications: () => call("system_notifications"),
    onNotificationActivated: noop,
  }

  w.ucWand = {
    status: () => call("wand_status"),
    lookup: (title: string, steamAppid?: number) => call("wand_lookup", { title, steamAppid }),
    connect: () => call("wand_auth_begin"),
    disconnect: () => call("wand_disconnect"),
    trainer: (title: string, steamAppid?: number) => call("wand_trainer", { title, steamAppid }),
    launch: (appid: string, title: string, steamAppid?: number) => call("wand_launch", { appid, title, steamAppid }),
    control: (appid: string, name: string, value: number) => call("wand_control", { appid, name, value }),
    stop: (appid: string) => call("wand_stop", { appid }),
    onRuntime: (cb: Cb) => on("uc:wand-runtime", cb),
    onAuthChanged: (cb: Cb) => on("uc:wand-auth-changed", cb),
  }

  w.ucAchievements = {
    list: () => call("achievements_list"),
    testNotification: () => call("achievements_test_notification"),
    hideToast: () => call("achievements_toast_hide"),
    onUnlocked: (cb: Cb) => on("uc:achievement-unlocked", cb),
    onUpdated: (cb: Cb) => on("uc:achievements-updated", cb),
    onToast: (cb: Cb) => on("uc:achievement-toast", cb),
  }

  w.ucSources = {
    list: () => call("sources_list"),
    setEnabled: (id: string, enabled: boolean) => call("sources_set_enabled", { id, enabled }),
    search: (query: string, limit?: number) => call("sources_search", { query, limit }),
    catalog: (offset?: number, limit?: number) => call("sources_catalog", { offset, limit }),
    detail: (sources: any[]) => call("sources_detail", { sources }),
    resolve: (sourceId: string, option: any) => call("sources_resolve", { sourceId, option }),
    steamArt: (appid: number, name?: string) => call("sources_steam_art", { appid, name }),
    protondb: (appid: number) => call("sources_protondb", { appid }),
    refresh: () => call("sources_refresh"),
    onRefreshProgress: (cb: Cb) => on("uc:sources-refresh", cb),
    onSourcesUpdated: (cb: Cb) => on("uc:sources-updated", cb),
    steamMeta: (appid: number) => call("sources_steam_meta", { appid }),
    query: (params: any, reqId?: number) => call("sources_query", { params, reqId }),
    onBrowsePartial: (cb: Cb) => on("uc:browse-partial", cb),
    capabilities: (sourceIds?: string[]) => call("sources_capabilities", { sourceIds }),
    tags: () => call("sources_tags"),
    onlinefixStatus: () => call("sources_onlinefix_status"),
    onlinefixSetEnabled: (enabled: boolean) => call("sources_onlinefix_set_enabled", { enabled }),
    onlinefixRepair: (appid: string, title: string) => call("onlinefix_repair", { appid, title }),
    onRepairProgress: (cb: Cb) => on("uc:repair-progress", cb),
  }

  w.ucAssets = {
    size: () => call("assets_size"),
    clear: () => call("assets_clear"),
  }

  w.ucPresence = {
    heartbeat: () => call("presence_heartbeat"),
    onChanged: (cb: Cb) => on("uc:presence-changed", cb),
  }

  w.ucController = {
    getSettings: async () => {
      const settings = await call("setting_get", { key: "controllerSettings" })
      return { ok: true, settings: settings ?? undefined }
    },
    setSettings: async (settings: any) => {
      await call("setting_set", { key: "controllerSettings", value: settings })
      return { ok: true }
    },
  }
  w.ucMods = {
    gameGet: (appid: string) => call("mods_game_get", { appid }),
    gameSet: (appid: string, config: { nexusDomain?: string | null; deployTarget?: string; thunderstoreCommunity?: string | null }) => call("mods_game_set", { appid, config }),
    deployTargetPick: (appid: string) => call("mods_deploy_target_pick", { appid }),
    toggle: (appid: string, modId: string, enabled: boolean) => call("mods_toggle", { appid, modId, enabled }),
    reorder: (appid: string, orderedIds: string[]) => call("mods_reorder", { appid, orderedIds }),
    uninstall: (appid: string, modId: string) => call("mods_uninstall", { appid, modId }),
    deploy: (appid: string) => call("mods_deploy", { appid }),
    undeploy: (appid: string) => call("mods_undeploy", { appid }),
    openFolder: (appid: string) => call("mods_open_folder", { appid }),
    nexusValidate: () => call("nexus_validate"),
    nexusSearch: (domain: string, query: string, page: number) => call("nexus_search", { domain, query, page }),
    nexusBrowse: (domain: string, sort: string, order: string, period: string, offset: number) => call("nexus_browse", { domain, sort, order, period, offset }),
    nexusModFiles: (domain: string, modId: string) => call("nexus_mod_files", { domain, modId }),
    nexusInstall: (appid: string, domain: string, modId: string, fileId: number) => call("nexus_install", { appid, domain, modId, fileId }),
    slipgateCheck: (url: string, key: string) => call("slipgate_check", { url, key }),
    managedSlipgateStatus: () => call("managed_slipgate_status"),
    managedSlipgateInstall: () => call("managed_slipgate_install"),
    managedSlipgateStart: () => call("managed_slipgate_start"),
    managedSlipgateStop: () => call("managed_slipgate_stop"),
    managedSlipgateUpdate: () => call("managed_slipgate_update"),
    managedSlipgateUninstall: () => call("managed_slipgate_uninstall"),
    workshopBrowse: (steamAppid: number, sort: string, period: string, page: number, query: string) => call("workshop_browse", { steamAppid, sort, period, page, query }),
    workshopDetails: (ids: string[]) => call("workshop_details", { ids }),
    workshopInstall: (appid: string, steamAppid: number, publishedFileId: string) => call("workshop_install", { appid, steamAppid, publishedFileId }),
    workshopStatus: () => call("workshop_status"),
    thunderstoreCommunities: () => call("thunderstore_communities"),
    thunderstoreBrowse: (community: string, sort: string, period: string, page: number, query: string) => call("thunderstore_browse", { community, sort, period, page, query }),
    thunderstoreVersions: (community: string, fullName: string) => call("thunderstore_versions", { community, fullName }),
    thunderstoreInstall: (appid: string, community: string, fullName: string, version: string) => call("thunderstore_install", { appid, community, fullName, version }),
    onInstallProgress: (cb: Cb) => on("mods:install-progress", cb),
    onChanged: (cb: Cb) => on("mods:changed", cb),
    onNxmUnmatched: (cb: Cb) => on("mods:nxm-unmatched", cb),
  }
}
