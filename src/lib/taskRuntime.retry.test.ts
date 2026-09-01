import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './api/apiProfiles'
import { ApiHttpError } from './api/imageApiShared'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    putTask: vi.fn(async () => 'task-id'),
    storeImage: vi.fn(async () => 'generated-image-id'),
    getImage: vi.fn(async () => undefined),
    putConversation: vi.fn(async () => 'conv-id'),
    deleteTask: vi.fn(async () => undefined),
    deleteImage: vi.fn(async () => undefined),
  }
})

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    callImageApi: vi.fn(),
  }
})

import { callImageApi } from './api'
import type { CallApiResult } from './api'
import { useStore } from '../store'
import { cancelTask, resetTaskRuntimeForTest, submitTask } from './taskRuntime'

const SUCCESS_RESULT: CallApiResult = {
  images: ['data:image/png;base64,AA=='],
  actualParams: {},
}

function currentTask() {
  return useStore.getState().tasks[0]
}

/** 提交单条任务并等第一次请求发出(submitTask 对单条是 fire-and-forget executeTask) */
async function submitAndWaitFirstCall() {
  await submitTask()
  await vi.waitFor(() => expect(callImageApi).toHaveBeenCalled())
}

describe('瞬时失败自动重试(executeTask 集成)', () => {
  beforeEach(() => {
    resetTaskRuntimeForTest()
    vi.useFakeTimers()
    vi.mocked(callImageApi).mockReset()
    useStore.setState({
      // timeout: 1(秒)顶层镜像 → watchdog 用例的超时预算;autoRetryMax 各用例按需覆盖
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', timeout: 1 },
      prompt: 'retry prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      taskRetryInfo: {},
      detailTaskId: null,
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    resetTaskRuntimeForTest()
    vi.useRealTimers()
  })

  it('429 两次后成功:落 done 且恰好请求 3 次,徽标随成功清除', async () => {
    vi.mocked(callImageApi)
      .mockRejectedValueOnce(new ApiHttpError('限流', 429))
      .mockRejectedValueOnce(new ApiHttpError('限流', 429))
      .mockResolvedValueOnce(SUCCESS_RESULT)

    await submitAndWaitFirstCall()
    // 两段退避(≤3s + ≤12s,含 jitter 上限)全部走完
    await vi.advanceTimersByTimeAsync(60_000)

    expect(callImageApi).toHaveBeenCalledTimes(3)
    expect(currentTask()).toMatchObject({ status: 'done', outputImages: ['generated-image-id'] })
    expect(useStore.getState().taskRetryInfo).toEqual({})
  })

  it('退避期间写入重试徽标瞬态(attempt/maxAttempts)', async () => {
    vi.mocked(callImageApi)
      .mockRejectedValueOnce(new ApiHttpError('限流', 429))
      .mockResolvedValueOnce(SUCCESS_RESULT)

    await submitAndWaitFirstCall()
    await vi.waitFor(() => {
      const info = useStore.getState().taskRetryInfo[currentTask().id]
      expect(info).toMatchObject({ attempt: 1, maxAttempts: 2 })
    })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(currentTask().status).toBe('done')
  })

  it('重试次数耗尽:落 error 且文案标注已自动重试次数', async () => {
    vi.mocked(callImageApi).mockRejectedValue(new ApiHttpError('上游打嗝', 502))

    await submitAndWaitFirstCall()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).toHaveBeenCalledTimes(3)
    expect(currentTask()).toMatchObject({
      status: 'error',
      error: '上游打嗝(已自动重试 2 次)',
    })
    expect(useStore.getState().taskRetryInfo).toEqual({})
  })

  it('非瞬时错误(400)不重试:一次即落 error 且不带重试标注', async () => {
    vi.mocked(callImageApi).mockRejectedValue(new ApiHttpError('参数不合法', 400))

    await submitAndWaitFirstCall()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(currentTask()).toMatchObject({ status: 'error', error: '参数不合法' })
  })

  it('429 的 Retry-After 拉长退避:窗口未到不发下一请求', async () => {
    vi.mocked(callImageApi)
      .mockRejectedValueOnce(new ApiHttpError('限流', 429, 30_000))
      .mockResolvedValueOnce(SUCCESS_RESULT)

    await submitAndWaitFirstCall()
    // jitter 上限 3s < Retry-After 30s:20s 时必然仍在等待
    await vi.advanceTimersByTimeAsync(20_000)
    expect(callImageApi).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(40_000)
    expect(callImageApi).toHaveBeenCalledTimes(2)
    expect(currentTask().status).toBe('done')
  })

  it('退避期间取消:立即唤醒退出,不发下一请求,落取消文案', async () => {
    vi.mocked(callImageApi).mockRejectedValue(new ApiHttpError('限流', 429))

    await submitAndWaitFirstCall()
    await vi.waitFor(() =>
      expect(useStore.getState().taskRetryInfo[currentTask().id]).toBeTruthy(),
    )

    cancelTask(currentTask().id)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(currentTask()).toMatchObject({ status: 'error', error: '已取消生成' })
    expect(useStore.getState().taskRetryInfo).toEqual({})
  })

  it('autoRetryMax=0 时行为与旧版完全一致:一次失败即落 error', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, autoRetryMax: 0 } }))
    vi.mocked(callImageApi).mockRejectedValue(new ApiHttpError('boom', 500))

    await submitAndWaitFirstCall()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(currentTask()).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('watchdog 超时被重试接管:中止旧请求重发,耗尽后按超时落 error 并标注重试次数', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, autoRetryMax: 1 } }))
    const signals: Array<AbortSignal | undefined> = []
    // 模拟真实 fetch:abort 时以 AbortError 拒绝(重试循环靠 reject 推进;
    // 完全不响应 abort 的挂死场景由 watchdog 兜底直落覆盖,见 store.test.ts 同名用例)
    vi.mocked(callImageApi).mockImplementation(async (opts) => {
      signals.push(opts.signal)
      return new Promise<never>((_, reject) => {
        opts.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    })

    await submitAndWaitFirstCall()
    // 第 1 次超时(1s)→ 仲裁接管重试;退避(≤3s)后第 2 次请求;再超时(1s)→ 尝试耗尽落终态
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(true)
    const task = currentTask()
    expect(task.status).toBe('error')
    expect(task.error).toContain('请求超时')
    expect(task.error).toContain('已自动重试 1 次')
  })

  it('AbortError(取消而非超时)不触发重试', async () => {
    let capturedSignal: AbortSignal | undefined
    vi.mocked(callImageApi).mockImplementation(async (opts) => {
      capturedSignal = opts.signal
      return new Promise<never>((_, reject) => {
        opts.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    })

    await submitAndWaitFirstCall()
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())
    cancelTask(currentTask().id)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(currentTask()).toMatchObject({ status: 'error', error: '已取消生成' })
  })
})
