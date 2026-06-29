import { useEffect, useState } from 'react'
import { useStore, getCachedImage, ensureImageCached } from '../../../store'
import { createMaskPreviewDataUrl } from '../../../lib/image/canvasImage'

interface KeyedValue {
  key: string
  value: string
}

/**
 * 图片与遮罩资源加载:cache-first 取大图;遮罩优先取编辑中的草稿,
 * 否则回退到任务关联的遮罩图;两者就绪后合成遮罩预览 dataURL。
 */
export function useLightboxImage(lightboxImageId: string | null) {
  const maskDraft = useStore((s) => s.maskDraft)
  const tasks = useStore((s) => s.tasks)

  const [srcState, setSrcState] = useState<KeyedValue>(() => ({
    key: lightboxImageId ?? '',
    value: lightboxImageId ? (getCachedImage(lightboxImageId) ?? '') : '',
  }))
  const [maskImageState, setMaskImageState] = useState<KeyedValue>({ key: '', value: '' })
  const [maskPreviewState, setMaskPreviewState] = useState<KeyedValue>({ key: '', value: '' })

  // 当前图所属生成任务的提示词(仅供读屏命名;输入图/上传图找不到任务时为空串)
  const prompt = lightboxImageId
    ? (tasks.find((t) => t.outputImages?.includes(lightboxImageId))?.prompt.trim() ?? '')
    : ''

  const src = lightboxImageId
    ? srcState.key === lightboxImageId
      ? srcState.value
      : (getCachedImage(lightboxImageId) ?? '')
    : ''

  // 图片加载
  useEffect(() => {
    if (!lightboxImageId) return
    let cancelled = false
    const cached = getCachedImage(lightboxImageId)
    if (cached) {
      queueMicrotask(() => {
        if (!cancelled) setSrcState({ key: lightboxImageId, value: cached })
      })
    } else {
      ensureImageCached(lightboxImageId)
        .then((url) => {
          if (!cancelled && url) {
            setSrcState({ key: lightboxImageId, value: url })
          }
        })
        .catch(() => {
          /* Missing/corrupt images remain unloaded in lightbox. */
        })
    }
    return () => {
      cancelled = true
      setSrcState((current) =>
        current.key === lightboxImageId ? { key: '', value: '' } : current,
      )
    }
  }, [lightboxImageId])

  const maskKey = (() => {
    if (!lightboxImageId) return ''
    if (maskDraft?.targetImageId === lightboxImageId)
      return `${lightboxImageId}:draft:${maskDraft.maskDataUrl}`
    const taskWithMask = tasks.find((t) => t.maskTargetImageId === lightboxImageId && t.maskImageId)
    return taskWithMask?.maskImageId ? `${lightboxImageId}:task:${taskWithMask.maskImageId}` : ''
  })()
  const maskImageSrc = maskImageState.key === maskKey ? maskImageState.value : ''

  // 遮罩图加载
  useEffect(() => {
    if (!lightboxImageId || !maskKey) return
    let cancelled = false

    if (maskDraft?.targetImageId === lightboxImageId) {
      queueMicrotask(() => {
        if (!cancelled) setMaskImageState({ key: maskKey, value: maskDraft.maskDataUrl })
      })
      return () => {
        cancelled = true
        setMaskImageState((current) =>
          current.key === maskKey ? { key: '', value: '' } : current,
        )
      }
    }

    const taskWithMask = tasks.find((t) => t.maskTargetImageId === lightboxImageId && t.maskImageId)
    if (taskWithMask?.maskImageId) {
      const cached = getCachedImage(taskWithMask.maskImageId)
      if (cached) {
        queueMicrotask(() => {
          if (!cancelled) setMaskImageState({ key: maskKey, value: cached })
        })
      } else {
        ensureImageCached(taskWithMask.maskImageId)
          .then((url) => {
            if (!cancelled && url) {
              setMaskImageState({ key: maskKey, value: url })
            }
          })
          .catch(() => {
            /* Missing/corrupt masks simply disable the lightbox mask preview. */
          })
      }
    }
    return () => {
      cancelled = true
      setMaskImageState((current) =>
        current.key === maskKey ? { key: '', value: '' } : current,
      )
    }
  }, [lightboxImageId, maskDraft?.targetImageId, maskDraft?.maskDataUrl, maskKey, tasks])

  const maskPreviewKey = src && maskImageSrc ? `${src}\n${maskImageSrc}` : ''
  const maskPreviewSrc = maskPreviewState.key === maskPreviewKey ? maskPreviewState.value : ''

  // 生成遮罩预览
  useEffect(() => {
    let cancelled = false
    if (!maskPreviewKey) return

    createMaskPreviewDataUrl(src, maskImageSrc)
      .then((url) => {
        if (!cancelled) setMaskPreviewState({ key: maskPreviewKey, value: url })
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewState({ key: maskPreviewKey, value: '' })
      })

    return () => {
      cancelled = true
      setMaskPreviewState((current) =>
        current.key === maskPreviewKey ? { key: '', value: '' } : current,
      )
    }
  }, [maskImageSrc, maskPreviewKey, src])

  return { src, maskPreviewSrc, prompt }
}
