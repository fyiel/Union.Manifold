export const loadAdvancedSearchPage = () => import("@/app/pages/AdvancedSearchPage")
export const loadLibraryPage = () => import("@/app/pages/LibraryPage")
export const loadPlayLaterPage = () => import("@/app/pages/PlayLaterPage")
export const loadAchievementsPage = () => import("@/app/pages/AchievementsPage")
export const loadDownloadsPage = () => import("@/app/pages/DownloadsPage")
export const loadSettingsPage = () => import("@/app/pages/SettingsPage")

const pageLoaders: Record<string, () => Promise<unknown>> = {
  "/advanced": loadAdvancedSearchPage,
  "/library": loadLibraryPage,
  "/play-later": loadPlayLaterPage,
  "/achievements": loadAchievementsPage,
  "/downloads": loadDownloadsPage,
  "/settings": loadSettingsPage,
}

export function preloadPrimaryPage(path: string): void {
  void pageLoaders[path]?.().catch(() => undefined)
}

export const loadSourceGamePage = () => import("@/app/pages/SourceGamePage")
export const preloadSourceGamePage = () => { void loadSourceGamePage().catch(() => undefined) }

export const loadGameModsPage = () => import("@/app/pages/GameModsPage")
export const preloadGameModsPage = () => { void loadGameModsPage().catch(() => undefined) }

const START_PAGE_KEY = "uc_start_page"
let appliedCachedStartPage = false

export function readCachedStartPage(): "browse" | "library" | null {
  try {
    const value = localStorage.getItem(START_PAGE_KEY)
    return value === "browse" || value === "library" ? value : null
  } catch {
    return null
  }
}

export function cacheStartPage(value: unknown): void {
  if (value !== "browse" && value !== "library") return
  try { localStorage.setItem(START_PAGE_KEY, value) } catch {  }
}

export function applyCachedStartPageRoute(): boolean {
  const route = window.location.hash.replace(/^#/, "").split("?")[0] || "/"
  if (route !== "/" || readCachedStartPage() !== "library") return false
  window.history.replaceState(window.history.state, "", "#/library")
  appliedCachedStartPage = true
  return true
}

export function wasCachedStartPageApplied(): boolean {
  return appliedCachedStartPage
}
