import { Card, CardContent } from "@/components/ui/card"

export function GameCardSkeleton() {
  return (
    <Card className="overflow-hidden bg-card/50 border-2 border-border/40 rounded-3xl animate-pulse">
      <div className="aspect-[3/4] h-64 bg-muted/30" />
      <CardContent className="p-6 space-y-3">
        <div className="h-6 w-3/4 bg-muted/40 rounded" />
        <div className="h-4 w-full bg-muted/30 rounded" />
        <div className="h-4 w-2/3 bg-muted/30 rounded" />
        <div className="flex gap-2">
          <div className="h-5 w-16 bg-muted/30 rounded-full" />
          <div className="h-5 w-12 bg-muted/30 rounded-full" />
        </div>
        <div className="h-4 w-full bg-muted/20 rounded" />
      </CardContent>
    </Card>
  )
}
