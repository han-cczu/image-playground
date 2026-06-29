// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TaskRecord } from '../../types'
import { DEFAULT_PARAMS } from '../../types'
import InfoPanel from './InfoPanel'
import { MAX_INPUT_IMAGE_BYTES } from '../../lib/taskRuntime'

const mocks = vi.hoisted(() => ({
  setDetailTaskId: vi.fn(),
  setLineageTaskId: vi.fn(),
  setLightboxImageId: vi.fn(),
  showToast: vi.fn(),
  createFavoriteCategory: vi.fn(() => 'created-category'),
  ensureDefaultFavoriteCategory: vi.fn(() => 'default-favorite-category'),
  updateTaskInStore: vi.fn(async () => undefined),
  showCodexCliPrompt: vi.fn(),
  getCodexCliPromptKey: vi.fn(() => 'codex-cli-openai'),
  copyBlobToClipboard: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
}))

const state = vi.hoisted(() => ({
  settings: {
    codexCli: true,
  },
  dismissedCodexCliPrompts: [] as string[],
  favoriteCategories: [] as Array<{ id: string; name: string; color: string; sortOrder: number; createdAt: number }>,
  showToast: vi.fn(),
}))

vi.mock('../../store', () => {
  const getStoreState = () => ({
    ...state,
    setDetailTaskId: mocks.setDetailTaskId,
    setLineageTaskId: mocks.setLineageTaskId,
    setLightboxImageId: mocks.setLightboxImageId,
    showToast: state.showToast,
    createFavoriteCategory: mocks.createFavoriteCategory,
    ensureDefaultFavoriteCategory: mocks.ensureDefaultFavoriteCategory,
  })
  const useStore = (
    selector: (s: typeof state & {
      setDetailTaskId: typeof mocks.setDetailTaskId
      setLineageTaskId: typeof mocks.setLineageTaskId
      setLightboxImageId: typeof mocks.setLightboxImageId
      showToast: typeof state.showToast
      createFavoriteCategory: typeof mocks.createFavoriteCategory
      ensureDefaultFavoriteCategory: typeof mocks.ensureDefaultFavoriteCategory
    }) => unknown,
  ) => selector(getStoreState())
  useStore.getState = getStoreState
  return {
    useStore,
    updateTaskInStore: mocks.updateTaskInStore,
    showCodexCliPrompt: mocks.showCodexCliPrompt,
    getCodexCliPromptKey: mocks.getCodexCliPromptKey,
  }
})

vi.mock('../../lib/image/clipboard', () => ({
  copyBlobToClipboard: mocks.copyBlobToClipboard,
  copyTextToClipboard: mocks.copyTextToClipboard,
  getClipboardFailureMessage: (fallback: string) => fallback,
}))

