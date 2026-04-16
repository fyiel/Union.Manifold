import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Copy, Check } from "lucide-react"
import { logger } from "@/lib/logger"

function getLineClass(line: string): string {
  const upper = line.toUpperCase()
  if (upper.includes("[ERROR]")) return "text-red-400"
  if (upper.includes("[WARN ]") || upper.includes("[WARN]")) return "text-amber-400"
  if (upper.includes("[DEBUG]")) return "text-zinc-500"
  return "text-zinc-300"
}

export function LogViewer() {
  const [logs, setLogs] = useState<string>("")
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const logLines = useMemo(() => logs ? logs.split("\n") : [], [logs])

  const fetchLogs = async () => {
    setIsLoading(true)
    try {
      if (window.ucLogs?.getLogs) {
        const logContent = await window.ucLogs.getLogs()
        setLogs(logContent)
      }
    } catch (error) {
      logger.error("Failed to fetch logs", { data: error })
      setLogs("Error fetching logs")
    } finally {
      setIsLoading(false)
    }
  }

  const clearLogs = async () => {
    try {
      if (window.ucLogs?.clearLogs) {
        await window.ucLogs.clearLogs()
        logger.info("Logs cleared")
        await fetchLogs()
      }
    } catch (error) {
      logger.error("Failed to clear logs", { data: error })
    }
  }

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      logger.error("Failed to copy logs", { data: error })
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchLogs()
    }
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          View Logs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-none w-[min(95vw,1400px)] h-[85vh] max-h-[85vh] min-h-[60vh] flex flex-col overflow-hidden rounded-2xl border-white/[.07] bg-zinc-900/95 backdrop-blur-md p-0">
        <div className="flex flex-col h-full min-h-0 p-5 gap-0">
          <DialogHeader className="pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold">Application Logs</DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              View and manage UnionCrax.Direct application logs
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 pb-3 shrink-0">
            <Button onClick={fetchLogs} size="sm" variant="outline" className="rounded-full active:scale-95" disabled={isLoading}>
              {isLoading ? "Loading..." : "Refresh"}
            </Button>
            <Button onClick={copyLogs} variant="outline" size="sm" className="rounded-full active:scale-95" title="Copy logs to clipboard">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button onClick={clearLogs} variant="destructive" size="sm" className="rounded-full active:scale-95">
              Clear Logs
            </Button>
          </div>
          <div className="flex-1 min-h-0 rounded-xl border border-white/[.07] bg-black/30 overflow-hidden">
            <ScrollArea className="h-full w-full min-h-0">
              <pre className="text-xs font-mono whitespace-pre px-4 py-3 leading-5">
                {logLines.length === 0
                  ? <span className="text-zinc-500">No logs available</span>
                  : logLines.map((line, i) => (
                      <span key={i} className={`block ${getLineClass(line)}`}>{line}</span>
                    ))
                }
              </pre>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
