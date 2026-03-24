import {
  Compass,
  Download,
  Gamepad2,
  type LucideIcon,
  Library,
  Settings,
  Star,
  Heart,
  Clock,
  History,
  Camera,
} from "lucide-react"

export type PrimaryNavItem = {
  label: string
  to: string
  icon: LucideIcon
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