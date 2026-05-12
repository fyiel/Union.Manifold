import { useSyncExternalStore } from "react"
import { getApiConnectivitySnapshot, resetApiReachability, subscribeApiConnectivity } from "@/lib/api"

type ConnectivityStatus = ReturnType<typeof getApiConnectivitySnapshot>

function subscribe(callback: () => void) {
  const handleOnline = () => {
    resetApiReachability()
    callback()
  }
  const handleOffline = () => callback()

  window.addEventListener("online", handleOnline)
  window.addEventListener("offline", handleOffline)
  const unsubscribeConnectivity = subscribeApiConnectivity(callback)

  return () => {
    window.removeEventListener("online", handleOnline)
    window.removeEventListener("offline", handleOffline)
    unsubscribeConnectivity()
  }
}

function getSnapshot() {
  return getApiConnectivitySnapshot().isOnline
}

function getServerSnapshot() {
  return true
}

function getConnectivitySnapshot(): ConnectivityStatus {
  return getApiConnectivitySnapshot()
}

function getConnectivityServerSnapshot(): ConnectivityStatus {
  return {
    browserOnline: true,
    serviceReachable: true,
    isOnline: true,
  }
}

export function useConnectivityStatus(): ConnectivityStatus {
  return useSyncExternalStore(subscribe, getConnectivitySnapshot, getConnectivityServerSnapshot)
}

/**
 * Returns `true` when user is online, `false` when offline.
 * Re-renders automatically when connectivity changes.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
