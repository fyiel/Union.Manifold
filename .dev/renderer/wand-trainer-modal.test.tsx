import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { WandTrainerModal } from "@/components/WandTrainerModal"

it("starts a trainer and sends native control values", async () => {
  let onRuntime: ((event: { appid: string; status: string; name?: string; value?: number }) => void) | undefined
  const launch = vi.fn(async () => ({ ok: true }))
  const control = vi.fn(async () => ({ ok: true }))
  const onLaunch = vi.fn(async () => {})

  ;(window as any).ucWand = {
    trainer: vi.fn(async () => ({
      ok: true,
      supported: true,
      authenticated: true,
      game: { titleId: "1", gameId: "2", name: "Example Game", slug: "example", platformId: "steam" },
      controls: [{ uuid: "health", target: "health", name: "Unlimited Health", category: "Player", kind: "toggle" }],
    })),
    launch,
    control,
    stop: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => ({ ok: true })),
    onAuthChanged: vi.fn(() => () => {}),
    onRuntime: vi.fn((callback) => {
      onRuntime = callback
      return () => {}
    }),
  }

  render(
    <WandTrainerModal
      appid="example"
      title="Example Game"
      steamAppid={123}
      onClose={() => {}}
      onLaunch={onLaunch}
    />,
  )

  const toggle = await screen.findByRole("button", { name: "off" })
  expect((toggle as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "Start trainer" }))
  await waitFor(() => expect(launch).toHaveBeenCalledWith("example", "Example Game", 123))
  expect(onLaunch).toHaveBeenCalledOnce()

  act(() => onRuntime?.({ appid: "example", status: "active" }))
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(toggle)

  await waitFor(() => expect(control).toHaveBeenCalledWith("example", "health", 1))
  await waitFor(() => expect(screen.getByRole("button", { name: "on" })).toBe(toggle))
})
