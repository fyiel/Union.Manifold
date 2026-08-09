import { describe, expect, it } from "vitest"
import {
  filterGameExecutables,
  formatNumber,
  getUnambiguousExecutable,
  getExecutableRelativePath,
  isHelperExecutableName,
  matchAdminExecutable,
  proxyImageUrl,
  proxyMediaUrl,
  type GameExecutable,
} from "@/lib/utils"

describe("formatNumber", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatNumber(999)).toBe("999")
    expect(formatNumber(1500)).toBe("1.5K")
    expect(formatNumber(2_300_000)).toBe("2.3M")
    expect(formatNumber(0)).toBe("0")
  })
})

describe("media url proxying", () => {
  it("leaves data and blob urls untouched", () => {
    expect(proxyMediaUrl("data:image/png;base64,AA")).toBe("data:image/png;base64,AA")
    expect(proxyMediaUrl("blob:abc")).toBe("blob:abc")
    expect(proxyMediaUrl("")).toBe("")
  })

  it("routes uc-custom urls through the asset protocol", () => {
    const out = proxyMediaUrl("uc-custom://abcd")
    expect(out).toBe("uc-asset://localhost/img?c=abcd")
  })

  it("proxies public image hosts through the api image proxy", () => {
    const url = "https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg"
    const out = proxyMediaUrl(url)
    expect(out).toContain("/api/image-proxy?url=")
    expect(out).toContain(encodeURIComponent(url))
  })

  it("leaves unknown remote hosts direct", () => {
    expect(proxyMediaUrl("https://random.example/pic.png")).toBe("https://random.example/pic.png")
  })

  it("proxyImageUrl wraps remote urls in the asset img endpoint", () => {
    const out = proxyImageUrl("https://random.example/pic.png")
    expect(out.startsWith("uc-asset://localhost/img?u=")).toBe(true)
  })
})

describe("executable filtering for launch", () => {
  const exe = (name: string, path?: string): GameExecutable => ({ name, path: path || `C:/Game/${name}` })

  it("flags helper executables by token", () => {
    expect(isHelperExecutableName("UnityCrashHandler64.exe")).toBe(true)
    expect(isHelperExecutableName("Setup.exe")).toBe(true)
    expect(isHelperExecutableName("Portal2.exe")).toBe(false)
  })

  it("filters out redists uninstallers and crash handlers", () => {
    const out = filterGameExecutables([
      exe("Game.exe"),
      exe("vc_redist.x64.exe"),
      exe("unins000.exe"),
      exe("UnityCrashHandler64.exe"),
      exe("dxsetup.exe"),
      exe("Launcher.exe", "C:/Game/_CommonRedist/Launcher.exe"),
    ])
    expect(out.map((e) => e.name)).toEqual(["Game.exe"])
  })

  it("returns the single unambiguous candidate or null", () => {
    expect(getUnambiguousExecutable([exe("Game.exe"), exe("unins000.exe")])?.name).toBe("Game.exe")
    expect(getUnambiguousExecutable([exe("A.exe"), exe("B.exe")])).toBeNull()
    expect(
      getUnambiguousExecutable([
        { name: "Game.exe", path: "C:/Game/Game.exe" },
        { name: "Game.exe", path: "c:\\Game\\Game.exe" },
      ])?.name
    ).toBe("Game.exe")
  })

  it("resolves relative paths against the install folder case-insensitively", () => {
    expect(getExecutableRelativePath("C:/Games/Portal/bin/game.exe", "c:/games/portal")).toBe("bin/game.exe")
    expect(getExecutableRelativePath("D:/Other/game.exe", "C:/Games/Portal")).toBe("D:/Other/game.exe")
  })

  it("matches the admin-pinned executable by relative path then by name", () => {
    const exes = [
      { name: "game.exe", path: "C:/G/bin/game.exe" },
      { name: "game.exe", path: "C:/G/game.exe" },
    ]
    const hit = matchAdminExecutable(exes, "bin\\game.exe", "C:/G")
    expect(hit?.path).toBe("C:/G/bin/game.exe")
    expect(matchAdminExecutable(exes, null)).toBeNull()
  })
})
