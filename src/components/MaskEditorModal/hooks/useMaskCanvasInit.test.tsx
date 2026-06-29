// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMaskCanvasInit } from './useMaskCanvasInit'

const storeMocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(),
}))

vi.mock('../../../store', () => ({
  ensureImageCached: storeMocks.ensureImageCached,
}))

vi.mock('../../../lib/image/canvasImage', () => ({
  loadImage: vi.fn(async () => ({ naturalWidth: 64, naturalHeight: 64 })),
}))

vi.mock('../../../lib/image/maskPreprocess', () => ({
  prepareMaskTargetDataUrl: vi.fn(async (dataUrl: string) => ({
    dataUrl,
    width: 64,
    height: 64,
    originalWidth: 64,
    originalHeight: 64,
    scale: 1,
    wasResized: false,
    wasConvertedToPng: false,
  })),
}))

vi.mock('../maskCanvas', () => ({
  fillWhiteMask: vi.fn(),
}))

function createCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    })),
  } as unknown as HTMLCanvasElement
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeArgs(overrides: Partial<Parameters<typeof useMaskCanvasInit>[0]> = {}) {
  return {
    imageId: 'image-a',
    maskDraft: null,
    imageCanvasRef: { current: createCanvas() },
    maskCanvasRef: { current: createCanvas() },
    previewCanvasRef: { current: createCanvas() },
    renderPreview: vi.fn(),
    showToast: vi.fn(),
    setSourceDataUrl: vi.fn(),
    setSize: vi.fn(),
    setIsLoading: vi.fn(),
    setMaskEditorImageId: vi.fn(),
    cancelPreviewFrame: vi.fn(),
    resetViewportToDefault: vi.fn(),
    resetViewTransform: vi.fn(),
    resetHistory: vi.fn(),
    resetGestures: vi.fn(),
    resetActiveStroke: vi.fn(),
    ...overrides,
  }
}

describe('useMaskCanvasInit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    storeMocks.ensureImageCached.mockResolvedValue('data:image/png;base64,a')
  })

  it('does not run a stale viewport reset animation frame after the editor closes', async () => {
    let nextFrameId = 1
    const frames = new Map<number, FrameRequestCallback>()
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    })
    const cancelAnimationFrameMock = vi.fn((id: number) => {
      frames.delete(id)
    })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock)

    const args = makeArgs()
    const { rerender } = renderHook<void, { imageId: string | null }>(
      ({ imageId }: { imageId: string | null }) =>
        useMaskCanvasInit({ ...args, imageId }),
      { initialProps: { imageId: 'image-a' } },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1)

    rerender({ imageId: null })

    act(() => {
      for (const callback of [...frames.values()]) callback(0)
    })

    expect(args.resetViewTransform).not.toHaveBeenCalled()
    expect(cancelAnimationFrameMock).toHaveBeenCalled()
  })

  it('does not restart image initialization when only the toast handler changes', async () => {
    const load = createDeferred<string | undefined>()
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    storeMocks.ensureImageCached.mockReturnValue(load.promise)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const args = makeArgs({ showToast: oldToast })
    const { rerender } = renderHook<void, { showToast: typeof oldToast }>(
      ({ showToast }) => useMaskCanvasInit({ ...args, showToast }),
      { initialProps: { showToast: oldToast } },
    )
    const initialLoadCount = storeMocks.ensureImageCached.mock.calls.length

    rerender({ showToast: latestToast })

    expect(storeMocks.ensureImageCached).toHaveBeenCalledTimes(initialLoadCount)

    await act(async () => {
      load.resolve(undefined)
      await load.promise
    })

    expect(latestToast).toHaveBeenCalledWith('图片已不存在，无法编辑遮罩', 'error')
    expect(oldToast).not.toHaveBeenCalled()
  })
})
