import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type InputImage, type StoredImage, type TaskRecord } from '../types'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    getAllConversations: vi.fn(async () => []),
    getAllTasks: vi.fn(async () => []),
    getAllImages: vi.fn(async () => []),
    getImage: vi.fn(async () => undefined),
    putConversation: vi.fn(async () => 'conversation-id'),
    persistConversationMigration: vi.fn(async () => undefined),
  }
})

vi.mock('./storageStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storageStats')>()
  return {
    ...actual,
    pruneOrphanImages: vi.fn(async () => ({ deletedCount: 0, deletedBytes: 0 })),
  }
})

import { getAllConversations, getAllImages, getAllTasks, getImage, putConversation } from './db'
import { ARCHIVE_CONVERSATION_ID, CONVERSATION_MIGRATION_VERSION } from './conversations'
import { pruneOrphanImages } from './storageStats'
import { useStore } from '../store'
import {
  __runPendingStartupOrphanGcForTests,
  initStore,
  ORPHAN_GC_MIN_INTERVAL_MS,
  resetTaskRuntimeForTest,
} from './taskRuntime'

const storedInputImage: InputImage = { id: 'input-a', dataUrl: '' }

function createLocalStorageStub(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
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
    conversationId: 'conv-a',
    ...overrides,
  }
}

beforeEach(() => {
  resetTaskRuntimeForTest()
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  vi.stubGlobal('localStorage', createLocalStorageStub())
  localStorage.setItem(
    'image-playground.conversationMigrationVersion',
    String(CONVERSATION_MIGRATION_VERSION),
  )
  vi.mocked(getAllConversations).mockReset()
  vi.mocked(getAllConversations).mockResolvedValue([
    {
      id: 'conv-a',
      title: 'A',
      createdAt: 1,
      updatedAt: 1,
      sortOrder: 0,
      color: null,
    },
  ])
  vi.mocked(getAllTasks).mockReset()
  vi.mocked(getAllTasks).mockResolvedValue([])
  vi.mocked(getAllImages).mockReset()
  vi.mocked(getAllImages).mockResolvedValue([])
  vi.mocked(getImage).mockReset()
  vi.mocked(getImage).mockResolvedValue(undefined)
  vi.mocked(putConversation).mockReset()
  vi.mocked(putConversation).mockResolvedValue('conversation-id')
  vi.mocked(pruneOrphanImages).mockReset()
  vi.mocked(pruneOrphanImages).mockResolvedValue({ deletedCount: 0, deletedBytes: 0 })
  useStore.setState({
    conversations: [],
    activeConversationId: 'conv-a',
    tasks: [],
    inputImages: [],
    maskDraft: null,
    maskEditorImageId: null,
    favoriteCategories: [],
  })
})

