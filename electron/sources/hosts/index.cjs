'use strict'

/**
 * File-host resolver registry. Given a download URL (or a DownloadOption), pick
 * the resolver that knows how to turn it into a direct, aria2-ready URL.
 *
 * Resolvers return either:
 *   { resolvable: true,  url, fileName?, sizeBytes?, headers?, ephemeral? }
 *   { resolvable: true,  files: [{url, fileName?, sizeBytes?}], headers? }   // multi-part
 *   { resolvable: false, openUrl }                                          // hand off to a browser
 *
 * Hosts we can't automate today (reCAPTCHA / JS-gated landing pages) fall
 * through to the default: resolvable:false with an openUrl, so the UI offers
 * "open in browser" rather than silently failing.
 */

const pixeldrain = require('./pixeldrain.cjs')
const dlproxy = require('./dlproxy.cjs')
const buzzheavier = require('./buzzheavier.cjs')

// Order matters only for overlapping matchers; here they're disjoint by host.
const RESOLVERS = [pixeldrain, dlproxy, buzzheavier]

// Hosts we recognise but can't headlessly resolve yet — labelled so the UI can
// say *why* and offer the browser. gofile now gates folder listing behind an
// obfuscated rolling token + premium account (error-notPremium), so it stays a
// browser hand-off rather than a resolver that breaks every few weeks.
const KNOWN_UNRESOLVABLE = {
  'gofile.io': 'gofile (browser only)',
  'megadb.net': 'megadb (resolver pending)',
  'datanodes.to': 'datanodes (resolver pending)',
  'filecrypt.cc': 'filecrypt (captcha — browser only)',
  'www.filecrypt.cc': 'filecrypt (captcha — browser only)',
  'fileq.net': 'fileq (browser only)',
  'mocha.my': 'mocha (browser only)',
  'zerofs.link': 'zerofs (browser only)',
  'fileditchfiles.me': 'fileditch (browser only)',
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Best-effort host type label for a URL (used when building DownloadOptions). */
function detectHostType(url) {
  for (const r of RESOLVERS) {
    if (r.match(url)) return r.hostType
  }
  const host = hostnameOf(url)
  if (KNOWN_UNRESOLVABLE[host]) return host.replace(/^www\./, '').split('.')[0]
  return host.replace(/^www\./, '').split('.')[0] || 'unknown'
}

function isResolvable(url) {
  return RESOLVERS.some((r) => r.match(url))
}

/**
 * Resolve a single download URL to something aria2 can fetch.
 * @returns {Promise<{resolvable:boolean, url?:string, files?:any[], fileName?:string, sizeBytes?:number, headers?:object, openUrl?:string, reason?:string}>}
 */
async function resolveUrl(url) {
  for (const r of RESOLVERS) {
    if (r.match(url)) {
      try {
        return await r.resolve(url)
      } catch (err) {
        return { resolvable: false, openUrl: url, reason: `resolver error: ${err?.message || err}` }
      }
    }
  }
  const host = hostnameOf(url)
  return { resolvable: false, openUrl: url, reason: KNOWN_UNRESOLVABLE[host] || `unsupported host: ${host}` }
}

module.exports = { resolveUrl, detectHostType, isResolvable, KNOWN_UNRESOLVABLE }
