import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireTaskLease,
  isTaskLeaseSupported,
  queryHeldTaskLeases,
  releaseAllTaskLeasesForTest,
  releaseTaskLease,
  watchTaskLeaseRelease,
} from './lease'

/**
 * 最小 Web Locks 仿真:同名锁独占;ifAvailable 拿不到就回调 null;等待中的请求在锁释放后按序获得。
 * 只仿真本模块用到的语义,不追求与规范逐条对齐。
 */
function createFakeLockManager() {
  const held = new Map<string, { done: Promise<unknown> }>()
  const waiters = new Map<string, Array<() => void>>()

  async function run(name: string, callback: (lock: Lock | null) => unknown) {
    const lock = { name, mode: 'exclusive' } as Lock
    let finish!: () => void
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    held.set(name, { done })
    try {
      return await callback(lock)
    } finally {
      held.delete(name)
      finish()
      const next = waiters.get(name)?.shift()
      if (next) next()
    }
  }

  const manager = {
    request: vi.fn(
      (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) => {
        if (held.has(name)) {
          if (options.ifAvailable) return Promise.resolve(callback(null))
          return new Promise((resolve) => {
            const queue = waiters.get(name) ?? []
            queue.push(() => resolve(run(name, callback)))
            waiters.set(name, queue)
          })
        }
        return run(name, callback)
      },
    ),
    query: vi.fn(async () => ({
      held: Array.from(held.keys()).map((name) => ({ name, mode: 'exclusive' as const })),
      pending: [],
    })),
  }
  return { manager, held }
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('task lease (Web Locks)', () => {
  let fake: ReturnType<typeof createFakeLockManager>

  beforeEach(() => {
    fake = createFakeLockManager()
    vi.stubGlobal('navigator', { locks: fake.manager })
  })

  afterEach(() => {
    releaseAllTaskLeasesForTest()
    vi.unstubAllGlobals()
  })

  it('acquire 后别的标签页能查到租约,release 后查不到', async () => {
    expect(isTaskLeaseSupported()).toBe(true)
    acquireTaskLease('task-a')
    await flush()
    expect(await queryHeldTaskLeases()).toEqual(new Set(['task-a']))

    releaseTaskLease('task-a')
    await flush()
    expect(await queryHeldTaskLeases()).toEqual(new Set())
  })

  it('重复 acquire 不叠加持锁,release 一次即释放', async () => {
    acquireTaskLease('task-a')
    acquireTaskLease('task-a')
    await flush()
    expect(fake.manager.request).toHaveBeenCalledTimes(1)

    releaseTaskLease('task-a')
    await flush()
    expect(fake.held.size).toBe(0)
  })

  it('request 回调延迟时 acquire 保持等待,回调获锁后完成', async () => {
    const request = fake.manager.request.getMockImplementation()!
    let grant!: () => void
    fake.manager.request.mockImplementationOnce(
      (name, options, callback) =>
        new Promise((resolve) => {
          grant = () => resolve(request(name, options, callback))
        }),
    )
    let acquired = false
    const acquiring = acquireTaskLease('task-a').then(() => {
      acquired = true
    })
    await flush()
    expect(acquired).toBe(false)
    expect(fake.held.size).toBe(0)

    grant()
    await acquiring
    expect(await queryHeldTaskLeases()).toEqual(new Set(['task-a']))
  })

  it('request 失败时结束等待并清理登记,后续可重新取得租约', async () => {
    fake.manager.request.mockRejectedValueOnce(new Error('unavailable'))
    await acquireTaskLease('task-a')
    expect(fake.held.size).toBe(0)
    await acquireTaskLease('task-a')
    expect(await queryHeldTaskLeases()).toEqual(new Set(['task-a']))
  })

  it('观察者在持有者释放后才被回调一次,且拿到锁后立即归还', async () => {
    acquireTaskLease('task-a')
    await flush()
    const onReleased = vi.fn()
    watchTaskLeaseRelease('task-a', onReleased)
    await flush()
    expect(onReleased).not.toHaveBeenCalled()

    releaseTaskLease('task-a')
    await flush()
    expect(onReleased).toHaveBeenCalledTimes(1)
    // 观察者不会把锁一直占着——否则原持有者所在页(或本页)之后重跑同 id 任务会拿不到租约
    expect(fake.held.size).toBe(0)
  })

  it('没有 Web Locks 的环境退化为「查不到任何租约」,acquire/watch 均为空操作', async () => {
    vi.stubGlobal('navigator', {})
    expect(isTaskLeaseSupported()).toBe(false)
    acquireTaskLease('task-a')
    watchTaskLeaseRelease('task-a', () => {})
    expect(await queryHeldTaskLeases()).toEqual(new Set())
    expect(fake.manager.request).not.toHaveBeenCalled()
  })

  it('query 抛错时按无租约处理,不向上冒泡', async () => {
    fake.manager.query.mockRejectedValueOnce(new Error('boom'))
    await expect(queryHeldTaskLeases()).resolves.toEqual(new Set())
  })
})
