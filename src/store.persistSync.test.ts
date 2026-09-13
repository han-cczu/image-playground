// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PERSIST_STORAGE_KEY, useStore } from './store'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS } from './lib/api/apiProfiles'
import { MAX_TASKS } from './lib/tasks'
import type { TaskRecord } from './types'

vi.mock('./lib/db', () => ({
  IDB_CHANGE_STORAGE_KEY: 'image-playground.idbChange',
  getAllConversations: vi.fn(async () => []),
  getAllTasks: vi.fn(async () => []),
  getImage: vi.fn(async () => undefined),
  persistConversationMigration: vi.fn(async () => undefined),
  putConversation: vi.fn(async () => 'conversation-id'),
  putTask: vi.fn(async () => 'task-id'),
  storeImage: vi.fn(async () => 'generated-image-id'),
  storedImageToDataUrl: vi.fn(async () => undefined),
  deleteImage: vi.fn(async () => undefined),
  deleteTask: vi.fn(async () => undefined),
}))

vi.mock('./lib/api', () => ({
  callImageApi: vi.fn(async () => ({
    images: ['data:image/png;base64,AQID'],
    actualParams: {},
  })),
}))

vi.mock('./lib/image/canvasImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/image/canvasImage')>()
  return {
    ...actual,
    getImageDimensions: vi.fn(async () => ({ width: 16, height: 16 })),
  }
})

import {
  IDB_CHANGE_STORAGE_KEY,
  getAllConversations,
  getAllTasks,
  getImage,
  putTask,
  deleteTask,
  putConversation,
  storeImage,
  storedImageToDataUrl,
} from './lib/db'
import { callImageApi } from './lib/api'
import { resetTaskRuntimeForTest } from './lib/taskRuntime'
import { refreshIndexedDbBackedStoreState } from './store/idbSync'
import { removeTask, submitTask, updateTaskInStore } from './store'

function dispatchStorageEvent(init: StorageEventInit) {
  window.dispatchEvent(new StorageEvent('storage', init))
}

