'use strict'

/**
 * HTML / RSC parsing helpers shared by the adapters. Deliberately regex-and-
 * brace-balancing based (no DOM/JSON-stream deps) — the sources embed their
 * data as escaped JSON inside <script> tags, which is cheap to pull out by hand.
 */

/**
 * From an index pointing at a `{` (or `[`), return the substring up to and
 * including its matching close, respecting strings and escapes. Returns '' if
 * unbalanced.
 */
function extractBalancedJson(text, openIndex) {
  const open = text[openIndex]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let quote = ''
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === quote) inStr = false
      continue
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(openIndex, i + 1)
    }
  }
  return ''
}

/**
 * Find the first JSON object that appears immediately after `"key":` and return
 * it parsed, or null. Searches all occurrences until one parses.
 */
function findObjectByKey(text, key) {
  const needle = `"${key}":`
  let from = 0
  for (;;) {
    const idx = text.indexOf(needle, from)
    if (idx === -1) return null
    let j = idx + needle.length
    while (j < text.length && /\s/.test(text[j])) j++
    if (text[j] === '{' || text[j] === '[') {
      const raw = extractBalancedJson(text, j)
      if (raw) {
        try {
          return JSON.parse(raw)
        } catch {
          /* keep scanning — a later occurrence may be valid */
        }
      }
    }
    from = idx + needle.length
  }
}

/**
 * Concatenate the decoded payloads of all `self.__next_f.push([N,"..."])`
 * chunks in a Next.js App-Router page into one string, so embedded objects can
 * be located across chunk boundaries.
 */
function collectNextFlight(html) {
  const out = []
  const re = /self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g
  let m
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1])) // m[1] is a JS string literal incl. quotes
    } catch {
      /* skip malformed chunk */
    }
  }
  return out.join('')
}

/** First capture group of a regex, or '' . */
function firstMatch(text, re) {
  const m = String(text || '').match(re)
  return m ? m[1] : ''
}

/** Pull a Steam AppID from any markup that references the store/CDN. */
function findSteamAppId(text) {
  const m =
    String(text || '').match(/store\.steampowered\.com\/app\/(\d+)/) ||
    String(text || '').match(/steamdb\.info\/app\/(\d+)/) ||
    String(text || '').match(/(?:steam_appid|steamAppId|steam_id)["'\s:=]+(\d{3,8})/) ||
    String(text || '').match(/\/apps\/(\d{3,8})\//) // steam CDN image path
  return m ? Number(m[1]) : null
}

module.exports = { extractBalancedJson, findObjectByKey, collectNextFlight, firstMatch, findSteamAppId }
