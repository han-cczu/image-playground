// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import { useMaskPreview } from './hooks'

vi.mock('../../lib/image/canvasImage', () => ({
  createMaskPreviewDataUrl: vi.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('DetailModal hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not reuse a stale mask preview after the mask source is cleared and restored', async () => {
    const firstPreview = createDeferred<string>()
    const secondPreview = createDeferred<string>()
    vi.mocked(createMaskPreviewDataUrl)
      .mockReturnValueOnce(firstPreview.promise)
      .mockReturnValueOnce(secondPreview.promise)

    const { result, rerender } = renderHook(
      ({ target, mask }) => useMaskPreview(target, mask),
      { initialProps: { target: 'data:image/png;base64,target', mask: 'data:image/png;base64,mask' } },
    )

    await act(async () => {
      firstPreview.resolve('data:image/png;base64,first-preview')
      await firstPreview.promise
    })

    await waitFor(() => {
      expect(result.current).toBe('data:image/png;base64,first-preview')
    })

    rerender({ target: 'data:image/png;base64,target', mask: '' })
    expect(result.current).toBe('')

    rerender({
      target: 'data:image/png;base64,target',
      mask: 'data:image/png;base64,mask',
    })
    expect(result.current).toBe('')

    await act(async () => {
      secondPreview.resolve('data:image/png;base64,second-preview')
      await secondPreview.promise
    })

    await waitFor(() => {
      expect(result.current).toBe('data:image/png;base64,second-preview')
    })
  })
})
