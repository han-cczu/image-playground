import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import {
  __resetDbCacheForTests,
  dataUrlToImageBlob,
  deleteConversation,
  getAllConversations,
  getAllTasks,
  persistConversationMigration,
  putConversation,
  putTask,
  storedImageToBytes,
  storedImageToDataUrl,
} from './db'
import { ARCHIVE_CONVERSATION_ID, createArchiveConversation } from './conversations'

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

describe('stored image conversions', () => {
  it('converts base64 data URLs to image blobs', async () => {
    const result = dataUrlToImageBlob('data:image/png;base64,AQID')

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

  it('converts blob records back to data URLs and bytes', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })

    await expect(storedImageToDataUrl({ id: 'blob', blob, mime: 'image/webp' })).resolves.toBe(
      'data:image/webp;base64,AQID',
    )
    await expect(storedImageToBytes({ id: 'blob', blob, mime: 'image/webp' })).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/webp',
    })
  })
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
    expect(remainingTasks.map((t) => t.id).sort()).toEqual(
      ['task-archive', 'task-keep'].sort(),
    )
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
})
