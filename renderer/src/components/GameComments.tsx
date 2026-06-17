"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { CommentMarkdown } from "@/components/CommentMarkdown"
import { AttachSpecsToggle, useAttachSpecsToggle } from "@/components/use-attach-specs"

import { PaginationBar } from "@/components/PaginationBar"
import { apiFetch, apiUpload, apiUrl, getApiBaseUrl } from "@/lib/api"
import { proxyImageUrl } from "@/lib/utils"
import { CommentMentionTextarea } from "@/components/CommentMentionTextarea"
import { MediaLightbox, type LightboxImage } from "@/components/MediaLightbox"
import { CommentSkeleton } from "@/components/CommentSkeleton"
import { MessageCircle, Reply, Share2 } from "@/components/icons"
import { Flag, MessageSquare, Pin, RefreshCw } from "lucide-react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Heart,
  Loader2,
  Paperclip,
  Trash2,
  X,
} from "@/components/icons"
import { useNavigate } from "react-router-dom"

type CommentUser = {
  discordId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  role?: string | null
  isStaff?: boolean
  permissions?: string[]
}

type CommentSystemSpec = {
  summary: string
  fingerprint: string
}

type CommentAttachment = {
  id: string
  fileId?: number
  fileName: string
  mimeType?: string | null
  sizeBytes?: number
  url: string
}

type ThreadCommentPayload = {
  id: string
  body: string
  createdAt: string
  pinned?: boolean
  parentId?: string | null
  likeCount?: number
  likedByMe?: boolean
  deletedBy?: string | null
  author: CommentUser | null
  replies?: ThreadCommentPayload[]
  systemSpec?: CommentSystemSpec | null
  attachments?: CommentAttachment[]
}

type GameComment = {
  id: string
  body: string
  createdAt: string
  pinned?: boolean
  parentId: string | null
  likeCount: number
  likedByMe: boolean
  deletedBy: string | null
  author: CommentUser | null
  replies: GameComment[]
  systemSpec: CommentSystemSpec | null
  attachments: CommentAttachment[]
}

