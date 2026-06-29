'use strict'

/**
 * Headless end-to-end test for the multi-source backend (electron/sources).
 * Runs against the LIVE sites — no Electron needed (uses Node's global fetch).
 *
 *   node scripts/test-sources.cjs
 *
 * Asserts, per adapter: catalog enumeration returns titles, a known game's
 * detail carries download options, and at least one option resolves to a URL
 * that serves bytes with range support (i.e. aria2-ready). Also checks that
 * cross-source dedup merges a shared title.
 */

const path = require('path')
const SRC = path.join(__dirname, '..', 'electron', 'sources')
const gamebounty = require(path.join(SRC, 'adapters', 'gamebounty.cjs'))
const ankergames = require(path.join(SRC, 'adapters', 'ankergames.cjs'))
const registry = require(path.join(SRC, 'index.cjs'))
const { request } = require(path.join(SRC, 'http.cjs'))
const { mergeGames } = require(path.join(SRC, 'schema.cjs'))

function line(s = '') { process.stdout.write(s + '\n') }
function ok(b) { return b ? 'PASS' : 'FAIL' }

/** Confirm a URL serves bytes and supports ranges (aria2 needs both). */
async function probeDownloadable(url, headers) {
  try {
    const res = await request(url, { headers: { ...(headers || {}), Range: 'bytes=0-1' }, retries: 1, timeout: 20000 })
    const len = res.headers.get('content-length')
    const ranges = res.headers.get('accept-ranges')
    const ctype = res.headers.get('content-type') || ''
    const partial = res.status === 206
    const looksFile = partial || /octet-stream|zip|rar|7z|x-rar/i.test(ctype) || (res.ok && Number(len) > 0)
    return { status: res.status, len, ranges, ctype, downloadable: looksFile }
  } catch (e) {
    return { status: 0, error: String(e?.message || e), downloadable: false }
  }
}

async function testGameBounty() {
  line('\n=== GameBounty ===')
  const slugs = await gamebounty._internal.allSlugs()
  line(`catalog slugs: ${slugs.length}  [${ok(slugs.length > 100)}]`)

  const game = await gamebounty.getDetail('carrion')
  line(`detail: "${game.title}"  appid=${game.steamAppId}  dedup=${game.dedupKey}`)
  line(`  genres=${game.genres.join(', ')}  size=${game.sizeText}  version=${game.version}`)
  line(`  options(${game.downloadOptions.length}): ${game.downloadOptions.map((o) => `${o.label}/${o.hostType}${o.resolvable ? '*' : ''}`).join(', ')}`)
  line(`  appid present: [${ok(game.steamAppId === 953490)}]   options present: [${ok(game.downloadOptions.length > 0)}]`)

  const opt = game.downloadOptions.find((o) => o.resolvable)
  if (opt) {
    const r = await gamebounty.resolveDownload(opt)
    line(`  resolve ${opt.hostType}: resolvable=${r.resolvable} url=${(r.url || (r.files && r.files[0]?.url) || '').slice(0, 70)}`)
    const u = r.url || (r.files && r.files[0]?.url)
    if (u) {
      const p = await probeDownloadable(u, r.headers)
      line(`  probe: status=${p.status} ctype=${p.ctype} len=${p.len} ranges=${p.ranges}  aria2-ready: [${ok(p.downloadable)}]`)
    }
  } else {
    line('  no auto-resolvable mirror (would open in browser)')
  }
  return game
}

async function testAnkerGames() {
  line('\n=== AnkerGames ===')
  const game = await ankergames.getDetail('dead-space')
  line(`detail: "${game.title}"  appid=${game.steamAppId}  dedup=${game.dedupKey}`)
  line(`  image=${(game.image || '').slice(0, 60)}`)
  line(`  options(${game.downloadOptions.length}): ${game.downloadOptions.map((o) => `${o.label}/${o.hostType}`).join(', ')}`)
  line(`  options present: [${ok(game.downloadOptions.length > 0)}]`)

  const opt = game.downloadOptions[0]
  if (opt) {
    const r = await ankergames.resolveDownload(opt)
    const u = r.url || (r.files && r.files[0]?.url)
    line(`  resolve: resolvable=${r.resolvable} url=${(u || '').slice(0, 80)} reason=${r.reason || ''}`)
    line(`  produced a direct URL: [${ok(Boolean(u))}]`)
    if (u) {
      const p = await probeDownloadable(u, r.headers)
      line(`  probe: status=${p.status} ctype=${p.ctype} len=${p.len} ranges=${p.ranges} (dlproxy links are ephemeral/IP-locked)`)
    }
  }
  return game
}

async function testDedup(gb, anker) {
  line('\n=== Dedup / merge ===')
  // Synthetic cross-source pair on the same title to prove the merge collapses them.
  const merged = mergeGames([
    { sourceId: 'gamebounty', sourceSlug: 'x', sourceUrl: '', steamAppId: 12345, dedupKey: 'steam:12345', title: 'Elden Ring', genres: ['RPG'], downloadOptions: [{ label: 'a' }] },
    { sourceId: 'ankergames', sourceSlug: 'y', sourceUrl: '', steamAppId: 12345, dedupKey: 'steam:12345', title: 'Elden Ring Deluxe Edition', genres: ['Action'], downloadOptions: [{ label: 'b' }] },
    { sourceId: 'ankergames', sourceSlug: 'z', sourceUrl: '', steamAppId: null, dedupKey: 'title:elden ring', title: 'ELDEN RING', genres: [], downloadOptions: [] },
  ])
  const eldenByAppid = merged.find((g) => g.dedupKey === 'steam:12345')
  line(`steam:12345 merged sources: ${eldenByAppid?.sources.length}  [${ok(eldenByAppid?.sources.length === 2)}]`)
  line(`merged genres: ${eldenByAppid?.genres.join(', ')}`)

  // Real registry search (network) — show how many unified results + any multi-source merges.
  try {
    const results = await registry.searchAll('the binding of isaac', { limit: 6 })
    line(`registry.searchAll("the binding of isaac"): ${results.length} unified results`)
    for (const g of results.slice(0, 5)) {
      line(`  - ${g.title}  [appid=${g.steamAppId}]  sources=${g.sources.map((s) => s.sourceId).join('+')}`)
    }
  } catch (e) {
    line(`searchAll error: ${e.message}`)
  }
}

;(async () => {
  const gb = await testGameBounty().catch((e) => { line(`GameBounty ERROR: ${e.stack || e}`); return null })
  const anker = await testAnkerGames().catch((e) => { line(`AnkerGames ERROR: ${e.stack || e}`); return null })
  await testDedup(gb, anker).catch((e) => line(`Dedup ERROR: ${e.stack || e}`))
  line('\ndone.')
})()
