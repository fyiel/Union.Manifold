import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"

type PaginationBarProps = {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  maxVisiblePages?: number
  className?: string
  wrapperClassName?: string
  hideIfSingle?: boolean
}

const getVisiblePageNumber = (index: number, currentPage: number, totalPages: number, maxVisiblePages: number) => {
  if (totalPages <= maxVisiblePages) return index + 1
  if (currentPage <= Math.ceil(maxVisiblePages / 2)) return index + 1
  if (currentPage >= totalPages - Math.floor(maxVisiblePages / 2)) return totalPages - (maxVisiblePages - 1) + index
  return currentPage - Math.floor(maxVisiblePages / 2) + index
}

export function PaginationBar({
  currentPage,
  totalPages,
  onPageChange,
  maxVisiblePages = 5,
  className,
  wrapperClassName,
  hideIfSingle = true,
}: PaginationBarProps) {
  if (hideIfSingle && totalPages <= 1) return null

  const visibleCount = Math.min(maxVisiblePages, totalPages)
  const isFirst = currentPage <= 1
  const isLast = currentPage >= totalPages

  const handlePageChange = (e: React.MouseEvent<HTMLElement> | undefined, page: number) => {
    e?.preventDefault()
    if (page < 1 || page > totalPages || page === currentPage) return
    onPageChange(page)
  }

  return (
    <div className={cn("mt-10 flex justify-center", wrapperClassName)}>
      <Pagination
        className={cn(
          "bg-background/50 dark:bg-black/40 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-full px-4 py-2 shadow-lg inline-flex w-auto",
          className
        )}
      >
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={(e) => handlePageChange(e, currentPage - 1)}
              className={
                isFirst
                  ? "pointer-events-none opacity-50 font-bold text-muted-foreground"
                  : "cursor-pointer font-bold text-foreground/80 hover:text-foreground hover:bg-white/10 rounded-full"
              }
            />
          </PaginationItem>

          {Array.from({ length: visibleCount }, (_, index) => {
            const pageNumber = getVisiblePageNumber(index, currentPage, totalPages, maxVisiblePages)

            return (
              <PaginationItem key={pageNumber}>
                <PaginationLink
                  onClick={(e) => handlePageChange(e, pageNumber)}
                  isActive={currentPage === pageNumber}
                  className={cn(
                    "cursor-pointer font-bold rounded-full transition-all",
                    currentPage === pageNumber
                      ? "bg-primary text-white shadow-[0_0_15px_rgba(var(--primary),0.5)] border-primary"
                      : "text-foreground/80 hover:text-foreground hover:bg-white/10"
                  )}
                >
                  {pageNumber}
                </PaginationLink>
              </PaginationItem>
            )
          })}

          <PaginationItem>
            <PaginationNext
              onClick={(e) => handlePageChange(e, currentPage + 1)}
              className={
                isLast
                  ? "pointer-events-none opacity-50 font-bold text-muted-foreground"
                  : "cursor-pointer font-bold text-foreground/80 hover:text-foreground hover:bg-white/10 rounded-full"
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
