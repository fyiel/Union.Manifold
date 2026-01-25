import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Copy, Check } from "lucide-react"
import { logger } from "@/lib/logger"

export function LogViewer() {
  const [logs, setLogs] = useState<string>("")
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)

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
      <DialogContent className="max-w-4xl w-[min(90vw,1100px)] h-[85vh] max-h-[85vh] min-h-[60vh] flex flex-col overflow-hidden">
        <DialogHeader className="pb-2">
          <DialogTitle>Application Logs</DialogTitle>
          <DialogDescription>
            View and manage UnionCrax.Direct application logs
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 pb-3">
          <Button onClick={fetchLogs} size="sm" disabled={isLoading}>
            {isLoading ? "Loading..." : "Refresh"}
          </Button>
          <Button onClick={copyLogs} variant="outline" size="sm" title="Copy logs to clipboard">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
          <Button onClick={clearLogs} variant="destructive" size="sm">
            Clear Logs
          </Button>
        </div>
        <div className="flex-1 min-h-0 rounded-lg border bg-background overflow-hidden">
          <ScrollArea className="h-full w-full min-h-0">
            <pre className="text-xs md:text-sm font-mono whitespace-pre px-4 py-3">
              {logs || "No logs available"}
            </pre>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
