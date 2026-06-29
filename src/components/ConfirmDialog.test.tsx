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
})
