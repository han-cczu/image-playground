// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { exportGridSheet } from './gridSheetRender'

vi.mock('./imageCache', () => ({
  ensureImageCached: vi.fn(async () => null),
}))

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    batchId: 'batch-a',
    gridAxes: {
      x: {
        kind: 'quality',
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    },
    gridCoord: { x: 'low' },
    ...overrides,
  }
}

describe('exportGridSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('revokes the generated object URL even when the download click fails', async () => {
    const click = vi.fn(() => {
      throw new Error('click blocked')
    })
    const revokeObjectURL = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        font: '',
        fillStyle: '',
        textAlign: '',
        textBaseline: '',
        measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
        fillText: vi.fn(),
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))),
    }
    const originalCreateElement = document.createElement.bind(document)

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') return canvas as unknown as HTMLCanvasElement
      if (tagName === 'a') {
        return {
          href: '',
          download: '',
          click,
        } as unknown as HTMLAnchorElement
      }
      return originalCreateElement(tagName)
    })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:grid'),
      revokeObjectURL,
    })

    await expect(
      exportGridSheet({
        tasks: [task(), task({ id: 'task-b', gridCoord: { x: 'high' } })],
        batchId: 'batch-a',
      }),
    ).rejects.toThrow('click blocked')

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:grid')
  })
})
