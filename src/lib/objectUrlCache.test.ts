import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db', () => ({
  getImage: vi.fn(),
}))

import { getImage } from './db'
import {
  acquireImageObjectUrl,
  clearImageObjectUrlCache,
  deleteImageObjectUrl,
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

  it('旧版非图片 dataUrl 记录不返回给封面渲染', async () => {
    vi.mocked(getImage).mockResolvedValue({
      id: 'legacy-text',
      dataUrl: 'data:text/plain;base64,SGk=',
      createdAt: 1,
    })

    await expect(acquireImageObjectUrl('legacy-text')).resolves.toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('deleteImageObjectUrl prevents an in-flight legacy dataUrl acquire from returning stale data', async () => {
    let resolveRead!: (value: { id: string; dataUrl: string; createdAt: number }) => void
    vi.mocked(getImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )

    const pending = acquireImageObjectUrl('legacy')
    deleteImageObjectUrl('legacy')
    resolveRead({ id: 'legacy', dataUrl: 'data:image/png;base64,AA==', createdAt: 1 })

    await expect(pending).resolves.toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('图片不存在返回 null', async () => {
    vi.mocked(getImage).mockResolvedValue(undefined)
    expect(await acquireImageObjectUrl('missing')).toBeNull()
  })

  it('非图片 blob 记录不创建 objectURL', async () => {
    vi.mocked(getImage).mockResolvedValue({
      id: 'text-blob',
      blob: new Blob(['hello'], { type: 'text/plain' }),
      mime: 'text/plain',
      createdAt: 1,
    })

    await expect(acquireImageObjectUrl('text-blob')).resolves.toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('deleteImageObjectUrl revokes an entry even while refs are still held', async () => {
    vi.mocked(getImage).mockResolvedValue({
      id: 'a',
      blob: new Blob(['x']),
      mime: 'image/png',
      createdAt: 1,
    })

    const url = await acquireImageObjectUrl('a')
    deleteImageObjectUrl('a')

    expect(revokeObjectURL).toHaveBeenCalledWith(url)
    expect(_getObjectUrlEntriesForTesting().has('a')).toBe(false)
    releaseImageObjectUrl('a')
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('clearImageObjectUrlCache revokes every active object URL', async () => {
    vi.mocked(getImage).mockImplementation(async (id) => ({
      id,
      blob: new Blob([id]),
      mime: 'image/png',
      createdAt: 1,
    }))

    const urlA = await acquireImageObjectUrl('a')
    const urlB = await acquireImageObjectUrl('b')
    clearImageObjectUrlCache()

    expect(revokeObjectURL).toHaveBeenCalledWith(urlA)
    expect(revokeObjectURL).toHaveBeenCalledWith(urlB)
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('clearImageObjectUrlCache prevents an in-flight acquire from repopulating entries', async () => {
    let resolveRead!: (value: { id: string; blob: Blob; mime: string; createdAt: number }) => void
    vi.mocked(getImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )

    const pending = acquireImageObjectUrl('a')
    clearImageObjectUrlCache()
    resolveRead({ id: 'a', blob: new Blob(['x']), mime: 'image/png', createdAt: 1 })

    await expect(pending).resolves.toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-1')
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('deleteImageObjectUrl prevents an in-flight acquire for the same id from repopulating entries', async () => {
    let resolveRead!: (value: { id: string; blob: Blob; mime: string; createdAt: number }) => void
    vi.mocked(getImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )

    const pending = acquireImageObjectUrl('a')
    deleteImageObjectUrl('a')
    resolveRead({ id: 'a', blob: new Blob(['x']), mime: 'image/png', createdAt: 1 })

    await expect(pending).resolves.toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-1')
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('deleteImageObjectUrl prevents every waiter on an in-flight acquire from repopulating entries', async () => {
    let resolveRead!: (value: { id: string; blob: Blob; mime: string; createdAt: number }) => void
    vi.mocked(getImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )

    const first = acquireImageObjectUrl('a')
    const second = acquireImageObjectUrl('a')
    deleteImageObjectUrl('a')
    resolveRead({ id: 'a', blob: new Blob(['x']), mime: 'image/png', createdAt: 1 })

    await expect(Promise.all([first, second])).resolves.toEqual([null, null])
    expect(getImage).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-1')
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })

  it('keeps a newer in-flight acquire protected after an older cleared acquire settles', async () => {
    const resolvers: Array<(value: { id: string; blob: Blob; mime: string; createdAt: number }) => void> = []
    vi.mocked(getImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const oldAcquire = acquireImageObjectUrl('a')
    clearImageObjectUrlCache()
    const newAcquire = acquireImageObjectUrl('a')

    resolvers[0]({ id: 'a', blob: new Blob(['old']), mime: 'image/png', createdAt: 1 })
    await expect(oldAcquire).resolves.toBeNull()

    deleteImageObjectUrl('a')
    resolvers[1]({ id: 'a', blob: new Blob(['new']), mime: 'image/png', createdAt: 2 })

    await expect(newAcquire).resolves.toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-1')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-2')
    expect(_getObjectUrlEntriesForTesting().size).toBe(0)
  })
})
