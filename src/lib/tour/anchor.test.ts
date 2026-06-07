import { describe, expect, it } from 'vitest'
import {
  computeBubblePlacement,
  resolveAnchor,
  resolveStepFallback,
  type AnchorRect,
} from './anchor'

/** 桩 document:按 selector 返回带 getBoundingClientRect 的假元素 */
function stubDoc(rect: Partial<DOMRect> | null) {
  return {
    querySelector: (() =>
      rect === null
        ? null
        : ({
            getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, ...rect }),
          } as unknown as Element)) as Document['querySelector'],
  }
}

describe('resolveAnchor', () => {
  it('returns rect for a visible element', () => {
    const doc = stubDoc({ top: 10, left: 20, width: 100, height: 40 })
    expect(resolveAnchor('[data-tour-id="x"]', doc)).toEqual({
      top: 10, left: 20, width: 100, height: 40,
    })
  })

  it('returns null when selector misses', () => {
    expect(resolveAnchor('[data-tour-id="x"]', stubDoc(null))).toBeNull()
  })

  it('returns null for zero-size element (移动端折叠塌缩)', () => {
    expect(resolveAnchor('x', stubDoc({ width: 0, height: 40 }))).toBeNull()
    expect(resolveAnchor('x', stubDoc({ width: 100, height: 0 }))).toBeNull()
  })
})

describe('computeBubblePlacement', () => {
  const viewport = { width: 1000, height: 800 }
  const bubble = { width: 320, height: 160 }

  it('prefers below the anchor when space allows', () => {
    const rect: AnchorRect = { top: 100, left: 400, width: 120, height: 40 }
    const p = computeBubblePlacement(rect, bubble, viewport)
    expect(p.side).toBe('bottom')
    expect(p.top).toBe(100 + 40 + 12)
    // 水平居中对齐锚点
    expect(p.left).toBe(400 + 60 - 160)
  })

  it('flips above when below has no room', () => {
    const rect: AnchorRect = { top: 700, left: 400, width: 120, height: 60 }
    const p = computeBubblePlacement(rect, bubble, viewport)
    expect(p.side).toBe('top')
    expect(p.top).toBe(700 - 12 - 160)
  })

  it('falls to right side when neither above nor below fits', () => {
    // 锚点占满纵向中部:上下都不够 172px
    const rect: AnchorRect = { top: 100, left: 100, width: 100, height: 620 }
    const p = computeBubblePlacement(rect, bubble, viewport)
    expect(p.side).toBe('right')
    expect(p.left).toBe(100 + 100 + 12)
  })

  it('falls to left side when right has no room', () => {
    const rect: AnchorRect = { top: 100, left: 660, width: 340, height: 620 }
    const p = computeBubblePlacement(rect, bubble, viewport)
    expect(p.side).toBe('left')
    expect(p.left).toBe(660 - 12 - 320)
  })

  it('centers when anchor is null or nothing fits', () => {
    expect(computeBubblePlacement(null, bubble, viewport).side).toBe('center')
    // 锚点几乎占满视口:四向都放不下
    const huge: AnchorRect = { top: 10, left: 10, width: 980, height: 780 }
    expect(computeBubblePlacement(huge, bubble, viewport).side).toBe('center')
  })

  it('clamps horizontal position into the viewport', () => {
    // 锚点贴左缘:气泡水平对齐会越界,夹回 margin
    const rect: AnchorRect = { top: 100, left: 0, width: 40, height: 40 }
    const p = computeBubblePlacement(rect, bubble, viewport)
    expect(p.left).toBe(12)
  })
})

describe('resolveStepFallback', () => {
  const rect: AnchorRect = { top: 1, left: 2, width: 3, height: 4 }

  it('spotlights when rect resolved regardless of fallback', () => {
    expect(resolveStepFallback({ fallback: 'center' }, rect)).toEqual({ action: 'spotlight', rect })
    expect(resolveStepFallback({ fallback: 'skip' }, rect)).toEqual({ action: 'spotlight', rect })
  })

  it('degrades per declaration when rect is null', () => {
    expect(resolveStepFallback({ fallback: 'center' }, null)).toEqual({ action: 'center' })
    expect(resolveStepFallback({ fallback: 'skip' }, null)).toEqual({ action: 'skip' })
  })
})
