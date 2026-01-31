/**
 * Centralized logging utility for UnionCrax.Direct
 * Logs are sent to the main process for persistent storage
 */

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogOptions {
  level?: LogLevel
  context?: string
  data?: any
  appid?: string
}

class Logger {
  private enabled = true
  private context: string

  constructor(context = "Renderer") {
    this.context = context
  }

  private formatMessage(message: string, options?: LogOptions): string {
    const ctx = options?.context || this.context
    return `[${ctx}] ${message}`
  }

  private async sendToMain(level: LogLevel, message: string, data?: any) {
    if (!this.enabled) return

    try {
      if (typeof window !== "undefined" && window.ucLogs?.log) {
        await window.ucLogs.log(level, message, data)
      }
    } catch (err) {
      // Fallback to console if IPC fails
      console.error("[Logger] Failed to send log to main process:", err)
    }
  }

  private log(level: LogLevel, message: string, options?: LogOptions) {
    const formattedMessage = this.formatMessage(message, options)
    const data = options?.data

    // Always log to console for immediate visibility
    const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log
    if (data !== undefined) {
      consoleMethod(formattedMessage, data)
    } else {
      consoleMethod(formattedMessage)
    }

    // Send to main process for persistent logging
    this.sendToMain(level, formattedMessage, data)
  }

  debug(message: string, options?: LogOptions) {
    this.log("debug", message, { ...options, level: "debug" })
  }

  info(message: string, options?: LogOptions) {
    this.log("info", message, { ...options, level: "info" })
  }

  warn(message: string, options?: LogOptions) {
    this.log("warn", message, { ...options, level: "warn" })
  }

  error(message: string, options?: LogOptions) {
    this.log("error", message, { ...options, level: "error" })
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  createChild(context: string): Logger {
    return new Logger(`${this.context}:${context}`)
  }
}

// Export singleton instances for different contexts
export const logger = new Logger("App")
export const apiLogger = new Logger("API")
export const downloadLogger = new Logger("Download")
export const gameLogger = new Logger("Game")
export const authLogger = new Logger("Auth")

export default logger
