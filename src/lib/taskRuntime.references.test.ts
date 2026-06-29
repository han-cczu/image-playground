import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    deleteImage: vi.fn(async () => undefined),
  }
})

vi.mock('./storageStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storageStats')>()
  return {
    ...actual,
    collectReferencedImageIds: vi.fn(() => new Set<string>()),
  }
})

import { useStore } from '../store'
import { deleteImage } from './db'
import { collectReferencedImageIds } from './storageStats'
import { rollbackStoredImages } from './taskRuntime'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
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

beforeEach(() => {
  vi.mocked(deleteImage).mockClear()
  vi.mocked(collectReferencedImageIds).mockReset()
  useStore.setState({
    tasks: [],
    inputImages: [],
  })
})

describe('taskRuntime image reference cleanup', () => {
  it('rollbackStoredImages uses collectReferencedImageIds as the single image-reference source', async () => {
    const tasks = [task({ id: 'referencing-task' })]
    const inputImages = [{ id: 'input-a', dataUrl: '' }]
    vi.mocked(collectReferencedImageIds).mockReturnValue(new Set(['keep']))
    useStore.setState({ tasks, inputImages })

    await rollbackStoredImages(['drop', 'keep'])

    expect(collectReferencedImageIds).toHaveBeenCalledWith(tasks, inputImages)
    expect(deleteImage).toHaveBeenCalledTimes(1)
    expect(deleteImage).toHaveBeenCalledWith('drop')
  })
})
