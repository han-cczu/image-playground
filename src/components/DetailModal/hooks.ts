/**
 * DetailModal 专用 hooks:图片资源加载、遮罩预览生成、运行计时。
 * 行为与拆分前的组件内 effect 完全一致,仅做了归位。
 */

import { useEffect, useState } from 'react'
import { getCachedImage, ensureImageCached } from '../../store'
import { formatImageRatio } from '../../lib/image/size'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import type { TaskRecord, TaskStatus } from '../../types'

/**
 * 任务相关图片的 cache-first 加载(输出图/输入图/遮罩图),
 * 以及当前输出图的宽高比与像素尺寸检测。
 */
export function useDetailImages(task: TaskRecord | null, currentOutputImageId: string) {
  const [imageSrcs, setImageSrcs] = useState<Record<string, string>>({})
  const [imageRatios, setImageRatios] = useState<Record<string, string>>({})
  const [imageSizes, setImageSizes] = useState<Record<string, string>>({})

  // 加载所有相关图片
  useEffect(() => {
    if (!task) {
      setImageSrcs({})
      return
    }

    let cancelled = false
    const ids = [...new Set([
      ...(task.outputImages || []),
      ...(task.inputImageIds || []),
      ...(task.maskImageId ? [task.maskImageId] : []),
    ])]
    const initial: Record<string, string> = {}
    for (const id of ids) {
      const cached = getCachedImage(id)
      if (cached) initial[id] = cached
    }
    setImageSrcs(initial)
    for (const id of ids) {
      if (initial[id]) continue
      ensureImageCached(id).then((url) => {
        if (!cancelled && url) setImageSrcs((prev) => ({ ...prev, [id]: url }))
      })
    }

    return () => {
      cancelled = true
    }
  }, [task])

  const currentOutputImageSrc = currentOutputImageId ? imageSrcs[currentOutputImageId] || '' : ''

  useEffect(() => {
    if (!currentOutputImageId || !currentOutputImageSrc) return

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setImageRatios((prev) => ({
          ...prev,
          [currentOutputImageId]: formatImageRatio(image.naturalWidth, image.naturalHeight),
        }))
        setImageSizes((prev) => ({
          ...prev,
          [currentOutputImageId]: `${image.naturalWidth}×${image.naturalHeight}`,
        }))
      }
    }
    image.src = currentOutputImageSrc
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      setImageRatios((prev) => ({
        ...prev,
        [currentOutputImageId]: formatImageRatio(image.naturalWidth, image.naturalHeight),
      }))
      setImageSizes((prev) => ({
        ...prev,
        [currentOutputImageId]: `${image.naturalWidth}×${image.naturalHeight}`,
      }))
    }

    return () => {
      cancelled = true
    }
  }, [currentOutputImageId, currentOutputImageSrc])

  return { imageSrcs, imageRatios, imageSizes }
}

/** 遮罩预览:把遮罩叠加到目标图上生成 dataURL,任一来源缺失则清空 */
export function useMaskPreview(maskTargetSrc: string, maskSrc: string): string {
  const [maskPreviewSrc, setMaskPreviewSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    setMaskPreviewSrc('')
    if (!maskTargetSrc || !maskSrc) return

    createMaskPreviewDataUrl(maskTargetSrc, maskSrc)
      .then((url) => {
        if (!cancelled) setMaskPreviewSrc(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewSrc('')
      })

    return () => {
      cancelled = true
    }
  }, [maskTargetSrc, maskSrc])

  return maskPreviewSrc
}

/** 运行计时:running 态每秒刷新 now,供耗时文案实时走表 */
export function useRunningNow(status: TaskStatus | undefined): number {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => window.clearInterval(id)
  }, [status])

  return now
}
