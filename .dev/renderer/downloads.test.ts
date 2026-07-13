import { describe, expect, it } from "vitest"
import {
  extractUCFilesFileId,
  inferFilenameFromUrl,
  isUCFilesUrl,
  selectHost,
  type DownloadHosts,
} from "@/lib/downloads"

describe("inferFilenameFromUrl", () => {
  it("takes the decoded last path segment", () => {
    expect(inferFilenameFromUrl("https://h.example/files/Portal%202.rar", "fb")).toBe("Portal 2.rar")
  })

  it("falls back for empty paths and invalid urls", () => {
    expect(inferFilenameFromUrl("https://h.example/", "fallback.zip")).toBe("fallback.zip")
    expect(inferFilenameFromUrl("not a url", "fallback.zip")).toBe("fallback.zip")
  })
})

describe("ucfiles url handling", () => {
  it("recognizes ucfiles hosts including subdomains", () => {
    expect(isUCFilesUrl("https://files.union-crax.xyz/f/abc")).toBe(true)
    expect(isUCFilesUrl("https://files2.union-crax.xyz/f/abc")).toBe(true)
    expect(isUCFilesUrl("https://evil.example/f/abc")).toBe(false)
    expect(isUCFilesUrl("garbage")).toBe(false)
  })

  it("extracts file ids only from ucfiles file paths", () => {
    expect(extractUCFilesFileId("https://files.union-crax.xyz/f/Abc_123")).toBe("Abc_123")
    expect(extractUCFilesFileId("https://files.union-crax.xyz/file/Abc_123?x=1")).toBe("Abc_123")
    expect(extractUCFilesFileId("https://files.union-crax.xyz/dl/token123")).toBeNull()
    expect(extractUCFilesFileId("https://other.example/f/Abc_123")).toBeNull()
  })
})

describe("selectHost", () => {
  it("selects ucfiles when links exist and reports empty otherwise", () => {
    const available: DownloadHosts = {
      ucfiles: [{ url: "https://files.union-crax.xyz/f/a", part: 1 }],
    }
    expect(selectHost(available).host).toBe("ucfiles")
    expect(selectHost({}).host).toBe("")
    expect(selectHost({}).links).toEqual([])
  })
})
