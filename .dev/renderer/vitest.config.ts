import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../renderer/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: [resolve(__dirname, "**/*.test.{ts,tsx}")],
    setupFiles: [resolve(__dirname, "setup.ts")],
    globals: false,
  },
})
