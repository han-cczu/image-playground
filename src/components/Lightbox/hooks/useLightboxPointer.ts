import { useCallback, useEffect, useRef, type RefObject } from 'react'
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
export function useLightboxPointer({ containerRef, scaleRef, txRef, tyRef, apply, onClose }: UseLightboxPointerArgs) {
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
  const hadMultiTouchRef = useRef(false)
  const touchStartedOnImageRef = useRef(false)

  // 判断本次 mousedown → mouseup 是否发生了拖拽，用于区分点击和拖拽
  const didDragRef = useRef(false)
  const suppressNextClickRef = useRef(false)

  useEffect(() => {
    const suppressClick = () => {
      suppressNextClickRef.current = true
    }

    window.addEventListener('image-context-menu-dismiss-lightbox-click', suppressClick)
    return () => window.removeEventListener('image-context-menu-dismiss-lightbox-click', suppressClick)
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
    }

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d.active) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) didDragRef.current = true
      apply(scaleRef.current, d.baseTx + dx, d.baseTy + dy)
    }

    const onUp = () => {
      dragRef.current.active = false
    }

    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [apply, containerRef, scaleRef, txRef, tyRef])

  // ====== 单击关闭（仅未缩放且非拖拽） ======
  const onClick = useCallback((e: React.MouseEvent) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      e.stopPropagation()
      return
    }
    if (didDragRef.current) return
    if (scaleRef.current > 1 && e.target instanceof HTMLImageElement) return
    onClose()
  }, [onClose, scaleRef])

  // ====== 鼠标双击缩放 ======
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (scaleRef.current > 1) {
      apply(1, 0, 0)
    } else {
      const { cx, cy } = getCenter()
      const mx = e.clientX - cx
      const my = e.clientY - cy
      apply(DOUBLE_TAP_SCALE, -mx * (DOUBLE_TAP_SCALE - 1), -my * (DOUBLE_TAP_SCALE - 1))
    }
  }, [apply, getCenter, scaleRef])

  // ====== 触控事件 ======
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault()
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
        if (hadMultiTouchRef.current) {
          hadMultiTouchRef.current = false
          tapRef.current = { time: 0, x: 0, y: 0 }
          return
        }
        // 单击关闭：未缩放时任意位置关闭；缩放时仅点击图片外关闭。
        if (scaleRef.current <= 1 || !touchStartedOnImageRef.current) {
          const prev = tapRef.current
          if (prev.time > 0 && Date.now() - prev.time < DOUBLE_TAP_INTERVAL_MS) {
            setTimeout(() => {
              if (tapRef.current.time === prev.time) {
                onClose()
              }
            }, TAP_CLOSE_DELAY_MS)
          }
        }
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [apply, getCenter, onClose, containerRef, scaleRef, txRef, tyRef])

  // 渲染期读取拖拽/捏合状态(与原实现一致:仅 apply 触发的渲染会刷新该值)
  const isDragging = dragRef.current.active || pinchRef.current.active

  return { onClick, onDoubleClick, isDragging }
}
