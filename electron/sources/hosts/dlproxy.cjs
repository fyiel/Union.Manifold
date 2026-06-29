'use strict'

/**
 * AnkerGames' own download proxy (`*.dlproxy.uk`). The URL embedded in the
 * AnkerGames download page is already a direct, time-limited, IP-locked file
 * link — there's nothing further to resolve, we just hand it to aria2. A
 * Referer back to ankergames.net is set because the proxy expects it.
 *
 * The link is short-lived, so the adapter must resolve it immediately before
 * enqueueing (do NOT cache dlproxy URLs).
 */

function match(url) {
  try {
    return /(^|\.)dlproxy\.uk$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

async function resolve(url) {
  return {
    resolvable: true,
    url,
    headers: { Referer: 'https://ankergames.net/' },
    // Ephemeral: the proxy token expires; the adapter resolves it just-in-time.
    ephemeral: true,
  }
}

module.exports = { hostType: 'dlproxy', match, resolve }
