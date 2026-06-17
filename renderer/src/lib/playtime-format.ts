/**
 * Client-safe playtime formatting. Same output as the server-side
 * `formatPlaytime` in lib/playtime-db.ts, duplicated here so client
 * components don't pull in `pg`.
 *
 *   <60s  → "Ns"
 *   <60m  → "Nm"
 *   else  → "Nh" or "Nh Mm"
 */
export function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const remMin = m % 60
  if (remMin === 0) return `${h}h`
  return `${h}h ${remMin}m`
}
