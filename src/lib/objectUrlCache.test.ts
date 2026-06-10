import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db', () => ({
  getImage: vi.fn(),
}))

import { getImage } from './db'
import {
  acquireImageObjectUrl,
  releaseImageObjectUrl,
  _getObjectUrlEntriesForTesting,
} from './objectUrlCache'

const createObjectURL = vi.fn()
const revokeObjectURL = vi.fn()

describe('objectUrlCache(H3 封面 objectURL 引用计数)', () => {
  beforeEach(() => {
    let seq = 0
    createObjectURL.mockReset().mockImplementation(() => `blob:fake-${++seq}`)
    revokeObjectURL.mockReset()
    vi.stubGlobal('URL', { ...globalThis.URL, createObjectURL, revokeObjectURL })
    vi.mocked(getImage).mockReset()
    _getObjectUrlEntriesForTesting().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('acquire 建 objectURL,引用归零即 revoke 并删条目', async () => {
    vi.mocked(getImage).mockResolvedValue({ id: 'a', blob: new Blob(['x']), mime: 'image/png', createdAt: 1 })

    const url1 = await acquireImageObjectUrl('a')
    const url2 = await acquireImageObjectUrl('a')
    expect(url1).toBe(url2)
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    releaseImageObjectUrl('a')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    releaseImageObjectUrl('a')
    expect(revokeObjectURL).toHaveBeenCalledWith(url1)
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('同 id 并发 acquire 经 pending 去重,只读一次 IDB、共享同一条目', async () => {
    let resolveRead: (v: { id: string; blob: Blob; mime: string; createdAt: number }) => void
    vi.mocked(getImage).mockImplementation(
      () => new Promise((resolve) => { resolveRead = resolve as typeof resolveRead }),
    )

    const p1 = acquireImageObjectUrl('a')
    const p2 = acquireImageObjectUrl('a')
    resolveRead!({ id: 'a', blob: new Blob(['x']), mime: 'image/png', createdAt: 1 })
    const [u1, u2] = await Promise.all([p1, p2])

    expect(getImage).toHaveBeenCalledTimes(1)
    expect(u1).toBe(u2)
    expect(_getObjectUrlEntriesForTesting().get('a')?.refs).toBe(2)
  })

  it('旧版记录(legacy dataUrl 无 blob)直接返回 dataUrl,release 为 no-op', async () => {
    vi.mocked(getImage).mockResolvedValue({ id: 'legacy', dataUrl: 'data:image/png;base64,AA==', createdAt: 1 })

    const url = await acquireImageObjectUrl('legacy')
    expect(url).toBe('data:image/png;base64,AA==')
    expect(createObjectURL).not.toHaveBeenCalled()
    releaseImageObjectUrl('legacy')
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('图片不存在返回 null', async () => {
    vi.mocked(getImage).mockResolvedValue(undefined)
    expect(await acquireImageObjectUrl('missing')).toBeNull()
  })
})
