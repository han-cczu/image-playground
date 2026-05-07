import { getImage } from './db'

/**
 * 图片 dataUrl 内存缓存。LRU 策略：超过 MAX_ENTRIES 时驱逐最久未访问项。
 * 利用 Map 的插入顺序 = 访问顺序：每次 get/set 命中时先 delete 再 set，
 * 最近访问的项始终在末尾。
 */
const MAX_ENTRIES = 100
const imageCache = new Map<string, string>()

function touch(id: string, dataUrl: string): void {
  // 命中即移到末尾，标记为最近使用
  imageCache.delete(id)
  imageCache.set(id, dataUrl)
}

function evictIfOverflow(): void {
  while (imageCache.size > MAX_ENTRIES) {
    const oldest = imageCache.keys().next().value
    if (oldest === undefined) break
    imageCache.delete(oldest)
  }
}

export function getCachedImage(id: string): string | undefined {
  const v = imageCache.get(id)
  if (v !== undefined) touch(id, v)
  return v
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  const cached = getCachedImage(id)
  if (cached !== undefined) return cached
  const rec = await getImage(id)
  if (rec) {
    imageCache.set(id, rec.dataUrl)
    evictIfOverflow()
    return rec.dataUrl
  }
  return undefined
}

export function setCachedImage(id: string, dataUrl: string): void {
  if (imageCache.has(id)) imageCache.delete(id)
  imageCache.set(id, dataUrl)
  evictIfOverflow()
}

export function deleteCachedImage(id: string): void {
  imageCache.delete(id)
}

export function clearImageCache(): void {
  imageCache.clear()
}

// 测试用，不在生产路径调用
export function _getCacheSizeForTesting(): number {
  return imageCache.size
}

export function _getCacheKeysInOrderForTesting(): string[] {
  return Array.from(imageCache.keys())
}

export const _MAX_ENTRIES_FOR_TESTING = MAX_ENTRIES
