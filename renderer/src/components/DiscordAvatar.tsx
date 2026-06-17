"use client"

import { useEffect, useState } from "react"
import { cn, proxyImageUrl } from "@/lib/utils"

interface DiscordAvatarProps {
  avatarUrl?: string | null
  fallback?: string | null
  alt: string
  className?: string
  /**
   * Render without the decorative border / hover-zoom chrome. Use when the
   * parent already supplies the frame (e.g. the settings profile box), so the
   * avatar is just the image — or a full-bleed fallback initial — filling it.
   */
  bare?: boolean
}

export function DiscordAvatar({ avatarUrl, fallback, alt, className, bare = false }: DiscordAvatarProps) {
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

  // The fallback initial is sized in `cqw` units so it scales with the avatar
  // box (small nav chip → large profile hero) instead of staying a fixed tiny
  // glyph. `containerType: inline-size` (on the wrapper) makes that query unit
  // resolve against this element's size.
  const initialStyle = { fontSize: "45cqw" } as const

  return (
    <div
      className={cn(
        "relative overflow-hidden h-10 w-10",
        !bare && "group transition-all duration-300 hover:scale-[1.05]",
        className,
        // Profile avatars are ALWAYS circles. Passed LAST so it wins over any
        // `rounded-*` a caller put in `className` — there is no "box" mode.
        "rounded-full"
      )}
      style={{ containerType: "inline-size" }}
    >
      <div
        className={cn(
          "h-full w-full rounded-[inherit] overflow-hidden",
          !bare &&
            "border border-white/20 group-hover:border-primary/50 bg-card/95 backdrop-blur-sm transition-all duration-300"
        )}
      >
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
                style={initialStyle}
                className="absolute inset-0 flex items-center justify-center bg-card/95 text-muted-foreground/80 font-bold leading-none select-none animate-pulse"
              >
                {initial}
              </div>
            )}
          </>
        ) : (
          <div
            aria-hidden
            style={initialStyle}
            className="h-full w-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center font-bold leading-none text-foreground/80 select-none"
          >
            {initial}
          </div>
        )}
      </div>
    </div>
  )
}
