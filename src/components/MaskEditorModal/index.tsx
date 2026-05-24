import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { canvasToBlob } from '../../lib/image/canvasImage'
import { storeImage } from '../../lib/db'
import { replaceMaskTargetImage } from '../../lib/image/maskPreprocess'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import {
  type Point,
  type ViewTransform,
} from '../../lib/image/viewportTransform'
import { useMaskHistory } from './hooks/useMaskHistory'
import { useCanvasViewport } from './hooks/useCanvasViewport'
import { useMaskCanvasInit } from './hooks/useMaskCanvasInit'
import { usePointerInteraction } from './hooks/usePointerInteraction'

type Tool = 'brush' | 'eraser'

interface CanvasSize {
  width: number
  height: number
}

interface SliderAnchor {
  left: number
  bottom: number
}

const DEFAULT_VIEW_TRANSFORM: ViewTransform = { scale: 1, x: 0, y: 0 }

function fillWhiteMask(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片导出失败'))
    reader.readAsDataURL(blob)
  })
}

export default function MaskEditorModal() {
  const imageId = useStore((s) => s.maskEditorImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const maskDraft = useStore((s) => s.maskDraft)
  const setMaskDraft = useStore((s) => s.setMaskDraft)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)

  const imageCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const baseFrameRef = useRef<HTMLDivElement>(null)
  const brushSizeControlRef = useRef<HTMLDivElement>(null)
  const brushSizeButtonRef = useRef<HTMLButtonElement>(null)
  const brushSizePanelRef = useRef<HTMLDivElement>(null)
  const maskInfoTimerRef = useRef<number | null>(null)
  const previewFrameRef = useRef<number | null>(null)
  const saveTokenRef = useRef(0)

  const [sourceDataUrl, setSourceDataUrl] = useState('')
  const [size, setSize] = useState<CanvasSize | null>(null)
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(64)
  const [showBrushControls, setShowBrushControls] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [sliderAnchor, setSliderAnchor] = useState<SliderAnchor | null>(null)
  const [showMaskInfo, setShowMaskInfo] = useState(false)

  const viewport = useCanvasViewport({ size, baseFrameRef, stageRef })
  const { viewTransform, viewTransformRef, commitViewTransform, resetViewTransform, isZoomed } = viewport

  const history = useMaskHistory({
    maskCanvasRef,
    renderPreview: () => renderPreview(),
    fillWhiteMask: () => fillWhiteMask(maskCanvasRef.current!),
  })
  const { undoStackRef, redoStackRef, syncHistoryState } = history

  const isReady = Boolean(sourceDataUrl && size && !isLoading)

  const pointer = usePointerInteraction({
    maskCanvasRef,
    baseFrameRef,
    viewport,
    history,
    tool,
    brushSize,
    size,
    renderPreview: () => renderPreview(),
    imageId,
    isReady,
    isSaving,
    updateCursor: (point) => updateCursor(point),
    getViewportCenterCanvasPoint: () => getViewportCenterCanvasPoint(),
    setShowBrushControls,
    setSliderAnchor,
  })
  const { hoverPoint, isPointerOverCanvas, isAltKeyPressed, isPanning } = pointer

  const { activeSessionIdRef } = useMaskCanvasInit({
    imageId,
    maskDraft,
    imageCanvasRef,
    maskCanvasRef,
    previewCanvasRef,
    renderPreview: () => renderPreview(),
    showToast,
    setSourceDataUrl,
    setSize,
    setIsLoading,
    setMaskEditorImageId,
    cancelPreviewFrame: () => {
      if (previewFrameRef.current != null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
    },
    resetViewportToDefault: () => commitViewTransform(DEFAULT_VIEW_TRANSFORM),
    resetViewTransform: () => resetViewTransform(),
    resetHistory: () => {
      undoStackRef.current = []
      redoStackRef.current = []
      syncHistoryState()
    },
    resetGestures: () => pointer.resetGestures(),
    resetActiveStroke: () => pointer.resetActiveStroke(),
  })

  const close = () => {
    if (isSaving) return
    setMaskEditorImageId(null)
  }
  useCloseOnEscape(Boolean(imageId), close)

  useEffect(() => () => {
    if (maskInfoTimerRef.current != null) {
      window.clearTimeout(maskInfoTimerRef.current)
    }
  }, [])

  const showMaskInfoPopover = () => setShowMaskInfo(true)

  const hideMaskInfoPopover = () => {
    setShowMaskInfo(false)
    clearMaskInfoTimer()
  }

  const clearMaskInfoTimer = () => {
    if (maskInfoTimerRef.current != null) {
      window.clearTimeout(maskInfoTimerRef.current)
      maskInfoTimerRef.current = null
    }
  }

  const startMaskInfoTouch = () => {
    maskInfoTimerRef.current = window.setTimeout(() => {
      setShowMaskInfo(true)
      maskInfoTimerRef.current = null
    }, 450)
  }

  const handleRemoveMask = () => {
    setConfirmDialog({
      title: '移除遮罩',
      message: '确定要撤销对这张图片的所有涂抹并移除遮罩吗？',
      tone: 'danger',
      action: () => {
        clearMaskDraft()
        setMaskEditorImageId(null)
        showToast('已移除遮罩', 'success')
      },
    })
  }

  function renderPreviewNow() {
    const maskCanvas = maskCanvasRef.current
    const previewCanvas = previewCanvasRef.current
    if (!maskCanvas || !previewCanvas) return

    const previewCtx = previewCanvas.getContext('2d')
    if (!previewCtx) return

    previewFrameRef.current = null
    previewCtx.save()
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
    previewCtx.globalCompositeOperation = 'source-over'
    previewCtx.fillStyle = 'rgba(59, 130, 246, 0.58)'
    previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height)
    previewCtx.globalCompositeOperation = 'destination-out'
    previewCtx.drawImage(maskCanvas, 0, 0)
    previewCtx.restore()
  }

  function renderPreview() {
    if (previewFrameRef.current != null) return
    previewFrameRef.current = window.requestAnimationFrame(renderPreviewNow)
  }

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

  function getViewportCenterCanvasPoint(): Point | null {
    const frame = baseFrameRef.current
    const maskCanvas = maskCanvasRef.current
    if (!frame || !maskCanvas) return null

    const transform = viewTransformRef.current
    return {
      x: ((frame.clientWidth / 2 - transform.x) / transform.scale / frame.clientWidth) * maskCanvas.width,
      y: ((frame.clientHeight / 2 - transform.y) / transform.scale / frame.clientHeight) * maskCanvas.height,
    }
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

  useEffect(() => {
    if (!showBrushControls) return

    const closeBrushControls = (event: PointerEvent) => {
      const control = brushSizeControlRef.current
      const panel = brushSizePanelRef.current
      if (control?.contains(event.target as Node)) return
      if (panel?.contains(event.target as Node)) return
      setShowBrushControls(false)
      setSliderAnchor(null)
    }

    document.addEventListener('pointerdown', closeBrushControls, true)
    return () => document.removeEventListener('pointerdown', closeBrushControls, true)
  }, [showBrushControls])

  if (!imageId) return null

  const canUndo = history.canUndo && isReady && !isSaving
  const canRedo = history.canRedo && isReady && !isSaving

  const handleUndo = () => history.undo()

  const handleRedo = () => history.redo()

  const handleClear = () => {
    if (!maskCanvasRef.current || !isReady || isSaving) return
    history.clear()
  }

  const handleSave = async () => {
    const canvas = maskCanvasRef.current
    const savingSessionId = activeSessionIdRef.current
    if (!canvas || !sourceDataUrl || !imageId || !isReady || isSaving || !savingSessionId) return

    const token = ++saveTokenRef.current
    const savingImageId = imageId
    try {
      setIsSaving(true)
      const blob = await canvasToBlob(canvas, 'image/png')
      const maskDataUrl = await blobToDataUrl(blob)
      const workingTargetId = await storeImage(sourceDataUrl, 'upload')
      if (
        saveTokenRef.current !== token ||
        activeSessionIdRef.current !== savingSessionId ||
        useStore.getState().maskEditorImageId !== savingImageId
      ) return

      const latestStore = useStore.getState()
      latestStore.setInputImages(
        replaceMaskTargetImage(latestStore.inputImages, savingImageId, {
          id: workingTargetId,
          dataUrl: sourceDataUrl,
        }),
      )
      setMaskDraft({
        targetImageId: workingTargetId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
      setMaskEditorImageId(null)
      showToast('遮罩已保存', 'success')
    } catch (err) {
      if (
        saveTokenRef.current !== token ||
        activeSessionIdRef.current !== savingSessionId ||
        useStore.getState().maskEditorImageId !== savingImageId
      ) return
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      if (saveTokenRef.current === token) setIsSaving(false)
    }
  }

  const toggleBrushControls = () => {
    const rect = brushSizeButtonRef.current?.getBoundingClientRect()
    if (!rect) return

    pointer.setIsPointerOverCanvas(false)
    pointer.setHoverPoint(null)
    if (size) updateCursor(getViewportCenterCanvasPoint())

    setSliderAnchor({
      left: rect.left + rect.width / 2,
      bottom: window.innerHeight - rect.top + 8,
    })
    setShowBrushControls((value) => !value)
  }

  return (
    <>
      <div data-no-drag-select className="fixed inset-0 z-[80] flex flex-col bg-gray-50 dark:bg-gray-900 animate-modal-in">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 z-20">
        <div className="flex items-center gap-3">
          <button onClick={close} disabled={isSaving} className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-lg dark:text-gray-400 dark:hover:bg-gray-800 transition" title="取消">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          <div className="relative flex items-center gap-1.5">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200" id="mask-editor-title">编辑遮罩</h2>
            <button
              type="button"
              onClick={showMaskInfoPopover}
              onMouseEnter={showMaskInfoPopover}
              onMouseLeave={hideMaskInfoPopover}
              onTouchStart={startMaskInfoTouch}
              onTouchEnd={clearMaskInfoTimer}
              onTouchCancel={hideMaskInfoPopover}
              className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="遮罩编辑说明"
              title="遮罩编辑说明"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showMaskInfo && (
              <div className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-gray-200/80 bg-white px-3 py-2 text-xs leading-5 text-gray-600 shadow-lg dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300">
                <div className="absolute -top-1.5 left-16 h-3 w-3 rotate-45 border-l border-t border-gray-200/80 bg-white dark:border-white/[0.08] dark:bg-gray-900" />
                根据官方文档说明，此功能仅基于提示词，无法完全控制模型编辑区域
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {maskDraft?.targetImageId === imageId && (
            <button onClick={handleRemoveMask} className="flex h-8 items-center gap-1.5 px-4 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition">
              移除遮罩
            </button>
          )}
          <button onClick={handleSave} disabled={!isReady || isSaving} className="flex h-8 items-center gap-1.5 px-4 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50 transition">
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div ref={stageRef} className="flex-1 relative flex items-center justify-center overflow-hidden bg-gray-100/50 dark:bg-black/50 p-0 pb-[76px] sm:p-6 sm:pb-[100px]" style={{ containerType: 'size' }}>
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/50 text-sm text-gray-500 backdrop-blur-sm dark:bg-gray-900/50 dark:text-gray-300">
            正在载入图片...
          </div>
        )}
        <div
          ref={baseFrameRef}
          className="relative max-h-full max-w-full sm:rounded-xl shadow-inner sm:ring-1 ring-black/5 touch-none dark:bg-black/50 dark:ring-white/5"
          onWheel={pointer.handlers.onWheel}
          style={{
            aspectRatio: size ? `${size.width} / ${size.height}` : '1 / 1',
            width: size ? `min(100%, 100cqh * ${size.width / size.height})` : '520px',
            maxHeight: '100%',
          }}
        >
            <div
              className="absolute inset-0 will-change-transform"
              style={{
                transform: `matrix(${viewTransform.scale}, 0, 0, ${viewTransform.scale}, ${viewTransform.x}, ${viewTransform.y})`,
                transformOrigin: '0 0',
              }}
            >
              <canvas ref={imageCanvasRef} className="absolute inset-0 h-full w-full" />
              <canvas ref={previewCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />
              <canvas
                ref={maskCanvasRef}
                className="absolute inset-0 h-full w-full touch-none select-none opacity-0"
                style={{ cursor: isPanning ? 'grabbing' : isAltKeyPressed ? 'grab' : hoverPoint ? 'none' : 'crosshair' }}
                onPointerDown={pointer.handlers.onPointerDown}
                onPointerMove={pointer.handlers.onPointerMove}
                onPointerUp={pointer.handlers.onPointerUp}
                onPointerCancel={pointer.handlers.onPointerUp}
                onLostPointerCapture={pointer.handlers.onPointerUp}
                onPointerLeave={pointer.handlers.onPointerLeave}
              />
            </div>
          </div>
          <canvas ref={cursorCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />
        </div>

        {/* Footer Toolbar */}
        <div className="absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 flex items-center justify-center z-20 pointer-events-none w-full px-2 sm:px-4">
          <div className="flex items-center gap-2 sm:gap-4 px-2 sm:px-3 py-1.5 sm:py-2 bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md border border-gray-200/80 dark:border-white/5 rounded-2xl sm:rounded-[1.25rem] shadow-2xl pointer-events-auto">
            <div className="flex items-center gap-1.5 sm:gap-3">
              <div className="flex items-center bg-gray-100/80 dark:bg-[#232325]/80 p-1 rounded-xl sm:rounded-[14px]">
                <button
                  className={`p-2 sm:p-2.5 rounded-lg sm:rounded-xl transition-all ${tool === 'brush' ? 'bg-white shadow-sm text-blue-500 dark:bg-[#323338] dark:text-blue-400 dark:shadow-none' : 'text-gray-500 hover:text-gray-700 dark:text-[#8a8a8e] dark:hover:text-gray-200'}`}
                  onClick={() => setTool('brush')}
                  disabled={!isReady || isSaving}
                  title="画笔"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <button
                  className={`p-2 sm:p-2.5 rounded-lg sm:rounded-xl transition-all ${tool === 'eraser' ? 'bg-white shadow-sm text-blue-500 dark:bg-[#323338] dark:text-blue-400 dark:shadow-none' : 'text-gray-500 hover:text-gray-700 dark:text-[#8a8a8e] dark:hover:text-gray-200'}`}
                  onClick={() => setTool('eraser')}
                  disabled={!isReady || isSaving}
                  title="橡皮"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <g transform="translate(0, 1) rotate(-45 12 12)">
                      <path fill="currentColor" d="M4 10a2 2 0 0 1 2-2h7v8H6a2 2 0 0 1-2-2z" />
                      <rect x="4" y="8" width="16" height="8" rx="2" />
                    </g>
                    <path d="M8 21h12" />
                  </svg>
                </button>
              </div>
              
              <div ref={brushSizeControlRef} className="relative flex items-center justify-center">
                <button
                  ref={brushSizeButtonRef}
                  onClick={toggleBrushControls}
                  className={`flex items-center justify-center w-10 h-10 sm:w-[46px] sm:h-[46px] rounded-xl sm:rounded-[14px] transition-all border ${showBrushControls ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-[#323338] dark:border-gray-600 dark:text-blue-400' : 'bg-white border-gray-200/80 text-gray-700 hover:bg-gray-50 dark:bg-transparent dark:border-[#323338] dark:text-[#e0e0e0] dark:hover:border-gray-500'}`}
                  disabled={!isReady || isSaving}
                  title="调节笔刷大小"
                >
                  <span className="text-[14px] sm:text-[15px] font-semibold tracking-tight">{brushSize}</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-2 sm:ml-1">
              <button onClick={handleUndo} disabled={!canUndo} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="撤销">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7v6h6" />
                  <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                </svg>
              </button>
              <button onClick={handleRedo} disabled={!canRedo} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="重做">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 7v6h-6" />
                  <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
                </svg>
              </button>
              <div className="w-px h-4 sm:h-5 bg-gray-300 dark:bg-[#323338] mx-1"></div>
              <button onClick={resetViewTransform} disabled={!isReady || isSaving || !isZoomed} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="重置视图">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14h6v6"/>
                  <path d="M20 10h-6V4"/>
                  <path d="M14 10l7-7"/>
                  <path d="M3 21l7-7"/>
                </svg>
              </button>
              <button onClick={handleClear} disabled={!isReady || isSaving} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="清空遮罩">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"/>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      {showBrushControls && sliderAnchor && createPortal(
        <div
          ref={brushSizePanelRef}
          className="fixed z-[100] h-44 w-14 -translate-x-1/2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700"
          style={{ left: sliderAnchor.left, bottom: sliderAnchor.bottom }}
        >
          <input
            type="range"
            min={8}
            max={220}
            value={brushSize}
            onChange={(e) => {
              const nextSize = Number(e.target.value)
              setBrushSize(nextSize)
              if (!isPointerOverCanvas && size) updateCursor(getViewportCenterCanvasPoint())
            }}
            className="absolute left-1/2 top-1/2 h-5 w-32 -translate-x-1/2 -translate-y-1/2 -rotate-90 accent-blue-500 cursor-ns-resize"
            disabled={!isReady || isSaving}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
