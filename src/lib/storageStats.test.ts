import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredImage, TaskRecord } from '../types'

vi.mock('./db', () => ({
  getAllImages: vi.fn(),
  deleteImage: vi.fn(),
}))
vi.mock('./imageCache', () => ({
  deleteCachedImage: vi.fn(),
}))

import { deleteImage, getAllImages } from './db'
import { deleteCachedImage } from './imageCache'
import {
  collectReferencedImageIds,
  computeStorageStats,
  formatBytes,
  pruneOrphanImages,
  storedImageByteSize,
} from './storageStats'

beforeEach(() => {
  vi.mocked(getAllImages).mockReset()
  vi.mocked(deleteImage).mockReset().mockResolvedValue(undefined)
  vi.mocked(deleteCachedImage).mockReset()
})

describe('collectReferencedImageIds', () => {
  it('unions input/mask/output ids across tasks, with dedup and null tolerance', () => {
    const tasks = [
      { inputImageIds: ['a', 'b'], maskImageId: 'm', outputImages: ['o1'] } as TaskRecord,
      { inputImageIds: ['b'], outputImages: ['o2'] } as TaskRecord, // b 重复
      {} as TaskRecord, // 缺字段:空值兜底,不抛
    ]
    const refs = collectReferencedImageIds(tasks, [{ id: 'in1' }])
    expect([...refs].sort()).toEqual(['a', 'b', 'in1', 'm', 'o1', 'o2'])
  })
})

describe('storedImageByteSize', () => {
  it('prefers blob.size, falls back to dataUrl decode, then 0', () => {
    expect(storedImageByteSize({ id: 'a', blob: new Blob(['abc']) })).toBe(3)
    const dataUrl = `data:image/png;base64,${btoa('hi')}`
    expect(storedImageByteSize({ id: 'b', dataUrl })).toBe(2)
    expect(storedImageByteSize({ id: 'c' })).toBe(0)
  })
})

describe('formatBytes', () => {
  it('formats bytes human-readably', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })
})

describe('computeStorageStats', () => {
  it('aggregates total, per-source buckets and orphans (no time guard on orphan count)', async () => {
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'a', blob: new Blob(['12345']), source: 'upload', createdAt: 1 }, // 5, referenced
      { id: 'b', blob: new Blob(['123']), source: 'generated', createdAt: 1 }, // 3, orphan
      { id: 'c', blob: new Blob(['1']), createdAt: 1 }, // 1, no source -> unknown, orphan
    ] satisfies StoredImage[])

    const stats = await computeStorageStats(new Set(['a']))

    expect(stats.totalBytes).toBe(9)
    expect(stats.imageCount).toBe(3)
    expect(stats.bySource.upload).toEqual({ count: 1, bytes: 5 })
    expect(stats.bySource.generated).toEqual({ count: 1, bytes: 3 })
    expect(stats.bySource.mask).toEqual({ count: 0, bytes: 0 })
    expect(stats.bySource.unknown).toEqual({ count: 1, bytes: 1 })
    expect(stats.orphanCount).toBe(2)
    expect(stats.orphanBytes).toBe(4)
    expect(stats.quota).toBeNull() // node 环境无 navigator.storage
  })
})

describe('pruneOrphanImages', () => {
  it('deletes only unreferenced images older than cutoff', async () => {
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'ref', blob: new Blob(['12']), createdAt: 1 }, // referenced -> keep
      { id: 'old', blob: new Blob(['123']), createdAt: 1 }, // orphan + old -> delete
      { id: 'fresh', blob: new Blob(['1234']), createdAt: 9999 }, // orphan but >= cutoff -> keep
    ] satisfies StoredImage[])

    const res = await pruneOrphanImages(new Set(['ref']), 5000)

    expect(res).toEqual({ deletedCount: 1, deletedBytes: 3 })
    expect(deleteImage).toHaveBeenCalledTimes(1)
    expect(deleteImage).toHaveBeenCalledWith('old')
    expect(deleteCachedImage).toHaveBeenCalledWith('old')
  })

  it('treats missing createdAt as 0 (always deletable when unreferenced)', async () => {
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'no-date', blob: new Blob(['1']) }, // 无 createdAt -> 视为 0 < cutoff
    ] satisfies StoredImage[])

    const res = await pruneOrphanImages(new Set(), 5000)

    expect(res.deletedCount).toBe(1)
    expect(deleteImage).toHaveBeenCalledWith('no-date')
  })
})
