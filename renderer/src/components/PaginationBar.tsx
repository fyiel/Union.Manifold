import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import { ChevronsLeft, ChevronsRight } from "@/components/icons"

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
  maxVisiblePages = 7,
  className,
  wrapperClassName,
  hideIfSingle = true,
}: PaginationBarProps) {
  if (hideIfSingle && totalPages <= 1) return null

  const visibleCount = Math.min(maxVisiblePages, totalPages)
  const isFirst = currentPage <= 1
  const isLast = currentPage >= totalPages

  const handlePageChange = (e: React.MouseEvent | React.TouchEvent, page: number) => {
    e?.preventDefault()
    if (page < 1 || page > totalPages || page === currentPage) return
    onPageChange(page)
  }

  return (
    <div className={cn("mt-8 flex flex-col items-center gap-2", wrapperClassName)}>
      <Pagination
        className={cn(
          "bg-card/80 backdrop-blur-md border border-border/50 rounded-full px-3 py-2 shadow-lg inline-flex w-auto",
          className
        )}
      >
        <PaginationContent>
          <PaginationItem>
            <button
              type="button"
              onClick={(e) => handlePageChange(e, 1)}
              disabled={isFirst}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full font-bold transition-all",
                isFirst
                  ? "pointer-events-none opacity-30 text-muted-foreground/60"
                  : "cursor-pointer text-foreground/80 hover:bg-secondary hover:text-white"
              )}
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          </PaginationItem>

          <PaginationItem>
            <PaginationPrevious
              onClick={(e) => handlePageChange(e, currentPage - 1)}
              className={
                isFirst
                  ? "pointer-events-none opacity-30 font-bold text-muted-foreground/60"
                  : "cursor-pointer rounded-full font-bold text-foreground/80 hover:bg-secondary hover:text-white"
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
                      ? "border-white bg-primary text-primary-foreground shadow-[0_0_18px_rgba(255,255,255,0.16)]"
                      : "text-foreground/80 hover:bg-secondary hover:text-white"
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
                  ? "pointer-events-none opacity-30 font-bold text-muted-foreground/60"
                  : "cursor-pointer rounded-full font-bold text-foreground/80 hover:bg-secondary hover:text-white"
              }
            />
          </PaginationItem>

          <PaginationItem>
            <button
              type="button"
              onClick={(e) => handlePageChange(e, totalPages)}
              disabled={isLast}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full font-bold transition-all",
                isLast
                  ? "pointer-events-none opacity-30 text-muted-foreground/60"
                  : "cursor-pointer text-foreground/80 hover:bg-secondary hover:text-white"
              )}
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      <p className="text-xs font-medium text-muted-foreground/80">
        Page {currentPage} of {totalPages}
      </p>
    </div>
  )
}