describe('initStore image cleanup', () => {
  it('coalesces concurrent initStore calls into a single IndexedDB initialization pass', async () => {
    let releaseTasks!: () => void
    vi.mocked(getAllTasks).mockImplementation(
      async () =>
        new Promise((resolve) => {
          releaseTasks = () => resolve([])
        }),
    )

    const first = initStore()
    const second = initStore()
    await vi.waitFor(() => expect(getAllTasks).toHaveBeenCalledTimes(1))

    releaseTasks()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])

    expect(getAllConversations).toHaveBeenCalledTimes(1)
    // GC 已改为 init 完成后的空闲期调度:flush 前不执行,flush 后合并的两次 init 也只跑一次
    expect(pruneOrphanImages).not.toHaveBeenCalled()
    await __runPendingStartupOrphanGcForTests()
    expect(pruneOrphanImages).toHaveBeenCalledTimes(1)
  })

  it('throttles startup orphan GC to once per interval and re-runs after it elapses', async () => {
    await initStore()
    await __runPendingStartupOrphanGcForTests()
    expect(pruneOrphanImages).toHaveBeenCalledTimes(1)

    // 频控周期内的下一次启动:不调度(lastOrphanGcAt 在首次执行完成时写入,= 假时钟 10_000)
    resetTaskRuntimeForTest()
    vi.setSystemTime(10_000 + ORPHAN_GC_MIN_INTERVAL_MS - 1)
    await initStore()
    await __runPendingStartupOrphanGcForTests()
    expect(pruneOrphanImages).toHaveBeenCalledTimes(1)

    // 周期已过:重新调度
    resetTaskRuntimeForTest()
    vi.setSystemTime(10_000 + ORPHAN_GC_MIN_INTERVAL_MS + 1)
    await initStore()
    await __runPendingStartupOrphanGcForTests()
    expect(pruneOrphanImages).toHaveBeenCalledTimes(2)
  })

  it('normalizes persisted tasks before exposing them to the store and image pruning', async () => {
    vi.mocked(getAllTasks).mockResolvedValue([
      {
        id: 'dirty-task',
        prompt: 42,
        params: { n: 'not-a-number' },
        inputImageIds: ['kept-input', 7],
        outputImages: 'not-an-array',
        status: 'weird',
        gridAxes: {
          x: { kind: 'quality', values: [{ key: 1, label: 'low' }] },
        },
        gridCoord: { x: 42 },
        conversationId: 'conv-a',
      } as unknown as TaskRecord,
    ])

    await initStore()

    expect(useStore.getState().tasks).toEqual([
      expect.objectContaining({
        id: 'dirty-task',
        prompt: '',
        params: expect.objectContaining({ n: 1 }),
        inputImageIds: ['kept-input'],
        outputImages: [],
        status: 'done',
        gridAxes: undefined,
        gridCoord: undefined,
      }),
    ])
    await __runPendingStartupOrphanGcForTests()
    expect(pruneOrphanImages).toHaveBeenCalledWith(new Set(['kept-input']), 10_000)
  })

  it('uses cursor-based orphan pruning and restores persisted input images without loading all images', async () => {
    const persistedImage = {
      id: storedInputImage.id,
      blob: new Blob(['image-bytes'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    } satisfies StoredImage
    vi.mocked(getAllTasks).mockResolvedValue([
      task({ inputImageIds: ['task-input'], outputImages: ['task-output'] }),
    ])
    vi.mocked(getImage).mockImplementation(async (id) =>
      id === storedInputImage.id ? persistedImage : undefined,
    )
    useStore.setState({ inputImages: [storedInputImage] })

    await initStore()

    expect(getAllImages).not.toHaveBeenCalled()
    await __runPendingStartupOrphanGcForTests()
    expect(pruneOrphanImages).toHaveBeenCalledWith(
      new Set(['input-a', 'task-input', 'task-output']),
      10_000,
    )
    expect(getImage).toHaveBeenCalledWith('input-a')
    expect(useStore.getState().inputImages[0]).toMatchObject({
      id: 'input-a',
      dataUrl: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=',
    })
    expect(useStore.getState().conversations.some((c) => c.id === ARCHIVE_CONVERSATION_ID)).toBe(
      true,
    )
  })

  it('drops persisted input images whose legacy data URL is not an image without aborting init', async () => {
    vi.mocked(getImage).mockImplementation(async (id) =>
      id === storedInputImage.id
        ? {
            id: storedInputImage.id,
            dataUrl: 'data:text/plain;base64,SGk=',
            createdAt: 1,
          }
        : undefined,
    )
    useStore.setState({ inputImages: [storedInputImage] })

    await expect(initStore()).resolves.toBeUndefined()

    expect(useStore.getState().inputImages).toEqual([])
    expect(useStore.getState().conversations.some((c) => c.id === ARCHIVE_CONVERSATION_ID)).toBe(
      true,
    )
  })

  it('does not overwrite input images added while persisted input images are being restored', async () => {
    const persistedImage = {
      id: storedInputImage.id,
      blob: new Blob(['image-bytes'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    } satisfies StoredImage
    let releaseGetImage!: () => void
    vi.mocked(getImage).mockImplementation(
      async (id) =>
        new Promise((resolve) => {
          releaseGetImage = () =>
            resolve(id === storedInputImage.id ? persistedImage : undefined)
        }),
    )
    useStore.setState({ inputImages: [storedInputImage] })

    const initPromise = initStore()
    await vi.waitFor(() => expect(getImage).toHaveBeenCalledWith(storedInputImage.id))

    useStore.getState().addInputImage({ id: 'fresh-input', dataUrl: 'data:image/png;base64,fresh' })
    releaseGetImage()
    await initPromise

    expect(useStore.getState().inputImages.map((img) => img.id)).toEqual([
      'input-a',
      'fresh-input',
    ])
    expect(useStore.getState().inputImages.find((img) => img.id === 'input-a')?.dataUrl).toBe(
      'data:image/png;base64,aW1hZ2UtYnl0ZXM=',
    )
  })
})
