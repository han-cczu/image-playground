// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog'
import { useStore } from '../store'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useStore.setState({ confirmDialog: null })
})

describe('ConfirmDialog', () => {
  it('closes and catches a failing action', async () => {
    const action = vi.fn(() => {
      throw new Error('delete failed')
    })
    useStore.setState({
      confirmDialog: {
        title: '删除记录',
        message: '确定删除吗？',
        action,
      },
    })

    render(<ConfirmDialog />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: '确认删除' }))).not.toThrow()

    expect(action).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes and catches a rejected async action', async () => {
    const action = vi.fn(async () => {
      throw new Error('delete failed async')
    })
    useStore.setState({
      confirmDialog: {
        title: '删除记录',
        message: '确定删除吗？',
        action,
      },
    })

    render(<ConfirmDialog />)

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(action).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes and catches a failing cancel action', async () => {
    const cancelAction = vi.fn(() => {
      throw new Error('cancel failed')
    })
    useStore.setState({
      confirmDialog: {
        title: '检测到 Codex CLI API',
        message: '是否开启？',
        action: vi.fn(),
        cancelAction,
      },
    })

    render(<ConfirmDialog />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: '取消' }))).not.toThrow()

    expect(cancelAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  // Esc 与「取消」必须同义:Codex CLI 提示靠 cancelAction 记录「不再询问」,Esc 若只关不记,
  // 每完成一个任务都会重弹并抢走输入框焦点(见 taskRuntime/codexCli.ts)
  it('按 Esc 关闭时同样执行 cancelAction 且只执行一次', async () => {
    const cancelAction = vi.fn()
    useStore.setState({
      confirmDialog: {
        title: '检测到 Codex CLI API',
        message: '是否开启？',
        action: vi.fn(),
        cancelAction,
      },
    })

    render(<ConfirmDialog />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(cancelAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 面板卸载后 ESC 栈已出栈,再按一次不得重复触发(防「关闭 + 取消」双调)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(cancelAction).toHaveBeenCalledOnce()
  })

  it('点击遮罩关闭时同样执行 cancelAction,且 cancelAction 抛错不外泄', async () => {
    const cancelAction = vi.fn(() => {
      throw new Error('cancel failed')
    })
    useStore.setState({
      confirmDialog: {
        title: '检测到 Codex CLI API',
        message: '是否开启？',
        action: vi.fn(),
        cancelAction,
      },
    })

    const { container } = render(<ConfirmDialog />)

    // Modal 的 backdrop 是 panel 之前那层无 role 的 absolute inset-0 div,只能按结构定位
    const backdrop = container.querySelector('.absolute.inset-0')
    expect(backdrop).not.toBeNull()
    expect(() => fireEvent.click(backdrop!)).not.toThrow()

    expect(cancelAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
