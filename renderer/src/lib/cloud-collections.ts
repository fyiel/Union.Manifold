import { apiFetch } from "@/lib/api"

export async function reportPlayEvent(appid: string, type: "play" | "install"): Promise<void> {
  try {
    await apiFetch("/api/account/play-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appid, type }),
    })
  } catch {
  }
}
