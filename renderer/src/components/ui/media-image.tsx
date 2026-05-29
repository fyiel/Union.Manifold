import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react"
import { Loader2, ImageOff } from "lucide-react"
import { forgetImageFailure, isImageKnownBad, markImageFailed } from "@/lib/image-failure-cache"

type MediaImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string
  alt: string
  fallbackSrc?: string
  containerClassName?: string
  showLoadingSpinner?: boolean
  showErrorState?: boolean
  errorLabel?: string
  /** Disable retry-on-error. Defaults to false (one retry with backoff). */
  noRetry?: boolean
  // When true, the spinner / error overlay is rendered into the parent (which
  // must be position:relative). When false (default) we wrap the <img> in our
  // own relative container so callers can drop us in anywhere.
  unwrapped?: boolean
}

/**
 * URLs whose protocol can't be helped by retrying — the file is either there
 * or it isn't. Retrying just adds latency before the fallback kicks in.
 */
function isLocalProtocol(url: string): boolean {
  return Boolean(url) && (url.startsWith("uc-local://") || url.startsWith("file://") || url.startsWith("data:") || url.startsWith("blob:"))
}

export function MediaImage({
  src,
  alt,
  className,
  fallbackSrc,
  containerClassName,
  showLoadingSpinner = true,
  showErrorState = true,
  errorLabel = "Image unavailable",
  unwrapped = false,
  noRetry = false,
  onLoad,
  onError,
  ...rest
}: MediaImageProps) {
  // If src is already known to be bad and we have a fallback, start with the
  // fallback to avoid the spinner-then-error flash on every grid mount.
  const initialSrc = src && fallbackSrc && isImageKnownBad(src) ? fallbackSrc : src
  const initialUsedFallback = initialSrc !== src

  const [currentSrc, setCurrentSrc] = useState(initialSrc)
  // Bumping `attempt` re-mounts the <img> with the same src, which causes the
  // browser to re-fetch. Cleaner than briefly clearing src (which produced
  // React's "empty string was passed to src" warning) and works whether the
  // URL is a remote http or our uc-local:// custom protocol.
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [usedFallback, setUsedFallback] = useState(initialUsedFallback)
  const retryCountRef = useRef(0)
  const previousSrc = useRef(src)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (previousSrc.current === src) return
    previousSrc.current = src
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    const startSrc = src && fallbackSrc && isImageKnownBad(src) ? fallbackSrc : src
    setCurrentSrc(startSrc)
    setLoaded(false)
    setFailed(false)
    setUsedFallback(startSrc !== src)
    setAttempt(0)
    retryCountRef.current = 0
  }, [src, fallbackSrc])

  // Clear any pending retry on unmount.
  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
  }, [])

  const overlay = (
    <>
      {!loaded && !failed && showLoadingSpinner && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-white/70 drop-shadow" />
        </div>
      )}
      {failed && showErrorState && (
        <div
          aria-hidden
          role="img"
          aria-label={`${alt} failed to load`}
          className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-1 bg-card/70 text-muted-foreground"
        >
          <ImageOff className="h-5 w-5" />
          <span className="text-[10px] uppercase tracking-wider">{errorLabel}</span>
        </div>
      )}
    </>
  )

  // The `key` forces a fresh <img> element on retry so the browser re-fetches.
  const img = currentSrc ? (
    <img
      {...rest}
      key={`${currentSrc}#${attempt}`}
      src={currentSrc}
      alt={alt}
      // Tell the global Layout error logger that this <img> handles its own
      // failures — no need for the noisy "Resource load failed" log line.
      data-uc-handled="1"
      ref={(node) => {
        // Browser-cached / already-decoded images can be complete before
        // React subscribes onLoad → the spinner sticks forever. Sync the
        // state from `complete` + `naturalWidth` when the node mounts and
        // also fire the consumer's onLoad so parent state (e.g. the card's
        // own skeleton flag) clears too.
        if (!node) return
        if (node.complete && node.naturalWidth > 0) {
          if (!loaded) {
            setLoaded(true)
            setFailed(false)
            if (currentSrc) forgetImageFailure(currentSrc)
            try {
              onLoad?.({ currentTarget: node, target: node } as unknown as React.SyntheticEvent<HTMLImageElement>)
            } catch { /* ignore — caller's onLoad may not expect this synth event */ }
          }
        } else if (node.complete && node.naturalWidth === 0 && !failed && !usedFallback) {
          // Decoded but empty = load failed before React subscribed onError.
          // Mirror the onError logic without retrying — the image is bad.
          if (currentSrc) markImageFailed(currentSrc)
          if (fallbackSrc && currentSrc !== fallbackSrc) {
            setUsedFallback(true)
            setCurrentSrc(fallbackSrc)
          } else {
            setLoaded(true)
            setFailed(true)
          }
        }
      }}
      className={`${className ?? ""} transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      onLoad={(event) => {
        // Successful load — drop the URL from the failed-cache in case we
        // were rendering a fallback after a previous transient failure.
        if (currentSrc) forgetImageFailure(currentSrc)
        setLoaded(true)
        setFailed(false)
        onLoad?.(event)
      }}
      onError={(event) => {
        // Retry once for remote URLs only — uc-local / file:// either work or
        // they don't, and retrying just stalls the fallback chain. Catches
        // transient http failures (proxy cold-start, network blip).
        if (
          !noRetry
          && !usedFallback
          && retryCountRef.current < 1
          && currentSrc === src
          && !isLocalProtocol(currentSrc)
        ) {
          retryCountRef.current += 1
          retryTimerRef.current = setTimeout(() => {
            setAttempt((value) => value + 1)
          }, 350)
          return
        }
        // Mark the original src as bad so siblings rendering the same URL
        // skip the spinner-then-fallback flash on first paint.
        if (currentSrc) markImageFailed(currentSrc)
        if (!usedFallback && fallbackSrc && currentSrc !== fallbackSrc) {
          setUsedFallback(true)
          setCurrentSrc(fallbackSrc)
          return
        }
        setLoaded(true)
        setFailed(true)
        onError?.(event)
      }}
    />
  ) : null

  if (unwrapped) {
    return (
      <>
        {img}
        {overlay}
      </>
    )
  }

  return (
    <div className={`relative ${containerClassName ?? ""}`}>
      {img}
      {overlay}
    </div>
  )
}
