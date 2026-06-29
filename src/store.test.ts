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
  addImageFromUrl,
  removeMultipleTasks,
  removeTask,
  reorderTask,
  reuseConfig,
  useStore,
} from './store'
import {
  DEFAULT_FAVORITE_CATEGORY_COLOR,
  DEFAULT_FAVORITE_CATEGORY_ID,
} from './lib/favoriteCategories'
import { MAX_BATCH_NOTES } from './lib/gridSheet'
import { MAX_INPUT_IMAGES_PER_SUBMISSION, MAX_TASK_TEXT_LEN } from './lib/tasks'
import { MAX_DISMISSED_CODEX_CLI_PROMPT_KEY_LEN, partialize } from './store/persist'
import { shouldAutoStartTour } from './lib/tour/autoStart'

vi.mock('./lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/db')>()
  return {
    ...actual,
    putTask: vi.fn(actual.putTask),
    storeImage: vi.fn(actual.storeImage),
    getImage: vi.fn(actual.getImage),
    putConversation: vi.fn(async () => 'conv-id'),
    deleteConversation: vi.fn(async () => undefined),
    // clearAllData 路径(M3 测试)触达的清库原语:node 环境无 indexedDB,真实现会炸
    clearTasks: vi.fn(async () => undefined),
    clearImages: vi.fn(async () => undefined),
    clearConversations: vi.fn(async () => undefined),
    persistConversationMigration: vi.fn(async () => undefined),
    deleteTask: vi.fn(async () => undefined),
    deleteImage: vi.fn(async () => undefined),
  }
})

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>()
  return {
    ...actual,
    callImageApi: vi.fn(actual.callImageApi),
  }
})

