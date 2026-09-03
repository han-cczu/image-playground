export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000

export interface ServiceWorkerRegistrationLike {
  update: () => Promise<unknown>
}

export interface ServiceWorkerContainerLike {
  getRegistrations: () => Promise<readonly { unregister: () => Promise<unknown> }[]>
}

interface SchedulerOptions {
  now?: () => number
  intervalMs?: number
  onError?: (error: unknown) => void
}

interface UnregisterOptions {
  onError?: (error: unknown) => void
}

export function createServiceWorkerUpdateScheduler(
  registration: ServiceWorkerRegistrationLike,
  {
    now = () => Date.now(),
    intervalMs = SERVICE_WORKER_UPDATE_INTERVAL_MS,
    onError,
  }: SchedulerOptions = {},
) {
  let lastCheckAt = Number.NEGATIVE_INFINITY

  const check = () => {
    const current = now()
    if (current - lastCheckAt < intervalMs) return
    lastCheckAt = current
    void registration.update().catch((error) => {
      if (lastCheckAt === current) lastCheckAt = Number.NEGATIVE_INFINITY
      onError?.(error)
    })
  }

  return { check }
}

export async function unregisterExistingServiceWorkers(
  serviceWorker: ServiceWorkerContainerLike,
  { onError }: UnregisterOptions = {},
): Promise<void> {
  try {
    const registrations = await serviceWorker.getRegistrations()
    await Promise.all(
      registrations.map((registration) =>
        registration.unregister().catch((error) => onError?.(error)),
      ),
    )
  } catch (error) {
    onError?.(error)
  }
}

export interface ServiceWorkerControllerContainerLike {
  controller: unknown
  addEventListener: (type: 'controllerchange', listener: () => void) => void
}

/**
 * 新版本 SW 接管本页(controllerchange)时通知调用方。
 * 为什么需要:sw.js 用 skipWaiting + clients.claim 静默接管,activate 又会删掉旧缓存,而已打开的旧页面
 * 仍引用旧 hashed chunk——此后首次打开任一懒加载弹层(设置/遮罩编辑器/命令面板…)会 404。
 * 这里只通知、绝不自动 reload:taskRuntime 在页面内跑批量任务,自动刷新会杀掉进行中的整批。
 * 首次安装(注册前没有 controller)不通知:那不是「发布了新版本」,而是本页第一次被 SW 接管。
 */
export function watchServiceWorkerControllerChange(
  container: ServiceWorkerControllerContainerLike,
  onNewVersion: () => void,
): void {
  const hadController = container.controller != null
  if (!hadController) return
  let notified = false
  container.addEventListener('controllerchange', () => {
    if (notified) return
    notified = true
    onNewVersion()
  })
}
