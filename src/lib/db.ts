import type { Conversation, TaskRecord, StoredImage } from '../types'
import { ARCHIVE_CONVERSATION_ID, createArchiveConversation } from './conversations'

const DB_NAME = 'image-playground'
const DB_VERSION = 2
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_CONVERSATIONS = 'conversations'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      const tx = (e.target as IDBOpenDBRequest).transaction
      if (tx) {
        // 升级事务中途失败/中止时 reject,避免 Promise 永久挂起
        tx.onabort = () => reject(tx.error ?? new Error('数据库升级被中止'))
        tx.onerror = () => reject(tx.error)
      }
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        const store = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' })
        store.createIndex('byUpdatedAt', 'updatedAt')
        store.createIndex('bySortOrder', 'sortOrder')
        // v1 → v2：写入 archive 默认对话；按 favoriteCategory 切分留到 initStore 启动时跑（拿得到 zustand）。
        store.put(createArchiveConversation())
      } else if (tx) {
        // 已存在 conversations store 时，兜底确保 archive 存在
        const store = tx.objectStore(STORE_CONVERSATIONS)
        const getReq = store.get(ARCHIVE_CONVERSATION_ID)
        getReq.onsuccess = () => {
          if (!getReq.result) store.put(createArchiveConversation())
        }
      }
    }
    // 其它标签页持有旧版本连接时,版本升级会被阻塞;不处理会让 open 既不 success 也不 error,Promise 永久挂起。
    req.onblocked = () => reject(new Error('数据库升级被其它标签页阻塞,请关闭本站其它标签页后重试'))
    req.onsuccess = () => {
      const db = req.result
      // 另一标签页要做版本升级时主动 close 让路(否则它会一直 onblocked),并让缓存失效以便下次重开。
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      // 连接被意外关闭(如浏览器回收 / close())时也让缓存失效,避免后续操作复用已关闭连接。
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  // 打开失败不要把 rejected Promise 永久缓存(否则后续所有 DB 操作都被这次失败卡死),清空以便下次重试。
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

/** 仅供测试:重置模块级连接缓存,让下次 openDB 在(测试替换的)新 IDBFactory 上重新打开。 */
export function __resetDbCacheForTests(): void {
  dbPromise = null
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const req = fn(store)
        if (mode === 'readonly') {
          // 读操作无提交丢写风险,onsuccess 即可返回。
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        } else {
          // 写操作:req.onsuccess 仅表示写请求被接受,数据真正落盘在 tx.oncomplete。
          // 必须等 oncomplete 才 resolve;否则提交阶段 abort(配额/IO/标签页冻结回滚)会被
          // 误判为成功 → 静默丢写。对照 persistConversationMigration/deleteConversation 同款挂法。
          let result: T
          req.onsuccess = () => {
            result = req.result
          }
          req.onerror = () => reject(req.error)
          tx.oncomplete = () => resolve(result)
          tx.onabort = () => reject(tx.error ?? new Error('数据库写事务被中止'))
        }
      }),
  )
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

// ===== Conversations =====

export function getAllConversations(): Promise<Conversation[]> {
  return dbTransaction(STORE_CONVERSATIONS, 'readonly', (s) => s.getAll())
}

export function putConversation(conversation: Conversation): Promise<IDBValidKey> {
  return dbTransaction(STORE_CONVERSATIONS, 'readwrite', (s) => s.put(conversation))
}

/**
 * 清空 conversations object store。
 * 出于双层保护，调用方应在调用后立即重新写入 archive 默认对话。
 */
export function clearConversations(): Promise<undefined> {
  return dbTransaction(STORE_CONVERSATIONS, 'readwrite', (s) => s.clear())
}

/**
 * 批量写入 conversations + tasks（迁移期专用），单事务保证原子。
 */
export function persistConversationMigration(
  conversations: Conversation[],
  tasks: TaskRecord[],
): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_CONVERSATIONS, STORE_TASKS], 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('conversation migration aborted'))
        const convStore = tx.objectStore(STORE_CONVERSATIONS)
        for (const conv of conversations) convStore.put(conv)
        const taskStore = tx.objectStore(STORE_TASKS)
        for (const task of tasks) taskStore.put(task)
      }),
  )
}

/**
 * 删除一个 conversation。
 * - 「历史记录」(`__archive__`) 不允许删除，调用时抛错。
 * - 当 cascadeTasks=true 时，会在同一事务中级联删除该 conversation 下的 task。
 */
