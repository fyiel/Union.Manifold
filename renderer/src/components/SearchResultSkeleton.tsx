import { Skeleton } from "@/components/ui/skeleton"

export function SearchResultSkeleton() {
  return (
    <div className="flex items-center gap-3 px-2 py-2">
      <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0 bg-muted/40" />
      <div className="flex-1 min-w-0">
        <Skeleton className="h-4 w-32 mb-1 bg-muted/40" />
        <Skeleton className="h-3 w-20 bg-muted/40" />
      </div>
    </div>
  )
}
