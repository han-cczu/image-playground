import { useEffect, useState } from 'react'
import { formatImageRatio } from '../../lib/image/size'

/**
 * 封面元信息检测:thumbSrc 加载完成后读出比例(coverRatio)与分辨率(coverSize)。
 * outputImages 引用变化时复位,避免新旧封面间残留过期标签。
 */
export function useCoverMeta(thumbSrc: string, outputImages: string[] | undefined) {
  const [coverRatio, setCoverRatio] = useState<string>('')
  const [coverSize, setCoverSize] = useState<string>('')

  // 输出图变化时复位封面元信息(thumbSrc 本身由 useLazyCoverImage 跟随 outputImages[0] 复位)
  useEffect(() => {
    setCoverRatio('')
    setCoverSize('')
  }, [outputImages])

  useEffect(() => {
    if (!thumbSrc) return

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setCoverRatio(formatImageRatio(image.naturalWidth, image.naturalHeight))
        setCoverSize(`${image.naturalWidth}×${image.naturalHeight}`)
      }
    }
    image.src = thumbSrc
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      setCoverRatio(formatImageRatio(image.naturalWidth, image.naturalHeight))
      setCoverSize(`${image.naturalWidth}×${image.naturalHeight}`)
    }

    return () => {
      cancelled = true
    }
  }, [thumbSrc])

  return { coverRatio, coverSize }
}
