import { Navigate } from "react-router-dom"

/**
 * The standalone Wishlist page was retired in favour of the unified library.
 * Wishlisted games are now the "Plan to Play" status, so this route redirects
 * into the library filtered to that status.
 */
export function WishlistPage() {
  return <Navigate to="/liked?status=plan" replace />
}
