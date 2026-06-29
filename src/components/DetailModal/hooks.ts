/**
 * DetailModal 专用 hooks:图片资源加载、遮罩预览生成、运行计时。
 * 行为与拆分前的组件内 effect 完全一致,仅做了归位。
 */

import { useEffect, useMemo, useState } from 'react'
import { getCachedImage, ensureImageCached } from '../../store'
import { formatImageRatio } from '../../lib/image/size'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import type { TaskRecord, TaskStatus } from '../../types'

interface KeyedImageSrcs {
  key: string
  value: Record<string, string>
}

interface KeyedImageMeta {
  key: string
  ratio: string
  size: string
}

interface KeyedMaskPreview {
  key: string
  value: string
}

/**
 * 任务相关图片的 cache-first 加载(输出图/输入图/遮罩图),
 * 以及当前输出图的宽高比与像素尺寸检测。
 */
export function useDetailImages(task: TaskRecord | null, currentOutputImageId: string) {
  const imageIds = useMemo(
    () =>
      task
        ? [
            ...new Set([
              ...(task.outputImages || []),
              ...(task.inputImageIds || []),
              ...(task.maskImageId ? [task.maskImageId] : []),
            ]),
          ]
        : [],
    [task],
  )
  const imageSrcsKey = useMemo(() => imageIds.join('|'), [imageIds])
  const [imageSrcsState, setImageSrcsState] = useState<KeyedImageSrcs>(() => ({
    key: imageSrcsKey,
    value: getInitialImageSrcs(imageIds),
  }))
  const [imageMeta, setImageMeta] = useState<Record<string, KeyedImageMeta>>({})

  // 加载所有相关图片
  useEffect(() => {
    let cancelled = false
    const initial = getInitialImageSrcs(imageIds)
    const commitInitial = () => {
      if (!cancelled) setImageSrcsState({ key: imageSrcsKey, value: initial })
    }
    queueMicrotask(commitInitial)

    for (const id of imageIds) {
      if (initial[id]) continue
      ensureImageCached(id)
        .then((url) => {
          if (!cancelled && url) {
            setImageSrcsState((prev) =>
              prev.key === imageSrcsKey
                ? { key: imageSrcsKey, value: { ...prev.value, [id]: url } }
                : prev,
            )
          }
        })
        .catch(() => {
          /* Missing/corrupt images remain unloaded in the detail view. */
        })
    }

    return () => {
      cancelled = true
    }
  }, [imageIds, imageSrcsKey])

  const imageSrcs =
    imageSrcsState.key === imageSrcsKey ? imageSrcsState.value : getInitialImageSrcs(imageIds)

  const currentOutputImageSrc = currentOutputImageId ? imageSrcs[currentOutputImageId] || '' : ''

  useEffect(() => {
    if (!currentOutputImageId || !currentOutputImageSrc) return

    let cancelled = false
    const image = new Image()
    const commitMeta = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setImageMeta((prev) => ({
          ...prev,
          [currentOutputImageId]: {
            key: currentOutputImageSrc,
            ratio: formatImageRatio(image.naturalWidth, image.naturalHeight),
            size: `${image.naturalWidth}×${image.naturalHeight}`,
          },
        }))
      }
    }
    image.onload = commitMeta
    image.src = currentOutputImageSrc
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      queueMicrotask(commitMeta)
    }

    return () => {
      cancelled = true
    }
  }, [currentOutputImageId, currentOutputImageSrc])

  const currentMeta = currentOutputImageId ? imageMeta[currentOutputImageId] : undefined
  const imageRatios =
    currentMeta?.key === currentOutputImageSrc ? { [currentOutputImageId]: currentMeta.ratio } : {}
  const imageSizes =
    currentMeta?.key === currentOutputImageSrc ? { [currentOutputImageId]: currentMeta.size } : {}

  return { imageSrcs, imageRatios, imageSizes }
}

/** 遮罩预览:把遮罩叠加到目标图上生成 dataURL,任一来源缺失则清空 */
export function useMaskPreview(maskTargetSrc: string, maskSrc: string): string {
  const key = maskTargetSrc && maskSrc ? `${maskTargetSrc}\n${maskSrc}` : ''
  const [preview, setPreview] = useState<KeyedMaskPreview>({ key: '', value: '' })

  useEffect(() => {
    let cancelled = false
    if (!key) return

    createMaskPreviewDataUrl(maskTargetSrc, maskSrc)
      .then((url) => {
        if (!cancelled) setPreview({ key, value: url })
      })
      .catch(() => {
        if (!cancelled) setPreview({ key, value: '' })
      })

    return () => {
      cancelled = true
      setPreview((current) => (current.key === key ? { key: '', value: '' } : current))
    }
  }, [key, maskTargetSrc, maskSrc])

  return preview.key === key ? preview.value : ''
}

function getInitialImageSrcs(ids: string[]): Record<string, string> {
  const initial: Record<string, string> = {}
  for (const id of ids) {
    const cached = getCachedImage(id)
    if (cached) initial[id] = cached
  }
  return initial
}

/** 运行计时:running 态每秒刷新 now,供耗时文案实时走表 */
export function useRunningNow(status: TaskStatus | undefined): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [status])

  return now
}
