import { useRef, useCallback, useEffect } from 'react'

export function useAutoResizeTextarea(args: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  imagesRef: React.RefObject<HTMLDivElement | null>
  deps: { prompt: string; imageCount: number; hasMask: boolean; maskPreviewUrl: string }
}): { adjustHeight: () => void } {
  const { textareaRef, imagesRef, deps } = args
  const prevHeightRef = useRef(42)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    const imagesHeight = imagesRef.current?.offsetHeight ?? 0
    const fixedOverhead = imagesHeight + 140
    const maxH = Math.max(window.innerHeight * 0.4 - fixedOverhead, 80)

    el.style.transition = 'none'
    el.style.height = '0'
    el.style.overflowY = 'hidden'
    const scrollH = el.scrollHeight
    const minH = 42
    const desired = Math.max(scrollH, minH)
    const targetH = desired > maxH ? maxH : desired

    el.style.height = prevHeightRef.current + 'px'
    void el.offsetHeight

    el.style.transition = 'height 150ms ease, border-color 200ms, box-shadow 200ms'
    el.style.height = targetH + 'px'
    el.style.overflowY = desired > maxH ? 'auto' : 'hidden'

    prevHeightRef.current = targetH
  }, [textareaRef, imagesRef])

  useEffect(() => {
    adjustHeight()
  }, [deps.prompt, adjustHeight])

  useEffect(() => {
    adjustHeight()
  }, [deps.imageCount, deps.hasMask, deps.maskPreviewUrl, adjustHeight])

  useEffect(() => {
    window.addEventListener('resize', adjustHeight)
    return () => window.removeEventListener('resize', adjustHeight)
  }, [adjustHeight])

  return { adjustHeight }
}
