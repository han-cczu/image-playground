// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'
import { clearAllData, useStore } from '../store'

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  return {
    ...actual,
    clearAllData: vi.fn(async () => undefined),
  }
})

function ThrowingChild() {
  throw new Error('boom')
}

function MaybeThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom')
  return <div>ok</div>
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('returns the clear-and-reload promise from the confirmation action', async () => {
    const setConfirmDialog = vi.fn()
    const reload = vi.fn()
    let resolveClear!: () => void
    vi.mocked(clearAllData).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClear = () => resolve(undefined)
      }),
    )
    vi.stubGlobal('location', { ...window.location, reload })
    useStore.setState({ setConfirmDialog })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ErrorBoundary region="main">
        <ThrowingChild />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: '清空本地数据并重载' }))

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => unknown
    }
    const result = dialog.action() as Promise<unknown>

    expect(result).toHaveProperty('then')
    resolveClear()
    await result
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not count a later fresh error as a failed retry after recovery succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender } = render(
      <ErrorBoundary region="main">
        <MaybeThrowingChild shouldThrow />
      </ErrorBoundary>,
    )

    rerender(
      <ErrorBoundary region="main">
        <MaybeThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByText('ok')).toBeTruthy())

    for (let i = 0; i < 3; i++) {
      rerender(
        <ErrorBoundary region="main" resetKey={`fresh-${i}`}>
          <MaybeThrowingChild shouldThrow />
        </ErrorBoundary>,
      )
      expect(screen.getByRole('button', { name: '重试' })).toHaveProperty('disabled', false)
      rerender(
        <ErrorBoundary region="main" resetKey={`fresh-${i}`}>
          <MaybeThrowingChild shouldThrow={false} />
        </ErrorBoundary>,
      )
      fireEvent.click(screen.getByRole('button', { name: '重试' }))
      await waitFor(() => expect(screen.getByText('ok')).toBeTruthy())
    }
  })
})
