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

export const syncHttpWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
export const taskAbortControllers = new Map<string, AbortController>()

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

/** 统一收口在途任务的运行期资源:中止请求 + 清 watchdog 定时器 + 清 AbortController。 */
export function terminateTaskRuntime(taskId: string) {
  abortTaskRequest(taskId)
  clearSyncHttpWatchdogTimer(taskId)
  clearTaskAbortController(taskId)
}
