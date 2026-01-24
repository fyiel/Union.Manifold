import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

export function UpdateNotification() {
  const [available, setAvailable] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return
    const onAvailable = (_e: any, info: any) => {
      setAvailable(true)
      setVersion(info?.version || null)
    }
    const onNotAvailable = () => {
      // no-op
    }
    window.electron.ipcRenderer.on('update-available', onAvailable)
    window.electron.ipcRenderer.on('update-not-available', onNotAvailable)
    return () => {
      window.electron.ipcRenderer.removeListener('update-available', onAvailable)
      window.electron.ipcRenderer.removeListener('update-not-available', onNotAvailable)
    }
  }, [])

  const openReleases = async () => {
    setOpened(false)
    const res = await window.ucUpdater?.checkForUpdates()
    if (res?.ok) setOpened(true)
  }

  if (!available) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border border-primary/40 bg-gradient-to-br from-slate-950/95 via-slate-900/95 to-slate-950/95 p-4 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 rounded-full bg-primary/20 p-2">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">Update Available</h3>
          <p className="mt-1 text-sm text-slate-300">{version ? `Version ${version} is available.` : 'A new version is available.'}</p>
          <Button size="sm" className="mt-3" onClick={openReleases}>Install (open Releases)</Button>
          {opened && <div className="mt-2 text-xs text-slate-400">Opened Releases page in your browser</div>}
        </div>
      </div>
    </div>
  )
}
