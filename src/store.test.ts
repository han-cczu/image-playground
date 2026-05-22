import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS } from './lib/api/apiProfiles'
import type { FavoriteCategory, TaskRecord } from './types'
import {
  clearTaskFavorite,
  editOutputs,
  markInterruptedSyncHttpTasks,
  mergePersistedStoreState,
  setTaskFavoriteCategory,
  submitTask,
  updateTaskInStore,
  useStore,
} from './store'
import { DEFAULT_FAVORITE_CATEGORY_COLOR, DEFAULT_FAVORITE_CATEGORY_ID } from './lib/favoriteCategories'

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

import { deleteConversation, putConversation, putTask, storeImage } from './lib/db'
import { callImageApi } from './lib/api'
import { ARCHIVE_CONVERSATION_ID } from './lib/conversations'

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
