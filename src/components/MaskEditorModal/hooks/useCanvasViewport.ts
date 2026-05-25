import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampViewTransform,
  getComfortableInitialTransform,
  zoomAtPoint as libZoomAtPoint,
  type Point,
  type ViewTransform,
} from '../../../lib/image/viewportTransform'
import type { CanvasSize } from '../types'

const DEFAULT_VIEW_TRANSFORM: ViewTransform = { scale: 1, x: 0, y: 0 }

export interface CanvasViewport {
  viewTransform: ViewTransform
  viewTransformRef: React.MutableRefObject<ViewTransform>
  commitViewTransform: (t: ViewTransform) => void
  resetViewportToDefault: () => void
  resetViewTransform: () => void
  zoomAtPoint: (clientPoint: Point, factor: number) => void
  isZoomed: boolean
}

export function useCanvasViewport(args: {
  size: CanvasSize | null
  baseFrameRef: React.RefObject<HTMLDivElement | null>
  stageRef: React.RefObject<HTMLDivElement | null>
}): CanvasViewport {
  const { size, baseFrameRef, stageRef } = args

  const viewTransformRef = useRef<ViewTransform>(DEFAULT_VIEW_TRANSFORM)
  const [viewTransform, setViewTransform] = useState<ViewTransform>(DEFAULT_VIEW_TRANSFORM)

  const commitViewTransform = useCallback((nextTransform: ViewTransform) => {
    const frame = baseFrameRef.current
    const clamped = frame
      ? clampViewTransform(nextTransform, { width: frame.clientWidth, height: frame.clientHeight })
      : nextTransform
    viewTransformRef.current = clamped
    setViewTransform(clamped)
  }, [baseFrameRef])

  const resetViewportToDefault = useCallback(() => {
    commitViewTransform(DEFAULT_VIEW_TRANSFORM)
  }, [commitViewTransform])

  const resetViewTransform = useCallback(() => {
    const frame = baseFrameRef.current
    const stage = stageRef.current
    const isCompactLayout = window.matchMedia('(max-width: 1023px)').matches
    if (!frame || !stage) {
      commitViewTransform(DEFAULT_VIEW_TRANSFORM)
      return
    }

    commitViewTransform(getComfortableInitialTransform(
      { width: frame.clientWidth, height: frame.clientHeight },
      { width: stage.clientWidth, height: stage.clientHeight },
      isCompactLayout,
    ))
  }, [baseFrameRef, stageRef, commitViewTransform])

  const zoomAtPoint = useCallback((clientPoint: Point, factor: number) => {
    const frame = baseFrameRef.current
    if (!frame) return

    const rect = frame.getBoundingClientRect()
    const point = {
      x: clientPoint.x - rect.left,
      y: clientPoint.y - rect.top,
    }
    commitViewTransform(libZoomAtPoint(
      viewTransformRef.current,
      point,
      viewTransformRef.current.scale * factor,
      { width: frame.clientWidth, height: frame.clientHeight },
    ))
  }, [baseFrameRef, commitViewTransform])

  useEffect(() => {
    const frame = baseFrameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      commitViewTransform(viewTransformRef.current)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [size, baseFrameRef, commitViewTransform])

  const isZoomed = viewTransform.scale > 1.01 || Math.abs(viewTransform.x) > 1 || Math.abs(viewTransform.y) > 1

  return {
    viewTransform,
    viewTransformRef,
    commitViewTransform,
    resetViewportToDefault,
    resetViewTransform,
    zoomAtPoint,
    isZoomed,
  }
}
