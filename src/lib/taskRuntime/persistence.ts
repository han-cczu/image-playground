/**
 * 任务/图片的持久化写入与回滚原语(taskRuntime 拆分轮,见 shared.ts 头注释)。
 * updateTaskInStore 是唯一「内存 + IDB 双写」入口;*Silently 变体供 fire-and-forget
 * 调用方使用(内部已 toast + 标 persistenceError 并吞错,避免逃逸成未捕获 rejection)。
 */
import type { TaskRecord } from '../../types'
import { useStore } from '../../store'
import { putTask, deleteImage } from '../db'
import { deleteCachedImage } from '../imageCache'
import { collectReferencedImageIds } from '../storageStats'
import { getInFlightImageIds } from '../inFlightImages'
import {
  clearPendingIndexedDbTaskWrite,
  markPendingIndexedDbTaskWrite,
} from '../../store/idbSyncState'

/**
 * 回滚一组刚 storeImage 的图片(成对删 DB + 内存缓存),但只删当前没有任何 task / inputImage 引用、
 * 也没有被其它 owner 登记为在途的,避免误删内容寻址去重命中的在用图(并发兄弟任务已 storeImage 但
 * 尚未 commit 到任务记录的同 hash 输出图,过去会被取消任务的回滚误删)。
 * @param owner 发起回滚的 owner(taskId / 提交会话),它自己登记的在途图正是要回滚的对象,不计入保护。
 */
export async function rollbackStoredImages(imageIds: string[], owner?: string): Promise<void> {
  if (!imageIds.length) return
  const { tasks, inputImages } = useStore.getState()
  const stillUsed = collectReferencedImageIds(tasks, inputImages)
  const inFlightElsewhere = getInFlightImageIds(owner)
  for (const id of imageIds) {
    if (!stillUsed.has(id) && !inFlightElsewhere.has(id)) {
      await deleteImage(id)
      deleteCachedImage(id)
    }
  }
}

export async function rollbackStoredImagesSilently(
  imageIds: string[],
  owner?: string,
): Promise<void> {
  try {
    await rollbackStoredImages(imageIds, owner)
  } catch (err) {
    useStore
      .getState()
      .showToast(`清理临时图片失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

export function updateTaskInStoreSilently(taskId: string, patch: Partial<TaskRecord>) {
  void updateTaskInStore(taskId, patch).catch(() => {
    /* updateTaskInStore already surfaced the persistence error */
  })
}

export async function persistTaskSilently(task: TaskRecord) {
  markPendingIndexedDbTaskWrite(task.id)
  try {
    await putTask(task)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const state = useStore.getState()
    state.setTasks(
      state.tasks.map((item) =>
        item.id === task.id ? { ...item, persistenceError: message } : item,
      ),
    )
    state.showToast(`保存任务失败：${message}`, 'error')
  } finally {
    clearPendingIndexedDbTaskWrite(task.id)
  }
}

export async function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>): Promise<void> {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
  const task = updated.find((t) => t.id === taskId)
  if (!task) return
  // 登记必须先于 setTasks(同一同步段):跨标签页刷新在落盘前到达时,以本地版本为准而不是被快照回退
  markPendingIndexedDbTaskWrite(taskId)
  setTasks(updated)

  try {
    await putTask(task)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const state = useStore.getState()
    state.setTasks(
      state.tasks.map((item) =>
        item.id === taskId ? { ...item, persistenceError: message } : item,
      ),
    )
    state.showToast(`保存任务失败：${message}`, 'error')
    throw err
  } finally {
    clearPendingIndexedDbTaskWrite(taskId)
  }
}
