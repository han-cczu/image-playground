import { describe, expect, it, vi } from 'vitest'
import { buildTourSteps } from './steps'

describe('buildTourSteps', () => {
  it('returns 8 steps on desktop, 7 on mobile (command-palette filtered)', () => {
    const desktop = buildTourSteps({ isMobile: false, hasApiKey: false })
    const mobile = buildTourSteps({ isMobile: true, hasApiKey: false })
    expect(desktop).toHaveLength(8)
    expect(mobile).toHaveLength(7)
    expect(desktop.some((s) => s.id === 'command-palette')).toBe(true)
    expect(mobile.some((s) => s.id === 'command-palette')).toBe(false)
  })

  it('has unique ids and a fallback on every step', () => {
    const steps = buildTourSteps({ isMobile: false, hasApiKey: false })
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
    for (const step of steps) {
      expect(['center', 'skip']).toContain(step.fallback)
    }
    // 末步绝不能是 skip(自动跳过会越界)
    expect(steps[steps.length - 1].fallback).toBe('center')
  })

  it('adapts the configure-api copy to hasApiKey (重看路径文案状态感知)', () => {
    const fresh = buildTourSteps({ isMobile: false, hasApiKey: false })
    const configured = buildTourSteps({ isMobile: false, hasApiKey: true })
    const freshBody = fresh.find((s) => s.id === 'configure-api')!.body
    const configuredBody = configured.find((s) => s.id === 'configure-api')!.body
    expect(freshBody).toContain('灰色')
    expect(configuredBody).not.toContain('灰色')
    expect(configuredBody).toContain('已配置')
  })

  it('advanced step expands the mobile collapse panel only on mobile', () => {
    const api = { setMobileInputCollapsed: vi.fn() }

    buildTourSteps({ isMobile: true, hasApiKey: false })
      .find((s) => s.id === 'advanced')!
      .onEnter!(api)
    expect(api.setMobileInputCollapsed).toHaveBeenCalledWith(false)

    api.setMobileInputCollapsed.mockClear()
    buildTourSteps({ isMobile: false, hasApiKey: false })
      .find((s) => s.id === 'advanced')!
      .onEnter!(api)
    expect(api.setMobileInputCollapsed).not.toHaveBeenCalled()
  })

  it('first and last steps frame the tour (welcome center / finish anchors help icon)', () => {
    const steps = buildTourSteps({ isMobile: false, hasApiKey: false })
    expect(steps[0]).toMatchObject({ id: 'welcome', anchor: null })
    expect(steps[steps.length - 1]).toMatchObject({
      id: 'finish',
      anchor: '[data-tour-id="help"]',
    })
  })
})
