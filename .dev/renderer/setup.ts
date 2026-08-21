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

// Node >=22 ships an experimental `localStorage` global that is inert unless
// --localstorage-file is passed, and because the key already exists on
// globalThis vitest skips installing jsdom's working implementation. Detect
// that broken state and back the global with an in-memory Storage so
// storage-backed code paths behave like they do in the app.
if (typeof localStorage === "undefined") {
  class MemoryStorage implements Storage {
    private map = new Map<string, string>()
    get length(): number {
      return this.map.size
    }
    key(index: number): string | null {
      return [...this.map.keys()][index] ?? null
    }
    getItem(key: string): string | null {
      return this.map.has(key) ? (this.map.get(key) as string) : null
    }
    setItem(key: string, value: string): void {
      this.map.set(String(key), String(value))
    }
    removeItem(key: string): void {
      this.map.delete(key)
    }
    clear(): void {
      this.map.clear()
    }
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  })
}
