import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

function subscribe(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

function getSnapshot() {
  return typeof navigator !== "undefined" ? navigator.onLine : true
}

function getServerSnapshot() {
  return true
}

/**
 * Returns `true` when user is online, `false` when offline.
 * Re-renders automatically when connectivity changes.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
