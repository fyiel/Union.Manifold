import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

export function VirtualGrid<T>({
  items,
  scrollRef,
  renderItem,
  getKey,
  minColWidth = 168,
  gap = 18,
  rowHeightFor,
  overscan = 3,
}: {
  items: T[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  renderItem: (item: T) => ReactNode
  getKey: (item: T) => string
  minColWidth?: number
  gap?: number
  rowHeightFor?: (colWidth: number) => number
  overscan?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [cols, setCols] = useState(1)
  const [colWidth, setColWidth] = useState(minColWidth)
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    const sc = scrollRef.current
    if (!el || !sc) return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) {
        const c = Math.max(1, Math.floor((w + gap) / (minColWidth + gap)))
        setCols(c)
        setColWidth((w - (c - 1) * gap) / c)
      }
      const m = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      setScrollMargin(Math.max(0, Math.round(m)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [minColWidth, gap, scrollRef])

  const rowHeight = (rowHeightFor ? rowHeightFor(colWidth) : colWidth * (4 / 3) + 82) + gap
  const rowCount = Math.ceil(items.length / cols)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    scrollMargin,
  })

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowHeight, cols, rowVirtualizer])

  return (
    <div ref={containerRef}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {rowVirtualizer.getVirtualItems().map((vr) => {
          const start = vr.index * cols
          const rowItems = items.slice(start, start + cols)
          return (
            <div
              key={vr.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vr.start - scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gap,
              }}
            >
              {rowItems.map((item) => (
                <div key={getKey(item)}>{renderItem(item)}</div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