vi.mock('./lib/image/canvasImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/image/canvasImage')>()
  return {
    ...actual,
    getImageDimensions: vi.fn(async () => ({ width: 16, height: 16 })),
    validateMaskMatchesImage: vi.fn(actual.validateMaskMatchesImage),
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

import {
  deleteConversation,
  deleteImage,
  deleteTask,
  getImage,
  putConversation,
  putTask,
  storeImage,
} from './lib/db'
import { callImageApi } from './lib/api'
import {
  ARCHIVE_CONVERSATION_ID,
  MAX_CONVERSATION_ID_LEN,
  MAX_CONVERSATION_TITLE_LEN,
} from './lib/conversations'
import {
  resetTaskRuntimeForTest,
  resolveExecutionProfile,
  scheduleSyncHttpWatchdog,
} from './lib/taskRuntime'
import { MAX_TASK_PARAM_STRING_LEN } from './lib/api/paramCompatibility'
import { clearAllData } from './lib/exportImport'
import { mapWithConcurrency } from './lib/concurrency'
import { validateMaskMatchesImage } from './lib/image/canvasImage'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function expectLatestToastOnly(
  latestToast: ReturnType<typeof vi.fn>,
  oldToast: ReturnType<typeof vi.fn>,
  message: string,
  type: 'info' | 'success' | 'error',
) {
  expect(latestToast).toHaveBeenCalledWith(expect.stringContaining(message), type)
  expect(oldToast).not.toHaveBeenCalledWith(expect.stringContaining(message), type)
}

describe('ui slice boundaries', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('showToast caps live messages before they reach UI state', () => {
    vi.useFakeTimers()
    const longMessage = 'm'.repeat(MAX_TASK_TEXT_LEN + 50)

    useStore.getInitialState().showToast(longMessage, 'error')

    expect(useStore.getState().toast?.message).toBe(longMessage.slice(0, MAX_TASK_TEXT_LEN))
  })
})

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask).mockResolvedValue('task-id')
    vi.mocked(getImage).mockReset()
    vi.mocked(getImage).mockResolvedValue(undefined)
    vi.mocked(deleteTask).mockReset()
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    vi.mocked(deleteImage).mockReset()
    vi.mocked(deleteImage).mockResolvedValue(undefined)
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

  it('setPrompt caps live prompt text before it reaches persisted state', () => {
    const longPrompt = 'p'.repeat(MAX_TASK_TEXT_LEN + 50)

    useStore.getState().setPrompt(longPrompt)

    expect(useStore.getState().prompt).toBe(longPrompt.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('setParams caps live string params before they reach persisted state', () => {
    const long = 'x'.repeat(MAX_TASK_PARAM_STRING_LEN + 50)

    useStore.getState().setParams({ size: long, stylePreset: long })

    expect(useStore.getState().params.size).toHaveLength(MAX_TASK_PARAM_STRING_LEN)
    expect(useStore.getState().params.stylePreset).toHaveLength(MAX_TASK_PARAM_STRING_LEN)
  })

  it('setInputImages deduplicates by id while preserving mask target ordering', () => {
    const duplicateA = { id: imageA.id, dataUrl: 'data:image/png;base64,duplicate-a' }
    useStore.setState({
      maskDraft: {
        targetImageId: imageB.id,
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    useStore.getState().setInputImages([imageA, imageB, duplicateA, imageA])

    expect(useStore.getState().inputImages).toEqual([imageB, imageA])
  })

  it('setInputImages and addInputImage cap references at the submission limit', () => {
    const many = Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION + 5 }, (_, index) => ({
      id: `img-${index}`,
      dataUrl: `data:image/png;base64,${index}`,
    }))

    useStore.getState().setInputImages(many)

    expect(useStore.getState().inputImages).toHaveLength(MAX_INPUT_IMAGES_PER_SUBMISSION)
    expect(useStore.getState().inputImages[useStore.getState().inputImages.length - 1]?.id).toBe(
      `img-${MAX_INPUT_IMAGES_PER_SUBMISSION - 1}`,
    )

    useStore.getState().addInputImage({ id: 'overflow', dataUrl: 'data:image/png;base64,overflow' })

    expect(useStore.getState().inputImages).toHaveLength(MAX_INPUT_IMAGES_PER_SUBMISSION)
    expect(useStore.getState().inputImages.find((img) => img.id === 'overflow')).toBeUndefined()
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

  it('reports output image load failures without rejecting editOutputs', async () => {
    vi.mocked(getImage).mockRejectedValue(new Error('idb read failed'))
    useStore.setState({
      inputImages: [],
      showToast: vi.fn(),
    })

    await expect(editOutputs(task({ outputImages: ['missing-output'] }))).resolves.toBeUndefined()

    expect(useStore.getState().inputImages).toEqual([])
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('添加输出图失败'),
      'error',
    )
  })

  it('reports input image load failures without rejecting reuseConfig', async () => {
    vi.mocked(getImage).mockRejectedValue(new Error('idb read failed'))
    useStore.setState({
      prompt: 'old prompt',
      inputImages: [],
      maskDraft: {
        targetImageId: 'old-image',
        maskDataUrl: 'data:image/png;base64,old-mask',
        updatedAt: 1,
      },
      showToast: vi.fn(),
    })

    await expect(
      reuseConfig(
        task({
          prompt: 'reused prompt',
          inputImageIds: ['unreadable-input'],
          maskTargetImageId: 'unreadable-input',
          maskImageId: 'unreadable-mask',
        }),
      ),
    ).resolves.toBeUndefined()

    expect(useStore.getState().prompt).toBe('reused prompt')
    expect(useStore.getState().inputImages).toEqual([])
    expect(useStore.getState().maskDraft).toBeNull()
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('图片无法读取'),
      'error',
    )
  })

  it('reports when reuseConfig restores only the allowed number of input images', async () => {
    const imageIds = Array.from(
      { length: MAX_INPUT_IMAGES_PER_SUBMISSION + 1 },
      (_, index) => `reuse-image-${index}`,
    )
    vi.mocked(getImage).mockImplementation(async (id) => ({
      id,
      dataUrl: `data:image/png;base64,${id}`,
    }))
    useStore.setState({
      inputImages: [],
      showToast: vi.fn(),
    })

    await reuseConfig(task({ inputImageIds: imageIds }))

    expect(useStore.getState().inputImages).toHaveLength(MAX_INPUT_IMAGES_PER_SUBMISSION)
    const restoredImages = useStore.getState().inputImages
    expect(restoredImages[restoredImages.length - 1]?.id).toBe(
      `reuse-image-${MAX_INPUT_IMAGES_PER_SUBMISSION - 1}`,
    )
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      `已复用配置，但超过上限的 1 张参考图未加入`,
      'error',
    )
    expect(useStore.getState().showToast).not.toHaveBeenCalledWith('已复用配置到输入框', 'success')
  })

  it('does not repopulate input images when reuseConfig resolves after clearAllData', async () => {
    let resolveGetImage!: (value: { id: string; dataUrl: string }) => void
    vi.mocked(getImage).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGetImage = resolve
      }),
    )
    useStore.setState({
      inputImages: [],
      showToast: vi.fn(),
    })

    const pendingReuse = reuseConfig(task({ inputImageIds: ['stale-input'] }))
    await Promise.resolve()

    await clearAllData()
    resolveGetImage({ id: 'stale-input', dataUrl: 'data:image/png;base64,stale' })
    await pendingReuse

    expect(useStore.getState().inputImages).toEqual([])
  })

  it('replaces params completely when reusing a task without stylePreset', async () => {
    useStore.setState({
      params: { ...DEFAULT_PARAMS, n: 4, stylePreset: 'film' },
      showToast: vi.fn(),
    })

    await reuseConfig(
      task({
        params: { ...DEFAULT_PARAMS, quality: 'high' },
      }),
    )

    expect(useStore.getState().params).toEqual({
      ...DEFAULT_PARAMS,
      quality: 'high',
    })
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
    const legacyRunning = task({
      id: 'legacy-running',
      status: 'running',
      createdAt: 1_000,
      finishedAt: null,
      elapsed: null,
    })
    const openaiRunning = task({
      id: 'openai-running',
      apiProvider: 'openai',
      status: 'running',
      createdAt: 2_000,
      finishedAt: null,
      elapsed: null,
    })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedSyncHttpTasks([legacyRunning, openaiRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual([
      'legacy-running',
      'openai-running',
    ])
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
    vi.mocked(deleteImage).mockReset()
    vi.mocked(deleteImage).mockResolvedValue(undefined)
    vi.mocked(deleteTask).mockReset()
    vi.mocked(deleteTask).mockResolvedValue(undefined)
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

    await expect(updateTaskInStore('task-a', { isFavorite: true })).rejects.toThrow(
      'idb write failed',
    )

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
    expect(putTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'task-a',
        isFavorite: true,
        favoriteCategoryId: categoryA.id,
      }),
    )
    expect(putTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'task-a',
        isFavorite: false,
        favoriteCategoryId: null,
      }),
    )
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
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-a',
        isFavorite: true,
        favoriteCategoryId: DEFAULT_FAVORITE_CATEGORY_ID,
      }),
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

  it('clamps successful task elapsed time when the system clock moves backwards during execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.mocked(callImageApi).mockImplementation(async () => {
      vi.setSystemTime(5_000)
      return { images: ['data:image/png;base64,AQID'], actualParams: {} }
    })

    await submitTask()

    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('done'))
    const completed = useStore.getState().tasks[0]
    expect(completed.finishedAt).toBeLessThan(completed.createdAt)
    expect(completed.elapsed).toBe(0)
  })

  it('clamps failed task elapsed time when the system clock moves backwards during execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.mocked(callImageApi).mockImplementation(async () => {
      vi.setSystemTime(5_000)
      throw new Error('provider failed')
    })

    await submitTask()

    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('error'))
    const failed = useStore.getState().tasks[0]
    expect(failed.finishedAt).toBeLessThan(failed.createdAt)
    expect(failed.elapsed).toBe(0)
    expect(failed.error).toBe('provider failed')
  })

  it('addImageFromUrl rejects non-2xx responses before storing them as references', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Blob(['server error'], { type: 'image/png' }), { status: 500 }),
      ),
    )

    await expect(addImageFromUrl('https://example.test/error.png')).rejects.toThrow(/HTTP 500/)

    expect(storeImage).not.toHaveBeenCalled()
    expect(useStore.getState().inputImages).toEqual([])
  })

  it('addImageFromUrl rejects oversized responses from Content-Length before reading the body', async () => {
    const blob = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Length': String(51 * 1024 * 1024) }),
        blob,
      })),
    )

    await expect(addImageFromUrl('https://example.test/huge.png')).rejects.toThrow(/图片过大/)

    expect(blob).not.toHaveBeenCalled()
    expect(storeImage).not.toHaveBeenCalled()
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

  it('surfaces a request timeout when abort rejection wins the watchdog race', async () => {
    vi.useFakeTimers()
    vi.mocked(callImageApi).mockImplementation(
      (opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    useStore.setState({ prompt: 'prompt', showToast: vi.fn() })

    await submitTask()
    const pendingTimers = vi.advanceTimersByTimeAsync(600_000)
    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('error'))
    await pendingTimers

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求超时'),
    })
  })

  it('caps provider error messages before persisting failed tasks', async () => {
    const longError = 'e'.repeat(MAX_TASK_TEXT_LEN + 50)
    vi.mocked(callImageApi).mockRejectedValue(new Error(longError))
    useStore.setState({ prompt: 'prompt', showToast: vi.fn() })

    await submitTask()
    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('error'))

    expect(useStore.getState().tasks[0]?.error).toBe(longError.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('caps provider partial failure messages before persisting completed tasks', async () => {
    const longError = 'e'.repeat(MAX_TASK_TEXT_LEN + 50)
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,aW1hZ2U='],
      partialFailureCount: 1,
      partialFailureMessage: longError,
    })
    vi.mocked(storeImage).mockResolvedValue('generated-image-id')
    useStore.setState({ prompt: 'prompt', showToast: vi.fn() })

    await submitTask()
    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('done'))

    expect(useStore.getState().tasks[0]?.partialFailureMessage).toBe(
      longError.slice(0, MAX_TASK_TEXT_LEN),
    )
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

  it('reports delayed input image persistence failures through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const persist = createDeferred<string>()
    vi.mocked(storeImage).mockReturnValueOnce(persist.promise)
    useStore.setState({
      inputImages: [imageA],
      showToast: oldToast,
    })

    const submitting = submitTask()
    await Promise.resolve()
    useStore.setState({ showToast: latestToast })

    persist.reject(new Error('input store failed'))
    await submitting

    expectLatestToastOnly(latestToast, oldToast, '保存输入图片失败：input store failed', 'error')
  })

  it('reports wildcard submission preflight after async preparation through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const persist = createDeferred<string>()
    vi.mocked(storeImage).mockReturnValueOnce(persist.promise)
    useStore.setState({
      prompt: '{a|b}',
      inputImages: [imageA],
      showToast: oldToast,
    })

    const submitting = submitTask()
    await Promise.resolve()
    useStore.setState({ showToast: latestToast })

    persist.resolve(imageA.id)
    await submitting

    expectLatestToastOnly(latestToast, oldToast, '共 2 张图片', 'success')
  })

  it('watchdog times from request start, not createdAt (a stale createdAt must not shorten the window)', () => {
    vi.useFakeTimers()
    // 模拟「在并发闸里排队很久才被取出执行」的批量子任务:createdAt 远早于此刻调度 watchdog 的时刻。
    const staleTask = task({
      id: 'queued',
      status: 'running',
      apiProvider: 'openai',
      createdAt: Date.now() - 10_000_000,
    })
    useStore.setState({ tasks: [staleTask], showToast: vi.fn() })

    scheduleSyncHttpWatchdog('queued', 60) // 60s 超时

    // 修复前:remainingMs = 60000 - (now - createdAt) = 0 → 立即假超时。修复后应给完整 60s 窗口。
    vi.advanceTimersByTime(59_000)
    expect(useStore.getState().tasks[0].status).toBe('running')
    vi.advanceTimersByTime(2_000)
    expect(useStore.getState().tasks[0].status).toBe('error')
    expect(useStore.getState().tasks[0].error).toContain('超时')
  })

  it('caps huge watchdog timeouts before passing them to setTimeout', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const runningTask = task({
      id: 'huge-timeout',
      status: 'running',
      apiProvider: 'openai',
      createdAt: Date.now(),
    })
    useStore.setState({ tasks: [runningTask], showToast: vi.fn() })

    scheduleSyncHttpWatchdog('huge-timeout', Number.MAX_SAFE_INTEGER)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647)
  })

  it('falls back to the default watchdog timeout for non-finite timeout values', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const runningTask = task({
      id: 'non-finite-timeout',
      status: 'running',
      apiProvider: 'openai',
      createdAt: Date.now(),
    })
    useStore.setState({ tasks: [runningTask], showToast: vi.fn() })

    scheduleSyncHttpWatchdog('non-finite-timeout', Infinity)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), DEFAULT_SETTINGS.timeout * 1000)
  })

  it('queued batch members execute on the profile pinned at enqueue, not the active profile at dequeue', async () => {
    // M1(2026-06-10 审查修复):批量排队窗口内切 active profile,剩余成员曾静默换供应商执行,
    // 而任务记录的 apiProvider/apiModel 仍是入队旧值——对照实验样本被污染且事后不可检测。
    const geminiProfile = {
      id: 'pg',
      name: 'Gemini 实验',
      provider: 'gemini' as const,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gk',
      model: 'gemini-2.5-flash-image',
      timeout: 600,
    }
    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        timeout: 1,
        profiles: [...DEFAULT_SETTINGS.profiles, geminiProfile],
        batchConcurrency: 1,
      },
      prompt: '{x|y}',
      showToast: vi.fn(),
    })

    const seenProfiles: Array<{ name?: string; provider?: string } | undefined> = []
    let releaseFirst: (() => void) | undefined
    vi.mocked(callImageApi).mockImplementation((_opts, profileOverride) => {
      seenProfiles.push(profileOverride)
      return new Promise((resolve) => {
        const finish = () => resolve({ images: ['data:image/png;base64,AQID'], actualParams: {} })
        if (seenProfiles.length === 1) releaseFirst = finish
        else finish()
      })
    })

    await submitTask()
    await vi.waitFor(() => expect(seenProfiles).toHaveLength(1))
    const enqueuedProfileName = useStore.getState().tasks[0]?.apiProfileName
    expect(enqueuedProfileName).toBeTruthy()

    // 第一条在途、第二条还在并发闸(batchConcurrency=1)里排队时,切走 active profile
    useStore.setState((s) => ({ settings: { ...s.settings, activeProfileId: 'pg' } }))
    releaseFirst?.()

    await vi.waitFor(() => expect(seenProfiles).toHaveLength(2))
    // 排队成员仍以入队时的 openai profile 执行,而不是切换后的 gemini
    expect(seenProfiles[1]?.provider).toBe('openai')
    expect(seenProfiles[1]?.name).toBe(enqueuedProfileName)
  })

  it('clearAllData terminates in-flight tasks without writing ghost error records back (M3)', async () => {
    // 在途请求在 abort 时 reject;若 store 清空晚于 terminate 的同一同步段,
    // executeTask 的 catch 守卫会看到任务仍 running,把幽灵 error 记录 putTask 回刚清空的表
    vi.mocked(callImageApi).mockImplementation(
      (opts) =>
        new Promise((_, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    await submitTask()
    await vi.waitFor(() => expect(vi.mocked(callImageApi)).toHaveBeenCalledOnce())
    vi.mocked(putTask).mockClear()

    await clearAllData()
    // 给 abort rejection 的微任务链一个宏任务窗口走完 executeTask 的 catch 路径
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useStore.getState().tasks).toEqual([])
    expect(putTask).not.toHaveBeenCalled()
  })

  it('watchdog is disarmed once the response resolves: slow image persistence must not flip success to timeout', async () => {
    // M2(2026-06-10 审查修复):watchdog 计时窗口曾覆盖响应返回后的写图阶段,
    // deadline 落在 storeImage 循环内时,已成功的生成被翻成「请求超时」且刚存的图被回滚删除。
    vi.useFakeTimers()
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,AQID'],
      actualParams: {},
    })
    // 写图比 watchdog timeout(1s)慢
    vi.mocked(storeImage).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('slow-image-id'), 5_000)),
    )

    await submitTask()
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(useStore.getState().tasks[0]?.status).toBe('done'))

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'done',
      outputImages: ['slow-image-id'],
    })
  })

  it('rolls back output images already stored when a later output image persistence fails', async () => {
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,one', 'data:image/png;base64,two'],
      actualParams: {},
    })
    vi.mocked(storeImage)
      .mockResolvedValueOnce('stored-output-1')
      .mockRejectedValueOnce(new Error('second image store failed'))
    useStore.setState({ prompt: 'prompt', showToast: vi.fn() })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0]?.status).toBe('error')
    })
    expect(deleteImage).toHaveBeenCalledWith('stored-output-1')
    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: 'second image store failed',
      outputImages: [],
    })
  })

  it('still marks the task error when output rollback cleanup itself fails', async () => {
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,one', 'data:image/png;base64,two'],
      actualParams: {},
    })
    vi.mocked(storeImage)
      .mockResolvedValueOnce('stored-output-1')
      .mockRejectedValueOnce(new Error('second image store failed'))
    vi.mocked(deleteImage).mockRejectedValue(new Error('delete cleanup failed'))
    useStore.setState({ prompt: 'prompt', showToast: vi.fn() })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0]?.status).toBe('error')
    })
    expect(useStore.getState().tasks[0]?.error).toBe('second image store failed')
  })

  it('rolls back stored output images when persistence fails after the task was cancelled', async () => {
    vi.mocked(callImageApi).mockResolvedValue({
      images: ['data:image/png;base64,one', 'data:image/png;base64,two'],
      actualParams: {},
    })
    vi.mocked(storeImage)
      .mockResolvedValueOnce('stored-output-1')
      .mockImplementationOnce(async () => {
        const runningTask = useStore.getState().tasks[0]
        if (runningTask) cancelTask(runningTask.id)
        throw new Error('second image store failed')
      })
    useStore.setState({ prompt: 'prompt', showToast: vi.fn() })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks[0]?.error).toBe('已取消生成')
    })
    expect(deleteImage).toHaveBeenCalledWith('stored-output-1')
  })

  it('reports input image persistence failures without rejecting submitTask', async () => {
    vi.mocked(storeImage).mockRejectedValue(new Error('image store failed'))
    useStore.setState({
      prompt: 'prompt',
      inputImages: [imageA],
      showToast: vi.fn(),
    })

    await expect(submitTask()).resolves.toBeUndefined()

    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('保存输入图片失败'),
      'error',
    )
    expect(putTask).not.toHaveBeenCalled()
  })

  it('rolls back input images already stored when a later input image fails to persist', async () => {
    vi.mocked(storeImage)
      .mockResolvedValueOnce('stored-input-a')
      .mockRejectedValueOnce(new Error('second input store failed'))
    useStore.setState({
      prompt: 'prompt',
      inputImages: [imageA, imageB],
      showToast: vi.fn(),
    })

    await submitTask()

    expect(deleteImage).toHaveBeenCalledWith('stored-input-a')
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('保存输入图片失败'),
      'error',
    )
    expect(putTask).not.toHaveBeenCalled()
  })

  it('rolls back a stored mask when later input image persistence fails', async () => {
    vi.mocked(validateMaskMatchesImage).mockResolvedValueOnce('partial')
    vi.mocked(storeImage)
      .mockResolvedValueOnce('stored-mask-id')
      .mockRejectedValueOnce(new Error('image store failed'))
    useStore.setState({
      prompt: 'prompt',
      inputImages: [imageA],
      maskDraft: {
        targetImageId: imageA.id,
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      showToast: vi.fn(),
    })

    await submitTask()

    expect(deleteImage).toHaveBeenCalledWith('stored-mask-id')
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('保存输入图片失败'),
      'error',
    )
    expect(putTask).not.toHaveBeenCalled()
  })

  it('still reports input image persistence failure when stored mask rollback cleanup fails', async () => {
    vi.mocked(validateMaskMatchesImage).mockResolvedValueOnce('partial')
    vi.mocked(storeImage)
      .mockResolvedValueOnce('stored-mask-id')
      .mockRejectedValueOnce(new Error('image store failed'))
    vi.mocked(deleteImage).mockRejectedValueOnce(new Error('delete cleanup failed'))
    useStore.setState({
      prompt: 'prompt',
      inputImages: [imageA],
      maskDraft: {
        targetImageId: imageA.id,
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      showToast: vi.fn(),
    })

    await expect(submitTask()).resolves.toBeUndefined()

    expect(deleteImage).toHaveBeenCalledWith('stored-mask-id')
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('清理临时图片失败'),
      'error',
    )
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('保存输入图片失败'),
      'error',
    )
    expect(putTask).not.toHaveBeenCalled()
  })

  it('restores the task in UI and reports an error when deleting a task fails to persist', async () => {
    const deleting = task({ id: 'delete-me', outputImages: ['orphan-image'] })
    vi.mocked(deleteTask).mockRejectedValue(new Error('delete failed'))
    useStore.setState({
      tasks: [deleting],
      inputImages: [],
      showToast: vi.fn(),
    })

    await expect(removeTask(deleting)).rejects.toThrow('delete failed')

    expect(useStore.getState().tasks).toEqual([deleting])
    expect(deleteImage).not.toHaveBeenCalled()
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('删除记录失败'),
      'error',
    )
  })

  it('removes a successfully deleted single task from the selection', async () => {
    const deleting = task({ id: 'delete-me' })
    const untouched = task({ id: 'untouched' })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [deleting, untouched],
      inputImages: [],
      selectedTaskIds: ['delete-me', 'untouched'],
      showToast: vi.fn(),
    })

    await removeTask(deleting)

    expect(useStore.getState().selectedTaskIds).toEqual(['untouched'])
  })

  it('single deletion prunes an orphaned mask target image even when it is not in inputImageIds', async () => {
    const deleting = task({
      id: 'delete-me',
      inputImageIds: [],
      maskTargetImageId: 'mask-target',
      maskImageId: 'mask-image',
      outputImages: [],
    })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [deleting],
      inputImages: [],
      showToast: vi.fn(),
    })

    await removeTask(deleting)

    await vi.waitFor(() => expect(deleteImage).toHaveBeenCalledWith('mask-target'))
    await vi.waitFor(() => expect(deleteImage).toHaveBeenCalledWith('mask-image'))
  })

  it('clears transient UI references owned by a successfully deleted single task', async () => {
    const deleting = task({
      id: 'delete-me',
      inputImageIds: ['deleted-input'],
      outputImages: ['deleted-output'],
    })
    const untouched = task({ id: 'untouched', outputImages: ['kept-output'] })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [deleting, untouched],
      inputImages: [],
      detailTaskId: 'delete-me',
      lineageTaskId: 'delete-me',
      compareTaskIds: ['delete-me', 'untouched'],
      lightboxImageId: 'deleted-output',
      lightboxImageList: ['deleted-output', 'kept-output'],
      captionBatchImageIds: ['deleted-output', 'kept-output'],
      maskDraft: {
        targetImageId: 'deleted-output',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'deleted-output',
      showToast: vi.fn(),
    })

    await removeTask(deleting)

    expect(useStore.getState()).toMatchObject({
      detailTaskId: null,
      lineageTaskId: null,
      compareTaskIds: null,
      lightboxImageId: null,
      lightboxImageList: ['kept-output'],
      captionBatchImageIds: ['kept-output'],
      maskDraft: null,
      maskEditorImageId: null,
    })
  })

  it('keeps lightbox references for images still referenced after a single task deletion', async () => {
    const deleting = task({ id: 'delete-me', outputImages: ['shared-output'] })
    const untouched = task({ id: 'untouched', outputImages: ['shared-output'] })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [deleting, untouched],
      inputImages: [],
      lightboxImageId: 'shared-output',
      lightboxImageList: ['shared-output'],
      maskDraft: {
        targetImageId: 'shared-output',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      showToast: vi.fn(),
    })

    await removeTask(deleting)

    expect(useStore.getState()).toMatchObject({
      lightboxImageId: 'shared-output',
      lightboxImageList: ['shared-output'],
      maskDraft: {
        targetImageId: 'shared-output',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })
  })

  it('single deletion does not prune an image that becomes referenced while the delete is in flight', async () => {
    const deleting = task({ id: 'delete-me', outputImages: ['late-input'] })
    let finishDelete!: () => void
    vi.mocked(deleteTask).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDelete = () => resolve(undefined)
        }),
    )
    useStore.setState({
      tasks: [deleting],
      inputImages: [],
      showToast: vi.fn(),
    })

    const removing = removeTask(deleting)
    useStore.setState({
      inputImages: [{ id: 'late-input', dataUrl: 'data:image/png;base64,aQ==' }],
    })
    finishDelete()
    await removing

    expect(deleteImage).not.toHaveBeenCalledWith('late-input')
  })

  it('single deletion uses the latest task snapshot instead of a stale caller object', async () => {
    const staleDeleting = task({ id: 'delete-me', outputImages: [] })
    const latestDeleting = task({ id: 'delete-me', outputImages: ['late-output'] })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [latestDeleting],
      inputImages: [],
      showToast: vi.fn(),
    })

    await removeTask(staleDeleting)

    expect(useStore.getState().tasks).toEqual([])
    expect(deleteImage).toHaveBeenCalledWith('late-output')
  })

  it('single deletion reports asynchronous image cleanup failures through the latest toast handler', async () => {
    const deleting = task({ id: 'delete-me', outputImages: ['orphan-image'] })
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    let rejectImageDelete!: (reason?: unknown) => void
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    vi.mocked(deleteImage).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectImageDelete = reject
        }),
    )
    useStore.setState({
      tasks: [deleting],
      inputImages: [],
      showToast: oldToast,
    })

    const removing = removeTask(deleting)
    await vi.waitFor(() => expect(deleteImage).toHaveBeenCalledWith('orphan-image'))
    useStore.setState({ showToast: latestToast })

    rejectImageDelete(new Error('cleanup failed'))
    await removing

    expect(latestToast).toHaveBeenCalledWith(
      expect.stringContaining('清理关联图片失败：cleanup failed'),
      'error',
    )
    expect(oldToast).not.toHaveBeenCalledWith(expect.stringContaining('清理关联图片失败'), 'error')
  })

  it('single deletion ignores a task object that is not present in the current store', async () => {
    const stale = task({ id: 'stale-db-id', outputImages: ['stale-output'] })
    const untouched = task({ id: 'untouched' })
    vi.mocked(deleteTask).mockClear()
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [untouched],
      inputImages: [],
      selectedTaskIds: ['stale-db-id', 'untouched'],
      detailTaskId: 'stale-db-id',
      lineageTaskId: 'stale-db-id',
      compareTaskIds: ['stale-db-id', 'untouched'],
      lightboxImageId: 'stale-output',
      lightboxImageList: ['stale-output'],
      showToast: vi.fn(),
    })

    await removeTask(stale)

    expect(deleteTask).not.toHaveBeenCalled()
    expect(useStore.getState().tasks).toEqual([untouched])
    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: ['untouched'],
      detailTaskId: null,
      lineageTaskId: null,
      compareTaskIds: null,
      lightboxImageId: null,
      lightboxImageList: [],
    })
  })

  it('restores a running task as cancelled when deleting it fails after aborting runtime', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    const deleting = task({
      id: 'delete-running',
      status: 'running',
      createdAt: 1_000,
      finishedAt: null,
      elapsed: null,
    })
    vi.mocked(deleteTask).mockRejectedValue(new Error('delete failed'))
    useStore.setState({
      tasks: [deleting],
      inputImages: [],
      showToast: vi.fn(),
    })

    await expect(removeTask(deleting)).rejects.toThrow('delete failed')

    expect(useStore.getState().tasks).toEqual([
      expect.objectContaining({
        id: 'delete-running',
        status: 'error',
        error: '已取消生成',
        finishedAt: 5_000,
        elapsed: 4_000,
      }),
    ])
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delete-running',
        status: 'error',
        error: '已取消生成',
      }),
    )
  })

  it('restores only unconfirmed tasks when bulk deletion partially fails to persist', async () => {
    const deleted = task({ id: 'deleted' })
    const failed = task({ id: 'failed' })
    const untouched = task({ id: 'untouched' })
    vi.mocked(deleteTask)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('bulk delete failed'))
    useStore.setState({
      tasks: [deleted, failed, untouched],
      inputImages: [],
      selectedTaskIds: ['deleted', 'failed', 'stale-db-id', 'untouched'],
      showToast: vi.fn(),
    })

    await expect(removeMultipleTasks(['deleted', 'stale-db-id', 'failed'])).rejects.toThrow(
      'bulk delete failed',
    )

    expect(
      useStore
        .getState()
        .tasks.map((t) => t.id)
        .sort(),
    ).toEqual(['failed', 'untouched'])
    expect(useStore.getState().selectedTaskIds.sort()).toEqual(['failed', 'untouched'])
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('删除记录失败'),
      'error',
    )
  })

  it('clears transient UI references owned by successfully bulk deleted tasks', async () => {
    const deleting = task({
      id: 'delete-me',
      inputImageIds: ['deleted-input'],
      outputImages: ['deleted-output'],
    })
    const untouched = task({ id: 'untouched', outputImages: ['kept-output'] })
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [deleting, untouched],
      inputImages: [],
      selectedTaskIds: ['delete-me', 'untouched'],
      detailTaskId: 'delete-me',
      lineageTaskId: 'delete-me',
      compareTaskIds: ['delete-me', 'untouched'],
      lightboxImageId: 'deleted-output',
      lightboxImageList: ['deleted-output', 'kept-output'],
      captionBatchImageIds: ['deleted-output', 'kept-output'],
      showToast: vi.fn(),
    })

    await removeMultipleTasks(['delete-me'])

    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: ['untouched'],
      detailTaskId: null,
      lineageTaskId: null,
      compareTaskIds: null,
      lightboxImageId: null,
      lightboxImageList: ['kept-output'],
      captionBatchImageIds: ['kept-output'],
    })
  })

  it('bulk deletion ignores ids that are not present in the current store', async () => {
    const deleting = task({ id: 'delete-me' })
    const untouched = task({ id: 'untouched' })
    vi.mocked(deleteTask).mockClear()
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    useStore.setState({
      tasks: [deleting, untouched],
      inputImages: [],
      selectedTaskIds: ['delete-me', 'stale-db-id', 'untouched'],
      showToast: vi.fn(),
    })

    await removeMultipleTasks(['delete-me', 'stale-db-id'])

    expect(deleteTask).toHaveBeenCalledTimes(1)
    expect(deleteTask).toHaveBeenCalledWith('delete-me')
    expect(useStore.getState().tasks).toEqual([untouched])
    expect(useStore.getState().selectedTaskIds).toEqual(['untouched'])
  })

  it('bulk deletion does not prune an image that becomes referenced while deletes are in flight', async () => {
    const deleting = task({ id: 'delete-me', outputImages: ['late-input'] })
    let finishDelete!: () => void
    vi.mocked(deleteTask).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDelete = () => resolve(undefined)
        }),
    )
    useStore.setState({
      tasks: [deleting],
      inputImages: [],
      showToast: vi.fn(),
    })

    const removing = removeMultipleTasks(['delete-me'])
    useStore.setState({
      inputImages: [{ id: 'late-input', dataUrl: 'data:image/png;base64,aQ==' }],
    })
    finishDelete()
    await removing

    expect(deleteImage).not.toHaveBeenCalledWith('late-input')
  })

  it('bulk deletion reports asynchronous image cleanup failures through the latest toast handler', async () => {
    const deleting = task({ id: 'delete-me', outputImages: ['orphan-image'] })
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    let rejectImageDelete!: (reason?: unknown) => void
    vi.mocked(deleteTask).mockResolvedValue(undefined)
    vi.mocked(deleteImage).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectImageDelete = reject
        }),
    )
    useStore.setState({
      tasks: [deleting],
      inputImages: [],
      showToast: oldToast,
    })

    const removing = removeMultipleTasks(['delete-me'])
    await vi.waitFor(() => expect(deleteImage).toHaveBeenCalledWith('orphan-image'))
    useStore.setState({ showToast: latestToast })

    rejectImageDelete(new Error('cleanup failed'))
    await removing

    expect(latestToast).toHaveBeenCalledWith(
      expect.stringContaining('清理关联图片失败：cleanup failed'),
      'error',
    )
    expect(oldToast).not.toHaveBeenCalledWith(expect.stringContaining('清理关联图片失败'), 'error')
  })

  it('restores unconfirmed running tasks as cancelled when bulk deletion fails after aborting runtime', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(7_000)
    const failed = task({
      id: 'failed-running',
      status: 'running',
      createdAt: 2_000,
      finishedAt: null,
      elapsed: null,
    })
    const untouched = task({ id: 'untouched' })
    vi.mocked(deleteTask).mockRejectedValue(new Error('bulk delete failed'))
    useStore.setState({
      tasks: [failed, untouched],
      inputImages: [],
      selectedTaskIds: ['failed-running', 'untouched'],
      showToast: vi.fn(),
    })

    await expect(removeMultipleTasks(['failed-running'])).rejects.toThrow('bulk delete failed')

    expect(useStore.getState().tasks).toEqual([
      expect.objectContaining({
        id: 'failed-running',
        status: 'error',
        error: '已取消生成',
        finishedAt: 7_000,
        elapsed: 5_000,
      }),
      untouched,
    ])
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'failed-running',
        status: 'error',
        error: '已取消生成',
      }),
    )
  })

  it('reports persistence failures from reorder self-healing writes', async () => {
    vi.mocked(putTask).mockRejectedValue(new Error('sort write failed'))
    useStore.setState({
      tasks: [
        task({ id: 'dragged', sortOrder: 30, conversationId: 'conv-a' }),
        task({ id: 'prev', sortOrder: 10, conversationId: 'conv-a' }),
        task({ id: 'next', sortOrder: 10 + Number.EPSILON / 4, conversationId: 'conv-a' }),
      ],
      showToast: vi.fn(),
    })

    reorderTask('dragged', 'prev', 'next')
    await vi.waitFor(() =>
      expect(useStore.getState().showToast).toHaveBeenCalledWith(
        expect.stringContaining('保存任务失败'),
        'error',
      ),
    )

    expect(
      useStore.getState().tasks.some((item) => item.persistenceError === 'sort write failed'),
    ).toBe(true)
  })

  it('submitGridTask generates one task per axis value, sharing batchId with gridAxes/gridCoord', async () => {
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    useStore.setState({ prompt: 'a cat', params: { ...DEFAULT_PARAMS }, showToast: vi.fn() })
    const xAxis = {
      kind: 'quality' as const,
      values: [
        { key: 'low', label: 'low' },
        { key: 'high', label: 'high' },
      ],
    }

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
    const gridAxes = {
      x: {
        kind: 'quality' as const,
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    }
    const errored = task({
      id: 'g-low',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'low' },
      status: 'error',
      params: { ...DEFAULT_PARAMS, quality: 'low' },
    })
    const ok = task({
      id: 'g-high',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'high' },
      status: 'done',
      params: { ...DEFAULT_PARAMS, quality: 'high' },
    })
    useStore.setState({ tasks: [errored, ok], showToast: vi.fn() })

    await retryTask(errored)

    await vi.waitFor(() => {
      const fresh = useStore
        .getState()
        .tasks.find((t) => t.status === 'running' && t.gridCoord?.x === 'low')
      expect(fresh).toBeTruthy()
      expect(fresh?.batchId).toBe('gb')
      expect(fresh?.gridCoord).toEqual({ x: 'low' })
      expect(fresh?.params.quality).toBe('low')
    })
  })

  it('retryTask on a grid cell keeps the original grid profile instead of the current active profile', async () => {
    const openaiProfile = {
      ...DEFAULT_SETTINGS.profiles[0],
      id: 'po',
      name: 'OpenAI grid',
      apiKey: 'ok',
      model: 'gpt-image-grid',
    }
    const geminiProfile = {
      id: 'pg',
      name: 'Gemini current',
      provider: 'gemini' as const,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gk',
      model: 'gemini-2.5-flash-image',
      timeout: 600,
    }
    const gridAxes = {
      x: {
        kind: 'quality' as const,
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    }
    const errored = task({
      id: 'g-low',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'low' },
      status: 'error',
      params: { ...DEFAULT_PARAMS, quality: 'low' },
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      apiProfileName: openaiProfile.name,
      apiModel: openaiProfile.model,
    })
    const ok = task({
      id: 'g-high',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'high' },
      status: 'done',
      params: { ...DEFAULT_PARAMS, quality: 'high' },
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      apiProfileName: openaiProfile.name,
      apiModel: openaiProfile.model,
    })
    const seenProfiles: Array<{ id?: string; provider?: string; model?: string } | undefined> = []
    vi.mocked(callImageApi).mockImplementation((_opts, profileOverride) => {
      seenProfiles.push(profileOverride)
      return new Promise(() => undefined)
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, geminiProfile],
        activeProfileId: geminiProfile.id,
      }),
      tasks: [errored, ok],
      showToast: vi.fn(),
    })

    await retryTask(errored)

    await vi.waitFor(() => expect(seenProfiles).toHaveLength(1))
    const fresh = useStore
      .getState()
      .tasks.find((item) => item.status === 'running' && item.gridCoord?.x === 'low')
    expect(fresh).toMatchObject({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      apiProfileName: openaiProfile.name,
      apiModel: openaiProfile.model,
    })
    expect(seenProfiles[0]).toMatchObject({
      id: openaiProfile.id,
      provider: 'openai',
      model: openaiProfile.model,
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
    const merged = mergePersistedStoreState(
      { settings: DEFAULT_SETTINGS },
      useStore.getInitialState(),
    )

    expect(merged.favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
  })

  it('adds one default favorite category when legacy persisted state has an empty category array', () => {
    const merged = mergePersistedStoreState(
      {
        settings: DEFAULT_SETTINGS,
        favoriteCategories: [],
      },
      useStore.getInitialState(),
    )

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
    const merged = mergePersistedStoreState(
      {
        settings: DEFAULT_SETTINGS,
        favoriteCategories: [],
        favoriteCategoriesInitialized: true,
      },
      useStore.getInitialState(),
    )

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
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assigned',
        favoriteCategoryId: null,
      }),
    )
    expect(putTask).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'other' }))
  })

  it('marks dirty tasks when deleting a favorite category fails to persist task updates', async () => {
    const failure = new Error('idb full')
    vi.mocked(putTask).mockRejectedValue(failure)
    const assignedTask = task({
      id: 'assigned',
      isFavorite: true,
      favoriteCategoryId: categoryA.id,
    })
    useStore.setState({
      favoriteCategories: [categoryA],
      filterFavoriteCategoryId: categoryA.id,
      tasks: [assignedTask],
      showToast: vi.fn(),
    })

    await expect(useStore.getState().deleteFavoriteCategory(categoryA.id)).rejects.toThrow(
      'idb full',
    )

    expect(useStore.getState().favoriteCategories).toEqual([])
    expect(useStore.getState().filterFavoriteCategoryId).toBeNull()
    expect(useStore.getState().tasks[0]).toMatchObject({
      id: 'assigned',
      favoriteCategoryId: null,
      persistenceError: 'idb full',
    })
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('保存任务失败'),
      'error',
    )
  })

  it('deduplicates repeated output image ids while editing outputs', async () => {
    vi.mocked(getImage).mockResolvedValue({ id: imageA.id, dataUrl: imageA.dataUrl })
    useStore.setState({
      inputImages: [],
      showToast: vi.fn(),
    })

    await editOutputs(task({ outputImages: [imageA.id, imageA.id] }))

    expect(useStore.getState().inputImages).toEqual([imageA])
    expect(useStore.getState().showToast).toHaveBeenCalledWith('已添加 1 张输出图到输入', 'success')
  })

  it('reports when all output images are already present while editing outputs', async () => {
    vi.mocked(getImage).mockClear()
    useStore.setState({
      inputImages: [imageA],
      showToast: vi.fn(),
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().inputImages).toEqual([imageA])
    expect(getImage).not.toHaveBeenCalled()
    expect(useStore.getState().showToast).toHaveBeenCalledWith('输出图已在输入中', 'info')
    expect(useStore.getState().showToast).not.toHaveBeenCalledWith(
      '已添加 0 张输出图到输入',
      'success',
    )
  })

  it('counts only output images actually added before the input limit is reached', async () => {
    vi.mocked(getImage).mockReset()
    vi.mocked(getImage).mockImplementation(async (id) => ({
      id,
      dataUrl: `data:image/png;base64,${id}`,
    }))
    useStore.setState({
      inputImages: Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION - 1 }, (_, index) => ({
        id: `existing-${index}`,
        dataUrl: `data:image/png;base64,existing-${index}`,
      })),
      showToast: vi.fn(),
    })

    await editOutputs(task({ outputImages: ['output-a', 'output-b'] }))

    expect(useStore.getState().inputImages).toHaveLength(MAX_INPUT_IMAGES_PER_SUBMISSION)
    expect(useStore.getState().inputImages.map((image) => image.id)).toContain('output-a')
    expect(useStore.getState().inputImages.map((image) => image.id)).not.toContain('output-b')
    expect(useStore.getState().showToast).toHaveBeenCalledWith('已添加 1 张输出图到输入', 'success')
  })

  it('reports delayed edit-output completion through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const delayedImage = { id: 'delayed-edit-image', dataUrl: 'data:image/png;base64,delayed-edit' }
    const imageLoad = createDeferred<{ id: string; dataUrl: string }>()
    vi.mocked(getImage).mockReturnValueOnce(imageLoad.promise)
    useStore.setState({
      inputImages: [],
      showToast: oldToast,
    })

    const editing = editOutputs(task({ outputImages: [delayedImage.id] }))
    await Promise.resolve()
    useStore.setState({ showToast: latestToast })

    imageLoad.resolve(delayedImage)
    await editing

    expectLatestToastOnly(latestToast, oldToast, '已添加 1 张输出图到输入', 'success')
  })

  it('reports the input limit when no new output image can be added', async () => {
    vi.mocked(getImage).mockClear()
    useStore.setState({
      inputImages: Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION }, (_, index) => ({
        id: `existing-${index}`,
        dataUrl: `data:image/png;base64,existing-${index}`,
      })),
      showToast: vi.fn(),
    })

    await editOutputs(task({ outputImages: ['output-full'] }))

    expect(getImage).not.toHaveBeenCalled()
    expect(useStore.getState().inputImages).toHaveLength(MAX_INPUT_IMAGES_PER_SUBMISSION)
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      `参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`,
      'error',
    )
    expect(useStore.getState().showToast).not.toHaveBeenCalledWith('输出图已在输入中', 'info')
  })

  it('reports delayed reuse-config completion through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const delayedImage = {
      id: 'delayed-reuse-image',
      dataUrl: 'data:image/png;base64,delayed-reuse',
    }
    const imageLoad = createDeferred<{ id: string; dataUrl: string }>()
    vi.mocked(getImage).mockReturnValueOnce(imageLoad.promise)
    useStore.setState({
      inputImages: [],
      showToast: oldToast,
    })

    const reusing = reuseConfig(task({ inputImageIds: [delayedImage.id] }))
    await Promise.resolve()
    useStore.setState({ showToast: latestToast })

    imageLoad.resolve(delayedImage)
    await reusing

    expectLatestToastOnly(latestToast, oldToast, '已复用配置到输入框', 'success')
  })
})

