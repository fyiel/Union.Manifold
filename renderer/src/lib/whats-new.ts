/**
 * Parse CHANGELOG.md into structured release-note entries for the
 * "What's new" modal. The CHANGELOG is the single source of truth — we
 * don't maintain a separate JS-side data file.
 *
 * Expected structure (matches the existing CHANGELOG.md format):
 *
 *   # Changelog
 *
 *   ## v2.3.0 — Codename · 2026-05-19
 *
 *   Optional intro paragraph(s).
 *
 *   ### Section heading
 *
 *   - Bullet point about a change.
 *   - Another bullet.
 *
 *   ### Another section
 *
 * Versions without subsection bullets still produce a `ReleaseNotes` entry
 * with whatever raw bullets we find, so even sparse drafts render.
 */

export type ReleaseHighlight = {
  /** Section heading the bullet was under (e.g. "Linux system requirements"). */
  section: string
  /** First-line summary of the bullet — trimmed and stripped of bold markers. */
  title: string
  /** Optional remaining body of the bullet. */
  body?: string
  /** Heuristic category derived from the section/bullet — drives the icon. */
  kind: "feature" | "fix" | "polish"
}

export type ReleaseNotes = {
  version: string
  codename?: string
  date?: string
  intro?: string
  highlights: ReleaseHighlight[]
}

const SECTION_KIND_PATTERNS: Array<{ kind: ReleaseHighlight["kind"]; pattern: RegExp }> = [
  { kind: "fix",     pattern: /\b(fix(?:es|ed)?|bug|patch|crash|hotfix|regression)\b/i },
  { kind: "polish",  pattern: /\b(polish|design|ui\b|ux\b|tweak|refactor|cleanup|improve(?:d|ments)?|tidy|consistency)\b/i },
  { kind: "feature", pattern: /\b(feature|introduc|add(?:ed|s)?|new|launch|debut|support)\b/i },
]

function classifyKind(section: string, bullet: string): ReleaseHighlight["kind"] {
  const combined = `${section} ${bullet}`
  for (const { kind, pattern } of SECTION_KIND_PATTERNS) {
    if (pattern.test(combined)) return kind
  }
  return "feature"
}

/** Strip markdown emphasis and link wrapping for the inline title. */
function stripMarkdownLight(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim()
}

function parseVersionHeader(raw: string): { version: string; codename?: string; date?: string } | null {
  // "## v2.3.0", "## v2.2.0 — Crossroads · 2026-05-19", "## 1.0", etc.
  const cleaned = raw.replace(/^#+\s*/, "").trim()
  // Pull out version token.
  const versionMatch = cleaned.match(/^v?([0-9][0-9.\w-]*)/i)
  if (!versionMatch) return null
  const version = versionMatch[1]
  const rest = cleaned.slice(versionMatch[0].length).trim()
  if (!rest) return { version }
  // Try to split on em-dash / hyphen / middot. Codename is whatever's between
  // the version and the date (if any).
  const dateMatch = rest.match(/\b(\d{4}-\d{1,2}(?:-\d{1,2})?)\b/)
  let codenamePart = rest
  let date: string | undefined
  if (dateMatch) {
    date = dateMatch[1]
    codenamePart = rest.slice(0, dateMatch.index).trim()
    codenamePart = codenamePart.replace(/^[—–·\s-]+|[—–·\s-]+$/g, "").trim()
  }
  return {
    version,
    codename: codenamePart || undefined,
    date,
  }
}

export function parseChangelogMarkdown(markdown: string): ReleaseNotes[] {
  if (!markdown || typeof markdown !== "string") return []
  const lines = markdown.split(/\r?\n/)
  const releases: ReleaseNotes[] = []
  // Use an indexer instead of a separate `current` reference so TypeScript's
  // control-flow analysis doesn't try to narrow it away to `never` after
  // the inner functions mutate `releases`. We always operate on
  // `releases[releases.length - 1]` once a release header has been seen.
  const currentRelease = (): ReleaseNotes | null => releases.length === 0 ? null : releases[releases.length - 1]
  let currentSection = "Notes"
  let introBuffer: string[] = []
  let bulletBuffer: string[] = []

  const flushBullet = () => {
    const release = currentRelease()
    if (!release || bulletBuffer.length === 0) return
    const joined = bulletBuffer.join(" ").trim().replace(/^[-*]\s*/, "")
    if (!joined) {
      bulletBuffer = []
      return
    }
    const stripped = stripMarkdownLight(joined)
    let title = stripped
    let body: string | undefined
    const dashIdx = stripped.indexOf(" — ")
    if (dashIdx > 0) {
      title = stripped.slice(0, dashIdx).trim()
      body = stripped.slice(dashIdx + 3).trim()
    } else if (stripped.length > 80) {
      const dot = stripped.search(/\.\s/)
      if (dot > 0 && dot < 120) {
        title = stripped.slice(0, dot + 1).trim()
        body = stripped.slice(dot + 1).trim() || undefined
      }
    }
    release.highlights.push({
      section: currentSection,
      title: title.replace(/[.,;]+$/, ""),
      body,
      kind: classifyKind(currentSection, stripped),
    })
    bulletBuffer = []
  }

  const flushIntro = () => {
    const release = currentRelease()
    if (!release) return
    const text = introBuffer.join(" ").trim()
    if (text && !release.intro) release.intro = stripMarkdownLight(text)
    introBuffer = []
  }

  const startRelease = (header: ReturnType<typeof parseVersionHeader>) => {
    if (!header) return
    flushBullet()
    flushIntro()
    releases.push({
      version: header.version,
      codename: header.codename,
      date: header.date,
      highlights: [],
    })
    currentSection = "Notes"
    introBuffer = []
    bulletBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine
    if (/^#\s+/.test(line) && !/^##/.test(line)) continue
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      const header = parseVersionHeader(line)
      if (header) startRelease(header)
      continue
    }
    const release = currentRelease()
    if (!release) continue
    if (/^###\s+/.test(line)) {
      flushBullet()
      currentSection = stripMarkdownLight(line.replace(/^###\s+/, ""))
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushBullet()
      bulletBuffer.push(line.trim())
      continue
    }
    if (bulletBuffer.length > 0 && /^\s{2,}\S/.test(line)) {
      bulletBuffer.push(line.trim())
      continue
    }
    if (line.trim() && bulletBuffer.length === 0) {
      introBuffer.push(line.trim())
      continue
    }
    if (!line.trim()) {
      flushBullet()
      if (introBuffer.length > 0 && !release.intro) {
        flushIntro()
      }
    }
  }
  flushBullet()
  flushIntro()

  return releases
}

/**
 * Fetch the bundled CHANGELOG.md and parse it. Returns an empty array when
 * the file isn't available (dev sandbox / unpacked build path missing).
 */
export async function loadReleaseNotes(): Promise<ReleaseNotes[]> {
  if (typeof window === "undefined") return []
  try {
    const result = await window.ucUpdater?.getChangelog?.()
    if (!result?.ok || !result.markdown) return []
    return parseChangelogMarkdown(result.markdown)
  } catch {
    return []
  }
}
