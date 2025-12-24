"use client"

import { useEffect, useState } from "react"

interface AnimatedCounterProps {
  value: number
  duration?: number
  format?: (num: number) => string
  suffix?: string
}

export function AnimatedCounter({ value, duration = 2000, format, suffix = "" }: AnimatedCounterProps) {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    if (value === 0) {
      setCurrent(0)
      return
    }

    const start = Date.now()
    const startValue = current
    const endValue = value

    const animate = () => {
      const now = Date.now()
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)

      // Ease out for smoother animation
      const easeOut = 1 - Math.pow(1 - progress, 3)
      const currentValue = startValue + (endValue - startValue) * easeOut

      setCurrent(currentValue)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        setCurrent(endValue)
      }
    }

    requestAnimationFrame(animate)
  }, [value, duration])

  const displayValue = format ? format(Math.round(current)) : Math.round(current)

  return (
    <span>
      {displayValue}
      {suffix}
    </span>
  )
}
