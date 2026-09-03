// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { exportGridSheet } from './gridSheetRender'

vi.mock('./objectUrlCache', () => ({
  acquireImageObjectUrl: vi.fn(async () => null),
  releaseImageObjectUrl: vi.fn(),
}))
import { acquireImageObjectUrl, releaseImageObjectUrl } from './objectUrlCache'

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

  it('逐张经 objectUrlCache 加载并在画完后释放:同一张图多格引用只 acquire 一次,每次 acquire 都配对 release', async () => {
    const drawImage = vi.fn()
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
        drawImage,
      })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))),
    }
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') return canvas as unknown as HTMLCanvasElement
      if (tagName === 'a')
        return { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement
      return originalCreateElement(tagName)
    })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:grid'), revokeObjectURL: vi.fn() })
    // jsdom 不解码图片:让 Image 一赋 src 就触发 onload
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        width = 10
        height = 10
        set src(_value: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    )
    vi.mocked(acquireImageObjectUrl).mockImplementation(async (id) =>
      id === 'missing' ? null : `blob:${id}`,
    )

    await exportGridSheet({
      tasks: [
        task({ id: 'a1', gridCoord: { x: 'low' }, outputImages: ['img-shared'] }),
        // high 格与 low 格引用同一张图
        task({ id: 'a2', gridCoord: { x: 'high' }, outputImages: ['img-shared'], createdAt: 2 }),
        task({ id: 'a3', gridCoord: { x: 'high' }, outputImages: ['missing'], createdAt: 1 }),
      ],
      batchId: 'batch-a',
    })

    // 代表图取最新 task 的首图:high 格取 a2 → img-shared,a3 的 missing 不会被引用
    expect(vi.mocked(acquireImageObjectUrl).mock.calls.map(([id]) => id)).toEqual(['img-shared'])
    expect(vi.mocked(releaseImageObjectUrl).mock.calls.map(([id]) => id)).toEqual(['img-shared'])
    // 共享图画了两格
    expect(drawImage).toHaveBeenCalledTimes(2)
  })
})