const normalizeComment = (comment: ThreadCommentPayload): GameComment => ({
  ...comment,
  parentId: comment.parentId ?? null,
  likeCount: Number(comment.likeCount ?? 0),
  likedByMe: Boolean(comment.likedByMe ?? false),
  deletedBy: comment.deletedBy ?? null,
  author: comment.author ?? null,
  replies: (comment.replies ?? []).map(normalizeComment),
  systemSpec: comment.systemSpec && comment.systemSpec.summary
    ? { summary: comment.systemSpec.summary, fingerprint: comment.systemSpec.fingerprint || "" }
    : null,
  attachments: Array.isArray(comment.attachments) ? comment.attachments : [],
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
type FilterMode = "all" | "pinned" | "deleted"

const sortThread = (
  thread: GameComment[],
  depth = 0,
  sortMode: SortMode = "pinned",
  filterMode: FilterMode = "all"
): GameComment[] => {
  if (thread.length === 0) return thread
  let base = [...thread]
  if (depth === 0) {
    if (filterMode === "pinned") {
      base = base.filter((comment) => comment.pinned)
    } else if (filterMode === "deleted") {
      base = base.filter((comment) => Boolean(comment.deletedBy))
    }
  }

  const sorted = base.sort((a, b) => {
    if (depth === 0) {
      // Deleted comments sink to bottom
      if (Boolean(a.deletedBy) !== Boolean(b.deletedBy)) {
        return a.deletedBy ? 1 : -1
      }

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

export function GameComments({
  appid,
  gameName,
}: {
  appid: string
  gameName: string
}) {
  const navigate = useNavigate()
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
  // Briefly ring-highlights the section when the user is sent here via a
  // "leave a comment" CTA. Comments are always rendered now (no collapse).
  const [highlighted, setHighlighted] = useState(false)
  const [attachLightbox, setAttachLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null)
  const [attachments, setAttachments] = useState<CommentAttachment[]>([])
  const [uploadingNames, setUploadingNames] = useState<string[]>([])
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const [expandedContinuations, setExpandedContinuations] = useState<Set<string>>(new Set())
  const [visibleReplyCounts, setVisibleReplyCounts] = useState<Record<string, number>>({})
  const [likingId, setLikingId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>("pinned")
  const [filterMode, setFilterMode] = useState<FilterMode>("all")
  const [revealedDeletedIds, setRevealedDeletedIds] = useState<Set<string>>(new Set())
  const specsToggle = useAttachSpecsToggle("comment")
  const itemsPerPage = 10
  const MAX_VISUAL_DEPTH = 3
  const CONTINUATION_DEPTH = 5
  const INITIAL_VISIBLE_REPLIES = 3

  const remaining = useMemo(() => 1000 - body.length, [body.length])
  const sortedComments = useMemo(() => sortThread(comments, 0, sortMode, filterMode), [comments, sortMode, filterMode])
  const totalPages = Math.max(1, Math.ceil(sortedComments.length / itemsPerPage))
  const paginatedComments = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return sortedComments.slice(start, start + itemsPerPage)
  }, [sortedComments, currentPage])
  const deferredPaginatedComments = useDeferredValue(paginatedComments)

  const load = async () => {
    setError(null)
    setLoading(true)
    try {
      const [meRes, listRes] = await Promise.all([
        apiFetch("/api/comments/me"),
        apiFetch(`/api/comments/${appid}`),
      ])

      // The signed-in user is whatever /api/comments/me says — no Discord-only
      // fallback. The old fallback would render a stale avatar from a leftover
      // discord_session cookie even after sign-out, which made it look like
      // the user was still logged in.
      if (meRes.ok) {
        const meData = await meRes.json()
        setUser(meData.user || null)
      } else {
        setUser(null)
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

  // Listen for "jump to comments" requests fired by the rating panel / playtime
  // nudge. Scroll the section into view and flash a highlight (the URL-hash
  // deep-link path doesn't apply inside the launcher's HashRouter).
  useEffect(() => {
    if (typeof window === "undefined") return
    const onFocus = () => {
      document.getElementById("comments")?.scrollIntoView({ behavior: "smooth", block: "start" })
      setHighlighted(true)
      window.setTimeout(() => setHighlighted(false), 2200)
    }
    window.addEventListener("uc:focus-comments", onFocus)
    return () => window.removeEventListener("uc:focus-comments", onFocus)
  }, [])

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

  const connectDiscord = async () => {
    navigate("/login")
  }

  const logout = async () => {
    await apiFetch("/api/comments/session", { method: "DELETE" })
    await window.ucAuth?.logout?.(getApiBaseUrl())
    await load()
  }

  // Uploads files to the comment attachment endpoint (through the auth bridge,
  // so it works in Electron where the renderer has no session cookie). No %
  // progress over IPC, so we show an indeterminate "uploading" row.
  const uploadForComment = async (files: File[]) => {
    setError(null)
    for (const file of files) {
      const name = file.name || "attachment"
      setUploadingNames((prev) => [...prev, name])
      try {
        const res = await apiUpload(`/api/comments/${appid}/attachments/upload`, { file, fileName: name })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.attachment) {
          setError(data?.error || `Failed to upload ${name}`)
        } else {
          setAttachments((prev) => [...prev, data.attachment as CommentAttachment])
        }
      } catch {
        setError(`Failed to upload ${name}`)
      } finally {
        setUploadingNames((prev) => {
          const idx = prev.indexOf(name)
          if (idx < 0) return prev
          const next = [...prev]
          next.splice(idx, 1)
          return next
        })
      }
    }
  }

  const submit = async () => {
    const trimmedBody = body.trim()
    if (!trimmedBody && attachments.length === 0) return

    setPosting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/comments/${appid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: trimmedBody,
          attachments,
          ...(specsToggle.payloadValue !== undefined ? { attachSpecs: specsToggle.payloadValue } : {}),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "Failed to post comment")
      }

      const newComment = normalizeComment(data.comment)
      setComments((prev) => addCommentToTree(prev, null, newComment))
      setBody("")
      setAttachments([])
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
        body: JSON.stringify({
          body: trimmedReply,
          parentId,
          ...(specsToggle.payloadValue !== undefined ? { attachSpecs: specsToggle.payloadValue } : {}),
        }),
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
      // Mark comment as deleted instead of removing it (so replies remain visible)
      const deletedBy = data?.deletedBy || "user"
      setComments((prev) =>
        updateCommentInTree(prev, id, (comment) => ({
          ...comment,
          deletedBy,
          author: null,
          likeCount: 0,
          likedByMe: false,
          pinned: false,
        }))
      )
      setActiveReplyParent((current) => (current === id ? null : current))
    } catch (e: any) {
      setError(e?.message || "Failed to delete comment")
    } finally {
      setDeleting(null)
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
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.hash = `comment-${id}`
    const { copyToClipboard } = await import("@/lib/clipboard")
    const ok = await copyToClipboard(url.toString(), { successMessage: "Comment link copied" })
    if (ok) {
      setCopiedCommentId(id)
      setTimeout(() => setCopiedCommentId(null), 2000)
    } else {
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

  const toggleReplies = (commentId: string, totalReplies: number) => {
    setExpandedReplies((prev) => {
      const next = new Set(prev)
      if (next.has(commentId)) {
        next.delete(commentId)
      } else {
        next.add(commentId)
      }
      return next
    })

    setVisibleReplyCounts((prev) => {
      if (prev[commentId]) return prev
      return {
        ...prev,
        [commentId]: Math.min(totalReplies, INITIAL_VISIBLE_REPLIES),
      }
    })
  }

  const showMoreReplies = (commentId: string, totalReplies: number) => {
    setVisibleReplyCounts((prev) => {
      const current = prev[commentId] ?? Math.min(totalReplies, INITIAL_VISIBLE_REPLIES)
      return {
        ...prev,
        [commentId]: Math.min(totalReplies, current + INITIAL_VISIBLE_REPLIES),
      }
    })
  }

  const toggleContinuation = (commentId: string) => {
    setExpandedContinuations((prev) => {
      const next = new Set(prev)
      if (next.has(commentId)) {
        next.delete(commentId)
      } else {
        next.add(commentId)
      }
      return next
    })
  }

  // Reddit-style thread line colors by depth
  const threadLineColors = [
    "border-blue-500/40",
    "border-violet-500/40",
    "border-emerald-500/40",
    "border-amber-500/40",
    "border-rose-500/40",
  ]

  const renderComment = (comment: GameComment, depth = 0, parentAuthorName?: string) => {
    const hasReplies = comment.replies.length > 0
    const isExpanded = expandedReplies.has(comment.id)
    const isHighlighted = highlightedCommentId === comment.id
    const isPinned = Boolean(comment.pinned)
    const isDeleted = Boolean(comment.deletedBy)
    const isContentRevealed = revealedDeletedIds.has(comment.id)
    const authorRole = comment.author?.role
    const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH)
    const isContinuationCollapsed = depth >= CONTINUATION_DEPTH && hasReplies && !expandedContinuations.has(comment.id)
    const visibleReplyCount = Math.min(comment.replies.length, visibleReplyCounts[comment.id] ?? INITIAL_VISIBLE_REPLIES)
    const hiddenReplyCount = Math.max(0, comment.replies.length - visibleReplyCount)
    const visibleReplies = comment.replies.slice(0, visibleReplyCount)
    const threadColor = depth > 0 ? threadLineColors[(depth - 1) % threadLineColors.length] : ""
    const replyNestClass = depth > 0
      ? `ml-0.5 border-l-2 ${threadColor} pl-1 md:ml-4 md:border-l md:border-white/[.07] md:pl-4`
      : ""
    const mobileReplyLabel = depth > 0
    const desktopReplyLabel = depth >= MAX_VISUAL_DEPTH
    const replyingToLabel = parentAuthorName ? `Replying to @${parentAuthorName}` : "Replying in thread"

    const toggleRevealDeleted = () => {
      setRevealedDeletedIds((prev) => {
        const next = new Set(prev)
        if (next.has(comment.id)) {
          next.delete(comment.id)
        } else {
          next.add(comment.id)
        }
        return next
      })
    }

    const repliesSection = hasReplies ? (
      <div className="mt-4">
        {isContinuationCollapsed ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => toggleContinuation(comment.id)}
            >
              Continue thread {"->"} {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
            </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => toggleReplies(comment.id, comment.replies.length)}
            >
              <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              {isExpanded
                ? "Hide replies"
                : `View replies (${Math.min(comment.replies.length, INITIAL_VISIBLE_REPLIES)} of ${comment.replies.length})`}
            </Button>
            {isExpanded && (
              <div className={`mt-3 space-y-3 ${replyNestClass}`}>
                {visibleReplies.map((reply) =>
                  renderComment(
                    reply,
                    depth + 1,
                    comment.author?.username || comment.author?.displayName || "user"
                  )
                )}
                {hiddenReplyCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => showMoreReplies(comment.id, comment.replies.length)}
                  >
                    View {hiddenReplyCount} more {hiddenReplyCount === 1 ? "reply" : "replies"}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    ) : null

    if (isDeleted) {
      const deletedLabel = comment.deletedBy === "moderator"
        ? "Comment was deleted by moderator"
        : "Comment was deleted by user"

      return (
        <div
          key={comment.id}
          id={`comment-${comment.id}`}
          className={`w-full max-w-full overflow-x-hidden transition-colors ${depth === 0 ? "px-6 py-4" : "py-3"} ${isHighlighted ? "rounded-xl ring-1 ring-primary/40" : ""}`}
        >
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-secondary/30 flex items-center justify-center shrink-0">
              <Trash2 className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <div className="flex-1 min-w-0">
              {(mobileReplyLabel || desktopReplyLabel) && (
                <p className={`mb-1 text-[11px] font-medium text-muted-foreground/80 ${desktopReplyLabel ? "" : "md:hidden"}`}>
                  {replyingToLabel}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground italic">{deletedLabel}</span>
              </div>

              {isContentRevealed ? (
                <div className="mt-2">
                  <CommentMarkdown text={comment.body} className="text-muted-foreground/70 italic" />
                  <button
                    type="button"
                    onClick={toggleRevealDeleted}
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Hide content
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={toggleRevealDeleted}
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Click to view deleted message
                </button>
              )}

              {repliesSection}
            </div>
          </div>
        </div>
      )
    }

    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        className={`w-full max-w-full overflow-x-hidden transition-colors ${depth === 0 ? "px-6 py-4" : "py-3"} ${isPinned ? "bg-primary/[0.04]" : ""} ${isHighlighted ? "rounded-xl ring-1 ring-primary/40" : ""}`}
      >
        <div className="flex items-start gap-3">
          <DiscordAvatar
            avatarUrl={comment.author?.avatarUrl || undefined}
            fallback={comment.author?.avatarUrl ? undefined : undefined}
            alt={comment.author?.username || "Discord user"}
            className="h-10 w-10 rounded-full"
          />
          <div className="flex-1">
            {(mobileReplyLabel || desktopReplyLabel) && (
              <p className={`mb-1 text-[11px] font-medium text-muted-foreground/80 ${desktopReplyLabel ? "" : "md:hidden"}`}>
                {replyingToLabel}
              </p>
            )}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">
                {comment.author?.displayName || comment.author?.username || "Discord user"}
              </span>
              {authorRole && (
                <span className="rounded-full bg-white/10 border border-border px-2 py-0.5 text-[11px] font-semibold text-white">
                  {authorRole}
                </span>
              )}
              {isPinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-400/40 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                  <Pin className="h-3 w-3" />
                  Pinned
                </span>
              )}
              </div>
              <div className="mt-1">
                <span className="text-xs text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleString()}
                </span>
                {comment.systemSpec && (
                  <p className="mt-0.5 text-xs text-foreground/80/85 break-words">
                    {comment.systemSpec.summary}
                  </p>
                )}
              </div>
              </div>
            </div>
            <CommentMarkdown text={comment.body} className="mt-2 text-muted-foreground" />
            {comment.attachments.length > 0 && (() => {
              const imageAttachments = comment.attachments.filter((a) => (a.mimeType || "").startsWith("image/"))
              const fileAttachments = comment.attachments.filter((a) => !(a.mimeType || "").startsWith("image/"))
              const lightboxImages: LightboxImage[] = imageAttachments.map((a) => ({ src: proxyImageUrl(a.url), alt: a.fileName, downloadUrl: a.url }))
              return (
                <div className="mt-3 flex flex-wrap gap-2">
                  {imageAttachments.map((attachment, i) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => setAttachLightbox({ images: lightboxImages, index: i })}
                      className="group relative h-28 w-28 overflow-hidden rounded-xl border border-white/[.07] bg-card/40"
                      title={attachment.fileName}
                    >
                      <img src={proxyImageUrl(attachment.url)} alt={attachment.fileName} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                    </button>
                  ))}
                  {fileAttachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => { try { window.ucSystem?.openExternal?.(attachment.url) } catch { /* ignore */ } }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-foreground/80 hover:bg-secondary/60 transition-colors"
                      title={attachment.fileName}
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="max-w-[220px] truncate">{attachment.fileName}</span>
                      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )
            })()}
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
              {user?.discordId && user?.discordId === comment.author?.discordId && (
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
                <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground">
                  <span>{(replyDrafts[comment.id] ?? "").length} / 1000</span>
                  <div className="flex items-center gap-2">
                    {user && specsToggle.available && (
                      <AttachSpecsToggle value={specsToggle.displayedValue} onChange={specsToggle.onChange} />
                    )}
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

            {repliesSection}
          </div>
        </div>
      </div>
    )
  }

  const renderedComments = useMemo(
    () => deferredPaginatedComments.map((comment) => renderComment(comment)),
    [
      deferredPaginatedComments,
      highlightedCommentId,
      expandedReplies,
      expandedContinuations,
      visibleReplyCounts,
      revealedDeletedIds,
      copiedCommentId,
      reportingId,
      user,
      deleting,
      likingId,
      activeReplyParent,
      replyDrafts,
      replying,
      specsToggle.available,
      specsToggle.displayedValue,
    ]
  )

  return (
    <section className="pt-4 scroll-mt-24" id="comments">
      <div className={`rounded-3xl bg-card/80 border border-border/50 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.12)] overflow-hidden transition-all duration-500 ${highlighted ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""}`}>

        {/* Heading — always open (no collapse toggle). Card chrome is kept so
            the section reads clearly over the game page's ambient background. */}
        <div className="flex items-center gap-3 px-6 py-4">
          <MessageSquare className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">Comments</h2>
            <p className="text-xs text-muted-foreground">
              Share feedback about <span className="font-semibold">{gameName}</span>
            </p>
          </div>
          <Badge className="ml-auto text-xs bg-secondary/30 border-border/50 text-primary border font-medium">
            {comments.length} {comments.length === 1 ? "comment" : "comments"}
          </Badge>
        </div>
              {/* Filter + sort row */}
              <div className="flex flex-wrap gap-2 px-6 py-3 border-t border-border/30 bg-white/[0.015]">
                <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pinned">Pinned first</SelectItem>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                    <SelectItem value="liked">Most liked</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterMode} onValueChange={(value) => setFilterMode(value as FilterMode)}>
                  <SelectTrigger className="h-8 w-[115px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pinned">Pinned only</SelectItem>
                    <SelectItem value="deleted">Deleted only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Compose area */}
              <div className="px-6 py-4 border-t border-border/30 space-y-3">
                {user ? (
                  <div className="flex items-center gap-3">
                    <DiscordAvatar
                      avatarUrl={user.avatarUrl || undefined}
                      alt={user.displayName || user.username}
                      className="h-8 w-8 rounded-full shrink-0"
                    />
                    <span className="text-sm font-semibold text-foreground flex-1">
                      {user.displayName || user.username}
                    </span>
                    <button
                      type="button"
                      onClick={logout}
                      className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      Sign in to post and like comments.
                    </div>
                    <Button size="sm" onClick={() => connectDiscord()}>Sign in</Button>
                  </div>
                )}
                <CommentMentionTextarea
                  value={body}
                  onChange={setBody}
                  placeholder={user ? "Share your thoughts..." : "Login to comment"}
                  disabled={!user}
                  className="min-h-[100px]"
                  maxLength={1000}
                  onFilesSelected={user ? uploadForComment : undefined}
                />
                {(uploadingNames.length > 0 || attachments.length > 0) && (
                  <div className="space-y-1">
                    {uploadingNames.map((name, i) => (
                      <div key={`up-${i}`} className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1.5 text-xs text-muted-foreground/70">
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                        <span className="truncate">Uploading {name}…</span>
                      </div>
                    ))}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((attachment) => (
                          <div key={attachment.id} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-2 py-1 text-xs text-foreground/80">
                            <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="max-w-[220px] truncate">{attachment.fileName}</span>
                            <button
                              type="button"
                              onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                              className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary/70 hover:text-foreground/90"
                              aria-label="Remove attachment"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground/60 gap-2 flex-wrap">
                  <span>{remaining} characters remaining</span>
                  <div className="flex items-center gap-2">
                    {user && specsToggle.available && (
                      <AttachSpecsToggle value={specsToggle.displayedValue} onChange={specsToggle.onChange} />
                    )}
                    <Button size="sm" onClick={submit} disabled={!user || posting || uploadingNames.length > 0}>
                      {posting ? "Posting..." : "Post comment"}
                    </Button>
                  </div>
                </div>
                {error && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </div>

              {/* Comment list — flush rows separated by dividers (1:1 with web) */}
              {loading ? (
                <div className="border-t border-border/30 divide-y divide-white/5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-6 py-4">
                      <CommentSkeleton />
                    </div>
                  ))}
                </div>
              ) : comments.length === 0 ? (
                <div className="border-t border-border/30 px-6 py-8 text-sm text-muted-foreground/60 text-center">
                  No comments yet. Be the first to share your thoughts.
                </div>
              ) : (
                <div className="border-t border-border/30 divide-y divide-white/5">
                  {renderedComments}
                </div>
              )}

              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-border/30">
                  <PaginationBar
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                  />
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

      <MediaLightbox
        open={Boolean(attachLightbox)}
        images={attachLightbox?.images ?? []}
        index={attachLightbox?.index ?? 0}
        onIndexChange={(i) => setAttachLightbox((prev) => (prev ? { ...prev, index: i } : prev))}
        onClose={() => setAttachLightbox(null)}
      />
    </section>
  )
}

