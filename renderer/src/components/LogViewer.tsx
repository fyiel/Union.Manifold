import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { logger } from "@/lib/logger"

export function LogViewer() {
  const [logs, setLogs] = useState<string>("")
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

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
      <DialogContent className="max-w-2xl max-h-[60vh]">
        <DialogHeader>
          <DialogTitle>Application Logs</DialogTitle>
          <DialogDescription>
            View and manage UnionCrax.Direct application logs
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 mb-2">
          <Button onClick={fetchLogs} size="sm" disabled={isLoading}>
            {isLoading ? "Loading..." : "Refresh"}
          </Button>
          <Button onClick={clearLogs} variant="destructive" size="sm">
            Clear Logs
          </Button>
        </div>
        <ScrollArea className="h-[300px] w-full rounded-md border p-4">
          <pre className="text-xs font-mono whitespace-pre-wrap break-words">
            {logs || "No logs available"}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
