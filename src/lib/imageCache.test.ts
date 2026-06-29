import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _MAX_ENTRIES_FOR_TESTING,
  _MAX_TOTAL_CHARS_FOR_TESTING,
  _getCacheKeysInOrderForTesting,
  _getDeletedVersionCountForTesting,
  _getCacheSizeForTesting,
  _getCacheTotalCharsForTesting,
  _setMaxTotalCharsForTesting,
  clearImageCache,
  deleteCachedImage,
  evictCachedImageDataUrl,
  ensureImageCached,
  getCachedImage,
  setCachedImage,
} from './imageCache'

vi.mock('./db', () => ({
  getImage: vi.fn(),
  storedImageToDataUrl: vi.fn((image: { dataUrl?: string; blob?: Blob; mime?: string }) => {
    if (image.dataUrl) {
      if (!image.dataUrl.slice(0, 'data:'.length).toLowerCase().startsWith('data:')) {
        return Promise.reject(new Error('图片 data URL 格式无效'))
      }
      const mime = image.dataUrl.slice('data:'.length, image.dataUrl.indexOf(',')).split(';')[0]
      if (!mime.toLowerCase().startsWith('image/')) {
        return Promise.reject(
          new Error(`图片 data URL 不是图片内容(Content-Type: ${mime || '未知'})`),
        )
      }
      return Promise.resolve(image.dataUrl)
    }
    if (!image.blob) return Promise.resolve(undefined)
    return image.blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return `data:${image.blob?.type || image.mime || 'application/octet-stream'};base64,${btoa(binary)}`
    })
  }),
}))

vi.mock('./objectUrlCache', () => ({
  clearImageObjectUrlCache: vi.fn(),
  deleteImageObjectUrl: vi.fn(),
}))

import { getImage } from './db'
import { clearImageObjectUrlCache, deleteImageObjectUrl } from './objectUrlCache'
const mockedGetImage = vi.mocked(getImage)

