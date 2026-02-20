import { Card, CardContent } from "@/components/ui/card"

export function GameCardSkeleton() {
  return (
    <Card className="group relative h-full overflow-hidden border border-white/10 bg-black/40 backdrop-blur-md rounded-2xl animate-pulse flex flex-col">
      <div className="relative w-full overflow-hidden aspect-[3/4] bg-muted/30">
        {/* Top-left badges */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
          <div className="h-5 w-14 bg-muted/40 rounded-full" />
          <div className="h-5 w-10 bg-muted/35 rounded-full" />
        </div>

        {/* Top-right action buttons */}
        <div className="absolute top-3 right-3 z-30 flex flex-col gap-2">
          <div className="h-8 w-8 bg-muted/35 rounded-full" />
          <div className="h-8 w-8 bg-muted/35 rounded-full" />
          <div className="h-8 w-8 bg-muted/35 rounded-full" />
        </div>

        {/* Hover stats placeholder at bottom */}
        <div className="absolute bottom-0 left-0 right-0 z-20 p-4 translate-y-full bg-gradient-to-t from-black/80 via-black/60 to-transparent pt-10">
          <div className="flex items-center justify-between">
            <div className="h-7 w-20 bg-muted/35 rounded-full" />
            <div className="h-7 w-16 bg-muted/35 rounded-full" />
          </div>
        </div>
      </div>

      <CardContent className="p-6 space-y-3 flex-1">
        <div className="h-6 w-3/4 bg-muted/40 rounded" />
        <div className="flex gap-2">
          <div className="h-4 w-12 bg-muted/30 rounded-sm" />
          <div className="h-4 w-10 bg-muted/30 rounded-sm" />
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="h-4 w-16 bg-muted/30 rounded" />
          <div className="h-4 w-12 bg-muted/30 rounded" />
        </div>
      </CardContent>
    </Card>
  )
}
