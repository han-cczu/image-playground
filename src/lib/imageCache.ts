import { getImage, storedImageToDataUrl } from './db'
import { clearImageObjectUrlCache, deleteImageObjectUrl } from './objectUrlCache'

/**
 * 图片 dataUrl 内存缓存。LRU 策略：超过条数或累计字节预算时驱逐最久未访问项。
 * 利用 Map 的插入顺序 = 访问顺序：每次 get/set 命中时先 delete 再 set，
 * 最近访问的项始终在末尾。
 *
 * 预算按「驻留字节」计:JS 字符串是 UTF-16,每字符 2 字节——此前按字符数计数,
 * 96M「字符」实际驻留 ≈192MB 堆(2026-06-10 审查遗留 low 项),口径修正后同一常量
 * 语义变为真实内存占用上限。
 */
const MAX_ENTRIES = 100
const DEFAULT_MAX_TOTAL_BYTES = 96 * 1024 * 1024
/** dataUrl 主体是 base64 ASCII,V8 仍按 UTF-16 存储:驻留字节 = length × 2 */
const BYTES_PER_CHAR = 2
const imageCache = new Map<string, string>()
const inFlightLoads = new Map<string, Promise<string | undefined>>()
let maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES
let cacheTotalBytes = 0
// 每次 clearImageCache 自增;ensureImageCached 用它判断 await 期间缓存是否被清空,避免把已删图写回(僵尸缓存)。
let cacheEpoch = 0
const deletedImageVersions = new Map<string, number>()
const activeLoadTokens = new Map<string, Set<symbol>>()

function deleteCacheEntry(id: string): void {
  const existing = imageCache.get(id)
  if (existing !== undefined) cacheTotalBytes -= existing.length * BYTES_PER_CHAR
  imageCache.delete(id)
}

function touch(id: string, dataUrl: string): void {
  // 命中即移到末尾，标记为最近使用
  deleteCacheEntry(id)
  imageCache.set(id, dataUrl)
  cacheTotalBytes += dataUrl.length * BYTES_PER_CHAR
}

function evictIfOverflow(): void {
  while (imageCache.size > MAX_ENTRIES || cacheTotalBytes > maxTotalBytes) {
    const oldest = imageCache.keys().next().value
    if (oldest === undefined) break
    deleteCacheEntry(oldest)
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
  const inFlight = inFlightLoads.get(id)
  if (inFlight) return inFlight
  const startEpoch = cacheEpoch
  const startDeletedVersion = deletedImageVersions.get(id) ?? 0
  const loadToken = Symbol(id)
  const activeTokens = activeLoadTokens.get(id) ?? new Set<symbol>()
  activeTokens.add(loadToken)
  activeLoadTokens.set(id, activeTokens)
  const load = (async () => {
    const rec = await getImage(id)
    if (rec) {
      const dataUrl = await storedImageToDataUrl(rec)
      if (!dataUrl) return undefined
      // 若 await 期间发生 clear/delete,本次读取已过期;不能把旧图交给调用方写回 UI。
      if (cacheEpoch !== startEpoch) return undefined
      if ((deletedImageVersions.get(id) ?? 0) !== startDeletedVersion) return undefined
      touch(id, dataUrl)
      evictIfOverflow()
      return dataUrl
    }
    return undefined
  })()
  inFlightLoads.set(id, load)
  try {
    return await load
  } finally {
    if (inFlightLoads.get(id) === load) inFlightLoads.delete(id)
    const tokens = activeLoadTokens.get(id)
    if (tokens?.delete(loadToken) && tokens.size === 0) {
      activeLoadTokens.delete(id)
      deletedImageVersions.delete(id)
    }
  }
}

export function setCachedImage(id: string, dataUrl: string): void {
  touch(id, dataUrl)
  evictIfOverflow()
}

export function evictCachedImageDataUrl(id: string): void {
  deleteCacheEntry(id)
}

export function deleteCachedImage(id: string): void {
  deleteCacheEntry(id)
  deleteImageObjectUrl(id)
  if (activeLoadTokens.has(id)) {
    deletedImageVersions.set(id, (deletedImageVersions.get(id) ?? 0) + 1)
  }
}

export function clearImageCache(): void {
  imageCache.clear()
  cacheTotalBytes = 0
  inFlightLoads.clear()
  clearImageObjectUrlCache()
  cacheEpoch++
  deletedImageVersions.clear()
  activeLoadTokens.clear()
}

// 测试用，不在生产路径调用
export function _getCacheSizeForTesting(): number {
  return imageCache.size
}

export function _getCacheTotalBytesForTesting(): number {
  return cacheTotalBytes
}

export function _getCacheEpochForTesting(): number {
  return cacheEpoch
}

export function _getCacheKeysInOrderForTesting(): string[] {
  return Array.from(imageCache.keys())
}

export function _getDeletedVersionCountForTesting(): number {
  return deletedImageVersions.size
}

export const _MAX_ENTRIES_FOR_TESTING = MAX_ENTRIES
export const _MAX_TOTAL_BYTES_FOR_TESTING = DEFAULT_MAX_TOTAL_BYTES

export function _setMaxTotalBytesForTesting(value: number): void {
  maxTotalBytes =
    Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_TOTAL_BYTES
  evictIfOverflow()
}
