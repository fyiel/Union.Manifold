'use strict'

/**
 * Pixeldrain resolver. Pixeldrain links come as either a single file
 * (`/u/{id}`) or a list (`/l/{id}`). The public API exposes a direct,
 * range-capable download for a file id, which is exactly what aria2 wants:
 *   https://pixeldrain.com/api/file/{id}?download
 * and metadata (name + size + sha256) at /api/file/{id}/info.
 *
 * Verified aria2-ready (HTTP 206, accept-ranges) for GameBounty's pixeldrain
 * mirrors.
 */

const { requestJson } = require('../http.cjs')

const ID_RE = /^[A-Za-z0-9_-]{4,40}$/

function match(url) {
  try {
    return /(^|\.)pixeldrain\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

function parse(url) {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/(u|l|api\/file|api\/list)\/([A-Za-z0-9_-]+)/)
    if (!m) return null
    const kind = m[1].includes('list') || m[1] === 'l' ? 'list' : 'file'
    return { kind, id: m[2] }
  } catch {
    return null
  }
}

function directUrl(id) {
  return `https://pixeldrain.com/api/file/${encodeURIComponent(id)}?download`
}

async function fileInfo(id) {
  const { res, json } = await requestJson(`https://pixeldrain.com/api/file/${encodeURIComponent(id)}/info`)
  if (!res.ok || !json) return {}
  return { fileName: json.name, sizeBytes: Number(json.size) || undefined }
}

async function resolve(url) {
  const parsed = parse(url)
  if (!parsed || !ID_RE.test(parsed.id)) {
    return { resolvable: false, openUrl: url }
  }

  // A list can hold several archive parts. Resolve every file in it so the
  // caller can enqueue them all.
  if (parsed.kind === 'list') {
    const { res, json } = await requestJson(`https://pixeldrain.com/api/list/${encodeURIComponent(parsed.id)}`)
    const files = res.ok && Array.isArray(json?.files) ? json.files : []
    if (!files.length) return { resolvable: false, openUrl: url }
    return {
      resolvable: true,
      files: files.map((f) => ({
        url: directUrl(f.id),
        fileName: f.name,
        sizeBytes: Number(f.size) || undefined,
      })),
    }
  }

  const info = await fileInfo(parsed.id)
  return {
    resolvable: true,
    url: directUrl(parsed.id),
    fileName: info.fileName,
    sizeBytes: info.sizeBytes,
  }
}

module.exports = { hostType: 'pixeldrain', match, resolve }
