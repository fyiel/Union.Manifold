"use client"

import { useEffect, useState } from "react"
import { proxyImageUrl } from "@/lib/utils"

interface DiscordAvatarProps {
  avatarUrl?: string | null
  fallback?: string | null
  alt: string
  className?: string
}

export function DiscordAvatar({ avatarUrl, fallback, alt, className }: DiscordAvatarProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const preferredSrc = avatarUrl?.trim() || null
  const fallbackSrc = fallback?.trim() || null
  const rawSrc = (() => {
    if (preferredSrc && failedSource !== preferredSrc) return preferredSrc
    if (fallbackSrc && failedSource !== fallbackSrc) return fallbackSrc
    return null
  })()
  const proxiedSrc = rawSrc ? proxyImageUrl(rawSrc) : undefined
  const showImage = Boolean(proxiedSrc)
  const initial = alt?.trim()[0]?.toUpperCase() ?? "?"

  useEffect(() => {
    setLoaded(false)
  }, [rawSrc])

  return (
    <div
      className={`relative group rounded-full overflow-hidden transition-all duration-300 hover:scale-[1.05] ${className || "h-10 w-10"}`}
    >
      <div className="h-full w-full border border-white/20 hover:border-primary/50 rounded-full bg-card/95 backdrop-blur-sm transition-all duration-300 overflow-hidden">
        {showImage ? (
          <>
            <img
              src={proxiedSrc}
              alt={alt}
              onLoad={() => setLoaded(true)}
              onError={() => {
                setFailedSource(rawSrc)
                setLoaded(true)
              }}
              className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
            {!loaded && (
              <div
                aria-hidden
                className="absolute inset-0 flex items-center justify-center bg-card/95 text-muted-foreground/80 font-bold text-sm select-none animate-pulse"
              >
                {initial}
              </div>
            )}
          </>
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center font-bold text-sm text-foreground/80 select-none"
          >
            {initial}
          </div>
        )}
      </div>
    </div>
  )
}
