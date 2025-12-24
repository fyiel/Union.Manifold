import { useMemo, useState } from "react"
import { GameCard } from "@/components/GameCard"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { Badge } from "@/components/ui/badge"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { useGamesData } from "@/hooks/use-games"
import { getRecentlyDownloadedGames, getRecentlyViewedGames } from "@/lib/user-history"

export function LibraryPage() {
  const { games, stats, loading } = useGamesData()
  const downloadedIds = getRecentlyDownloadedGames(20)
  const viewedIds = getRecentlyViewedGames(12)
  const itemsPerPage = 8
  const [downloadedPage, setDownloadedPage] = useState(1)
  const [viewedPage, setViewedPage] = useState(1)

  const downloadedGames = useMemo(
    () => games.filter((game) => downloadedIds.includes(game.appid)),
    [games, downloadedIds]
  )

  const viewedGames = useMemo(
    () => games.filter((game) => viewedIds.includes(game.appid)),
    [games, viewedIds]
  )

  const downloadedTotalPages = Math.max(1, Math.ceil(downloadedGames.length / itemsPerPage))
  const viewedTotalPages = Math.max(1, Math.ceil(viewedGames.length / itemsPerPage))

  const pagedDownloaded = useMemo(() => {
    const start = (downloadedPage - 1) * itemsPerPage
    return downloadedGames.slice(start, start + itemsPerPage)
  }, [downloadedGames, downloadedPage, itemsPerPage])

  const pagedViewed = useMemo(() => {
    const start = (viewedPage - 1) * itemsPerPage
    return viewedGames.slice(start, start + itemsPerPage)
  }, [viewedGames, viewedPage, itemsPerPage])

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-black font-montserrat">Your Library</h1>
          <Badge className="rounded-full bg-primary/15 text-primary border-primary/20">Direct downloads</Badge>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          All downloads initiated inside UnionCrax.Direct will appear here, together with your recently viewed titles.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-black font-montserrat">Recently Downloaded</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 8 }).map((_, idx) => (
              <GameCardSkeleton key={idx} />
            ))}
          </div>
        ) : downloadedGames.length ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {pagedDownloaded.map((game) => (
                <GameCard key={game.appid} game={game} stats={stats[game.appid]} size="compact" />
              ))}
            </div>
            {downloadedTotalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setDownloadedPage(Math.max(1, downloadedPage - 1))}
                      className={downloadedPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: downloadedTotalPages }, (_, index) => index + 1).map((page) => (
                    <PaginationItem key={`downloaded-${page}`}>
                      <PaginationLink
                        onClick={() => setDownloadedPage(page)}
                        isActive={downloadedPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setDownloadedPage(Math.min(downloadedTotalPages, downloadedPage + 1))}
                      className={
                        downloadedPage === downloadedTotalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No downloads yet. Start a download from the launcher to populate your library.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-black font-montserrat">Recently Viewed</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 8 }).map((_, idx) => (
              <GameCardSkeleton key={idx} />
            ))}
          </div>
        ) : viewedGames.length ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {pagedViewed.map((game) => (
                <GameCard key={game.appid} game={game} stats={stats[game.appid]} size="compact" />
              ))}
            </div>
            {viewedTotalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setViewedPage(Math.max(1, viewedPage - 1))}
                      className={viewedPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: viewedTotalPages }, (_, index) => index + 1).map((page) => (
                    <PaginationItem key={`viewed-${page}`}>
                      <PaginationLink
                        onClick={() => setViewedPage(page)}
                        isActive={viewedPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setViewedPage(Math.min(viewedTotalPages, viewedPage + 1))}
                      className={viewedPage === viewedTotalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            Browse the launcher to build your viewing history.
          </div>
        )}
      </section>
    </div>
  )
}
