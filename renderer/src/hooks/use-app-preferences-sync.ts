import { useEffect, useRef } from "react"
import { apiFetch } from "@/lib/api"
import { getPreferredDownloadHost, setPreferredDownloadHost, type PreferredDownloadHost } from "@/lib/downloads"
import { useDiscordAccount } from "@/hooks/use-discord-account"

type AppPreferences = {
  defaultMirrorHost?: PreferredDownloadHost
  discordRpcEnabled?: boolean
  runGamesAsAdmin?: boolean
  alwaysCreateDesktopShortcut?: boolean
  linuxLaunchMode?: "auto" | "native" | "wine" | "proton"
  developerMode?: boolean
  verboseDownloadLogging?: boolean
}

const ALLOWED_KEYS = new Set<keyof AppPreferences>([
  "defaultMirrorHost",
  "discordRpcEnabled",
  "runGamesAsAdmin",
  "alwaysCreateDesktopShortcut",
  "linuxLaunchMode",
  "developerMode",
  "verboseDownloadLogging",
])

function normalizePreferences(input: unknown): AppPreferences {
  if (!input || typeof input !== "object") return {}
  const record = input as Record<string, unknown>
  const prefs: AppPreferences = {}

  const mirrorHost = record.defaultMirrorHost
  if (mirrorHost === "pixeldrain" || mirrorHost === "rootz") {
    prefs.defaultMirrorHost = mirrorHost
  }

  if (typeof record.discordRpcEnabled === "boolean") {
    prefs.discordRpcEnabled = record.discordRpcEnabled
  }
  if (typeof record.runGamesAsAdmin === "boolean") {
    prefs.runGamesAsAdmin = record.runGamesAsAdmin
  }
  if (typeof record.alwaysCreateDesktopShortcut === "boolean") {
    prefs.alwaysCreateDesktopShortcut = record.alwaysCreateDesktopShortcut
  }

  if (typeof record.developerMode === "boolean") {
    prefs.developerMode = record.developerMode
  }
  if (typeof record.verboseDownloadLogging === "boolean") {
    prefs.verboseDownloadLogging = record.verboseDownloadLogging
  }

  const linuxLaunchMode = record.linuxLaunchMode
  if (linuxLaunchMode === "auto" || linuxLaunchMode === "native" || linuxLaunchMode === "wine" || linuxLaunchMode === "proton") {
    prefs.linuxLaunchMode = linuxLaunchMode
  }

  return prefs
}

async function readLocalPreferences(): Promise<AppPreferences> {
  const prefs: AppPreferences = {}
  try {
    prefs.defaultMirrorHost = await getPreferredDownloadHost()
  } catch {
    // ignore
  }

  if (typeof window === "undefined" || !window.ucSettings?.get) return prefs

  try {
    const rpcEnabled = await window.ucSettings.get("discordRpcEnabled")
    if (typeof rpcEnabled === "boolean") prefs.discordRpcEnabled = rpcEnabled
  } catch {}

  try {
    const runAsAdmin = await window.ucSettings.get("runGamesAsAdmin")
    if (typeof runAsAdmin === "boolean") prefs.runGamesAsAdmin = runAsAdmin
  } catch {}

  try {
    const alwaysShortcut = await window.ucSettings.get("alwaysCreateDesktopShortcut")
    if (typeof alwaysShortcut === "boolean") prefs.alwaysCreateDesktopShortcut = alwaysShortcut
  } catch {}

  try {
    const launchMode = await window.ucSettings.get("linuxLaunchMode")
    if (launchMode === "auto" || launchMode === "native" || launchMode === "wine" || launchMode === "proton") {
      prefs.linuxLaunchMode = launchMode
    }
  } catch {}

  try {
    const devMode = await window.ucSettings.get("developerMode")
    if (typeof devMode === "boolean") prefs.developerMode = devMode
  } catch {}

  try {
    const verbose = await window.ucSettings.get("verboseDownloadLogging")
    if (typeof verbose === "boolean") prefs.verboseDownloadLogging = verbose
  } catch {}

  return prefs
}

async function applyPreferences(prefs: AppPreferences) {
  if (prefs.defaultMirrorHost) {
    setPreferredDownloadHost(prefs.defaultMirrorHost)
  }

  if (typeof window === "undefined" || !window.ucSettings?.set) return

  const entries = Object.entries(prefs) as Array<[keyof AppPreferences, AppPreferences[keyof AppPreferences]]>
  await Promise.all(
    entries.map(async ([key, value]) => {
      if (key === "defaultMirrorHost") return
      await window.ucSettings?.set?.(key, value)
    })
  )
}

export function useAppPreferencesSync() {
  const { user, authenticated } = useDiscordAccount()
  const syncedRef = useRef(false)
  const applyingRemoteRef = useRef(false)

  useEffect(() => {
    if (!authenticated || !user) {
      syncedRef.current = false
      return
    }
    if (syncedRef.current) return

    let active = true

    const pushPreferences = async (prefs: AppPreferences) => {
      try {
        await apiFetch("/api/account/app-preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: prefs }),
        })
      } catch {
        // ignore
      }
    }

    const run = async () => {
      try {
        const res = await apiFetch("/api/account/app-preferences")
        if (!res.ok || !active) return
        const data = await res.json()
        const prefs = normalizePreferences(data?.preferences)
        const hasPrefs = data?.hasPrefs === true

        if (hasPrefs && Object.keys(prefs).length > 0) {
          applyingRemoteRef.current = true
          try {
            await applyPreferences(prefs)
          } finally {
            applyingRemoteRef.current = false
          }
        } else {
          const localPrefs = await readLocalPreferences()
          if (Object.keys(localPrefs).length > 0) {
            await pushPreferences(localPrefs)
          }
        }
      } finally {
        if (active) syncedRef.current = true
      }
    }

    void run()

    return () => {
      active = false
    }
  }, [authenticated, user])

  useEffect(() => {
    if (!authenticated || !user || typeof window === "undefined" || !window.ucSettings?.onChanged) return

    const syncRemote = async (partial: AppPreferences) => {
      if (applyingRemoteRef.current) return
      try {
        await apiFetch("/api/account/app-preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: partial }),
        })
      } catch {
        // ignore
      }
    }

    const off = window.ucSettings.onChanged((data: any) => {
      if (!data || !data.key) return
      const key = data.key as keyof AppPreferences
      if (!ALLOWED_KEYS.has(key)) return
      const next = normalizePreferences({ [key]: data.value })
      if (Object.keys(next).length === 0) return
      void syncRemote(next)
    })

    return () => {
      if (typeof off === "function") off()
    }
  }, [authenticated, user])
}
