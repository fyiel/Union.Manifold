/**
 * Animated-icon bridge.
 *
 * `@animateicons/react/lucide` ships hover-animated versions of many Lucide
 * icons, but each one renders as a wrapping `<div>` around an inner `<svg>`
 * with a fixed pixel size. That doesn't play with our pervasive
 * `className="h-4 w-4 …"` Tailwind sizing convention — the inner SVG would
 * overflow the div.
 *
 * This file wraps each available animated icon so it behaves like its
 * Lucide counterpart from the consumer's perspective:
 *   - `className` is forwarded onto the wrapping div (text-color → currentColor
 *      inheritance still drives the stroke).
 *   - Tailwind `h-N w-N` classes drive the wrapping div size, and we mirror
 *      that pixel size onto the animated icon's `size` prop via a parser so
 *      the inner SVG matches the box.
 *   - When no `h-/w-` class is present, we default to `size={16}` (matches
 *      our most common `h-4 w-4`).
 *
 * Only icons that have an animated equivalent are exported from here —
 * everything else continues to import from `lucide-react` directly.
 *
 * The user-facing rule: hover an icon, it plays its animation. No extra
 * configuration at call sites.
 *
 * Reduced motion: `useMotionPreferences` mirrors the effective reduced-motion
 * state to `<html data-reduced-motion="1">`. This wrapper flips
 * `isAnimated={false}` for that branch so the icons render statically.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { ComponentPropsWithoutRef, ComponentType, RefObject } from "react"
import {
  BellIcon,
  BellRingIcon,
  HeartIcon,
  StarIcon,
  SearchIcon,
  SettingsIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  FolderIcon,
  LayersIcon,
  Trash2Icon,
  TrashIcon,
  PlusIcon,
  MinusIcon,
  CheckIcon,
  CheckCheckIcon,
  DownloadIcon,
  UploadIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronsUpIcon,
  ChevronsDownIcon,
  MenuIcon,
  HouseIcon,
  UserIcon,
  UsersIcon,
  PlayIcon,
  PauseIcon,
  SparklesIcon,
  SunIcon,
  MoonIcon,
  TerminalIcon,
  SendIcon,
  ShareIcon,
  LinkIcon,
  UnlinkIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderIcon,
  LoaderCircleIcon,
  LoginIcon,
  LogoutIcon,
  MailIcon,
  WalletIcon,
  WifiIcon,
  WifiOffIcon,
  LockIcon,
  BookmarkIcon,
  ActivityIcon,
  InfoIcon,
  TriangleAlertIcon,
  RocketIcon,
  CompassIcon,
  GlobeIcon,
  GithubIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  CoffeeIcon,
  GamepadIcon,
  KeyIcon,
  CopyIcon,
  PaperclipIcon,
  CreditCardIcon,
  ContactIcon,
  ShieldCheckIcon,
  BookOpenIcon,
  ZapIcon,
  FlameIcon,
  CodeIcon,
  EllipsisIcon,
  EllipsisVerticalIcon,
  BoxIcon,
  LayoutGridIcon,
  LayoutListIcon,
  SlidersHorizontalIcon,
} from "@animateicons/react/lucide"

/** Imperative handle exposed by every animated icon. */
type AnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

/** The animated icons extend HTMLAttributes<HTMLDivElement> internally, so
 *  they accept style/onClick/aria-* in addition to size/color/etc. */
type AnimatedComponent = ComponentType<{
  size?: number
  color?: string
  duration?: number
  isAnimated?: boolean
  className?: string
  style?: ComponentPropsWithoutRef<"div">["style"]
  onClick?: ComponentPropsWithoutRef<"div">["onClick"]
  "aria-hidden"?: boolean | "true" | "false"
  ref?: RefObject<AnimatedIconHandle | null>
}>

/** Pluck a pixel size from a Tailwind `h-N`/`size-N` class. Returns null if
 * we can't determine it — the caller falls back to a sensible default. */
function pixelSizeFromClassName(className?: string): number | null {
  if (!className) return null
  // Match h-4, h-5, size-3.5 etc. Decimal forms like h-3.5 → 14px.
  const match = className.match(/(?:^|\s)(?:h|size)-(\d+(?:\.\d+)?)(?:\s|$)/)
  if (!match) return null
  const n = parseFloat(match[1])
  if (!Number.isFinite(n)) return null
  // Tailwind's spacing scale: 1 unit = 0.25rem = 4px.
  return Math.round(n * 4)
}

