import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS } from './lib/api/apiProfiles'
import type { FavoriteCategory, TaskRecord } from './types'
import { editOutputs, markInterruptedSyncHttpTasks, mergePersistedStoreState, submitTask, updateTaskInStore, useStore } from './store'
import { DEFAULT_FAVORITE_CATEGORY_COLOR } from './lib/favoriteCategories'

vi.mock('./lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/db')>()
  return {
    ...actual,
    putTask: vi.fn(actual.putTask),
    storeImage: vi.fn(actual.storeImage),
  }
})

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>()
  return {
    ...actual,
    callImageApi: vi.fn(actual.callImageApi),
  }
})

import { putTask, storeImage } from './lib/db'
import { callImageApi } from './lib/api'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const categoryA: FavoriteCategory = {
  id: 'cat-a',
  name: '角色',
  color: '#f59e0b',
  sortOrder: 0,
  createdAt: 1,
}
const categoryB: FavoriteCategory = {
  id: 'cat-b',
  name: '场景',
  color: '#14b8a6',
  sortOrder: 1,
  createdAt: 2,
}

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

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask).mockResolvedValue('task-id')
    vi.mocked(storeImage).mockReset()
    vi.mocked(storeImage).mockResolvedValue('generated-image-id')
    vi.mocked(callImageApi).mockReset()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })
})

describe('interrupted sync-http running tasks', () => {
  it('marks legacy and openai running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openaiRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedSyncHttpTasks([legacyRunning, openaiRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('task runtime reliability', () => {
  beforeEach(() => {
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask).mockResolvedValue('task-id')
    vi.mocked(storeImage).mockReset()
    vi.mocked(storeImage).mockResolvedValue('generated-image-id')
    vi.mocked(callImageApi).mockReset()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('surfaces IndexedDB write failures when updating a task', async () => {
    const failingTask = task({ id: 'task-a' })
    const failure = new Error('idb write failed')
    vi.mocked(putTask).mockRejectedValue(failure)
    useStore.setState({
      tasks: [failingTask],
      showToast: vi.fn(),
    })

    await expect(updateTaskInStore('task-a', { isFavorite: true })).rejects.toThrow('idb write failed')

    expect(useStore.getState().tasks[0]).toMatchObject({
      isFavorite: true,
      persistenceError: 'idb write failed',
    })
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('保存任务失败'),
      'error',
    )
  })

  it('stores partial success metadata from API results on the task', async () => {
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,AQID'],
      actualParams: { n: 1 },
      partialFailureCount: 1,
      partialFailureMessage: 'one request failed',
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0]?.status).toBe('done')
    })
    expect(useStore.getState().tasks[0]).toMatchObject({
      partialFailureCount: 1,
      partialFailureMessage: 'one request failed',
    })
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('部分完成'),
      'error',
    )
  })

  it('aborts the in-flight API request when the task watchdog times out', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.mocked(callImageApi).mockImplementation(async (opts) => {
      signal = opts.signal
      return new Promise(() => undefined)
    })

    await submitTask()
    await vi.waitFor(() => expect(signal).toBeDefined())

    await vi.advanceTimersByTimeAsync(1000)

    expect(signal?.aborted).toBe(true)
    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求超时'),
    })
  })
})

describe('favorite category store actions', () => {
  beforeEach(() => {
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask).mockResolvedValue('task-id')
    useStore.setState({
      favoriteCategories: [],
      filterFavoriteCategoryId: null,
      tasks: [],
      showToast: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates, updates, and reorders favorite categories', () => {
    const firstId = useStore.getState().createFavoriteCategory({ name: '角色', color: '#f59e0b' })
    const secondId = useStore.getState().createFavoriteCategory({ name: '场景', color: '#14b8a6' })

    useStore.getState().updateFavoriteCategory(firstId, { name: '主角', color: '#ef4444' })
    useStore.getState().moveFavoriteCategory(secondId, -1)

    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({ id: secondId, name: '场景', color: '#14b8a6', sortOrder: 0 }),
      expect.objectContaining({ id: firstId, name: '主角', color: '#ef4444', sortOrder: 1 }),
    ])
  })

  it('starts fresh local state with one default favorite category', () => {
    expect(useStore.getInitialState().favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
  })

  it('adds one default favorite category when legacy persisted state has no category metadata', () => {
    const merged = mergePersistedStoreState({ settings: DEFAULT_SETTINGS }, useStore.getInitialState())

    expect(merged.favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
  })

  it('adds one default favorite category when legacy persisted state has an empty category array', () => {
    const merged = mergePersistedStoreState({
      settings: DEFAULT_SETTINGS,
      favoriteCategories: [],
    }, useStore.getInitialState())

    expect(merged.favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
  })

  it('allows the seeded default favorite category to be updated and deleted', async () => {
    const [defaultCategory] = useStore.getInitialState().favoriteCategories
    useStore.setState({
      favoriteCategories: [defaultCategory],
      filterFavoriteCategoryId: defaultCategory.id,
      tasks: [],
    })

    useStore.getState().updateFavoriteCategory(defaultCategory.id, {
      name: '我的默认',
      color: '#14b8a6',
    })
    await useStore.getState().deleteFavoriteCategory(defaultCategory.id)

    expect(useStore.getState().favoriteCategories).toEqual([])
    expect(useStore.getState().filterFavoriteCategoryId).toBeNull()
  })

  it('keeps an initialized empty category list empty after the user deletes all categories', () => {
    const merged = mergePersistedStoreState({
      settings: DEFAULT_SETTINGS,
      favoriteCategories: [],
      favoriteCategoriesInitialized: true,
    }, useStore.getInitialState())

    expect(merged.favoriteCategories).toEqual([])
  })

  it('clears task assignments when a favorite category is deleted', async () => {
    const assignedTask = task({
      id: 'assigned',
      isFavorite: true,
      favoriteCategoryId: categoryA.id,
    })
    const otherTask = task({
      id: 'other',
      isFavorite: true,
      favoriteCategoryId: categoryB.id,
    })
    useStore.setState({
      favoriteCategories: [categoryA, categoryB],
      filterFavoriteCategoryId: categoryA.id,
      tasks: [assignedTask, otherTask],
    })

    await useStore.getState().deleteFavoriteCategory(categoryA.id)

    expect(useStore.getState().favoriteCategories).toEqual([{ ...categoryB, sortOrder: 0 }])
    expect(useStore.getState().filterFavoriteCategoryId).toBeNull()
    expect(useStore.getState().tasks).toEqual([
      expect.objectContaining({ id: 'assigned', favoriteCategoryId: null }),
      otherTask,
    ])
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'assigned',
      favoriteCategoryId: null,
    }))
    expect(putTask).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'other' }))
  })
})
