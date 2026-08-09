import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const actionUiLoads = vi.hoisted(() => vi.fn())
const actionUiModule = (name: string) => {
  actionUiLoads(name)
  return { [name]: () => null }
}

vi.mock("@/components/DownloadCheckModal", () => actionUiModule("DownloadCheckModal"))
vi.mock("@/components/ExePickerModal", () => actionUiModule("ExePickerModal"))
vi.mock("@/components/DesktopShortcutModal", () => actionUiModule("DesktopShortcutModal"))
vi.mock("@/components/ElevationPromptModal", () => actionUiModule("ElevationPromptModal"))
vi.mock("@/components/GameLaunchFailedModal", () => actionUiModule("GameLaunchFailedModal"))
vi.mock("@/components/GameLaunchPreflightModal", () => actionUiModule("GameLaunchPreflightModal"))
vi.mock("@/context/downloads-context", () => ({
  useDownloadsActions: () => ({ startGameDownload: vi.fn() }),
  useDownloadsSelector: <T,>(selector: (downloads: []) => T) => selector([]),
}))
vi.mock("@/context/toast-context", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/hooks/use-running-games", () => ({
  isRunningGameSync: () => false,
  setRunningOptimistic: vi.fn(),
}))

import { DownloadFlowProvider } from "@/context/download-flow-context"
import { GameLaunchProvider } from "@/context/game-launch-context"

describe("provider first paint", () => {
  it("renders children without evaluating action-only modal modules", () => {
    render(
      <DownloadFlowProvider>
        <GameLaunchProvider>
          <div>ready</div>
        </GameLaunchProvider>
      </DownloadFlowProvider>,
    )

    expect(screen.getByText("ready")).toBeTruthy()
    expect(actionUiLoads).not.toHaveBeenCalled()
  })
})
