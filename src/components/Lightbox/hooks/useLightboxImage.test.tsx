// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../../../types'
import { useLightboxImage } from './useLightboxImage'

interface MockStoreState {
  maskDraft: null
  tasks: TaskRecord[]
}

const storeMocks = vi.hoisted(() => {
  const mock = {
    state: {
      maskDraft: null,
      tasks: [],
    } as MockStoreState,
    cached: new Map<string, string>(),
    resolvers: new Map<string, (value: string | undefined) => void>(),
    ensureImageCached: vi.fn((id: string) =>
      new Promise<string | undefined>((resolve) => {
        mock.resolvers.set(id, resolve)
      }),
    ),
    getCachedImage: vi.fn((id: string) => mock.cached.get(id)),
  }
  return mock
})

vi.mock('../../../store', () => ({
  useStore: vi.fn((selector: (state: MockStoreState) => unknown) => selector(storeMocks.state)),
  getCachedImage: storeMocks.getCachedImage,
  ensureImageCached: storeMocks.ensureImageCached,
}))

vi.mock('../../../lib/image/canvasImage', () => ({
  createMaskPreviewDataUrl: vi.fn(async (imageDataUrl: string, maskDataUrl: string) =>
    `preview:${imageDataUrl}:${maskDataUrl}`,
  ),
}))

describe('useLightboxImage', () => {
  beforeEach(() => {
    storeMocks.state = { maskDraft: null, tasks: [] }
    storeMocks.cached.clear()
    storeMocks.resolvers.clear()
    storeMocks.ensureImageCached.mockClear()
    storeMocks.getCachedImage.mockClear()
  })

  it('ignores stale image loads after switching to a different lightbox image', async () => {
    const { result, rerender } = renderHook(
      ({ imageId }: { imageId: string | null }) => useLightboxImage(imageId),
      { initialProps: { imageId: 'image-a' as string | null } },
    )

    rerender({ imageId: 'image-b' })

    await act(async () => {
      storeMocks.resolvers.get('image-b')?.('data:image/png;base64,b')
    })
    await waitFor(() => expect(result.current.src).toBe('data:image/png;base64,b'))

    await act(async () => {
      storeMocks.resolvers.get('image-a')?.('data:image/png;base64,a')
    })

    expect(result.current.src).toBe('data:image/png;base64,b')
  })

  it('does not reuse a previous src after the lightbox closes and the same image id is reopened', async () => {
    const { result, rerender } = renderHook(
      ({ imageId }: { imageId: string | null }) => useLightboxImage(imageId),
      { initialProps: { imageId: 'image-a' as string | null } },
    )

    await act(async () => {
      storeMocks.resolvers.get('image-a')?.('data:image/png;base64,old')
    })
    await waitFor(() => expect(result.current.src).toBe('data:image/png;base64,old'))

    rerender({ imageId: null })
    expect(result.current.src).toBe('')

    rerender({ imageId: 'image-a' })

    expect(result.current.src).toBe('')
  })

  it('ignores stale mask loads after switching to a different masked image', async () => {
    storeMocks.cached.set('image-a', 'data:image/png;base64,a')
    storeMocks.cached.set('image-b', 'data:image/png;base64,b')
    storeMocks.state.tasks = [
      task({ id: 'task-a', prompt: 'a', maskTargetImageId: 'image-a', maskImageId: 'mask-a' }),
      task({ id: 'task-b', prompt: 'b', maskTargetImageId: 'image-b', maskImageId: 'mask-b' }),
    ]

    const { result, rerender } = renderHook(
      ({ imageId }: { imageId: string | null }) => useLightboxImage(imageId),
      { initialProps: { imageId: 'image-a' as string | null } },
    )

    rerender({ imageId: 'image-b' })

    await act(async () => {
      storeMocks.resolvers.get('mask-b')?.('data:image/png;base64,mask-b')
    })
    await waitFor(() =>
      expect(result.current.maskPreviewSrc).toBe(
        'preview:data:image/png;base64,b:data:image/png;base64,mask-b',
      ),
    )

    await act(async () => {
      storeMocks.resolvers.get('mask-a')?.('data:image/png;base64,mask-a')
    })

    expect(result.current.maskPreviewSrc).toBe(
      'preview:data:image/png;base64,b:data:image/png;base64,mask-b',
    )
  })
})

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task',
    prompt: 'prompt',
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
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}
