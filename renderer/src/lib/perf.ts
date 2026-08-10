// Dev-only performance harness, gated on the backend reporting UM_PERF=1.
// Inert otherwise: every function no-ops. Dumps JSONL to /tmp via ucPerf.dump.

const BUCKETS = [8, 16.7, 33.4, 66.7, Infinity]
const BUCKET_NAMES = ["<=8ms", "9-16ms", "17-33ms", "34-66ms", ">66ms"]

const state = {
  on: false,
  marks: [] as Array<[string, number]>,
  doms: [] as Array<[string, number, number]>,
  invokes: [] as number[],
  frames: { buckets: Object.fromEntries(BUCKET_NAMES.map((n) => [n, 0])) as Record<string, number>, max: 0, count: 0 },
  wheel: { events: 0, notches: 0, deltaSum: 0, lastTop: null as number | null, lastMiss: "", last: 0, phases: [] as Array<[number, number, number]> },
  painted: false,
}

export function mark(name: string) {
  if (!state.on) return
  state.marks.push([name, performance.now()])
}

export function logInvokeDuration(ms: number) {
  if (!state.on || !Number.isFinite(ms)) return
  state.invokes.push(ms)
  if (state.invokes.length > 4000) state.invokes.shift()
}

export function noteDom(label: string) {
  if (!state.on) return
  state.doms.push([label, performance.now(), document.querySelectorAll("*").length])
}

// Registered synchronously at module eval so DOMContentLoaded is caught,
// even though the enabled() probe resolves later.
const earlyMarks: Array<[string, number]> = []
window.addEventListener(
  "DOMContentLoaded",
  () => earlyMarks.push(["dom-content-loaded", performance.now()]),
  { once: true },
)

export async function initPerf(): Promise<boolean> {
  try {
    state.on = !!(await window.ucPerf?.enabled())
  } catch {
    state.on = false
  }
  if (!state.on) return false
  state.marks.push(...earlyMarks)
  mark("perf:init")
  noteDom("perf:init")

  // First paint: two rAFs past the first render.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      state.painted = true
      mark("first-paint")
      noteDom("first-paint")
    }),
  )

  // Frame interval histogram while the app is repainting (idle gaps >1s skipped).
  let last = performance.now()
  const tick = (now: number) => {
    const d = now - last
    last = now
    if (d < 1000) {
      state.frames.count++
      if (d > state.frames.max) state.frames.max = d
      const i = BUCKETS.findIndex((b) => d <= b)
      state.frames.buckets[BUCKET_NAMES[i]]++
      const ph = state.wheel.phases[state.wheel.phases.length - 1]
      if (ph && performance.now() - state.wheel.last < 1000 && d > ph[1]) ph[1] = d
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Scroll-phase detector for reading frame stats against wheel bursts.
  // phases: [phaseStartMs, maxFrameMs, wheelEvents] per burst. Also tracks
  // per-notch scrollTop travel: chunky wheel = one large jump per notch,
  // smooth scrolling = small deltas spread over frames.
  window.addEventListener(
    "wheel",
    (e) => {
      const now = performance.now()
      if (now - state.wheel.last > 1000) {
        state.wheel.phases.push([now, 0, 0])
      }
      state.wheel.last = now
      state.wheel.events++
      const last = state.wheel.phases[state.wheel.phases.length - 1]
      if (last) last[2]++
      let el = e.target as HTMLElement | null
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight + 4) break
        el = el.parentElement
      }
      if (!el || el.scrollHeight <= el.clientHeight + 4) {
        // xdotool wheel events target the webview root; fall back to the
        // largest visible scrollable (.mf-scroll is the app's scroller).
        const scrollables = [...document.querySelectorAll<HTMLElement>(".mf-scroll, .uc-aside")]
          .filter((s) => s.scrollHeight > s.clientHeight + 4)
        el = scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null
      }
      if (el && el.scrollHeight > el.clientHeight + 4) {
        if (state.wheel.lastTop !== null) state.wheel.deltaSum += Math.abs(el.scrollTop - state.wheel.lastTop)
        state.wheel.lastTop = el.scrollTop
        state.wheel.notches++
      } else {
        state.wheel.lastMiss = `${e.target instanceof HTMLElement ? e.target.tagName + "." + e.target.className : typeof e.target}`
      }
    },
    { passive: true },
  )

  // Scheduled dumps.
  for (const t of [1500, 4000, 8000, 15000, 25000, 40000, 60000, 90000, 120000]) {
    setTimeout(() => void dump(), t)
  }
  return true
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

async function dump() {
  if (!state.on) return
  // getEntriesByType("resource") is declared as PerformanceEntry[]; the
  // browser returns PerformanceResourceTiming instances with these fields.
  const resources = performance.getEntriesByType("resource") as unknown as PerformanceResourceTiming[]
  const scripts = resources.filter((e) => e.initiatorType === "script")
  const imgs = resources.filter((e) => e.initiatorType === "img")
  const inv = [...state.invokes].sort((a, b) => a - b)
  // performance.memory exists only in Chromium/WebKit builds; absent from the TS lib.
  const performanceWithMemory = performance as unknown as {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
  }
  const mem = performanceWithMemory.memory
  const scrollables = [...document.querySelectorAll<HTMLElement>(".mf-scroll, .uc-aside")]
    .map((s) => ({ sh: s.scrollHeight, ch: s.clientHeight, st: Math.round(s.scrollTop), vis: s.offsetParent !== null }))
    .sort((a, b) => b.sh - a.sh)
    .slice(0, 3)
  const payload = {
    t: Date.now(),
    marks: state.marks,
    doms: state.doms,
    frames: { ...state.frames },
    wheel: { ...state.wheel, scrollables },
    invokes: {
      n: inv.length,
      min: Math.round(inv[0] ?? 0),
      p50: Math.round(pct(inv, 0.5)),
      p95: Math.round(pct(inv, 0.95)),
      max: Math.round(inv[inv.length - 1] ?? 0),
    },
    scripts: {
      n: scripts.length,
      bytes: scripts.reduce((s, e) => s + (e.transferSize || 0), 0),
      totalMs: Math.round(scripts.reduce((s, e) => s + e.duration, 0)),
      slowest: scripts
        .map((e) => ({ name: e.name.split("/").pop() ?? e.name, ms: Math.round(e.duration), bytes: e.transferSize || 0 }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5),
    },
    imgs: {
      count: imgs.length,
      bytes: imgs.reduce((s, e) => s + (e.transferSize || 0), 0),
      totalMs: Math.round(imgs.reduce((s, e) => s + e.duration, 0)),
    },
    domNodes: document.querySelectorAll("*").length,
    imgElements: document.images.length,
    memory: mem ? { usedJS: mem.usedJSHeapSize, totalJS: mem.totalJSHeapSize } : null,
  }
  try {
    await window.ucPerf?.dump(JSON.stringify(payload))
  } catch {
    /* backend gone */
  }
}