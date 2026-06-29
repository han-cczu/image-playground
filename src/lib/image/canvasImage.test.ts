// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imageDataUrlToPngBlob, toPngBlob } from './canvasImage'

function installImageLoader() {
  class TestImage {
    naturalWidth = 128
    naturalHeight = 64
    onload: (() => void) | null = null
    onerror: (() => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }

  vi.stubGlobal('Image', TestImage)
}

function installCanvasStub() {
  const canvases: HTMLCanvasElement[] = []
  const originalCreateElement = document.createElement.bind(document)

  vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    if (tagName.toLowerCase() !== 'canvas') {
      return originalCreateElement(tagName, options)
    }

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))),
    } as unknown as HTMLCanvasElement
    canvases.push(canvas)
    return canvas
  })

  return canvases
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvasImage bitmap cleanup', () => {
  it('clears the temporary canvas after converting a data URL to PNG', async () => {
    installImageLoader()
    const canvases = installCanvasStub()

    await expect(imageDataUrlToPngBlob('data:image/webp;base64,AA==')).resolves.toMatchObject({
      type: 'image/png',
    })

    expect(canvases).toHaveLength(1)
    expect(canvases[0].width).toBe(0)
    expect(canvases[0].height).toBe(0)
  })

  it('clears the temporary canvas after converting a non-PNG Blob to PNG', async () => {
    installImageLoader()
    const canvases = installCanvasStub()
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:source'),
      revokeObjectURL,
    })

    await expect(toPngBlob(new Blob(['webp'], { type: 'image/webp' }))).resolves.toMatchObject({
      type: 'image/png',
    })

    expect(canvases).toHaveLength(1)
    expect(canvases[0].width).toBe(0)
    expect(canvases[0].height).toBe(0)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source')
  })
})
