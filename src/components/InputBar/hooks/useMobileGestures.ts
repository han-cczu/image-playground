import { useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import { useStore } from '../../../store'

export function useMobileGestures(): {
  mobileCollapsed: boolean
  setMobileCollapsed: Dispatch<SetStateAction<boolean>>
  dragHandleRef: React.RefObject<HTMLDivElement | null>
} {
  // 折叠态存 ui slice(瞬态):新手引导的「进阶 pill」步需要在组件外驱动展开
  const mobileCollapsed = useStore((s) => s.mobileInputCollapsed)
  const setMobileCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>((action) => {
    const state = useStore.getState()
    state.setMobileInputCollapsed(
      typeof action === 'function' ? action(state.mobileInputCollapsed) : action,
    )
  }, [])
  const dragHandleRef = useRef<HTMLDivElement>(null)
  const dragTouchRef = useRef({ startY: 0, moved: false })

  // 移动端拖动条手势
  useEffect(() => {
    const el = dragHandleRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      dragTouchRef.current = { startY: e.touches[0].clientY, moved: false }
    }
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - dragTouchRef.current.startY
      if (Math.abs(dy) > 10) dragTouchRef.current.moved = true
      if (dy > 30) setMobileCollapsed(true)
      if (dy < -30) setMobileCollapsed(false)
    }
    const onTouchEnd = () => {
      if (!dragTouchRef.current.moved) {
        setMobileCollapsed((v) => !v)
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [setMobileCollapsed])

  return { mobileCollapsed, setMobileCollapsed, dragHandleRef }
}
