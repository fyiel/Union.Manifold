import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState } from "react"
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

const loadDownloadCheckModal = () => import("@/components/DownloadCheckModal")
const DownloadCheckModal = lazy(() => loadDownloadCheckModal().then((m) => ({ default: m.DownloadCheckModal })))

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

const ACTIVE_STATUSES = [
  "queued", "downloading", "paused", "extracting", "installing", "verifying", "retrying", "install_ready",
]

export function DownloadFlowProvider({ children }: { children: React.ReactNode }) {
  const { startGameDownload } = useDownloadsActions()
  const { toast } = useToast()
  const [state, setState] = useState<FlowState>(CLOSED)

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

      if (activeAppids.includes(appid)) {
        toast(`“${game.name}” is already in your downloads`, "info", 4000)
        return
      }

      let mode = (await window.ucSettings?.get?.("downloadCheckMode")) as
        | "always" | "auto" | "skip" | undefined
      if (!mode) {
        const legacy = await window.ucSettings?.get?.("skipLinkCheck")
        mode = legacy === true ? "skip" : "auto"
      }

      let preferred: PreferredDownloadHost = "ucfiles"
      try {
        preferred = await getPreferredDownloadHost()
      } catch {  }

      if (mode === "skip") {
        try {
          await startGameDownload(game, preferred)
          toast(`Added “${game.name}” to the download queue`, "info", 4000)
        } catch (err) {
          toast(err instanceof Error ? err.message : "Couldn't start the download", "error", 6000)
        }
        return
      }

      void loadDownloadCheckModal().catch(() => undefined)

      let full: Game = game
      try {
        const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}`)
        if (res.ok) {
          const detail = await res.json().catch(() => null)
          if (detail && typeof detail === "object") full = { ...game, ...detail }
        }
      } catch {  }

      let token: string | null = null
      try {
        token = await requestDownloadToken(appid)
      } catch {
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
      {state.open ? (
        <Suspense fallback={null}>
          <DownloadCheckModal
            open
            game={state.game}
            downloadToken={state.token}
            defaultHost={state.defaultHost}
            autoConfirmIfGreen={state.autoConfirm}
            onConfirm={handleConfirm}
            onClose={() => setState(CLOSED)}
          />
        </Suspense>
      ) : null}
    </DownloadFlowContext.Provider>
  )
}

export function useDownloadFlow(): DownloadFlowValue {
  const ctx = useContext(DownloadFlowContext)
  if (ctx) return ctx
  return { requestDownload: async () => {} }
}
