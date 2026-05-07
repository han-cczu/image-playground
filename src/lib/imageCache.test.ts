import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _MAX_ENTRIES_FOR_TESTING,
  _getCacheKeysInOrderForTesting,
  _getCacheSizeForTesting,
  clearImageCache,
  deleteCachedImage,
  ensureImageCached,
  getCachedImage,
  setCachedImage,
} from './imageCache'

vi.mock('./db', () => ({
  getImage: vi.fn(),
}))

import { getImage } from './db'
const mockedGetImage = vi.mocked(getImage)

describe('imageCache', () => {
  beforeEach(() => {
    clearImageCache()
    mockedGetImage.mockReset()
  })

  afterEach(() => {
    clearImageCache()
  })

  it('returns undefined for missing keys', () => {
    expect(getCachedImage('nope')).toBeUndefined()
  })

  it('stores and retrieves values', () => {
    setCachedImage('a', 'data:a')
    expect(getCachedImage('a')).toBe('data:a')
  })

  it('promotes accessed key to most-recently-used position', () => {
    setCachedImage('a', 'data:a')
    setCachedImage('b', 'data:b')
    setCachedImage('c', 'data:c')
    expect(_getCacheKeysInOrderForTesting()).toEqual(['a', 'b', 'c'])

    // 访问 a 后，a 应移到末尾
    getCachedImage('a')
    expect(_getCacheKeysInOrderForTesting()).toEqual(['b', 'c', 'a'])
  })

  it('replacing a key does not grow size', () => {
    setCachedImage('a', 'data:a')
    setCachedImage('a', 'data:a-new')
    expect(_getCacheSizeForTesting()).toBe(1)
    expect(getCachedImage('a')).toBe('data:a-new')
  })

  it('evicts least-recently-used when over capacity', () => {
    for (let i = 0; i < _MAX_ENTRIES_FOR_TESTING; i++) {
      setCachedImage(`k${i}`, `data:${i}`)
    }
    expect(_getCacheSizeForTesting()).toBe(_MAX_ENTRIES_FOR_TESTING)

    // 加一个新项，最旧的 k0 应被驱逐
    setCachedImage('k-new', 'data:new')
    expect(_getCacheSizeForTesting()).toBe(_MAX_ENTRIES_FOR_TESTING)
    expect(getCachedImage('k0')).toBeUndefined()
    expect(getCachedImage('k-new')).toBe('data:new')
  })

  it('access protects from eviction', () => {
    for (let i = 0; i < _MAX_ENTRIES_FOR_TESTING; i++) {
      setCachedImage(`k${i}`, `data:${i}`)
    }
    // 触碰 k0 让它变成最近使用
    getCachedImage('k0')
    setCachedImage('k-new', 'data:new')
    // 现在最旧的应该是 k1（不是 k0）
    expect(getCachedImage('k0')).toBe('data:0')
    expect(getCachedImage('k1')).toBeUndefined()
  })

  it('deleteCachedImage removes the entry', () => {
    setCachedImage('a', 'data:a')
    deleteCachedImage('a')
    expect(getCachedImage('a')).toBeUndefined()
  })

  it('clearImageCache empties the cache', () => {
    setCachedImage('a', 'data:a')
    setCachedImage('b', 'data:b')
    clearImageCache()
    expect(_getCacheSizeForTesting()).toBe(0)
  })

  it('ensureImageCached returns cached value without calling DB', async () => {
    setCachedImage('a', 'data:a')
    const result = await ensureImageCached('a')
    expect(result).toBe('data:a')
    expect(mockedGetImage).not.toHaveBeenCalled()
  })

  it('ensureImageCached fetches from DB on miss and caches with eviction', async () => {
    mockedGetImage.mockResolvedValueOnce({ id: 'a', dataUrl: 'data:a' })
    const result = await ensureImageCached('a')
    expect(result).toBe('data:a')
    expect(getCachedImage('a')).toBe('data:a')
    expect(mockedGetImage).toHaveBeenCalledWith('a')
  })

  it('ensureImageCached returns undefined when DB has no record', async () => {
    mockedGetImage.mockResolvedValueOnce(undefined)
    const result = await ensureImageCached('missing')
    expect(result).toBeUndefined()
    expect(_getCacheSizeForTesting()).toBe(0)
  })

  it('ensureImageCached evicts when DB-loaded item exceeds capacity', async () => {
    for (let i = 0; i < _MAX_ENTRIES_FOR_TESTING; i++) {
      setCachedImage(`k${i}`, `data:${i}`)
    }
    mockedGetImage.mockResolvedValueOnce({ id: 'fresh', dataUrl: 'data:fresh' })
    await ensureImageCached('fresh')
    expect(_getCacheSizeForTesting()).toBe(_MAX_ENTRIES_FOR_TESTING)
    expect(getCachedImage('k0')).toBeUndefined()
    expect(getCachedImage('fresh')).toBe('data:fresh')
  })
})
