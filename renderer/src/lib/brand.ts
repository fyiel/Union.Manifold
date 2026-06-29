// Centralized brand strings for the fork. Renaming the product is a one-file
// change, update these and the packaging metadata (package.json build.*).
// "Union.Manifold" renders as a two-line lockup ("Union" over a spaced
// ".MANIFOLD") next to the manifold glyph. Monochrome, no accent baked in.
export const BRAND = {
  name: "Union.Manifold",
  // first line of the sidebar lockup
  title: "Union",
  // second line, monospace and letter-spaced
  suffix: ".MANIFOLD",
  // single-string wordmark for compact spots / window title
  wordmark: "UNION.MANIFOLD",
  tagline: "many sources, deduped into one library",
  // short status-strip blurb
  status: "all systems operational",
} as const
