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
