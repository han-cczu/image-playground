import { useCallback, useEffect } from 'react'
import { useStore } from '../../../store'

/**
 * 列表导航:currentIndex/goTo/goPrev/goNext(取模环绕)+ 键盘左右方向键切换。
 * 键盘监听挂 window,仅在 Lightbox 打开且多图时注册。
 */
export function useLightboxNavigation(lightboxImageId: string | null) {
  const lightboxImageList = useStore((s) => s.lightboxImageList)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)

  // 导航
  const currentIndex = lightboxImageId ? lightboxImageList.indexOf(lightboxImageId) : -1
  const total = lightboxImageList.length
  const showNav = total > 1

  const goTo = useCallback((idx: number) => {
    if (lightboxImageList.length === 0) return
    const wrapped = ((idx % lightboxImageList.length) + lightboxImageList.length) % lightboxImageList.length
    setLightboxImageId(lightboxImageList[wrapped], lightboxImageList)
  }, [lightboxImageList, setLightboxImageId])

  const goPrev = useCallback(() => { if (showNav) goTo(currentIndex - 1) }, [showNav, currentIndex, goTo])
  const goNext = useCallback(() => { if (showNav) goTo(currentIndex + 1) }, [showNav, currentIndex, goTo])

  // 键盘左右切换
  useEffect(() => {
    if (!lightboxImageId || !showNav) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxImageId, showNav, goPrev, goNext])

  return { currentIndex, total, showNav, goPrev, goNext }
}