describe('store persist cross-tab sync', () => {
  afterEach(() => {
    resetTaskRuntimeForTest()
    vi.restoreAllMocks()
    vi.mocked(getAllConversations).mockReset()
    vi.mocked(getAllConversations).mockResolvedValue([])
    vi.mocked(getAllTasks).mockReset()
    vi.mocked(getAllTasks).mockResolvedValue([])
    vi.mocked(getImage).mockReset()
    vi.mocked(getImage).mockResolvedValue(undefined)
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask).mockResolvedValue('task-id')
    vi.mocked(storeImage).mockReset()
    vi.mocked(storeImage).mockResolvedValue('generated-image-id')
    vi.mocked(storedImageToDataUrl).mockReset()
    vi.mocked(storedImageToDataUrl).mockResolvedValue(undefined)
    vi.mocked(callImageApi).mockReset()
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,AQID'],
      actualParams: {},
    })
    useStore.setState(useStore.getInitialState(), true)
  })

  it('rehydrates when another tab updates the persisted store', () => {
    const rehydrate = vi.spyOn(useStore.persist, 'rehydrate').mockResolvedValue(undefined)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: '{"state":{"prompt":"from-other-tab"}}',
      storageArea: window.localStorage,
    })

    expect(rehydrate).toHaveBeenCalledTimes(1)
  })

  it('syncs cross-tab persisted fields without clearing transient UI state', async () => {
    useStore.setState({
      prompt: 'local prompt',
      showSettings: true,
      selectedTaskIds: ['selected-task'],
      detailTaskId: 'selected-task',
      searchQuery: 'local search',
    })
    const persistedValue = JSON.stringify({
      state: {
        prompt: 'from-other-tab',
        sidebarCollapsed: true,
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().prompt).toBe('from-other-tab'))
    expect(useStore.getState()).toMatchObject({
      sidebarCollapsed: true,
      showSettings: true,
      selectedTaskIds: ['selected-task'],
      detailTaskId: 'selected-task',
      searchQuery: 'local search',
    })
  })

  it('clears transient image UI references to input images removed by cross-tab rehydrate', async () => {
    const taskRecord = task({ id: 'kept-task', outputImages: ['kept-output'] })
    useStore.setState({
      tasks: [taskRecord],
      inputImages: [{ id: 'old-input', dataUrl: 'data:image/png;base64,a' }],
      maskDraft: {
        targetImageId: 'old-input',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      lightboxImageId: 'old-input',
      lightboxImageList: ['old-input', 'kept-output'],
      captionBatchImageIds: ['old-input', 'kept-output'],
      maskEditorImageId: 'old-input',
    })
    const persistedValue = JSON.stringify({
      state: {
        inputImages: [],
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().inputImages).toEqual([]))
    expect(useStore.getState().lightboxImageId).toBeNull()
    expect(useStore.getState().lightboxImageList).toEqual(['kept-output'])
    expect(useStore.getState().captionBatchImageIds).toEqual(['kept-output'])
    expect(useStore.getState().maskDraft).toBeNull()
    expect(useStore.getState().maskEditorImageId).toBeNull()
  })

  it('preserves loaded input image data when a cross-tab rehydrate keeps the same image id', async () => {
    useStore.setState({
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,loaded' }],
    })
    const persistedValue = JSON.stringify({
      state: {
        inputImages: [{ id: 'input-a' }],
        sidebarCollapsed: true,
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().sidebarCollapsed).toBe(true))
    expect(useStore.getState().inputImages).toEqual([
      { id: 'input-a', dataUrl: 'data:image/png;base64,loaded' },
    ])
  })

  it('keeps current input images when a cross-tab rehydrate omits the inputImages field', async () => {
    useStore.setState({
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,loaded' }],
    })
    const persistedValue = JSON.stringify({
      state: {
        sidebarCollapsed: true,
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().sidebarCollapsed).toBe(true))
    expect(useStore.getState().inputImages).toEqual([
      { id: 'input-a', dataUrl: 'data:image/png;base64,loaded' },
    ])
  })

  it('restores input image data added by another tab after cross-tab rehydrate', async () => {
    vi.mocked(getImage).mockResolvedValue({ id: 'input-a' } as never)
    vi.mocked(storedImageToDataUrl).mockResolvedValue('data:image/png;base64,loaded')
    const persistedValue = JSON.stringify({
      state: {
        inputImages: [{ id: 'input-a' }],
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() =>
      expect(useStore.getState().inputImages).toEqual([
        { id: 'input-a', dataUrl: 'data:image/png;base64,loaded' },
      ]),
    )
    expect(getImage).toHaveBeenCalledWith('input-a')
    expect(storedImageToDataUrl).toHaveBeenCalled()
  })

  it('drops cross-tab input images whose stored data cannot be read', async () => {
    const showToast = vi.fn()
    useStore.setState({ showToast })
    vi.mocked(getImage).mockRejectedValue(new Error('db unavailable'))
    const persistedValue = JSON.stringify({
      state: {
        inputImages: [{ id: 'input-a' }],
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().inputImages).toEqual([]))
    expect(getImage).toHaveBeenCalledWith('input-a')
    expect(showToast).toHaveBeenCalledWith('恢复参考图失败：db unavailable', 'error')
  })

  it('clears transient image UI references when unresolved cross-tab input images are dropped', async () => {
    useStore.setState({
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      maskDraft: {
        targetImageId: 'input-a',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'input-a',
    })
    const persistedValue = JSON.stringify({
      state: {
        inputImages: [{ id: 'input-a' }],
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().inputImages).toEqual([]))
    expect(useStore.getState().lightboxImageId).toBeNull()
    expect(useStore.getState().lightboxImageList).toEqual([])
    expect(useStore.getState().captionBatchImageIds).toBeNull()
    expect(useStore.getState().maskDraft).toBeNull()
    expect(useStore.getState().maskEditorImageId).toBeNull()
  })

  it('does not re-add a cross-tab input image removed locally while its data is restoring', async () => {
    const pendingImage = createDeferred<{ id: string }>()
    vi.mocked(getImage).mockReturnValue(pendingImage.promise as never)
    vi.mocked(storedImageToDataUrl).mockResolvedValue('data:image/png;base64,loaded')
    const persistedValue = JSON.stringify({
      state: {
        inputImages: [{ id: 'input-a' }],
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })
    await vi.waitFor(() => expect(getImage).toHaveBeenCalledWith('input-a'))

    useStore.getState().clearInputImages()
    pendingImage.resolve({ id: 'input-a' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useStore.getState().inputImages).toEqual([])
  })

  it('ignores stale input-image restore failures after a newer cross-tab rehydrate', async () => {
    const oldRestore = createDeferred<{ id: string }>()
    const showToast = vi.fn()
    useStore.setState({ showToast })
    vi.mocked(getImage).mockImplementation((id: string) =>
      id === 'input-a' ? (oldRestore.promise as never) : Promise.resolve({ id } as never),
    )
    vi.mocked(storedImageToDataUrl).mockImplementation(
      async (image: { id: string }) => `data:image/png;base64,${image.id}`,
    )
    const firstPersistedValue = JSON.stringify({
      state: {
        inputImages: [{ id: 'input-a' }],
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, firstPersistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: firstPersistedValue,
      storageArea: window.localStorage,
    })
    await vi.waitFor(() => expect(getImage).toHaveBeenCalledWith('input-a'))

    const secondPersistedValue = JSON.stringify({
      state: {
        inputImages: [{ id: 'input-b' }],
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, secondPersistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: secondPersistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() =>
      expect(useStore.getState().inputImages).toEqual([
        { id: 'input-b', dataUrl: 'data:image/png;base64,input-b' },
      ]),
    )

    oldRestore.reject(new Error('old restore failed'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useStore.getState().inputImages).toEqual([
      { id: 'input-b', dataUrl: 'data:image/png;base64,input-b' },
    ])
    expect(showToast).not.toHaveBeenCalled()
  })

  it('reports cross-tab persisted rehydrate failures', async () => {
    const showToast = vi.fn()
    useStore.setState({ showToast })
    vi.spyOn(useStore.persist, 'rehydrate').mockRejectedValue(new Error('rehydrate failed'))
    const persistedValue = JSON.stringify({
      state: {
        prompt: 'from-other-tab',
      },
      version: 0,
    })
    window.localStorage.setItem(PERSIST_STORAGE_KEY, persistedValue)

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: persistedValue,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('同步本地设置失败：rehydrate failed', 'error'),
    )
  })

  it('rehydrates when another tab clears localStorage', async () => {
    const rehydrate = vi.spyOn(useStore.persist, 'rehydrate').mockResolvedValue(undefined)

    dispatchStorageEvent({
      key: null,
      newValue: null,
      storageArea: window.localStorage,
    })

    expect(rehydrate).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(getAllTasks).toHaveBeenCalledTimes(1))
  })

  it('clears current input images when another tab clears localStorage', async () => {
    window.localStorage.removeItem(PERSIST_STORAGE_KEY)
    useStore.setState({
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,loaded' }],
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      maskDraft: {
        targetImageId: 'input-a',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'input-a',
    })

    dispatchStorageEvent({
      key: null,
      newValue: null,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().inputImages).toEqual([]))
    expect(useStore.getState().lightboxImageId).toBeNull()
    expect(useStore.getState().lightboxImageList).toEqual([])
    expect(useStore.getState().captionBatchImageIds).toBeNull()
    expect(useStore.getState().maskDraft).toBeNull()
    expect(useStore.getState().maskEditorImageId).toBeNull()
  })

  it('still resets persisted state and syncs IndexedDB when localStorage clear rehydrate fails', async () => {
    const showToast = vi.fn()
    window.localStorage.removeItem(PERSIST_STORAGE_KEY)
    useStore.setState({
      prompt: 'local prompt',
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,loaded' }],
      showToast,
    })
    vi.spyOn(useStore.persist, 'rehydrate').mockRejectedValue(new Error('rehydrate failed'))

    dispatchStorageEvent({
      key: null,
      newValue: null,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(getAllTasks).toHaveBeenCalledTimes(1))
    expect(useStore.getState().prompt).toBe('')
    expect(useStore.getState().inputImages).toEqual([])
    expect(showToast).toHaveBeenCalledWith('同步本地设置失败：rehydrate failed', 'error')
  })

  it('resets persisted state when another tab removes only the persisted store key', async () => {
    window.localStorage.removeItem(PERSIST_STORAGE_KEY)
    useStore.setState({
      prompt: 'local prompt',
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,loaded' }],
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      maskDraft: {
        targetImageId: 'input-a',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'input-a',
    })

    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      oldValue: '{"state":{"prompt":"local prompt"}}',
      newValue: null,
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => expect(useStore.getState().prompt).toBe(''))
    expect(useStore.getState().inputImages).toEqual([])
    expect(useStore.getState().lightboxImageId).toBeNull()
    expect(useStore.getState().lightboxImageList).toEqual([])
    expect(useStore.getState().captionBatchImageIds).toBeNull()
    expect(useStore.getState().maskDraft).toBeNull()
    expect(useStore.getState().maskEditorImageId).toBeNull()
    expect(getAllTasks).not.toHaveBeenCalled()
  })

  it('ignores unrelated storage changes', () => {
    const rehydrate = vi.spyOn(useStore.persist, 'rehydrate').mockResolvedValue(undefined)

    dispatchStorageEvent({
      key: 'other-key',
      newValue: '{"state":{}}',
      storageArea: window.localStorage,
    })
    dispatchStorageEvent({
      key: PERSIST_STORAGE_KEY,
      newValue: '{"state":{}}',
      storageArea: window.sessionStorage,
    })

    expect(rehydrate).not.toHaveBeenCalled()
  })

  it('ignores sessionStorage clear events', async () => {
    const rehydrate = vi.spyOn(useStore.persist, 'rehydrate').mockResolvedValue(undefined)

    dispatchStorageEvent({
      key: null,
      newValue: null,
      storageArea: window.sessionStorage,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rehydrate).not.toHaveBeenCalled()
    expect(getAllTasks).not.toHaveBeenCalled()
  })

  it('refreshes IndexedDB-backed tasks and conversations when another tab changes them', async () => {
    const staleTask = task({ id: 'stale-task', outputImages: ['stale-image'] })
    const freshTask = task({ id: 'fresh-task', outputImages: ['fresh-image'] })
    useStore.setState({
      tasks: [staleTask],
      conversations: [
        { id: 'stale-conv', title: 'Stale', createdAt: 1, updatedAt: 1, sortOrder: 0, color: null },
      ],
      activeConversationId: 'stale-conv',
      detailTaskId: 'stale-task',
      lightboxImageId: 'stale-image',
      lightboxImageList: ['stale-image'],
      compareTaskIds: ['stale-task'],
      captionBatchImageIds: ['stale-image'],
      maskDraft: {
        targetImageId: 'stale-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'stale-image',
    })
    vi.mocked(getAllConversations).mockResolvedValue([
      { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
    ])
    vi.mocked(getAllTasks).mockResolvedValue([freshTask])

    dispatchStorageEvent({
      key: IDB_CHANGE_STORAGE_KEY,
      newValue: '2',
      storageArea: window.localStorage,
    })

    await vi.waitFor(() => {
      expect(useStore.getState().tasks.map((item) => item.id)).toEqual(['fresh-task'])
    })
    expect(useStore.getState().conversations.map((item) => item.id)).toEqual(['fresh-conv'])
    expect(useStore.getState().activeConversationId).toBe('fresh-conv')
    expect(useStore.getState().detailTaskId).toBeNull()
    expect(useStore.getState().lightboxImageId).toBeNull()
    expect(useStore.getState().lightboxImageList).toEqual([])
    expect(useStore.getState().compareTaskIds).toBeNull()
    expect(useStore.getState().captionBatchImageIds).toBeNull()
    expect(useStore.getState().maskDraft).toBeNull()
    expect(useStore.getState().maskEditorImageId).toBeNull()
  })

  it('keeps a valid active conversation when localStorage clear rehydrate finishes after IndexedDB refresh', async () => {
    const rehydrate = createDeferred<void>()
    vi.spyOn(useStore.persist, 'rehydrate').mockImplementation(() =>
      rehydrate.promise.then(() => {
        useStore.setState({ activeConversationId: null })
      }),
    )
    vi.mocked(getAllConversations).mockResolvedValue([
      { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
    ])
    vi.mocked(getAllTasks).mockResolvedValue([])
    useStore.setState({
      conversations: [
        { id: 'stale-conv', title: 'Stale', createdAt: 1, updatedAt: 1, sortOrder: 0, color: null },
      ],
      activeConversationId: 'stale-conv',
    })

    dispatchStorageEvent({
      key: null,
      newValue: null,
      storageArea: window.localStorage,
    })

    rehydrate.resolve()
    await rehydrate.promise
    await vi.waitFor(() => expect(getAllTasks).toHaveBeenCalledTimes(1))

    expect(useStore.getState().activeConversationId).toBe('fresh-conv')
  })

  it('drops persisted running tasks missing from refreshed IndexedDB snapshot', async () => {
    const removedRunningTask = task({
      id: 'removed-running',
      status: 'running',
      finishedAt: null,
      elapsed: null,
    })
    useStore.setState({
      tasks: [removedRunningTask],
      conversations: [
        { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
      ],
      activeConversationId: 'fresh-conv',
      selectedTaskIds: ['removed-running'],
      detailTaskId: 'removed-running',
    })
    vi.mocked(getAllConversations).mockResolvedValue([
      { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
    ])
    vi.mocked(getAllTasks).mockResolvedValue([])

    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().selectedTaskIds).toEqual([])
    expect(useStore.getState().detailTaskId).toBeNull()
  })

  it('跨标签刷新时库内任务超过 MAX_TASKS 条也全部进 store,不丢最新任务', async () => {
    // 与 initStore 同一条回归:刷新快照若被导入用的 MAX_TASKS 截断,最新任务会从 UI「消失」
    const base = 1_700_000_000_000
    const total = MAX_TASKS + 1
    const newestId = (base + total - 1).toString(36)
    vi.mocked(getAllConversations).mockResolvedValue([
      { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
    ])
    vi.mocked(getAllTasks).mockResolvedValue(
      Array.from({ length: total }, (_, index) =>
        task({ id: (base + index).toString(36), createdAt: base + index }),
      ),
    )
    useStore.setState({ tasks: [], activeConversationId: 'fresh-conv' })

    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().tasks).toHaveLength(total)
    expect(useStore.getState().tasks.some((item) => item.id === newestId)).toBe(true)
  })

  it('aborts local API requests for running tasks removed by refreshed IndexedDB snapshot', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(callImageApi).mockImplementation(
      (opts) =>
        new Promise((_resolve, reject) => {
          signal = opts.signal
          opts.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    vi.mocked(getAllConversations).mockResolvedValue([
      { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
    ])
    vi.mocked(getAllTasks).mockResolvedValue([])
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      conversations: [
        { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
      ],
      activeConversationId: 'fresh-conv',
      showToast: vi.fn(),
    })

    await submitTask()
    await vi.waitFor(() => expect(signal).toBeDefined())
    const runningTaskId = useStore.getState().tasks[0]!.id

    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().tasks.some((item) => item.id === runningTaskId)).toBe(false)
    expect(signal?.aborted).toBe(true)
  })

  it('aborts local API requests for running tasks stopped by refreshed IndexedDB snapshot', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(callImageApi).mockImplementation(
      (opts) =>
        new Promise((_resolve, reject) => {
          signal = opts.signal
          opts.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    vi.mocked(getAllConversations).mockResolvedValue([
      { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
    ])
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      conversations: [
        { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
      ],
      activeConversationId: 'fresh-conv',
      showToast: vi.fn(),
    })

    await submitTask()
    await vi.waitFor(() => expect(signal).toBeDefined())
    const runningTask = useStore.getState().tasks[0]!
    vi.mocked(getAllTasks).mockResolvedValue([
      {
        ...runningTask,
        status: 'error',
        error: '已取消生成',
        finishedAt: runningTask.createdAt + 1,
        elapsed: 1,
      },
    ])

    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().tasks[0]).toMatchObject({
      id: runningTask.id,
      status: 'error',
      error: '已取消生成',
    })
    expect(signal?.aborted).toBe(true)
  })

  it('keeps locally pending running tasks while refreshing IndexedDB-backed state', async () => {
    const persist = createDeferred<IDBValidKey>()
    vi.mocked(putTask).mockReturnValueOnce(persist.promise)
    vi.mocked(getAllConversations).mockResolvedValue([
      { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
    ])
    vi.mocked(getAllTasks).mockResolvedValue([])
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      conversations: [
        { id: 'fresh-conv', title: 'Fresh', createdAt: 2, updatedAt: 2, sortOrder: 0, color: null },
      ],
      activeConversationId: 'fresh-conv',
      showToast: vi.fn(),
    })

    const submitting = submitTask()
    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('running'))
    const pendingTaskId = useStore.getState().tasks[0]!.id

    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().tasks.map((item) => item.id)).toContain(pendingTaskId)

    persist.resolve('task-id')
    await submitting
    await vi.waitFor(() => expect(callImageApi).toHaveBeenCalledTimes(1))
  })
})

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
    conversationId: 'fresh-conv',
    ...overrides,
  }
}

describe('跨标签页刷新不回滚本地未落盘变更(idbSyncState 总账)', () => {
  const baseTask: TaskRecord = {
    id: 'task-1',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
    conversationId: 'conv-a',
  }
  const conv = { id: 'conv-a', title: 'A', createdAt: 1, updatedAt: 1, sortOrder: 0, color: null }

  afterEach(() => {
    resetTaskRuntimeForTest()
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask).mockResolvedValue('task-id')
    vi.mocked(deleteTask).mockReset()
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    vi.mocked(putConversation).mockReset()
    vi.mocked(putConversation).mockResolvedValue('conversation-id')
    vi.mocked(getAllTasks).mockReset()
    vi.mocked(getAllTasks).mockResolvedValue([])
    vi.mocked(getAllConversations).mockReset()
    vi.mocked(getAllConversations).mockResolvedValue([])
    useStore.setState(useStore.getInitialState(), true)
  })

  it('完成落 done 尚未落盘时,读到陈旧 running 快照的刷新保留本地 done', async () => {
    const persist = createDeferred<IDBValidKey>()
    vi.mocked(putTask).mockReturnValueOnce(persist.promise)
    vi.mocked(getAllTasks).mockResolvedValue([baseTask])
    vi.mocked(getAllConversations).mockResolvedValue([conv])
    useStore.setState({ tasks: [baseTask], conversations: [conv], activeConversationId: 'conv-a' })

    const writing = updateTaskInStore('task-1', {
      status: 'done',
      outputImages: ['img'],
      finishedAt: 5,
      elapsed: 4,
    })
    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', outputImages: ['img'] })
    persist.resolve('task-id')
    await writing

    // 落盘后总账已清:之后的刷新以库为准(另一标签页的合法修改要能生效)
    vi.mocked(getAllTasks).mockResolvedValue([
      { ...baseTask, status: 'error', error: '已取消生成', finishedAt: 9, elapsed: 8 },
    ])
    await refreshIndexedDbBackedStoreState()
    expect(useStore.getState().tasks[0]).toMatchObject({ status: 'error', error: '已取消生成' })
  })

  it('刷新读取期间完成落盘后,迟到的旧快照不能把 done 回退为 running', async () => {
    const reading = createDeferred<(typeof conv)[]>()
    vi.mocked(getAllConversations).mockReturnValueOnce(reading.promise).mockResolvedValue([conv])
    vi.mocked(getAllTasks).mockResolvedValueOnce([baseTask])
    useStore.setState({ tasks: [baseTask], conversations: [conv], activeConversationId: 'conv-a' })

    const refreshing = refreshIndexedDbBackedStoreState()
    await updateTaskInStore('task-1', {
      status: 'done',
      outputImages: ['img'],
      finishedAt: 5,
      elapsed: 4,
    })
    // 此时 pending write 已清零,但前面的读取仍握着旧 running 快照。
    vi.mocked(getAllTasks).mockResolvedValue(useStore.getState().tasks)
    reading.resolve([conv])
    await refreshing

    expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', outputImages: ['img'] })
  })

  it('刷新读取期间删除已落盘,迟到的旧快照不能复活任务', async () => {
    const reading = createDeferred<(typeof conv)[]>()
    const doneTask: TaskRecord = { ...baseTask, status: 'done', finishedAt: 2, elapsed: 1 }
    vi.mocked(getAllConversations).mockReturnValueOnce(reading.promise).mockResolvedValue([conv])
    vi.mocked(getAllTasks).mockResolvedValueOnce([doneTask])
    useStore.setState({ tasks: [doneTask], conversations: [conv], activeConversationId: 'conv-a' })

    const refreshing = refreshIndexedDbBackedStoreState()
    await removeTask(doneTask)
    vi.mocked(getAllTasks).mockResolvedValue([])
    reading.resolve([conv])
    await refreshing

    expect(useStore.getState().tasks).toEqual([])
  })

  it('删除尚未落盘时,仍含该记录的快照不能把它复活', async () => {
    const deleting = createDeferred<undefined>()
    vi.mocked(deleteTask).mockReturnValueOnce(deleting.promise)
    const doneTask: TaskRecord = { ...baseTask, status: 'done', finishedAt: 2, elapsed: 1 }
    vi.mocked(getAllTasks).mockResolvedValue([doneTask])
    vi.mocked(getAllConversations).mockResolvedValue([conv])
    useStore.setState({ tasks: [doneTask], conversations: [conv], activeConversationId: 'conv-a' })

    const removing = removeTask(doneTask)
    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().tasks).toEqual([])
    deleting.resolve(undefined)
    await removing
  })

  it('新建对话尚未落盘时,刷新不把它连同 activeConversationId 一起抹掉', async () => {
    const persist = createDeferred<IDBValidKey>()
    vi.mocked(putConversation).mockReturnValueOnce(persist.promise)
    vi.mocked(getAllConversations).mockResolvedValue([conv])
    useStore.setState({ tasks: [], conversations: [conv], activeConversationId: 'conv-a' })

    const id = useStore.getState().createConversation()
    await refreshIndexedDbBackedStoreState()

    expect(useStore.getState().conversations.some((c) => c.id === id)).toBe(true)
    expect(useStore.getState().activeConversationId).toBe(id)
    persist.resolve('conversation-id')
    await Promise.resolve()
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
