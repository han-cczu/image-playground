import { useEffect } from 'react'
import type { Point, ViewTransform } from '../../../lib/image/viewportTransform'
import type { CanvasSize } from '../types'

/**
 * 笔刷光标叠加层。
 *
 * 说明（相对 spec 的必要偏离）：spec 中签名为 `void`，但原实现里 `updateCursor`
 * 会在 usePointerInteraction 的指针处理器、工具栏开关、滑块拖动等处被「命令式」立即
 * 调用（绘制时无一帧延迟），并非仅靠触发 effect 声明式驱动。为完全保持这一时序，本
 * hook 仍把 `updateCursor` 暴露出去由调用方命令式调用；同时内部保留与原实现完全一致
 * 的触发 effect（依赖数组保持不变）。
 */
export function useCursorOverlay(args: {
  cursorCanvasRef: React.RefObject<HTMLCanvasElement | null>
  stageRef: React.RefObject<HTMLDivElement | null>
  baseFrameRef: React.RefObject<HTMLDivElement | null>
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  viewTransformRef: React.MutableRefObject<ViewTransform>
  viewTransform: ViewTransform
  brushSize: number
  hoverPoint: Point | null
  isPointerOverCanvas: boolean
  showBrushControls: boolean
  size: CanvasSize | null
  isAltKeyPressed: boolean
  getViewportCenterCanvasPoint: () => Point | null
}): { updateCursor: (point: Point | null) => void } {
  const {
    cursorCanvasRef,
    stageRef,
    baseFrameRef,
    maskCanvasRef,
    viewTransformRef,
    viewTransform,
    brushSize,
    hoverPoint,
    isPointerOverCanvas,
    showBrushControls,
    size,
    isAltKeyPressed,
    getViewportCenterCanvasPoint,
  } = args

  function updateCursor(point: Point | null) {
    const cursorCanvas = cursorCanvasRef.current
    const stage = stageRef.current
    const frame = baseFrameRef.current
    const maskCanvas = maskCanvasRef.current
    const ctx = cursorCanvas?.getContext('2d')
    if (!cursorCanvas || !ctx || !stage || !frame || !maskCanvas) return

    const dpr = window.devicePixelRatio || 1
    const width = stage.clientWidth
    const height = stage.clientHeight
    if (cursorCanvas.width !== Math.round(width * dpr) || cursorCanvas.height !== Math.round(height * dpr)) {
      cursorCanvas.width = Math.round(width * dpr)
      cursorCanvas.height = Math.round(height * dpr)
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!point) return

    const scale = viewTransformRef.current.scale
    const stageRect = stage.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const frameLeft = frameRect.left - stageRect.left
    const frameTop = frameRect.top - stageRect.top
    const x = frameLeft + (point.x / maskCanvas.width) * frame.clientWidth * scale + viewTransformRef.current.x
    const y = frameTop + (point.y / maskCanvas.height) * frame.clientHeight * scale + viewTransformRef.current.y
    const radius = (brushSize / 2 / maskCanvas.width) * frame.clientWidth * scale

    ctx.save()
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.stroke()

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.beginPath()
    ctx.arc(x, y, radius + 1, 0, Math.PI * 2)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(x, y, Math.max(0, radius - 1), 0, Math.PI * 2)
    ctx.stroke()

    const crosshairSize = 5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.beginPath()
    ctx.moveTo(x - crosshairSize, y)
    ctx.lineTo(x + crosshairSize, y)
    ctx.moveTo(x, y - crosshairSize)
    ctx.lineTo(x, y + crosshairSize)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.beginPath()
    ctx.moveTo(x - crosshairSize, y)
    ctx.lineTo(x + crosshairSize, y)
    ctx.moveTo(x, y - crosshairSize)
    ctx.lineTo(x, y + crosshairSize)
    ctx.stroke()
    ctx.restore()
  }

  useEffect(() => {
    if (isAltKeyPressed) {
      updateCursor(null)
    } else if (showBrushControls && !isPointerOverCanvas && size) {
      updateCursor(getViewportCenterCanvasPoint())
    } else {
      updateCursor(hoverPoint)
    }
  }, [brushSize, viewTransform, hoverPoint, isPointerOverCanvas, showBrushControls, size, isAltKeyPressed])

  return { updateCursor }
}
