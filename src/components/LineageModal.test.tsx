// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { TaskRecord } from '../types'
import LineageModal from './LineageModal'

const mocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(),
  getCachedImage: vi.fn(),
  setDetailTaskId: vi.fn(),
  setLineageTaskId: vi.fn(),
}))

const state = vi.hoisted(() => ({
  lineageTaskId: 'task-center',
  tasks: [
    {
      id: 'task-parent',
      prompt: 'parent',
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
      outputImages: ['image-parent'],
      status: 'done',
      error: null,
      createdAt: 1,
      finishedAt: 2,
      elapsed: 1,
    },
    {
      id: 'task-center',
      prompt: 'center',
      params: {
        size: 'auto',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 1,
      },
      inputImageIds: ['image-parent'],
      maskTargetImageId: null,
      maskImageId: null,
      outputImages: ['image-center'],
      status: 'done',
      error: null,
      createdAt: 1,
      finishedAt: 2,
      elapsed: 1,
    },
  ] as TaskRecord[],
}))

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task',
    prompt: 'task',
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

vi.mock('../store', () => ({
  ensureImageCached: mocks.ensureImageCached,
  getCachedImage: mocks.getCachedImage,
  useStore: (
    selector: (s: typeof state & {
      setDetailTaskId: typeof mocks.setDetailTaskId
      setLineageTaskId: typeof mocks.setLineageTaskId
    }) => unknown,
  ) =>
    selector({
      ...state,
      setDetailTaskId: mocks.setDetailTaskId,
      setLineageTaskId: mocks.setLineageTaskId,
    }),
}))

describe('LineageModal', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    state.lineageTaskId = 'task-center'
    state.tasks = [
      task({ id: 'task-parent', prompt: 'parent', outputImages: ['image-parent'] }),
      task({ id: 'task-center', prompt: 'center', inputImageIds: ['image-parent'], outputImages: ['image-center'] }),
    ] as TaskRecord[]
  })

  it('uses cached thumbnails that are added while the lineage modal stays open', async () => {
    mocks.getCachedImage.mockImplementation((id: string) =>
      id === 'image-child' ? 'data:image/png;base64,cached-child' : undefined,
    )
    mocks.ensureImageCached.mockResolvedValue(undefined)
    const { rerender } = render(<LineageModal />)

    state.tasks = [
      ...state.tasks,
      task({
        id: 'task-child',
        prompt: 'child',
        inputImageIds: ['image-center'],
        outputImages: ['image-child'],
      }),
    ] as TaskRecord[]
    rerender(<LineageModal />)

    await waitFor(() =>
      expect(
        document.querySelector('img[src="data:image/png;base64,cached-child"]'),
      ).not.toBeNull(),
    )
  })
})
