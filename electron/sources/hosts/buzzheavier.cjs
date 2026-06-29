'use strict'

/**
 * Buzzheavier resolver (buzzheavier.com / bzzhr.to — common on SteamRIP).
 *
 * The landing page is htmx-driven. Resolving a direct link is two hops:
 *   1. GET the landing page. It embeds the real download trigger as
 *      hx-get="/{id}/download?t=<token>" where the token is short-lived and
 *      tied to that page load, plus the file name (page <title>) and size.
 *   2. GET that tokened path with the htmx headers (hx-request + referer). The
 *      server answers 204 with an hx-redirect header holding the signed CDN URL
 *      (https://ts.bzzhr.to/d/{id}?v=...), which is range-capable (HTTP 206,
 *      accept-ranges) — exactly what aria2 wants.
 *
 * Verified aria2-ready against SteamRIP's buzzheavier mirrors.
 */

const { request, requestText, sleep } = require('../http.cjs')
const { parseSizeToBytes } = require('../schema.cjs')

const HOSTS = /(^|\.)(buzzheavier\.com|bzzhr\.to)$/i

function match(url) {
  try {
    const h = new URL(url).hostname
    // Only the landing hosts — the ts.* CDN host is already a direct link.
    return HOSTS.test(h) && !/^ts\./i.test(h)
  } catch {
    return false
  }
}

function idFrom(url) {
  try {
    const m = new URL(url).pathname.match(/^\/([A-Za-z0-9]{4,})/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** Run the tokened download hop and return the signed CDN URL (or null). */
async function resolveTokenedPath(origin, path, referer) {
  const res = await request(`${origin}${path}`, {
    headers: { Referer: referer, 'hx-request': 'true', 'hx-current-url': referer },
    manualRedirect: true,
    retries: 1,
  })
  // The server answers 204 with an hx-redirect header (or, rarely, a 3xx Location).
  return res.headers.get('hx-redirect') || res.headers.get('location') || null
}

async function resolve(url) {
  const id = idFrom(url)
  if (!id) return { resolvable: false, openUrl: url }

  const origin = new URL(url).origin

  // Behind Cloudflare, the landing page occasionally returns a challenge with no
  // download token (HTTP 200, so the http layer won't retry). Re-fetch once
  // before giving up so a transient miss doesn't fall back to the browser.
  let text = ''
  let fileName
  let sizeBytes
  const paths = new Set()
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(500)
    const got = await requestText(url, { headers: { Accept: 'text/html' } })
    if (!got.res.ok) {
      if (attempt) return { resolvable: false, openUrl: url, reason: `buzzheavier page ${got.res.status}` }
      continue
    }
    text = got.text
    fileName = (text.match(/<title>([^<]+)<\/title>/i)?.[1] || '').trim() || undefined
    // The page sprinkles a few size-like tokens (UI placeholders, "0 KB"); the
    // real file size is the largest, so take the max rather than the first match.
    sizeBytes =
      (text.match(/[\d.]+\s*(?:TB|GB|MB|KB)\b/gi) || [])
        .map((s) => parseSizeToBytes(s) || 0)
        .reduce((max, n) => Math.max(max, n), 0) || undefined

    // Canonical download triggers: "/{id}/download?t=..." minus the alt/preview
    // variants. A single file yields one id; a folder lists several children.
    paths.clear()
    const re = /hx-get="(\/[A-Za-z0-9]+\/download\?t=[^"]+)"/g
    let m
    while ((m = re.exec(text))) {
      const p = m[1].replace(/&amp;/g, '&')
      if (!/(?:[?&]alt=true)/.test(p)) paths.add(p)
    }
    if (paths.size) break
  }
  if (!paths.size) return { resolvable: false, openUrl: url, reason: 'no buzzheavier download token' }

  const headers = { Referer: url }

  if (paths.size === 1) {
    const direct = await resolveTokenedPath(origin, [...paths][0], url)
    if (!direct) return { resolvable: false, openUrl: url, reason: 'no buzzheavier redirect' }
    return { resolvable: true, url: direct, fileName, sizeBytes, headers }
  }

  // Folder: resolve every child. aria2 enqueues all parts.
  const files = []
  for (const p of paths) {
    const direct = await resolveTokenedPath(origin, p, url)
    if (direct) files.push({ url: direct })
  }
  if (!files.length) return { resolvable: false, openUrl: url, reason: 'no buzzheavier redirects' }
  return { resolvable: true, files, headers }
}

module.exports = { hostType: 'buzzheavier', match, resolve }
