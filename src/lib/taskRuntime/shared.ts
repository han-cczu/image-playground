/**
 * taskRuntime 内部共享的运行期状态与基础工具。
 *
 * 拆分约定(2026-08 可维护性拆分轮):原 taskRuntime.ts 近 2000 行单文件按职责拆为
 * shared / persistence / watchdog / cancel / codexCli / init / submit / grid / actions /
 * mutations / inputImages 十一个模块,依赖严格单向,公开 API 一律经 index.ts 汇总再导出——
 * 外部(含 store/index.ts 的 re-export 链)导入路径 './taskRuntime' 与名字全部不变。
 *
 * 两张 Map 是跨模块共享的可变运行期状态:executeTask(submit)注册,watchdog 计时、
 * 取消/删除路径(cancel / mutations)消费。**仅限 taskRuntime 内部导入**,index 不导出。
 */

import { releaseAllTaskLeasesForTest, releaseTaskLease } from './lease'
import { resetInFlightImagesForTest } from '../inFlightImages'
import { resetIndexedDbSyncStateForTest } from '../../store/idbSyncState'

export const syncHttpWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
export const taskAbortControllers = new Map<string, AbortController>()

/**
 * 自动重试的退避睡眠(可唤醒)。**必须可唤醒而不是只可清除**:executeTask 的重试循环
 * `await` 在这个 promise 上,若取消/删除路径只 clearTimeout 而不 resolve,promise 永不
 * 落定 → executeTask 永久挂起,并发闸 worker 槽位被死占,后续批量任务全部饿死。
 * 唤醒后循环里的 status 守卫会发现任务已非 running 而立即退出。
 */
interface RetryBackoffSleep {
  timer: ReturnType<typeof setTimeout>
  wake: () => void
}
const retryBackoffSleeps = new Map<string, RetryBackoffSleep>()

export function sleepForRetryBackoff(taskId: string, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      retryBackoffSleeps.delete(taskId)
      resolve()
    }, delayMs)
    retryBackoffSleeps.set(taskId, { timer, wake: resolve })
  })
}

/** 是否正处于自动重试的退避睡眠中(此时没有 AbortController,但它是在途任务而非排队成员)。 */
export function isTaskInRetryBackoff(taskId: string): boolean {
  return retryBackoffSleeps.has(taskId)
}

export function wakeRetryBackoffSleep(taskId: string): void {
  const entry = retryBackoffSleeps.get(taskId)
  if (!entry) return
  clearTimeout(entry.timer)
  retryBackoffSleeps.delete(taskId)
  entry.wake()
}

const testResetCallbacks: Array<() => void> = []

/**
 * 各模块把自己的「仅测试复位」逻辑注册进来(init 的 promise 缓存、孤儿 GC 待执行任务等):
 * 拆分后模块级私有状态分散在各文件,集中在这里逐一复位会引入反向依赖,改为注册制。
 */
export function registerTaskRuntimeTestReset(callback: () => void): void {
  testResetCallbacks.push(callback)
}

/**
 * 仅测试用:清空模块级运行期 Map。永挂的 callImageApi mock 会让 executeTask 阻塞在 await、
 * 永不进 finally 清理,controller/watchdog 条目跨用例残留——cancelBatch 的 has() 计数会被污染。
 */
export function resetTaskRuntimeForTest(): void {
  for (const timer of syncHttpWatchdogTimers.values()) clearTimeout(timer)
  syncHttpWatchdogTimers.clear()
  taskAbortControllers.clear()
  // 先唤醒再清:悬挂的退避 promise 不落定会让上一个用例的 executeTask 泄漏到下一个用例
  for (const taskId of [...retryBackoffSleeps.keys()]) wakeRetryBackoffSleep(taskId)
  releaseAllTaskLeasesForTest()
  resetInFlightImagesForTest()
  resetIndexedDbSyncStateForTest()
  for (const callback of testResetCallbacks) callback()
}

let uid = 0
export function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

export function clearSyncHttpWatchdogTimer(taskId: string) {
  const timer = syncHttpWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  syncHttpWatchdogTimers.delete(taskId)
}

export function clearTaskAbortController(taskId: string) {
  taskAbortControllers.delete(taskId)
}

function abortTaskRequest(taskId: string) {
  const controller = taskAbortControllers.get(taskId)
  if (controller && !controller.signal.aborted) controller.abort()
}

/** 结束一次请求尝试。超时重试仍由本页执行,必须继续持有任务租约,否则观察页会误标「请求中断」。 */
export function abortTaskAttempt(taskId: string) {
  abortTaskRequest(taskId)
  clearSyncHttpWatchdogTimer(taskId)
  clearTaskAbortController(taskId)
}

/** 统一收口在途任务的运行期资源:中止请求 + 清 watchdog 定时器 + 清 AbortController + 唤醒退避睡眠 + 释放租约。 */
export function terminateTaskRuntime(taskId: string) {
  abortTaskAttempt(taskId)
  wakeRetryBackoffSleep(taskId)
  // 取消/删除/跨标签页终止后本页不再执行它,租约随之释放(留着会让别的标签页误以为它还在跑)
  releaseTaskLease(taskId)
}
