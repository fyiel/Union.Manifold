#!/usr/bin/env node
/**
 * One-shot codemod: walk renderer/src and split every
 *   import { Foo, Bar, Baz } from "lucide-react"
 * into two imports — one for names that have animated wrappers in
 * @/components/icons, one for names that don't (still from lucide-react).
 *
 * Run with:  node scripts/migrate-icons.cjs
 *
 * Idempotent: re-running won't duplicate animated names; if a file already
 * has a `@/components/icons` import for a name we leave it alone.
 *
 * Limits: only handles the standard
 *   import { A, B as C, type D } from "lucide-react"
 * shape (which is the only one used in this codebase). Multi-line imports
 * are supported.
 */
const fs = require("fs")
const path = require("path")

const ANIMATED = new Set([
  "Bell", "BellRing", "Heart", "Star", "Search", "Settings", "ExternalLink",
  "FolderOpen", "Folder", "Layers", "Layers3", "Trash2", "Trash", "Plus",
  "Minus", "Check", "CheckCheck", "Download", "Upload", "ChevronDown",
  "ChevronUp", "ChevronLeft", "ChevronRight", "ChevronsLeft", "ChevronsRight",
  "ChevronsUp", "ChevronsDown", "Menu", "House", "Home", "User", "Users",
  "Play", "Pause", "Sparkles", "Sun", "Moon", "Terminal", "Send", "Share",
  "Link", "Unlink", "Unlink2", "Eye", "EyeOff", "Loader", "LoaderCircle",
  "Loader2", "LogIn", "LogOut", "Mail", "Wallet", "Wifi", "WifiOff", "Lock",
  "Bookmark", "Activity", "Info", "TriangleAlert", "AlertTriangle", "Rocket",
  "Compass", "Globe", "Github", "TrendingUp", "TrendingDown", "Coffee",
  "Gamepad", "Gamepad2", "Key", "Copy", "Paperclip", "CreditCard", "Contact",
  "ShieldCheck", "BookOpen", "Zap", "Flame", "Code", "Ellipsis",
  "MoreHorizontal", "EllipsisVertical", "MoreVertical", "Box", "LayoutGrid",
  "LayoutList", "SlidersHorizontal", "Settings2",
])

const SRC = path.resolve(__dirname, "../renderer/src")
const IGNORE_FILES = new Set([
  // Already updated by hand, OR the wrapper module itself.
  path.resolve(SRC, "components/icons.tsx"),
])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

function parseImportBlock(block) {
  // block is the content between `{` and `}`. Split on commas, trim, skip empties.
  return block
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatImport(source, specs) {
  if (specs.length === 0) return ""
  // Match the indent style used in the codebase: 2-space indent, one per line
  // for >=3 specs, single-line for 1-2.
  if (specs.length <= 2) {
    return `import { ${specs.join(", ")} } from "${source}"`
  }
  return `import {\n  ${specs.join(",\n  ")},\n} from "${source}"`
}

/** Rewrite one file. Returns true if it was modified. */
function processFile(file) {
  let src = fs.readFileSync(file, "utf8")
  const original = src

  // Match `import { ... } from "lucide-react"` (multiline supported).
  const importRe = /import\s*\{([^}]+)\}\s*from\s*"lucide-react"/g
  src = src.replace(importRe, (_, body) => {
    const specs = parseImportBlock(body)
    const animatedSpecs = []
    const lucideSpecs = []
    for (const spec of specs) {
      // Detect the local name. Handles:
      //   "Foo"                → name=Foo
      //   "Foo as Bar"         → name=Foo (split by import-source, not local)
      //   "type Foo"           → type-only, keep in lucide
      //   "type Foo as Bar"    → type-only
      const isType = /^type\s+/.test(spec)
      const bare = spec.replace(/^type\s+/, "")
      const sourceName = bare.split(/\s+as\s+/)[0].trim()
      if (!isType && ANIMATED.has(sourceName)) {
        animatedSpecs.push(spec)
      } else {
        lucideSpecs.push(spec)
      }
    }
    if (animatedSpecs.length === 0) {
      // Nothing to migrate from this file's lucide import.
      return _
    }
    const parts = []
    if (lucideSpecs.length > 0) {
      parts.push(formatImport("lucide-react", lucideSpecs))
    }
    parts.push(formatImport("@/components/icons", animatedSpecs))
    return parts.join("\n")
  })

  if (src !== original) {
    fs.writeFileSync(file, src, "utf8")
    return true
  }
  return false
}

const files = walk(SRC).filter((f) => !IGNORE_FILES.has(f))
let modified = 0
for (const file of files) {
  if (processFile(file)) {
    modified += 1
    console.log("updated:", path.relative(SRC, file))
  }
}
console.log(`\nDone — ${modified} file${modified === 1 ? "" : "s"} updated.`)
