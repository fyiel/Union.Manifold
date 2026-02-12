"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { isStaff, STAFF_ROLES } from "@/lib/staff-roles"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { CommentSkeleton } from "@/components/CommentSkeleton"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Flag,
  Heart,
  MessageCircle,
  MessageSquare,
  Pin,
  RefreshCw,
  Reply,
  Share2,
  Trash2,
} from "lucide-react"

type CommentUser = {
  discordId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  role?: string | null
}

type ThreadCommentPayload = {
  id: string
  body: string
  createdAt: string
  pinned?: boolean
  parentId?: string | null
  likeCount?: number
  likedByMe?: boolean
  author: CommentUser
  replies?: ThreadCommentPayload[]
}

type GameComment = {
  id: string
  body: string
  createdAt: string
  pinned?: boolean
  parentId: string | null
  likeCount: number
  likedByMe: boolean
  author: CommentUser
  replies: GameComment[]
}

const normalizeComment = (comment: ThreadCommentPayload): GameComment => ({
  ...comment,
  parentId: comment.parentId ?? null,
  likeCount: Number(comment.likeCount ?? 0),
  likedByMe: Boolean(comment.likedByMe ?? false),
  replies: (comment.replies ?? []).map(normalizeComment),
})

const addCommentToTree = (tree: GameComment[], parentId: string | null, newComment: GameComment): GameComment[] => {
  if (!parentId) {
    return [newComment, ...tree]
  }
  if (tree.length === 0) return tree

  let updated = false
  const nextTree = tree.map((comment) => {
    if (updated) return comment
    if (comment.id === parentId) {
      updated = true
      return { ...comment, replies: [...comment.replies, newComment] }
    }
    const nextReplies = addCommentToTree(comment.replies, parentId, newComment)
    if (nextReplies !== comment.replies) {
      updated = true
      return { ...comment, replies: nextReplies }
    }
    return comment
  })

  return updated ? nextTree : tree
}

const removeCommentFromTree = (tree: GameComment[], targetId: string): GameComment[] => {
  if (tree.length === 0) return tree

  let changed = false
  const nextTree: GameComment[] = []
  for (const comment of tree) {
    if (comment.id === targetId) {
      changed = true
      continue
    }
    const nextReplies = removeCommentFromTree(comment.replies, targetId)
    if (nextReplies !== comment.replies) {
      changed = true
      nextTree.push({ ...comment, replies: nextReplies })
    } else {
      nextTree.push(comment)
    }
  }

  return changed ? nextTree : tree
}

const updateCommentInTree = (
  tree: GameComment[],
  targetId: string,
  updater: (comment: GameComment) => GameComment
): GameComment[] => {
  if (tree.length === 0) return tree

  let changed = false
  const nextTree = tree.map((comment) => {
    if (comment.id === targetId) {
      changed = true
      return updater(comment)
    }
    const nextReplies = updateCommentInTree(comment.replies, targetId, updater)
    if (nextReplies !== comment.replies) {
      changed = true
      return { ...comment, replies: nextReplies }
    }
    return comment
  })

  return changed ? nextTree : tree
}

type SortMode = "pinned" | "newest" | "oldest" | "liked"
type FilterMode = "all" | "pinned"

