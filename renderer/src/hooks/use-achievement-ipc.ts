/**
 * Steam Achievement IPC Listener
 *
 * Bridge between main process IPC and renderer events
 */

export function setupSteamAchievementIPC() {
  // Listen for main process IPC messages
  if (typeof window !== 'undefined' && window.ucAchievements) {
    // Already has types, use as-is
  }

  // Listen for IPC from main process
  const handler = (event: any, data: any) => {
    window.dispatchEvent(new CustomEvent('steam-achievement-unlock', { detail: data }))
  }

  // @ts-ignore - IPC listener
  window?.ipcRenderer?.on?.('uc:steam-achievement-unlock', handler)
  
  // Also listen for user achievement records
  const userHandler = (event: any, data: { appid: string; achievement: any }) => {
    import('@/lib/user-achievements').then(({ recordAchievementUnlock }) => {
      recordAchievementUnlock(data.achievement, data.appid)
    })
  }
  // @ts-ignore
  window?.ipcRenderer?.on?.('uc:user-achievement-unlock', userHandler)
}

// React hook for components
import { useEffect } from 'react'

export function useAchievementIPC() {
  useEffect(() => {
    setupSteamAchievementIPC()
  }, [])
}