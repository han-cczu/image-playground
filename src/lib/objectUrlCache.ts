import { getImage } from './db'

/**
 * 图片 objectURL 引用计数缓存,与 dataUrl LRU(imageCache)互补:
 * 卡片封面走 objectURL——浏览器只为实际显示的位图做解码,JS 堆不再常驻 base64 字符串
 * (全尺寸 dataUrl 每张数 MB,挂载卡数 × 首图大小可达数百 MB,且不受 LRU 约束),
 * 也省去 IDB 读取后的同步分块 base64 编码(blobToDataUrl 在主线程逐块 btoa,首渲卡顿)。
 *
 * 生命周期:acquire +1 引用,release -1,归零即 revokeObjectURL。
 * 同 id 并发 acquire 经 pending 去重,共享同一个 URL 条目。
 * 旧版记录(legacy dataUrl 无 blob)直接返回 dataUrl 字符串,不占引用计数(release 对其为 no-op)。
 */
interface Entry {
  url: string
  refs: number
}

const entries = new Map<string, Entry>()
const pending = new Map<string, Promise<string | null>>()
let cacheEpoch = 0
const deletedImageVersions = new Map<string, number>()

function isLegacyImageDataUrl(value: string | undefined): value is string {
  if (!value) return false
  const commaIndex = value.indexOf(',')
  if (value.slice(0, 'data:'.length).toLowerCase() !== 'data:' || commaIndex < 0) return false
  const mime = value.slice('data:'.length, commaIndex).split(';')[0]
  return mime.toLowerCase().startsWith('image/')
}

function isImageBlob(blob: Blob, fallbackMime?: string): boolean {
  const mime = blob.type || fallbackMime || 'application/octet-stream'
  return mime.toLowerCase().startsWith('image/')
}

export async function acquireImageObjectUrl(id: string): Promise<string | null> {
  const existing = entries.get(id)
  if (existing) {
    existing.refs++
    return existing.url
  }
  const inflight = pending.get(id)
  if (inflight) {
    // 等同一条加载完成后直接复用结果;若被 clear/delete 废弃则返回 null,不能递归重读 DB。
    const url = await inflight
    const entry = entries.get(id)
    if (entry) {
      entry.refs++
      return entry.url
    }
    return url
  }
  const startEpoch = cacheEpoch
  const startDeletedVersion = deletedImageVersions.get(id) ?? 0
  const load = (async (): Promise<string | null> => {
    const rec = await getImage(id)
    if (!rec) return null
    const isStale =
      cacheEpoch !== startEpoch ||
      (deletedImageVersions.get(id) ?? 0) !== startDeletedVersion
    if (isStale && !rec.blob) return null
    if (rec.blob) {
      if (!isImageBlob(rec.blob, rec.mime)) return null
      const url = URL.createObjectURL(rec.blob)
      if (isStale) {
        URL.revokeObjectURL(url)
        return null
      }
      entries.set(id, { url, refs: 0 })
      return url
    }
    // 旧版记录:dataUrl 字符串本身就是图,直接用(无 revoke 语义);但仍要拒绝
    // 非 image/* 的历史脏数据,避免把任意 data URL 交给封面渲染。
    return isLegacyImageDataUrl(rec.dataUrl) ? rec.dataUrl : null
  })()
  pending.set(id, load)
  try {
    const url = await load
    const entry = entries.get(id)
    if (entry) {
      entry.refs++
      return entry.url
    }
    return url
  } finally {
    if (pending.get(id) === load) {
      pending.delete(id)
      deletedImageVersions.delete(id)
    }
  }
}

export function releaseImageObjectUrl(id: string): void {
  const entry = entries.get(id)
  if (!entry) return
  entry.refs--
  if (entry.refs <= 0) {
    URL.revokeObjectURL(entry.url)
    entries.delete(id)
  }
}

export function deleteImageObjectUrl(id: string): void {
  const entry = entries.get(id)
  if (entry) {
    URL.revokeObjectURL(entry.url)
    entries.delete(id)
  }
  if (pending.has(id)) {
    deletedImageVersions.set(id, (deletedImageVersions.get(id) ?? 0) + 1)
  }
}

export function clearImageObjectUrlCache(): void {
  for (const entry of entries.values()) {
    URL.revokeObjectURL(entry.url)
  }
  entries.clear()
  pending.clear()
  cacheEpoch++
  deletedImageVersions.clear()
}

// 测试用
export function _getObjectUrlEntriesForTesting(): Map<string, { url: string; refs: number }> {
  return entries
}
