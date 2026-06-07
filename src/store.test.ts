import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS, mergeImportedSettings, normalizeSettings } from './lib/api/apiProfiles'
import type { FavoriteCategory, TaskRecord } from './types'
import {
  cancelAllRunning,
  cancelBatch,
  cancelTask,
  clearTaskFavorite,
  editOutputs,
  markInterruptedSyncHttpTasks,
  mergePersistedStoreState,
  retryGridMissing,
  setTaskFavoriteCategory,
  submitTask,
  submitGridTask,
  retryTask,
  updateTaskInStore,
  useStore,
} from './store'
import { DEFAULT_FAVORITE_CATEGORY_COLOR, DEFAULT_FAVORITE_CATEGORY_ID } from './lib/favoriteCategories'
import { MAX_BATCH_NOTES } from './lib/gridSheet'
import { partialize } from './store/persist'
import { shouldAutoStartTour } from './lib/tour/autoStart'

vi.mock('./lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/db')>()
  return {
    ...actual,
    putTask: vi.fn(actual.putTask),
    storeImage: vi.fn(actual.storeImage),
    putConversation: vi.fn(async () => 'conv-id'),
    deleteConversation: vi.fn(async () => undefined),
  }
})

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>()
  return {
    ...actual,
    callImageApi: vi.fn(actual.callImageApi),
  }
})

// 透传 spy:只记录调用不改行为,用于断言单条路径不经并发闸
vi.mock('./lib/concurrency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/concurrency')>()
  return {
    ...actual,
    mapWithConcurrency: vi.fn(actual.mapWithConcurrency),
  }
})