/** Subscribe to the `data-reduced-motion` flag flipped by useMotionPreferences. */
function useReducedMotionAttr() {
  const [reduced, setReduced] = useState(() => {
    if (typeof document === "undefined") return false
    return document.documentElement.getAttribute("data-reduced-motion") === "1"
  })
  useEffect(() => {
    if (typeof document === "undefined" || !window.MutationObserver) return
    const target = document.documentElement
    const obs = new MutationObserver(() => {
      setReduced(target.getAttribute("data-reduced-motion") === "1")
    })
    obs.observe(target, { attributes: true, attributeFilter: ["data-reduced-motion"] })
    return () => obs.disconnect()
  }, [])
  return reduced
}

type WrapperProps = {
  className?: string
  size?: number
  color?: string
  duration?: number
  /** Allow caller to opt-out of animation per icon (e.g. permanent inert state). */
  isAnimated?: boolean
  /** Pass-through for parent click handlers when icon is used as a button child. */
  onClick?: ComponentPropsWithoutRef<"div">["onClick"]
  style?: ComponentPropsWithoutRef<"div">["style"]
  /** Aria-hidden for decorative icons. */
  "aria-hidden"?: boolean | "true" | "false"
  /** Accepted for lucide call-site compatibility; the animated lib draws
   *  fixed-weight strokes, so this prop is ignored. */
  strokeWidth?: number | string
  /** Same as above — fill is ignored by the animated set. */
  fill?: string
}

/**
 * Selector used to find the "hover trigger" element for an icon. We climb
 * the DOM from the icon's anchor until we hit one of these:
 *   - any element explicitly opted-in via `data-icon-hover-parent`
 *   - the nearest interactive ancestor (button, link, role=button/menuitem)
 *
 * If none match we fall back to the icon's direct parent. This means an
 * icon nested anywhere inside a `<NavLink>`/`<button>` animates on hover
 * of the *whole row*, not just the icon's own bounding box — which is
 * what users actually expect.
 */
const HOVER_TRIGGER_SELECTOR =
  '[data-icon-hover-parent], a, button, [role="button"], [role="menuitem"], [role="link"], [role="tab"]'

function makeWrapper(Animated: AnimatedComponent, displayName: string) {
  const Wrapped = function AnimatedIconWrapper({
    className,
    size,
    isAnimated,
    strokeWidth: _strokeWidth,
    fill: _fill,
    style,
    ...rest
  }: WrapperProps) {
    const reducedMotion = useReducedMotionAttr()
    const resolvedSize = useMemo(
      () => size ?? pixelSizeFromClassName(className) ?? 16,
      [size, className]
    )

    // Imperative handle to drive the icon's animation from the parent's
    // hover. Without this, the lib's built-in hover only fires when the
    // cursor enters the icon's own div — too small a hit area for users
    // hovering a wider row.
    const handleRef = useRef<AnimatedIconHandle | null>(null)
    const anchorRef = useRef<HTMLSpanElement | null>(null)
    const animationsOn = reducedMotion ? false : (isAnimated ?? true)

    useEffect(() => {
      if (!animationsOn) return
      const anchor = anchorRef.current
      if (!anchor) return
      // `closest` matches the anchor itself first — start the climb from
      // the parent so we don't latch onto our own wrapper span.
      const trigger =
        anchor.parentElement?.closest(HOVER_TRIGGER_SELECTOR) ??
        anchor.parentElement
      if (!trigger) return
      const onEnter = () => handleRef.current?.startAnimation()
      const onLeave = () => handleRef.current?.stopAnimation()
      trigger.addEventListener("mouseenter", onEnter)
      trigger.addEventListener("mouseleave", onLeave)
      // Focus-visible: keyboard users get the animation too when tabbing
      // through the row.
      trigger.addEventListener("focusin", onEnter)
      trigger.addEventListener("focusout", onLeave)
      return () => {
        trigger.removeEventListener("mouseenter", onEnter)
        trigger.removeEventListener("mouseleave", onLeave)
        trigger.removeEventListener("focusin", onEnter)
        trigger.removeEventListener("focusout", onLeave)
      }
    }, [animationsOn])

    return (
      <span
        ref={anchorRef}
        // `display:contents` keeps the anchor layout-neutral — Tailwind
        // sizing/color classes on `className` apply directly to the
        // animated icon's own div, and our wrapper is invisible to
        // layout. The span only exists as a DOM anchor so we can find
        // the hover-trigger ancestor in the effect above.
        style={{ display: "contents" }}
      >
        <Animated
          ref={handleRef}
          size={resolvedSize}
          isAnimated={animationsOn}
          className={className}
          // The lib's outer element is `inline-flex`, which contributes
          // to its parent's *line box* — that line box inherits
          // line-height: 1.5 from html, so a 16px icon sat inside a 24px
          // line box and made every wrapper (e.g. p-1.5 badges) ~8px
          // taller than before. Tailwind's preflight avoids this on
          // bare SVGs via `svg { display: block }`. Forcing the same
          // here restores the previous box height. `inline-flex`'s
          // items-center/justify-center become no-ops when display:block
          // is in force, which is fine — the inner SVG already matches
          // its container size, so no centering is needed.
          style={{ display: "block", ...style }}
          {...rest}
        />
      </span>
    )
  }
  Wrapped.displayName = displayName
  return Wrapped
}

