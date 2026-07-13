import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { GameModsPage } from "@/app/pages/GameModsPage"
import { ToastProvider } from "@/context/toast-context"

const nexusSearch = vi.fn(async () => ({ ok: true, mods: [], hasMore: false }))
const nexusBrowse = vi.fn(async () => ({ ok: true, mods: [], hasMore: false }))

function mountModsPage() {
  ;(window as any).ucMods = {
    gameGet: vi.fn(async () => ({
      ok: true,
      nexusDomain: "thefarmerwasreplaced",
      nexusDomainAuto: true,
      steamAppid: 2060160,
      workshopSupported: false,
      thunderstoreCommunity: null,
      thunderstoreSupported: false,
      deployTarget: "",
      deployed: false,
      mods: [],
    })),
    onChanged: vi.fn(() => () => {}),
    onInstallProgress: vi.fn(() => () => {}),
    onNxmUnmatched: vi.fn(() => () => {}),
    nexusValidate: vi.fn(async () => ({ ok: true, valid: true })),
    nexusSearch,
    nexusBrowse,
  }
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/g/steam-2060160/mods"]}>
        <Routes>
          <Route path="/g/:key/mods" element={<GameModsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

describe("Nexus tab search input", () => {
  beforeEach(() => {
    nexusSearch.mockClear()
    nexusBrowse.mockClear()
  })

  it("submits the trimmed query on Enter even with surrounding whitespace", async () => {
    mountModsPage()
    const nexusTab = await screen.findByRole("button", { name: "Nexus" })
    fireEvent.click(nexusTab)
    const input = await screen.findByPlaceholderText(/search thefarmerwasreplaced mods/)
    fireEvent.change(input, { target: { value: "   auto farm   " } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(nexusSearch).toHaveBeenCalled())
    expect(nexusSearch).toHaveBeenCalledWith("thefarmerwasreplaced", "auto farm", 1)
  })

  it("submits the trimmed query with windows style crlf paste artifacts", async () => {
    mountModsPage()
    const nexusTab = await screen.findByRole("button", { name: "Nexus" })
    fireEvent.click(nexusTab)
    const input = await screen.findByPlaceholderText(/search thefarmerwasreplaced mods/)
    fireEvent.change(input, { target: { value: "auto farm\r\n" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(nexusSearch).toHaveBeenCalled())
    expect(nexusSearch).toHaveBeenCalledWith("thefarmerwasreplaced", "auto farm", 1)
  })

  it("escape clears the search back to browse mode", async () => {
    mountModsPage()
    const nexusTab = await screen.findByRole("button", { name: "Nexus" })
    fireEvent.click(nexusTab)
    const input = await screen.findByPlaceholderText(/search thefarmerwasreplaced mods/)
    await waitFor(() => expect(nexusBrowse).toHaveBeenCalled())
    fireEvent.change(input, { target: { value: "q" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(nexusSearch).toHaveBeenCalled())
    fireEvent.keyDown(input, { key: "Escape" })
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""))
  })
})