import { deleteConversation, putConversation, putTask, storeImage } from './lib/db'
import { callImageApi } from './lib/api'
import { ARCHIVE_CONVERSATION_ID } from './lib/conversations'
import { resetTaskRuntimeForTest, scheduleSyncHttpWatchdog } from './lib/taskRuntime'
import { mapWithConcurrency } from './lib/concurrency'

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

  it('favorites a task in the selected category and clears the category when unfavorited', async () => {
    useStore.setState({
      tasks: [task({ id: 'task-a' })],
      showToast: vi.fn(),
    })

    await setTaskFavoriteCategory('task-a', categoryA.id)
    await clearTaskFavorite('task-a')

    expect(useStore.getState().tasks[0]).toMatchObject({
      isFavorite: false,
      favoriteCategoryId: null,
    })
    expect(putTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'task-a',
      isFavorite: true,
      favoriteCategoryId: categoryA.id,
    }))
    expect(putTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'task-a',
      isFavorite: false,
      favoriteCategoryId: null,
    }))
  })

  it('favorites a task after the default category is explicitly restored', async () => {
    useStore.setState({
      favoriteCategories: [],
      favoriteCategoriesInitialized: true,
      tasks: [task({ id: 'task-a' })],
      showToast: vi.fn(),
    })

    const categoryId = useStore.getState().ensureDefaultFavoriteCategory()
    await setTaskFavoriteCategory('task-a', categoryId)

    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({
        id: DEFAULT_FAVORITE_CATEGORY_ID,
        name: '默认分类',
        sortOrder: 0,
      }),
    ])
    expect(useStore.getState().tasks[0]).toMatchObject({
      isFavorite: true,
      favoriteCategoryId: DEFAULT_FAVORITE_CATEGORY_ID,
    })
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-a',
      isFavorite: true,
      favoriteCategoryId: DEFAULT_FAVORITE_CATEGORY_ID,
    }))
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

  it('expands a {a|b} wildcard into sibling tasks sharing one batchId', async () => {
    // callImageApi 永挂,让任务保持 running,以便稳定检查 enqueue 阶段写入的 prompt / batchId。
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    const showToast = vi.fn()
    useStore.setState({ prompt: 'a {x|y} cat', showToast })

    await submitTask()

    const tasks = useStore.getState().tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.prompt).sort()).toEqual(['a x cat', 'a y cat'])
    expect(tasks[0].batchId).toBeTruthy()
    expect(tasks[0].batchId).toBe(tasks[1].batchId)
    // 提交前预告总图数(2 条 × n=1 = 2 张)
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('共 2 张图片'), 'success')
  })

  it('keeps a non-wildcard prompt as a single task with no batchId (equivalence)', async () => {
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    useStore.setState({ prompt: 'plain cat', showToast: vi.fn() })

    await submitTask()

    const tasks = useStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].prompt).toBe('plain cat')
    expect(tasks[0].batchId).toBeUndefined()
  })

  it('skips a sibling whose putTask fails but keeps the rest of the batch', async () => {
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask)
      .mockRejectedValueOnce(new Error('idb full')) // 第一条(x)落库失败
      .mockResolvedValue('ok') // 其余成功
    const showToast = vi.fn()
    useStore.setState({ prompt: '{x|y}', showToast })

    await submitTask()

    const tasks = useStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].prompt).toBe('y')
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('保存任务失败'), 'error')
  })

  it('watchdog times from request start, not createdAt (a stale createdAt must not shorten the window)', () => {
    vi.useFakeTimers()
    // 模拟「在并发闸里排队很久才被取出执行」的批量子任务:createdAt 远早于此刻调度 watchdog 的时刻。
    const staleTask = task({ id: 'queued', status: 'running', apiProvider: 'openai', createdAt: Date.now() - 10_000_000 })
    useStore.setState({ tasks: [staleTask], showToast: vi.fn() })

    scheduleSyncHttpWatchdog('queued', 60) // 60s 超时

    // 修复前:remainingMs = 60000 - (now - createdAt) = 0 → 立即假超时。修复后应给完整 60s 窗口。
    vi.advanceTimersByTime(59_000)
    expect(useStore.getState().tasks[0].status).toBe('running')
    vi.advanceTimersByTime(2_000)
    expect(useStore.getState().tasks[0].status).toBe('error')
    expect(useStore.getState().tasks[0].error).toContain('超时')
  })

  it('submitGridTask generates one task per axis value, sharing batchId with gridAxes/gridCoord', async () => {
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    useStore.setState({ prompt: 'a cat', params: { ...DEFAULT_PARAMS }, showToast: vi.fn() })
    const xAxis = { kind: 'quality' as const, values: [{ key: 'low', label: 'low' }, { key: 'high', label: 'high' }] }

    await submitGridTask({ x: xAxis })

    const tasks = useStore.getState().tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.every((t) => t.batchId && t.batchId === tasks[0].batchId)).toBe(true)
    expect(tasks.every((t) => t.gridAxes?.x.kind === 'quality')).toBe(true)
    expect(tasks.map((t) => t.params.quality).sort()).toEqual(['high', 'low'])
    expect(tasks.map((t) => t.gridCoord?.x).sort()).toEqual(['high', 'low'])
  })

  it('retryTask on a grid cell re-enqueues at the same coord under the same batchId', async () => {
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    const gridAxes = { x: { kind: 'quality' as const, values: [{ key: 'low', label: 'low' }, { key: 'high', label: 'high' }] } }
    const errored = task({ id: 'g-low', batchId: 'gb', gridAxes, gridCoord: { x: 'low' }, status: 'error', params: { ...DEFAULT_PARAMS, quality: 'low' } })
    const ok = task({ id: 'g-high', batchId: 'gb', gridAxes, gridCoord: { x: 'high' }, status: 'done', params: { ...DEFAULT_PARAMS, quality: 'high' } })
    useStore.setState({ tasks: [errored, ok], showToast: vi.fn() })

    await retryTask(errored)

    await vi.waitFor(() => {
      const fresh = useStore.getState().tasks.find((t) => t.status === 'running' && t.gridCoord?.x === 'low')
      expect(fresh).toBeTruthy()
      expect(fresh?.batchId).toBe('gb')
      expect(fresh?.gridCoord).toEqual({ x: 'low' })
      expect(fresh?.params.quality).toBe('low')
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

  it('restores the default category only when the favorite flow explicitly selects it', () => {
    useStore.setState({
      favoriteCategories: [],
      favoriteCategoriesInitialized: true,
      filterFavoriteCategoryId: null,
    })

    const restoredId = useStore.getState().ensureDefaultFavoriteCategory()

    expect(restoredId).toBe(DEFAULT_FAVORITE_CATEGORY_ID)
    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({
        id: DEFAULT_FAVORITE_CATEGORY_ID,
        name: '默认分类',
        sortOrder: 0,
      }),
    ])
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

describe('conversation store actions', () => {
  beforeEach(() => {
    vi.mocked(putConversation).mockReset()
    vi.mocked(putConversation).mockResolvedValue('conv-id')
    vi.mocked(deleteConversation).mockReset()
    vi.mocked(deleteConversation).mockResolvedValue(undefined)
    useStore.setState({
      conversations: [],
      activeConversationId: null,
      tasks: [],
      sidebarCollapsed: false,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('createConversation auto-activates the new conversation', () => {
    const id = useStore.getState().createConversation()
    expect(useStore.getState().activeConversationId).toBe(id)
    expect(useStore.getState().conversations[0]?.id).toBe(id)
    expect(useStore.getState().conversations[0]?.title).toBe('新对话')
    expect(putConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id, title: '新对话' }),
    )
  })

  it('createConversation respects an explicit seed title', () => {
    const id = useStore.getState().createConversation('我的对话')
    expect(useStore.getState().conversations[0]).toMatchObject({ id, title: '我的对话' })
  })

  it('renameConversation persists the new title and bumps updatedAt', async () => {
    const id = useStore.getState().createConversation()
    const previous = useStore.getState().conversations.find((c) => c.id === id)
    await new Promise((resolve) => setTimeout(resolve, 1))
    await useStore.getState().renameConversation(id, '改名后')
    const next = useStore.getState().conversations.find((c) => c.id === id)
    expect(next?.title).toBe('改名后')
    expect(next?.updatedAt).toBeGreaterThanOrEqual(previous?.updatedAt ?? 0)
    expect(putConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ id, title: '改名后' }),
    )
  })

  it('renameConversation rejects renaming the archive conversation', async () => {
    const showToast = vi.fn()
    useStore.setState({
      conversations: [
        {
          id: ARCHIVE_CONVERSATION_ID,
          title: '历史记录',
          createdAt: 1,
          updatedAt: 1,
          color: null,
        },
      ],
      showToast,
    })

    await useStore.getState().renameConversation(ARCHIVE_CONVERSATION_ID, '想改名')

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('「历史记录」对话不可重命名'),
      'error',
    )
    expect(useStore.getState().conversations[0]?.title).toBe('历史记录')
    expect(putConversation).not.toHaveBeenCalled()
  })

  it('deleteConversationWithTasks rejects deleting the archive conversation', () => {
    const showToast = vi.fn()
    useStore.setState({
      conversations: [
        {
          id: ARCHIVE_CONVERSATION_ID,
          title: '历史记录',
          createdAt: 1,
          updatedAt: 1,
          color: null,
        },
      ],
      activeConversationId: ARCHIVE_CONVERSATION_ID,
      showToast,
    })

    useStore.getState().deleteConversationWithTasks(ARCHIVE_CONVERSATION_ID)

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('「历史记录」对话不可删除'),
      'error',
    )
    expect(useStore.getState().conversations).toHaveLength(1)
  })

  it('deleteConversationWithTasks asks for confirmation, deletes only the target conversation and its tasks', async () => {
    const setConfirmDialog = vi.fn()
    useStore.setState({
      conversations: [
        { id: 'conv-keep', title: '保留', createdAt: 1, updatedAt: 1 },
        { id: 'conv-target', title: '待删', createdAt: 2, updatedAt: 2 },
      ],
      tasks: [
        { ...task({ id: 'task-keep', conversationId: 'conv-keep' }) },
        { ...task({ id: 'task-target', conversationId: 'conv-target' }) },
      ],
      activeConversationId: 'conv-target',
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')

    expect(setConfirmDialog).toHaveBeenCalled()
    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await vi.waitFor(() => {
      expect(useStore.getState().conversations.find((c) => c.id === 'conv-target')).toBeUndefined()
    })
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['task-keep'])
    expect(useStore.getState().activeConversationId).toBe('conv-keep')
    expect(deleteConversation).toHaveBeenCalledWith('conv-target', true)
  })

  it('toggleSidebar flips the persisted collapse flag', () => {
    expect(useStore.getState().sidebarCollapsed).toBe(false)
    useStore.getState().toggleSidebar()
    expect(useStore.getState().sidebarCollapsed).toBe(true)
    useStore.getState().toggleSidebar()
    expect(useStore.getState().sidebarCollapsed).toBe(false)
  })

  it('mergePersistedStoreState restores activeConversationId and sidebarCollapsed', () => {
    const merged = mergePersistedStoreState(
      { activeConversationId: 'conv-foo', sidebarCollapsed: true },
      useStore.getInitialState(),
    )
    expect(merged.activeConversationId).toBe('conv-foo')
    expect(merged.sidebarCollapsed).toBe(true)
  })

  it('mergePersistedStoreState defaults activeConversationId / sidebarCollapsed when missing', () => {
    const merged = mergePersistedStoreState({}, useStore.getInitialState())
    expect(merged.activeConversationId).toBeNull()
    expect(merged.sidebarCollapsed).toBe(false)
  })
})

describe('insecure context banner state', () => {
  it('mergePersistedStoreState defaults dismissedInsecureContextBanner to false for missing / false / non-boolean persisted values', () => {
    const initial = useStore.getInitialState()
    expect(
      mergePersistedStoreState({}, initial).dismissedInsecureContextBanner,
    ).toBe(false)
    expect(
      mergePersistedStoreState({ dismissedInsecureContextBanner: false }, initial)
        .dismissedInsecureContextBanner,
    ).toBe(false)
    expect(
      mergePersistedStoreState(
        // 模拟旧持久化数据里没有该字段
        { dismissedInsecureContextBanner: undefined as unknown as boolean },
        initial,
      ).dismissedInsecureContextBanner,
    ).toBe(false)
  })

  it('mergePersistedStoreState preserves dismissedInsecureContextBanner === true', () => {
    const merged = mergePersistedStoreState(
      { dismissedInsecureContextBanner: true },
      useStore.getInitialState(),
    )
    expect(merged.dismissedInsecureContextBanner).toBe(true)
  })

  it('mergePersistedStoreState defaults galleryView to false for missing / false / non-boolean persisted values', () => {
    const initial = useStore.getInitialState()
    // 旧用户：持久化里没有 galleryView 字段
    expect(mergePersistedStoreState({}, initial).galleryView).toBe(false)
    // 显式 false
    expect(mergePersistedStoreState({ galleryView: false }, initial).galleryView).toBe(false)
    // 非 boolean 类型（受损/旧数据）也兜底 false
    expect(
      mergePersistedStoreState(
        { galleryView: 'true' as unknown as boolean },
        initial,
      ).galleryView,
    ).toBe(false)
  })

  it('mergePersistedStoreState preserves galleryView === true', () => {
    const merged = mergePersistedStoreState(
      { galleryView: true },
      useStore.getInitialState(),
    )
    expect(merged.galleryView).toBe(true)
  })

  it('setDismissedInsecureContextBanner flips and persists the flag through the store', () => {
    useStore.setState({ dismissedInsecureContextBanner: false })
    useStore.getState().setDismissedInsecureContextBanner(true)
    expect(useStore.getState().dismissedInsecureContextBanner).toBe(true)
    useStore.getState().setDismissedInsecureContextBanner(false)
    expect(useStore.getState().dismissedInsecureContextBanner).toBe(false)
  })
})

describe('prompt snippet store actions', () => {
  beforeEach(() => {
    useStore.setState({ snippets: [], showToast: vi.fn() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates, updates, moves, and deletes snippets with compact sortOrder', () => {
    const a = useStore.getState().createSnippet({ name: '光线', content: '{晨光|黄昏}' })!
    const b = useStore.getState().createSnippet({ name: '镜头', content: '85mm lens' })!

    useStore.getState().updateSnippet(a, { name: '光线组', content: '{晨光|正午|黄昏}' })
    useStore.getState().moveSnippet(b, -1)

    expect(useStore.getState().snippets).toEqual([
      expect.objectContaining({ id: b, name: '镜头', sortOrder: 0 }),
      expect.objectContaining({ id: a, name: '光线组', content: '{晨光|正午|黄昏}', sortOrder: 1 }),
    ])

    useStore.getState().deleteSnippet(b)
    expect(useStore.getState().snippets).toEqual([
      expect.objectContaining({ id: a, sortOrder: 0 }),
    ])
  })

  it('rejects empty content on create and keeps content on empty-content update', () => {
    expect(useStore.getState().createSnippet({ name: 'x', content: '   ' })).toBeNull()

    const id = useStore.getState().createSnippet({ name: 'x', content: 'keep' })!
    useStore.getState().updateSnippet(id, { content: '   ' })
    expect(useStore.getState().snippets[0].content).toBe('keep')
  })

  it('falls back to default name and bumps updatedAt on update', () => {
    const id = useStore.getState().createSnippet({ name: '  ', content: 'c' })!
    const created = useStore.getState().snippets[0]
    expect(created.name).toBe('未命名片段')

    vi.useFakeTimers()
    vi.setSystemTime(created.updatedAt + 1000)
    useStore.getState().updateSnippet(id, { name: '新名' })
    expect(useStore.getState().snippets[0].updatedAt).toBe(created.updatedAt + 1000)
    vi.useRealTimers()
  })

  it('rejects creation past MAX_SNIPPETS with a toast', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`, name: `n${i}`, content: 'c', createdAt: i, updatedAt: i, sortOrder: i,
    }))
    useStore.setState({ snippets: many })

    expect(useStore.getState().createSnippet({ name: 'x', content: 'c' })).toBeNull()
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('上限'), 'error',
    )
  })

  it('normalizes snippets through setSnippets and persisted-state merge', () => {
    useStore.getState().setSnippets([
      { id: 's1', name: 'a', content: 'c', createdAt: 1, updatedAt: 1, sortOrder: 9 },
      { id: '', name: 'bad', content: 'c', createdAt: 1, updatedAt: 1, sortOrder: 0 },
    ] as never)
    expect(useStore.getState().snippets).toEqual([
      expect.objectContaining({ id: 's1', sortOrder: 0 }),
    ])

    const merged = mergePersistedStoreState({
      settings: DEFAULT_SETTINGS,
      snippets: [{ id: 's2', content: 'from-persist' }],
    }, useStore.getInitialState())
    expect(merged.snippets).toEqual([
      expect.objectContaining({ id: 's2', content: 'from-persist', name: '未命名片段' }),
    ])
  })
})

describe('batch note store actions', () => {
  beforeEach(() => {
    useStore.setState({ batchNotes: {} })
  })

  it('creates, updates, and deletes notes (blank text deletes)', () => {
    useStore.getState().setBatchNote('b1', '  对照结论 A  ')
    expect(useStore.getState().batchNotes.b1.text).toBe('对照结论 A')

    useStore.getState().setBatchNote('b1', '更新后')
    expect(useStore.getState().batchNotes.b1.text).toBe('更新后')

    useStore.getState().setBatchNote('b1', '   ')
    expect(useStore.getState().batchNotes.b1).toBeUndefined()
  })

  it('clamps note length and no-ops blank delete on missing id', () => {
    const before = useStore.getState().batchNotes
    useStore.getState().setBatchNote('missing', '')
    expect(useStore.getState().batchNotes).toBe(before) // 引用不变,无多余渲染

    useStore.getState().setBatchNote('b2', 'x'.repeat(600))
    expect(useStore.getState().batchNotes.b2.text).toHaveLength(500)
  })

  it('caps live notes at MAX_BATCH_NOTES on write, evicting the oldest (审查修复:写入路径绕过上限)', () => {
    useStore.setState({
      batchNotes: Object.fromEntries(
        Array.from({ length: MAX_BATCH_NOTES }, (_, i) => [`b${i}`, { text: 'x', updatedAt: i + 1 }]),
      ),
    })
    useStore.getState().setBatchNote('overflow', '新笔记')
    const notes = useStore.getState().batchNotes
    expect(Object.keys(notes)).toHaveLength(MAX_BATCH_NOTES)
    expect(notes.overflow.text).toBe('新笔记') // 新条目 updatedAt 最新,必被保留
    expect(notes.b0).toBeUndefined() // updatedAt 最旧的被挤出
  })

  it('normalizes batchNotes through persisted-state merge', () => {
    const merged = mergePersistedStoreState({
      settings: DEFAULT_SETTINGS,
      batchNotes: {
        good: { text: '有效', updatedAt: 1 },
        bad: { text: '   ' },
      },
    } as never, useStore.getInitialState())
    expect(Object.keys(merged.batchNotes)).toEqual(['good'])
  })
})

describe('onboarding tour state', () => {
  it('tour fields default off and setters update them', () => {
    useStore.setState({ tourActive: false, tourStep: 0, hasSeenTour: false })
    expect(useStore.getState().tourActive).toBe(false)
    expect(useStore.getState().tourStep).toBe(0)
    expect(useStore.getState().hasSeenTour).toBe(false)

    useStore.getState().setTourActive(true)
    useStore.getState().setTourStep(3)
    useStore.getState().setHasSeenTour(true)
    expect(useStore.getState().tourActive).toBe(true)
    expect(useStore.getState().tourStep).toBe(3)
    expect(useStore.getState().hasSeenTour).toBe(true)

    useStore.getState().setMobileInputCollapsed(true)
    expect(useStore.getState().mobileInputCollapsed).toBe(true)
    useStore.getState().setMobileInputCollapsed(false)
  })

  it('mergePersistedStoreState normalizes hasSeenTour with strict === true', () => {
    const initial = useStore.getInitialState()
    expect(mergePersistedStoreState({}, initial).hasSeenTour).toBe(false)
    expect(mergePersistedStoreState({ hasSeenTour: true }, initial).hasSeenTour).toBe(true)
    expect(
      mergePersistedStoreState({ hasSeenTour: 'yes' as unknown as boolean }, initial).hasSeenTour,
    ).toBe(false)
  })

  it('partialize persists hasSeenTour but never the transient tour fields', () => {
    useStore.setState({ tourActive: true, tourStep: 5, hasSeenTour: true, mobileInputCollapsed: true })
    const persisted = partialize(useStore.getState()) as Record<string, unknown>
    expect(persisted.hasSeenTour).toBe(true)
    expect(persisted).not.toHaveProperty('tourActive')
    expect(persisted).not.toHaveProperty('tourStep')
    expect(persisted).not.toHaveProperty('mobileInputCollapsed')
    useStore.setState({ tourActive: false, tourStep: 0, hasSeenTour: false, mobileInputCollapsed: false })
  })

  it('shouldAutoStartTour: start only for a true first-run user with no overlay open', () => {
    const initial = useStore.getInitialState()
    const fresh = {
      hasSeenTour: false,
      settings: initial.settings,
      tasks: [] as TaskRecord[],
      confirmDialog: null,
      showSettings: false,
      showCommandPalette: false,
    }
    expect(shouldAutoStartTour(fresh)).toBe('start')

    // 已看过 → none
    expect(shouldAutoStartTour({ ...fresh, hasSeenTour: true })).toBe('none')

    // 任一 profile 配过 key → 老用户豁免(顶层 apiKey 只镜像 active,按 profiles 判)
    const withKey = {
      ...fresh,
      settings: {
        ...initial.settings,
        profiles: initial.settings.profiles.map((p, i) =>
          i === 0 ? { ...p, apiKey: 'sk-test' } : p,
        ),
      },
    }
    expect(shouldAutoStartTour(withKey)).toBe('exempt')

    // 已有任务 → 老用户豁免
    expect(shouldAutoStartTour({ ...fresh, tasks: [task()] })).toBe('exempt')

    // 弹窗互斥:确认框/设置/命令面板打开 → none(不豁免,下次再判)
    expect(
      shouldAutoStartTour({
        ...fresh,
        confirmDialog: { title: 't', message: 'm', action: () => undefined },
      }),
    ).toBe('none')
    expect(shouldAutoStartTour({ ...fresh, showSettings: true })).toBe('none')
    expect(shouldAutoStartTour({ ...fresh, showCommandPalette: true })).toBe('none')
  })
})

describe('batch concurrency & cancellation (B3)', () => {
  beforeEach(() => {
    // 清模块级 controller/watchdog Map:前用例永挂 mock 的 executeTask 不会走 finally 清理,
    // 残留条目会污染本用例 cancelBatch 的 aborted/skipped 区分计数
    resetTaskRuntimeForTest()
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
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clamps batchConcurrency at the normalizeSettings whitelist (唯一净化口)', () => {
    expect(normalizeSettings({ batchConcurrency: 0 }).batchConcurrency).toBe(1)
    expect(normalizeSettings({ batchConcurrency: -5 }).batchConcurrency).toBe(1)
    expect(normalizeSettings({ batchConcurrency: 99 }).batchConcurrency).toBe(6)
    expect(normalizeSettings({ batchConcurrency: 3.7 }).batchConcurrency).toBe(3)
    expect(normalizeSettings({}).batchConcurrency).toBe(3) // 旧持久化缺字段兜默认
    expect(normalizeSettings({ batchConcurrency: 'x' }).batchConcurrency).toBe(3)
    expect(DEFAULT_SETTINGS.batchConcurrency).toBe(3)
    // 导入 round-trip 不丢
    expect(
      mergeImportedSettings(DEFAULT_SETTINGS, { batchConcurrency: 5 }).batchConcurrency,
    ).toBe(5)
  })

  it('runEnqueuedTasks honors settings.batchConcurrency as the worker limit', async () => {
    const rejecters: Array<() => void> = []
    vi.mocked(callImageApi).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejecters.push(() => reject(new Error('released')))
        }),
    )
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1, batchConcurrency: 1 },
      prompt: '{a|b|c}',
      showToast: vi.fn(),
    })

    await submitTask()
    expect(useStore.getState().tasks).toHaveLength(3)

    // 并发 1:任一时刻仅 1 条在途
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls.length).toBe(1))
    rejecters[0]() // 释放首条 → worker 才取下一条
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls.length).toBe(2))
    rejecters[1]()
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls.length).toBe(3))
  })

  it('single-task path bypasses the concurrency gate regardless of batchConcurrency (等价基线)', async () => {
    vi.mocked(mapWithConcurrency).mockClear()
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1, batchConcurrency: 1 },
      prompt: 'plain cat',
      showToast: vi.fn(),
    })
    await submitTask()
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls.length).toBe(1))
    expect(useStore.getState().tasks[0].batchId).toBeUndefined()
    // 关键区分:executeTask 直跑,不经 runEnqueuedTasks/mapWithConcurrency(limit=1 的闸同样只发 1 次请求,calls 计数无法区分)
    expect(vi.mocked(mapWithConcurrency)).not.toHaveBeenCalled()
  })

  it('with batchConcurrency=2 a third request waits until a slot frees (峰值 ≤ 2)', async () => {
    const rejecters: Array<() => void> = []
    vi.mocked(callImageApi).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejecters.push(() => reject(new Error('released')))
        }),
    )
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1, batchConcurrency: 2 },
      prompt: '{a|b|c|d}',
      showToast: vi.fn(),
    })

    await submitTask()
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls.length).toBe(2))
    // flush 一拍确认第三条没有越闸发出
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(vi.mocked(callImageApi).mock.calls.length).toBe(2)

    rejecters[0]() // 释放一个槽位 → 第三条才发出
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls.length).toBe(3))
  })

  it('a queued member cancelled before dispatch never fires its request (executeTask 入口守卫)', async () => {
    let releaseFirst: (() => void) | undefined
    vi.mocked(callImageApi).mockImplementation(
      () =>
        new Promise((_, reject) => {
          if (!releaseFirst) releaseFirst = () => reject(new Error('released'))
        }),
    )
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1, batchConcurrency: 1 },
      prompt: '{a|b|c}',
      showToast: vi.fn(),
    })

    await submitTask()
    await vi.waitFor(() => expect(vi.mocked(callImageApi).mock.calls.length).toBe(1))

    // 首条在途,其余两条排队(status 同为 running,无 controller)——对排队项逐条取消。
    // 注:callImageApi 收到的是 buildFinalPrompt(task.prompt, stylePreset) 的结果,
    // DEFAULT_PARAMS 无 stylePreset 时与 task.prompt 恒等;若默认参数未来引入风格前缀,此识别需改
    const inFlightPrompt = (vi.mocked(callImageApi).mock.calls[0][0] as { prompt: string }).prompt
    const queued = useStore.getState().tasks.filter((t) => t.prompt !== inFlightPrompt)
    expect(queued).toHaveLength(2)
    for (const q of queued) expect(cancelTask(q.id)).toBe(true)

    releaseFirst?.() // 释放首条,worker 取出两条已取消的排队项
    await vi.waitFor(() =>
      expect(useStore.getState().tasks.every((t) => t.status === 'error')).toBe(true),
    )
    // 入口守卫拦截:被取消的排队项从未发出请求
    expect(vi.mocked(callImageApi).mock.calls.length).toBe(1)
    for (const q of queued) {
      expect(useStore.getState().tasks.find((t) => t.id === q.id)?.error).toBe('已取消生成')
    }
  })

  it('cancelBatch aborts in-flight members and skips queued ones, reporting counts', async () => {
    const signals: AbortSignal[] = []
    vi.mocked(callImageApi).mockImplementation((opts) => {
      signals.push((opts as { signal: AbortSignal }).signal)
      return new Promise(() => undefined)
    })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1, batchConcurrency: 2 },
      prompt: '{a|b|c|d}',
      showToast: vi.fn(),
    })

    await submitTask()
    await vi.waitFor(() => expect(signals.length).toBe(2)) // 2 在途 + 2 排队
    const batchId = useStore.getState().tasks[0].batchId

    expect(cancelBatch(batchId ?? '')).toEqual({ aborted: 2, skipped: 2 })
    expect(signals.every((s) => s.aborted)).toBe(true) // 在途请求被真中止
    const tasks = useStore.getState().tasks
    expect(tasks).toHaveLength(4)
    expect(tasks.every((t) => t.status === 'error' && t.error === '已取消生成')).toBe(true)
    // 幂等:已无 running 成员
    expect(cancelBatch(batchId ?? '')).toEqual({ aborted: 0, skipped: 0 })
    // 守卫兜底:排队项被取出时不发请求
    expect(vi.mocked(callImageApi).mock.calls.length).toBe(2)
  })

  it('cancelBatch never reverts a done member and scopes to its batchId; cancelAllRunning sweeps all', () => {
    const done = task({ id: 'd1', batchId: 'A', status: 'done' })
    const runningA = task({ id: 'r1', batchId: 'A', status: 'running' })
    const runningB = task({ id: 'r2', batchId: 'B', status: 'running' })
    const loner = task({ id: 'r3', status: 'running' }) // 无 batchId 单条
    useStore.setState({ tasks: [done, runningA, runningB, loner] })

    // TOCTOU 竞态守卫(spec §4.3):filter 快照后成员翻 done → cancelTask 重 find 命中
    // status guard 不回改。同步循环内无法自然触发该窗口,直接对 done 任务调 cancelTask
    // 验证 guard 本身(filter 作用域的排除在下面 cancelBatch 断言中另行覆盖)
    expect(cancelTask('d1')).toBe(false)
    expect(useStore.getState().tasks.find((t) => t.id === 'd1')?.status).toBe('done')

    // 只圈定 A 的 running 成员(无 controller → skipped);done 不回改
    expect(cancelBatch('A')).toEqual({ aborted: 0, skipped: 1 })
    expect(useStore.getState().tasks.find((t) => t.id === 'd1')?.status).toBe('done')
    expect(useStore.getState().tasks.find((t) => t.id === 'r1')?.error).toBe('已取消生成')
    expect(useStore.getState().tasks.find((t) => t.id === 'r2')?.status).toBe('running')
    expect(useStore.getState().tasks.find((t) => t.id === 'r3')?.status).toBe('running')

    // cancelAllRunning 扫掉剩余全部在途(跨 batchId + 无 batchId 单条)
    expect(cancelAllRunning()).toEqual({ aborted: 0, skipped: 2 })
    expect(useStore.getState().tasks.filter((t) => t.status === 'running')).toHaveLength(0)
  })

  it('cancelled grid cells are revivable via retryGridMissing (取消=失败的一种,补跑语义)', async () => {
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    useStore.setState({ prompt: 'a cat', params: { ...DEFAULT_PARAMS }, showToast: vi.fn() })
    const xAxis = {
      kind: 'quality' as const,
      values: [{ key: 'low', label: 'low' }, { key: 'high', label: 'high' }],
    }
    await submitGridTask({ x: xAxis })
    const batchId = useStore.getState().tasks[0].batchId ?? ''

    cancelBatch(batchId)
    expect(
      useStore.getState().tasks.every((t) => t.status === 'error' && t.error === '已取消生成'),
    ).toBe(true)

    // 取消格被判缺漏,补跑重新 enqueue 新 running task(gridAxes/gridCoord 保留使矩阵可重建)
    retryGridMissing(batchId, 'all')
    await vi.waitFor(() => {
      const running = useStore.getState().tasks.filter((t) => t.status === 'running')
      expect(running).toHaveLength(2)
      expect(running.every((t) => t.batchId === batchId && t.gridCoord)).toBe(true)
    })
  })
})
