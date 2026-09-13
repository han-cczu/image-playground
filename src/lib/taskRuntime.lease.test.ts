import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    getAllConversations: vi.fn(async () => []),
    getAllTasks: vi.fn(async () => []),
    getAllImages: vi.fn(async () => []),
    getTask: vi.fn(async () => undefined),
    putTask: vi.fn(async () => 'task-id'),
    putConversation: vi.fn(async () => 'conversation-id'),
    persistConversationMigration: vi.fn(async () => undefined),
  }
})

vi.mock('./taskRuntime/lease', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./taskRuntime/lease')>()
  return {
    ...actual,
    queryHeldTaskLeases: vi.fn(async () => new Set<string>()),
    watchTaskLeaseRelease: vi.fn(),
  }
})

import { getAllTasks, getTask, putTask } from './db'
import { queryHeldTaskLeases, watchTaskLeaseRelease } from './taskRuntime/lease'
import { CONVERSATION_MIGRATION_VERSION } from './conversations'
import { useStore } from '../store'
import { initStore, resetTaskRuntimeForTest, SYNC_HTTP_INTERRUPTED_ERROR } from './taskRuntime'
import { enqueueTask } from './taskRuntime/submit'
import * as taskLeases from './taskRuntime/lease'

function runningTask(id: string): TaskRecord {
  return {
    id,
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1_000,
    finishedAt: null,
    elapsed: null,
    conversationId: 'conv-a',
    apiProvider: 'openai',
  }
}

