"use client"

import React from "react"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APIFallback } from "@/components/api-fallback"

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
  errorInfo?: React.ErrorInfo
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error?: Error; retry?: () => void }>
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo)
    this.setState({
      error,
      errorInfo,
    })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return <FallbackComponent error={this.state.error} retry={this.handleRetry} />
      }

      return <ErrorFallback error={this.state.error} retry={this.handleRetry} />
    }

    return this.props.children
  }
}

interface ErrorFallbackProps {
  error?: Error
  retry?: () => void
}

export function ErrorFallback({ error, retry }: ErrorFallbackProps) {
  const handleRefresh = () => {
    if (retry) {
      retry()
    } else {
      window.location.reload()
    }
  }

  const handleGoHome = () => {
    window.location.href = "/"
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-2xl">
        <CardHeader className="text-center p-8">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Oops! Something went wrong</CardTitle>
          <CardDescription className="text-base mt-2 leading-relaxed">
            We encountered an unexpected error. This has been reported and we're working to fix it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-8 pt-0">
          {error && (
            <div className="rounded-xl bg-muted p-4">
              <p className="text-sm text-muted-foreground font-mono">{error.message}</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button onClick={handleRefresh} className="w-full rounded-full h-12">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            <Button variant="outline" onClick={handleGoHome} className="w-full rounded-full h-12 bg-transparent">
              <Home className="mr-2 h-4 w-4" />
              Go Home
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            If this problem persists, please contact support.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export class APIErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    if (error.message.includes("fetch") || error.message.includes("API") || error.message.includes("network")) {
      return { hasError: true, error }
    }
    return { hasError: false }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("API ErrorBoundary caught an error:", error, errorInfo)
    this.setState({
      error,
      errorInfo,
    })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined })
  }

  render() {
    if (this.state.hasError) {
      return <APIErrorFallback error={this.state.error} retry={this.handleRetry} />
    }

    return this.props.children
  }
}

function APIErrorFallback({ error, retry }: ErrorFallbackProps) {
  return <APIFallback onRetry={retry} message="Failed to load games" showOfflineMessage={true} />
}
