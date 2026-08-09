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
