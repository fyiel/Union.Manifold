import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { ElevationPromptModal } from "@/components/ElevationPromptModal"

it("shows the exact executable and requires an explicit administrator launch", () => {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  const { rerender } = render(
    <ElevationPromptModal
      open
      gameName="Portal"
      executablePath={"C:\\Games\\Portal\\portal.exe"}
      busy={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )

  expect(screen.getByText("C:\\Games\\Portal\\portal.exe")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Launch as administrator" }))
  expect(onConfirm).toHaveBeenCalledOnce()

  rerender(
    <ElevationPromptModal
      open
      gameName="Portal"
      executablePath={"C:\\Games\\Portal\\portal.exe"}
      busy={false}
      error="Administrator permission was declined."
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )
  expect(screen.getByRole("alert").textContent).toContain("permission was declined")
})
