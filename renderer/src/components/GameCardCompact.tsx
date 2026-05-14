"use client"

import { Link } from "react-router-dom"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { getCardImage, proxyImageUrl } from "@/lib/utils"
import { nsfwRevealedAppids } from "@/lib/nsfw-session"
import { GameActionContextMenu, type CollectionPickerEntry } from "@/components/GameActionMenu"
import { useUserCollections } from "@/hooks/use-user-collections"

type CompactGame = {
  appid: string
  name: string
  image: string
  splash?: string
  hero_image?: string
  background_image?: string
  localImage?: string
  localSplash?: string
  localHeroImage?: string
  localBackgroundImage?: string
  genres: string[]
}

export const GameCardCompact = memo(function GameCardCompact({ game }: { game: CompactGame }) {
  const [allowNsfwReveal, setAllowNsfwReveal] = useState(false)
  const [sessionRevealed, setSessionRevealed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const isNSFW = game.genres?.some((genre) => genre.toLowerCase() === "nsfw")
  const cardImageSrc = proxyImageUrl(getCardImage(game.image || "")) || "./banner.png"

  const userCollections = useUserCollections()
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const closeContextMenu = useCallback(() => setContextMenuPos(null), [])

  const collectionPicker = useMemo(() => ({
    collections: userCollections.collections.map<CollectionPickerEntry>((c) => ({
      id: c.id,
      name: c.name,
      included: c.appids.includes(game.appid),
    })),
    onAddToCollection: async (collectionId: string) => {
      const target = userCollections.collections.find((c) => c.id === collectionId)
      if (!target) return
      if (!target.appids.includes(game.appid)) {
        await userCollections.setMembership(target, [...target.appids, game.appid])
      }
    },
    onRemoveFromCollection: async (collectionId: string) => {
      const target = userCollections.collections.find((c) => c.id === collectionId)
      if (!target) return
      await userCollections.setMembership(target, target.appids.filter((id) => id !== game.appid))
    },
    onCreateCollection: async (name: string) => {
      await userCollections.create(name, [game.appid])
    },
  }), [userCollections, game.appid])

  useEffect(() => {
    const syncPreference = () => {
      try {
        setAllowNsfwReveal(localStorage.getItem("uc_show_nsfw") === "1")
      } catch {
        // ignore
      }
    }

    syncPreference()

    const onStorage = (e: StorageEvent) => {
      if (e.key === "uc_show_nsfw") syncPreference()
    }
    const onPreferenceChange = () => syncPreference()

    window.addEventListener("storage", onStorage)
    window.addEventListener("uc_nsfw_pref", onPreferenceChange)

    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("uc_nsfw_pref", onPreferenceChange)
    }
  }, [])

  // Session reveal: in-memory only - resets on page reload, never persisted to storage.
  useEffect(() => {
    const checkSession = () => setSessionRevealed(nsfwRevealedAppids.has(game.appid))
    checkSession()
    window.addEventListener("uc_nsfw_session_changed", checkSession)
    return () => window.removeEventListener("uc_nsfw_session_changed", checkSession)
  }, [game.appid])

  useEffect(() => {
    setImageLoaded(false)
  }, [cardImageSrc])

  return (
    <div
      className="relative"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenuPos({ x: e.clientX, y: e.clientY })
      }}
    >
      <Link to={`/game/${game.appid}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-900/80 transition hover:border-zinc-700/50">
        <div className="relative aspect-[3/4]">
          {!imageLoaded && <div className="udl-skeleton absolute inset-0 z-0 rounded-none" />}

          <img
            src={cardImageSrc}
            alt={game.name}
            loading="lazy"
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${
              isNSFW && !(sessionRevealed || allowNsfwReveal)
                ? "blur-xl brightness-50"
                : ""
            }`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(true)}
          />
          {/* NSFW overlay: show Reveal button when not revealed */}
          {isNSFW && !(sessionRevealed || allowNsfwReveal) && (
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
              <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold">18+</div>
              <button
                type="button"
                aria-label={`Reveal NSFW cover for ${game.name}`}
                className="mt-1 bg-white/10 hover:bg-white/20 focus:bg-white/25 text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  nsfwRevealedAppids.add(game.appid)
                  setSessionRevealed(true)
                  window.dispatchEvent(new Event('uc_nsfw_session_changed'))
                }}
              >
                Reveal
              </button>
              <span className="text-white/50 text-[10px]">Tap to reveal</span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent px-4 py-3">
            <span className="sr-only">{game.name}</span>
            <p className="text-sm font-semibold text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              {game.name}
            </p>
          </div>
        </div>
      </div>
      </Link>
      <GameActionContextMenu
        open={contextMenuPos != null}
        position={contextMenuPos}
        onClose={closeContextMenu}
        gameName={game.name}
        onSetExecutable={null}
        onOpenFiles={null}
        onCreateShortcut={null}
        onDelete={null}
        collectionPicker={collectionPicker}
      />
    </div>
  )
})

