import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Menu, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { addSearchToHistory } from "@/lib/user-history"

interface TopBarProps {
  onToggleSidebar: () => void
}

export function TopBar({ onToggleSidebar }: TopBarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const initialQuery = useMemo(() => searchParams.get("q") || "", [searchParams])
  const [searchInput, setSearchInput] = useState(initialQuery)

  useEffect(() => {
    if (location.pathname.startsWith("/search")) {
      setSearchInput(initialQuery)
    }
  }, [initialQuery, location.pathname])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = searchInput.trim()
    if (next) addSearchToHistory(next)
    navigate(next ? `/search?q=${encodeURIComponent(next)}` : "/search")
  }

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="flex h-16 items-center gap-4 px-4 md:px-6">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onToggleSidebar}>
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <form onSubmit={handleSubmit} className="max-w-2xl">
            <SearchSuggestions
              value={searchInput}
              onChange={setSearchInput}
              onSubmit={handleSubmit}
              placeholder="Search for a game or genre..."
              className="w-full h-10 rounded-xl"
            />
          </form>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col text-right">
            <span className="text-sm font-semibold text-foreground">UnionCrax User</span>
            <span className="text-xs text-muted-foreground">Direct Access</span>
          </div>
          <div className="h-10 w-10 rounded-full border border-border/60 flex items-center justify-center bg-card/70">
            <UserRound className="h-5 w-5" />
          </div>
        </div>
      </div>
    </div>
  )
}
