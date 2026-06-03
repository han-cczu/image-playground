/**
 * 本地图片存储用量统计与孤儿回收。
 *
 * 核心约束:`collectReferencedImageIds` 是「图片是否在用」的**唯一判定来源**,
 * 由 initStore 启动 GC、本模块统计、本模块手动清理共用,杜绝多份引用扫描漂移。
 */

import type { InputImage, StoredImage, TaskRecord } from '../types'
import { getDataUrlDecodedByteSize } from './api/imageApiShared'
import { deleteImage, getAllImages } from './db'
import { deleteCachedImage } from './imageCache'

/**
 * 收集当前所有「在用」图片 id:tasks 的 inputImageIds / maskImageId / outputImages,
 * 外加输入栏暂存的 inputImages。纯函数,不读全局态、不碰 DB。
 *
 * 任何新增的图片引用字段都应只在此处补充,initStore 与孤儿清理会自动跟随。
 */
export function collectReferencedImageIds(
  tasks: TaskRecord[],
  inputImages: Pick<InputImage, 'id'>[],
): Set<string> {
  const ids = new Set<string>()
  for (const img of inputImages) ids.add(img.id)
  for (const t of tasks) {
    for (const id of t.inputImageIds || []) ids.add(id)
    if (t.maskImageId) ids.add(t.maskImageId)
    for (const id of t.outputImages || []) ids.add(id)
  }
  return ids
}

/** 单张图的字节数:优先 blob.size,回退 dataUrl 解码估算,再回退 0。 */
export function storedImageByteSize(img: StoredImage): number {
  if (img.blob) return img.blob.size
  if (img.dataUrl) return getDataUrlDecodedByteSize(img.dataUrl)
  return 0
}

/** 人类可读字节:B / KB / MB / GB / TB,保留 1 位小数(B 不带小数)。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

export type ImageSourceBucket = 'upload' | 'generated' | 'mask' | 'unknown'

export interface StorageStats {
  totalBytes: number
  imageCount: number
  /** 按 source 桶聚合;source 缺失或非法归入 unknown */
  bySource: Record<ImageSourceBucket, { count: number; bytes: number }>
  orphanCount: number
  orphanBytes: number
  /** navigator.storage.estimate() 结果;不支持/报错时为 null */
  quota: { usage: number; quota: number } | null
}

function emptyBySource(): StorageStats['bySource'] {
  return {
    upload: { count: 0, bytes: 0 },
    generated: { count: 0, bytes: 0 },
    mask: { count: 0, bytes: 0 },
    unknown: { count: 0, bytes: 0 },
  }
}

async function readStorageQuota(): Promise<StorageStats['quota']> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!storage?.estimate) return null
    const est = await storage.estimate()
    if (typeof est.usage === 'number' && typeof est.quota === 'number') {
      return { usage: est.usage, quota: est.quota }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 读全部图 + 当前引用集 → 统计用量。
 *
 * 注意:孤儿计数(orphanCount/orphanBytes)仅用「当前是否无引用」判定,**不加** createdAt
 * 时间守卫——那是展示值,加守卫会把刚生成、引用集尚未刷新的图误报为孤儿。时间守卫只在
 * 真正删除(pruneOrphanImages)时施加。
 */
export async function computeStorageStats(referencedIds: Set<string>): Promise<StorageStats> {
  const images = await getAllImages()
  const bySource = emptyBySource()
  let totalBytes = 0
  let orphanCount = 0
  let orphanBytes = 0

  for (const img of images) {
    const size = storedImageByteSize(img)
    totalBytes += size
    const key = (img.source ?? 'unknown') as ImageSourceBucket
    const bucket = bySource[key] ?? bySource.unknown
    bucket.count++
    bucket.bytes += size
    if (!referencedIds.has(img.id)) {
      orphanCount++
      orphanBytes += size
    }
  }

  return {
    totalBytes,
    imageCount: images.length,
    bySource,
    orphanCount,
    orphanBytes,
    quota: await readStorageQuota(),
  }
}

/**
 * 删除当前无引用且 `createdAt < cutoff` 的孤儿图(DB + 内存缓存成对删)。
 *
 * cutoff 守卫沿用 initStore 语义:放过清理期间另一标签刚 storeImage、其 task 尚未进本页
 * 引用集的新图。最坏只漏删孤儿(良性),绝不误删在用图。返回删除计数与释放字节。
 */
export async function pruneOrphanImages(
  referencedIds: Set<string>,
  cutoff: number,
): Promise<{ deletedCount: number; deletedBytes: number }> {
  const images = await getAllImages()
  let deletedCount = 0
  let deletedBytes = 0

  for (const img of images) {
    if (referencedIds.has(img.id)) continue
    if ((img.createdAt ?? 0) >= cutoff) continue
    deletedBytes += storedImageByteSize(img)
    deletedCount++
    await deleteImage(img.id)
    deleteCachedImage(img.id)
  }

  return { deletedCount, deletedBytes }
}
