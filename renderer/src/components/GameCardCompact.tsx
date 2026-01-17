"use client"

import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { proxyImageUrl } from "@/lib/utils"

type CompactGame = {
  appid: string
  name: string
  image: string
  genres: string[]
}

export function GameCardCompact({ game }: { game: CompactGame }) {
  const [allowNsfwReveal, setAllowNsfwReveal] = useState(false)
  const isNSFW = game.genres?.some((genre) => genre.toLowerCase() === "nsfw")

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

  return (
    <Link to={`/game/${game.appid}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/80 transition hover:border-primary/50">
        <div className="relative aspect-[3/4]">
          <img
            src={proxyImageUrl(game.image) || "/banner.png"}
            alt={game.name}
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${
              isNSFW ? (allowNsfwReveal ? "blur-md group-hover:blur-none" : "blur-md") : ""
            }`}
          />
          {isNSFW && (
            <div
              className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-300 ${
                allowNsfwReveal ? "group-hover:opacity-0" : ""
              }`}
            >
              <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold">18+</div>
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
  )
}
