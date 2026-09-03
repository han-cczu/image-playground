import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import {
  __resetDbCacheForTests,
  IDB_CHANGE_STORAGE_KEY,
  dataUrlToImageBlob,
  deleteConversation,
  forEachImageMeta,
  getAllConversations,
  getAllImages,
  getAllTasks,
  persistConversationMigration,
  pruneImagesViaCursor,
  putConversation,
  putImage,
  putTask,
  storedImageToBytes,
  storedImageToDataUrl,
} from './db'
import type { StoredImage } from '../types'
import { ARCHIVE_CONVERSATION_ID, createArchiveConversation } from './conversations'
import { MAX_TASKS } from './tasks'

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

function createTask(id: string, conversationId?: string): TaskRecord {
  return {
    id,
    prompt: `prompt-${id}`,
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
    ...(conversationId ? { conversationId } : {}),
  }
}

describe('IndexedDB cross-tab change notifications', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
    globalThis.localStorage = createLocalStorageStub()
    localStorage.clear()
  })

  afterEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
    localStorage.clear()
    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('bumps a localStorage change token after a write transaction completes', async () => {
    expect(localStorage.getItem(IDB_CHANGE_STORAGE_KEY)).toBeNull()

    await putTask(createTask('notified-task'))

    expect(localStorage.getItem(IDB_CHANGE_STORAGE_KEY)).toEqual(expect.any(String))
  })

  it('does not bump the change token for readonly queries', async () => {
    await getAllTasks()

    expect(localStorage.getItem(IDB_CHANGE_STORAGE_KEY)).toBeNull()
  })
})

describe('stored image conversions', () => {
  it('converts base64 data URLs to image blobs', async () => {
    const result = dataUrlToImageBlob('data:image/png;base64,AQID')

    expect(result.mime).toBe('image/png')
    expect(result.blob.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('rejects malformed data URLs with domain errors', () => {
    expect(() => dataUrlToImageBlob('not-a-data-url')).toThrow('图片 data URL 格式无效')
    expect(() => dataUrlToImageBlob('data:image/png;base64,%%%%')).toThrow('图片 data URL 解码失败')
  })

  it('rejects data URLs whose MIME type is not an image', () => {
    expect(() => dataUrlToImageBlob('data:text/plain;base64,SGk=')).toThrow(
      '图片 data URL 不是图片内容',
    )
  })

  it('accepts image data URLs whose MIME type uses uppercase letters', async () => {
    const result = dataUrlToImageBlob('data:IMAGE/PNG;base64,AQID')

    expect(result.mime).toBe('IMAGE/PNG')
    expect(result.blob.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('accepts image data URLs whose scheme uses uppercase letters', async () => {
    const result = dataUrlToImageBlob('DATA:image/png;base64,AQID')

    expect(result.mime).toBe('image/png')
    expect(result.blob.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('keeps legacy data URL records readable', async () => {
    const dataUrl = 'data:image/png;base64,AQID'

    await expect(storedImageToDataUrl({ id: 'legacy', dataUrl })).resolves.toBe(dataUrl)
    await expect(storedImageToBytes({ id: 'legacy', dataUrl })).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
    })
  })

  it('does not expose legacy data URL records whose MIME type is not an image', async () => {
    const record = { id: 'legacy-text', dataUrl: 'data:text/plain;base64,SGk=' }

    await expect(storedImageToDataUrl(record)).rejects.toThrow('图片 data URL 不是图片内容')
  })

  it('does not expose blob records whose MIME type is not an image', async () => {
    const record = {
      id: 'text-blob',
      blob: new Blob(['hello'], { type: 'text/plain' }),
      mime: 'text/plain',
    }

    await expect(storedImageToDataUrl(record)).rejects.toThrow('图片 Blob 不是图片内容')
    await expect(storedImageToBytes(record)).rejects.toThrow('图片 Blob 不是图片内容')
  })

  it('converts blob records back to data URLs and bytes', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })

    await expect(storedImageToDataUrl({ id: 'blob', blob, mime: 'image/webp' })).resolves.toBe(
      'data:image/webp;base64,AQID',
    )
    await expect(
      storedImageToBytes({ id: 'blob', blob, mime: 'image/webp' }),
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/webp',
    })
  })

  it('drops invalid image source metadata before storing images', async () => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()

    await putImage({
      id: 'bad-source',
      blob: new Blob(['image'], { type: 'image/png' }),
      source: 'legacy-bad-source',
    } as unknown as StoredImage)

    const stored = await getAllImages()

    expect(stored).toEqual([
      expect.not.objectContaining({
        source: 'legacy-bad-source',
      }),
    ])
  })

  it('putImage 以写入时刻盖章 storedAt,不信任调用方带来的值', async () => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
    // 不用假定时器:fake-indexeddb 靠真实定时器推进事务
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123_456)
    try {
      await putImage({
        id: 'stamped',
        blob: new Blob(['image'], { type: 'image/png' }),
        createdAt: 1,
        storedAt: 5,
      })
    } finally {
      nowSpy.mockRestore()
    }

    const stored = await getAllImages()

    expect(stored[0]).toMatchObject({ id: 'stamped', createdAt: 1, storedAt: 123_456 })
  })

  it('drops invalid image timestamps before storing images', async () => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()

    await putImage({
      id: 'bad-created-at',
      blob: new Blob(['image'], { type: 'image/png' }),
      createdAt: Number.POSITIVE_INFINITY,
    })

    const stored = await getAllImages()

    expect(stored).toEqual([
      expect.not.objectContaining({
        createdAt: Number.POSITIVE_INFINITY,
      }),
    ])
  })

  it('does not store blob records whose MIME type is not an image', async () => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()

    await expect(
      putImage({
        id: 'text-blob',
        blob: new Blob(['hello'], { type: 'text/plain' }),
        mime: 'text/plain',
      }),
    ).rejects.toThrow('图片 Blob 不是图片内容')

    await expect(getAllImages()).resolves.toEqual([])
  })

  it('does not store images whose legacy data URL cannot be decoded', async () => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()

    await expect(
      putImage({
        id: 'broken-data-url',
        dataUrl: 'data:image/png;base64,%%%%',
      }),
    ).rejects.toThrow('图片 data URL 解码失败')

    await expect(getAllImages()).resolves.toEqual([])
  })
})

