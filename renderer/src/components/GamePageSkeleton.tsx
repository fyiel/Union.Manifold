// Mirrors union-crax.xyz's <GamePageSkeleton /> — same shell, same stagger.
// The Skeleton primitive already applies `udl-skeleton`; passing
// `bg-white/5`-style overrides would tank the shimmer, so we don't.
import { Skeleton } from "@/components/ui/skeleton"

export function GamePageSkeleton() {
  return (
    <div className="container mx-auto px-4 py-12 space-y-10">
      {/* Hero / Banner */}
      <section className="max-w-6xl mx-auto">
        <div className="relative rounded-3xl overflow-hidden border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md">
          <Skeleton className="aspect-video w-full rounded-none" />
          {/* Overlay info strip */}
          <div className="absolute bottom-0 left-0 right-0 p-6 space-y-3 bg-gradient-to-t from-black/70 to-transparent">
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full udl-skeleton-d1" />
              <Skeleton className="h-6 w-16 rounded-full udl-skeleton-d2" />
              <Skeleton className="h-6 w-24 rounded-full udl-skeleton-d3" />
            </div>
            <Skeleton className="h-10 w-2/3 rounded-xl udl-skeleton-d1" />
            <Skeleton className="h-5 w-1/4 rounded-xl udl-skeleton-d2" />
          </div>
        </div>
      </section>

      {/* Main Content Grid */}
      <section className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description block */}
            <div className="p-8 rounded-3xl border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md space-y-4">
              <Skeleton className="h-7 w-40 rounded-lg udl-skeleton-d1" />
              <div className="space-y-2.5">
                <Skeleton className="h-4 w-full rounded udl-skeleton-d1" />
                <Skeleton className="h-4 w-full rounded udl-skeleton-d2" />
                <Skeleton className="h-4 w-5/6 rounded udl-skeleton-d3" />
                <Skeleton className="h-4 w-4/5 rounded udl-skeleton-d4" />
                <Skeleton className="h-4 w-3/4 rounded udl-skeleton-d5" />
              </div>
            </div>

            {/* Screenshots block */}
            <div className="p-6 rounded-3xl border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-7 w-32 rounded-lg udl-skeleton-d1" />
                <Skeleton className="h-8 w-24 rounded-lg udl-skeleton-d2" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="aspect-video rounded-2xl udl-skeleton-d1" />
                <Skeleton className="aspect-video rounded-2xl udl-skeleton-d2" />
                <Skeleton className="aspect-video rounded-2xl udl-skeleton-d3" />
              </div>
            </div>

            {/* System requirements block */}
            <div className="p-6 rounded-3xl border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md space-y-4">
              <Skeleton className="h-5 w-48 rounded udl-skeleton-d1" />
              <div className="grid md:grid-cols-2 gap-4">
                {[1, 2].map((col) => (
                  <div key={col} className="rounded-2xl bg-zinc-800/30 border border-white/[.04] p-5 space-y-2.5">
                    <Skeleton className={`h-3 w-20 rounded mb-3 udl-skeleton-d${col}`} />
                    <Skeleton className="h-2.5 w-full rounded" />
                    <Skeleton className="h-2.5 w-5/6 rounded" />
                    <Skeleton className="h-2.5 w-4/5 rounded" />
                    <Skeleton className="h-2.5 w-full rounded" />
                    <Skeleton className="h-2.5 w-3/4 rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column (sidebar) */}
          <div className="space-y-4">
            {/* Download / CTA card */}
            <div className="p-6 rounded-3xl border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md space-y-4">
              <Skeleton className="h-12 w-full rounded-full udl-skeleton-d1" />
              <Skeleton className="h-12 w-full rounded-full udl-skeleton-d2" />
              <Skeleton className="h-16 w-full rounded-2xl udl-skeleton-d3" />
            </div>

            {/* Stats chips */}
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-20 rounded-2xl udl-skeleton-d1" />
              <Skeleton className="h-20 rounded-2xl udl-skeleton-d2" />
              <Skeleton className="h-20 rounded-2xl udl-skeleton-d3" />
              <Skeleton className="h-20 rounded-2xl udl-skeleton-d4" />
            </div>

            {/* Details list */}
            <div className="p-6 rounded-3xl border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md space-y-4">
              <Skeleton className="h-5 w-20 rounded udl-skeleton-d1" />
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className={`h-4 w-16 rounded udl-skeleton-d${i}`} />
                    <Skeleton className={`h-4 w-24 rounded udl-skeleton-d${Math.min(i + 1, 5)}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
