import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { GameLaunchFailedModal } from "@/components/GameLaunchFailedModal"
import { GameLaunchPreflightModal, type LaunchPreflightResult } from "@/components/GameLaunchPreflightModal"
import { getUnambiguousExecutable, hasOnlineMode, matchAdminExecutable, type GameExecutable } from "@/lib/utils"
import { reportPlayEvent } from "@/lib/cloud-collections"
import { setRunningOptimistic } from "@/hooks/use-running-games"
import { gameLogger } from "@/lib/logger"

/**
 * App-wide "launch / stop / set-executable from anywhere" flow.
 *
 * Historically every surface that could start a game (GameCard, GameDetailPage,
 * DownloadsPage, LibraryPage) carried its OWN copy of the ~200-line launch
 * state machine *and* its own mounted ExePickerModal / DesktopShortcutModal /
 * GameLaunchPreflightModal / GameLaunchFailedModal. On a populated grid that
 * meant the picker overlay was rendered hundreds of times, deep inside each
 * card's transformed/aura subtree — and because the (hand-rolled) overlay was
 * not portaled, its `position: fixed` resolved against an ancestor containing
 * block and got clipped to the card (the "big box inside a small box" bug).
 *
 * This provider lifts the whole flow to the app root, exactly like
 * `DownloadFlowProvider` did for downloads. Every surface now just calls
 * `requestLaunch(game)` / `stopGame(appid)` / `requestSetExecutable(game)`, and
 * the four launch modals are mounted ONCE here (the picker is portaled to
 * <body>, the rest are Radix dialogs that already portal). Running state is
 * driven through the shared running-games cache via `setRunningOptimistic` so
 * every Play/Stop button updates instantly.
 */
export type LaunchableGame = {
  appid: string
  name: string
  /** Admin-selected launcher exe (relative to install folder). Preferred over
   *  heuristic detection when present. */
  game_executable_path?: string | null
  /** Drives the "Launch Steam" hint in the launch-failed modal for online games. */
  hasCoOp?: boolean
}

type PickerMode = "launch" | "set"

type GameLaunchValue = {
  /** Resolve the right exe (saved → admin → unambiguous → picker) and launch it. */
  requestLaunch: (game: LaunchableGame) => Promise<void>
  /** Quit a running game and clear its quick-exit watch. */
  stopGame: (appid: string) => Promise<void>
  /** Open the picker in "set" mode to choose/replace the saved launch exe. */
  requestSetExecutable: (game: LaunchableGame, opts?: { currentPath?: string | null }) => Promise<void>
}

const GameLaunchContext = createContext<GameLaunchValue | null>(null)

// How long after launch we treat an exit as a "quick exit" (likely wrong exe).
const QUICK_EXIT_WINDOW_MS = 12_000

