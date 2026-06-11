import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { clamp, MIN_SCALE, MAX_SCALE, WHEEL_ZOOM_FACTOR, ZOOM_BADGE_HIDE_MS } from '../constants'

/**
 * 缩放核心:scale/tx/ty 全部走 ref(手势 handler 高频读写,避免闭包过期),
 * apply 统一做边界 clamp、维护缩放徽标计时并触发渲染;滚轮缩放监听挂容器节点
 * (passive: false,需 preventDefault 阻止页面滚动)。
 */
export function useLightboxZoom(containerRef: RefObject<HTMLDivElement | null>, src: string) {
  // 用 ref 追踪最新变换，避免闭包过期
  const scaleRef = useRef(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)

  // 仅用于触发渲染
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender((n) => n + 1), [])

  // 缩放倍率显示：2s 无操作后自动隐藏
  const [showZoomBadge, setShowZoomBadge] = useState(false)
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 切换图片时重置缩放
  useEffect(() => {
    scaleRef.current = 1
    txRef.current = 0
    tyRef.current = 0
    rerender()
  }, [src, rerender])

  const apply = useCallback((s: number, tx: number, ty: number) => {
    const ns = clamp(s, MIN_SCALE, MAX_SCALE)
    scaleRef.current = ns
    txRef.current = ns <= 1 ? 0 : tx
    tyRef.current = ns <= 1 ? 0 : ty

    // 显示缩放倍率并重置自动隐藏计时器
    if (ns > 1) {
      setShowZoomBadge(true)
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = setTimeout(() => setShowZoomBadge(false), ZOOM_BADGE_HIDE_MS)
    } else {
      setShowZoomBadge(false)
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
    }

    rerender()
  }, [rerender])

  // ====== 滚轮缩放 ======
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = scaleRef.current
      const tx = txRef.current
      const ty = tyRef.current
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2

      const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR
      const ns = clamp(s * factor, MIN_SCALE, MAX_SCALE)
      const r = ns / s
      apply(ns, mx - r * (mx - tx), my - r * (my - ty))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [apply, containerRef])

  return { scaleRef, txRef, tyRef, apply, showZoomBadge }
}