function createLocalStorageStub(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('initStore 与任务租约(另一标签页正在执行的任务不能被当孤儿标记)', () => {
  beforeEach(() => {
    resetTaskRuntimeForTest()
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.stubGlobal('localStorage', createLocalStorageStub())
    localStorage.setItem(
      'image-playground.conversationMigrationVersion',
      String(CONVERSATION_MIGRATION_VERSION),
    )
    vi.mocked(getAllTasks).mockReset()
    vi.mocked(getTask).mockReset()
    vi.mocked(putTask).mockReset()
    vi.mocked(putTask).mockResolvedValue('task-id')
    vi.mocked(queryHeldTaskLeases).mockReset()
    vi.mocked(queryHeldTaskLeases).mockResolvedValue(new Set())
    vi.mocked(watchTaskLeaseRelease).mockReset()
    useStore.setState({
      conversations: [{ id: 'conv-a', title: 'A', createdAt: 1, updatedAt: 1 }],
      activeConversationId: 'conv-a',
      tasks: [],
      inputImages: [],
      favoriteCategories: [],
    })
  })

  it('无人持有租约的 running 任务照旧翻成「请求中断」并落库', async () => {
    vi.mocked(getAllTasks).mockResolvedValue([runningTask('orphan')])
    vi.mocked(getTask).mockResolvedValue(runningTask('orphan'))

    await initStore()

    expect(useStore.getState().tasks[0]).toMatchObject({
      id: 'orphan',
      status: 'error',
      error: SYNC_HTTP_INTERRUPTED_ERROR,
    })
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'orphan', status: 'error' }))
    expect(watchTaskLeaseRelease).not.toHaveBeenCalled()
  })

  it('被别的标签页持有租约的 running 任务原样保留、不写库,并挂上租约释放观察者', async () => {
    vi.mocked(getAllTasks).mockResolvedValue([runningTask('owned'), runningTask('orphan')])
    vi.mocked(getTask).mockResolvedValue(runningTask('orphan'))
    vi.mocked(queryHeldTaskLeases).mockResolvedValue(new Set(['owned']))

    await initStore()

    const byId = new Map(useStore.getState().tasks.map((task) => [task.id, task]))
    expect(byId.get('owned')).toMatchObject({ status: 'running', error: null })
    expect(byId.get('orphan')).toMatchObject({
      status: 'error',
      error: SYNC_HTTP_INTERRUPTED_ERROR,
    })
    expect(putTask).toHaveBeenCalledTimes(1)
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'orphan' }))
    expect(watchTaskLeaseRelease).toHaveBeenCalledTimes(1)
    expect(watchTaskLeaseRelease).toHaveBeenCalledWith('owned', expect.any(Function))
  })

  it('持有者崩溃(租约释放时库里仍是 running)→ 观察者补标中断;持有者正常完成(库里已是 done)→ 不动', async () => {
    vi.mocked(getAllTasks).mockResolvedValue([runningTask('owned')])
    vi.mocked(queryHeldTaskLeases).mockResolvedValue(new Set(['owned']))
    await initStore()
    const onReleased = vi.mocked(watchTaskLeaseRelease).mock.calls[0][1]

    // 正常完成:依据取自库(done),即使本页内存副本还停在 running 也不能覆写
    vi.mocked(getTask).mockResolvedValueOnce({
      ...runningTask('owned'),
      status: 'done',
      finishedAt: 5_000,
      elapsed: 4_000,
    })
    onReleased()
    await vi.runAllTimersAsync()
    expect(putTask).not.toHaveBeenCalled()
    expect(useStore.getState().tasks[0].status).toBe('done')

    // 崩溃:库里仍 running → 补标
    vi.mocked(getTask).mockResolvedValueOnce(runningTask('owned'))
    onReleased()
    await vi.runAllTimersAsync()
    const marked = useStore.getState().tasks[0]
    expect(marked).toMatchObject({ status: 'error', error: SYNC_HTTP_INTERRUPTED_ERROR })
    // 耗时按「补标时刻 - 创建时刻」算(runAllTimersAsync 会推进假时钟,只断言关系不断言绝对值)
    expect(marked.finishedAt).toBeGreaterThanOrEqual(10_000)
    expect(marked.elapsed).toBe((marked.finishedAt ?? 0) - marked.createdAt)
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'owned', status: 'error' }))
  })

  it('查询租约前持有者已经完成,不能把旧 running 快照写回为中断', async () => {
    const completed: TaskRecord = {
      ...runningTask('completed'),
      status: 'done',
      outputImages: ['result'],
      finishedAt: 5_000,
    }
    vi.mocked(getAllTasks).mockResolvedValue([runningTask('completed')])
    vi.mocked(getTask).mockResolvedValue(completed)

    await initStore()

    expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', outputImages: ['result'] })
    expect(putTask).not.toHaveBeenCalled()
  })

  it.each(['running', 'done'] as const)(
    '启动尚未完成时租约已释放,观察者正确恢复 %s 记录',
    async (status) => {
      vi.mocked(getAllTasks).mockResolvedValue([runningTask('owned')])
      vi.mocked(queryHeldTaskLeases).mockResolvedValue(new Set(['owned']))
      vi.mocked(getTask).mockResolvedValue({ ...runningTask('owned'), status })
      vi.mocked(watchTaskLeaseRelease).mockImplementation((_id, released) => {
        released()
      })

      await initStore()
      await vi.runAllTimersAsync()

      expect(useStore.getState().tasks[0].status).toBe(status === 'running' ? 'error' : 'done')
    },
  )

  it('查询租约前任务已被删除,不能用旧 running 快照复活它', async () => {
    vi.mocked(getAllTasks).mockResolvedValue([runningTask('deleted')])
    vi.mocked(getTask).mockResolvedValue(undefined)

    await initStore()

    expect(useStore.getState().tasks).toEqual([])
    expect(putTask).not.toHaveBeenCalled()
  })

  it('入队等待实际取得租约后才把 running 任务写入数据库', async () => {
    let grant!: () => void
    const acquired = new Promise<void>((resolve) => {
      grant = resolve
    })
    const acquire = vi.spyOn(taskLeases, 'acquireTaskLease').mockReturnValue(acquired)
    try {
      const enqueue = enqueueTask({
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        apiProvider: 'openai',
        apiProfileId: 'p',
        apiProfileName: 'P',
        apiModel: 'model',
        inputImageIds: [],
        maskTargetImageId: null,
        maskImageId: null,
        conversationId: 'conv-a',
      })
      await Promise.resolve()
      expect(putTask).not.toHaveBeenCalled()
      grant()
      await enqueue
      expect(putTask).toHaveBeenCalledOnce()
    } finally {
      grant()
      acquire.mockRestore()
    }
  })
})
