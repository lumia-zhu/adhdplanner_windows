import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

const DEFAULT_WIDTH = 280
const VIEWPORT_PADDING = 12
const GAP = 6

interface TooltipPosition {
  left: number
  top: number
  width: number
  placement: 'top' | 'bottom'
}

interface ChartInfoTooltipProps {
  children: ReactNode
  width?: number
  ariaLabel?: string
}

export default function ChartInfoTooltip({
  children,
  width = DEFAULT_WIDTH,
  ariaLabel = '查看图表说明',
}: ChartInfoTooltipProps) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const maxWidth = Math.max(160, viewportWidth - VIEWPORT_PADDING * 2)
    const tooltipWidth = Math.min(width, maxWidth)
    const measuredHeight = tooltipRef.current?.offsetHeight ?? 96

    const preferredLeft = rect.left + rect.width / 2 - tooltipWidth / 2
    const left = Math.min(
      Math.max(preferredLeft, VIEWPORT_PADDING),
      viewportWidth - tooltipWidth - VIEWPORT_PADDING,
    )

    const bottomTop = rect.bottom + GAP
    const topTop = rect.top - measuredHeight - GAP
    const placement = bottomTop + measuredHeight <= viewportHeight - VIEWPORT_PADDING || topTop < VIEWPORT_PADDING
      ? 'bottom'
      : 'top'

    const top = placement === 'bottom'
      ? Math.max(VIEWPORT_PADDING, Math.min(bottomTop, viewportHeight - measuredHeight - VIEWPORT_PADDING))
      : Math.max(topTop, VIEWPORT_PADDING)

    setPosition({ left, top, width: tooltipWidth, placement })
  }, [width])

  useLayoutEffect(() => {
    if (!open) return

    updatePosition()
    const raf = window.requestAnimationFrame(updatePosition)

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  const show = () => setOpen(true)
  const hide = () => setOpen(false)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={ariaLabel}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 text-[10px] leading-none text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-600 focus:border-gray-400 focus:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-200"
      >
        ?
      </button>

      {open && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className="pointer-events-none fixed z-[1000] rounded-lg bg-gray-800 px-3 py-2.5 text-[11px] font-normal leading-relaxed tracking-normal text-white shadow-lg"
          style={{
            left: position?.left ?? -9999,
            top: position?.top ?? -9999,
            width: position?.width ?? width,
            maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
            visibility: position ? 'visible' : 'hidden',
          }}
          data-placement={position?.placement}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
