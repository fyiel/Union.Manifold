import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SOURCE_ABBR, SOURCE_DIRECT, SOURCE_NAMES, SOURCE_PRIORITY } from "@/lib/sources"

function backendSources(): Array<{ id: string; name: string }> {
  const rust = readFileSync(
    resolve(__dirname, "../../src-tauri/src/sources/mod.rs"),
    "utf8"
  )
  const out: Array<{ id: string; name: string }> = []
  const re = /SourceMeta\s*\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rust))) out.push({ id: m[1], name: m[2] })
  return out
}

describe("frontend source maps stay in sync with backend SOURCES", () => {
  const backend = backendSources()

  it("finds the backend SOURCES table", () => {
    expect(backend.length).toBeGreaterThanOrEqual(8)
  })

  it("SOURCE_PRIORITY covers exactly the backend source ids", () => {
    const backendIds = backend.map((s) => s.id).sort()
    expect([...SOURCE_PRIORITY].sort()).toEqual(backendIds)
  })

  it("SOURCE_NAMES has an entry per backend source matching the backend name", () => {
    for (const { id, name } of backend) {
      expect(SOURCE_NAMES[id], `SOURCE_NAMES missing ${id}`).toBe(name)
    }
    for (const id of Object.keys(SOURCE_NAMES)) {
      expect(backend.some((s) => s.id === id), `stale SOURCE_NAMES entry ${id}`).toBe(true)
    }
  })

  it("SOURCE_ABBR has an entry per backend source", () => {
    for (const { id } of backend) {
      expect(SOURCE_ABBR[id], `SOURCE_ABBR missing ${id}`).toBeTruthy()
    }
    for (const id of Object.keys(SOURCE_ABBR)) {
      expect(backend.some((s) => s.id === id), `stale SOURCE_ABBR entry ${id}`).toBe(true)
    }
  })

  it("SOURCE_DIRECT only references known backend sources", () => {
    for (const id of Object.keys(SOURCE_DIRECT)) {
      expect(backend.some((s) => s.id === id), `stale SOURCE_DIRECT entry ${id}`).toBe(true)
    }
  })
})
