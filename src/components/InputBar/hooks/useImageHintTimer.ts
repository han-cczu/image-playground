import { useState, useRef, useEffect } from 'react'

/**
 * 参考图缩略图提示的集中可见性状态:多张图共享一个 imageHintId,保证同时只有一条
 * 提示,且拖拽/触摸手势(ImageGrid)能在任意时点强制收起。
 * startHintTouch 是遮罩主图的「长按 450ms 查看」路径:ImageGrid 在 touchend/touchmove
 * 时统一调用 hideHint,所以这里不需要自动隐藏兜底。
 */
export function useImageHintTimer(): {
  imageHintId: string | null
  showHint: (id: string) => void
  hideHint: () => void
  startHintTouch: (id: string) => void
} {
  const [imageHintId, setImageHintId] = useState<string | null>(null)
  const imageHintTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
    }
  }, [])

  const clearImageHintTimer = () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
      imageHintTimerRef.current = null
    }
  }

  const showHint = (id: string) => setImageHintId(id)

  const hideHint = () => {
    setImageHintId(null)
    clearImageHintTimer()
  }

  const startHintTouch = (id: string) => {
    clearImageHintTimer()
    imageHintTimerRef.current = window.setTimeout(() => {
      setImageHintId(id)
      imageHintTimerRef.current = null
    }, 450)
  }

  return { imageHintId, showHint, hideHint, startHintTouch }
}