describe('tasks object store', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
  })

  afterEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
  })

  it('normalizes task records read from IndexedDB', async () => {
    await putTask({
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
    } as unknown as TaskRecord)

    const tasks = await getAllTasks()

    expect(tasks).toEqual([
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
  })

  it('库内任务超过 MAX_TASKS 条时 getAllTasks 不截断,主键序最靠后的最新任务仍可读到', async () => {
    // 任务 id 与 genId 同构:base36 时间戳前缀,IDB getAll 按主键升序 ≈ 时间升序,
    // 最新任务排在最后——若读取侧套导入用的 MAX_TASKS 截断,丢的正是这一条(及其图片引用)。
    const base = 1_700_000_000_000
    const total = MAX_TASKS + 1
    const tasks = Array.from({ length: total }, (_, index) => ({
      ...createTask((base + index).toString(36)),
      createdAt: base + index,
      outputImages: index === total - 1 ? ['newest-output'] : [],
    }))
    const newestId = tasks[total - 1].id
    await persistConversationMigration([], tasks)

    const loaded = await getAllTasks()

    expect(loaded).toHaveLength(total)
    const newest = loaded.find((task) => task.id === newestId)
    expect(newest?.outputImages).toEqual(['newest-output'])
  }, 30_000)
})

describe('conversations object store', () => {
  beforeEach(() => {
    // 每个用例使用全新的 IDB，避免互相污染。openDB 现在缓存模块级连接,必须连同重置缓存,
    // 否则会复用上个用例 factory 的旧连接,破坏隔离。
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
  })

  afterEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
  })

  it('seeds the archive conversation on first open and preserves existing tasks across version upgrade', async () => {
    // 1) 模拟旧版数据库（v1）：只创建 tasks/images store，不创建 conversations
    const dbName = 'image-playground'
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('tasks', { keyPath: 'id' })
        req.result.createObjectStore('images', { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const tx = req.result.transaction('tasks', 'readwrite')
        tx.objectStore('tasks').put(createTask('legacy-task'))
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    // 2) 当前代码以 v2 打开，应触发 upgrade，加入 conversations store 与 archive 默认对话
    const tasks = await getAllTasks()
    const conversations = await getAllConversations()

    expect(tasks.map((t) => t.id)).toContain('legacy-task')
    expect(conversations.some((c) => c.id === ARCHIVE_CONVERSATION_ID)).toBe(true)
  })

  it('rejects deleting the archive conversation', async () => {
    await expect(deleteConversation(ARCHIVE_CONVERSATION_ID, true)).rejects.toThrow(
      '「历史记录」对话不可删除',
    )
  })

  it('cascade delete removes both the conversation and its tasks atomically', async () => {
    const archive = createArchiveConversation()
    const conv = {
      id: 'conv-target',
      title: '待删对话',
      createdAt: 1,
      updatedAt: 1,
    }
    const otherConv = {
      id: 'conv-keep',
      title: '保留对话',
      createdAt: 1,
      updatedAt: 1,
    }
    await persistConversationMigration([archive, conv, otherConv], [])
    await putTask(createTask('task-target-1', conv.id))
    await putTask(createTask('task-target-2', conv.id))
    await putTask(createTask('task-keep', otherConv.id))
    await putTask(createTask('task-archive', archive.id))

    await deleteConversation(conv.id, true)

    const remainingConversations = await getAllConversations()
    const remainingTasks = await getAllTasks()
    expect(remainingConversations.map((c) => c.id).sort()).toEqual(
      [archive.id, otherConv.id].sort(),
    )
    expect(remainingTasks.map((t) => t.id).sort()).toEqual(['task-archive', 'task-keep'].sort())
  })

  it('keeps tasks intact when cascadeTasks is false', async () => {
    const archive = createArchiveConversation()
    const conv = {
      id: 'conv-soft',
      title: '只删元数据',
      createdAt: 1,
      updatedAt: 1,
    }
    await persistConversationMigration([archive, conv], [])
    await putTask(createTask('task-soft', conv.id))

    await deleteConversation(conv.id, false)

    const conversations = await getAllConversations()
    const tasks = await getAllTasks()
    expect(conversations.map((c) => c.id)).not.toContain(conv.id)
    expect(tasks.map((t) => t.id)).toContain('task-soft')
  })

  it('putConversation writes a single conversation and getAllConversations returns it', async () => {
    await putConversation(createArchiveConversation())
    const conv = { id: 'conv-foo', title: 'foo', createdAt: 1, updatedAt: 2 }
    await putConversation(conv)
    const list = await getAllConversations()
    expect(list.find((c) => c.id === 'conv-foo')).toMatchObject(conv)
  })

  it('normalizes conversation records read from IndexedDB', async () => {
    await putConversation({
      id: 'dirty-conv',
      title: 42,
      createdAt: 'bad',
      updatedAt: 'bad',
      sortOrder: 'bad',
      color: 7,
    } as unknown as ReturnType<typeof createArchiveConversation>)

    const list = await getAllConversations()
    const dirty = list.find((c) => c.id === 'dirty-conv')

    expect(dirty).toEqual(
      expect.objectContaining({
        id: 'dirty-conv',
        title: '新对话',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        sortOrder: expect.any(Number),
        color: undefined,
      }),
    )
  })
})

