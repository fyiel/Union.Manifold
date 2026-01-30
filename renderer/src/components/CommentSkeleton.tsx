import { Skeleton } from "@/components/ui/skeleton"

export function CommentSkeleton() {
  return (
    <div className="space-y-4 py-4">
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0 bg-muted/40" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32 mb-2 bg-muted/40" />
          <Skeleton className="h-3 w-full mb-1 bg-muted/30" />
          <Skeleton className="h-3 w-3/4 bg-muted/30" />
        </div>
      </div>
    </div>
  )
}
