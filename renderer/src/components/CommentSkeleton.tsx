import { Skeleton } from "@/components/ui/skeleton"

export function CommentSkeleton() {
  return (
    <div className="space-y-4 py-4">
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0 bg-zinc-800/50" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32 mb-2 bg-zinc-800/50" />
          <Skeleton className="h-3 w-full mb-1 bg-zinc-800/50" />
          <Skeleton className="h-3 w-3/4 bg-zinc-800/50" />
        </div>
      </div>
    </div>
  )
}