describe('resolveExecutionProfile (M1 执行 profile 固定)', () => {
  const openaiA = {
    id: 'pa',
    name: '新配置',
    provider: 'openai' as const,
    apiMode: 'images' as const,
    baseUrl: 'https://a.example/v1',
    apiKey: 'ka',
    model: 'gpt-image-2',
    timeout: 600,
  }
  const openaiB = {
    id: 'pb',
    name: '新配置',
    provider: 'openai' as const,
    apiMode: 'images' as const,
    baseUrl: 'https://b.example/v1',
    apiKey: 'kb',
    model: 'gpt-image-2',
    timeout: 600,
  }
  const gemini = {
    id: 'pg',
    name: 'Gemini 配置',
    provider: 'gemini' as const,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'kg',
    model: 'gemini-2.5-flash-image',
    timeout: 600,
  }
  const makeSettings = (activeProfileId: string) =>
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openaiA, openaiB, gemini],
      activeProfileId,
    })

  it('按 apiProfileId 精确解析:重名 profile 下不会投错端点', () => {
    const resolved = resolveExecutionProfile(
      makeSettings('pa'),
      task({
        apiProfileId: 'pb',
        apiProfileName: '新配置',
        apiProvider: 'openai',
        apiModel: 'gpt-image-2',
        status: 'running',
      }),
    )
    expect(resolved).not.toBeNull()
    expect(resolved!.profile.id).toBe('pb')
    expect(resolved!.profile.baseUrl).toBe('https://b.example/v1')
    expect(resolved!.isActive).toBe(false)
  })

  it('旧记录仅有 apiProfileName 且重名多命中 → 返回 null(不猜目标)', () => {
    const resolved = resolveExecutionProfile(
      makeSettings('pa'),
      task({ apiProfileName: '新配置', apiProvider: 'openai', status: 'running' }),
    )
    expect(resolved).toBeNull()
  })

  it('旧记录按唯一 name 解析成功;profile 被删 / provider 已变 → null', () => {
    const byName = resolveExecutionProfile(
      makeSettings('pa'),
      task({ apiProfileName: 'Gemini 配置', apiProvider: 'gemini', status: 'running' }),
    )
    expect(byName!.profile.id).toBe('pg')

    expect(
      resolveExecutionProfile(
        makeSettings('pa'),
        task({ apiProfileId: 'deleted-id', status: 'running' }),
      ),
    ).toBeNull()
    expect(
      resolveExecutionProfile(
        makeSettings('pa'),
        task({ apiProfileId: 'pg', apiProvider: 'openai', status: 'running' }),
      ),
    ).toBeNull()
  })

  it('模型固定为 task.apiModel(同 profile 内改模型也属漂移);无元数据的旧记录回落 active', () => {
    const pinnedModel = resolveExecutionProfile(
      makeSettings('pa'),
      task({
        apiProfileId: 'pg',
        apiProvider: 'gemini',
        apiModel: 'gemini-legacy-model',
        status: 'running',
      }),
    )
    expect(pinnedModel!.profile.model).toBe('gemini-legacy-model')

    const legacy = resolveExecutionProfile(makeSettings('pg'), task({ status: 'running' }))
    expect(legacy!.profile.id).toBe('pg')
    expect(legacy!.isActive).toBe(true)
  })
})