const baseTask: TaskRecord = {
  id: 'task-a',
  prompt: 'prompt',
  params: DEFAULT_PARAMS,
  inputImageIds: [],
  maskTargetImageId: null,
  maskImageId: null,
  outputImages: ['output-a'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function imageResponse(body = 'image', init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/png')
  return new Response(body, {
    ...init,
    headers,
  })
}

describe('InfoPanel', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    state.showToast = vi.fn()
  })

  it('does not emit duplicate-key warnings when imported input images contain repeated ids', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <InfoPanel
        task={{ ...baseTask, inputImageIds: ['input-a', 'input-a'] }}
        parentLinks={[]}
        childLinks={[]}
        imageSrcs={{ 'input-a': 'data:image/png;base64,a' }}
        maskPreviewSrc=""
        currentOutputImageId="output-a"
        durationText={null}
      />,
    )

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key'),
      expect.anything(),
    )
  })

  it('does not copy a reference image when fetching it fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse('not found', { status: 404 })),
    )

    render(
      <InfoPanel
        task={{ ...baseTask, inputImageIds: ['input-a'] }}
        parentLinks={[]}
        childLinks={[]}
        imageSrcs={{ 'input-a': 'https://example.test/missing.png' }}
        maskPreviewSrc=""
        currentOutputImageId="output-a"
        durationText={null}
      />,
    )

    fireEvent.click(screen.getByTitle('复制参考图'))

    await waitFor(() => {
      expect(state.showToast).toHaveBeenCalledWith('复制参考图失败', 'error')
    })
    expect(mocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('does not copy an oversized reference image response', async () => {
    const blob = vi.fn(async () => new Blob(['huge'], { type: 'image/png' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Length': String(MAX_INPUT_IMAGE_BYTES + 1) }),
        blob,
      })),
    )

    render(
      <InfoPanel
        task={{ ...baseTask, inputImageIds: ['input-a'] }}
        parentLinks={[]}
        childLinks={[]}
        imageSrcs={{ 'input-a': 'https://example.test/huge.png' }}
        maskPreviewSrc=""
        currentOutputImageId="output-a"
        durationText={null}
      />,
    )

    fireEvent.click(screen.getByTitle('复制参考图'))

    await waitFor(() => {
      expect(state.showToast).toHaveBeenCalledWith('复制参考图失败', 'error')
    })
    expect(blob).not.toHaveBeenCalled()
    expect(mocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('stops copying a streaming reference image once the body exceeds the image size cap', async () => {
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

    render(
      <InfoPanel
        task={{ ...baseTask, inputImageIds: ['input-a'] }}
        parentLinks={[]}
        childLinks={[]}
        imageSrcs={{ 'input-a': 'https://example.test/stream.png' }}
        maskPreviewSrc=""
        currentOutputImageId="output-a"
        durationText={null}
      />,
    )

    fireEvent.click(screen.getByTitle('复制参考图'))

    await waitFor(() => {
      expect(state.showToast).toHaveBeenCalledWith('复制参考图失败', 'error')
    })
    expect(pulls).toBeLessThan(100)
    expect(mocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('shows copy failure when a reference image body keeps hanging', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        blob: vi.fn(() => new Promise<Blob>(() => undefined)),
      })),
    )

    render(
      <InfoPanel
        task={{ ...baseTask, inputImageIds: ['input-a'] }}
        parentLinks={[]}
        childLinks={[]}
        imageSrcs={{ 'input-a': 'https://example.test/hanging.png' }}
        maskPreviewSrc=""
        currentOutputImageId="output-a"
        durationText={null}
      />,
    )

    fireEvent.click(screen.getByTitle('复制参考图'))

    await vi.advanceTimersByTimeAsync(60_000)
    await Promise.resolve()
    await Promise.resolve()

    expect(state.showToast).toHaveBeenCalledWith('复制参考图失败', 'error')
    expect(mocks.copyBlobToClipboard).not.toHaveBeenCalled()
  })

  it('reports delayed prompt copy success through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const copy = createDeferred<undefined>()
    state.showToast = oldToast
    mocks.copyTextToClipboard.mockReturnValueOnce(copy.promise)

    render(
      <InfoPanel
        task={baseTask}
        parentLinks={[]}
        childLinks={[]}
        imageSrcs={{}}
        maskPreviewSrc=""
        currentOutputImageId="output-a"
        durationText={null}
      />,
    )

    fireEvent.click(screen.getByTitle('复制提示词'))
    state.showToast = latestToast

    await act(async () => {
      copy.resolve(undefined)
      await copy.promise
    })

    expect(latestToast).toHaveBeenCalledWith('提示词已复制', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('reports delayed reference-image copy success through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const copy = createDeferred<undefined>()
    state.showToast = oldToast
    mocks.copyBlobToClipboard.mockReturnValueOnce(copy.promise)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse()),
    )

    render(
      <InfoPanel
        task={{ ...baseTask, inputImageIds: ['input-a'] }}
        parentLinks={[]}
        childLinks={[]}
        imageSrcs={{ 'input-a': 'https://example.test/ref.png' }}
        maskPreviewSrc=""
        currentOutputImageId="output-a"
        durationText={null}
      />,
    )

    fireEvent.click(screen.getByTitle('复制参考图'))
    await waitFor(() => {
      expect(mocks.copyBlobToClipboard).toHaveBeenCalledTimes(1)
    })
    state.showToast = latestToast

    await act(async () => {
      copy.resolve(undefined)
      await copy.promise
    })

    expect(latestToast).toHaveBeenCalledWith('参考图已复制', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })
})
