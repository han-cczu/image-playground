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

function failSyncHttpTaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningSyncHttpTask(task)) return false

  terminateTaskRuntime(taskId)

  updateTaskInStoreSilently(taskId, {
    status: 'error',
    error,
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
    const failed = failSyncHttpTaskIfStillRunning(
      taskId,
      createSyncHttpTimeoutError(timeoutSeconds),
    )
    if (failed) useStore.getState().showToast('生成任务请求超时', 'error')
  }, timeoutMs)
  syncHttpWatchdogTimers.set(taskId, timer)
}