export function GameLaunchProvider({ children }: { children: React.ReactNode }) {
  const [game, setGame] = useState<LaunchableGame | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  // Exe picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<PickerMode>("launch")
  const [pickerTitle, setPickerTitle] = useState("Select executable")
  const [pickerMessage, setPickerMessage] = useState("")
  const [pickerActionLabel, setPickerActionLabel] = useState("Launch")
  const [pickerExes, setPickerExes] = useState<GameExecutable[]>([])
  const [pickerFolder, setPickerFolder] = useState<string | null>(null)
  const [pickerCurrentPath, setPickerCurrentPath] = useState<string | null>(null)

  // Desktop-shortcut prompt
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [shortcutAlwaysCreate, setShortcutAlwaysCreate] = useState(false)

  // Preflight
  const [preflightOpen, setPreflightOpen] = useState(false)
  const [preflightResult, setPreflightResult] = useState<LaunchPreflightResult | null>(null)

  // Launch failed
  const [failedOpen, setFailedOpen] = useState(false)

  // Quick-exit detection (armed for QUICK_EXIT_WINDOW_MS after a launch).
  const justLaunchedRef = useRef<number>(0)
  const quickExitUnsubRef = useRef<(() => void) | null>(null)
  const presenceUnsubRef = useRef<(() => void) | null>(null)

  // ── settings helpers (per-appid) ──────────────────────────────────────────
  const getSavedExe = async (appid: string): Promise<string | null> => {
    try { return (await window.ucSettings?.get?.(`gameExe:${appid}`)) ?? null } catch { return null }
  }
  const setSavedExe = async (appid: string, path: string | null) => {
    try { await window.ucSettings?.set?.(`gameExe:${appid}`, path || null) } catch { /* ignore */ }
  }
  const getShortcutAsked = async (appid: string): Promise<boolean> => {
    try { return Boolean(await window.ucSettings?.get?.(`shortcutAsked:${appid}`)) } catch { return false }
  }
  const setShortcutAsked = async (appid: string) => {
    try { await window.ucSettings?.set?.(`shortcutAsked:${appid}`, true) } catch { /* ignore */ }
  }
  const getAlwaysCreateShortcut = async (): Promise<boolean> => {
    try { return Boolean(await window.ucSettings?.get?.("alwaysCreateDesktopShortcut")) } catch { return false }
  }
  const setAlwaysCreateShortcut = async (value: boolean) => {
    try { await window.ucSettings?.set?.("alwaysCreateDesktopShortcut", value) } catch { /* ignore */ }
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

  // ── quick-exit watch ──────────────────────────────────────────────────────
  const disarmQuickExit = useCallback(() => {
    justLaunchedRef.current = 0
    try { quickExitUnsubRef.current?.() } catch { /* ignore */ }
    quickExitUnsubRef.current = null
    try { presenceUnsubRef.current?.() } catch { /* ignore */ }
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
      setFailedOpen(true)
    }

    // Authoritative fast path: the main process emits this only for a genuine
    // quick exit (game died <5 s after launch, no launcher handoff). Trust it
    // while still armed even if it lands after the wall-clock window (Windows
    // handoff grace can delay it).
    try {
      quickExitUnsubRef.current = window.ucDownloads?.onGameQuickExit?.((data) => {
        if (data?.appid !== g.appid) return
        fireFailed()
      }) ?? null
    } catch { /* ignore */ }

    // Fallback: a presence "game-exited" inside the armed window is also a quick
    // exit. Past the window it's a normal exit — clean up the listener instead.
    try {
      presenceUnsubRef.current = window.ucPresence?.onChanged?.((detail) => {
        if (!detail || detail.appid !== g.appid || detail.reason !== "game-exited") return
        if (justLaunchedRef.current !== 0 && Date.now() <= justLaunchedRef.current) {
          fireFailed()
        } else {
          disarmQuickExit()
        }
      }) ?? null
    } catch { /* ignore */ }
  }, [disarmQuickExit])

  // Drop any live quick-exit subscriptions if the provider ever unmounts.
  useEffect(() => () => disarmQuickExit(), [disarmQuickExit])

  // ── launch state machine ──────────────────────────────────────────────────
  const launchGame = useCallback(async (g: LaunchableGame, path: string) => {
    if (!window.ucDownloads?.launchGameExecutable) return
    const showGameName = (await window.ucSettings?.get?.("rpcShowGameName")) ?? true
    const res = await window.ucDownloads.launchGameExecutable(g.appid, path, g.name, showGameName)
    if (res && res.ok) {
      void reportPlayEvent(g.appid, "play")
      await setSavedExe(g.appid, path)
      setRunningOptimistic(g.appid, true)
      setPickerOpen(false)
      setShortcutOpen(false)
      setPreflightOpen(false)
      setFailedOpen(false)
      setPendingPath(null)
      armQuickExit(g)
    } else {
      // Launch failed outright (wrong/missing exe, spawn error) — surface the
      // failure modal so the user can pick a different executable.
      setRunningOptimistic(g.appid, false)
      setGame(g)
      setPickerOpen(false)
      setShortcutOpen(false)
      setPreflightOpen(false)
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
    const alreadyAsked = await getShortcutAsked(g.appid)
    const alwaysCreate = await getAlwaysCreateShortcut()
    if (alwaysCreate && !alreadyAsked) {
      await createDesktopShortcut(g, path)
      await setShortcutAsked(g.appid)
      await launchGame(g, path)
    } else if (!alreadyAsked && !alwaysCreate) {
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
    try {
      const result = await listExecutables(g.appid)
      openLaunchPicker(g, result?.exes || [], result?.folder || null)
    } catch {
      openLaunchPicker(g, [], null)
    }
  }, [openLaunchPicker])

  // ── public API ────────────────────────────────────────────────────────────
  const requestLaunch = useCallback(async (g: LaunchableGame) => {
    if (!g?.appid) return
    if (!window.ucDownloads?.listGameExecutables || !window.ucDownloads?.launchGameExecutable) return
    disarmQuickExit()
    try {
      const savedExe = await getSavedExe(g.appid)
      if (savedExe) {
        // Saved paths go stale after an update re-extracts the game. If it no
        // longer resolves, clear it and re-detect instead of dead-ending.
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

      // Prefer the admin-selected exe over any heuristic.
      const adminExe = matchAdminExecutable(exes, g.game_executable_path, folder)
      if (adminExe) {
        await handleLaunchWithShortcutCheck(g, adminExe.path)
        return
      }

      // One unambiguous exe launches directly; anything ambiguous opens the picker.
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

  // ── picker selection ──────────────────────────────────────────────────────
  const handleExePicked = useCallback(async (path: string) => {
    const g = game
    if (!g) return
    if (pickerMode === "set") {
      await setSavedExe(g.appid, path)
      setPickerCurrentPath(path)
      try {
        window.dispatchEvent(new CustomEvent("uc:game-exe-changed", { detail: { appid: g.appid, path } }))
      } catch { /* ignore */ }
      return // keep the picker open so the choice is visibly confirmed
    }
    // Launch mode: the picker's job is done the moment a file is chosen. Close it
    // immediately so it never lingers behind the preflight / shortcut / failed
    // modal that the launch path may open next.
    setPickerOpen(false)
    setPendingPath(path)
    await handleLaunchWithShortcutCheck(g, path)
  }, [game, pickerMode, handleLaunchWithShortcutCheck])

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

      <GameLaunchFailedModal
        open={failedOpen}
        gameName={game?.name || ""}
        hasOnlineSupport={hasOnlineMode(game?.hasCoOp)}
        onClose={() => setFailedOpen(false)}
        onPickExecutable={() => void reopenLaunchPicker(game)}
      />
    </GameLaunchContext.Provider>
  )
}

/**
 * Access the app-wide launch flow. Returns no-op fallbacks when used outside the
 * provider (e.g. detached windows) so consumers never crash.
 */
export function useGameLaunch(): GameLaunchValue {
  const ctx = useContext(GameLaunchContext)
  if (ctx) return ctx
  return {
    requestLaunch: async () => {},
    stopGame: async () => {},
    requestSetExecutable: async () => {},
  }
}
