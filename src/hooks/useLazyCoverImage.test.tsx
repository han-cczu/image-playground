// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('../lib/objectUrlCache', () => ({
  acquireImageObjectUrl: vi.fn(),
  releaseImageObjectUrl: vi.fn(),
}))
vi.mock('../lib/imageCache', () => ({
  getCachedImage: vi.fn(() => undefined),
}))

import { acquireImageObjectUrl, releaseImageObjectUrl } from '../lib/objectUrlCache'
import { getCachedImage } from '../lib/imageCache'
import { useLazyCoverImage } from './useLazyCoverImage'

afterEach(() => {
  vi.mocked(acquireImageObjectUrl).mockReset()
  vi.mocked(releaseImageObjectUrl).mockClear()
  vi.mocked(getCachedImage).mockReset()
  vi.mocked(getCachedImage).mockReturnValue(undefined)
})

/** jsdom 无 IntersectionObserver → attachRef 走「立即可见」分支,直接驱动加载 */
function attachAndLoad(result: { current: ReturnType<typeof useLazyCoverImage> }) {
  act(() => {
    result.current.attachRef(document.createElement('div'))
  })
}

describe('useLazyCoverImage 接线(H3)', () => {
  it('加载后卸载必须归还 objectURL 引用(删掉 cleanup release 即内存泄漏,本测试会红)', async () => {
    vi.mocked(acquireImageObjectUrl).mockResolvedValue('blob:cover-1')
    const { result, unmount } = renderHook(() => useLazyCoverImage('img-1'))
    attachAndLoad(result)
    await waitFor(() => expect(result.current.src).toBe('blob:cover-1'))

    unmount()
    expect(releaseImageObjectUrl).toHaveBeenCalledWith('img-1')
  })

  it('imageId 切换:旧引用归还、旧 URL 立即失配不再作为 src(防串图/防已 revoke URL 复用)', async () => {
    vi.mocked(acquireImageObjectUrl).mockImplementation(async (id: string) => `blob:${id}`)
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useLazyCoverImage(id), {
      initialProps: { id: 'img-a' as string | undefined },
    })
    attachAndLoad(result)
    await waitFor(() => expect(result.current.src).toBe('blob:img-a'))

    rerender({ id: 'img-b' })
    // 旧引用立刻归还;新图未到位前 src 为空(派生失配),绝不显示旧 URL
    expect(releaseImageObjectUrl).toHaveBeenCalledWith('img-a')
    expect(result.current.src).toBe('')
    await waitFor(() => expect(result.current.src).toBe('blob:img-b'))
  })

  it('LRU 命中作首帧,随后仍以 objectURL 替换(base64 不长期 pin 在卡片 state)', async () => {
    vi.mocked(getCachedImage).mockReturnValue('data:image/png;base64,FIRSTFRAME')
    let resolveAcquire!: (url: string) => void
    vi.mocked(acquireImageObjectUrl).mockImplementation(
      () => new Promise((resolve) => { resolveAcquire = resolve }),
    )
    const { result } = renderHook(() => useLazyCoverImage('img-c'))
    attachAndLoad(result)

    await waitFor(() => expect(result.current.src).toBe('data:image/png;base64,FIRSTFRAME'))
    resolveAcquire('blob:img-c')
    await waitFor(() => expect(result.current.src).toBe('blob:img-c'))
  })

  it('imageId 为 undefined 不加载且 src 为空', () => {
    const { result } = renderHook(() => useLazyCoverImage(undefined))
    attachAndLoad(result)
    expect(result.current.src).toBe('')
    expect(acquireImageObjectUrl).not.toHaveBeenCalled()
  })
})