const sortThread = (
  thread: GameComment[],
  depth = 0,
  sortMode: SortMode = "pinned",
  filterMode: FilterMode = "all"
): GameComment[] => {
  if (thread.length === 0) return thread
  let base = [...thread]
  if (depth === 0 && filterMode === "pinned") {
    base = base.filter((comment) => comment.pinned)
  }

  const sorted = base.sort((a, b) => {
    if (depth === 0) {
      if (sortMode === "pinned") {
        if (Number(Boolean(a.pinned)) !== Number(Boolean(b.pinned))) {
          return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
      if (sortMode === "liked") {
        if (a.likeCount !== b.likeCount) {
          return b.likeCount - a.likeCount
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
      if (sortMode === "oldest") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  return sorted.map((comment) => ({
    ...comment,
    replies: sortThread(comment.replies, depth + 1, sortMode, filterMode),
  }))
}

export function GameComments({ appid, gameName }: { appid: string; gameName: string }) {
  const [user, setUser] = useState<CommentUser | null>(null)
  const [comments, setComments] = useState<GameComment[]>([])
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pinning, setPinning] = useState<string | null>(null)
  const [replying, setReplying] = useState<string | null>(null)
  const [body, setBody] = useState("")
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [activeReplyParent, setActiveReplyParent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null)
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)
  const [didHashScroll, setDidHashScroll] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState("")
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [reportedId, setReportedId] = useState<string | null>(null)
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const [likingId, setLikingId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>("pinned")
  const [filterMode, setFilterMode] = useState<FilterMode>("all")
  const itemsPerPage = 10

  const remaining = useMemo(() => 1000 - body.length, [body.length])
  const canModerate = useMemo(() => (user ? isStaff(user.discordId) : false), [user])
  const sortedComments = useMemo(() => sortThread(comments, 0, sortMode, filterMode), [comments, sortMode, filterMode])
  const totalPages = Math.max(1, Math.ceil(sortedComments.length / itemsPerPage))
  const paginatedComments = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return sortedComments.slice(start, start + itemsPerPage)
  }, [sortedComments, currentPage])

  const loadFallbackUser = async () => {
    try {
      let discordId: string | null = null
      try {
        const sessionRes = await apiFetch("/api/discord/session")
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json()
          if (sessionData?.discordId) discordId = sessionData.discordId
        }
      } catch {
        // ignore
      }

      if (!discordId && window.ucAuth?.getSession) {
        try {
          const res = await window.ucAuth.getSession(getApiBaseUrl())
          if (res?.discordId) discordId = res.discordId
        } catch {
          // ignore
        }
      }

      if (!discordId) return null
      if (!discordId) return null
      const avatarRes = await apiFetch(`/api/discord-avatar/${encodeURIComponent(discordId)}`)
      if (!avatarRes.ok) return null
      const avatarData = await avatarRes.json()
      return {
        discordId,
        username: avatarData?.username || "Discord user",
        displayName: avatarData?.displayName || null,
        avatarUrl: avatarData?.avatar || null,
      } as CommentUser
    } catch {
      return null
    }
  }

  const load = async () => {
    setError(null)
    setLoading(true)
    try {
      const [meRes, listRes] = await Promise.all([
        apiFetch("/api/comments/me"),
        apiFetch(`/api/comments/${appid}`),
      ])

      if (meRes.ok) {
        const meData = await meRes.json()
        setUser(meData.user)
      } else {
        const sessionRes = await apiFetch("/api/comments/session", { method: "POST" })
        if (sessionRes.ok) {
          const nextMe = await apiFetch("/api/comments/me")
          if (nextMe.ok) {
            const meData = await nextMe.json()
            setUser(meData.user)
          } else {
            const fallback = await loadFallbackUser()
            setUser(fallback)
          }
        } else {
          const fallback = await loadFallbackUser()
          setUser(fallback)
        }
      }

      if (!listRes.ok) {
        throw new Error(`Failed to load comments: ${listRes.status}`)
      }

      const listData = await listRes.json()
      const normalized: ThreadCommentPayload[] = listData.comments || []
      setComments(normalized.map(normalizeComment))
      setReplyDrafts({})
      setActiveReplyParent(null)
      setReplying(null)
      setCurrentPage(1)
    } catch (e: any) {
      setError(e?.message || "Failed to load comments")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appid])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleHashScroll = () => {
      const hash = window.location.hash
      if (!hash) return
      if (!hash.startsWith("#comment-")) return
      const targetId = hash.replace(/^#/, "") || "comments"

      const t = setTimeout(() => {
        const el = document.getElementById(targetId) || document.getElementById("comments")
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" })
          if (targetId.startsWith("comment-")) {
            setHighlightedCommentId(targetId.replace("comment-", ""))
          }
          setDidHashScroll(true)
        }
      }, 100)

      return () => clearTimeout(t)
    }

    if (!didHashScroll) {
      handleHashScroll()
    }

    const onHashChange = () => {
      handleHashScroll()
    }
    window.addEventListener("hashchange", onHashChange)
    return () => {
      window.removeEventListener("hashchange", onHashChange)
    }
  }, [didHashScroll, sortedComments.length])

  useEffect(() => {
    if (!highlightedCommentId) return
    const timeout = setTimeout(() => setHighlightedCommentId(null), 3000)
    return () => clearTimeout(timeout)
  }, [highlightedCommentId])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.location.hash?.startsWith("#comment-")) return
    const el = document.getElementById("comments")
    if (el && currentPage !== 1) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [sortMode, filterMode])

  const connectDiscord = async (anchorId = "comments") => {
    const next = encodeURIComponent(`/game/${appid}#${anchorId}`)
    if (window.ucAuth?.login) {
      await window.ucAuth.login(getApiBaseUrl())
      await load()
      return
    }
    window.open(apiUrl(`/api/discord/connect?next=${next}`), "_blank")
  }

  const logout = async () => {
    await apiFetch("/api/comments/session", { method: "DELETE" })
    await window.ucAuth?.logout?.(getApiBaseUrl())
    await load()
  }

  const submit = async () => {
    const trimmedBody = body.trim()
    if (!trimmedBody) return

    setPosting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/comments/${appid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmedBody }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to post comment")
      }

      const newComment = normalizeComment(data.comment)
      setComments((prev) => addCommentToTree(prev, null, newComment))
      setBody("")
    } catch (e: any) {
      setError(e?.message || "Failed to post comment")
    } finally {
      setPosting(false)
    }
  }

  const submitReply = async (parentId: string) => {
    const replyBody = replyDrafts[parentId] ?? ""
    const trimmedReply = replyBody.trim()
    if (!trimmedReply) return

    setReplying(parentId)
    setError(null)
    try {
      const res = await apiFetch(`/api/comments/${appid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmedReply, parentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to post reply")
      }
      const newComment = normalizeComment(data.comment)
      setComments((prev) => addCommentToTree(prev, parentId, newComment))
      setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }))
      setActiveReplyParent(null)
    } catch (e: any) {
      setError(e?.message || "Failed to post reply")
    } finally {
      setReplying(null)
    }
  }

  const deleteComment = async (id: string) => {
    setDeleting(id)
    setError(null)
    try {
      const res = await apiFetch(`/api/comments/${appid}?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete comment")
      }
      setComments((prev) => removeCommentFromTree(prev, id))
      setActiveReplyParent((current) => (current === id ? null : current))
    } catch (e: any) {
      setError(e?.message || "Failed to delete comment")
    } finally {
      setDeleting(null)
    }
  }

  const togglePin = async (id: string, nextPinned: boolean) => {
    setPinning(id)
    setError(null)
    try {
      const res = await apiFetch(`/api/comments/${appid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, pinned: nextPinned }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update pin")
      }
      setComments((prev) => updateCommentInTree(prev, id, (comment) => ({ ...comment, pinned: nextPinned })))
    } catch (e: any) {
      setError(e?.message || "Failed to update pin")
    } finally {
      setPinning(null)
    }
  }

  const toggleLike = async (id: string, liked: boolean) => {
    setLikingId(id)
    setError(null)
    try {
      const res = await apiFetch(`/api/comments/like`, {
        method: liked ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appid, commentId: id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update like")
      }
      setComments((prev) =>
        updateCommentInTree(prev, id, (comment) => ({
          ...comment,
          likedByMe: !liked,
          likeCount: Math.max(0, comment.likeCount + (liked ? -1 : 1)),
        }))
      )
    } catch (e: any) {
      setError(e?.message || "Failed to update like")
    } finally {
      setLikingId(null)
    }
  }

  const shareComment = async (id: string) => {
    try {
      if (typeof window === "undefined") return
      const url = new URL(window.location.href)
      url.hash = `comment-${id}`
      await navigator.clipboard.writeText(url.toString())
      setCopiedCommentId(id)
      setTimeout(() => setCopiedCommentId(null), 2000)
    } catch {
      setError("Failed to copy link")
    }
  }

  const reportComment = async () => {
    if (!reportingId) return
    const trimmed = reportReason.trim()
    if (!trimmed) return

    setReportSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/comments/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appid, commentId: reportingId, reason: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to report comment")
      }
      setReportedId(reportingId)
      setReportingId(null)
      setReportReason("")
    } catch (e: any) {
      setError(e?.message || "Failed to report comment")
    } finally {
      setReportSubmitting(false)
    }
  }

  const toggleReplies = (commentId: string) => {
    setExpandedReplies((prev) => {
      const next = new Set(prev)
      if (next.has(commentId)) {
        next.delete(commentId)
      } else {
        next.add(commentId)
      }
      return next
    })
  }

  const renderComment = (comment: GameComment, depth = 0) => {
    const hasReplies = comment.replies.length > 0
    const isExpanded = expandedReplies.has(comment.id)
    const isHighlighted = highlightedCommentId === comment.id
    const isPinned = Boolean(comment.pinned)
    const authorRole = comment.author?.discordId && STAFF_ROLES[comment.author.discordId]

    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        className={`rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5 transition-shadow ${
          depth > 0 ? "ml-4 sm:ml-10" : ""
        } ${isPinned ? "ring-1 ring-primary/40" : ""} ${isHighlighted ? "shadow-lg shadow-primary/30" : ""}`}
      >
        <div className="flex items-start gap-3">
          <DiscordAvatar
            avatarUrl={comment.author?.avatarUrl || undefined}
            fallback={comment.author?.avatarUrl ? undefined : undefined}
            alt={comment.author?.username || "Discord user"}
            className="h-10 w-10 rounded-full"
          />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">
                {comment.author?.displayName || comment.author?.username || "Discord user"}
              </span>
              {authorRole && (
                <span className="rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {authorRole}
                </span>
              )}
              {isPinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-400/40 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                  <Pin className="h-3 w-3" />
                  Pinned
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date(comment.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {comment.body}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3"
                onClick={() => toggleLike(comment.id, comment.likedByMe)}
                disabled={likingId === comment.id}
              >
                <Heart className={`h-4 w-4 mr-1 ${comment.likedByMe ? "text-rose-400" : ""}`} />
                {comment.likeCount}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3"
                onClick={() => {
                  setActiveReplyParent((prev) => (prev === comment.id ? null : comment.id))
                  setReplyDrafts((prev) => ({ ...prev, [comment.id]: prev[comment.id] || "" }))
                }}
              >
                <Reply className="h-4 w-4 mr-1" />
                Reply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3"
                onClick={() => shareComment(comment.id)}
              >
                <Share2 className="h-4 w-4 mr-1" />
                {copiedCommentId === comment.id ? "Copied" : "Share"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3"
                onClick={() => {
                  setReportingId(comment.id)
                  setReportReason("")
                }}
              >
                <Flag className="h-4 w-4 mr-1" />
                Report
              </Button>
              {canModerate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-3"
                  onClick={() => togglePin(comment.id, !comment.pinned)}
                  disabled={pinning === comment.id}
                >
                  <Pin className="h-4 w-4 mr-1" />
                  {comment.pinned ? "Unpin" : "Pin"}
                </Button>
              )}
              {(canModerate || user?.discordId === comment.author?.discordId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-3 text-destructive"
                  onClick={() => deleteComment(comment.id)}
                  disabled={deleting === comment.id}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>

            {activeReplyParent === comment.id && (
              <div className="mt-4 space-y-2">
                <Textarea
                  value={replyDrafts[comment.id] ?? ""}
                  onChange={(e) =>
                    setReplyDrafts((prev) => ({
                      ...prev,
                      [comment.id]: e.target.value,
                    }))
                  }
                  className="min-h-[90px]"
                  placeholder={`Reply to ${comment.author?.displayName || comment.author?.username || "user"}...`}
                  maxLength={1000}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{(replyDrafts[comment.id] ?? "").length} / 1000</span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveReplyParent(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => submitReply(comment.id)}
                      disabled={replying === comment.id}
                    >
                      {replying === comment.id ? "Posting..." : "Reply"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {hasReplies && (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => toggleReplies(comment.id)}
                >
                  <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  {isExpanded ? "Hide" : "Show"} {comment.replies.length} replies
                </Button>
                {isExpanded && (
                  <div className="mt-3 space-y-3">
                    {comment.replies.map((reply) => renderComment(reply, depth + 1))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="container mx-auto px-4 py-16" id="comments">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-black text-foreground font-montserrat flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-primary" />
              Comments
            </h2>
            <p className="text-sm text-muted-foreground">
              Share feedback about <span className="font-semibold">{gameName}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pinned">Pinned</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="liked">Most liked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterMode} onValueChange={(value) => setFilterMode(value as FilterMode)}>
              <SelectTrigger className="h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pinned">Pinned only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-5 space-y-4">
            {user ? (
              <div className="flex items-center gap-3">
                <DiscordAvatar
                  avatarUrl={user.avatarUrl || undefined}
                  alt={user.displayName || user.username}
                  className="h-10 w-10 rounded-full"
                />
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {user.displayName || user.username}
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MessageCircle className="h-4 w-4" />
                  Sign in with Discord to post and like comments.
                </div>
                <Button size="sm" onClick={() => connectDiscord("comments")}>Login with Discord</Button>
              </div>
            )}

            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={user ? "Share your thoughts..." : "Login to comment"}
              disabled={!user}
              className="min-h-[120px]"
              maxLength={1000}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{remaining} characters remaining</span>
              <Button size="sm" onClick={submit} disabled={!user || posting}>
                {posting ? "Posting..." : "Post comment"}
              </Button>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <CommentSkeleton key={i} />
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
            No comments yet. Be the first to share your thoughts.
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedComments.map((comment) => renderComment(comment))}
            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => setCurrentPage(page)}
                        isActive={currentPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        )}
      </div>

      <Dialog open={Boolean(reportingId)} onOpenChange={(open) => {
        if (!open) {
          setReportingId(null)
          setReportReason("")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report comment</DialogTitle>
            <DialogDescription>Tell us why you are reporting this comment.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="Describe the issue"
            className="min-h-[120px]"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReportingId(null)}>
              Cancel
            </Button>
            <Button onClick={reportComment} disabled={reportSubmitting || !reportReason.trim()}>
              {reportSubmitting ? "Submitting..." : "Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reportedId)} onOpenChange={(open) => {
        if (!open) setReportedId(null)
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report submitted</DialogTitle>
            <DialogDescription>Thanks for helping keep the community safe.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setReportedId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
