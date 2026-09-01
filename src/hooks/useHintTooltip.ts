import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 轻量提示气泡(hint tooltip)的统一可见性状态机,配合 ViewportTooltip / ButtonTooltip 使用。
 *
 * 此前各处(SizePicker 规整提示 / ActualValueBadge / ParamRow 等)各自复制一份
 * 「hover 显示 + touchstart 450ms 长按显示」四件套,共同缺陷:触屏上打开后没有任何
 * 关闭路径——没有外点 dismiss、没有自动隐藏,只依赖触屏根本不会触发的 mouseleave,
 * 表现为气泡卡住不消失;而快速轻点(<450ms)又完全不显示。本 hook 收口全部路径:
 *
 * - 显示:鼠标悬停 / 键盘聚焦 / 触屏轻点(位移小于阈值)或按住 450ms
 * - 关闭:鼠标移出 / 失焦 / Esc / 任意外点(pointerdown) / 触屏显示后自动隐藏
 *
 * Esc 用普通监听且不 preventDefault,刻意不进 useCloseOnEscape 全局栈:提示是被动层,
 * 同一击 Esc「气泡消失 + 顶层弹窗关闭」符合直觉;入栈反而会吃掉弹窗本该收到的 Esc。
 *
 * 需要「点按固定 + aria-expanded」语义的说明浮层(toggletip)不要用本 hook,
 * 走 usePopoverDismiss(见 MaskInfoPopover)。
 */

const TOUCH_HOLD_SHOW_MS = 450
const TOUCH_AUTO_HIDE_MS = 2500
/** 轻点判定的位移容差:超过视为滚动手势,不显示(长按路径已显示的一并收起) */
const TAP_MOVE_TOLERANCE_PX = 10

export interface HintTooltipAnchorProps<T extends HTMLElement> {
  ref: React.RefObject<T | null>
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  onTouchCancel: () => void
}

export interface HintTooltip<T extends HTMLElement> {
  visible: boolean
  hide: () => void
  /** 整体 spread 到锚点元素上(含 ref;锚点不能再挂第二个 ref) */
  anchorProps: HintTooltipAnchorProps<T>
}

export function useHintTooltip<T extends HTMLElement = HTMLElement>(
  { enabled = true }: { enabled?: boolean } = {},
): HintTooltip<T> {
  const [visible, setVisible] = useState(false)
  const anchorRef = useRef<T | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const autoHideTimerRef = useRef<number | null>(null)
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current != null) {
      window.clearTimeout(autoHideTimerRef.current)
      autoHideTimerRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearHoldTimer()
    clearAutoHideTimer()
    touchStartPosRef.current = null
    setVisible(false)
  }, [clearAutoHideTimer, clearHoldTimer])

  /** 触屏路径的显示必须配自动隐藏:触屏没有 mouseleave,不定时收就只能等外点 */
  const showByTouch = useCallback(() => {
    clearAutoHideTimer()
    autoHideTimerRef.current = window.setTimeout(() => {
      autoHideTimerRef.current = null
      setVisible(false)
    }, TOUCH_AUTO_HIDE_MS)
    setVisible(true)
  }, [clearAutoHideTimer])

  // 条件提示的条件消失时(如格式切走后压缩率恢复可用)立即收起,避免残留过期解释。
  // render 阶段调整而非 effect(同 Select 的 disabled 收敛写法):禁用期间残留的定时器
  // 若仍把 visible 置回 true,这里也会在同一帧收敛回 false
  if (!enabled && visible) setVisible(false)

  // 可见期间挂全局关闭路径:外点(pointerdown,锚点自身除外——否则触屏上
  // 「pointerdown 先关、touchend 再开」会闪烁)与 Esc(不拦截、不进栈,见头注)
  useEffect(() => {
    if (!visible) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (target && anchorRef.current?.contains(target)) return
      hide()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return
      hide()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [visible, hide])

  useEffect(
    () => () => {
      clearHoldTimer()
      clearAutoHideTimer()
    },
    [clearAutoHideTimer, clearHoldTimer],
  )

  // 触屏轻点后浏览器会补发仿真 mouseenter/mouseleave:enter 与触屏显示同向(幂等),
  // leave 只在下一次点别处时补发、彼时外点路径已先行关闭,故 mouse 分支无需触屏防抖
  const onMouseEnter = () => {
    if (!enabled) return
    setVisible(true)
  }

  const onMouseLeave = () => hide()

  const onFocus = () => {
    if (!enabled) return
    setVisible(true)
  }

  const onBlur = () => hide()

  const onTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    touchStartPosRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
    if (!enabled) return
    clearHoldTimer()
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      showByTouch()
    }, TOUCH_HOLD_SHOW_MS)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const start = touchStartPosRef.current
    const touch = e.touches[0]
    if (!start || !touch) return
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_MOVE_TOLERANCE_PX) {
      // 滚动手势:取消长按待显,已显示的(慢滚时长按定时器先到)一并收起
      hide()
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    clearHoldTimer()
    const start = touchStartPosRef.current
    touchStartPosRef.current = null
    if (!enabled) return
    const touch = e.changedTouches[0]
    // 起点为空说明手势中途已被 touchmove 判定为滚动并收起,抬起时不能再显示
    if (!start || !touch) return
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_MOVE_TOLERANCE_PX) {
      hide()
      return
    }
    // 轻点与「长按显示后抬起」都走这里:重置自动隐藏计时,从抬起时刻重新计 2.5s
    showByTouch()
  }

  const onTouchCancel = () => hide()

  return {
    visible,
    hide,
    anchorProps: {
      ref: anchorRef,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
    },
  }
}
