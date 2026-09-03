/**
 * 任务取消(单条/批次/全部)与运行期资源批量回收(taskRuntime 拆分轮,见 shared.ts 头注释)。
 */
import type { TaskRecord } from '../../types'
import { useStore } from '../../store'
import { registerIndexedDbSyncRuntimeTerminator } from '../../store/idbRuntimeBridge'
import { isTaskInRetryBackoff, taskAbortControllers, terminateTaskRuntime } from './shared'
import { updateTaskInStoreSilently } from './persistence'

const TASK_CANCELLED_ERROR = '已取消生成'

/**
 * 批量回收一组 running 任务的运行期资源,**不落任务状态、不写库**——供「记录本身即将被
 * 整体删除」的路径(删除对话级联 / 清空全部数据 / replace 导入)使用:此时 cancelTask 的
 * fire-and-forget 写库可能在清库之后才落盘,把幽灵记录写回刚清空的表。
 *
 * 调用契约(与 removeTask/removeMultipleTasks 的安全模式一致):调用方必须在**同一同步段内**
 * 把这些任务从 store 移除,然后才能 await 任何 IDB 操作。否则 abort 异常以微任务到达
 * executeTask 的 catch 时任务在 store 里仍是 running,守卫不会早退,updateTaskInStoreSilently
 * 的 putTask 事务会晚于清库事务执行,把幽灵 error 记录写回刚清空的表;并发闸也会在该窗口内
 * 取出排队成员发出真实请求(入口守卫读到的还是 running)。
 */
export function terminateRunningTaskRuntimes(tasks: TaskRecord[]): void {
  for (const task of tasks) {
    if (task.status === 'running') terminateTaskRuntime(task.id)
  }
}

registerIndexedDbSyncRuntimeTerminator(terminateRunningTaskRuntimes)

export function createCancelledTask(task: TaskRecord, now = Date.now()): TaskRecord {
  return {
    ...task,
    status: 'error',
    error: TASK_CANCELLED_ERROR,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  }
}

/**
 * 用户主动取消一个进行中的任务:中止请求 + 清理运行期资源,并落 'error' 态 + 取消文案。
 * TaskStatus 无 'cancelled',故复用 'error' + 专属文案(与 SYNC_HTTP_INTERRUPTED_ERROR 同构)。
 */
export function cancelTask(taskId: string, now = Date.now()): boolean {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || task.status !== 'running') return false

  terminateTaskRuntime(taskId)
  updateTaskInStoreSilently(taskId, {
    status: 'error',
    error: TASK_CANCELLED_ERROR,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

export interface CancelBatchResult {
  /** 在途被中止(已注册 AbortController,请求被 abort) */
  aborted: number
  /** 排队被跳过(尚未被并发闸取出,翻 error 后由 executeTask 入口守卫拦截,不发请求) */
  skipped: number
}

/** 按谓词圈定 running 成员逐条 cancelTask(语义单点:中止/清理/落态全继承,自带幂等)。 */
function cancelRunningTasks(predicate: (task: TaskRecord) => boolean): CancelBatchResult {
  const members = useStore.getState().tasks.filter((t) => t.status === 'running' && predicate(t))
  const result: CancelBatchResult = { aborted: 0, skipped: 0 }
  for (const member of members) {
    // 在途/排队的区分仅用于反馈文案:controller 在 attempt 进入时注册,而自动重试的退避睡眠期间
    // controller 已清、任务却仍是在途(不是排队成员),要一并计入,否则 toast 数字把它们报成「跳过排队」
    const inFlight = taskAbortControllers.has(member.id) || isTaskInRetryBackoff(member.id)
    if (cancelTask(member.id)) {
      if (inFlight) result.aborted += 1
      else result.skipped += 1
    }
  }
  // React 19 自动批处理:同一事件流内逐条 setTasks 合并为一次渲染,无需批量 patch
  return result
}

/**
 * 取消整个批次:在途成员 abort 请求,排队成员翻态后被 executeTask 入口守卫跳过。
 * 口径 = 取消时刻该 batchId 下全部 running 成员(含正在补跑的格);取消落 error+取消文案,
 * 仍可被「补跑全部失败格」复活(取消=失败的一种,补跑语义保持可预测)。
 */
export function cancelBatch(batchId: string): CancelBatchResult {
  return cancelRunningTasks((t) => t.batchId === batchId)
}

/** 取消全部在途任务(不限批次,含无 batchId 单条):429 急停 / 命令面板入口。 */
export function cancelAllRunning(): CancelBatchResult {
  return cancelRunningTasks(() => true)
}
