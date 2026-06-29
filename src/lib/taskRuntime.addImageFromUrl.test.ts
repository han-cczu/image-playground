// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store'
import { deleteImage, storeImage } from './db'
import { setCachedImage } from './imageCache'
import { MAX_INPUT_IMAGE_BYTES } from './taskRuntime'
import { MAX_INPUT_IMAGES_PER_SUBMISSION } from './tasks'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    storeImage: vi.fn(async () => 'stored-image-id'),
    deleteImage: vi.fn(async () => undefined),
  }
})

vi.mock('./imageCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imageCache')>()
  return {
    ...actual,
    setCachedImage: vi.fn(),
  }
})

vi.mock('./image/canvasImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./image/canvasImage')>()
  return {
    ...actual,
    getImageDimensions: vi.fn(async () => ({ width: 16, height: 16 })),
  }
})

import { addImageFromFile, addImageFromUrl } from './taskRuntime'

describe('addImageFromUrl', () => {
  beforeEach(() => {
    vi.mocked(storeImage).mockReset()
    vi.mocked(storeImage).mockResolvedValue('stored-image-id')
    vi.mocked(deleteImage).mockClear()
    vi.mocked(setCachedImage).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('stores a valid remote image and adds it to input images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      })),
    )

    await addImageFromUrl('https://example.test/image.png')

    expect(storeImage).toHaveBeenCalledWith(expect.stringContaining('data:image/png;base64,'), 'upload')
    expect(setCachedImage).toHaveBeenCalledWith(
      'stored-image-id',
      expect.stringContaining('data:image/png;base64,'),
    )
    expect(useStore.getState().inputImages).toEqual([
      {
        id: 'stored-image-id',
        dataUrl: expect.stringContaining('data:image/png;base64,'),
      },
    ])
  })

  it('rejects duplicate remote images instead of resolving without adding a reference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      })),
    )
    useStore.setState({
      inputImages: [{ id: 'stored-image-id', dataUrl: 'data:image/png;base64,existing' }],
    })

    await expect(addImageFromUrl('https://example.test/duplicate.png')).rejects.toThrow(
      '图片已在参考图中',
    )

    expect(useStore.getState().inputImages).toEqual([
      { id: 'stored-image-id', dataUrl: 'data:image/png;base64,existing' },
    ])
  })

  it('rejects immediately when the input image list is already full', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
      headers: { 'Content-Type': 'image/png' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    useStore.setState({
      inputImages: Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION }, (_, index) => ({
        id: `existing-${index}`,
        dataUrl: `data:image/png;base64,existing-${index}`,
      })),
    })

    await expect(addImageFromUrl('https://example.test/full.png')).rejects.toThrow(
      `参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(storeImage).not.toHaveBeenCalled()
  })

  it('rolls back a stored remote image when the list becomes full before it is added', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      })),
    )
    useStore.setState({
      inputImages: Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION - 1 }, (_, index) => ({
        id: `existing-${index}`,
        dataUrl: `data:image/png;base64,existing-${index}`,
      })),
    })
    vi.mocked(storeImage).mockImplementationOnce(async () => {
      useStore.getState().addInputImage({
        id: 'concurrent-image',
        dataUrl: 'data:image/png;base64,concurrent',
      })
      return 'stored-late-image'
    })

    await expect(addImageFromUrl('https://example.test/race.png')).rejects.toThrow(
      `参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`,
    )

    expect(useStore.getState().inputImages.map((image) => image.id)).not.toContain(
      'stored-late-image',
    )
    expect(deleteImage).toHaveBeenCalledWith('stored-late-image')
  })

  it('stores only the bytes actually read from streamed subarray chunks', async () => {
    const buffer = new Uint8Array([9, 1, 2, 3, 9]).buffer
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(buffer, 1, 3))
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'image/png' } },
        ),
      ),
    )

    await addImageFromUrl('https://example.test/subarray.png')

    expect(storeImage).toHaveBeenCalledWith('data:image/png;base64,AQID', 'upload')
  })

  it('rejects when the remote image body keeps hanging after headers arrive', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers(),
            blob: vi.fn(() => new Promise<Blob>(() => undefined)),
          }) as unknown as Response,
      ),
    )

    const pending = addImageFromUrl('https://example.test/hanging.png')
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(60_000)

    const result = await Promise.race([
      observed,
      Promise.resolve('pending'),
    ])
    expect(result).toMatchObject({ message: expect.stringContaining('图片 URL 下载超时') })
  })

  it('stops reading a remote image stream once it exceeds the input image byte cap', async () => {
    let pulls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1
              controller.enqueue(new Uint8Array(1024 * 1024))
              if (pulls >= 100) controller.close()
            },
          }),
          { headers: { 'Content-Type': 'image/png' } },
        ),
      ),
    )

    await expect(addImageFromUrl('https://example.test/stream.png')).rejects.toThrow(
      `图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`,
    )
    expect(pulls).toBeLessThan(100)
    expect(storeImage).not.toHaveBeenCalled()
  })

  it('cleans up abort listeners when a streamed remote image reader throws synchronously', async () => {
    const removeEventListener = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
    const error = new Error('reader failed')
    const reader = {
      read: vi.fn(() => {
        throw error
      }),
      releaseLock: vi.fn(),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'image/png' }),
        body: {
          getReader: () => reader,
        },
      })),
    )

    await expect(addImageFromUrl('https://example.test/broken-reader.png')).rejects.toBe(error)

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(reader.releaseLock).toHaveBeenCalled()
    expect(storeImage).not.toHaveBeenCalled()
  })
})

describe('addImageFromFile', () => {
  beforeEach(() => {
    vi.mocked(storeImage).mockReset()
    vi.mocked(storeImage).mockResolvedValue('stored-image-id')
    vi.mocked(deleteImage).mockClear()
    vi.mocked(setCachedImage).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('rejects duplicate uploaded images instead of resolving without adding a reference', async () => {
    useStore.setState({
      inputImages: [{ id: 'stored-image-id', dataUrl: 'data:image/png;base64,existing' }],
    })

    await expect(addImageFromFile(new File(['image'], 'duplicate.png', { type: 'image/png' })))
      .rejects.toThrow('图片已在参考图中')

    expect(useStore.getState().inputImages).toEqual([
      { id: 'stored-image-id', dataUrl: 'data:image/png;base64,existing' },
    ])
    expect(deleteImage).not.toHaveBeenCalledWith('stored-image-id')
  })

  it('accepts uploaded image files whose MIME type is missing but extension is known', async () => {
    await addImageFromFile(new File(['image'], 'pasted.PNG', { type: '' }))

    expect(storeImage).toHaveBeenCalledWith(
      expect.stringContaining('data:image/png;base64,'),
      'upload',
    )
    expect(useStore.getState().inputImages).toEqual([
      {
        id: 'stored-image-id',
        dataUrl: expect.stringContaining('data:image/png;base64,'),
      },
    ])
  })

  it('rejects immediately when the input image list is already full', async () => {
    useStore.setState({
      inputImages: Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION }, (_, index) => ({
        id: `existing-${index}`,
        dataUrl: `data:image/png;base64,existing-${index}`,
      })),
    })

    await expect(addImageFromFile(new File(['image'], 'full.png', { type: 'image/png' })))
      .rejects.toThrow(`参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`)

    expect(storeImage).not.toHaveBeenCalled()
  })

  it('rolls back a stored uploaded image when the list becomes full before it is added', async () => {
    useStore.setState({
      inputImages: Array.from({ length: MAX_INPUT_IMAGES_PER_SUBMISSION - 1 }, (_, index) => ({
        id: `existing-${index}`,
        dataUrl: `data:image/png;base64,existing-${index}`,
      })),
    })
    vi.mocked(storeImage).mockImplementationOnce(async () => {
      useStore.getState().addInputImage({
        id: 'concurrent-image',
        dataUrl: 'data:image/png;base64,concurrent',
      })
      return 'stored-late-upload'
    })

    await expect(addImageFromFile(new File(['image'], 'race.png', { type: 'image/png' })))
      .rejects.toThrow(`参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张）`)

    expect(useStore.getState().inputImages.map((image) => image.id)).not.toContain(
      'stored-late-upload',
    )
    expect(deleteImage).toHaveBeenCalledWith('stored-late-upload')
  })
})