export function deleteConversation(id: string, cascadeTasks: boolean): Promise<void> {
  if (id === ARCHIVE_CONVERSATION_ID) {
    return Promise.reject(new Error('「历史记录」对话不可删除'))
  }
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const storeNames = cascadeTasks
          ? [STORE_CONVERSATIONS, STORE_TASKS]
          : [STORE_CONVERSATIONS]
        const tx = db.transaction(storeNames, 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('delete conversation aborted'))

        tx.objectStore(STORE_CONVERSATIONS).delete(id)

        if (!cascadeTasks) return
        const taskStore = tx.objectStore(STORE_TASKS)
        const cursorReq = taskStore.openCursor()
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor) return
          const value = cursor.value as TaskRecord
          if (value.conversationId === id) cursor.delete()
          cursor.continue()
        }
      }),
  )
}

// ===== Images =====

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id))
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export async function putImage(image: StoredImage): Promise<IDBValidKey> {
  const normalized = await normalizeImageForStorage(image)
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(normalized))
}

export function deleteImage(id: string): Promise<undefined> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.delete(id))
}

export function clearImages(): Promise<undefined> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.clear())
}

// ===== Image hashing & dedup =====

function createBytesFromBinary(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function getDataUrlMeta(dataUrl: string): { mime: string; isBase64: boolean; payload: string } {
  const commaIndex = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || commaIndex < 0) {
    throw new Error('图片 data URL 格式无效')
  }

  const meta = dataUrl.slice('data:'.length, commaIndex)
  const parts = meta.split(';').filter(Boolean)
  return {
    mime: parts[0] || 'application/octet-stream',
    isBase64: parts.some((part) => part.toLowerCase() === 'base64'),
    payload: dataUrl.slice(commaIndex + 1),
  }
}

export function dataUrlToImageBlob(dataUrl: string): { blob: Blob; mime: string } {
  const { mime, isBase64, payload } = getDataUrlMeta(dataUrl)
  let bytes: Uint8Array
  try {
    bytes = isBase64
      ? createBytesFromBinary(atob(payload.replace(/\s/g, '')))
      : new TextEncoder().encode(decodeURIComponent(payload))
  } catch {
    // atob / decodeURIComponent 对损坏内容会抛 DOMException;转成语义化错误供上层提示。
    throw new Error('图片 data URL 解码失败：内容已损坏')
  }

  return { blob: new Blob([copyBytesToArrayBuffer(bytes)], { type: mime }), mime }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export async function blobToDataUrl(blob: Blob, fallbackMime = 'application/octet-stream'): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return `data:${blob.type || fallbackMime};base64,${bytesToBase64(bytes)}`
}

export async function storedImageToDataUrl(image: StoredImage): Promise<string | undefined> {
  if (image.dataUrl) return image.dataUrl
  if (!image.blob) return undefined
  return blobToDataUrl(image.blob, image.mime)
}

export async function storedImageToBytes(image: StoredImage): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  if (image.blob) {
    return {
      bytes: new Uint8Array(await image.blob.arrayBuffer()),
      mime: image.blob.type || image.mime || 'application/octet-stream',
    }
  }

  if (!image.dataUrl) return undefined
  const { blob, mime } = dataUrlToImageBlob(image.dataUrl)
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime }
}

async function normalizeImageForStorage(image: StoredImage): Promise<StoredImage> {
  const source = image.blob
    ? { blob: image.blob, mime: image.blob.type || image.mime || 'application/octet-stream' }
    : image.dataUrl
      ? dataUrlToImageBlob(image.dataUrl)
      : { blob: undefined, mime: image.mime }

  return {
    id: image.id,
    ...(source.blob ? { blob: source.blob } : {}),
    ...(source.mime ? { mime: source.mime } : {}),
    ...(image.createdAt !== undefined ? { createdAt: image.createdAt } : {}),
    ...(image.source !== undefined ? { source: image.source } : {}),
  }
}

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id。
 */
export async function storeImage(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<string> {
  const id = await hashDataUrl(dataUrl)
  const existing = await getImage(id)
  if (!existing) {
    const { blob, mime } = dataUrlToImageBlob(dataUrl)
    await putImage({ id, blob, mime, createdAt: Date.now(), source })
  }
  return id
}
