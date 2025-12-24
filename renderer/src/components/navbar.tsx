import { Hammer } from 'lucide-react'

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-2">
            <Hammer className="h-8 w-8 text-white" />
            <span className="font-black text-xl text-foreground">UnionCrax.Team</span>
          </div>
          <div className="text-sm text-muted-foreground">UC Mirror Uploader</div>
        </div>
      </div>
    </nav>
  )
}
