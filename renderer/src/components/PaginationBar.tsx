import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import { ChevronsLeft, ChevronsRight } from "lucide-react"

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
          "bg-zinc-900/80 backdrop-blur-md border border-zinc-800/50 rounded-full px-3 py-2 shadow-lg inline-flex w-auto",
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
                  ? "pointer-events-none opacity-30 text-zinc-600"
                  : "cursor-pointer text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
                  ? "pointer-events-none opacity-30 font-bold text-zinc-600"
                  : "cursor-pointer rounded-full font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
                      ? "border-white bg-white text-black shadow-[0_0_18px_rgba(255,255,255,0.16)]"
                      : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
                  ? "pointer-events-none opacity-30 font-bold text-zinc-600"
                  : "cursor-pointer rounded-full font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
                  ? "pointer-events-none opacity-30 text-zinc-600"
                  : "cursor-pointer text-zinc-300 hover:bg-zinc-800 hover:text-white"
              )}
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      <p className="text-xs font-medium text-zinc-500">
        Page {currentPage} of {totalPages}
      </p>
    </div>
  )
}

