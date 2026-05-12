// Mirrors union-crax.xyz's <GameCardSkeleton /> exactly — same shimmer, same
// staggered delay helpers, same layout. The launcher's GameCard renders inside
// a `glass` rounded-2xl card, so the skeleton must use the same shell to avoid
// a layout jump on swap.
export function GameCardSkeleton() {
  return (
    <div className="group relative h-full overflow-hidden rounded-2xl glass flex flex-col">
      <div className="relative w-full overflow-hidden aspect-[3/4]">
        <div className="udl-skeleton w-full h-full rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />

        {/* Top-left badge placeholders */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
          <div className="udl-skeleton udl-skeleton-d1 h-5 w-16 rounded-full" />
          <div className="udl-skeleton udl-skeleton-d2 h-5 w-10 rounded-full" />
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Title */}
        <div className="udl-skeleton udl-skeleton-d1 h-5 w-4/5 rounded-lg" />

        {/* Genre tags */}
        <div className="flex flex-wrap gap-2">
          <div className="udl-skeleton udl-skeleton-d2 h-4 w-14 rounded-full" />
          <div className="udl-skeleton udl-skeleton-d3 h-4 w-10 rounded-full" />
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between pt-1 border-t border-white/[.07]">
          <div className="udl-skeleton udl-skeleton-d4 h-3 w-12 rounded-lg" />
          <div className="udl-skeleton udl-skeleton-d5 h-3 w-16 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