// ---- Public exports, named to match lucide-react ----------------------------

export const Bell = makeWrapper(BellIcon, "Bell")
export const BellRing = makeWrapper(BellRingIcon, "BellRing")
export const Heart = makeWrapper(HeartIcon, "Heart")
export const Star = makeWrapper(StarIcon, "Star")
export const Search = makeWrapper(SearchIcon, "Search")
export const Settings = makeWrapper(SettingsIcon, "Settings")
export const ExternalLink = makeWrapper(ExternalLinkIcon, "ExternalLink")
export const FolderOpen = makeWrapper(FolderOpenIcon, "FolderOpen")
export const Folder = makeWrapper(FolderIcon, "Folder")
export const Layers = makeWrapper(LayersIcon, "Layers")
/** Lucide's `Layers3` has no exact animated equivalent — fall through to the
 *  basic `Layers` animation. The visual difference is minor at small sizes. */
export const Layers3 = makeWrapper(LayersIcon, "Layers3")
export const Trash2 = makeWrapper(Trash2Icon, "Trash2")
export const Trash = makeWrapper(TrashIcon, "Trash")
export const Plus = makeWrapper(PlusIcon, "Plus")
export const Minus = makeWrapper(MinusIcon, "Minus")
export const Check = makeWrapper(CheckIcon, "Check")
export const CheckCheck = makeWrapper(CheckCheckIcon, "CheckCheck")
export const Download = makeWrapper(DownloadIcon, "Download")
export const Upload = makeWrapper(UploadIcon, "Upload")
export const ChevronDown = makeWrapper(ChevronDownIcon, "ChevronDown")
export const ChevronUp = makeWrapper(ChevronUpIcon, "ChevronUp")
export const ChevronLeft = makeWrapper(ChevronLeftIcon, "ChevronLeft")
export const ChevronRight = makeWrapper(ChevronRightIcon, "ChevronRight")
export const ChevronsLeft = makeWrapper(ChevronsLeftIcon, "ChevronsLeft")
export const ChevronsRight = makeWrapper(ChevronsRightIcon, "ChevronsRight")
export const ChevronsUp = makeWrapper(ChevronsUpIcon, "ChevronsUp")
export const ChevronsDown = makeWrapper(ChevronsDownIcon, "ChevronsDown")
export const Menu = makeWrapper(MenuIcon, "Menu")
export const House = makeWrapper(HouseIcon, "House")
/** Lucide 0.454 exports `Home`, not `House` — map both for compatibility. */
export const Home = makeWrapper(HouseIcon, "Home")
export const User = makeWrapper(UserIcon, "User")
export const Users = makeWrapper(UsersIcon, "Users")
export const Play = makeWrapper(PlayIcon, "Play")
export const Pause = makeWrapper(PauseIcon, "Pause")
export const Sparkles = makeWrapper(SparklesIcon, "Sparkles")
export const Sun = makeWrapper(SunIcon, "Sun")
export const Moon = makeWrapper(MoonIcon, "Moon")
export const Terminal = makeWrapper(TerminalIcon, "Terminal")
export const Send = makeWrapper(SendIcon, "Send")
export const Share = makeWrapper(ShareIcon, "Share")
export const Link = makeWrapper(LinkIcon, "Link")
/** Lucide ships `Unlink2`; animated lib only has plain Unlink — close enough. */
export const Unlink = makeWrapper(UnlinkIcon, "Unlink")
export const Unlink2 = makeWrapper(UnlinkIcon, "Unlink2")
export const Eye = makeWrapper(EyeIcon, "Eye")
export const EyeOff = makeWrapper(EyeOffIcon, "EyeOff")
export const Loader = makeWrapper(LoaderIcon, "Loader")
export const LoaderCircle = makeWrapper(LoaderCircleIcon, "LoaderCircle")
/** Lucide exports `Loader2` — animated lib has `LoaderCircle`, same idea. */
export const Loader2 = makeWrapper(LoaderCircleIcon, "Loader2")
export const LogIn = makeWrapper(LoginIcon, "LogIn")
export const LogOut = makeWrapper(LogoutIcon, "LogOut")
export const Mail = makeWrapper(MailIcon, "Mail")
export const Wallet = makeWrapper(WalletIcon, "Wallet")
export const Wifi = makeWrapper(WifiIcon, "Wifi")
export const WifiOff = makeWrapper(WifiOffIcon, "WifiOff")
export const Lock = makeWrapper(LockIcon, "Lock")
export const Bookmark = makeWrapper(BookmarkIcon, "Bookmark")
export const Activity = makeWrapper(ActivityIcon, "Activity")
export const Info = makeWrapper(InfoIcon, "Info")
export const TriangleAlert = makeWrapper(TriangleAlertIcon, "TriangleAlert")
/** Older lucide name for the same glyph. */
export const AlertTriangle = makeWrapper(TriangleAlertIcon, "AlertTriangle")
export const Rocket = makeWrapper(RocketIcon, "Rocket")
export const Compass = makeWrapper(CompassIcon, "Compass")
export const Globe = makeWrapper(GlobeIcon, "Globe")
export const Github = makeWrapper(GithubIcon, "Github")
export const TrendingUp = makeWrapper(TrendingUpIcon, "TrendingUp")
export const TrendingDown = makeWrapper(TrendingDownIcon, "TrendingDown")
export const Coffee = makeWrapper(CoffeeIcon, "Coffee")
export const Gamepad = makeWrapper(GamepadIcon, "Gamepad")
/** Lucide's `Gamepad2` doesn't exist in the animated set; basic Gamepad is the closest match. */
export const Gamepad2 = makeWrapper(GamepadIcon, "Gamepad2")
export const Key = makeWrapper(KeyIcon, "Key")
export const Copy = makeWrapper(CopyIcon, "Copy")
export const Paperclip = makeWrapper(PaperclipIcon, "Paperclip")
export const CreditCard = makeWrapper(CreditCardIcon, "CreditCard")
export const Contact = makeWrapper(ContactIcon, "Contact")
export const ShieldCheck = makeWrapper(ShieldCheckIcon, "ShieldCheck")
export const BookOpen = makeWrapper(BookOpenIcon, "BookOpen")
export const Zap = makeWrapper(ZapIcon, "Zap")
export const Flame = makeWrapper(FlameIcon, "Flame")
export const Code = makeWrapper(CodeIcon, "Code")
export const Ellipsis = makeWrapper(EllipsisIcon, "Ellipsis")
/** Older lucide alias for the same glyph. */
export const MoreHorizontal = makeWrapper(EllipsisIcon, "MoreHorizontal")
export const EllipsisVertical = makeWrapper(EllipsisVerticalIcon, "EllipsisVertical")
export const MoreVertical = makeWrapper(EllipsisVerticalIcon, "MoreVertical")
export const Box = makeWrapper(BoxIcon, "Box")
export const LayoutGrid = makeWrapper(LayoutGridIcon, "LayoutGrid")
export const LayoutList = makeWrapper(LayoutListIcon, "LayoutList")
export const SlidersHorizontal = makeWrapper(SlidersHorizontalIcon, "SlidersHorizontal")
/** Settings2 is lucide's vertical-sliders icon; closest animated match is SlidersHorizontal. */
export const Settings2 = makeWrapper(SlidersHorizontalIcon, "Settings2")
