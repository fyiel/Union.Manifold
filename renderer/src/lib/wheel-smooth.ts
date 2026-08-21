// Wheel-smoothing shim for WebKitGTK: mice and trackpads emit discrete wheel
// ticks, and WebKitGTK applies each one as a single hard jump — "chunky"
// scrolling. This intercepts wheel events over scrollable elements, converts
// tick deltas into a velocity, and animates scrollTop with exponential decay,
// giving the glide (inertia) native apps get.
//
// Design notes:
// - Velocity model, not target-animation: each tick updates the velocity;
//   between ticks (and after the last one) exponential decay (tau ~120ms)
//   carries the scroll forward — the classic momentum feel.
// - The loop self-stops at the scroll bounds or when velocity dies.
// - Nothing else changes: scroll events still fire every frame, so the
//   Browse scroll-window virtualization and loadMore thresholds behave as
//   before.
// - Passive:false is required so we can preventDefault the native jump.
// - Linux only: main.tsx gates initWheelSmoothing() on a Linux UA. On macOS
//   WKWebView and Windows WebView2 native momentum already glides, and the
//   shim would double-smooth it and swallow ctrl+wheel pinch zoom.

let vel = 0 // px/ms
let lastWheelAt = 0
let raf: number | null = null
let scroller: HTMLElement | null = null

function findScroller(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 4) return el
    el = el.parentElement
  }
  return null
}

function tick(now: number) {
  raf = null
  // Re-resolve each frame: the element can be swapped, unmounted, or resized
  // mid-glide; holding a stale reference either scrolls nothing or fights a
  // re-rendered scroller. The data attribute survives remounts of the page.
  const el =
    scroller?.isConnected && scroller.scrollHeight > scroller.clientHeight + 4
      ? scroller
      : findScroller(scroller ?? document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2))
  if (!el) {
    vel = 0
    scroller = null
    return
  }
  scroller = el
  // Cap dt so a long pause cannot cause a jump: the decay just continues.
  const dt = Math.min(50, Math.max(1, now - lastWheelAt))
  const prev = el.scrollTop
  el.scrollTop = prev + vel * dt
  vel *= Math.exp(-dt / 120)
  // A clamped write (scrollTop unchanged) means we hit a scroll bound: stop
  // instead of spinning frames against the clamp.
  if (el.scrollTop === prev || Math.abs(vel) < 0.02) {
    vel = 0
    scroller = null
    return
  }
  raf = requestAnimationFrame(tick)
}

export function initWheelSmoothing() {
  window.addEventListener(
    "wheel",
    (e) => {
      // Never intercept ctrl+wheel: that is pinch zoom on macOS/Windows and
      // browser zoom everywhere else.
      if (e.ctrlKey || e.metaKey) return
      const el = findScroller(e.target)
      if (!el) return
      const delta = e.deltaY * (e.deltaMode === 1 ? 40 : 1)
      if (delta === 0) return
      e.preventDefault()
      const now = performance.now()
      const dt = Math.max(8, now - lastWheelAt)
      const inst = Math.max(-6, Math.min(6, delta / dt))
      vel = vel * 0.5 + inst * 0.5
      scroller = el
      lastWheelAt = now
      if (raf === null) raf = requestAnimationFrame(tick)
    },
    { passive: false },
  )
}
