import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AddGamesDialog } from "@/app/manifold/library-overlays"

describe("manual archive import", () => {
  afterEach(() => vi.restoreAllMocks())

  it("installs a selected archive into the library", async () => {
    const installFromArchive = vi.fn(async () => ({ ok: true, extracted: 1 }))
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      value: {
        steamLibraryScan: vi.fn(async () => ({ ok: true, steamFound: false, found: false, apps: [] })),
        pickArchiveFiles: vi.fn(async () => ({
          ok: true,
          files: [{ path: "/downloads/Portal 2.zip", name: "Portal 2.zip", size: 42 }],
        })),
        installFromArchive,
      },
    })
    vi.spyOn(Date, "now").mockReturnValue(1_234)

    render(<AddGamesDialog onClose={() => undefined} />)
    fireEvent.click(screen.getByRole("button", { name: "Install from archive…" }))

    await waitFor(() => expect(installFromArchive).toHaveBeenCalledWith({
      appid: "local-archive-ya",
      gameName: "Portal 2",
      archivePaths: ["/downloads/Portal 2.zip"],
    }))
    expect(await screen.findByText("Portal 2 added")).toBeTruthy()
  })
})
