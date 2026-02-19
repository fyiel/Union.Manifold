import { Skeleton } from "@/components/ui/skeleton"

export function GamePageSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-500">
      {/* Hero Skeleton */}
      <section className="relative">
        <div className="max-w-6xl mx-auto">
          <div className="relative rounded-3xl overflow-hidden border border-white/10 bg-black/40 backdrop-blur-md">
            <Skeleton className="aspect-video w-full rounded-none bg-white/5" />
            <div className="absolute bottom-0 left-0 right-0 p-8 space-y-4">
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full bg-white/10" />
                <Skeleton className="h-6 w-20 rounded-full bg-white/10" />
              </div>
              <Skeleton className="h-12 w-3/4 rounded-lg bg-white/10" />
              <Skeleton className="h-6 w-1/3 rounded-lg bg-white/10" />
            </div>
          </div>
        </div>
      </section>

      {/* Version Selector Skeleton - Explicitly requested */}
      <section className="max-w-6xl mx-auto -mt-6 px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <Skeleton className="h-4 w-20 shrink-0 bg-white/10" />
          <div className="flex gap-2">
             <Skeleton className="h-9 w-32 rounded-full bg-white/10" />
             <Skeleton className="h-9 w-32 rounded-full bg-white/10" />
             <Skeleton className="h-9 w-32 rounded-full bg-white/10" />
          </div>
        </div>
      </section>

      {/* Main Content Grid Skeleton */}
      <section className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-8">
            <div className="p-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md space-y-4">
              <Skeleton className="h-8 w-48 bg-white/10" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full bg-white/5" />
                <Skeleton className="h-4 w-full bg-white/5" />
                <Skeleton className="h-4 w-3/4 bg-white/5" />
              </div>
            </div>

            <div className="p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md space-y-4">
              <div className="flex justify-between">
                 <Skeleton className="h-8 w-32 bg-white/10" />
                 <Skeleton className="h-8 w-24 bg-white/10" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="aspect-video rounded-lg bg-white/5" />
                <Skeleton className="aspect-video rounded-lg bg-white/5" />
                <Skeleton className="aspect-video rounded-lg bg-white/5" />
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            <div className="p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md space-y-4">
              <Skeleton className="h-14 w-full rounded-xl bg-white/10" />
              <Skeleton className="h-20 w-full rounded-xl bg-white/5" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-24 rounded-xl bg-white/5" />
              <Skeleton className="h-24 rounded-xl bg-white/5" />
            </div>

            <div className="p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md space-y-4">
               <Skeleton className="h-6 w-24 bg-white/10" />
               <div className="space-y-3">
                 <div className="flex justify-between">
                   <Skeleton className="h-4 w-16 bg-white/5" />
                   <Skeleton className="h-4 w-24 bg-white/5" />
                 </div>
                 <div className="flex justify-between">
                   <Skeleton className="h-4 w-16 bg-white/5" />
                   <Skeleton className="h-4 w-24 bg-white/5" />
                 </div>
                 <div className="flex justify-between">
                   <Skeleton className="h-4 w-16 bg-white/5" />
                   <Skeleton className="h-4 w-24 bg-white/5" />
                 </div>
               </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
