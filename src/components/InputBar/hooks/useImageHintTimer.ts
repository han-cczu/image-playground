import { useState, useRef, useEffect } from 'react'

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
