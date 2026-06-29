// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Toast from './Toast'
import { useStore } from '../store'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Toast', () => {
  it('keeps a persistent polite live region for screen readers', () => {
    useStore.setState({ toast: null })

    render(<Toast />)

    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('aria-atomic')).toBe('true')
  })

  it('allows error toasts to be dismissed manually', () => {
    const dismissToast = vi.fn()
    useStore.setState({
      toast: { id: 1, message: '失败详情', type: 'error' },
      dismissToast,
    })

    render(<Toast />)
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))

    expect(dismissToast).toHaveBeenCalledOnce()
  })
})
