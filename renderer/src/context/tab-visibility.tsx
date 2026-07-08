import { createContext, useContext } from "react"

const TabVisibleContext = createContext(true)

export const TabVisibleProvider = TabVisibleContext.Provider

export function useTabVisible(): boolean {
  return useContext(TabVisibleContext)
}
