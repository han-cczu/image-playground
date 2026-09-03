// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore } from '../store'

// 模拟部署后旧页面拉取已被删除的 hashed chunk:动态 import 直接 reject
vi.mock('./SettingsModal', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/SettingsModal-old.js')
})
vi.mock('./PromptOptimizerModal', () => ({ default: () => <div>优化器弹层</div> }))

import LazyModals from './LazyModals'

describe('LazyModals chunk 加载失败兜底', () => {
  beforeEach(() => {
    useStore.setState({ showSettings: false, showPromptOptimizer: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('chunk 加载失败时显示「刷新 / 关闭」面板而不是默认的重试卡片,关闭会复位弹层开关', async () => {
    render(<LazyModals />)
    useStore.getState().setShowSettings(true)

    const closeButton = await screen.findByRole('button', { name: '关闭' })
    expect(screen.getByRole('alertdialog').textContent).toContain('弹层加载失败')
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /清空数据/ })).toBeNull()

    fireEvent.click(closeButton)

    expect(useStore.getState().showSettings).toBe(false)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('其它弹层不受某个弹层 chunk 失败的影响', async () => {
    render(<LazyModals />)
    useStore.getState().setShowPromptOptimizer(true)

    expect(await screen.findByText('优化器弹层')).toBeTruthy()
  })
})
