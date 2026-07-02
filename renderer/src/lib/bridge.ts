import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

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

const disabled = () => Promise.resolve({ ok: false, error: "disabled in this build" })
const okFalse = () => Promise.resolve({ ok: true, found: false })
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
    onMaximizeChange: (cb: (v: boolean) => void) => {
      const win = getCurrentWindow()
      let unlisten = () => {}
      win.onResized(() => {
        win.isMaximized().then(cb)
      }).then((fn) => (unlisten = fn))
      return () => unlisten()
    },
  }

  w.ucDownloads = {
    start: (payload: any) => call("download_start", { payload }),
    smartStart: (payload: any) => call("download_smart_start", { payload }),
    resumeInterrupted: (payload: any) => call("download_start", { payload }),
    resumeWithFreshUrl: (payload: any) => call("download_start", { payload }),
    cancel: (downloadId: string) => call("download_cancel", { downloadId }),
    pause: (downloadId: string) => call("download_pause", { downloadId }),
    resume: (downloadId: string) => call("download_resume", { downloadId }),
    showInFolder: (path: string) => call("download_show", { path }),
    openPath: (path: string) => call("download_open", { path }),
    listDisks: () => call("disk_list"),
    getDownloadPath: () => call("download_path_get"),
    setDownloadPath: (targetPath: string) => call("download_path_set", { targetPath }),
    pickDownloadPath: () => call("download_path_pick"),
    getDownloadUsage: (targetPath?: string) =>
      Promise.resolve({ ok: true, sizeBytes: 0, path: targetPath || "" }),
    clearDownloadCache: () => Promise.resolve({ ok: true }),
    loadPersistedState: () => call("downloads_state_load"),
    savePersistedState: (downloads: any[]) => call("downloads_state_save", { downloads }),
    loadCatalogState: () => call("catalog_state_load"),
    saveCatalogState: (payload: any) => call("catalog_state_save", { payload }),
    listInstalled: () => call("installed_list"),
    getInstalled: (appid: string) => call("installed_get", { appid }),
    listInstalledByAppid: (appid: string) => call("installed_list_by_appid", { appid }),
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
    launchGameExecutable: (appid: string, exePath: string, gameName?: string, showGameName?: boolean) =>
      call("game_exe_launch", { appid, exePath, gameName, showGameName }),
    getRunningGame: (appid: string) => call("game_exe_running", { appid }),
    listRunningGameAppids: () => call("game_exe_running_list"),
    quitGameExecutable: (appid: string) => call("game_exe_quit", { appid }),
    deleteInstalled: (appid: string) => call("installed_delete", { appid }),
    deleteInstalling: (appid: string) => call("installing_delete", { appid }),
    createUpdateBackup: (appid: string) => call("installed_backup_create", { appid }),
    dismissInstalling: (appid: string) => call("installing_dismiss", { appid }),
    saveInstalledMetadata: (appid: string, metadata: any) =>
      call("installed_save", { appid, metadata }),
    setInstallingStatus: (appid: string, status: string, error?: string | null) =>
      call("installing_status_set", { appid, status, error }),
    getActiveStatus: (appid: string) => call("download_active_status", { appid }),
    createDesktopShortcut: (gameName: string, appid: string, exePath?: string) =>
      call("create_desktop_shortcut", { gameName, appid, exePath }),
    deleteDesktopShortcut: (gameName: string) => call("delete_desktop_shortcut", { gameName }),
    addExternalGame: (appid: string, metadata: any, gamePath: string) =>
      call("add_external_game", { appid, metadata, gamePath }),
    updateInstalledMetadata: (appid: string, updates: any) =>
      call("installed_update_metadata", { appid, updates }),
    pickExternalGameFolder: () => call("pick_external_game_folder"),
    pickImage: () => call("pick_image"),
    pickArchiveFiles: () => call("pick_archive_files"),
    installFromArchive: (payload: any) => call("install_from_archive", { payload }),
    installDownloadedArchive: (appid: string) => call("install_downloaded_archive", { appid }),
    deleteArchiveFiles: (payload: any) => call("delete_archive_files", { payload }),
    browseForGameExe: (defaultPath?: string) => call("browse_for_game_exe", { defaultPath }),
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
    onMirrorAuthBlocked: (cb: Cb) => on("uc:mirror-auth-blocked", cb),
    getBaseUrl: () => apiBaseUrl(),
  }

  w.ucSettings = {
    get: (key: string) => call("setting_get", { key }),
    set: (key: string, value: any) => call("setting_set", { key, value }),
    clearAll: () => call("setting_clear_all"),
    exportSettings: () => call("settings_export"),
    importSettings: () => call("settings_import"),
    runNetworkTest: (baseUrl?: string) => call("network_test", { baseUrl }),
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
    upload: (baseUrl: string, path: string, payload: any) =>
      call("auth_upload", { baseUrl, path, payload }),
    login: disabled,
    logout: disabled,
    getSession: () => Promise.resolve({ ok: false }),
    websiteLogin: disabled,
    emailLogin: disabled,
    register: disabled,
    forgotPassword: disabled,
    resetPassword: disabled,
    verifyEmail: disabled,
    getMe: disabled,
    linkProvider: disabled,
    unlinkProvider: disabled,
    updateProfile: disabled,
    updatePassword: disabled,
  }

  w.ucUpdater = {
    checkForUpdates: () => call("check_for_updates"),
    installUpdate: () => call("install_update"),
    getVersion: () => call("get_version"),
    getChangelog: () => call("get_changelog"),
    getUpdateStatus: () => call("get_update_status"),
    retryUpdate: () => call("update_retry"),
    onStatusChanged: (cb: Cb) => on("uc:update-status-changed", cb),
  }

  w.ucLogs = {
    log: (level: string, message: string, data?: any) => call("log", { level, message, data }),
    getLogs: () => call("logs_get"),
    clearLogs: () => call("logs_clear"),
    openLogsFolder: () => call("logs_open_folder"),
    shareLogs: disabled,
  }

  w.ucLinux = {
    detectProton: () => call("linux_detect_proton"),
    detectWine: () => call("linux_detect_wine"),
    detectUmu: () => call("linux_detect_umu"),
    runWinecfg: disabled,
    runWinetricks: disabled,
    runProtontricks: disabled,
    createPrefix: disabled,
    pickPrefixDir: () => call("linux_pick_prefix_dir"),
    pickBinary: () => call("linux_pick_binary"),
    pickSo: () => Promise.resolve({ ok: true, cancelled: true }),
    checkTool: (toolName: string) => call("linux_check_tool", { toolName }),
    getSteamPath: () => call("linux_get_steam_path"),
    getGameConfig: (appid: string) => call("game_linux_config_get", { appid }),
    setGameConfig: (appid: string, config: any) => call("game_linux_config_set", { appid, config }),
    detectSLSSteam: () => Promise.resolve({ ok: true, found: false }),
    slsSteamDownload: disabled,
    slsSteamSetupGame: disabled,
    slsSteamCheckGame: () => Promise.resolve({ ok: true, found: false }),
  }

  w.ucVR = {
    detectSteamVR: okFalse,
    detectOpenXR: okFalse,
    launchSteamVR: disabled,
    pickRuntimeJson: () => Promise.resolve({ ok: true, cancelled: true }),
    pickSteamVRDir: () => Promise.resolve({ ok: true, cancelled: true }),
    getSettings: () => Promise.resolve({ ok: true }),
  }

  w.ucStorage = {
    precheck: (opts: any) => call("storage_precheck", { opts }),
    summary: (targetPath?: string) => call("storage_summary", { targetPath }),
    snapshot: () => call("storage_snapshot"),
  }

  w.ucSystem = {
    openExternal: (target: string) => call("system_open_external", { target }),
    launchSteam: () => call("system_launch_steam"),
    getVolume: () => Promise.resolve({ ok: true, volume: 100 }),
    setVolume: () => Promise.resolve({ ok: true }),
    getMuted: () => Promise.resolve({ ok: true, muted: false }),
    setMuted: () => Promise.resolve({ ok: true }),
    takeScreenshot: () => Promise.resolve({ ok: false }),
    getScreenshotPath: () => Promise.resolve({ ok: true, path: "" }),
    listScreenshots: () => Promise.resolve({ ok: true, screenshots: [] }),
    deleteScreenshot: () => Promise.resolve({ ok: false }),
    openScreenshot: () => Promise.resolve({ ok: false }),
    getNotifications: () => call("system_notifications"),
    onNotificationActivated: noop,
  }

  w.ucSources = {
    list: () => call("sources_list"),
    setEnabled: (id: string, enabled: boolean) => call("sources_set_enabled", { id, enabled }),
    search: (query: string, limit?: number) => call("sources_search", { query, limit }),
    catalog: (offset?: number, limit?: number) => call("sources_catalog", { offset, limit }),
    detail: (sources: any[]) => call("sources_detail", { sources }),
    resolve: (sourceId: string, option: any) => call("sources_resolve", { sourceId, option }),
    steamArt: (appid: number) => call("sources_steam_art", { appid }),
    query: (params: any) => call("sources_query", { params }),
    capabilities: (sourceIds?: string[]) => call("sources_capabilities", { sourceIds }),
    tags: () => call("sources_tags"),
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
    getSettings: () =>
      Promise.resolve({
        ok: true,
        settings: {
          enabled: false,
          controllerType: "generic",
          vibrationEnabled: false,
          deadzone: 0.2,
          triggerDeadzone: 0.2,
          buttonLayout: "default",
        },
      }),
    setSettings: () => Promise.resolve({ ok: true }),
    getConnected: () =>
      Promise.resolve({ connected: false, controllerId: null, controllerName: null, controllerType: null }),
    getAvailable: () => Promise.resolve({ ok: true, controllers: [] }),
    getProfiles: () => Promise.resolve({ ok: true, profiles: [] }),
    getActiveProfile: () => Promise.resolve({ ok: true, profile: null }),
    getActiveMapping: () => Promise.resolve({ ok: true, mapping: null }),
    getMappingPresets: () => Promise.resolve({ ok: true, presets: [] }),
    getOverlaySettings: () => Promise.resolve({ ok: true }),
    setOverlaySettings: () => Promise.resolve({ ok: true }),
    createProfile: () => Promise.resolve({ ok: true }),
    updateProfile: () => Promise.resolve({ ok: true }),
    deleteProfile: () => Promise.resolve({ ok: true }),
    setActiveProfile: () => Promise.resolve({ ok: true }),
    setActiveMapping: () => Promise.resolve({ ok: true }),
    setSlot: () => Promise.resolve({ ok: true }),
    rumble: () => Promise.resolve({ ok: true }),
    onInput: noop,
    onControllerConnected: noop,
    onControllerDisconnected: noop,
  }

  w.ucOverlay = {
    show: () => Promise.resolve({ ok: false }),
    hide: () => Promise.resolve({ ok: false }),
    toggle: () => Promise.resolve({ ok: false, visible: false }),
    getStatus: () =>
      Promise.resolve({
        ok: true,
        enabled: false,
        visible: false,
        hotkey: "",
        autoShow: false,
        position: "right",
        toastDurationMs: 0,
        toastVertical: "bottom",
        currentAppid: null,
      }),
    getSettings: () =>
      Promise.resolve({
        ok: true,
        enabled: false,
        hotkey: "",
        autoShow: false,
        position: "right",
        toastDurationMs: 0,
        toastVertical: "bottom",
      }),
    getDiagnostics: () => Promise.resolve({ ok: true }),
    setSettings: () => Promise.resolve({ ok: true }),
    getGameInfo: () => Promise.resolve({ ok: false }),
    getRunningGames: () => Promise.resolve({ ok: true, games: [] }),
    getDownloads: () => Promise.resolve({ ok: true, downloads: [] }),
    pauseDownload: (downloadId: string) => call("download_pause", { downloadId }),
    resumeDownload: (downloadId: string) => call("download_resume", { downloadId }),
    onShow: noop,
    onHide: noop,
    onStateChanged: noop,
    onPositionChanged: noop,
    onDownloadUpdate: (cb: Cb) => on("uc:download-update", cb),
  }

  w.ucRpc = {
    setActivity: () => Promise.resolve({ ok: true }),
    clearActivity: () => Promise.resolve({ ok: true }),
    getStatus: () => Promise.resolve({ ok: true, enabled: false, ready: false, clientId: null }),
  }

  w.ucPlaytime = {
    localSummary: () => Promise.resolve({ ok: true }),
    pending: () => Promise.resolve({ ok: true, sessions: [] }),
    ack: () => Promise.resolve({ ok: true }),
    flush: () => Promise.resolve({ ok: true }),
    serverTotals: () => Promise.resolve({ ok: true }),
    onSessionRecorded: noop,
  }

  w.ucSystemProfile = {
    getCached: () => Promise.resolve({ ok: true, profile: null }),
    scan: () => Promise.resolve({ ok: false, error: "disabled in this build" }),
    summary: () => Promise.resolve({ ok: true, summary: null }),
    clearCache: () => Promise.resolve({ ok: true }),
    upload: disabled,
    serverGetVisibility: () => Promise.resolve({ ok: true, visibility: null }),
    serverSetVisibility: () => Promise.resolve({ ok: true, visibility: null }),
    serverDelete: () => Promise.resolve({ ok: true }),
    listDevices: () => Promise.resolve({ ok: true, devices: [] }),
    renameDevice: () => Promise.resolve({ ok: true }),
    deleteDevice: () => Promise.resolve({ ok: true }),
    activateDevice: () => Promise.resolve({ ok: true }),
    upgradeSuggest: () => Promise.resolve({ ok: true, report: null }),
  }
}
