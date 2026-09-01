/**
 * 同步 HTTP 任务的超时 watchdog 与「刷新中断」标记(taskRuntime 拆分轮,见 shared.ts 头注释)。
 */
import type { TaskRecord } from '../../types'
import { useStore } from '../../store'
import { DEFAULT_API_TIMEOUT } from '../api/apiProfiles'
import { resolveChatTimeoutMs } from '../api/chatCompletionsShared'
import { syncHttpWatchdogTimers, clearSyncHttpWatchdogTimer, terminateTaskRuntime } from './shared'
import { updateTaskInStoreSilently } from './persistence'

export const SYNC_HTTP_INTERRUPTED_ERROR = '请求中断'

/**
 * 超时重试仲裁(自动重试轮 D4):watchdog 在 executeTask 的 promise 流之外落态,超时要
 * 可重试就必须让它先问一句「这个任务还有剩余尝试吗」。回调由 submit 模块注册(注册制
 * 仿 idbRuntimeBridge,避免 watchdog→submit 反向依赖破坏拆分轮的单向依赖)。
 *
 * takeover:重试方已接管(标记已设、在途请求已中止),watchdog 不落态不 toast;
 * fail:按现行「超时落 error + toast」兜底,retriesUsed 用于给文案追加重试次数——
 * 兜底直落必须保留在 watchdog 侧:重试循环靠请求 reject 推进,遇到不响应 abort 的
 * 挂死请求时只有 watchdog 的直接落态能终结任务。
 */
type WatchdogRetryDecision = { kind: 'takeover' } | { kind: 'fail'; retriesUsed: number }

let timeoutRetryArbiter: ((taskId: string) => WatchdogRetryDecision) | null = null

export function registerWatchdogTimeoutRetryArbiter(
  arbiter: (taskId: string) => WatchdogRetryDecision,
): void {
  timeoutRetryArbiter = arbiter
}

function createSyncHttpTimeoutError(timeoutSeconds: number) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。`
}

function isSyncHttpTask(task: TaskRecord) {
  const provider = task.apiProvider ?? 'openai'
  return provider === 'openai' || provider === 'gemini'
}

export function isRunningSyncHttpTask(task: TaskRecord) {
  return task.status === 'running' && isSyncHttpTask(task)
}

export function markInterruptedSyncHttpTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningSyncHttpTask(task)) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: SYNC_HTTP_INTERRUPTED_ERROR,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

function failSyncHttpTaskIfStillRunning(
  taskId: string,
  error: string,
  retriesUsed = 0,
  now = Date.now(),
) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningSyncHttpTask(task)) return false

  terminateTaskRuntime(taskId)

  updateTaskInStoreSilently(taskId, {
    status: 'error',
    error: retriesUsed > 0 ? `${error}(已自动重试 ${retriesUsed} 次)` : error,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

export function scheduleSyncHttpWatchdog(taskId: string, timeoutSeconds: number) {
  clearSyncHttpWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningSyncHttpTask(task)) return

  // watchdog 总在 executeTask 中、请求即将发起时被调度,故从「此刻」起算完整 timeout。
  // 不能再用 createdAt 偏移:批量路径下 N 条 task 在 enqueueTask 时统一写 createdAt,但要在并发闸
  // (runEnqueuedTasks)队列里排队等待才被取出执行;若按 createdAt 计时,排队时长会被错误计入,
  // 导致后段任务在请求真正开始前(或刚开始)就被误判「请求超时」而假失败。
  // 注:elapsed(用户感知总耗时)仍基于 createdAt,语义不同,不受此影响。
  const timeoutMs = resolveChatTimeoutMs(timeoutSeconds, DEFAULT_API_TIMEOUT)
  const timer = setTimeout(() => {
    syncHttpWatchdogTimers.delete(taskId)
    // 还有剩余自动重试时交给重试方接管(不落态不 toast);仲裁器内部会中止在途请求
    const decision = timeoutRetryArbiter?.(taskId) ?? { kind: 'fail' as const, retriesUsed: 0 }
    if (decision.kind === 'takeover') return
    const failed = failSyncHttpTaskIfStillRunning(
      taskId,
      createSyncHttpTimeoutError(timeoutSeconds),
      decision.retriesUsed,
    )
    if (failed) useStore.getState().showToast('生成任务请求超时', 'error')
  }, timeoutMs)
  syncHttpWatchdogTimers.set(taskId, timer)
}
