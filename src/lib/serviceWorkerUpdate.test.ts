import { describe, expect, it, vi } from 'vitest'
import {
  SERVICE_WORKER_UPDATE_INTERVAL_MS,
  createServiceWorkerUpdateScheduler,
  unregisterExistingServiceWorkers,
  watchServiceWorkerControllerChange,
} from './serviceWorkerUpdate'

describe('createServiceWorkerUpdateScheduler', () => {
  it('updates immediately and throttles subsequent visible checks', () => {
    const update = vi.fn(async () => undefined)
    let now = 1_000
    const scheduler = createServiceWorkerUpdateScheduler(
      { update },
      {
        now: () => now,
        intervalMs: SERVICE_WORKER_UPDATE_INTERVAL_MS,
      },
    )

    scheduler.check()
    expect(update).toHaveBeenCalledTimes(1)

    now += SERVICE_WORKER_UPDATE_INTERVAL_MS - 1
    scheduler.check()
    expect(update).toHaveBeenCalledTimes(1)

    now += 1
    scheduler.check()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('swallows update failures so lifecycle listeners keep working', async () => {
    const error = new Error('offline')
    const onError = vi.fn()
    const scheduler = createServiceWorkerUpdateScheduler(
      { update: vi.fn(async () => Promise.reject(error)) },
      { now: () => 1, onError },
    )

    scheduler.check()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onError).toHaveBeenCalledWith(error)
  })

  it('allows the next visible check to retry immediately after an update failure', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    let now = 1_000
    const scheduler = createServiceWorkerUpdateScheduler(
      { update },
      {
        now: () => now,
        intervalMs: SERVICE_WORKER_UPDATE_INTERVAL_MS,
        onError: vi.fn(),
      },
    )

    scheduler.check()
    await new Promise((resolve) => setTimeout(resolve, 0))
    now += 1
    scheduler.check()

    expect(update).toHaveBeenCalledTimes(2)
  })

  it('does not let an older failed update clear throttling for a newer check', async () => {
    let rejectFirst!: (error: Error) => void
    const firstUpdate = new Promise((_resolve, reject) => {
      rejectFirst = reject
    })
    const update = vi.fn().mockReturnValueOnce(firstUpdate).mockResolvedValue(undefined)
    let now = 1_000
    const scheduler = createServiceWorkerUpdateScheduler(
      { update },
      {
        now: () => now,
        intervalMs: SERVICE_WORKER_UPDATE_INTERVAL_MS,
        onError: vi.fn(),
      },
    )

    scheduler.check()
    now += SERVICE_WORKER_UPDATE_INTERVAL_MS
    scheduler.check()
    rejectFirst(new Error('late offline'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    now += 1
    scheduler.check()

    expect(update).toHaveBeenCalledTimes(2)
  })

  it('swallows development cleanup failures while unregistering existing workers', async () => {
    const getRegistrationsError = new Error('registrations unavailable')
    const unregisterError = new Error('unregister failed')
    const onError = vi.fn()

    await unregisterExistingServiceWorkers(
      {
        getRegistrations: vi.fn(async () => Promise.reject(getRegistrationsError)),
      },
      { onError },
    )

    const unregister = vi.fn(async () => Promise.reject(unregisterError))
    await unregisterExistingServiceWorkers(
      {
        getRegistrations: vi.fn(async () => [{ unregister }]),
      },
      { onError },
    )

    expect(onError).toHaveBeenCalledWith(getRegistrationsError)
    expect(onError).toHaveBeenCalledWith(unregisterError)
  })
})

describe('watchServiceWorkerControllerChange', () => {
  it('首次安装(注册前无 controller)不通知', () => {
    const listeners: Array<() => void> = []
    const onNewVersion = vi.fn()
    watchServiceWorkerControllerChange(
      { controller: null, addEventListener: (_type, listener) => listeners.push(listener) },
      onNewVersion,
    )

    expect(listeners).toHaveLength(0)
    expect(onNewVersion).not.toHaveBeenCalled()
  })

  it('已有 controller 的页面被新版本接管时通知一次(重复 controllerchange 不重复提示)', () => {
    const listeners: Array<() => void> = []
    const onNewVersion = vi.fn()
    watchServiceWorkerControllerChange(
      { controller: {}, addEventListener: (_type, listener) => listeners.push(listener) },
      onNewVersion,
    )

    expect(listeners).toHaveLength(1)
    listeners[0]()
    listeners[0]()
    expect(onNewVersion).toHaveBeenCalledTimes(1)
  })
})
