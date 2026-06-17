import { useCallback, useEffect, useRef, useState } from "react"
import { UserRound, Paperclip } from "@/components/icons"
import { cn, proxyImageUrl } from "@/lib/utils"
import { apiFetch } from "@/lib/api"

// Mirrors the desktop ui/textarea styling (which isn't ref-forwarding, so we
// use a plain <textarea> here to drive cursor-aware @-mention insertion).
const TEXTAREA_CLASS =
  "bg-card border border-border text-foreground/90 placeholder:text-muted-foreground/60 flex field-sizing-content min-h-16 w-full rounded-2xl px-3 py-2 text-base transition-colors outline-none focus-visible:border-white disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"

type MentionUser = {
  username: string
  displayName: string | null
  avatarUrl: string | null
}

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  className?: string
  rows?: number
  onFilesSelected?: (files: File[]) => void
}

/**
 * Comment composer textarea with @-mention autocomplete (1:1 with the website's
 * components/comment-mention-textarea.tsx). Queries /api/forums/user-mention
 * for suggestions and inserts `@username` at the caret.
 */
export function CommentMentionTextarea({
  value,
  onChange,
  placeholder,
  maxLength,
  disabled,
  className,
  rows,
  onFilesSelected,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const dropRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fetchIdRef = useRef(0)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [triggerStart, setTriggerStart] = useState(-1)
  const [triggerEnd, setTriggerEnd] = useState(-1)
  const [results, setResults] = useState<MentionUser[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !query || disabled) {
      if (!open) setResults([])
      return
    }
    const id = ++fetchIdRef.current
    const timeout = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await apiFetch(`/api/forums/user-mention?q=${encodeURIComponent(query)}`)
        const data = res.ok ? await res.json() : []
        if (fetchIdRef.current !== id) return
        setResults(Array.isArray(data) ? data : [])
        setSelected(0)
      } catch {
        if (fetchIdRef.current !== id) return
        setResults([])
      } finally {
        if (fetchIdRef.current === id) setLoading(false)
      }
    }, 180)
    return () => clearTimeout(timeout)
  }, [open, query, disabled])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (event: MouseEvent) => {
      if (!taRef.current?.contains(event.target as Node) && !dropRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  const insertMention = useCallback((user: MentionUser) => {
    if (!taRef.current || triggerStart < 0 || triggerEnd < 0) return
    const before = value.slice(0, triggerStart)
    const after = value.slice(triggerEnd)
    const next = `${before}@${user.username} ${after}`
    onChange(next)
    setOpen(false)
    setResults([])
    const nextCaret = before.length + user.username.length + 2
    setTimeout(() => {
      taRef.current?.focus()
      taRef.current?.setSelectionRange(nextCaret, nextCaret)
    }, 0)
  }, [value, triggerStart, triggerEnd, onChange])

  const handleTextChange = useCallback((nextValue: string, cursorPos: number) => {
    onChange(nextValue)
    const prefix = nextValue.slice(0, cursorPos)
    const mentionMatch = prefix.match(/(^|\s)@([a-zA-Z0-9_.-]{1,32})$/)
    if (!mentionMatch) {
      setOpen(false)
      return
    }
    const atIndex = prefix.lastIndexOf("@")
    if (atIndex < 0) {
      setOpen(false)
      return
    }
    setTriggerStart(atIndex)
    setTriggerEnd(cursorPos)
    setQuery(mentionMatch[2])
    setOpen(true)
  }, [onChange])

  const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value
    const cursor = event.target.selectionStart ?? nextValue.length
    handleTextChange(nextValue, cursor)
  }

  const onTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || results.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setSelected((idx) => Math.min(idx + 1, results.length - 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setSelected((idx) => Math.max(idx - 1, 0))
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const picked = results[selected]
      if (picked) insertMention(picked)
    }
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) onFilesSelected?.(files)
    event.target.value = ""
  }

  return (
    <div className="relative w-full">
      {open && (
        <div
          ref={dropRef}
          className="absolute left-0 right-0 bottom-full mb-1.5 z-50 rounded-xl border border-white/[.07] bg-card/95 backdrop-blur-md shadow-[0_-8px_24px_rgba(0,0,0,0.45)] overflow-hidden"
        >
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching users...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground/80">No matching users</div>
          ) : (
            <div className="max-h-52 overflow-y-auto py-1">
              {results.map((user, idx) => {
                const isActive = idx === selected
                const label = user.displayName || user.username
                return (
                  <button
                    key={user.username}
                    type="button"
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${isActive ? "bg-secondary/60" : "hover:bg-secondary/40"}`}
                    onMouseEnter={() => setSelected(idx)}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(user) }}
                  >
                    <span className="h-7 w-7 rounded-full border border-white/[.07] bg-secondary/50 flex items-center justify-center overflow-hidden shrink-0">
                      {user.avatarUrl ? (
                        <img src={proxyImageUrl(user.avatarUrl)} alt={label} className="h-full w-full object-cover" />
                      ) : (
                        <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground/90">{label}</span>
                      <span className="block truncate text-muted-foreground/80">@{user.username}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <textarea
        ref={taRef}
        value={value}
        onChange={onTextareaChange}
        onKeyDown={onTextareaKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        rows={rows}
        className={cn(TEXTAREA_CLASS, className)}
      />

      {/* Toolbar */}
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground/50 select-none">
        {onFilesSelected && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-card/50 text-foreground/80 transition-colors hover:bg-secondary/70 disabled:pointer-events-none disabled:opacity-40"
            aria-label="Add attachment"
            title="Add attachment"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}
        <span>Type <code className="font-mono text-primary/70 bg-secondary/30 border border-border/50 px-1 py-px rounded text-[10px]">@</code> to mention a user</span>
      </div>

      {onFilesSelected && (
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
      )}
    </div>
  )
}