describe('ui selection state invariants', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setSelectedTaskIds deduplicates ids while preserving first-seen order', () => {
    useStore.getState().setSelectedTaskIds(['task-a', 'task-b', 'task-a'])
    expect(useStore.getState().selectedTaskIds).toEqual(['task-a', 'task-b'])
  })

  it('setSelectedTaskIds and toggleTaskSelection cap transient ids', () => {
    const longId = 'task-'.repeat(MAX_TASK_TEXT_LEN + 10)

    useStore.getState().setSelectedTaskIds(['task-a', longId, longId])

    expect(useStore.getState().selectedTaskIds).toEqual([
      'task-a',
      longId.slice(0, MAX_TASK_TEXT_LEN),
    ])

    useStore.getState().clearSelection()
    useStore.getState().toggleTaskSelection(longId)

    expect(useStore.getState().selectedTaskIds).toEqual([longId.slice(0, MAX_TASK_TEXT_LEN)])
  })

  it('filter changes clear selectedTaskIds because they narrow the visible task set', () => {
    useStore.setState({ selectedTaskIds: ['task-a'] })
    useStore.getState().setSearchQuery('portrait')
    expect(useStore.getState().selectedTaskIds).toEqual([])

    useStore.setState({ searchQuery: 'portrait', selectedTaskIds: ['task-same-query'] })
    useStore.getState().setSearchQuery('portrait')
    expect(useStore.getState().selectedTaskIds).toEqual(['task-same-query'])

    useStore.setState({ selectedTaskIds: ['task-a'] })
    useStore.getState().setFilterStatus('done')
    expect(useStore.getState().selectedTaskIds).toEqual([])

    useStore.setState({ filterStatus: 'done', selectedTaskIds: ['task-same-status'] })
    useStore.getState().setFilterStatus('done')
    expect(useStore.getState().selectedTaskIds).toEqual(['task-same-status'])

    useStore.setState({ selectedTaskIds: ['task-b'] })
    useStore.getState().setFilterFavorite(true)
    expect(useStore.getState().selectedTaskIds).toEqual([])

    useStore.setState({ filterFavorite: true, selectedTaskIds: ['task-same-favorite'] })
    useStore.getState().setFilterFavorite(true)
    expect(useStore.getState().selectedTaskIds).toEqual(['task-same-favorite'])

    useStore.setState({ selectedTaskIds: ['task-c'] })
    useStore.getState().setFilterFavoriteCategoryId('cat-a')
    expect(useStore.getState().selectedTaskIds).toEqual([])

    useStore.setState({
      filterFavoriteCategoryId: 'cat-a',
      selectedTaskIds: ['task-same-category'],
    })
    useStore.getState().setFilterFavoriteCategoryId('cat-a')
    expect(useStore.getState().selectedTaskIds).toEqual(['task-same-category'])
  })

  it('setFilterFavoriteCategoryId caps transient category ids before they reach state', () => {
    const longId = 'cat-'.repeat(MAX_TASK_TEXT_LEN + 10)

    useStore.getState().setFilterFavoriteCategoryId(longId)

    expect(useStore.getState().filterFavoriteCategoryId).toBe(longId.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('setCompareTaskIds deduplicates ids while preserving first-seen order', () => {
    useStore.getState().setCompareTaskIds(['task-a', 'task-b', 'task-a'])
    expect(useStore.getState().compareTaskIds).toEqual(['task-a', 'task-b'])
  })

  it('setCompareTaskIds caps transient ids and keeps at most four comparison targets', () => {
    const longId = 'task-'.repeat(MAX_TASK_TEXT_LEN + 10)

    useStore.getState().setCompareTaskIds([longId, 'task-b', 'task-c', 'task-d', 'task-e'])

    expect(useStore.getState().compareTaskIds).toEqual([
      longId.slice(0, MAX_TASK_TEXT_LEN),
      'task-b',
      'task-c',
      'task-d',
    ])
  })

  it('setLightboxImageId deduplicates navigation list while preserving first-seen order', () => {
    useStore.getState().setLightboxImageId('image-a', ['image-a', 'image-b', 'image-a'])
    expect(useStore.getState().lightboxImageList).toEqual(['image-a', 'image-b'])
  })

  it('caps transient lightbox and lineage ids before they reach UI state', () => {
    const longId = 'image-'.repeat(MAX_TASK_TEXT_LEN + 10)

    useStore.getState().setLightboxImageId(longId, [longId, 'image-b', longId])
    useStore.getState().setDetailTaskId(longId)
    useStore.getState().setLineageTaskId(longId)
    useStore.getState().setMaskEditorImageId(longId)

    expect(useStore.getState().lightboxImageId).toBe(longId.slice(0, MAX_TASK_TEXT_LEN))
    expect(useStore.getState().lightboxImageList).toEqual([
      longId.slice(0, MAX_TASK_TEXT_LEN),
      'image-b',
    ])
    expect(useStore.getState().detailTaskId).toBe(longId.slice(0, MAX_TASK_TEXT_LEN))
    expect(useStore.getState().lineageTaskId).toBe(longId.slice(0, MAX_TASK_TEXT_LEN))
    expect(useStore.getState().maskEditorImageId).toBe(longId.slice(0, MAX_TASK_TEXT_LEN))
  })

  it('caps transient caption batch image ids but preserves full captionSource data URLs', () => {
    const longId = 'image-'.repeat(MAX_TASK_TEXT_LEN + 10)
    const dataUrl = `data:image/png;base64,${'a'.repeat(MAX_TASK_TEXT_LEN + 10)}`

    useStore.getState().setCaptionBatchImageIds([longId, 'image-b', longId])
    useStore.getState().setCaptionSource(dataUrl)

    expect(useStore.getState().captionBatchImageIds).toEqual([
      longId.slice(0, MAX_TASK_TEXT_LEN),
      'image-b',
    ])
    expect(useStore.getState().captionSource).toBe(dataUrl)
  })
})

describe('conversation store actions', () => {
  beforeEach(() => {
    vi.mocked(putConversation).mockReset()
    vi.mocked(putConversation).mockResolvedValue('conv-id')
    vi.mocked(deleteConversation).mockReset()
    vi.mocked(deleteConversation).mockResolvedValue(undefined)
    vi.mocked(deleteImage).mockReset()
    vi.mocked(deleteImage).mockResolvedValue(undefined)
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

  it('setActiveConversation clears selectedTaskIds when switching to a different conversation', () => {
    // H2 配套(2026-06-10 审查修复):多选集合不随视图过滤收窄,跨对话残留选择会被批量操作误伤
    useStore.setState({ activeConversationId: 'conv-a', selectedTaskIds: ['t1', 't2'] })
    useStore.getState().setActiveConversation('conv-b')
    expect(useStore.getState().selectedTaskIds).toEqual([])

    // 重复设置同一对话不清空(避免无谓的选择丢失)
    useStore.setState({ selectedTaskIds: ['t3'] })
    useStore.getState().setActiveConversation('conv-b')
    expect(useStore.getState().selectedTaskIds).toEqual(['t3'])
  })

  it('setActiveConversation caps live activeConversationId before persistence', () => {
    const longId = 'conv-'.repeat(MAX_CONVERSATION_ID_LEN + 10)

    useStore.getState().setActiveConversation(longId)

    expect(useStore.getState().activeConversationId).toBe(longId.slice(0, MAX_CONVERSATION_ID_LEN))
  })

  it('createConversation auto-activates the new conversation', () => {
    const id = useStore.getState().createConversation()
    expect(useStore.getState().activeConversationId).toBe(id)
    expect(useStore.getState().conversations[0]?.id).toBe(id)
    expect(useStore.getState().conversations[0]?.title).toBe('新对话')
    expect(putConversation).toHaveBeenCalledWith(expect.objectContaining({ id, title: '新对话' }))
  })

  it('createConversation clears selectedTaskIds when it switches to the new conversation', () => {
    useStore.setState({ activeConversationId: 'conv-a', selectedTaskIds: ['task-a'] })

    useStore.getState().createConversation()

    expect(useStore.getState().selectedTaskIds).toEqual([])
  })

  it('createConversation respects an explicit seed title', () => {
    const id = useStore.getState().createConversation('我的对话')
    expect(useStore.getState().conversations[0]).toMatchObject({ id, title: '我的对话' })
  })

  it('createConversation trims and clamps explicit seed titles', () => {
    const id = useStore.getState().createConversation(`  ${'x'.repeat(120)}  `)
    expect(useStore.getState().conversations[0]).toMatchObject({
      id,
      title: 'x'.repeat(MAX_CONVERSATION_TITLE_LEN),
    })
    expect(putConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        title: 'x'.repeat(MAX_CONVERSATION_TITLE_LEN),
      }),
    )
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

  it('renameConversation trims and clamps persisted titles', async () => {
    const id = useStore.getState().createConversation()

    await useStore.getState().renameConversation(id, `  ${'y'.repeat(120)}  `)

    expect(useStore.getState().conversations.find((c) => c.id === id)?.title).toBe(
      'y'.repeat(MAX_CONVERSATION_TITLE_LEN),
    )
    expect(putConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id,
        title: 'y'.repeat(MAX_CONVERSATION_TITLE_LEN),
      }),
    )
  })

  it('renameConversation restores the previous title when persistence fails', async () => {
    const original = {
      id: 'conv-a',
      title: '原标题',
      createdAt: 1,
      updatedAt: 2,
      color: null,
    }
    vi.mocked(putConversation).mockRejectedValue(new Error('rename failed'))
    useStore.setState({
      conversations: [original],
      showToast: vi.fn(),
    })

    await expect(useStore.getState().renameConversation('conv-a', '新标题')).rejects.toThrow(
      'rename failed',
    )

    expect(useStore.getState().conversations).toEqual([original])
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('重命名对话失败'),
      'error',
    )
  })

  it('renameConversation keeps conversations added while a failed rename is pending', async () => {
    const original = {
      id: 'conv-a',
      title: '原标题',
      createdAt: 1,
      updatedAt: 2,
      color: null,
    }
    const added = {
      id: 'conv-b',
      title: '等待期间新增',
      createdAt: 3,
      updatedAt: 3,
      color: null,
    }
    const pending = createDeferred<string>()
    vi.mocked(putConversation).mockReturnValueOnce(pending.promise)
    useStore.setState({
      conversations: [original],
      showToast: vi.fn(),
    })

    const rename = useStore.getState().renameConversation('conv-a', '新标题')
    useStore.setState((state) => ({ conversations: [added, ...state.conversations] }))
    pending.reject(new Error('rename failed'))

    await expect(rename).rejects.toThrow('rename failed')

    expect(useStore.getState().conversations).toEqual([added, original])
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('重命名对话失败'),
      'error',
    )
  })

  it('renameConversation does not roll back a newer rename when an older persistence write fails', async () => {
    const original = {
      id: 'conv-a',
      title: '原标题',
      createdAt: 1,
      updatedAt: 2,
      color: null,
    }
    const firstWrite = createDeferred<string>()
    vi.mocked(putConversation).mockReturnValueOnce(firstWrite.promise).mockResolvedValueOnce('ok')
    useStore.setState({
      conversations: [original],
      showToast: vi.fn(),
    })

    const firstRename = useStore.getState().renameConversation('conv-a', '第一次改名')
    await useStore.getState().renameConversation('conv-a', '第二次改名')
    firstWrite.reject(new Error('first rename failed'))

    await expect(firstRename).rejects.toThrow('first rename failed')

    expect(useStore.getState().conversations).toEqual([
      expect.objectContaining({
        id: 'conv-a',
        title: '第二次改名',
      }),
    ])
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

  it('deleteConversationWithTasks returns the cascade deletion promise from the confirmation action', () => {
    const setConfirmDialog = vi.fn()
    let resolveDelete!: () => void
    vi.mocked(deleteConversation).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      }),
    )
    useStore.setState({
      conversations: [{ id: 'conv-target', title: '待删', createdAt: 1, updatedAt: 1 }],
      tasks: [{ ...task({ id: 'task-target', conversationId: 'conv-target' }) }],
      activeConversationId: 'conv-target',
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => unknown
    }
    const result = dialog.action()

    expect(result).toHaveProperty('then')
    resolveDelete()
  })

  it('removes deleted conversation task ids from the selection after cascade deletion succeeds', async () => {
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
      selectedTaskIds: ['task-target', 'task-keep'],
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await vi.waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('conv-target', true))

    expect(useStore.getState().selectedTaskIds).toEqual(['task-keep'])
  })

  it('uses the latest toast handler after an async cascade deletion succeeds', async () => {
    const setConfirmDialog = vi.fn()
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    let resolveDelete!: () => void
    vi.mocked(deleteConversation).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      }),
    )
    useStore.setState({
      conversations: [{ id: 'conv-target', title: '待删', createdAt: 1, updatedAt: 1 }],
      tasks: [{ ...task({ id: 'task-target', conversationId: 'conv-target' }) }],
      activeConversationId: 'conv-target',
      setConfirmDialog,
      showToast: oldToast,
    })

    useStore.getState().deleteConversationWithTasks('conv-target')
    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await Promise.resolve()
    useStore.setState({ showToast: latestToast })

    resolveDelete()
    await vi.waitFor(() => expect(latestToast).toHaveBeenCalledWith('对话已删除', 'success'))

    expect(oldToast).not.toHaveBeenCalledWith('对话已删除', 'success')
  })

  it('clears transient UI references owned by tasks removed during cascade deletion', async () => {
    const setConfirmDialog = vi.fn()
    useStore.setState({
      conversations: [
        { id: 'conv-keep', title: '保留', createdAt: 1, updatedAt: 1 },
        { id: 'conv-target', title: '待删', createdAt: 2, updatedAt: 2 },
      ],
      tasks: [
        {
          ...task({ id: 'task-keep', conversationId: 'conv-keep', outputImages: ['kept-output'] }),
        },
        {
          ...task({
            id: 'task-target',
            conversationId: 'conv-target',
            inputImageIds: ['deleted-input'],
            outputImages: ['deleted-output'],
          }),
        },
      ],
      activeConversationId: 'conv-target',
      detailTaskId: 'task-target',
      lineageTaskId: 'task-target',
      compareTaskIds: ['task-target', 'task-keep'],
      lightboxImageId: 'deleted-output',
      lightboxImageList: ['deleted-output', 'kept-output'],
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await vi.waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('conv-target', true))

    expect(useStore.getState()).toMatchObject({
      detailTaskId: null,
      lineageTaskId: null,
      compareTaskIds: null,
      lightboxImageId: null,
      lightboxImageList: ['kept-output'],
    })
  })

  it('cascade deletion prunes orphaned mask target images even when they are not in inputImageIds', async () => {
    const setConfirmDialog = vi.fn()
    useStore.setState({
      conversations: [{ id: 'conv-target', title: '待删', createdAt: 1, updatedAt: 1 }],
      tasks: [
        task({
          id: 'task-target',
          conversationId: 'conv-target',
          inputImageIds: [],
          maskTargetImageId: 'mask-target',
          maskImageId: 'mask-image',
          outputImages: [],
        }),
      ],
      activeConversationId: 'conv-target',
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')
    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await vi.waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('conv-target', true))

    await vi.waitFor(() => expect(deleteImage).toHaveBeenCalledWith('mask-target'))
    await vi.waitFor(() => expect(deleteImage).toHaveBeenCalledWith('mask-image'))
  })

  it('restores conversation UI when cascade deletion fails to persist', async () => {
    const setConfirmDialog = vi.fn()
    vi.useFakeTimers()
    vi.setSystemTime(9_000)
    vi.mocked(deleteConversation).mockRejectedValue(new Error('delete conversation failed'))
    const conversations = [
      { id: 'conv-keep', title: '保留', createdAt: 1, updatedAt: 1 },
      { id: 'conv-target', title: '待删', createdAt: 2, updatedAt: 2 },
    ]
    const tasks = [
      { ...task({ id: 'task-keep', conversationId: 'conv-keep' }) },
      {
        ...task({
          id: 'task-target',
          conversationId: 'conv-target',
          status: 'running',
          createdAt: 4_000,
          finishedAt: null,
          elapsed: null,
          outputImages: ['deleted-output'],
        }),
      },
    ]
    useStore.setState({
      conversations,
      tasks,
      activeConversationId: 'conv-target',
      selectedTaskIds: ['task-target', 'task-keep'],
      detailTaskId: 'task-target',
      lineageTaskId: 'task-target',
      compareTaskIds: ['task-target', 'task-keep'],
      lightboxImageId: 'deleted-output',
      lightboxImageList: ['deleted-output'],
      captionBatchImageIds: ['deleted-output'],
      maskEditorImageId: 'deleted-output',
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')
    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await vi.waitFor(() =>
      expect(useStore.getState().showToast).toHaveBeenCalledWith(
        expect.stringContaining('删除对话失败'),
        'error',
      ),
    )

    expect(useStore.getState().conversations).toEqual(conversations)
    expect(useStore.getState().tasks).toEqual([
      tasks[0],
      expect.objectContaining({
        id: 'task-target',
        status: 'error',
        error: '已取消生成',
        finishedAt: 9_000,
        elapsed: 5_000,
      }),
    ])
    expect(useStore.getState().activeConversationId).toBe('conv-target')
    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: ['task-target', 'task-keep'],
      detailTaskId: 'task-target',
      lineageTaskId: 'task-target',
      compareTaskIds: ['task-target', 'task-keep'],
      lightboxImageId: 'deleted-output',
      lightboxImageList: ['deleted-output'],
      captionBatchImageIds: ['deleted-output'],
      maskEditorImageId: 'deleted-output',
    })
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-target',
        status: 'error',
        error: '已取消生成',
      }),
    )
  })

  it('deleteConversationWithTasks keeps conversations added while a failed cascade deletion is pending', async () => {
    const setConfirmDialog = vi.fn()
    const pendingDelete = createDeferred<void>()
    vi.mocked(deleteConversation).mockReturnValueOnce(pendingDelete.promise)
    const conversations = [
      { id: 'conv-keep', title: '保留', createdAt: 1, updatedAt: 1 },
      { id: 'conv-target', title: '待删', createdAt: 2, updatedAt: 2 },
    ]
    const added = { id: 'conv-added', title: '等待期间新增', createdAt: 3, updatedAt: 3 }
    const tasks = [
      { ...task({ id: 'task-keep', conversationId: 'conv-keep' }) },
      { ...task({ id: 'task-target', conversationId: 'conv-target' }) },
    ]
    useStore.setState({
      conversations,
      tasks,
      activeConversationId: 'conv-target',
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')
    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await Promise.resolve()
    useStore.setState((state) => ({
      conversations: [added, ...state.conversations],
      activeConversationId: 'conv-added',
    }))
    pendingDelete.reject(new Error('delete conversation failed'))

    await vi.waitFor(() =>
      expect(useStore.getState().showToast).toHaveBeenCalledWith(
        expect.stringContaining('删除对话失败'),
        'error',
      ),
    )

    expect(useStore.getState().conversations).toEqual([added, ...conversations])
    expect(useStore.getState().tasks).toEqual(tasks)
    expect(useStore.getState().activeConversationId).toBe('conv-added')
  })

  it('keeps the original cascade deletion error when cancelled-task restore persistence also fails', async () => {
    const setConfirmDialog = vi.fn()
    vi.mocked(deleteConversation).mockRejectedValue(new Error('delete conversation failed'))
    vi.mocked(putTask).mockRejectedValue(new Error('cancel restore failed'))
    useStore.setState({
      conversations: [{ id: 'conv-target', title: '待删', createdAt: 1, updatedAt: 1 }],
      tasks: [
        task({
          id: 'task-target',
          conversationId: 'conv-target',
          status: 'running',
          finishedAt: null,
          elapsed: null,
        }),
      ],
      activeConversationId: 'conv-target',
      setConfirmDialog,
      showToast: vi.fn(),
    })

    useStore.getState().deleteConversationWithTasks('conv-target')
    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => void
    }
    dialog.action()
    await vi.waitFor(() =>
      expect(useStore.getState().showToast).toHaveBeenCalledWith(
        expect.stringContaining('删除对话失败：delete conversation failed'),
        'error',
      ),
    )

    expect(
      useStore.getState().tasks.some((task) => task.persistenceError === 'cancel restore failed'),
    ).toBe(true)
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

  it('mergePersistedStoreState caps persisted activeConversationId', () => {
    const longId = 'conv-'.repeat(MAX_CONVERSATION_ID_LEN + 10)

    const merged = mergePersistedStoreState(
      { activeConversationId: longId },
      useStore.getInitialState(),
    )

    expect(merged.activeConversationId).toBe(longId.slice(0, MAX_CONVERSATION_ID_LEN))
  })

  it('mergePersistedStoreState defaults activeConversationId / sidebarCollapsed when missing', () => {
    const merged = mergePersistedStoreState({}, useStore.getInitialState())
    expect(merged.activeConversationId).toBeNull()
    expect(merged.sidebarCollapsed).toBe(false)
  })

  it('dismissCodexCliPrompt dedupes keys and caps the live persisted list', () => {
    useStore.getState().dismissCodexCliPrompt('  key-a  ')
    useStore.getState().dismissCodexCliPrompt('key-a')
    useStore.getState().dismissCodexCliPrompt('key-b')
    useStore.getState().dismissCodexCliPrompt('  key-b  ')
    for (let index = 0; index < 60; index += 1) {
      useStore.getState().dismissCodexCliPrompt(`key-${index}`)
    }

    expect(useStore.getState().dismissedCodexCliPrompts).toHaveLength(50)
    expect(new Set(useStore.getState().dismissedCodexCliPrompts).size).toBe(50)
    expect(useStore.getState().dismissedCodexCliPrompts[0]).toBe('key-10')
    const dismissedKeys = useStore.getState().dismissedCodexCliPrompts
    expect(dismissedKeys[dismissedKeys.length - 1]).toBe('key-59')
  })

  it('dismissCodexCliPrompt dedupes after trimming regardless of insertion order', () => {
    useStore.setState({ dismissedCodexCliPrompts: [] })

    useStore.getState().dismissCodexCliPrompt('key-b')
    useStore.getState().dismissCodexCliPrompt('  key-b  ')

    expect(useStore.getState().dismissedCodexCliPrompts).toEqual(['key-b'])
  })

  it('dismissCodexCliPrompt caps live keys before persisting them', () => {
    useStore.setState({ dismissedCodexCliPrompts: [] })
    const longKey = 'k'.repeat(MAX_DISMISSED_CODEX_CLI_PROMPT_KEY_LEN + 50)

    useStore.getState().dismissCodexCliPrompt(longKey)

    expect(useStore.getState().dismissedCodexCliPrompts).toEqual([
      longKey.slice(0, MAX_DISMISSED_CODEX_CLI_PROMPT_KEY_LEN),
    ])
  })
})

describe('insecure context banner state', () => {
  it('mergePersistedStoreState defaults dismissedInsecureContextBanner to false for missing / false / non-boolean persisted values', () => {
    const initial = useStore.getInitialState()
    expect(mergePersistedStoreState({}, initial).dismissedInsecureContextBanner).toBe(false)
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
      mergePersistedStoreState({ galleryView: 'true' as unknown as boolean }, initial).galleryView,
    ).toBe(false)
  })

  it('mergePersistedStoreState preserves galleryView === true', () => {
    const merged = mergePersistedStoreState({ galleryView: true }, useStore.getInitialState())
    expect(merged.galleryView).toBe(true)
  })

  it('mergePersistedStoreState normalizes unsafe prompt, params, inputImages and dismissed prompt keys', () => {
    const longText = 'x'.repeat(MAX_TASK_TEXT_LEN + 50)
    const longDismissedPromptKey = 'k'.repeat(MAX_DISMISSED_CODEX_CLI_PROMPT_KEY_LEN + 50)
    const merged = mergePersistedStoreState(
      {
        prompt: longText,
        params: {
          size: '1024x1024',
          quality: 'high',
          output_format: 'jpeg',
          output_compression: 80,
          moderation: 'low',
          n: 2,
          extra: 'drop',
        },
        inputImages: [
          { id: 'img-a', dataUrl: 'data:image/png;base64,a' },
          { id: 'img-a', dataUrl: 'data:image/png;base64,duplicate' },
          { id: '', dataUrl: 'data:image/png;base64,b' },
          { id: 'img-b', dataUrl: 42 },
          { id: longText, dataUrl: 'data:image/png;base64,long' },
        ],
        dismissedCodexCliPrompts: [
          'ok',
          'ok',
          '   ',
          '  trimmed  ',
          longDismissedPromptKey,
          1,
          ...Array.from({ length: 80 }, (_, index) => `prompt-${index}`),
        ],
      } as never,
      useStore.getInitialState(),
    )

    expect(merged.prompt).toHaveLength(MAX_TASK_TEXT_LEN)
    expect(merged.params).toEqual({
      ...DEFAULT_PARAMS,
      size: '1024x1024',
      quality: 'high',
      output_format: 'jpeg',
      output_compression: 80,
      moderation: 'low',
      n: 2,
    })
    expect(merged.inputImages).toEqual([
      { id: 'img-a', dataUrl: '' },
      { id: 'img-b', dataUrl: '' },
      { id: longText.slice(0, MAX_TASK_TEXT_LEN), dataUrl: '' },
    ])
    expect(merged.dismissedCodexCliPrompts).toHaveLength(50)
    expect(merged.dismissedCodexCliPrompts.slice(0, 3)).toEqual([
      'ok',
      'trimmed',
      longDismissedPromptKey.slice(0, MAX_DISMISSED_CODEX_CLI_PROMPT_KEY_LEN),
    ])
    expect(merged.dismissedCodexCliPrompts[merged.dismissedCodexCliPrompts.length - 1]).toBe(
      'prompt-46',
    )
  })

  it('mergePersistedStoreState falls back to an empty prompt for non-string persisted prompt values', () => {
    const merged = mergePersistedStoreState({ prompt: 123 } as never, useStore.getInitialState())

    expect(merged.prompt).toBe('')
  })

  it('mergePersistedStoreState caps persisted input images to the submission limit', () => {
    const merged = mergePersistedStoreState(
      {
        inputImages: Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION + 10 }, (_, index) => ({
          id: `img-${index}`,
          dataUrl: 'data:image/png;base64,a',
        })),
      },
      useStore.getInitialState(),
    )

    expect(merged.inputImages).toHaveLength(MAX_INPUT_IMAGES_PER_SUBMISSION)
    expect(merged.inputImages[0].id).toBe('img-0')
    expect(merged.inputImages[merged.inputImages.length - 1].id).toBe(
      `img-${MAX_INPUT_IMAGES_PER_SUBMISSION - 1}`,
    )
  })

  it('mergePersistedStoreState drops transient UI fields even if localStorage is manually polluted', () => {
    const merged = mergePersistedStoreState(
      {
        detailTaskId: 'task-stale',
        lightboxImageId: 'image-stale',
        lightboxImageList: ['image-stale'],
        showSettings: true,
        showPromptOptimizer: true,
        showCommandPalette: true,
        compareTaskIds: ['a', 'b'],
        lineageTaskId: 'task-lineage',
        captionBatchImageIds: ['image-a'],
        captionSource: 'data:image/png;base64,stale',
        confirmDialog: { title: 'stale', message: 'stale', action: () => undefined },
        toast: { id: 99, message: 'stale', type: 'error' },
        selectedTaskIds: ['hidden-task'],
        searchQuery: 'stale',
        searchQueryVersion: 7,
        filterStatus: 'error',
        filterFavorite: true,
        filterFavoriteCategoryId: 'cat-stale',
        setSettings: 'not-a-function',
        showToast: 'not-a-function',
        setConfirmDialog: 'not-a-function',
        setTasks: 'not-a-function',
      } as never,
      useStore.getInitialState(),
    )

    expect(merged.detailTaskId).toBeNull()
    expect(merged.lightboxImageId).toBeNull()
    expect(merged.lightboxImageList).toEqual([])
    expect(merged.showSettings).toBe(false)
    expect(merged.showPromptOptimizer).toBe(false)
    expect(merged.showCommandPalette).toBe(false)
    expect(merged.compareTaskIds).toBeNull()
    expect(merged.lineageTaskId).toBeNull()
    expect(merged.captionBatchImageIds).toBeNull()
    expect(merged.captionSource).toBeNull()
    expect(merged.confirmDialog).toBeNull()
    expect(merged.toast).toBeNull()
    expect(merged.selectedTaskIds).toEqual([])
    expect(merged.searchQuery).toBe('')
    expect(merged.searchQueryVersion).toBe(0)
    expect(merged.filterStatus).toBe('all')
    expect(merged.filterFavorite).toBe(false)
    expect(merged.filterFavoriteCategoryId).toBeNull()
    expect(merged.setSettings).toBe(useStore.getInitialState().setSettings)
    expect(merged.showToast).toBe(useStore.getInitialState().showToast)
    expect(merged.setConfirmDialog).toBe(useStore.getInitialState().setConfirmDialog)
    expect(merged.setTasks).toBe(useStore.getInitialState().setTasks)
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
    expect(useStore.getState().snippets).toEqual([expect.objectContaining({ id: a, sortOrder: 0 })])
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
      id: `s${i}`,
      name: `n${i}`,
      content: 'c',
      createdAt: i,
      updatedAt: i,
      sortOrder: i,
    }))
    useStore.setState({ snippets: many })

    expect(useStore.getState().createSnippet({ name: 'x', content: 'c' })).toBeNull()
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('上限'),
      'error',
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

    const merged = mergePersistedStoreState(
      {
        settings: DEFAULT_SETTINGS,
        snippets: [{ id: 's2', content: 'from-persist' }],
      },
      useStore.getInitialState(),
    )
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
        Array.from({ length: MAX_BATCH_NOTES }, (_, i) => [
          `b${i}`,
          { text: 'x', updatedAt: i + 1 },
        ]),
      ),
    })
    useStore.getState().setBatchNote('overflow', '新笔记')
    const notes = useStore.getState().batchNotes
    expect(Object.keys(notes)).toHaveLength(MAX_BATCH_NOTES)
    expect(notes.overflow.text).toBe('新笔记') // 新条目 updatedAt 最新,必被保留
    expect(notes.b0).toBeUndefined() // updatedAt 最旧的被挤出
  })

  it('normalizes batchNotes through persisted-state merge', () => {
    const merged = mergePersistedStoreState(
      {
        settings: DEFAULT_SETTINGS,
        batchNotes: {
          good: { text: '有效', updatedAt: 1 },
          bad: { text: '   ' },
        },
      } as never,
      useStore.getInitialState(),
    )
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
    useStore.setState({
      tourActive: true,
      tourStep: 5,
      hasSeenTour: true,
      mobileInputCollapsed: true,
    })
    const persisted = partialize(useStore.getState()) as Record<string, unknown>
    expect(persisted.hasSeenTour).toBe(true)
    expect(persisted).not.toHaveProperty('tourActive')
    expect(persisted).not.toHaveProperty('tourStep')
    expect(persisted).not.toHaveProperty('mobileInputCollapsed')
    useStore.setState({
      tourActive: false,
      tourStep: 0,
      hasSeenTour: false,
      mobileInputCollapsed: false,
    })
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
    expect(mergeImportedSettings(DEFAULT_SETTINGS, { batchConcurrency: 5 }).batchConcurrency).toBe(
      5,
    )
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

  it('surfaces batch scheduler failures and does not leave queued tasks running', async () => {
    const showToast = vi.fn()
    vi.mocked(mapWithConcurrency).mockRejectedValueOnce(new Error('scheduler failed'))
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1, batchConcurrency: 2 },
      prompt: '{a|b|c}',
      showToast,
    })

    await submitTask()

    await vi.waitFor(() => {
      expect(useStore.getState().tasks.every((t) => t.status === 'error')).toBe(true)
    })
    expect(
      useStore.getState().tasks.every((t) => t.error === '批量调度失败：scheduler failed'),
    ).toBe(true)
    expect(
      vi
        .mocked(putTask)
        .mock.calls.some(
          ([record]) =>
            record.status === 'error' && record.error === '批量调度失败：scheduler failed',
        ),
    ).toBe(true)
    expect(showToast).toHaveBeenCalledWith('批量调度失败：scheduler failed', 'error')
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

  it('uses normalized output count in wildcard large-batch confirmation copy', async () => {
    const setConfirmDialog = vi.fn()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: `{${Array.from({ length: 21 }, (_, index) => `p${index}`).join('|')}}`,
      params: { ...DEFAULT_PARAMS, n: 1.7 },
      setConfirmDialog,
      showToast: vi.fn(),
    })

    await submitTask()

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0]
    expect(dialog?.message).toContain('每条 2 张，共 42 张图片')
  })

  it('returns the wildcard large-batch retry promise from the confirmation action', async () => {
    const setConfirmDialog = vi.fn()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: `{${Array.from({ length: 21 }, (_, index) => `p${index}`).join('|')}}`,
      setConfirmDialog,
      showToast: vi.fn(),
    })

    await submitTask()

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => unknown
    }
    const result = dialog.action()

    expect(result).toHaveProperty('then')
  })

  it('uses normalized output count in grid large-batch confirmation copy', async () => {
    const setConfirmDialog = vi.fn()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'cat',
      params: { ...DEFAULT_PARAMS, n: 1.7 },
      setConfirmDialog,
      showToast: vi.fn(),
    })

    await submitGridTask({
      x: {
        kind: 'quality',
        values: Array.from({ length: 21 }, (_, index) => ({
          key: `quality-${index}`,
          label: `quality-${index}`,
        })),
      },
    })

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0]
    expect(dialog?.message).toContain('每格 2 张，共 42 张图片')
  })

  it('returns the grid large-batch retry promise from the confirmation action', async () => {
    const setConfirmDialog = vi.fn()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'cat',
      setConfirmDialog,
      showToast: vi.fn(),
    })

    await submitGridTask({
      x: {
        kind: 'quality',
        values: Array.from({ length: 21 }, (_, index) => ({
          key: `quality-${index}`,
          label: `quality-${index}`,
        })),
      },
    })

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => unknown
    }
    const result = dialog.action()

    expect(result).toHaveProperty('then')
  })

  it('reports grid submission preflight after async preparation through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const persist = createDeferred<string>()
    vi.mocked(storeImage).mockReturnValueOnce(persist.promise)
    useStore.setState({
      prompt: 'cat',
      inputImages: [imageA],
      showToast: oldToast,
    })

    const submitting = submitGridTask({
      x: {
        kind: 'quality',
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    })
    await Promise.resolve()
    useStore.setState({ showToast: latestToast })

    persist.resolve(imageA.id)
    await submitting

    expectLatestToastOnly(latestToast, oldToast, '网格生成：2×1，共 2 张图片', 'success')
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
      values: [
        { key: 'low', label: 'low' },
        { key: 'high', label: 'high' },
      ],
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

  it('retryGridMissing retries the latest failed representative even when an older cell result is done', async () => {
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    const gridAxes = {
      x: {
        kind: 'quality' as const,
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    }
    const oldDone = task({
      id: 'g-low-old',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'low' },
      status: 'done',
      createdAt: 1,
      params: { ...DEFAULT_PARAMS, quality: 'low' },
    })
    const latestFailed = task({
      id: 'g-low-latest',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'low' },
      status: 'error',
      createdAt: 3,
      params: { ...DEFAULT_PARAMS, quality: 'low' },
    })
    const highDone = task({
      id: 'g-high',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'high' },
      status: 'done',
      createdAt: 2,
      params: { ...DEFAULT_PARAMS, quality: 'high' },
    })
    useStore.setState({ tasks: [latestFailed, highDone, oldDone], showToast: vi.fn() })

    retryGridMissing('gb', 'all')

    await vi.waitFor(() => {
      const running = useStore.getState().tasks.filter((t) => t.status === 'running')
      expect(running).toHaveLength(1)
      expect(running[0]).toMatchObject({
        batchId: 'gb',
        gridCoord: { x: 'low' },
      })
      expect(running[0]?.params.quality).toBe('low')
    })
  })

  it('retryGridMissing preserves each failed grid cell profile when rebuilding multiple cells', async () => {
    const openaiProfile = {
      ...DEFAULT_SETTINGS.profiles[0],
      id: 'po',
      name: 'OpenAI grid',
      apiKey: 'ok',
      model: 'gpt-image-grid',
    }
    const geminiProfile = {
      id: 'pg',
      name: 'Gemini grid',
      provider: 'gemini' as const,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gk',
      model: 'gemini-2.5-flash-image',
      timeout: 600,
    }
    const gridAxes = {
      x: {
        kind: 'quality' as const,
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    }
    const lowOpenaiFailed = task({
      id: 'g-low',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'low' },
      status: 'error',
      params: { ...DEFAULT_PARAMS, quality: 'low' },
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      apiProfileName: openaiProfile.name,
      apiModel: openaiProfile.model,
    })
    const highGeminiFailed = task({
      id: 'g-high',
      batchId: 'gb',
      gridAxes,
      gridCoord: { x: 'high' },
      status: 'error',
      params: { ...DEFAULT_PARAMS, quality: 'high' },
      apiProvider: 'gemini',
      apiProfileId: geminiProfile.id,
      apiProfileName: geminiProfile.name,
      apiModel: geminiProfile.model,
    })
    vi.mocked(callImageApi).mockImplementation(() => new Promise(() => undefined))
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, geminiProfile],
        activeProfileId: geminiProfile.id,
      }),
      tasks: [highGeminiFailed, lowOpenaiFailed],
      showToast: vi.fn(),
    })

    retryGridMissing('gb', 'all')

    await vi.waitFor(() => {
      const running = useStore.getState().tasks.filter((t) => t.status === 'running')
      expect(running).toHaveLength(2)
      const lowRetry = running.find((t) => t.gridCoord?.x === 'low')
      const highRetry = running.find((t) => t.gridCoord?.x === 'high')
      expect(lowRetry).toMatchObject({
        apiProvider: 'openai',
        apiProfileId: openaiProfile.id,
        apiProfileName: openaiProfile.name,
        apiModel: openaiProfile.model,
      })
      expect(highRetry).toMatchObject({
        apiProvider: 'gemini',
        apiProfileId: geminiProfile.id,
        apiProfileName: geminiProfile.name,
        apiModel: geminiProfile.model,
      })
    })
  })
})
