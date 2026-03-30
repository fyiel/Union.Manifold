import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, RefreshCw } from "lucide-react"

type UpdateStatus = {
  enabled: boolean
  state: "disabled" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "not-available" | "error"
  currentVersion: string
  version?: string | null
  available: boolean
  downloaded: boolean
  progress: number
  error?: string | null
  checkedAt?: number | null
}

const INITIAL_STATUS: UpdateStatus = {
  enabled: true,
  state: "idle",
  currentVersion: "",
  version: null,
  available: false,
  downloaded: false,
  progress: 0,
  error: null,
  checkedAt: null,
}

export function UpdateNotification() {
  const [status, setStatus] = useState<UpdateStatus>(INITIAL_STATUS)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const nextStatus = await window.ucUpdater?.getUpdateStatus?.()
      if (!mounted || !nextStatus) return
      setStatus(nextStatus)
    }

    void load()

    const off = window.ucUpdater?.onStatusChanged?.((nextStatus) => {
      setStatus(nextStatus)
    })

    return () => {
      mounted = false
      if (typeof off === "function") off()
    }
  }, [])

  useEffect(() => {
    const key = `${status.state}:${status.version || "none"}:${status.error || ""}`
    if (dismissedKey && key !== dismissedKey) {
      setDismissedKey(null)
    }
  }, [dismissedKey, status.error, status.state, status.version])

  const handleInstall = async () => {
    await window.ucUpdater?.installUpdate?.()
  }

  const handleRetry = async () => {
    const nextStatus = await window.ucUpdater?.retryUpdate?.()
    if (nextStatus) setStatus(nextStatus)
  }

  const handleDismiss = () => {
    setDismissedKey(`${status.state}:${status.version || "none"}:${status.error || ""}`)
  }

  if (!status.enabled || status.state === "idle" || status.state === "not-available" || status.state === "disabled") return null

  const currentKey = `${status.state}:${status.version || "none"}:${status.error || ""}`
  if (dismissedKey === currentKey) return null

  const isDownloading = status.state === "downloading"
  const isDownloaded = status.state === "downloaded"
  const isError = status.state === "error"

  let description = ""
  if (status.state === "checking") {
    description = "Checking for a new UnionCrax.Direct build."
  } else if (isDownloading) {
    description = `Downloading ${status.version ? `v${status.version}` : "the update"} - ${Math.round(status.progress)}%.`
  } else if (isDownloaded) {
    description = `${status.version ? `v${status.version}` : "The update"} is ready to install.`
  } else if (status.state === "available") {
    description = `${status.version ? `v${status.version}` : "A new version"} is available. Download will start automatically.`
  } else if (status.state === "installing") {
    description = "Closing the app to install the downloaded update."
  } else if (isError) {
    description = status.error || "Update failed."
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-2xl border border-zinc-700 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 rounded-full bg-white/20 p-2">
          {isError ? <RefreshCw className="h-5 w-5 text-white" /> : <Download className="h-5 w-5 text-white" />}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">
            {isError ? "Update failed" : isDownloaded ? "Update ready" : isDownloading ? "Downloading update" : status.state === "checking" ? "Checking for updates" : "Update available"}
          </h3>
          <p className="mt-1 text-sm text-zinc-300">{description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {isDownloaded && (
              <Button size="sm" onClick={handleInstall}>Install now</Button>
            )}
            {isError && (
              <Button size="sm" onClick={handleRetry}>Retry</Button>
            )}
            <Button size="sm" variant="ghost" onClick={handleDismiss}>Dismiss</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

