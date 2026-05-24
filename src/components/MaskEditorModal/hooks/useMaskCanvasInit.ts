import { useEffect, useRef } from 'react'
import type { MaskDraft } from '../../../types'
import { ensureImageCached } from '../../../store'
import { loadImage } from '../../../lib/image/canvasImage'
import { prepareMaskTargetDataUrl } from '../../../lib/image/maskPreprocess'

type ShowToast = (message: string, type?: 'info' | 'success' | 'error') => void

interface CanvasSize {
  width: number
  height: number
}

function fillWhiteMask(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function drawMaskImageToCanvas(maskImage: HTMLImageElement, maskCanvas: HTMLCanvasElement) {
  const maskAspect = maskImage.naturalWidth / maskImage.naturalHeight
  const canvasAspect = maskCanvas.width / maskCanvas.height
  if (Math.abs(maskAspect - canvasAspect) > 0.001) {
    throw new Error('遮罩尺寸与当前图片不一致')
  }

  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!maskCtx) throw new Error('当前浏览器不支持 Canvas')
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
  maskCtx.imageSmoothingEnabled = true
  maskCtx.imageSmoothingQuality = 'high'
  maskCtx.drawImage(maskImage, 0, 0, maskCanvas.width, maskCanvas.height)
}

/**
 * 负责遮罩编辑器画布的初始化 / 加载 / 清理：
 * - 会话 id 跟踪（用于保存时校验会话仍然有效）
 * - 载入源图、铺白底遮罩、按草稿恢复遮罩
 * - 切换 / 关闭图片时清理瞬态状态
 *
 * 说明（相对 spec 的必要偏离）：原始实现把整段初始化逻辑放在「单个」effect 中，
 * 该 effect 会重置 viewport / history / pointer 等多个 hook 拥有的状态，并且依赖
 * 数组为 [imageId, maskDraft, ...]（maskDraft 变化也会重新初始化）。为保持「单一
 * effect、单次批量更新」的时序完全不变，本 hook 通过回调接收这些跨 hook 的重置动作，
 * 而不是把状态拆进各自 hook 的独立 effect（后者会改变 effect 执行次数与批处理边界）。
 */
export function useMaskCanvasInit(args: {
  imageId: string | null
  maskDraft: MaskDraft | null
  imageCanvasRef: React.RefObject<HTMLCanvasElement | null>
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>
  renderPreview: () => void
  showToast: ShowToast
  setSourceDataUrl: (url: string) => void
  setSize: (size: CanvasSize | null) => void
  setIsLoading: (loading: boolean) => void
  setMaskEditorImageId: (id: string | null) => void
  cancelPreviewFrame: () => void
  resetViewportToDefault: () => void
  resetViewTransform: () => void
  resetHistory: () => void
  resetGestures: () => void
  resetActiveStroke: () => void
}): { activeSessionIdRef: React.MutableRefObject<number> } {
  const {
    imageId,
    maskDraft,
    imageCanvasRef,
    maskCanvasRef,
    previewCanvasRef,
    renderPreview,
    showToast,
    setSourceDataUrl,
    setSize,
    setIsLoading,
    setMaskEditorImageId,
    cancelPreviewFrame,
    resetViewportToDefault,
    resetViewTransform,
    resetHistory,
    resetGestures,
    resetActiveStroke,
  } = args

  const sessionIdRef = useRef(0)
  const activeSessionIdRef = useRef(0)

  useEffect(() => {
    if (!imageId) {
      activeSessionIdRef.current = 0
      return
    }

    const nextSessionId = sessionIdRef.current + 1
    sessionIdRef.current = nextSessionId
    activeSessionIdRef.current = nextSessionId

    return () => {
      if (activeSessionIdRef.current === nextSessionId) {
        activeSessionIdRef.current = 0
      }
    }
  }, [imageId])

  useEffect(() => {
    if (!imageId) {
      cancelPreviewFrame()
      setSourceDataUrl('')
      setSize(null)
      setIsLoading(false)
      resetGestures()
      resetViewportToDefault()
      resetHistory()
      return
    }

    const targetImageId = imageId
    let cancelled = false
    setIsLoading(true)
    setSourceDataUrl('')
    setSize(null)
    resetHistory()

    async function loadCanvases() {
      try {
        const dataUrl = await ensureImageCached(targetImageId)
        if (cancelled) return
        if (!dataUrl) {
          showToast('图片已不存在，无法编辑遮罩', 'error')
          setMaskEditorImageId(null)
          return
        }

        const preparedTarget = await prepareMaskTargetDataUrl(dataUrl)
        const image = await loadImage(preparedTarget.dataUrl)
        if (cancelled) return

        const nextSize = { width: preparedTarget.width, height: preparedTarget.height }
        const imageCanvas = imageCanvasRef.current
        const previewCanvas = previewCanvasRef.current
        const maskCanvas = maskCanvasRef.current
        if (!imageCanvas || !previewCanvas || !maskCanvas) return

        for (const canvas of [imageCanvas, previewCanvas, maskCanvas]) {
          canvas.width = nextSize.width
          canvas.height = nextSize.height
        }

        const imageCtx = imageCanvas.getContext('2d')
        if (!imageCtx) throw new Error('当前浏览器不支持 Canvas')
        imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height)
        imageCtx.drawImage(image, 0, 0)

        fillWhiteMask(maskCanvas)

        if (maskDraft?.targetImageId === targetImageId) {
          try {
            const draftImage = await loadImage(maskDraft.maskDataUrl)
            if (cancelled) return
            drawMaskImageToCanvas(draftImage, maskCanvas)
          } catch (err) {
            fillWhiteMask(maskCanvas)
            showToast(
              `遮罩草稿加载失败，已重置为空白遮罩：${err instanceof Error ? err.message : String(err)}`,
              'error',
            )
          }
        }

        renderPreview()
        setSourceDataUrl(preparedTarget.dataUrl)
        setSize(nextSize)
        if (preparedTarget.wasResized) {
          showToast(
            `已为遮罩编辑按官方要求调整图片尺寸：\n${preparedTarget.originalWidth}×${preparedTarget.originalHeight} → ${preparedTarget.width}×${preparedTarget.height}`,
            'info',
          )
        }
        requestAnimationFrame(() => resetViewTransform())
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : String(err), 'error')
          setMaskEditorImageId(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadCanvases()

    return () => {
      cancelled = true
      cancelPreviewFrame()
      resetActiveStroke()
    }
  }, [imageId, maskDraft, setMaskEditorImageId, showToast])

  return { activeSessionIdRef }
}
