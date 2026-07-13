import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LinuxConfigDialog } from "@/app/manifold/library-overlays"
import type { LinuxDetectionOption, LinuxGameConfig } from "@/lib/linux-presets"

const versions: LinuxDetectionOption[] = [
  { label: "Proton 9.0", path: "/steam/Proton 9.0/proton", source: "steam" },
  { label: "Proton Experimental", path: "/steam/Proton Experimental/proton", source: "steam" },
  { label: "GE-Proton10-12", path: "/protonplus/GE-Proton10-12/proton", source: "protonplus", newest: true },
  { label: "GE-Proton10-2", path: "/protonplus/GE-Proton10-2/proton", source: "protonplus", newest: false },
]

const setGameConfig = vi.fn(async (_appid: string, _config: LinuxGameConfig | null) => ({ ok: true }))

function mountDialog() {
  return render(<LinuxConfigDialog appid="steam-2685120" gameName="Mewgenics" onClose={() => undefined} />)
}

describe("Linux runner picker", () => {
  beforeEach(() => {
    setGameConfig.mockClear()
    window.ucLinux = {
      detectProton: async () => ({ ok: true, versions }),
      pickPrefixDir: async () => ({ ok: false, cancelled: true }),
      pickBinary: async () => ({ ok: false, cancelled: true }),
      getGameConfig: async () => ({ ok: true, config: {} }),
      setGameConfig,
    }
  })

  it("keeps Steam runners in one dropdown and tags only the newest ProtonPlus runner", async () => {
    mountDialog()

    const steamSelect = await screen.findByRole("combobox", { name: "Steam Proton version" })
    const options = within(steamSelect).getAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual([
      "Choose from 2 Steam versions",
      "Proton 9.0",
      "Proton Experimental",
    ])
    expect(screen.queryByRole("button", { name: /Proton 9\.0/ })).toBeNull()

    const newestTags = screen.getAllByText("Newest")
    expect(newestTags).toHaveLength(1)
    expect(newestTags[0].closest("button")?.textContent).toContain("GE-Proton10-12")
    expect(screen.getByRole("button", { name: /GE-Proton10-2/ }).textContent).not.toContain("Newest")

    fireEvent.change(steamSelect, { target: { value: "/steam/Proton 9.0/proton" } })
    await waitFor(() => {
      expect(setGameConfig).toHaveBeenCalledWith("steam-2685120", {
        launchMode: "proton",
        protonPath: "/steam/Proton 9.0/proton",
      })
    })
  })
})
