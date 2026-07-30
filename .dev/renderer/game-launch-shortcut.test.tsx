import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ExePickerModal", () => ({ ExePickerModal: () => null }))
vi.mock("@/components/DesktopShortcutModal", () => ({
  DesktopShortcutModal: ({ open }: { open: boolean }) => open ? <div data-testid="shortcut-prompt" /> : null,
}))
vi.mock("@/components/ElevationPromptModal", () => ({
  ElevationPromptModal: ({ open, error, onConfirm }: { open: boolean; error?: string | null; onConfirm: () => void }) => open ? (
    <div>
      <button onClick={onConfirm}>Launch as administrator</button>
      {error ? <div role="alert">{error}</div> : null}
    </div>
  ) : null,
}))
vi.mock("@/components/GameLaunchFailedModal", () => ({ GameLaunchFailedModal: () => null }))
vi.mock("@/components/GameLaunchPreflightModal", () => ({ GameLaunchPreflightModal: () => null }))
vi.mock("@/lib/cloud-collections", () => ({ reportPlayEvent: vi.fn() }))
vi.mock("@/hooks/use-running-games", () => ({
  isRunningGameSync: () => false,
  setRunningOptimistic: vi.fn(),
}))

import { GameLaunchProvider, useGameLaunch } from "@/context/game-launch-context"

function LaunchButton() {
  const { requestLaunch } = useGameLaunch()
  return <button onClick={() => void requestLaunch({ appid: "game-1", name: "Portal" })}>Play</button>
}

function SteamLaunchButton() {
  const { requestLaunch } = useGameLaunch()
  return <button onClick={() => void requestLaunch({ appid: "steam-620", name: "Portal 2" })}>Play Steam import</button>
}

describe("desktop shortcut prompt setting", () => {
  const launchGameExecutable = vi.fn(async (..._args: [string, string, string?, boolean?, boolean?]) => ({ ok: true }))

  beforeEach(() => {
    vi.clearAllMocks()
    launchGameExecutable.mockReset()
    launchGameExecutable.mockResolvedValue({ ok: true })
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      value: {
        get: vi.fn(async (key: string) => key === "hideDesktopShortcutPrompt" || key === "rpcShowGameName"),
        set: vi.fn(async () => ({ ok: true })),
      },
    })
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      value: {
        listGameExecutables: vi.fn(async () => ({ ok: true, folder: "C:/Games/Portal", exes: [{ name: "Portal.exe", path: "C:/Games/Portal/Portal.exe" }] })),
        preflightGameLaunch: vi.fn(async () => ({ ok: true, canLaunch: true, checks: [] })),
        launchGameExecutable,
      },
    })
  })

  it("launches without showing the first-launch shortcut question", async () => {
    render(<GameLaunchProvider><LaunchButton /></GameLaunchProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Play" }))

    await waitFor(() => expect(launchGameExecutable).toHaveBeenCalledWith(
      "game-1",
      "C:/Games/Portal/Portal.exe",
      "Portal",
      true,
      undefined,
    ))
    expect(screen.queryByTestId("shortcut-prompt")).toBeNull()
  })

  it("asks before retrying an elevation-required executable as administrator", async () => {
    launchGameExecutable
      .mockResolvedValueOnce({ ok: false, requiresElevation: true, error: "This executable requests administrator access" })
      .mockResolvedValueOnce({ ok: false, elevationCancelled: true, error: "Administrator permission was declined" })
      .mockResolvedValueOnce({ ok: true, elevated: true })

    render(<GameLaunchProvider><LaunchButton /></GameLaunchProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Play" }))

    const elevate = await screen.findByRole("button", { name: "Launch as administrator" })
    fireEvent.click(elevate)
    expect((await screen.findByRole("alert")).textContent).toContain("Administrator permission was declined")

    fireEvent.click(elevate)
    await waitFor(() => expect(launchGameExecutable).toHaveBeenLastCalledWith(
      "game-1",
      "C:/Games/Portal/Portal.exe",
      "Portal",
      true,
      true,
    ))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Launch as administrator" })).toBeNull())
  })
})

describe("Steam import launch settings", () => {
  const launchGameExecutable = vi.fn(async (..._args: [string, string, string?, boolean?, boolean?]) => ({ ok: true }))
  const runSteamGame = vi.fn(async () => ({ ok: true }))
  let launchArgs: Record<string, string>

  beforeEach(() => {
    vi.clearAllMocks()
    launchArgs = {}
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      value: {
        get: vi.fn(async (key: string) => {
          if (key === "gameLaunchArgs") return launchArgs
          if (key === "gameLinux:steam-620") return {}
          if (key === "hideDesktopShortcutPrompt" || key === "rpcShowGameName") return true
          return null
        }),
        set: vi.fn(async () => ({ ok: true })),
      },
    })
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      value: {
        getInstalledGlobal: vi.fn(async () => ({ installType: "steam", steamAppId: 620 })),
        listGameExecutables: vi.fn(async () => ({ ok: true, folder: "/games/Portal 2", exes: [{ name: "portal2.exe", path: "/games/Portal 2/portal2.exe" }] })),
        preflightGameLaunch: vi.fn(async () => ({ ok: true, canLaunch: true, checks: [] })),
        launchGameExecutable,
      },
    })
    Object.defineProperty(window, "ucSystem", {
      configurable: true,
      value: { runSteamGame },
    })
  })

  it("uses Steam when no Manifold launch settings exist", async () => {
    render(<GameLaunchProvider><SteamLaunchButton /></GameLaunchProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Play Steam import" }))

    await waitFor(() => expect(runSteamGame).toHaveBeenCalledWith(620))
    expect(launchGameExecutable).not.toHaveBeenCalled()
  })

  it("uses the configured executable when launch options exist", async () => {
    launchArgs = { "steam-620": "-dx11" }
    render(<GameLaunchProvider><SteamLaunchButton /></GameLaunchProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Play Steam import" }))

    await waitFor(() => expect(launchGameExecutable).toHaveBeenCalledWith(
      "steam-620",
      "/games/Portal 2/portal2.exe",
      "Portal 2",
      true,
      undefined,
    ))
    expect(runSteamGame).not.toHaveBeenCalled()
  })
})
