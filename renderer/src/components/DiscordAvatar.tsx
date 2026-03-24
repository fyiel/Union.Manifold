"use client"

import { useEffect, useState } from "react"

interface DiscordAvatarProps {
  avatarUrl?: string | null
  fallback?: string | null
  alt: string
  className?: string
}

export function DiscordAvatar({ avatarUrl, fallback, alt, className }: DiscordAvatarProps) {
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    setImageError(false)
  }, [avatarUrl, fallback])

  const src = (imageError || !avatarUrl ? fallback : avatarUrl) || undefined
  const showImage = Boolean(src)

  return (
    <div
      className={`relative group rounded-full overflow-hidden transition-all duration-300 hover:scale-[1.05] ${className || "h-10 w-10"}`}
    >
      <div className="h-full w-full border border-white/20 hover:border-primary/50 rounded-full bg-zinc-900/95 backdrop-blur-sm transition-all duration-300">
        {showImage ? (
          <img src={src} alt={alt} onError={() => setImageError(true)} className="h-full w-full object-cover" />
        ) : (
          <div aria-hidden className="h-full w-full bg-gradient-to-br from-primary/10 to-primary/5" />
        )}
      </div>
    </div>
  )
}

