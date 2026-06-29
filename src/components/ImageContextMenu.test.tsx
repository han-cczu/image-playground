// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ImageContextMenu from './ImageContextMenu'
import { useStore } from '../store'
import { MAX_INPUT_IMAGE_BYTES, MAX_INPUT_IMAGE_PIXELS } from '../lib/taskRuntime'

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  return {
    ...actual,
    addImageFromUrl: vi.fn(actual.addImageFromUrl),
  }
})

import { addImageFromUrl } from '../store'

const canvasImageMocks = vi.hoisted(() => ({
  getImageDimensions: vi.fn(async () => ({ width: 16, height: 16 })),
  validateMaskMatchesImage: vi.fn(),
}))

vi.mock('../lib/image/canvasImage', () => canvasImageMocks)

const clipboardMocks = vi.hoisted(() => ({
  copyBlobToClipboard: vi.fn(),
  getClipboardFailureMessage: vi.fn((fallback: string) => fallback),
}))

vi.mock('../lib/image/clipboard', () => clipboardMocks)

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ImageContextMenu', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('cleans up the temporary download anchor and object URL when download click fails', async () => {
    const showToast = vi.fn()
    const removeChild = vi.spyOn(document.body, 'removeChild')
    const click = vi.fn(() => {
      throw new Error('click blocked')
    })
    const anchor = document.createElement('a')
    anchor.click = click
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') return anchor
      return originalCreateElement(tagName)
    })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="data:image/png;base64,AA==" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '下载' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('下载失败', 'error')
    })
    expect(click).toHaveBeenCalled()
    expect(removeChild).toHaveBeenCalledWith(anchor)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')
  })

  it('does not download an image when fetching the menu target fails', async () => {
    const showToast = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:download')
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['missing'], { type: 'image/png' }), { status: 404 })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/missing.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '下载' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('下载失败', 'error')
    })
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('does not download a non-image response from the menu target', async () => {
    const showToast = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:download')
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['<html></html>'], { type: 'text/html' }))),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/not-image" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '下载' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('下载失败', 'error')
    })
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('does not download an oversized image response from the menu target', async () => {
    const showToast = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:download')
    const blob = vi.fn(async () => new Blob(['huge'], { type: 'image/png' }))
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Length': String(MAX_INPUT_IMAGE_BYTES + 1) }),
        blob,
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/huge.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '下载' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('下载失败', 'error')
    })
    expect(blob).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('does not copy an image when fetching the menu target fails', async () => {
    const showToast = vi.fn()
    clipboardMocks.copyBlobToClipboard.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['missing'], { type: 'image/png' }), { status: 404 })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/missing.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('复制失败', 'error')
    })
    expect(clipboardMocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('does not copy a non-image response from the menu target', async () => {
    const showToast = vi.fn()
    clipboardMocks.copyBlobToClipboard.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['<html></html>'], { type: 'text/html' }))),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/not-image" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('复制失败', 'error')
    })
    expect(clipboardMocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('does not copy an oversized image response from the menu target', async () => {
    const showToast = vi.fn()
    const blob = vi.fn(async () => new Blob(['huge'], { type: 'image/png' }))
    clipboardMocks.copyBlobToClipboard.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Length': String(MAX_INPUT_IMAGE_BYTES + 1) }),
        blob,
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/huge.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('复制失败', 'error')
    })
    expect(blob).not.toHaveBeenCalled()
    expect(clipboardMocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('stops copying a streaming menu target once the body exceeds the image size cap', async () => {
    const showToast = vi.fn()
    let pulls = 0
    clipboardMocks.copyBlobToClipboard.mockResolvedValue(undefined)
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
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/stream.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('复制失败', 'error')
    })
    expect(pulls).toBeLessThan(100)
    expect(clipboardMocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('reports delayed copy success through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const copy = createDeferred()
    clipboardMocks.copyBlobToClipboard.mockReturnValueOnce(copy.promise)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast: oldToast })

    render(
      <>
        <img src="https://example.test/copy.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))

    await waitFor(() => {
      expect(clipboardMocks.copyBlobToClipboard).toHaveBeenCalledTimes(1)
    })
    useStore.setState({ showToast: latestToast })

    await act(async () => {
      copy.resolve()
      await copy.promise
    })

    expect(latestToast).toHaveBeenCalledWith('图片已复制', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('reports delayed copy failure through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const copy = createDeferred()
    clipboardMocks.copyBlobToClipboard.mockReturnValueOnce(copy.promise)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast: oldToast })

    render(
      <>
        <img src="https://example.test/copy.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))

    await waitFor(() => {
      expect(clipboardMocks.copyBlobToClipboard).toHaveBeenCalledTimes(1)
    })
    useStore.setState({ showToast: latestToast })

    await act(async () => {
      copy.reject(new Error('clipboard denied'))
      await Promise.resolve()
    })

    expect(latestToast).toHaveBeenCalledWith('复制失败', 'error')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('shows copy failure when the menu target image body keeps hanging', async () => {
    vi.useFakeTimers()
    const showToast = vi.fn()
    clipboardMocks.copyBlobToClipboard.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        blob: vi.fn(() => new Promise<Blob>(() => undefined)),
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="https://example.test/hanging.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }))

    await vi.advanceTimersByTimeAsync(60_000)
    await Promise.resolve()
    await Promise.resolve()

    expect(showToast).toHaveBeenCalledWith('复制失败', 'error')
    expect(clipboardMocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('rejects oversized caption source URLs before reading the response body', async () => {
    const showToast = vi.fn()
    const setCaptionSource = vi.fn()
    const blob = vi.fn(async () => new Blob(['body'], { type: 'image/png' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Length': String(MAX_INPUT_IMAGE_BYTES + 1) }),
        blob,
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({
      settings: {
        ...useStore.getInitialState().settings,
        captioner: {
          ...useStore.getInitialState().settings.captioner,
          apiKey: 'caption-key',
        },
      },
      showToast,
      setCaptionSource,
    })

    render(
      <>
        <img src="https://example.test/huge.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '反推提示词' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('图片过大'), 'error')
    })
    expect(blob).not.toHaveBeenCalled()
    expect(setCaptionSource).not.toHaveBeenCalled()
  })

  it('rejects caption source URLs whose decoded dimensions exceed the pixel limit', async () => {
    const showToast = vi.fn()
    const setCaptionSource = vi.fn()
    canvasImageMocks.getImageDimensions.mockResolvedValueOnce({
      width: MAX_INPUT_IMAGE_PIXELS + 1,
      height: 1,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['small'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({
      settings: {
        ...useStore.getInitialState().settings,
        captioner: {
          ...useStore.getInitialState().settings.captioner,
          apiKey: 'caption-key',
        },
      },
      showToast,
      setCaptionSource,
    })

    render(
      <>
        <img src="https://example.test/wide.png" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '反推提示词' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('图片分辨率过大'), 'error')
    })
    expect(setCaptionSource).not.toHaveBeenCalled()
  })

  it('shows edit failure when adding the menu target as a reference is rejected', async () => {
    const showToast = vi.fn()
    vi.mocked(addImageFromUrl).mockRejectedValueOnce(new Error('图片已在参考图中'))
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    useStore.setState({ showToast })

    render(
      <>
        <img src="data:image/png;base64,AA==" alt="target" />
        <ImageContextMenu />
      </>,
    )

    fireEvent.contextMenu(screen.getByAltText('target'), { clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('加入参考图失败：图片已在参考图中', 'error')
    })
    expect(showToast).not.toHaveBeenCalledWith('已加入参考图', 'success')
  })
})
