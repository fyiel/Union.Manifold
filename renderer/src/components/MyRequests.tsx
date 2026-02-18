import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch, apiUrl } from "@/lib/api"
import {
  CheckCircle,
  Clock,
  Info,
  Link as LinkIcon,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  XCircle,
} from "lucide-react"

export type RequestRecord = {
  id: number
  type: string
  title: string
  description: string
  link: string
  username: string
  discord_id: string | null
  status: string
  claimed_by: string | null
  created_at: string
  updated_at: string
  note: string | null
}

type ViewerRequestsResponse = {
  viewer: { discordId: string | null; match: "discord" | "ip" }
  requests: RequestRecord[]
}

function getTypeIcon(type: string) {
  switch (type) {
    case "new-game":
      return <MessageSquare className="h-4 w-4" />
    case "update":
      return <MessageCircle className="h-4 w-4" />
    case "report-dead-link":
      return <LinkIcon className="h-4 w-4" />
    case "bug-report":
      return <MessageCircle className="h-4 w-4" />
    default:
      return <MessageSquare className="h-4 w-4" />
  }
}

function getTypeLabel(type: string) {
  switch (type) {
    case "new-game":
      return "New Game"
    case "update":
      return "Update"
    case "report-dead-link":
      return "Dead Link"
    case "bug-report":
      return "Bug Report"
    default:
      return type
  }
}

function getStatusBadge(status: string, claimedBy: string | null) {
  if (status === "pending") {
    return (
      <Badge variant="outline" className="font-medium px-3 py-1 rounded-full">
        pending review
      </Badge>
    )
  }
  if (status === "claimed") {
    return (
      <Badge variant="secondary" className="font-medium px-3 py-1 rounded-full">
        in progress{claimedBy ? ` (by ${claimedBy})` : ""}
      </Badge>
    )
  }
  if (status === "done") {
    return (
      <Badge
        variant="outline"
        className="font-medium border-green-500/50 text-green-600 dark:text-green-400 px-3 py-1 rounded-full"
      >
        completed
      </Badge>
    )
  }
  if (status === "declined") {
    return (
      <Badge
        variant="outline"
        className="font-medium border-red-500/50 text-red-600 dark:text-red-400 px-3 py-1 rounded-full"
      >
        declined
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="font-medium px-3 py-1 rounded-full">
      {status}
    </Badge>
  )
}

function groupByStatus(requests: RequestRecord[]) {
  const groups: Record<string, RequestRecord[]> = {
    pending: [],
    claimed: [],
    done: [],
    declined: [],
    other: [],
  }

  for (const request of requests) {
    if (request.status in groups) groups[request.status].push(request)
    else groups.other.push(request)
  }

  return groups
}

export function MyRequests({
  title = "Your Requests",
  showUnauthedHelp = true,
  match = "auto",
}: {
  title?: string
  showUnauthedHelp?: boolean
  match?: "auto" | "ip"
}) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewerMatch, setViewerMatch] = useState<ViewerRequestsResponse["viewer"] | null>(null)
  const [requests, setRequests] = useState<RequestRecord[]>([])

  const grouped = useMemo(() => groupByStatus(requests), [requests])

  const fetchRequests = useCallback(async () => {
    setError(null)
    try {
      const url = match === "ip" ? "/api/requests/me?match=ip" : "/api/requests/me"
      const res = await apiFetch(url)
      if (!res.ok) {
        const raw = await res.text().catch(() => "")
        setError(raw || "Failed to load requests.")
        return
      }
      const data: ViewerRequestsResponse = await res.json()
      setViewerMatch(data.viewer)
      setRequests(data.requests || [])
    } catch {
      setError("Failed to load requests.")
    }
  }, [match])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      await fetchRequests()
      setLoading(false)
    })()
  }, [fetchRequests])

  const refresh = async () => {
    setRefreshing(true)
    await fetchRequests()
    setRefreshing(false)
  }

  const openRequestForm = () => {
    window.open(apiUrl("/request"), "_blank", "noopener")
  }

  return (
    <Card className="border-2 border-border/50 shadow-xl bg-card/60 backdrop-blur-sm rounded-2xl">
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-xl font-bold flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading || refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {showUnauthedHelp && viewerMatch?.match === "ip" && (
          <Alert className="border-2 border-primary/20 bg-primary/5">
            <AlertDescription className="flex flex-col gap-3 text-sm leading-relaxed md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Info className="h-4 w-4" />
                </div>
                <p className="text-muted-foreground">
                  You are seeing requests matched to this IP. Log in to sync request history across devices.
                </p>
              </div>
              <Button
                variant="outline"
                className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                onClick={() => navigate("/settings")}
              >
                Login with Discord
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="space-y-8">
            {Array.from({ length: 2 }).map((_, groupIndex) => (
              <div key={groupIndex}>
                <div className="flex items-center gap-3 mb-4">
                  <Skeleton className="h-6 w-32 bg-muted/40" />
                  <Skeleton className="h-6 w-12 rounded-full bg-muted/40" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <Card key={index} className="border-2 border-border/50 bg-card rounded-2xl overflow-hidden">
                      <CardHeader className="pb-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Skeleton className="h-9 w-9 rounded-lg bg-muted/40 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <Skeleton className="h-4 w-20 mb-1 bg-muted/40" />
                              <Skeleton className="h-5 w-40 bg-muted/40" />
                            </div>
                          </div>
                          <Skeleton className="h-6 w-24 rounded-full bg-muted/40" />
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <Skeleton className="h-12 w-full rounded-lg bg-muted/40" />
                        <Skeleton className="h-10 w-full rounded-lg bg-muted/40" />
                        <div className="flex items-center justify-between pt-2 border-t border-border/50">
                          <Skeleton className="h-4 w-24 bg-muted/40" />
                          <Skeleton className="h-4 w-16 bg-muted/40" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
            {error}
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8">
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30">
                <CheckCircle className="h-10 w-10 text-primary" />
              </div>
            </div>
            <p className="text-lg font-semibold text-foreground">No requests found.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Submit a request at{" "}
              <button type="button" onClick={openRequestForm} className="text-primary hover:underline font-semibold">
                the request form
              </button>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([status, items]) => {
              if (items.length === 0) return null
              return (
                <div key={status}>
                  <div className="flex items-center gap-3 mb-4">
                    <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {status === "other" ? "Other" : status}
                    </p>
                    <Badge variant="outline" className="px-2 py-0.5 text-xs rounded-full">
                      {items.length}
                    </Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {items.map((request) => (
                      <Card key={request.id} className="border-2 border-border/50 bg-card rounded-2xl overflow-hidden">
                        <CardHeader className="pb-3 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                {getTypeIcon(request.type)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                                  {getTypeLabel(request.type)}
                                </p>
                                <p className="text-base font-semibold text-foreground truncate">{request.title}</p>
                              </div>
                            </div>
                            {getStatusBadge(request.status, request.claimed_by)}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground line-clamp-3">{request.description}</p>
                          {request.note ? (
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                              {request.note}
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs text-muted-foreground">
                            <span>{new Date(request.created_at).toLocaleDateString()}</span>
                            <span>{request.username}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(request.link, "_blank", "noopener")}
                              disabled={!request.link}
                            >
                              View link
                            </Button>
                            {request.status === "declined" ? (
                              <div className="flex items-center gap-2 text-xs text-red-500">
                                <XCircle className="h-4 w-4" />
                                Declined
                              </div>
                            ) : request.status === "done" ? (
                              <div className="flex items-center gap-2 text-xs text-green-500">
                                <CheckCircle className="h-4 w-4" />
                                Completed
                              </div>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
