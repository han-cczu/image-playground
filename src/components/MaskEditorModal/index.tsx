import { useEffect, useRef, useState } from 'react'
import { useStore, rollbackStoredImages } from '../../store'
import { canvasToBlob } from '../../lib/image/canvasImage'
import { storeImage } from '../../lib/db'
import { replaceMaskTargetImage } from '../../lib/image/maskPreprocess'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { type Point } from '../../lib/image/viewportTransform'
import { useMaskHistory } from './hooks/useMaskHistory'
import { useCanvasViewport } from './hooks/useCanvasViewport'
import { useMaskCanvasInit } from './hooks/useMaskCanvasInit'
import { usePointerInteraction } from './hooks/usePointerInteraction'
import { useCursorOverlay } from './hooks/useCursorOverlay'
import CanvasViewport from './CanvasViewport'
import BrushToolbar from './BrushToolbar'
import BrushSizePanel from './BrushSizePanel'
import MaskInfoPopover from './MaskInfoPopover'
import { fillWhiteMask } from './maskCanvas'
import type { Tool, CanvasSize, SliderAnchor } from './types'

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
  const previewFrameRef = useRef<number | null>(null)
  const saveTokenRef = useRef(0)
  const updateCursorRef = useRef<(point: Point | null) => void>(() => {})

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
  const { viewTransform, viewTransformRef, resetViewTransform, isZoomed } = viewport

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
    updateCursor: (point) => updateCursorRef.current(point),
    getViewportCenterCanvasPoint: () => getViewportCenterCanvasPoint(),
    setShowBrushControls,
    setSliderAnchor,
  })
  const { hoverPoint, isPointerOverCanvas, isAltKeyPressed, isPanning } = pointer

  const cursorOverlay = useCursorOverlay({
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
    getViewportCenterCanvasPoint: () => getViewportCenterCanvasPoint(),
  })
  useEffect(() => {
    updateCursorRef.current = cursorOverlay.updateCursor
  })

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
    // resetViewportToDefault: 同步重置到 identity；resetViewTransform: rAF 内重置到舒适适配变换
    resetViewportToDefault: viewport.resetViewportToDefault,
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
  useLockBodyScroll(Boolean(imageId))
  // 焦点陷阱:此前是全部弹层中唯一缺陷阱的——Tab 会逃逸到被全屏遮挡的背景控件,关闭后焦点不还原。
  // 画笔尺寸面板 portal 到 body(modalRoot 之外),作为附属容器一并纳入环,否则滑杆键盘不可达
  const modalRootRef = useRef<HTMLDivElement>(null)
  useFocusTrap(Boolean(imageId), modalRootRef, { extraContainerRefs: [brushSizePanelRef] })

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

  const imperativeUpdateCursor = (point: Point | null) => updateCursorRef.current(point)

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
      ) {
        // 保存期间用户已关闭/切图:回滚刚存入的图(若无其它引用),避免孤儿记录
        await rollbackStoredImages([workingTargetId])
        return
      }

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
    if (size) imperativeUpdateCursor(getViewportCenterCanvasPoint())

    setSliderAnchor({
      left: rect.left + rect.width / 2,
      bottom: window.innerHeight - rect.top + 8,
    })
    setShowBrushControls((value) => !value)
  }

  const handleBrushSizeChange = (nextSize: number) => {
    setBrushSize(nextSize)
    if (!isPointerOverCanvas && size) imperativeUpdateCursor(getViewportCenterCanvasPoint())
  }

  return (
    <>
      <div ref={modalRootRef} role="dialog" aria-modal="true" aria-label="遮罩编辑器" tabIndex={-1} data-no-drag-select className="fixed inset-0 z-[80] flex flex-col bg-gray-50 dark:bg-gray-900 animate-modal-in">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 z-20">
        <div className="flex items-center gap-3">
          <button onClick={close} disabled={isSaving} className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-lg dark:text-gray-400 dark:hover:bg-gray-800 transition" title="取消">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          <MaskInfoPopover open={showMaskInfo} onOpenChange={setShowMaskInfo} />
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
      <CanvasViewport
        size={size}
        isLoading={isLoading}
        viewTransform={viewTransform}
        isPanning={isPanning}
        isAltKeyPressed={isAltKeyPressed}
        hoverPoint={hoverPoint}
        imageCanvasRef={imageCanvasRef}
        maskCanvasRef={maskCanvasRef}
        previewCanvasRef={previewCanvasRef}
        cursorCanvasRef={cursorCanvasRef}
        baseFrameRef={baseFrameRef}
        stageRef={stageRef}
        handlers={pointer.handlers}
      >
        <BrushToolbar
          tool={tool}
          onToolChange={setTool}
          brushSize={brushSize}
          showBrushControls={showBrushControls}
          onToggleBrushSize={toggleBrushControls}
          brushSizeControlRef={brushSizeControlRef}
          brushSizeButtonRef={brushSizeButtonRef}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          isZoomed={isZoomed}
          onResetView={resetViewTransform}
          onClear={handleClear}
          isReady={isReady}
          isSaving={isSaving}
        />
      </CanvasViewport>
      </div>
      <BrushSizePanel
        open={showBrushControls}
        brushSize={brushSize}
        onChange={handleBrushSizeChange}
        anchor={sliderAnchor}
        disabled={!isReady || isSaving}
        panelRef={brushSizePanelRef}
      />
    </>
  )
}
