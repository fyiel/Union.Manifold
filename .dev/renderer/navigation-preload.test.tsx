import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { Sidebar } from "@/app/manifold/Sidebar"

const preloadPrimaryPage = vi.hoisted(() => vi.fn())

vi.mock("@/app/route-loaders", () => ({ preloadPrimaryPage }))
vi.mock("@/lib/sources", () => ({
  listSources: vi.fn(async () => []),
  loadDisabledSources: vi.fn(async () => []),
  saveDisabledSources: vi.fn(async () => undefined),
  setSourceEnabled: vi.fn(async () => true),
  onSourcesChanged: vi.fn(() => () => {}),
}))

describe("primary navigation preloading", () => {
  it("starts loading a page when the user shows intent", () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>)

    fireEvent.pointerEnter(screen.getByRole("link", { name: "Library" }))
    fireEvent.focus(screen.getByRole("link", { name: "Settings" }))

    expect(preloadPrimaryPage).toHaveBeenCalledWith("/library")
    expect(preloadPrimaryPage).toHaveBeenCalledWith("/settings")
  })
})
