import { vi, afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `uc-local://${p}`,
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}))

afterEach(() => {
  cleanup()
})
