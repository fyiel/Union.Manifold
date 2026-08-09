import { beforeEach, describe, expect, it } from "vitest"
import { applyCachedStartPageRoute, cacheStartPage, readCachedStartPage } from "@/app/route-loaders"

describe("cached startup route", () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, "", "#/")
  })

  it("selects a configured Library start before the router mounts", () => {
    cacheStartPage("library")

    expect(applyCachedStartPageRoute()).toBe(true)
    expect(window.location.hash).toBe("#/library")
    expect(readCachedStartPage()).toBe("library")
  })

  it("does not replace an explicit startup route", () => {
    cacheStartPage("library")
    window.history.replaceState(null, "", "#/downloads")

    expect(applyCachedStartPageRoute()).toBe(false)
    expect(window.location.hash).toBe("#/downloads")
  })
})