describe('images cursor helpers (C1 游标统计)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
  })
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbCacheForTests()
  })

  const img = (id: string, body: string, createdAt: number): StoredImage => ({
    id,
    blob: new Blob([body]),
    mime: 'image/png',
    source: 'generated',
    createdAt,
  })

  it('forEachImageMeta visits every record then resolves on tx.oncomplete', async () => {
    await putImage(img('a', '12', 1))
    await putImage(img('b', '345', 2))
    await putImage(img('c', '6', 3))

    const seen: string[] = []
    await forEachImageMeta((image) => seen.push(image.id))

    expect(seen.sort()).toEqual(['a', 'b', 'c'])
  })

  it('forEachImageMeta resolves with no callback on an empty store', async () => {
    const seen: string[] = []
    await expect(forEachImageMeta((image) => seen.push(image.id))).resolves.toBeUndefined()
    expect(seen).toEqual([])
  })

  it('forEachImageMeta rejects when the record callback throws', async () => {
    await putImage(img('bad-callback', '1', 1))

    await expect(
      forEachImageMeta(() => {
        throw new Error('callback failed')
      }),
    ).rejects.toThrow('callback failed')
  })

  it('pruneImagesViaCursor deletes only matched records in a single transaction', async () => {
    await putImage(img('keep', '1', 1))
    await putImage(img('drop1', '22', 1))
    await putImage(img('drop2', '333', 1))

    const deleted: string[] = []
    await pruneImagesViaCursor(
      (image) => image.id.startsWith('drop'),
      (image) => deleted.push(image.id),
    )

    expect(deleted.sort()).toEqual(['drop1', 'drop2'])
    const remaining = await getAllImages()
    expect(remaining.map((i) => i.id)).toEqual(['keep'])
  })

  it('pruneImagesViaCursor with a never-match predicate keeps everything', async () => {
    await putImage(img('x', '1', 1))
    await putImage(img('y', '2', 1))

    const deleted: string[] = []
    await pruneImagesViaCursor(
      () => false,
      (image) => deleted.push(image.id),
    )

    expect(deleted).toEqual([])
    expect((await getAllImages()).map((i) => i.id).sort()).toEqual(['x', 'y'])
  })

  it('pruneImagesViaCursor rejects and aborts when the delete predicate throws', async () => {
    await putImage(img('a', '1', 1))
    await putImage(img('b', '2', 1))

    await expect(
      pruneImagesViaCursor(
        (image) => {
          if (image.id === 'a') throw new Error('predicate failed')
          return true
        },
        () => undefined,
      ),
    ).rejects.toThrow('predicate failed')

    expect((await getAllImages()).map((i) => i.id).sort()).toEqual(['a', 'b'])
  })
})
