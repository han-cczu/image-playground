/**
 * 新手引导:锚点解析 / 气泡放置 / 降级决策(纯逻辑,不碰 React)。
 * document 经参数注入,单测无需 jsdom 真实 DOM。
 */

export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/**
 * 按选择器解析锚点矩形。三种 null:选择器未命中 / 元素零尺寸(移动端折叠塌缩)/
 * 异步渲染未就绪(调用方负责 rAF 轮询重试)。
 */
export function resolveAnchor(
  selector: string,
  doc: Pick<Document, 'querySelector'> = document,
): AnchorRect | null {
  const el = doc.querySelector(selector)
  if (!el) return null
  const rect = (el as HTMLElement).getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export type BubbleSide = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface BubblePlacement {
  side: BubbleSide
  top: number
  left: number
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max))

/**
 * 气泡四向放置:优先锚点下方 → 上方 → 右侧 → 左侧,均不容纳则视口居中;
 * 最终位置 clamp 进视口(margin 内边距)。gap 为气泡与锚点间距。
 */
export function computeBubblePlacement(
  rect: AnchorRect | null,
  bubble: Size,
  viewport: Size,
  margin = 12,
  gap = 12,
): BubblePlacement {
  const center = (): BubblePlacement => ({
    side: 'center',
    top: Math.max(margin, (viewport.height - bubble.height) / 2),
    left: Math.max(margin, (viewport.width - bubble.width) / 2),
  })
  if (!rect) return center()

  const alignedLeft = clamp(
    rect.left + rect.width / 2 - bubble.width / 2,
    margin,
    viewport.width - bubble.width - margin,
  )
  const alignedTop = clamp(
    rect.top + rect.height / 2 - bubble.height / 2,
    margin,
    viewport.height - bubble.height - margin,
  )

  if (rect.top + rect.height + gap + bubble.height + margin <= viewport.height) {
    return { side: 'bottom', top: rect.top + rect.height + gap, left: alignedLeft }
  }
  if (rect.top - gap - bubble.height >= margin) {
    return { side: 'top', top: rect.top - gap - bubble.height, left: alignedLeft }
  }
  if (rect.left + rect.width + gap + bubble.width + margin <= viewport.width) {
    return { side: 'right', top: alignedTop, left: rect.left + rect.width + gap }
  }
  if (rect.left - gap - bubble.width >= margin) {
    return { side: 'left', top: alignedTop, left: rect.left - gap - bubble.width }
  }
  return center()
}

export type StepFallback = 'center' | 'skip'

export type StepResolution =
  | { action: 'spotlight'; rect: AnchorRect }
  | { action: 'center' }
  | { action: 'skip' }

/** 锚点解析结果 → 该步的渲染决策:有 rect 走聚光灯;无 rect 按步骤声明降级(居中讲解 / 自动跳过)。 */
export function resolveStepFallback(
  step: { fallback: StepFallback },
  rect: AnchorRect | null,
): StepResolution {
  if (rect) return { action: 'spotlight', rect }
  return step.fallback === 'skip' ? { action: 'skip' } : { action: 'center' }
}
