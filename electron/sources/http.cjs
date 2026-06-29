'use strict'

/**
 * Shared HTTP helpers for the source-adapter layer.
 *
 * Runs in the Electron main process (Node), NOT the renderer — scraping the
 * source sites and resolving download links needs a real browser User-Agent,
 * cookie persistence (Laravel CSRF flows), and freedom from CORS. The renderer
 * reaches all of this through IPC (see electron/sources/index.cjs).
 *
 * No third-party deps: Node 20's global fetch (undici) is used directly, with a
 * tiny in-process cookie jar layered on top because fetch does not persist
 * Set-Cookie between calls.
 */

// A desktop Chrome UA. Several sources (ankergames, steamrip, buzzheavier) 403
// or serve a challenge to bare/non-browser agents; this one passes cleanly.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const DEFAULT_TIMEOUT_MS = 25_000

/** Minimal cookie jar — keyed by host, stores name=value pairs. Enough for the
 *  session + XSRF cookies the Laravel sources hand out; we don't need path or
 *  expiry precision for a short-lived resolve flow. */
class CookieJar {
  constructor() {
    this._byHost = new Map() // host -> Map<name, value>
  }

  store(urlString, setCookieValues) {
    if (!setCookieValues || !setCookieValues.length) return
    let host
    try {
      host = new URL(urlString).host
    } catch {
      return
    }
    const bag = this._byHost.get(host) || new Map()
    for (const raw of setCookieValues) {
      const first = String(raw).split(';')[0]
      const eq = first.indexOf('=')
      if (eq <= 0) continue
      const name = first.slice(0, eq).trim()
      const value = first.slice(eq + 1).trim()
      if (name) bag.set(name, value)
    }
    this._byHost.set(host, bag)
  }

  header(urlString) {
    let host
    try {
      host = new URL(urlString).host
    } catch {
      return ''
    }
    const bag = this._byHost.get(host)
    if (!bag || bag.size === 0) return ''
    return Array.from(bag.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  /** Read a single cookie value for a host (e.g. XSRF-TOKEN). */
  get(urlString, name) {
    let host
    try {
      host = new URL(urlString).host
    } catch {
      return undefined
    }
    return this._byHost.get(host)?.get(name)
  }
}

function getSetCookies(response) {
  // Node 19.7+/undici exposes getSetCookie(); fall back to the (folded) header.
  try {
    if (typeof response.headers.getSetCookie === 'function') {
      return response.headers.getSetCookie()
    }
  } catch {
    /* ignore */
  }
  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

/**
 * fetch() with a browser UA, optional cookie jar, timeout and bounded retry.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {CookieJar} [opts.jar]      persist/replay cookies across calls
 * @param {object}    [opts.headers]  extra headers (merged over the defaults)
 * @param {string}    [opts.method]
 * @param {any}       [opts.body]
 * @param {number}    [opts.timeout]
 * @param {number}    [opts.retries]  default 2 (so up to 3 attempts)
 * @param {boolean}   [opts.manualRedirect] return 3xx instead of following
 * @returns {Promise<Response>}
 */
async function request(url, opts = {}) {
  const {
    jar,
    headers = {},
    method = 'GET',
    body,
    timeout = DEFAULT_TIMEOUT_MS,
    retries = 2,
    manualRedirect = false,
  } = opts

  const baseHeaders = {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/json,application/xhtml+xml,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...headers,
  }

  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const cookieHeader = jar ? jar.header(url) : ''
      const finalHeaders = { ...baseHeaders }
      if (cookieHeader) finalHeaders.Cookie = cookieHeader

      const response = await fetch(url, {
        method,
        body,
        headers: finalHeaders,
        redirect: manualRedirect ? 'manual' : 'follow',
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (jar) jar.store(url, getSetCookies(response))

      // Retry transient upstream failures (CDN hiccups, edge cache misses) and
      // rate limits. For 429, honour Retry-After when the server sends it
      // (capped) so we back off the way the host asks instead of hammering.
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        let waitMs = 400 * (attempt + 1)
        if (response.status === 429) {
          const ra = Number(response.headers.get('retry-after'))
          if (Number.isFinite(ra) && ra > 0) waitMs = Math.min(ra * 1000, 5000)
        }
        await sleep(waitMs)
        continue
      }
      return response
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (attempt < retries) {
        await sleep(400 * (attempt + 1))
        continue
      }
    }
  }
  throw lastErr || new Error(`request failed: ${url}`)
}

async function requestText(url, opts) {
  const res = await request(url, opts)
  const text = await res.text()
  return { res, text }
}

async function requestJson(url, opts) {
  const res = await request(url, opts)
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { res, json }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Map over items with bounded concurrency, preserving order. A rejected item
 * resolves to null (so a single bad page can't sink the whole batch). Keeps the
 * source sites politely loaded (default 8 in-flight) while still hydrating a
 * catalog/search page far faster than a sequential loop.
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = new Array(Math.min(limit, items.length || 0)).fill(0).map(async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch {
        results[i] = null
      }
    }
  })
  await Promise.all(workers)
  return results
}

/** Decode HTML entities enough to read embedded JSON / og tags out of markup. */
function decodeEntities(input) {
  return String(input || '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

/** Strip HTML tags to plain text (for descriptions served as markup). */
function stripTags(input) {
  return decodeEntities(String(input || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

module.exports = {
  BROWSER_UA,
  CookieJar,
  request,
  requestText,
  requestJson,
  sleep,
  mapLimit,
  decodeEntities,
  stripTags,
}
