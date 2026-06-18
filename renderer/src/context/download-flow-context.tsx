import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { Game } from "@/lib/types"
import {
  getPreferredDownloadHost,
  requestDownloadToken,
  type DownloadConfig,
  type PreferredDownloadHost,
} from "@/lib/downloads"
import { apiFetch } from "@/lib/api"
import { useDownloadsActions, useDownloadsSelector } from "@/context/downloads-context"
import { useToast } from "@/context/toast-context"
import { DownloadCheckModal } from "@/components/DownloadCheckModal"

/**
 * App-wide "start a download from anywhere" flow.
 *
 * Historically the only place that ran the pre-download availability check +
 * host selector was the GameDetailPage, so every other surface (right-click
 * menus, collection / library install buttons) had to navigate to that page
 * with `?download=1` just to kick off a download — slow, and it yanked the
 * user away from what they were doing when all they wanted was a quick
 * "add to queue".
 *
 * This provider lifts that flow to the app root. `requestDownload(game)` reads
 * the same `downloadCheckMode` setting GameDetailPage uses and either:
 *   • "skip"  → queues immediately (true one-click "add to queue"), or
 *   • "auto"  → opens the check modal but auto-confirms when everything's green
 *               (the modal only paints if something needs attention), or
 *   • "always"→ always shows the check modal.
 *
 * The DownloadCheckModal is mounted once here so it can appear over any page.
 * GameDetailPage keeps its own copy of this flow because it layers on extra
 * concerns (installed-manifest checks, version conflicts, force re-download).
 */
type DownloadFlowValue = {
  requestDownload: (game: Game) => Promise<void>
}

const DownloadFlowContext = createContext<DownloadFlowValue | null>(null)

type FlowState = {
  open: boolean
  game: Game | null
  token: string | null
  defaultHost: PreferredDownloadHost
  autoConfirm: boolean
}

const CLOSED: FlowState = {
  open: false,
  game: null,
  token: null,
  defaultHost: "ucfiles",
  autoConfirm: false,
}

// Non-terminal states that mean "a download/install for this game is already
// in flight" — kept in sync with use-universal-game-menu's active check.
const ACTIVE_STATUSES = [
  "queued", "downloading", "paused", "extracting", "installing", "verifying", "retrying", "install_ready",
]

export function DownloadFlowProvider({ children }: { children: React.ReactNode }) {
  const { startGameDownload } = useDownloadsActions()
  const { toast } = useToast()
  const [state, setState] = useState<FlowState>(CLOSED)

  // Active appids, derived with content-equality so progress ticks during a
  // download don't re-render this root-level provider.
  const activeAppids = useDownloadsSelector(
    (downloads) =>
      Array.from(
        new Set(
          downloads
            .filter((item) => ACTIVE_STATUSES.includes(item.status))
            .map((item) => item.appid),
        ),
      ).sort(),
    (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
  )

  const requestDownload = useCallback(
    async (game: Game) => {
      const appid = game?.appid
      if (!appid) return

      // Already downloading / queued — don't start a second job or pop a modal.
      if (activeAppids.includes(appid)) {
        toast(`“${game.name}” is already in your downloads`, "info", 4000)
        return
      }

      // Mirror GameDetailPage.openHostSelector's mode resolution, including the
      // legacy `skipLinkCheck` boolean fallback.
      let mode = (await window.ucSettings?.get?.("downloadCheckMode")) as
        | "always" | "auto" | "skip" | undefined
      if (!mode) {
        const legacy = await window.ucSettings?.get?.("skipLinkCheck")
        mode = legacy === true ? "skip" : "auto"
      }

      let preferred: PreferredDownloadHost = "ucfiles"
      try {
        preferred = await getPreferredDownloadHost()
      } catch { /* keep default */ }

      if (mode === "skip") {
        // Quick path — queue immediately, no popup.
        try {
          await startGameDownload(game, preferred)
          toast(`Added “${game.name}” to the download queue`, "info", 4000)
        } catch (err) {
          toast(err instanceof Error ? err.message : "Couldn't start the download", "error", 6000)
        }
        return
      }

      // "auto" / "always" — run the availability check + host selector. Enrich
      // the game with full detail first so the modal's storage / system-
      // requirement panels match what the game page would show.
      let full: Game = game
      try {
        const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}`)
        if (res.ok) {
          const detail = await res.json().catch(() => null)
          if (detail && typeof detail === "object") full = { ...game, ...detail }
        }
      } catch { /* fall back to the list payload */ }

      let token: string | null = null
      try {
        token = await requestDownloadToken(appid)
      } catch {
        // No token → the modal falls back to a plain host picker (skips the
        // link check) rather than failing outright.
        token = null
      }

      setState({ open: true, game: full, token, defaultHost: preferred, autoConfirm: mode === "auto" })
    },
    [activeAppids, startGameDownload, toast],
  )

  const handleConfirm = useCallback(
    (config: DownloadConfig) => {
      const game = state.game
      setState(CLOSED)
      if (!game) return
      void (async () => {
        try {
          await startGameDownload(game, config.host, config)
          toast(`Added “${game.name}” to the download queue`, "info", 4000)
        } catch (err) {
          toast(err instanceof Error ? err.message : "Couldn't start the download", "error", 6000)
        }
      })()
    },
    [state.game, startGameDownload, toast],
  )

  const value = useMemo<DownloadFlowValue>(() => ({ requestDownload }), [requestDownload])

  return (
    <DownloadFlowContext.Provider value={value}>
      {children}
      <DownloadCheckModal
        open={state.open}
        game={state.game}
        downloadToken={state.token}
        defaultHost={state.defaultHost}
        autoConfirmIfGreen={state.autoConfirm}
        onConfirm={handleConfirm}
        onClose={() => setState(CLOSED)}
      />
    </DownloadFlowContext.Provider>
  )
}

/**
 * Access the app-wide download flow. Returns a no-op fallback when used outside
 * the provider (e.g. detached windows) so consumers never crash — they just
 * won't be able to start a download there.
 */
export function useDownloadFlow(): DownloadFlowValue {
  const ctx = useContext(DownloadFlowContext)
  if (ctx) return ctx
  return { requestDownload: async () => {} }
}
