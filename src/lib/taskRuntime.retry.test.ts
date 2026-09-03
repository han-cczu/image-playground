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
import { getImage } from './db'
import { clearImageCache } from './imageCache'
import { useStore } from '../store'
import { cancelAllRunning, cancelTask, resetTaskRuntimeForTest, submitTask } from './taskRuntime'

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
    // 永挂的 getImage mock 会让 ensureImageCached 的 inFlightLoads 条目跨用例残留,必须连同内存缓存一起清
    clearImageCache()
    vi.useFakeTimers()
    vi.mocked(callImageApi).mockReset()
    vi.mocked(getImage).mockReset().mockResolvedValue(undefined)
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
    await vi.waitFor(() => expect(useStore.getState().taskRetryInfo[currentTask().id]).toBeTruthy())

    cancelTask(currentTask().id)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(currentTask()).toMatchObject({ status: 'error', error: '已取消生成' })
    expect(useStore.getState().taskRetryInfo).toEqual({})
  })

  it('退避中的任务在批量取消里计为「在途中止」而不是「排队跳过」', async () => {
    vi.mocked(callImageApi).mockRejectedValue(new ApiHttpError('限流', 429))

    await submitAndWaitFirstCall()
    await vi.waitFor(() => expect(useStore.getState().taskRetryInfo[currentTask().id]).toBeTruthy())

    const result = cancelAllRunning()

    expect(result).toEqual({ aborted: 1, skipped: 0 })
    expect(currentTask()).toMatchObject({ status: 'error', error: '已取消生成' })
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
    // 模拟真实 fetch:abort 时以 AbortError 拒绝(重试循环靠 reject 推进;真实请求层自带同预算的
    // 超时控制器,请求阶段不存在「永不落定」。不响应 abort 的挂死只会出现在输入图加载阶段,
    // 由下面「输入图 IDB 读挂起」用例覆盖;autoRetryMax=0 的直落路径见 store.test.ts 同名用例)
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

  it('输入图 IDB 读挂起(默认 autoRetryMax=2):超时不进重试而直落 error,任务不会永久 running', async () => {
    expect(useStore.getState().settings.autoRetryMax).toBe(2)
    // 模拟浏览器 IndexedDB 请求永不完成:ensureImageCached 不观察 signal,abort 对它无效,
    // 若仲裁器仍按「有剩余尝试」接管,attempt 永不落定、watchdog 又已被清,任务就永久卡 running
    vi.mocked(getImage).mockImplementation(() => new Promise<never>(() => undefined))
    useStore.setState({
      inputImages: [{ id: 'hung-input-image', dataUrl: 'data:image/png;base64,aQ==' }],
    })

    await submitTask()
    await vi.waitFor(() => expect(currentTask()?.status).toBe('running'))
    expect(getImage).toHaveBeenCalledWith('hung-input-image')
    await vi.advanceTimersByTimeAsync(600_000)

    expect(callImageApi).not.toHaveBeenCalled()
    const task = currentTask()
    expect(task.status).toBe('error')
    expect(task.error).toContain('请求超时')
    // 加载阶段没有发过请求,不算「已自动重试」
    expect(task.error).not.toContain('已自动重试')
    expect(useStore.getState().taskRetryInfo).toEqual({})
    expect(useStore.getState().showToast).toHaveBeenCalledWith('生成任务请求超时', 'error')
  })

  it('输入图加载超时直落后 IDB 迟到完成:不再发请求,也不复活已落 error 的任务', async () => {
    let resolveImage: (value: undefined) => void = () => undefined
    vi.mocked(getImage).mockImplementation(
      () => new Promise<undefined>((resolve) => (resolveImage = resolve)),
    )
    useStore.setState({
      inputImages: [{ id: 'late-input-image', dataUrl: 'data:image/png;base64,aQ==' }],
    })
    vi.mocked(callImageApi).mockResolvedValue(SUCCESS_RESULT)

    await submitTask()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(currentTask().status).toBe('error')

    // 迟到的 IDB 结果让挂起的 attempt 继续往下走:store 里已无该图 → 抛错 → 循环发现任务已非 running 退出
    resolveImage(undefined)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(callImageApi).not.toHaveBeenCalled()
    expect(currentTask()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求超时'),
    })
    expect(useStore.getState().taskRetryInfo).toEqual({})
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
