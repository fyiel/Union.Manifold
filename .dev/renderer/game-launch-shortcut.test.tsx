import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ExePickerModal", () => ({ ExePickerModal: () => null }))
vi.mock("@/components/DesktopShortcutModal", () => ({
  DesktopShortcutModal: ({ open }: { open: boolean }) => open ? <div data-testid="shortcut-prompt" /> : null,
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

describe("desktop shortcut prompt setting", () => {
  const launchGameExecutable = vi.fn(async () => ({ ok: true }))

  beforeEach(() => {
    vi.clearAllMocks()
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
    ))
    expect(screen.queryByTestId("shortcut-prompt")).toBeNull()
  })
})
