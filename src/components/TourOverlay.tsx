import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useIsMobile } from '../hooks/useIsMobile'
import { buildTourSteps } from '../lib/tour/steps'
import {
  computeBubblePlacement,
  resolveAnchor,
  resolveStepFallback,
  type AnchorRect,
} from '../lib/tour/anchor'

/** 锚点矩形外扩(px),镂空框与元素留呼吸感 */
const SPOTLIGHT_PADDING = 8
/** onEnter 副作用触发异步渲染(折叠面板展开动画)后,rAF 轮询锚点的最长等待 */
const ANCHOR_POLL_TIMEOUT_MS = 600

/**
 * 新手引导聚光灯导览:半透明遮罩 + box-shadow 镂空高亮 + 步骤气泡。
 * 完全只读——全屏捕获层吞掉一切指针事件(若允许穿透,点 needsConfig 发送钮会让
 * SettingsModal(z-70)开在本遮罩(z-130)之下并陷入不可见的 focus-trap)。
 * 外层只做开关:关闭即卸载内层,重开自带全新解析状态。
 */
export default function TourOverlay() {
  const tourActive = useStore((s) => s.tourActive)
  if (!tourActive) return null
  return <TourPanel />
}

function TourPanel() {
  const tourStep = useStore((s) => s.tourStep)
  const setTourStep = useStore((s) => s.setTourStep)
  const setTourActive = useStore((s) => s.setTourActive)
  const setHasSeenTour = useStore((s) => s.setHasSeenTour)
  const setMobileInputCollapsed = useStore((s) => s.setMobileInputCollapsed)
  // 文案口径 = 高亮按钮的真实状态:SubmitButton 的 needsConfig 判 !settings.apiKey(顶层只镜像
  // active profile)。不用 profiles.some——key 只在非激活 profile 时按钮仍是灰色,some 口径会让
  // 文案说「已配置」而按钮实际灰着(profiles.some 仅用于老用户豁免,见 autoStart.ts)
  const hasApiKey = useStore((s) => Boolean(s.settings.apiKey.trim()))
  const isMobile = useIsMobile()

  const steps = useMemo(
    () => buildTourSteps({ isMobile, hasApiKey }),
    [isMobile, hasApiKey],
  )
  // isMobile 中途变化会让 steps 变短:下标 clamp 防越界
  const stepIndex = Math.min(tourStep, steps.length - 1)
  const step = steps[stepIndex]

  /** 当前步锚点解析结果(仅锚点步写入);无锚点步渲染期派生 null,不写状态 */
  const [rect, setRect] = useState<AnchorRect | null>(null)
  /**
   * 渲染用矩形:无锚点步恒 null。锚点步→锚点步切换时,解析完成前沿用上一步 rect,
   * 镂空 div 持续挂载、CSS transition 平滑飞向新锚点;无锚点步→锚点步则是新挂载,
   * 无过渡起点,首帧直接定位(可接受:前者才是高频路径)。
   */
  const activeRect = step?.anchor ? rect : null

  const bubbleRef = useRef<HTMLDivElement>(null)
  const nextBtnRef = useRef<HTMLButtonElement>(null)
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number } | null>(null)

  // 镂空框平滑移动的 transition 写在 inline style,index.css 的
  // @media (prefers-reduced-motion) class 列表约束不到它,必须 JS 显式判定
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const close = () => {
    setTourActive(false)
    // 无条件置已看:自动触发时(hasSeenTour 必为 false)完成首跑标记;
    // 重看路径它已是 true,重写幂等——无需区分入口
    setHasSeenTour(true)
  }
  const next = () => {
    if (stepIndex < steps.length - 1) setTourStep(stepIndex + 1)
    else close()
  }
  const back = () => setTourStep(Math.max(0, stepIndex - 1))

  // 进入步骤:执行 onEnter 副作用 → rAF 轮询锚点(等待展开动画/异步渲染)→ 超时按声明降级。
  // 首次解析同样走 rAF:setState 全部发生在帧回调内;等待帧里 activeRect 沿用上一步
  // rect,CSS transition 让镂空框平滑飞向新锚点
  useEffect(() => {
    if (!step?.anchor) {
      step?.onEnter?.({ setMobileInputCollapsed })
      return
    }
    step.onEnter?.({ setMobileInputCollapsed })
    let raf = 0
    const deadline = performance.now() + ANCHOR_POLL_TIMEOUT_MS
    const tryResolve = () => {
      const found = resolveAnchor(step.anchor!)
      if (found) {
        setRect(found)
        return
      }
      if (performance.now() < deadline) {
        raf = requestAnimationFrame(tryResolve)
        return
      }
      const resolution = resolveStepFallback(step, null)
      if (resolution.action === 'skip') {
        // 进阶/可选步锚点缺失:自动跳过(末步 fallback 均为 center,不会越界)
        if (stepIndex < steps.length - 1) setTourStep(stepIndex + 1)
        else close()
      } else {
        setRect(null)
      }
    }
    raf = requestAnimationFrame(tryResolve)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stepIndex])

  // 跟随:resize / 滚动(capture,捕获 main 内滚)/ 布局变化时重算锚点(rAF 节流)
  useEffect(() => {
    if (!step?.anchor) return
    let raf = 0
    const recompute = () => {
      raf = 0
      // null 防护:锚点瞬态零尺寸(布局动画中间帧)时保留上一矩形,不把刚解析好的
      // 聚光灯清成居中态——轮询 effect 只挂 [step, stepIndex],清掉后没人恢复
      const found = resolveAnchor(step.anchor!)
      if (found) setRect(found)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(recompute)
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(document.body)
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      ro?.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [step])

  // 气泡定位:渲染后量实际尺寸再放置(useLayoutEffect 在 paint 前完成,无闪烁)
  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!bubble) return
    const size = { width: bubble.offsetWidth, height: bubble.offsetHeight }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const spotRect = activeRect
      ? {
          top: activeRect.top - SPOTLIGHT_PADDING,
          left: activeRect.left - SPOTLIGHT_PADDING,
          width: activeRect.width + SPOTLIGHT_PADDING * 2,
          height: activeRect.height + SPOTLIGHT_PADDING * 2,
        }
      : null
    const placement = computeBubblePlacement(spotRect, size, viewport)
    setBubblePos({ top: placement.top, left: placement.left })
  }, [activeRect, stepIndex])

  // Esc=跳过(走全局栈,自带 IME 守卫);锁背景滚动;焦点困在气泡内
  useCloseOnEscape(true, close)
  useLockBodyScroll(true)
  useFocusTrap(true, bubbleRef)

  // 每步切换把焦点拉回「下一步」(useFocusTrap 仅在 active 变化时移焦,步进不重触发)
  useEffect(() => {
    nextBtnRef.current?.focus()
  }, [stepIndex])

  if (!step) return null
  const isLast = stepIndex === steps.length - 1

  return (
    // 捕获层:全屏吞指针事件(只读导览),遮罩视觉由镂空框的 box-shadow 或自身背景提供
    <div className="fixed inset-0 z-[130]" data-no-drag-select>
      {activeRect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl"
          style={{
            top: activeRect.top - SPOTLIGHT_PADDING,
            left: activeRect.left - SPOTLIGHT_PADDING,
            width: activeRect.width + SPOTLIGHT_PADDING * 2,
            height: activeRect.height + SPOTLIGHT_PADDING * 2,
            // 99999px:8K 超宽屏 + 锚点贴边时 9999px 可能盖不满远端;遮罩 0.65 保证暗色主题
            // (近黑背景)下仍可辨,聚光语义主要靠蓝色光晕环承担
            boxShadow:
              '0 0 0 99999px rgba(0,0,0,0.65), 0 0 0 2px rgba(59,130,246,0.6), 0 0 28px rgba(59,130,246,0.4)',
            transition: reducedMotion
              ? 'none'
              : 'top 0.3s cubic-bezier(0.16,1,0.3,1), left 0.3s cubic-bezier(0.16,1,0.3,1), width 0.3s cubic-bezier(0.16,1,0.3,1), height 0.3s cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/65 animate-overlay-in" />
      )}

      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        tabIndex={-1}
        className="fixed w-[320px] max-w-[calc(100vw-24px)] rounded-2xl border border-white/50 bg-white/95 p-4 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl outline-none animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        style={bubblePos ? { top: bubblePos.top, left: bubblePos.left } : { visibility: 'hidden' }}
      >
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{step.title}</div>
        <div className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {step.body}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
          >
            跳过
          </button>
          <div className="flex items-center gap-1.5">
            <span className="px-1 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
              {stepIndex + 1}/{steps.length}
            </span>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={back}
                className="rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
              >
                上一步
              </button>
            )}
            <button
              ref={nextBtnRef}
              type="button"
              onClick={next}
              className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
            >
              {isLast ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
