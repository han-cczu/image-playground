import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import {
  clientPointToCanvasPoint,
  getPinchTransform,
  type Point,
  type ViewTransform,
} from '../../../lib/image/viewportTransform'
import type { CanvasViewport } from './useCanvasViewport'
import type { MaskHistory } from './useMaskHistory'

type Tool = 'brush' | 'eraser'

interface CanvasSize {
  width: number
  height: number
}

interface PinchGesture {
  startTransform: ViewTransform
  startCentroid: Point
  startDistance: number
}

interface PanGesture {
  pointerId: number
  startPoint: Point
  startTransform: ViewTransform
}

function getCanvasPoint(canvas: HTMLCanvasElement, event: ReactPointerEvent<HTMLCanvasElement>): Point {
  return clientPointToCanvasPoint(
    canvas.getBoundingClientRect(),
    { x: event.clientX, y: event.clientY },
    { width: canvas.width, height: canvas.height },
  )
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function centroid(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function firstTwoPointers(points: Map<number, Point>): [Point, Point] | null {
  const values = Array.from(points.values())
  return values.length >= 2 ? [values[0], values[1]] : null
}

export interface PointerInteraction {
  hoverPoint: Point | null
  isPointerOverCanvas: boolean
  isPanning: boolean
  isAltKeyPressed: boolean
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void
    onPointerLeave: (e: ReactPointerEvent<HTMLCanvasElement>) => void
    onWheel: (e: ReactWheelEvent<HTMLDivElement>) => void
  }
  // 暴露给 useMaskCanvasInit 用于切换 / 关闭图片时清理瞬态指针状态。
  resetGestures: () => void
  resetActiveStroke: () => void
  // 暴露给工具栏（笔刷大小面板开关 / 滑块）以驱动悬浮态与光标预览，行为同原实现。
  setHoverPoint: React.Dispatch<React.SetStateAction<Point | null>>
  setIsPointerOverCanvas: React.Dispatch<React.SetStateAction<boolean>>
}

export function usePointerInteraction(args: {
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  baseFrameRef: React.RefObject<HTMLDivElement | null>
  viewport: CanvasViewport
  history: MaskHistory
  tool: Tool
  brushSize: number
  size: CanvasSize | null
  renderPreview: () => void
  imageId: string | null
  isReady: boolean
  isSaving: boolean
  updateCursor: (point: Point | null) => void
  getViewportCenterCanvasPoint: () => Point | null
  setShowBrushControls: (value: boolean) => void
  setSliderAnchor: (value: null) => void
}): PointerInteraction {
  const {
    maskCanvasRef,
    baseFrameRef,
    viewport,
    history,
    tool,
    brushSize,
    renderPreview,
    imageId,
    isReady,
    isSaving,
    updateCursor,
    setShowBrushControls,
    setSliderAnchor,
  } = args
  const { viewTransformRef, commitViewTransform } = viewport

  const activePointerIdRef = useRef<number | null>(null)
  const lastPointRef = useRef<Point | null>(null)
  const pointerPositionsRef = useRef<Map<number, Point>>(new Map())
  const pinchGestureRef = useRef<PinchGesture | null>(null)
  const panGestureRef = useRef<PanGesture | null>(null)

  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [isPointerOverCanvas, setIsPointerOverCanvas] = useState(false)
  const [isAltKeyPressed, setIsAltKeyPressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)

  function cancelActiveStroke() {
    if (activePointerIdRef.current == null) return

    history.cancelActiveStroke()
    activePointerIdRef.current = null
    lastPointRef.current = null
  }

  function beginPinchGesture() {
    const pointers = firstTwoPointers(pointerPositionsRef.current)
    const frame = baseFrameRef.current
    if (!pointers || !frame) return

    const rect = frame.getBoundingClientRect()
    const startCentroid = centroid(pointers[0], pointers[1])
    pinchGestureRef.current = {
      startTransform: viewTransformRef.current,
      startCentroid: {
        x: startCentroid.x - rect.left,
        y: startCentroid.y - rect.top,
      },
      startDistance: distance(pointers[0], pointers[1]),
    }
  }

  function updatePinchGesture() {
    const pointers = firstTwoPointers(pointerPositionsRef.current)
    const gesture = pinchGestureRef.current
    const frame = baseFrameRef.current
    if (!pointers || !gesture || !frame) return

    const rect = frame.getBoundingClientRect()
    const nextCentroid = centroid(pointers[0], pointers[1])
    commitViewTransform(getPinchTransform({
      startTransform: gesture.startTransform,
      startCentroid: gesture.startCentroid,
      nextCentroid: {
        x: nextCentroid.x - rect.left,
        y: nextCentroid.y - rect.top,
      },
      startDistance: gesture.startDistance,
      nextDistance: distance(pointers[0], pointers[1]),
      viewportSize: { width: frame.clientWidth, height: frame.clientHeight },
    }))
  }

  function drawAt(point: Point, nextTool = tool) {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.save()
    ctx.globalCompositeOperation = nextTool === 'brush' ? 'destination-out' : 'source-over'
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    renderPreview()
  }

  function drawStroke(from: Point, to: Point, nextTool = tool) {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.save()
    ctx.globalCompositeOperation = nextTool === 'brush' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.restore()
    renderPreview()
  }

  useEffect(() => {
    if (!imageId) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) setIsAltKeyPressed(true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setIsAltKeyPressed(false)
    }
    const handleBlur = () => setIsAltKeyPressed(false)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [imageId])

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isReady || isSaving || (event.pointerType !== 'touch' && event.button !== 0)) return
    event.preventDefault()
    setShowBrushControls(false)
    setSliderAnchor(null)
    const canvas = event.currentTarget

    if (event.altKey) {
      if (!canvas.hasPointerCapture(event.pointerId)) {
        canvas.setPointerCapture(event.pointerId)
      }
      panGestureRef.current = {
        pointerId: event.pointerId,
        startPoint: { x: event.clientX, y: event.clientY },
        startTransform: viewTransformRef.current,
      }
      setIsPanning(true)
      updateCursor(null)
      return
    }

    pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!canvas.hasPointerCapture(event.pointerId)) {
      canvas.setPointerCapture(event.pointerId)
    }

    if (pointerPositionsRef.current.size >= 2) {
      cancelActiveStroke()
      beginPinchGesture()
      return
    }

    activePointerIdRef.current = event.pointerId
    history.pushSnapshot()
    const point = getCanvasPoint(canvas, event)
    lastPointRef.current = point
    drawAt(point)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event.currentTarget, event)
    if (event.pointerType !== 'touch') {
      setIsPointerOverCanvas(true)
      setHoverPoint(point)
      updateCursor(event.altKey || isAltKeyPressed ? null : point)
    }

    const panGesture = panGestureRef.current
    if (panGesture?.pointerId === event.pointerId) {
      const frame = baseFrameRef.current
      if (!frame) return

      event.preventDefault()
      commitViewTransform({
        scale: panGesture.startTransform.scale,
        x: panGesture.startTransform.x + event.clientX - panGesture.startPoint.x,
        y: panGesture.startTransform.y + event.clientY - panGesture.startPoint.y,
      })
      return
    }

    if (pointerPositionsRef.current.has(event.pointerId)) {
      pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pinchGestureRef.current && pointerPositionsRef.current.size >= 2) {
      event.preventDefault()
      updatePinchGesture()
      return
    }
    if (activePointerIdRef.current !== event.pointerId || !lastPointRef.current || !isReady || isSaving) return
    event.preventDefault()
    drawStroke(lastPointRef.current, point)
    lastPointRef.current = point
  }

  const handlePointerLeave = () => {
    setIsPointerOverCanvas(false)
    setHoverPoint(null)
    updateCursor(null)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.altKey || !isReady || isSaving) return

    const frame = baseFrameRef.current
    if (!frame) return

    event.preventDefault()
    viewport.zoomAtPoint(
      { x: event.clientX, y: event.clientY },
      Math.exp(-event.deltaY * 0.002),
    )
  }

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pointerPositionsRef.current.delete(event.pointerId)

    if (pinchGestureRef.current) {
      if (pointerPositionsRef.current.size >= 2) beginPinchGesture()
      else pinchGestureRef.current = null
    }

    if (panGestureRef.current?.pointerId === event.pointerId) {
      panGestureRef.current = null
      setIsPanning(false)
    }

    if (activePointerIdRef.current === event.pointerId) {
      activePointerIdRef.current = null
      lastPointRef.current = null
      if (hoverPoint) updateCursor(hoverPoint)
    }
  }

  const resetGestures = () => {
    pointerPositionsRef.current.clear()
    pinchGestureRef.current = null
    panGestureRef.current = null
    setIsPanning(false)
  }

  const resetActiveStroke = () => {
    activePointerIdRef.current = null
    lastPointRef.current = null
    pointerPositionsRef.current.clear()
    pinchGestureRef.current = null
    panGestureRef.current = null
    setIsPanning(false)
  }

  return {
    hoverPoint,
    isPointerOverCanvas,
    isPanning,
    isAltKeyPressed,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishStroke,
      onPointerLeave: handlePointerLeave,
      onWheel: handleWheel,
    },
    resetGestures,
    resetActiveStroke,
    setHoverPoint,
    setIsPointerOverCanvas,
  }
}
