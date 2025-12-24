"use client"

import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"

export default function ScrollProgress() {
  const [scrollProgress, setScrollProgress] = useState(0)
  const location = useLocation()

  useEffect(() => {
    const updateScrollProgress = () => {
      const scrollPx = document.documentElement.scrollTop
      const winHeightPx = document.documentElement.scrollHeight - document.documentElement.clientHeight
      const scrolled = winHeightPx > 0 ? (scrollPx / winHeightPx) * 100 : 0
      setScrollProgress(scrolled)
    }

    setScrollProgress(0)
    window.scrollTo(0, 0)

    window.addEventListener("scroll", updateScrollProgress)
    return () => window.removeEventListener("scroll", updateScrollProgress)
  }, [location.pathname])

  return (
    <div className="fixed top-0 left-0 w-full h-1 z-[60]">
      <div className="h-full bg-primary transition-all duration-150 ease-out" style={{ width: `${scrollProgress}%` }} />
    </div>
  )
}
