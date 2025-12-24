export type MirrorHost = 'pixeldrain' | 'vikingfile' | 'rootz'

export type MirrorHostSuccess = {
  url: string
  id?: string
  hash?: string
  raw?: Record<string, unknown>
}

export type MirrorHostFailure = {
  error: string
  raw?: Record<string, unknown>
}

export type MirrorHostResult = MirrorHostSuccess | MirrorHostFailure

export type MirrorUploadResult = {
  filename: string
  fileSize: number
  uploadedHosts: MirrorHost[]
  results: Partial<Record<MirrorHost, MirrorHostResult>>
}

const HOSTS: MirrorHost[] = ['pixeldrain', 'vikingfile', 'rootz']

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function normalizeHosts(input: unknown, fallback: MirrorHost[]): MirrorHost[] {
  const arr = Array.isArray(input) ? input : []
  const set = new Set<MirrorHost>()
  for (const h of arr) {
    if (typeof h !== 'string') continue
    const k = h.toLowerCase().trim()
    if (HOSTS.includes(k as MirrorHost)) set.add(k as MirrorHost)
  }
  if (set.size === 0) fallback.forEach((h) => set.add(h))
  return Array.from(set)
}

export function normalizeMirrorUploadResponse(body: unknown, selectedHosts: string[]): MirrorUploadResult[] {
  const fallbackHosts = normalizeHosts(selectedHosts, HOSTS)

  const bRec = asRecord(body)
  const filesUnknown = Array.isArray(body) ? body : Array.isArray(bRec?.files) ? bRec!.files : []
  if (!Array.isArray(filesUnknown)) return []

  const out: MirrorUploadResult[] = []
  for (const f of filesUnknown) {
    const fRec = asRecord(f)
    if (!fRec) continue

    const filenameRaw = fRec.filename ?? fRec.name
    const filename = typeof filenameRaw === 'string' ? filenameRaw : ''
    if (!filename) continue

    const size =
      toFiniteNumber(fRec.fileSize) ?? toFiniteNumber(fRec.size) ?? toFiniteNumber((fRec as any).file_size) ?? 0

    const uploadedHosts = normalizeHosts(fRec.uploadedHosts, fallbackHosts)

    const resultsRec = asRecord(fRec.results) || {}
    const results: Partial<Record<MirrorHost, MirrorHostResult>> = {}
    for (const h of uploadedHosts) {
      const v = resultsRec[h]
      const vRec = asRecord(v)
      if (!vRec) continue
      if (typeof vRec.error === 'string' && vRec.error) {
        results[h] = { error: vRec.error, raw: vRec }
        continue
      }
      if (typeof vRec.url === 'string' && vRec.url) {
        const id = typeof vRec.id === 'string' && vRec.id ? vRec.id : undefined
        const hash = typeof vRec.hash === 'string' && vRec.hash ? vRec.hash : undefined
        results[h] = {
          url: vRec.url,
          ...(id ? { id } : {}),
          ...(hash ? { hash } : {}),
          raw: vRec
        }
      }
    }

    out.push({
      filename,
      fileSize: Math.max(0, size),
      uploadedHosts,
      results
    })
  }

  return out
}

