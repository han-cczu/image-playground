// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMobileViewportGuards } from './viewport'

describe('installMobileViewportGuards', () => {
  afterEach(() => {
    document.head.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('installs global mobile gesture guards only once', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener')

    installMobileViewportGuards()
    installMobileViewportGuards()

    const installedGuardTypes = addEventListener.mock.calls
      .map(([type]) => type)
      .filter((type) => type === 'gesturestart' || type === 'gesturechange' || type === 'touchmove')

    expect(installedGuardTypes).toEqual(['gesturestart', 'gesturechange', 'touchmove'])
  })

  it('updates the viewport meta content on every call', () => {
    const viewport = document.createElement('meta')
    viewport.name = 'viewport'
    document.head.appendChild(viewport)

    installMobileViewportGuards()
    viewport.content = 'width=device-width'
    installMobileViewportGuards()

    expect(viewport.content).toContain('maximum-scale=1.0')
  })
})
