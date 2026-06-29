// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BatchCaptionModal from './BatchCaptionModal'
import { ensureImageCached, getCachedImage, useStore } from '../store'
import { DEFAULT_SETTINGS } from '../lib/api/apiProfiles'
import { clearImageCache, getCachedImage as readCachedImage, setCachedImage } from '../lib/imageCache'
import { captionImageStream } from '../lib/api/captionImageApi'
import { copyTextToClipboard } from '../lib/image/clipboard'

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store')
  return {
    ...actual,
    ensureImageCached: vi.fn(),
    getCachedImage: vi.fn(actual.getCachedImage),
  }
})

vi.mock('../lib/api/captionImageApi', () => ({
  captionImageStream: vi.fn(async () => 'caption text'),
}))

vi.mock('../lib/image/clipboard', () => ({
  copyTextToClipboard: vi.fn(async () => undefined),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(captionImageStream).mockClear()
  vi.mocked(copyTextToClipboard).mockReset()
  vi.mocked(copyTextToClipboard).mockResolvedValue(undefined)
  vi.mocked(ensureImageCached).mockReset()
  vi.mocked(getCachedImage).mockReset()
  vi.mocked(getCachedImage).mockImplementation(readCachedImage)
  clearImageCache()
  useStore.setState(useStore.getInitialState(), true)
})

describe('BatchCaptionModal', () => {
  it('deduplicates image ids before rendering and requesting captions', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setCachedImage('img-a', 'data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a', 'img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
    })

    render(<BatchCaptionModal />)

    await waitFor(() => {
      expect(captionImageStream).toHaveBeenCalledTimes(1)
    })
    expect(screen.getAllByText('caption text')).toHaveLength(1)
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key'),
      expect.anything(),
    )
  })

  it('reports copy failure when Clipboard API is unavailable', async () => {
    const showToast = vi.fn()
    vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error('clipboard unavailable'))
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: undefined })
    setCachedImage('img-a', 'data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
      showToast,
    })

    render(<BatchCaptionModal />)

    await screen.findByText('caption text')
    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('复制失败', 'error')
    })
  })

  it('does not leave items queued when the caption API key is missing', async () => {
    setCachedImage('img-a', 'data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: '   ' },
      },
    })

    render(<BatchCaptionModal />)

    expect(screen.getByText(/反推 API 尚未配置 Key/)).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText('排队中…')).toBeNull()
    })
    expect(screen.getByText('反推失败：API Key 未配置')).toBeTruthy()
    expect(captionImageStream).not.toHaveBeenCalled()
  })

  it('uses a thumbnail that enters the cache before the thumbnail effect runs', async () => {
    vi.mocked(getCachedImage)
      .mockReturnValueOnce(undefined)
      .mockReturnValue('data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
    })

    render(<BatchCaptionModal />)

    await waitFor(() => {
      expect(captionImageStream).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(document.querySelector('img[src="data:image/png;base64,AA=="]')).not.toBeNull()
    })
    expect(ensureImageCached).not.toHaveBeenCalled()
  })

  it('reports delayed copy success through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const copy = createDeferred<void>()
    vi.mocked(copyTextToClipboard).mockReturnValueOnce(copy.promise)
    setCachedImage('img-a', 'data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
      showToast: oldToast,
    })

    render(<BatchCaptionModal />)

    await screen.findByText('caption text')
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    useStore.setState({ showToast: latestToast })

    await act(async () => {
      copy.resolve()
      await copy.promise
    })

    expect(latestToast).toHaveBeenCalledWith('已复制', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('reports delayed copy failure through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const copy = createDeferred<void>()
    vi.mocked(copyTextToClipboard).mockReturnValueOnce(copy.promise)
    setCachedImage('img-a', 'data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
      showToast: oldToast,
    })

    render(<BatchCaptionModal />)

    await screen.findByText('caption text')
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    useStore.setState({ showToast: latestToast })

    await act(async () => {
      copy.reject(new Error('clipboard unavailable'))
      await expect(copy.promise).rejects.toThrow('clipboard unavailable')
    })

    expect(latestToast).toHaveBeenCalledWith('复制失败', 'error')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('does not start caption requests after closing while image loading is pending', async () => {
    const imageLoad = createDeferred<string | undefined>()
    vi.mocked(ensureImageCached).mockReturnValueOnce(imageLoad.promise)
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
    })

    render(<BatchCaptionModal />)

    await waitFor(() => {
      expect(ensureImageCached).toHaveBeenCalledWith('img-a')
    })
    fireEvent.click(screen.getByRole('button', { name: '关闭批量反推' }))

    await act(async () => {
      imageLoad.resolve('data:image/png;base64,AA==')
      await Promise.resolve()
    })

    expect(captionImageStream).not.toHaveBeenCalled()
  })

  it('keeps cancelled items cancelled when an in-flight caption resolves later', async () => {
    const caption = createDeferred<string>()
    vi.mocked(captionImageStream).mockReturnValueOnce(caption.promise)
    setCachedImage('img-a', 'data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
    })

    render(<BatchCaptionModal />)

    await waitFor(() => {
      expect(captionImageStream).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getByRole('button', { name: '取消全部' }))

    await act(async () => {
      caption.resolve('caption after cancel')
      await Promise.resolve()
    })

    expect(screen.queryByText('反推失败：已取消')).not.toBeNull()
    expect(screen.queryByText('caption after cancel')).toBeNull()
  })

  it('keeps cancelled items cancelled when an in-flight caption rejects later', async () => {
    const caption = createDeferred<string>()
    vi.mocked(captionImageStream).mockReturnValueOnce(caption.promise)
    setCachedImage('img-a', 'data:image/png;base64,AA==')
    useStore.setState({
      captionBatchImageIds: ['img-a'],
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
    })

    render(<BatchCaptionModal />)

    await waitFor(() => {
      expect(captionImageStream).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getByRole('button', { name: '取消全部' }))

    await act(async () => {
      caption.reject(new Error('late network failure'))
      await Promise.resolve()
    })

    expect(screen.queryByText('反推失败：已取消')).not.toBeNull()
    expect(screen.queryByText('反推失败：late network failure')).toBeNull()
  })
})
