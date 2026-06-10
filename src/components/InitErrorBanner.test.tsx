// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import InitErrorBanner from './InitErrorBanner'

// 项目未开启 vitest globals,RTL 的自动 cleanup 不生效,需显式清理避免多次 render 在 document 累积。
// unstubAllGlobals 在 afterEach:断言失败抛出时残缺 stub 不泄漏到后续用例。
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('InitErrorBanner(M8 initStore 失败显性化)', () => {
  it('error 为 null 时不渲染', () => {
    const { container } = render(<InitErrorBanner error={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('渲染错误文本、role=alert 与「请勿破坏性操作」警示', () => {
    render(<InitErrorBanner error="数据库升级被其它标签页阻塞" />)
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('数据库升级被其它标签页阻塞')
    expect(banner.textContent).toContain('请勿执行清空 / 导入等操作')
  })

  it('重试按钮触发 location.reload', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<InitErrorBanner error="boom" />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
