import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { PendingGameCard } from '@/components/PendingGameCard'

interface PendingGame {
  appid: string
  name: string
  version?: string
  header_image?: string
  release_date?: string
  genres: string[]
  developers?: string
  mirror_status: string
  current_mirror_info: any
  store_link?: string
  online_fix?: boolean
}

interface ComingSoonSectionProps {
  games: PendingGame[]
}

export function ComingSoonSection({ games }: ComingSoonSectionProps) {
  if (games.length === 0) return null

  return (
    <section className="py-8 sm:py-10 overflow-visible">
      <div>
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="section-label mb-2">Processing</p>
            <h2 className="text-2xl font-light tracking-tight text-white">
              In Queue
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground/80">
              Requested games still being processed or mirrored before release.
            </p>
          </div>
          <div className="hidden md:block">
            <Link
              to="/settings?section=requests"
              className="text-muted-foreground hover:text-white hover:border-primary/40 text-sm font-medium transition-all flex items-center gap-2 px-4 py-2 rounded-full border border-border"
            >
              Browse All
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <Carousel opts={{ align: 'start', dragFree: true }} className="w-full">
          <CarouselContent className="-ml-4 pb-8">
            {games.map((game) => (
              <CarouselItem
                key={game.appid}
                className="pl-4 basis-[320px] sm:basis-[360px]"
              >
                <PendingGameCard game={game} />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-0 -translate-x-1/2 bg-secondary/80 hover:bg-primary hover:text-primary-foreground border-white/[.08] text-foreground/80 backdrop-blur-sm transition-all active:scale-95" />
          <CarouselNext className="right-0 translate-x-1/2 bg-secondary/80 hover:bg-primary hover:text-primary-foreground border-white/[.08] text-foreground/80 backdrop-blur-sm transition-all active:scale-95" />
        </Carousel>

        <div className="mt-4 md:hidden">
          <Link
            to="/settings?section=requests"
            className="text-muted-foreground hover:text-white text-sm font-medium transition-all flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-border"
          >
            Browse All
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}
