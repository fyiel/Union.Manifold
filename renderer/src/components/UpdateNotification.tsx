import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, X } from "lucide-react"

export function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version?: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)

  useEffect(() => {
    if (!window.electron) return

    const handleUpdateAvailable = (_event: any, info: any) => {
      setUpdateAvailable(true)
      setUpdateInfo(info)
      setDownloadProgress(null)
    }

    const handleUpdateNotAvailable = (_event: any, info: any) => {
      // Don't show notification if already on latest version
      console.log('[Update] Already on latest version')
    }

    const handleUpdateDownloaded = (_event: any, info: any) => {
      setUpdateDownloaded(true)
      setUpdateInfo(info)
      setDownloadProgress(100)
    }

    const handleDownloadProgress = (_event: any, progress: any) => {
      const percent = typeof progress?.percent === "number" ? progress.percent : null
      setDownloadProgress(percent)
    }

    window.electron.ipcRenderer.on('update-available', handleUpdateAvailable)
    window.electron.ipcRenderer.on('update-not-available', handleUpdateNotAvailable)
    window.electron.ipcRenderer.on('update-downloaded', handleUpdateDownloaded)
    window.electron.ipcRenderer.on('update-download-progress', handleDownloadProgress)

    return () => {
      window.electron.ipcRenderer.removeListener('update-available', handleUpdateAvailable)
      window.electron.ipcRenderer.removeListener('update-not-available', handleUpdateNotAvailable)
      window.electron.ipcRenderer.removeListener('update-downloaded', handleUpdateDownloaded)
      window.electron.ipcRenderer.removeListener('update-download-progress', handleDownloadProgress)
    }
  }, [])

  const handleInstall = () => {
    if (window.ucUpdater?.installUpdate) {
      window.ucUpdater.installUpdate()
    }
  }

  if (dismissed || (!updateAvailable && !updateDownloaded)) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border border-primary/40 bg-gradient-to-br from-slate-950/95 via-slate-900/95 to-slate-950/95 p-4 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 rounded-full bg-primary/20 p-2">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">
            {updateDownloaded
              ? "Update Ready"
              : downloadProgress != null
                ? "Downloading Update"
                : "Update Available"}
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            {updateDownloaded
              ? `Version ${updateInfo?.version || 'new version'} has been downloaded and is ready to install.`
              : downloadProgress != null
                ? `Downloading version ${updateInfo?.version || 'new version'} (${downloadProgress.toFixed(0)}%).`
                : `Version ${updateInfo?.version || 'new version'} is available. Download will start automatically.`}
          </p>
          {updateDownloaded && (
            <Button
              size="sm"
              className="mt-3"
              onClick={handleInstall}
            >
              Restart & Install
            </Button>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
