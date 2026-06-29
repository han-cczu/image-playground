// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import CompareModal from './CompareModal'

const mocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(),
  getCachedImage: vi.fn(),
  setCompareTaskIds: vi.fn(),
}))

const state = vi.hoisted(() => ({
  compareTaskIds: ['task-a', 'task-b'],
  tasks: [
    {
      id: 'task-a',
      prompt: 'a',
      params: {
        size: 'auto',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 1,
      },
      inputImageIds: [],
      maskTargetImageId: null,
      maskImageId: null,
      outputImages: ['image-a'],
      status: 'done',
      error: null,
      createdAt: 1,
      finishedAt: 2,
      elapsed: 1,
    },
    {
      id: 'task-b',
      prompt: 'b',
      params: {
        size: 'auto',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 1,
      },
      inputImageIds: [],
      maskTargetImageId: null,
      maskImageId: null,
      outputImages: ['image-b'],
      status: 'done',
      error: null,
      createdAt: 3,
      finishedAt: 4,
      elapsed: 1,
    },
  ],
}))

vi.mock('../store', () => ({
  ensureImageCached: mocks.ensureImageCached,
  getCachedImage: mocks.getCachedImage,
  useStore: (selector: (s: typeof state & { setCompareTaskIds: typeof mocks.setCompareTaskIds }) => unknown) =>
    selector({ ...state, setCompareTaskIds: mocks.setCompareTaskIds }),
}))

describe('CompareModal', () => {
  afterEach(() => {
    cleanup()
    mocks.ensureImageCached.mockReset()
    mocks.getCachedImage.mockReset()
    mocks.setCompareTaskIds.mockReset()
  })

  it('attaches rejection handlers to asynchronous image cache fills', () => {
    const cachePromise = {
      then: vi.fn(() => ({
        catch: vi.fn(),
      })),
    }
    mocks.getCachedImage.mockReturnValue(undefined)
    mocks.ensureImageCached.mockReturnValue(cachePromise)

    render(<CompareModal />)

    expect(mocks.ensureImageCached).toHaveBeenCalled()
    expect(cachePromise.then).toHaveBeenCalled()
    expect(cachePromise.then.mock.results[0].value.catch).toHaveBeenCalled()
  })

  it('uses cached images that are added to the compared tasks while the modal stays open', async () => {
    mocks.getCachedImage.mockImplementation((id: string) =>
      id === 'image-c' ? 'data:image/png;base64,cached-c' : undefined,
    )
    mocks.ensureImageCached.mockResolvedValue(undefined)
    const { rerender } = render(<CompareModal />)

    state.tasks = state.tasks.map((task) =>
      task.id === 'task-a' ? { ...task, outputImages: ['image-c'] } : task,
    )
    rerender(<CompareModal />)

    await waitFor(() =>
      expect(screen.getByAltText('对比列 A').getAttribute('src')).toBe(
        'data:image/png;base64,cached-c',
      ),
    )
  })
})
