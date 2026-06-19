import type { ComponentType } from "react"
import { Library, Clock, Camera } from "lucide-react"
import {
  Compass,
  Download,
  Gamepad2,
  Settings,
  Star,
  Heart,
} from "@/components/icons"

/**
 * Nav icons accept just a `className` from their consumer. Using a permissive
 * type here lets us mix Lucide icons (which haven't been animated yet) with
 * the animated wrappers from `@/components/icons` without TS conflicts.
 */
export type NavIcon = ComponentType<{ className?: string }>

export type PrimaryNavItem = {
  label: string
  to: string
  icon: NavIcon
  description: string
}

export const primaryNavItems: PrimaryNavItem[] = [
  {
    label: "Browse",
    to: "/",
    icon: Compass,
    description: "Discover new releases and trending installs",
  },
  {
    label: "Library",
    to: "/library",
    icon: Library,
    description: "Launch and organize installed games",
  },
  {
    label: "Activity",
    to: "/downloads",
    icon: Download,
    description: "Track downloads, installs, and recovery",
  },
]

export const secondaryNavItems: PrimaryNavItem[] = [
  {
    label: "Wishlist",
    to: "/wishlist",
    icon: Star,
    description: "Games you want to keep an eye on",
  },
  {
    label: "Liked",
    to: "/liked",
    icon: Heart,
    description: "Your favorited games",
  },
  {
    label: "History",
    to: "/view-history",
    icon: Clock,
    description: "Recently viewed games",
  },
  {
    label: "Screenshots",
    to: "/screenshots",
    icon: Camera,
    description: "Review in-game captures",
  },
]

export const bottomNavItems: PrimaryNavItem[] = [
  {
    label: "Settings",
    to: "/settings",
    icon: Settings,
    description: "Preferences, devices, and integrations",
  },
]

/**
 * Pages that are usable without a connection — their data is local to this
 * machine (installed games, download state, captures, settings) or already
 * cached. Everything else (Browse/home, Search, Wishlist, Liked, History,
 * Account, and the public collection browser) is online-only and is replaced by
 * <OfflineLockout/> while offline instead of loading into an error.
 *
 * Game detail pages (`/game/:id`) are allowed through because installed games
 * render fully offline from their local manifest + cached art; GameDetailPage
 * itself shows the offline lockout when a *non-installed* game is opened with no
 * connection, so the guard doesn't need to know install state here.
 *
 * Note: `/collections/browse` is the public discovery page (online-only); the
 * user's own `/collections` and `/collections/view/:id` stay available.
 */
export function isOfflineAllowedPath(pathname: string): boolean {
  const p = (pathname || "/").split("?")[0]
  if (p.startsWith("/collections/browse")) return false
  if (p.startsWith("/collections")) return true
  return (
    p.startsWith("/library") ||
    p.startsWith("/downloads") ||
    p.startsWith("/settings") ||
    p.startsWith("/screenshots") ||
    p.startsWith("/game/")
  )
}

export function getRouteChrome(pathname: string) {
  if (pathname === "/") {
    return {
      eyebrow: "Launcher",
      title: "Browse the catalogue",
      description: "Spotlight, trending drops, and fast search without leaving the desktop app.",
    }
  }

  if (pathname.startsWith("/library")) {
    return {
      eyebrow: "Library",
      title: "Your installed collection",
      description: "Resume, tag, sort, and launch from one place.",
    }
  }

  if (pathname.startsWith("/downloads")) {
    return {
      eyebrow: "Activity",
      title: "Downloads and installs",
      description: "Monitor progress, recover failed work, and keep installs moving.",
    }
  }

  if (pathname.startsWith("/settings")) {
    return {
      eyebrow: "Settings",
      title: "Launcher preferences",
      description: "Tune downloads, overlays, shortcuts, accounts, and system behavior.",
    }
  }

  if (pathname.startsWith("/search")) {
    return {
      eyebrow: "Search",
      title: "Search the catalogue",
      description: "Jump directly into a game, developer, genre, or source.",
    }
  }

  if (pathname.startsWith("/game/")) {
    return {
      eyebrow: "Game",
      title: "Game details",
      description: "Install, launch, and inspect the current release without leaving the launcher.",
    }
  }

  if (pathname.startsWith("/screenshots")) {
    return {
      eyebrow: "Media",
      title: "Screenshots",
      description: "Review captures stored by the desktop client.",
    }
  }

  return {
    eyebrow: "UnionCrax.Direct",
    title: "Desktop launcher",
    description: "Core launcher tools, without the website clutter.",
  }
}

export function getLauncherHomeMeta() {
  return {
    eyebrow: "UnionCrax.Direct",
    title: "Your library, one click away",
    description: "A faster launcher flow inspired by the best desktop game hubs: spotlight, activity, and library-first navigation.",
    icon: Gamepad2,
  }
}