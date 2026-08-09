import { describe, expect, it } from "vitest"
import { advancedBackendSort, advancedQuerySignature } from "@/app/pages/AdvancedSearchPage"

const signature = (sort: "relevance" | "a-z" | "size" | "sources", query = "portal") =>
  advancedQuerySignature({
    query,
    enabledIds: ["steamrip", "unioncrax"],
    cats: ["Puzzle"],
    sLo: 0,
    sHi: 130,
    yLo: 2010,
    yHi: 2026,
    sort,
  })

describe("Advanced Search query identity", () => {
  it("keeps client-only sort changes on the current result set", () => {
    expect(signature("size")).toBe(signature("relevance"))
    expect(signature("sources")).toBe(signature("relevance"))
  })

  it("queries again for A-Z because pagination needs backend title order", () => {
    expect(signature("a-z")).not.toBe(signature("relevance"))
    expect(advancedBackendSort("a-z", true)).toBe("title")
  })

  it("uses latest without text and relevance with text", () => {
    expect(advancedBackendSort("relevance", false)).toBe("latest")
    expect(advancedBackendSort("relevance", true)).toBe("relevance")
  })
})
