import type { DownloadItem, DownloadStatus } from "@/context/downloads-context"

function safeGameFilename(name: string) {
  return (
    name
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "unioncrax-download"
  )
}

function createSyntheticDownloadFromInstallingManifest(
  manifest: any,
  activeStatus?: { extracting: boolean; downloading: boolean },
): DownloadItem | null {
  const appid = typeof manifest?.appid === "string" && manifest.appid ? manifest.appid : null
  if (!appid) return null

  const rawStatus = typeof manifest?.installStatus === "string" ? manifest.installStatus : "installing"
  const status: DownloadStatus = activeStatus?.downloading
    ? "downloading"
    : activeStatus?.extracting
      ? "extracting"
      : rawStatus === "paused"
        ? "paused"
        : rawStatus === "downloaded"
          ? "install_ready"
          : rawStatus === "failed"
            ? "failed"
            : rawStatus === "cancelled"
              ? "cancelled"
              : rawStatus === "queued"
                ? "queued"
                : "failed"
  const metadata = manifest?.metadata || {}
  const snapshot = manifest?.downloadSnapshot && typeof manifest.downloadSnapshot === "object"
    ? manifest.downloadSnapshot
    : null
  const safeUrl = typeof snapshot?.url === "string" ? snapshot.url : ""
  const safeSavePath = typeof snapshot?.savePath === "string" ? snapshot.savePath : undefined
  const safeFilename = typeof snapshot?.filename === "string" && snapshot.filename
    ? snapshot.filename
    : `${safeGameFilename(metadata.name || manifest?.name || appid)}.archive`
  const safeDownloadId = typeof snapshot?.downloadId === "string" && snapshot.downloadId
    ? snapshot.downloadId
    : `installing:${appid}`
  const safeTotalBytes = Number.isFinite(Number(snapshot?.totalBytes)) ? Number(snapshot.totalBytes) : 0
  const safeReceivedBytes = Number.isFinite(Number(snapshot?.receivedBytes)) ? Number(snapshot.receivedBytes) : 0
  const safeHost = typeof snapshot?.host === "string" && snapshot.host ? snapshot.host : "local"

  return {
    id: safeDownloadId,
    appid,
    gameName: metadata.name || manifest?.name || appid,
    host: safeHost,
    url: safeUrl,
    originalUrl: safeUrl || undefined,
    filename: safeFilename,
    status,
    receivedBytes: safeReceivedBytes,
    totalBytes: safeTotalBytes,
    speedBps: 0,
    etaSeconds: null,
    extractProgress: null,
    savePath: safeSavePath,
    startedAt: manifest?.updatedAt || Date.now(),
    error: manifest?.installError || (status === "failed" ? "Installation was interrupted. Start it again." : null),
  }
}

export async function loadInstallingDownloads(): Promise<DownloadItem[]> {
  const uc = window.ucDownloads
  if (!uc?.listInstalling) return []

  const manifests = await uc.listInstalling()
  if (!Array.isArray(manifests) || manifests.length === 0) return []

  const hydrated = await Promise.all(
    manifests
      .filter((manifest) => manifest?.appid)
      .map(async (originalManifest) => {
        let manifest = originalManifest
        const appid = String(manifest.appid)
        const [installed, activeStatus] = await Promise.all([
          uc.getInstalled?.(appid).catch(() => null) || Promise.resolve(null),
          uc.getActiveStatus?.(appid).catch(() => ({ extracting: false, downloading: false }))
            || Promise.resolve({ extracting: false, downloading: false }),
        ])

        if (installed) return null

        const rawStatus = typeof manifest.installStatus === "string" ? manifest.installStatus : null
        if (!activeStatus.extracting && !activeStatus.downloading && rawStatus) {
          if (["downloading", "verifying", "retrying", "paused"].includes(rawStatus)) {
            const error = manifest.installError || "App closed. Resume to continue downloading."
            try {
              await uc.setInstallingStatus?.(appid, "paused", error)
              manifest = { ...manifest, installStatus: "paused", installError: error }
            } catch {}
          } else if (["installing", "extracting"].includes(rawStatus)) {
            const error = "Installation was interrupted when the app closed."
            try {
              await uc.setInstallingStatus?.(appid, "failed", error)
              manifest = { ...manifest, installStatus: "failed", installError: error }
            } catch {}
          }
        }

        return createSyntheticDownloadFromInstallingManifest(manifest, activeStatus)
      }),
  )

  return hydrated.filter((item): item is DownloadItem => Boolean(item))
}

export function mergeInstallingDownloads(current: DownloadItem[], hydrated: DownloadItem[]): DownloadItem[] {
  if (!hydrated.length) return current

  const byAppid = new Map<string, DownloadItem>()
  for (const item of current) {
    if (item.appid) byAppid.set(item.appid, item)
  }
  let next = current

  for (const item of hydrated) {
    if (!item.appid) continue
    const existing = byAppid.get(item.appid)
    if (!existing) {
      if (next === current) next = [...current]
      next.unshift(item)
      byAppid.set(item.appid, item)
      continue
    }
    const shouldPromoteUrl = Boolean(item.url) && !existing.url
    const shouldPromoteSavePath = Boolean(item.savePath) && !existing.savePath
    const shouldPromoteHost = item.host && item.host !== "local" && existing.host === "local"
    const shouldPromoteId = item.id && !item.id.startsWith("installing:") && existing.id.startsWith("installing:")
    const shouldPromoteTotal = Number(item.totalBytes) > 0 && !(Number(existing.totalBytes) > 0)
    const shouldPromoteReceived = Number(item.receivedBytes) > Number(existing.receivedBytes || 0)
    if (
      !shouldPromoteUrl
      && !shouldPromoteSavePath
      && !shouldPromoteHost
      && !shouldPromoteId
      && !shouldPromoteTotal
      && !shouldPromoteReceived
    ) continue

    const merged: DownloadItem = {
      ...existing,
      ...(shouldPromoteUrl ? { url: item.url, originalUrl: item.originalUrl || item.url } : {}),
      ...(shouldPromoteSavePath ? { savePath: item.savePath } : {}),
      ...(shouldPromoteHost ? { host: item.host } : {}),
      ...(shouldPromoteId ? { id: item.id } : {}),
      ...(shouldPromoteTotal ? { totalBytes: item.totalBytes } : {}),
      ...(shouldPromoteReceived ? { receivedBytes: item.receivedBytes } : {}),
      filename: existing.filename || item.filename,
    }
    if (next === current) next = [...current]
    const index = next.findIndex((entry) => entry.appid === item.appid)
    if (index >= 0) next[index] = merged
    byAppid.set(item.appid, merged)
  }

  return next
}
