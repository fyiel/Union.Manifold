import { Card, CardContent } from "@/components/ui/card"

export function GameCardSkeleton() {
  return (
    <Card className="group relative h-full overflow-hidden border border-white/[.07] bg-zinc-900/60 backdrop-blur-md rounded-2xl flex flex-col">
      <div className="relative w-full overflow-hidden aspect-[3/4]">
        <div className="udl-skeleton w-full h-full" />
        {/* Top-left badges */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
          <div className="h-5 w-14 bg-zinc-700/40 rounded-full" />
          <div className="h-5 w-10 bg-zinc-700/30 rounded-full" />
        </div>
      </div>

      <CardContent className="p-4 space-y-2.5 flex-1">
        <div className="udl-skeleton h-4 w-3/4 rounded" />
        <div className="flex gap-2">
          <div className="udl-skeleton h-3.5 w-12 rounded" />
          <div className="udl-skeleton h-3.5 w-10 rounded" />
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="udl-skeleton h-3.5 w-16 rounded" />
          <div className="udl-skeleton h-3.5 w-12 rounded" />
        </div>
      </CardContent>
    </Card>
  )
}
