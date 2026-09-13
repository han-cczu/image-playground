// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'
import ImagePanel from './ImagePanel'

const mocks = vi.hoisted(() => ({
  setDetailTaskId: vi.fn(),
  setLightboxImageId: vi.fn(),
  showToast: vi.fn(),
  retryTask: vi.fn(async () => undefined),
  cancelTask: vi.fn(),
  copyTextToClipboard: vi.fn(async () => undefined),
}))

const state = vi.hoisted(() => ({
  showToast: vi.fn(),
}))

vi.mock('../../store', () => {
  const getStoreState = () => ({
    showToast: state.showToast,
    setDetailTaskId: mocks.setDetailTaskId,
    setLightboxImageId: mocks.setLightboxImageId,
  })
  const useStore = (selector: (s: ReturnType<typeof getStoreState>) => unknown) =>
    selector(getStoreState())
  useStore.getState = getStoreState
  return {
    useStore,
    retryTask: mocks.retryTask,
    cancelTask: mocks.cancelTask,
  }
})

vi.mock('../../lib/image/clipboard', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
  getClipboardFailureMessage: (fallback: string) => fallback,
}))

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'error',
    error: 'network failed',
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

describe('ImagePanel', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    state.showToast = vi.fn()
  })

  it('明确取消的记录显示已取消并保留重试入口，含取消字样的其他错误保持原文', () => {
    const props = {
      imageIndex: 0,
      setImageIndex: vi.fn(),
      currentOutputImageSrc: '',
      currentImageRatio: '',
      currentImageSize: '',
      durationText: null,
    }
    const { rerender } = render(<ImagePanel {...props} task={task({ error: '已取消生成' })} />)
    expect(screen.getByText('已取消')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试任务' })).toBeTruthy()

    rerender(<ImagePanel {...props} task={task({ error: '取消请求失败：HTTP 500' })} />)
    expect(screen.getByText('取消请求失败：HTTP 500')).toBeTruthy()
    expect(screen.queryByText('已取消')).toBeNull()
  })

  it('reports delayed error-copy success through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const copy = createDeferred<undefined>()
    state.showToast = oldToast
    mocks.copyTextToClipboard.mockReturnValueOnce(copy.promise)

    render(
      <ImagePanel
        task={task()}
        imageIndex={0}
        setImageIndex={vi.fn()}
        currentOutputImageSrc=""
        currentImageRatio=""
        currentImageSize=""
        durationText={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '复制完整报错' }))
    state.showToast = latestToast

    await act(async () => {
      copy.resolve(undefined)
      await copy.promise
    })

    expect(latestToast).toHaveBeenCalledWith('完整报错已复制', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })
})