describe('imageCache', () => {
  beforeEach(() => {
    clearImageCache()
    mockedGetImage.mockReset()
    vi.mocked(clearImageObjectUrlCache).mockClear()
    vi.mocked(deleteImageObjectUrl).mockClear()
  })

  afterEach(() => {
    _setMaxTotalCharsForTesting(_MAX_TOTAL_CHARS_FOR_TESTING)
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

  it('evicts least-recently-used entries when total cached data exceeds the byte budget', () => {
    _setMaxTotalCharsForTesting(128)
    const big = 'x'.repeat(80)

    setCachedImage('a', `data:image/png;base64,${big}`)
    setCachedImage('b', `data:image/png;base64,${big}`)

    expect(getCachedImage('a')).toBeUndefined()
    expect(getCachedImage('b')).toBe(`data:image/png;base64,${big}`)
    expect(_getCacheTotalCharsForTesting()).toBe(`data:image/png;base64,${big}`.length)
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
    expect(deleteImageObjectUrl).toHaveBeenCalledWith('a')
  })

  it('evictCachedImageDataUrl drops only the data URL cache without revoking live object URLs', () => {
    setCachedImage('a', 'data:a')

    evictCachedImageDataUrl('a')

    expect(getCachedImage('a')).toBeUndefined()
    expect(deleteImageObjectUrl).not.toHaveBeenCalled()
    expect(_getDeletedVersionCountForTesting()).toBe(0)
  })

  it('deleteCachedImage does not retain tombstones when there is no in-flight DB load', () => {
    deleteCachedImage('a')
    deleteCachedImage('b')
    expect(_getDeletedVersionCountForTesting()).toBe(0)
  })

  it('clearImageCache empties the cache', () => {
    setCachedImage('a', 'data:a')
    setCachedImage('b', 'data:b')
    clearImageCache()
    expect(_getCacheSizeForTesting()).toBe(0)
    expect(_getCacheTotalCharsForTesting()).toBe(0)
    expect(clearImageObjectUrlCache).toHaveBeenCalled()
  })

  it('deleteCachedImage prevents an in-flight DB load for the same id from repopulating cache or UI', async () => {
    let resolveGetImage!: (value: { id: string; dataUrl: string }) => void
    mockedGetImage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGetImage = resolve
      }),
    )

    const pending = ensureImageCached('a')
    deleteCachedImage('a')
    resolveGetImage({ id: 'a', dataUrl: 'data:image/png;base64,YQ==' })

    await expect(pending).resolves.toBeUndefined()
    expect(getCachedImage('a')).toBeUndefined()
    expect(_getDeletedVersionCountForTesting()).toBe(0)
  })

  it('keeps a newer in-flight DB load protected after an older cleared load settles', async () => {
    const resolvers: Array<(value: { id: string; dataUrl: string }) => void> = []
    mockedGetImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const oldLoad = ensureImageCached('a')
    clearImageCache()
    const newLoad = ensureImageCached('a')

    resolvers[0]({ id: 'a', dataUrl: 'data:image/png;base64,b2xk' })
    await expect(oldLoad).resolves.toBeUndefined()

    deleteCachedImage('a')
    resolvers[1]({ id: 'a', dataUrl: 'data:image/png;base64,bmV3' })

    await expect(newLoad).resolves.toBeUndefined()
    expect(getCachedImage('a')).toBeUndefined()
    expect(_getDeletedVersionCountForTesting()).toBe(0)
  })

  it('ensureImageCached returns cached value without calling DB', async () => {
    setCachedImage('a', 'data:a')
    const result = await ensureImageCached('a')
    expect(result).toBe('data:a')
    expect(mockedGetImage).not.toHaveBeenCalled()
  })

  it('ensureImageCached fetches from DB on miss and caches with eviction', async () => {
    mockedGetImage.mockResolvedValueOnce({ id: 'a', dataUrl: 'data:image/png;base64,YQ==' })
    const result = await ensureImageCached('a')
    expect(result).toBe('data:image/png;base64,YQ==')
    expect(getCachedImage('a')).toBe('data:image/png;base64,YQ==')
    expect(mockedGetImage).toHaveBeenCalledWith('a')
  })

  it('coalesces concurrent DB loads for the same image id', async () => {
    let resolveGetImage!: (value: { id: string; dataUrl: string }) => void
    mockedGetImage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGetImage = resolve
      }),
    )

    const first = ensureImageCached('a')
    const second = ensureImageCached('a')

    expect(mockedGetImage).toHaveBeenCalledTimes(1)

    resolveGetImage({ id: 'a', dataUrl: 'data:image/png;base64,YQ==' })

    await expect(first).resolves.toBe('data:image/png;base64,YQ==')
    await expect(second).resolves.toBe('data:image/png;base64,YQ==')
    expect(getCachedImage('a')).toBe('data:image/png;base64,YQ==')
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
    mockedGetImage.mockResolvedValueOnce({
      id: 'fresh',
      dataUrl: 'data:image/png;base64,ZnJlc2g=',
    })
    await ensureImageCached('fresh')
    expect(_getCacheSizeForTesting()).toBe(_MAX_ENTRIES_FOR_TESTING)
    expect(getCachedImage('k0')).toBeUndefined()
    expect(getCachedImage('fresh')).toBe('data:image/png;base64,ZnJlc2g=')
  })

  it('ensureImageCached converts DB blob records to data URLs', async () => {
    mockedGetImage.mockResolvedValueOnce({
      id: 'blob-image',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      mime: 'image/png',
    })

    const result = await ensureImageCached('blob-image')

    expect(result).toBe('data:image/png;base64,AQID')
    expect(getCachedImage('blob-image')).toBe('data:image/png;base64,AQID')
  })

  it('does not cache legacy DB data URLs whose MIME type is not an image', async () => {
    mockedGetImage.mockResolvedValueOnce({
      id: 'legacy-text',
      dataUrl: 'data:text/plain;base64,SGk=',
    })

    await expect(ensureImageCached('legacy-text')).rejects.toThrow(
      '图片 data URL 不是图片内容',
    )
    expect(getCachedImage('legacy-text')).toBeUndefined()
  })
})
