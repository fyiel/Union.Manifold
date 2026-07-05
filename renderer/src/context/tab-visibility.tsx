import { createContext, useContext } from "react"

// TabHost (ForkLayout) keeps every visited tab mounted under display:none for
// instant switching. display:none stops paint but NOT React reconciliation, so
// pages subscribed to fast-ticking stores (download progress flushes ~5/s)
// would keep re-rendering while hidden. This context tells a page whether its
// tab is the active one so hot subscriptions can freeze while hidden — the
// store snapshot is re-read on the re-render that follows the flip back to
// visible, so catch-up is free and nothing is missed.
//
// Defaults to true: routes rendered outside TabHost (e.g. /g/:key detail) are
// always "visible".
const TabVisibleContext = createContext(true)

export const TabVisibleProvider = TabVisibleContext.Provider

export function useTabVisible(): boolean {
  return useContext(TabVisibleContext)
}
