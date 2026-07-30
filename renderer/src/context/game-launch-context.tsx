import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { ElevationPromptModal } from "@/components/ElevationPromptModal"
import { GameLaunchFailedModal } from "@/components/GameLaunchFailedModal"
import { GameLaunchPreflightModal, type LaunchPreflightResult } from "@/components/GameLaunchPreflightModal"
import { getUnambiguousExecutable, hasOnlineMode, matchAdminExecutable, type GameExecutable } from "@/lib/utils"
import { reportPlayEvent } from "@/lib/cloud-collections"
import { setRunningOptimistic, isRunningGameSync } from "@/hooks/use-running-games"
import { gameLogger } from "@/lib/logger"

export type LaunchableGame = {
  appid: string
  name: string
  game_executable_path?: string | null
  hasCoOp?: boolean
}

type PickerMode = "launch" | "set"

type GameLaunchValue = {
  requestLaunch: (game: LaunchableGame) => Promise<void>
  stopGame: (appid: string) => Promise<void>
  requestSetExecutable: (game: LaunchableGame, opts?: { currentPath?: string | null }) => Promise<void>
}

const GameLaunchContext = createContext<GameLaunchValue | null>(null)

const QUICK_EXIT_WINDOW_MS = 12_000

export function GameLaunchProvider({ children }: { children: React.ReactNode }) {
  const [game, setGame] = useState<LaunchableGame | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<PickerMode>("launch")
  const [pickerTitle, setPickerTitle] = useState("Select executable")
  const [pickerMessage, setPickerMessage] = useState("")
  const [pickerActionLabel, setPickerActionLabel] = useState("Launch")
  const [pickerExes, setPickerExes] = useState<GameExecutable[]>([])
  const [pickerFolder, setPickerFolder] = useState<string | null>(null)
  const [pickerCurrentPath, setPickerCurrentPath] = useState<string | null>(null)

  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [shortcutAlwaysCreate, setShortcutAlwaysCreate] = useState(false)

  const [preflightOpen, setPreflightOpen] = useState(false)
  const [preflightResult, setPreflightResult] = useState<LaunchPreflightResult | null>(null)

  const [failedOpen, setFailedOpen] = useState(false)
  const [failureReason, setFailureReason] = useState<string | null>(null)
  const [elevationOpen, setElevationOpen] = useState(false)
  const [elevationBusy, setElevationBusy] = useState(false)
  const [elevationError, setElevationError] = useState<string | null>(null)

  const justLaunchedRef = useRef<number>(0)
  const quickExitUnsubRef = useRef<(() => void) | null>(null)
  const presenceUnsubRef = useRef<(() => void) | null>(null)

  const getSavedExe = async (appid: string): Promise<string | null> => {
    try { return (await window.ucSettings?.get?.(`gameExe:${appid}`)) ?? null } catch { return null }
  }
  const setSavedExe = async (appid: string, path: string | null) => {
    try { await window.ucSettings?.set?.(`gameExe:${appid}`, path || null) } catch {  }
  }
  const getShortcutAsked = async (appid: string): Promise<boolean> => {
    try { return Boolean(await window.ucSettings?.get?.(`shortcutAsked:${appid}`)) } catch { return false }
  }
  const setShortcutAsked = async (appid: string) => {
    try { await window.ucSettings?.set?.(`shortcutAsked:${appid}`, true) } catch {  }
  }
  const getAlwaysCreateShortcut = async (): Promise<boolean> => {
    try { return Boolean(await window.ucSettings?.get?.("alwaysCreateDesktopShortcut")) } catch { return false }
  }
  const getHideDesktopShortcutPrompt = async (): Promise<boolean> => {
    try { return Boolean(await window.ucSettings?.get?.("hideDesktopShortcutPrompt")) } catch { return false }
  }
  const setAlwaysCreateShortcut = async (value: boolean) => {
    try { await window.ucSettings?.set?.("alwaysCreateDesktopShortcut", value) } catch {  }
  }

  const createDesktopShortcut = async (g: LaunchableGame, exePath?: string | null) => {
    if (!window.ucDownloads?.createDesktopShortcut) return
    try {
      const result = await window.ucDownloads.createDesktopShortcut(g.name, g.appid, exePath || undefined)
      if (result?.ok) gameLogger.info("Desktop shortcut created", { appid: g.appid })
      else gameLogger.error("Failed to create desktop shortcut", { data: result })
    } catch (err) {
      gameLogger.error("Error creating desktop shortcut", { data: err })
    }
  }

  const listExecutables = async (appid: string) => {
    if (!window.ucDownloads?.listGameExecutables) return null
    return await window.ucDownloads.listGameExecutables(appid)
  }

  const disarmQuickExit = useCallback(() => {
    justLaunchedRef.current = 0
    try { quickExitUnsubRef.current?.() } catch {  }
    quickExitUnsubRef.current = null
    try { presenceUnsubRef.current?.() } catch {  }
    presenceUnsubRef.current = null
  }, [])

  const armQuickExit = useCallback((g: LaunchableGame) => {
    disarmQuickExit()
    justLaunchedRef.current = Date.now() + QUICK_EXIT_WINDOW_MS

    const fireFailed = () => {
      if (justLaunchedRef.current === 0) return
      disarmQuickExit()
      setRunningOptimistic(g.appid, false)
      setGame(g)
      setPickerOpen(false)
      setShortcutOpen(false)
      setPreflightOpen(false)
      setElevationOpen(false)
      setFailureReason(null)
      setFailedOpen(true)
    }

    try {
      quickExitUnsubRef.current = window.ucDownloads?.onGameQuickExit?.((data) => {
        if (data?.appid !== g.appid) return
        fireFailed()
      }) ?? null
    } catch {  }

    try {
      presenceUnsubRef.current = window.ucPresence?.onChanged?.((detail) => {
        if (!detail || detail.appid !== g.appid || detail.reason !== "game-exited") return
        if (justLaunchedRef.current !== 0 && Date.now() <= justLaunchedRef.current) {
          fireFailed()
        } else {
          disarmQuickExit()
        }
      }) ?? null
    } catch {  }
  }, [disarmQuickExit])

  useEffect(() => () => disarmQuickExit(), [disarmQuickExit])

  const launchGame = useCallback(async (g: LaunchableGame, path: string, options?: { runAsAdmin?: boolean }) => {
    if (!window.ucDownloads?.launchGameExecutable) return
    try {
      const showGameName = (await window.ucSettings?.get?.("rpcShowGameName")) ?? true
      const res = await window.ucDownloads.launchGameExecutable(
        g.appid,
        path,
        g.name,
        showGameName,
        options?.runAsAdmin,
      )
      if (res && res.ok) {
        void reportPlayEvent(g.appid, "play")
        await setSavedExe(g.appid, path)
        setRunningOptimistic(g.appid, true)
        setPickerOpen(false)
        setShortcutOpen(false)
        setPreflightOpen(false)
        setElevationOpen(false)
        setElevationError(null)
        setFailedOpen(false)
        setFailureReason(null)
        setPendingPath(null)
        armQuickExit(g)
        return
      }
      if (typeof res?.error === "string" && res.error.toLowerCase().includes("already running")) {
        setRunningOptimistic(g.appid, true)
        setPickerOpen(false)
        setShortcutOpen(false)
        setPreflightOpen(false)
        setElevationOpen(false)
        setFailedOpen(false)
        setFailureReason(null)
        setPendingPath(null)
        return
      }
      if (res?.requiresElevation && !options?.runAsAdmin) {
        setGame(g)
        setPendingPath(path)
        setPickerOpen(false)
        setShortcutOpen(false)
        setPreflightOpen(false)
        setFailedOpen(false)
        setFailureReason(null)
        setElevationError(null)
        setElevationOpen(true)
        return
      }
      if (res?.elevationCancelled && options?.runAsAdmin) {
        setElevationError("Administrator permission was declined. You can try again or cancel.")
        return
      }
      setRunningOptimistic(g.appid, false)
      setGame(g)
      setPickerOpen(false)
      setShortcutOpen(false)
      setPreflightOpen(false)
      setElevationOpen(false)
      setFailureReason(res?.error || "Windows could not start the selected executable.")
      setFailedOpen(true)
    } catch (error) {
      setRunningOptimistic(g.appid, false)
      setGame(g)
      setElevationOpen(false)
      setFailureReason(error instanceof Error ? error.message : String(error))
      setFailedOpen(true)
    }
  }, [armQuickExit])

  const runLaunchPreflight = useCallback(async (g: LaunchableGame, path: string): Promise<boolean> => {
    const result = await window.ucDownloads?.preflightGameLaunch?.(g.appid, path)
    if (!result?.ok) return true
    if (result.canLaunch && result.checks.length === 0) return true
    setGame(g)
    setPendingPath(path)
    setPreflightResult(result)
    setPreflightOpen(true)
    return false
  }, [])

  const handleLaunchWithShortcutCheck = useCallback(async (g: LaunchableGame, path: string, options?: { skipPreflight?: boolean }) => {
    if (!options?.skipPreflight) {
      const passed = await runLaunchPreflight(g, path)
      if (!passed) return
    }
    const [alreadyAsked, alwaysCreate, hideShortcutPrompt] = await Promise.all([
      getShortcutAsked(g.appid),
      getAlwaysCreateShortcut(),
      getHideDesktopShortcutPrompt(),
    ])
    if (alwaysCreate && !alreadyAsked) {
      await createDesktopShortcut(g, path)
      await setShortcutAsked(g.appid)
      await launchGame(g, path)
    } else if (!alreadyAsked && !alwaysCreate && !hideShortcutPrompt) {
      setGame(g)
      setPendingPath(path)
      setShortcutAlwaysCreate(false)
      setPickerOpen(false)
      setShortcutOpen(true)
    } else {
      await launchGame(g, path)
    }
  }, [runLaunchPreflight, launchGame])

  const openLaunchPicker = useCallback((g: LaunchableGame, exes: GameExecutable[], folder: string | null, message?: string) => {
    setGame(g)
    setPickerMode("launch")
    setPickerTitle("Select executable")
    setPickerMessage(
      message ||
        `We couldn't confidently detect the correct exe for "${g.name}". Pick the one to launch — usually the largest, named after the game. Your choice is saved for next time.`,
    )
    setPickerActionLabel("Launch")
    setPickerExes(exes)
    setPickerFolder(folder)
    setPickerCurrentPath(null)
    setPickerOpen(true)
  }, [])

  const reopenLaunchPicker = useCallback(async (g: LaunchableGame | null) => {
    if (!g) return
    setPreflightOpen(false)
    setFailedOpen(false)
    setFailureReason(null)
    setElevationOpen(false)
    setElevationError(null)
    try {
      const result = await listExecutables(g.appid)
      openLaunchPicker(g, result?.exes || [], result?.folder || null)
    } catch {
      openLaunchPicker(g, [], null)
    }
  }, [openLaunchPicker])

  const requestLaunch = useCallback(async (g: LaunchableGame) => {
    if (!g?.appid) return
    if (isRunningGameSync(g.appid)) return
    if (!window.ucDownloads?.listGameExecutables || !window.ucDownloads?.launchGameExecutable) return
    disarmQuickExit()
    setFailureReason(null)
    setElevationError(null)
    try {
      const savedExe = await getSavedExe(g.appid)
      if (g.appid.startsWith("steam-")) {
        const [manifest, launchArgs, linuxConfig] = await Promise.all([
          window.ucDownloads?.getInstalledGlobal?.(g.appid),
          window.ucSettings?.get?.("gameLaunchArgs"),
          window.ucSettings?.get?.(`gameLinux:${g.appid}`),
        ])
        const configuredArgs = launchArgs && typeof launchArgs === "object"
          ? String((launchArgs as Record<string, string>)[g.appid] || "").trim()
          : ""
        const configuredLinux = linuxConfig && typeof linuxConfig === "object"
          ? Object.keys(linuxConfig as Record<string, unknown>).length > 0
          : false
        if (
          !savedExe
          && !configuredArgs
          && !configuredLinux
          && manifest?.installType === "steam"
          && typeof manifest.steamAppId === "number"
        ) {
          const res = await window.ucSystem?.runSteamGame?.(manifest.steamAppId)
          if (res?.ok) void reportPlayEvent(g.appid, "play")
          return
        }
      }
      if (savedExe) {
        const pre = await window.ucDownloads?.preflightGameLaunch?.(g.appid, savedExe)
        const exeMissing = pre?.ok && pre.checks?.some((c) => c.code === "exe-not-found")
        if (exeMissing) {
          await setSavedExe(g.appid, null)
        } else {
          await handleLaunchWithShortcutCheck(g, savedExe)
          return
        }
      }

      const result = await listExecutables(g.appid)
      const exes = result?.exes || []
      const folder = result?.folder || null

      const adminExe = matchAdminExecutable(exes, g.game_executable_path, folder)
      if (adminExe) {
        await handleLaunchWithShortcutCheck(g, adminExe.path)
        return
      }

      const single = getUnambiguousExecutable(exes)
      if (single) {
        await handleLaunchWithShortcutCheck(g, single.path)
        return
      }

      openLaunchPicker(
        g,
        exes,
        folder,
        exes.length
          ? undefined
          : `No executables were found for "${g.name}" yet. It may still be extracting, or you can browse to the correct file.`,
      )
    } catch {
      openLaunchPicker(g, [], null, `Unable to list executables for "${g.name}".`)
    }
  }, [disarmQuickExit, handleLaunchWithShortcutCheck, openLaunchPicker])

  const stopGame = useCallback(async (appid: string) => {
    if (!appid || !window.ucDownloads?.quitGameExecutable) return
    disarmQuickExit()
    try {
      const result = await window.ucDownloads.quitGameExecutable(appid)
      if (result?.ok && result.stopped) setRunningOptimistic(appid, false)
    } catch (err) {
      gameLogger.error("Failed to quit game", { data: err })
    }
  }, [disarmQuickExit])

  const requestSetExecutable = useCallback(async (g: LaunchableGame, opts?: { currentPath?: string | null }) => {
    if (!g?.appid) return
    setGame(g)
    setPickerMode("set")
    setPickerActionLabel("Set")
    try {
      const [result, savedExe] = await Promise.all([listExecutables(g.appid), getSavedExe(g.appid)])
      const exes = result?.exes || []
      setPickerTitle("Set launch executable")
      setPickerMessage(
        exes.length
          ? `Select the exe to launch for "${g.name}".`
          : `No executables detected for "${g.name}" yet. Browse and pick the correct one.`,
      )
      setPickerExes(exes)
      setPickerFolder(result?.folder || null)
      setPickerCurrentPath(opts?.currentPath ?? savedExe ?? null)
    } catch {
      setPickerTitle("Set launch executable")
      setPickerMessage(`Unable to list executables for "${g.name}".`)
      setPickerExes([])
      setPickerFolder(null)
      setPickerCurrentPath(opts?.currentPath ?? null)
    }
    setPickerOpen(true)
  }, [])

  const handleExePicked = useCallback(async (path: string) => {
    const g = game
    if (!g) return
    if (pickerMode === "set") {
      await setSavedExe(g.appid, path)
      setPickerCurrentPath(path)
      try {
        window.dispatchEvent(new CustomEvent("uc:game-exe-changed", { detail: { appid: g.appid, path } }))
      } catch {  }
      return
    }
    setPickerOpen(false)
    setPendingPath(path)
    await handleLaunchWithShortcutCheck(g, path)
  }, [game, pickerMode, handleLaunchWithShortcutCheck])

  const cancelElevation = useCallback(() => {
    if (elevationBusy) return
    setElevationOpen(false)
    setElevationError(null)
    setPendingPath(null)
  }, [elevationBusy])

  const confirmElevation = useCallback(async () => {
    const g = game
    const path = pendingPath
    if (!g || !path || elevationBusy) return
    setElevationBusy(true)
    setElevationError(null)
    try {
      await launchGame(g, path, { runAsAdmin: true })
    } finally {
      setElevationBusy(false)
    }
  }, [elevationBusy, game, launchGame, pendingPath])

  const value = useMemo<GameLaunchValue>(
    () => ({ requestLaunch, stopGame, requestSetExecutable }),
    [requestLaunch, stopGame, requestSetExecutable],
  )

  return (
    <GameLaunchContext.Provider value={value}>
      {children}

      <ExePickerModal
        open={pickerOpen}
        title={pickerTitle}
        message={pickerMessage}
        exes={pickerExes}
        gameName={game?.name}
        baseFolder={pickerFolder}
        currentExePath={pickerCurrentPath}
        actionLabel={pickerActionLabel}
        onSelect={(p) => void handleExePicked(p)}
        onClose={() => setPickerOpen(false)}
      />

      <DesktopShortcutModal
        open={shortcutOpen}
        gameName={game?.name || ""}
        defaultAlwaysCreate={shortcutAlwaysCreate}
        onCreateShortcut={async (alwaysCreate) => {
          const g = game
          const path = pendingPath
          if (alwaysCreate) await setAlwaysCreateShortcut(true)
          if (g && path) {
            await createDesktopShortcut(g, path)
            await setShortcutAsked(g.appid)
            await launchGame(g, path)
          }
        }}
        onSkip={async (alwaysCreate) => {
          const g = game
          const path = pendingPath
          if (alwaysCreate) await setAlwaysCreateShortcut(true)
          if (g) await setShortcutAsked(g.appid)
          if (g && path) await launchGame(g, path)
        }}
        onClose={async (alwaysCreate) => {
          const g = game
          if (alwaysCreate) await setAlwaysCreateShortcut(true)
          if (g) await setShortcutAsked(g.appid)
          setShortcutOpen(false)
          setPendingPath(null)
          setShortcutAlwaysCreate(false)
        }}
      />

      <GameLaunchPreflightModal
        open={preflightOpen}
        gameName={game?.name || ""}
        result={preflightResult}
        onClose={() => {
          setPreflightOpen(false)
          setPreflightResult(null)
          setPendingPath(null)
        }}
        onChooseAnother={() => void reopenLaunchPicker(game)}
        onContinue={
          preflightResult?.canLaunch && pendingPath
            ? async () => {
                const g = game
                const path = pendingPath
                setPreflightOpen(false)
                setPreflightResult(null)
                if (g && path) await handleLaunchWithShortcutCheck(g, path, { skipPreflight: true })
              }
            : undefined
        }
      />

      <ElevationPromptModal
        open={elevationOpen}
        gameName={game?.name || ""}
        executablePath={pendingPath || ""}
        busy={elevationBusy}
        error={elevationError}
        onCancel={cancelElevation}
        onConfirm={() => void confirmElevation()}
      />

      <GameLaunchFailedModal
        open={failedOpen}
        gameName={game?.name || ""}
        reason={failureReason}
        hasOnlineSupport={hasOnlineMode(game?.hasCoOp)}
        onClose={() => {
          setFailedOpen(false)
          setFailureReason(null)
        }}
        onPickExecutable={() => void reopenLaunchPicker(game)}
      />
    </GameLaunchContext.Provider>
  )
}

export function useGameLaunch(): GameLaunchValue {
  const ctx = useContext(GameLaunchContext)
  if (ctx) return ctx
  return {
    requestLaunch: async () => {},
    stopGame: async () => {},
    requestSetExecutable: async () => {},
  }
}
