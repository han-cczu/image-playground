import { useEffect, useState } from 'react'
import { useStore, getCachedImage, ensureImageCached } from '../../../store'
import { createMaskPreviewDataUrl } from '../../../lib/image/canvasImage'

/**
 * 图片与遮罩资源加载:cache-first 取大图;遮罩优先取编辑中的草稿,
 * 否则回退到任务关联的遮罩图;两者就绪后合成遮罩预览 dataURL。
 */
export function useLightboxImage(lightboxImageId: string | null) {
  const maskDraft = useStore((s) => s.maskDraft)
  const tasks = useStore((s) => s.tasks)

  const [src, setSrc] = useState('')
  const [maskImageSrc, setMaskImageSrc] = useState('')
  const [maskPreviewSrc, setMaskPreviewSrc] = useState('')

  // 图片加载
  useEffect(() => {
    if (!lightboxImageId) {
      setSrc('')
      return
    }
    const cached = getCachedImage(lightboxImageId)
    if (cached) {
      setSrc(cached)
    } else {
      ensureImageCached(lightboxImageId).then((url) => {
        if (url) setSrc(url)
      })
    }
  }, [lightboxImageId])

  // 遮罩图加载
  useEffect(() => {
    if (!lightboxImageId) {
      setMaskImageSrc('')
      return
    }

    if (maskDraft?.targetImageId === lightboxImageId) {
      setMaskImageSrc(maskDraft.maskDataUrl)
      return
    }

    const taskWithMask = tasks.find((t) => t.maskTargetImageId === lightboxImageId && t.maskImageId)
    if (taskWithMask?.maskImageId) {
      const cached = getCachedImage(taskWithMask.maskImageId)
      if (cached) {
        setMaskImageSrc(cached)
      } else {
        ensureImageCached(taskWithMask.maskImageId).then((url) => {
          if (url) setMaskImageSrc(url)
        })
      }
    } else {
      setMaskImageSrc('')
    }
  }, [lightboxImageId, maskDraft?.targetImageId, maskDraft?.maskDataUrl, tasks])

  // 生成遮罩预览
  useEffect(() => {
    let cancelled = false
    if (!src || !maskImageSrc) {
      setMaskPreviewSrc('')
      return
    }

    createMaskPreviewDataUrl(src, maskImageSrc)
      .then((url) => {
        if (!cancelled) setMaskPreviewSrc(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewSrc('')
      })

    return () => {
      cancelled = true
    }
  }, [src, maskImageSrc])

  return { src, maskPreviewSrc }
}
