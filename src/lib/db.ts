import type { TaskRecord, StoredImage } from '../types'

const DB_NAME = 'image-playground'
const DB_VERSION = 1
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
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
  const bytes = isBase64
    ? createBytesFromBinary(atob(payload.replace(/\s/g, '')))
    : new TextEncoder().encode(decodeURIComponent(payload))

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
