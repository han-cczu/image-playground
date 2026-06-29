import { useEffect, useState } from 'react'
import { formatImageRatio } from '../../lib/image/size'

interface CoverMeta {
  key: string
  ratio: string
  size: string
}

/**
 * 封面元信息检测:thumbSrc 加载完成后读出比例(coverRatio)与分辨率(coverSize)。
 * outputImages 引用变化时复位,避免新旧封面间残留过期标签。
 */
export function useCoverMeta(thumbSrc: string, outputImages: string[] | undefined) {
  const coverKey = `${outputImages?.[0] ?? ''}:${thumbSrc}`
  const [coverMeta, setCoverMeta] = useState<CoverMeta>({ key: '', ratio: '', size: '' })

  useEffect(() => {
    if (!thumbSrc) return

    let cancelled = false
    const image = new Image()
    const commitMeta = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setCoverMeta({
          key: coverKey,
          ratio: formatImageRatio(image.naturalWidth, image.naturalHeight),
          size: `${image.naturalWidth}×${image.naturalHeight}`,
        })
      }
    }
    image.onload = commitMeta
    image.src = thumbSrc
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      queueMicrotask(commitMeta)
    }

    return () => {
      cancelled = true
    }
  }, [coverKey, thumbSrc])

  return {
    coverRatio: coverMeta.key === coverKey ? coverMeta.ratio : '',
    coverSize: coverMeta.key === coverKey ? coverMeta.size : '',
  }
}
