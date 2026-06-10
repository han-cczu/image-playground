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

export async function acquireImageObjectUrl(id: string): Promise<string | null> {
  const existing = entries.get(id)
  if (existing) {
    existing.refs++
    return existing.url
  }
  const inflight = pending.get(id)
  if (inflight) {
    // 等同一条加载完成后走 entries 命中分支拿引用
    await inflight
    return acquireImageObjectUrl(id)
  }
  const load = (async (): Promise<string | null> => {
    const rec = await getImage(id)
    if (!rec) return null
    if (rec.blob) {
      const url = URL.createObjectURL(rec.blob)
      entries.set(id, { url, refs: 0 })
      return url
    }
    // 旧版记录:dataUrl 字符串本身就是图,直接用(无 revoke 语义)
    return rec.dataUrl ?? null
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
    pending.delete(id)
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

// 测试用
export function _getObjectUrlEntriesForTesting(): Map<string, { url: string; refs: number }> {
  return entries
}
