import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  clamp,
  MIN_SCALE,
  MAX_SCALE,
  DOUBLE_TAP_SCALE,
  DOUBLE_TAP_INTERVAL_MS,
  DOUBLE_TAP_SLOP_PX,
  TAP_CLOSE_DELAY_MS,
  DRAG_THRESHOLD_PX,
} from '../constants'

interface UseLightboxPointerArgs {
  containerRef: RefObject<HTMLDivElement | null>
  scaleRef: RefObject<number>
  txRef: RefObject<number>
  tyRef: RefObject<number>
  apply: (s: number, tx: number, ty: number) => void
  onClose: () => void
}

/**
 * 指针手势:鼠标拖拽、双指 pinch、单击/双击判定,以及 didDrag/suppressNextClick
 * 抑制逻辑。scale/tx/ty 只读不写(写统一经 apply 走 clamp)。
 * 监听注册位置保持原样:mousedown/touch* 挂容器节点(touch* passive: false),
 * mousemove/mouseup 挂 window(拖拽中移出容器不丢手势)。
 */
export function useLightboxPointer({
  containerRef,
  scaleRef,
  txRef,
  tyRef,
  apply,
  onClose,
}: UseLightboxPointerArgs) {
  const [isDragging, setIsDragging] = useState(false)

  // 拖拽状态
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    baseTx: 0,
    baseTy: 0,
  })

  // 双指缩放状态
  const pinchRef = useRef({
    active: false,
    startDist: 0,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    midX: 0,
    midY: 0,
  })

  // 双击检测（触控）
  const tapRef = useRef({ time: 0, x: 0, y: 0 })
  const tapCloseTimerRef = useRef<number | null>(null)
  const hadMultiTouchRef = useRef(false)
  const touchStartedOnImageRef = useRef(false)

  // 判断本次 mousedown → mouseup 是否发生了拖拽，用于区分点击和拖拽
  const didDragRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  /**
   * 触屏单指轻点结束后浏览器会补发一次兼容 click:若放行,onClick 会立刻 onClose,
   * 下方为双击检测预留的 TAP_CLOSE_DELAY_MS 延迟关闭形同虚设、1x 下双击放大永远触发不了。
   * 用定时器兜底复位:轻点没有后续兼容 click(如手指移动过)时标志不能残留去吞掉下一次真实鼠标点击。
   */
  const compatClickResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const suppressClick = () => {
      suppressNextClickRef.current = true
    }

    window.addEventListener('image-context-menu-dismiss-lightbox-click', suppressClick)
    return () =>
      window.removeEventListener('image-context-menu-dismiss-lightbox-click', suppressClick)
  }, [])

  const getCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { cx: 0, cy: 0 }
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  }, [containerRef])

  // ====== 鼠标拖拽 + 点击关闭 ======
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      didDragRef.current = false
      if (scaleRef.current <= 1) return
      e.preventDefault()
      dragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        baseTx: txRef.current,
        baseTy: tyRef.current,
      }
      setIsDragging(true)
    }

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d.active) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)
        didDragRef.current = true
      apply(scaleRef.current, d.baseTx + dx, d.baseTy + dy)
    }

    const onUp = () => {
      dragRef.current.active = false
      setIsDragging(pinchRef.current.active)
    }

    const onBlur = () => {
      dragRef.current.active = false
      setIsDragging(pinchRef.current.active)
    }

    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [apply, containerRef, scaleRef, txRef, tyRef])

  // ====== 单击关闭（仅未缩放且非拖拽） ======
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        e.stopPropagation()
        return
      }
      if (didDragRef.current) return
      if (scaleRef.current > 1 && e.target instanceof HTMLImageElement) return
      onClose()
    },
    [onClose, scaleRef],
  )

  // ====== 鼠标双击缩放 ======
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (scaleRef.current > 1) {
        apply(1, 0, 0)
      } else {
        const { cx, cy } = getCenter()
        const mx = e.clientX - cx
        const my = e.clientY - cy
        apply(DOUBLE_TAP_SCALE, -mx * (DOUBLE_TAP_SCALE - 1), -my * (DOUBLE_TAP_SCALE - 1))
      }
    },
    [apply, getCenter, scaleRef],
  )

  // ====== 触控事件 ======
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const clearTapCloseTimer = () => {
      if (tapCloseTimerRef.current != null) {
        window.clearTimeout(tapCloseTimerRef.current)
        tapCloseTimerRef.current = null
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        clearTapCloseTimer()
        hadMultiTouchRef.current = true
        tapRef.current = { time: 0, x: 0, y: 0 }
        const [a, b] = [e.touches[0], e.touches[1]]
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const { cx, cy } = getCenter()
        pinchRef.current = {
          active: true,
          startDist: dist,
          startScale: scaleRef.current,
          startTx: txRef.current,
          startTy: tyRef.current,
          midX: (a.clientX + b.clientX) / 2 - cx,
          midY: (a.clientY + b.clientY) / 2 - cy,
        }
        dragRef.current.active = false
        setIsDragging(true)
      } else if (e.touches.length === 1) {
        const t = e.touches[0]
        const now = Date.now()
        const prev = tapRef.current
        touchStartedOnImageRef.current = e.target instanceof HTMLImageElement

        // 双击检测
        if (
          now - prev.time < DOUBLE_TAP_INTERVAL_MS &&
          Math.abs(t.clientX - prev.x) < DOUBLE_TAP_SLOP_PX &&
          Math.abs(t.clientY - prev.y) < DOUBLE_TAP_SLOP_PX
        ) {
          e.preventDefault()
          clearTapCloseTimer()
          if (scaleRef.current > 1) {
            apply(1, 0, 0)
          } else {
            const { cx, cy } = getCenter()
            const mx = t.clientX - cx
            const my = t.clientY - cy
            apply(DOUBLE_TAP_SCALE, -mx * (DOUBLE_TAP_SCALE - 1), -my * (DOUBLE_TAP_SCALE - 1))
          }
          tapRef.current = { time: 0, x: 0, y: 0 }
          return
        }
        tapRef.current = { time: now, x: t.clientX, y: t.clientY }

        if (scaleRef.current > 1 && touchStartedOnImageRef.current) {
          e.preventDefault()
          dragRef.current = {
            active: true,
            startX: t.clientX,
            startY: t.clientY,
            baseTx: txRef.current,
            baseTy: tyRef.current,
          }
          setIsDragging(true)
        }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (pinchRef.current.active && e.touches.length === 2) {
        e.preventDefault()
        const [a, b] = [e.touches[0], e.touches[1]]
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const p = pinchRef.current
        const ns = clamp(p.startScale * (dist / p.startDist), MIN_SCALE, MAX_SCALE)
        const r = ns / p.startScale
        apply(ns, p.midX - r * (p.midX - p.startTx), p.midY - r * (p.midY - p.startTy))
      } else if (dragRef.current.active && e.touches.length === 1) {
        e.preventDefault()
        const t = e.touches[0]
        const d = dragRef.current
        apply(scaleRef.current, d.baseTx + t.clientX - d.startX, d.baseTy + t.clientY - d.startY)
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current.active = false
      if (e.touches.length === 0) {
        dragRef.current.active = false
        setIsDragging(false)
        if (hadMultiTouchRef.current) {
          hadMultiTouchRef.current = false
          tapRef.current = { time: 0, x: 0, y: 0 }
          return
        }
        // 单击关闭：未缩放时任意位置关闭；缩放时仅点击图片外关闭。
        if (scaleRef.current <= 1 || !touchStartedOnImageRef.current) {
          const prev = tapRef.current
          if (prev.time > 0 && Date.now() - prev.time < DOUBLE_TAP_INTERVAL_MS) {
            // 吞掉这次轻点补发的兼容 click,关闭只能走下面的延迟定时器(给双击留出判定窗口)
            suppressNextClickRef.current = true
            if (compatClickResetTimerRef.current != null) {
              window.clearTimeout(compatClickResetTimerRef.current)
            }
            compatClickResetTimerRef.current = window.setTimeout(() => {
              compatClickResetTimerRef.current = null
              suppressNextClickRef.current = false
            }, TAP_CLOSE_DELAY_MS)
            clearTapCloseTimer()
            tapCloseTimerRef.current = window.setTimeout(() => {
              tapCloseTimerRef.current = null
              if (tapRef.current.time === prev.time) {
                onClose()
              }
            }, TAP_CLOSE_DELAY_MS)
          }
        }
      } else {
        setIsDragging(dragRef.current.active || pinchRef.current.active)
      }
    }

    const onTouchCancel = () => {
      pinchRef.current.active = false
      dragRef.current.active = false
      hadMultiTouchRef.current = false
      tapRef.current = { time: 0, x: 0, y: 0 }
      clearTapCloseTimer()
      setIsDragging(false)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchCancel)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
      clearTapCloseTimer()
      if (compatClickResetTimerRef.current != null) {
        window.clearTimeout(compatClickResetTimerRef.current)
        compatClickResetTimerRef.current = null
      }
    }
  }, [apply, getCenter, onClose, containerRef, scaleRef, txRef, tyRef])

  return { onClick, onDoubleClick, isDragging }
}
