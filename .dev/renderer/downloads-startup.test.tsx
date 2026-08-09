import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DownloadsProvider,
  useDownloadsActions,
  useDownloadsSelector,
  type DownloadItem,
} from "@/context/downloads-context"

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const persistedDownload = (overrides: Partial<DownloadItem> = {}): DownloadItem => ({
  id: "persisted-download",
  appid: "persisted-app",
  gameName: "Persisted Game",
  host: "ucfiles",
  url: "https://files.test/game",
  filename: "game.zip",
  status: "paused",
  receivedBytes: 10,
  totalBytes: 100,
  speedBps: 0,
  etaSeconds: null,
  startedAt: 1,
  ...overrides,
})

function DownloadProbe() {
  const downloads = useDownloadsSelector((items) => items)
  const { cancelGroup } = useDownloadsActions()
  return (
    <div>
      <span data-testid="download-count">{downloads.length}</span>
      <span data-testid="download-status">{downloads[0]?.status || "none"}</span>
      <button type="button" onClick={() => void cancelGroup(downloads[0]?.appid || "")}>Cancel</button>
    </div>
  )
}

describe("downloads startup critical path", () => {
  let idleCallbacks: IdleRequestCallback[]
  let onUpdateCallback: ((update: Record<string, unknown>) => void) | null

  beforeEach(() => {
    idleCallbacks = []
    onUpdateCallback = null
    window.location.hash = "#/"
    window.localStorage.clear()
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    }))
    vi.stubGlobal("cancelIdleCallback", vi.fn())
  })

  afterEach(() => {
    Object.defineProperty(window, "ucDownloads", { configurable: true, writable: true, value: undefined })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("cold launch paints and subscribes to events while persisted state is still pending", () => {
    const state = deferred<{ ok: boolean; downloads: DownloadItem[] }>()
    const listInstalling = vi.fn(async () => [])
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: {
        loadPersistedState: vi.fn(() => state.promise),
        savePersistedState: vi.fn(async () => ({ ok: true })),
        listInstalling,
        onUpdate: vi.fn((callback) => {
          onUpdateCallback = callback
          return vi.fn()
        }),
      },
    })

    render(<DownloadsProvider><DownloadProbe /></DownloadsProvider>)

    expect(screen.getByTestId("download-count").textContent).toBe("0")
    expect(onUpdateCallback).toBeTypeOf("function")
    expect(listInstalling).not.toHaveBeenCalled()
    expect(requestIdleCallback).not.toHaveBeenCalled()
  })

  it("warm empty launch defers manifest parsing but retains recovery, events, badges, and cancellation", async () => {
    const listInstalling = vi.fn(async () => [{
      appid: "orphan-app",
      installStatus: "downloaded",
      metadata: { name: "Recovered Game" },
    }])
    const cancel = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: {
        loadPersistedState: vi.fn(async () => ({ ok: true, downloads: [] })),
        savePersistedState: vi.fn(async () => ({ ok: true })),
        listInstalling,
        getInstalled: vi.fn(async () => null),
        getActiveStatus: vi.fn(async () => ({ extracting: false, downloading: false })),
        cancel,
        deleteInstalling: vi.fn(async () => ({ ok: true })),
        onUpdate: vi.fn((callback) => {
          onUpdateCallback = callback
          return vi.fn()
        }),
      },
    })

    render(<DownloadsProvider><DownloadProbe /></DownloadsProvider>)

    await waitFor(() => expect(requestIdleCallback).toHaveBeenCalledTimes(1))
    expect(listInstalling).not.toHaveBeenCalled()

    act(() => {
      onUpdateCallback?.({
        downloadId: "event-download",
        appid: "event-app",
        gameName: "Event Game",
        status: "downloading",
        receivedBytes: 5,
        totalBytes: 10,
      })
    })
    expect(screen.getByTestId("download-count").textContent).toBe("1")
    expect(screen.getByTestId("download-status").textContent).toBe("downloading")

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("event-download"))
    await waitFor(() => expect(screen.getByTestId("download-count").textContent).toBe("0"))

    act(() => idleCallbacks[0]?.({ didTimeout: false, timeRemaining: () => 50 }))
    await waitFor(() => expect(listInstalling).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId("download-status").textContent).toBe("install_ready"))
  })

  it("warm persisted downloads run reconciliation immediately", async () => {
    const listInstalling = vi.fn(async () => [])
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: {
        loadPersistedState: vi.fn(async () => ({ ok: true, downloads: [persistedDownload()] })),
        savePersistedState: vi.fn(async () => ({ ok: true })),
        listInstalling,
        onUpdate: vi.fn(() => vi.fn()),
      },
    })

    render(<DownloadsProvider><DownloadProbe /></DownloadsProvider>)

    await waitFor(() => expect(screen.getByTestId("download-count").textContent).toBe("1"))
    await waitFor(() => expect(listInstalling).toHaveBeenCalledTimes(1))
    expect(requestIdleCallback).not.toHaveBeenCalled()
  })

  it("opens Downloads with immediate reconciliation even after an empty launch", async () => {
    const listInstalling = vi.fn(async () => [])
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: {
        loadPersistedState: vi.fn(async () => ({ ok: true, downloads: [] })),
        savePersistedState: vi.fn(async () => ({ ok: true })),
        listInstalling,
        onUpdate: vi.fn(() => vi.fn()),
      },
    })

    render(<DownloadsProvider><DownloadProbe /></DownloadsProvider>)
    await waitFor(() => expect(requestIdleCallback).toHaveBeenCalledTimes(1))
    expect(listInstalling).not.toHaveBeenCalled()

    act(() => { window.location.hash = "#/downloads" })

    await waitFor(() => expect(listInstalling).toHaveBeenCalledTimes(1))
  })
})
