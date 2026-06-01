import { useNavigate, useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"

export function BackButton() {
  const navigate = useNavigate()
  const location = useLocation()
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    // Check if we can go back (not on the initial page)
    setCanGoBack(window.history.length > 1)
    // Note: There's no reliable way to check forward navigation in react-router,
    // so the forward button stays enabled and is a no-op at the end of the stack.
  }, [location])

  const handleBack = () => {
    if (canGoBack) {
      navigate(-1)
    }
  }

  const handleForward = () => {
    navigate(1)
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleBack}
        disabled={!canGoBack}
        // Tagged so the controller's B button routes "back" here instead of
        // only emitting Escape (see use-controller-navigation.ts).
        data-uc-back
        className="h-8 w-8 rounded-md disabled:opacity-40"
        title="Go back"
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleForward}
        className="h-8 w-8 rounded-md disabled:opacity-40"
        title="Go forward"
        aria-label="Go forward"
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
